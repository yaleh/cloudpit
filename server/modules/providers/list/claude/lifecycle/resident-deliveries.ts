/**
 * The process-wide delivery/turn-run registries and the snapshot projection the
 * driver publishes through. Extracted from `claude-host-driver.provider.ts`.
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Writable } from 'node:stream';

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { SpawnOptions as SdkSpawnOptions, SpawnedProcess } from '@anthropic-ai/claude-agent-sdk';

import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import type { SessionHostManager } from '@/modules/session-hosts/index.js';
import type { IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  BackgroundWorkTrigger,
  ChatRunSource,
  ClaudeResidentDeliveryReason,
  ClaudeResidentDeliveryState,
  CommandLifecycleEvent,
  CommandLifecycleState,
  DeliveryEntry,
  DeliveryEntryReason,
  HostBindErrorCode,
  HostCloseReason,
  HostInputPriority,
  HostLease,
  HostPendingQueuedInputs,
  HostQueuedInputCancelResult,
  HostReconfigurePatch,
  HostResidentLaunch,
  HostResidentStartResult,
  HostTurnInput,
  LLMProvider,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  RemoteControlIsolation,
  ResidentDeliveryLookup,
  ResidentLedger,
  ResidentLedgerAnomaly,
  ResidentLedgerClosedTurn,
  ResidentLedgerDelivery,
  ResidentLedgerTurn,
  SessionBinding,
} from '@/shared/types.js';
import { DELIVERY_SOURCE_OPTION, DELIVERY_TEXT_MAX_CHARS, isTerminalDeliveryState } from '@/shared/types.js';
import { readVoiceRulesPort } from '@/shared/ports/voice-rules.port.js';
import type {
  ResidentLedgerEffect,
  ResidentLedgerEvent,
} from '@/modules/resident-ledger/index.js';
import {
  applyLedgerEvent,
  createResidentLedger,
  ledgerClosedTurns,
  ledgerDeliveries,
  ledgerDeliveryByUuid,
  ledgerPendingStart,
  ledgerTurn,
} from '@/modules/resident-ledger/index.js';
import {
  ClaudeSessionOccupiedError,
  createCompleteMessage,
  createNormalizedMessage,
  findBackgroundSessionOwner,
  residentRunIsTurn,
  resolveClaudeConfigDir,
} from '@/shared/utils.js';

import {
  DEFAULT_DELIVERY_RETENTION_MS,
  DELIVERY_TERMINAL_LIMIT
} from './resident-ledger-runtime.js';
import {
  ClaudeResidentProcessingReading,
  ResidentHostState
} from './resident-host.types.js';

/**
 * Owns the per-app-session readings the resident driver publishes and the rest
 * of the process reads (SPEC §7.1, §8.2, §4.3 I6).
 *
 * Every entry is a *closure over live host state*, keyed by app session, so
 * these five maps are the driver's registry rather than a cache any caller
 * fills: `publishDeliveries` installs or replaces them, and the activity
 * channel, the by-id delivery lookup, the turn-run reading and the `processing`
 * predicate read them back. Keeping them as private fields of one object gives
 * the registrations a single owner; the exported readers below and every driver
 * share the process's instance, which is what lets a reader in another module
 * see what a driver published.
 *
 * Process-wide rather than per-driver for the same reason the task and schedule
 * reducers are: the readings belong to the *server* rather than to one host,
 * and the frames that consume them outlive any single host's call stack. Each
 * session's reader closes over the live state, so a read always answers what
 * the ledger holds *now* — which is what makes an upsert frame and the REST
 * snapshot at the same revision agree by construction.
 *
 * Nothing here is cleared when a host closes. A process that exits leaves its
 * deliveries settled rather than deleted, and the retention window is precisely
 * the promise that a client which was away can still read how they ended; a
 * session whose process is long gone ages out to an empty list rather than a
 * stale ending.
 */
export class ClaudeResidentSessionRegistries {
  private readonly deliveryReadings = new Map<string, () => DeliveryEntry[]>();
  private readonly deliverySignatures = new Map<string, string>();
  private readonly turnRunReadings = new Map<string, () => { runId: string | null; startedAt: number | null }>();
  private readonly deliveryLookups = new Map<string, () => ResidentDeliveryLookup[]>();
  private readonly processingReadings = new Map<string, () => ClaudeResidentProcessingReading>();

  /**
   * Installs one session's delivery reading and reports whether the signature
   * it was announced for is new.
   *
   * The reading is always replaced — it closes over the live ledger, so the
   * latest closure is the current one. The returned boolean is the tick's
   * decision: a delivery change announces exactly once per signature, and the
   * comparison makes "the projection changed" the thing that decides — not the
   * number of call sites. The signature is deliberately computed from the
   * ledger's facts rather than from the reading: the reading is time-filtered,
   * and an entry silently ageing out of the retention window is not a change
   * anybody made.
   */
  registerDeliveries(sessionId: string, reading: () => DeliveryEntry[], signature: string): boolean {
    this.deliveryReadings.set(sessionId, reading);
    if (this.deliverySignatures.get(sessionId) === signature) {
      return false;
    }
    this.deliverySignatures.set(sessionId, signature);
    return true;
  }

  /** One session's live deliveries, or an empty list for a session never hosted here. */
  readDeliveries(sessionId: string): DeliveryEntry[] {
    const reading = this.deliveryReadings.get(sessionId);
    return reading ? reading() : [];
  }

  /** Installs one session's live turn-run reading. */
  registerTurnRun(
    sessionId: string,
    reading: () => { runId: string | null; startedAt: number | null },
  ): void {
    this.turnRunReadings.set(sessionId, reading);
  }

  /** The run the session's open turn is executing as, or two `null`s when there is none. */
  readTurnRun(sessionId: string): { runId: string | null; startedAt: number | null } {
    const reading = this.turnRunReadings.get(sessionId);
    return reading ? reading() : { runId: null, startedAt: null };
  }

  /** Installs one session's by-id delivery lookup. */
  registerDeliveryLookup(sessionId: string, reading: () => ResidentDeliveryLookup[]): void {
    this.deliveryLookups.set(sessionId, reading);
  }

  /**
   * The delivery with this id, across every session this process has hosted, or
   * `null` for an id no live ledger holds.
   *
   * `null` is "this process has no such delivery": the ledger is the authority
   * on ids it minted (SPEC §4.1 — `deliveryId` has one production surface, the
   * host), so an id it does not hold is an id that names nothing here. The scan
   * is linear in the number of resident sessions, which is the number of
   * processes a machine is running rather than the number of deliveries.
   */
  lookupDeliveryById(deliveryId: string): ResidentDeliveryLookup | null {
    for (const read of this.deliveryLookups.values()) {
      const found = read().find((entry) => entry.deliveryId === deliveryId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /** Installs one session's ledger-derived `processing` reading. */
  registerProcessing(sessionId: string, reading: () => ClaudeResidentProcessingReading): void {
    this.processingReadings.set(sessionId, reading);
  }

  /** One session's ledger-derived `processing`, or `null` when it was never published. */
  readProcessing(sessionId: string): ClaudeResidentProcessingReading | null {
    const reading = this.processingReadings.get(sessionId);
    return reading ? reading() : null;
  }

  /** Every session whose published ledger currently reads `processing`. */
  listProcessing(): Array<ClaudeResidentProcessingReading & { sessionId: string }> {
    const rows: Array<ClaudeResidentProcessingReading & { sessionId: string }> = [];
    for (const [sessionId, read] of this.processingReadings) {
      const reading = read();
      if (reading.processing) {
        rows.push({ sessionId, ...reading });
      }
    }
    return rows;
  }
}

/**
 * The registry the exported readers and every driver instance share.
 *
 * Process-wide by design: the readings belong to the *server* rather than to
 * one host, and modules that import `readSessionDeliveries` /
 * `lookupResidentDeliveryById` cannot be handed a per-driver object, so there
 * is one instance. The driver holds it and registers through it; the exported
 * readers below read it back.
 */
export const residentSessionRegistries = new ClaudeResidentSessionRegistries();

/**
 * The session's deliveries, as the activity protocol's snapshot carries them.
 *
 * The default `readDeliveries` of `createActivityStore`, and the same shape as
 * `readSessionTasks` / `readSessionSchedules`: a plain read of a process-wide
 * projection, so the protocol module can carry it without knowing what produced
 * it. A session this process has never seen answers an empty list — the honest
 * reading of "no driver here has accepted anything for it", and the reason the
 * activity criterion can inject its own store over a tree with no resident host.
 *
 * A reading outlives the host it came from, on purpose. A process that exits
 * leaves its deliveries settled rather than deleted, and the retention window is
 * precisely the promise that a client which was away can still read how they
 * ended; so the reader is not uninstalled when a host closes. It ages out on its
 * own — past the window the projection drops every terminal, and a session whose
 * process is long gone answers an empty list rather than a stale ending.
 */
export function readSessionDeliveries(sessionId: string): DeliveryEntry[] {
  return residentSessionRegistries.readDeliveries(sessionId);
}

/**
 * The by-id delivery readings per app session (SPEC §8.2).
 *
 * The deliberate twin of {@link ClaudeResidentSessionRegistries.readDeliveries},
 * installed by the same `publishDeliveries` call: where that one answers "every delivery of one
 * session, as the snapshot states it", this one answers "one delivery, found by
 * its id alone" — which is the question a caller that holds only a `deliveryId`
 * has, and has no session to look it up under. `run_get`'s delivery arm is its
 * only production consumer.
 *
 * It is NOT the snapshot projection: the retention window and the per-session
 * cap are policies for what a browser is shown, while a caller WAITING on a
 * delivery must be able to read it the moment it ends — which is exactly the
 * moment a filtered list would have dropped it or an older terminal would have
 * pushed it out. The ledger is the authority and this reads it whole.
 */
export function lookupResidentDeliveryById(deliveryId: string): ResidentDeliveryLookup | null {
  return residentSessionRegistries.lookupDeliveryById(deliveryId);
}

/**
 * The run the session's open turn is executing as, or two `null`s when there is
 * none. The other half of SPEC §7.1's turn addition, read live over the driver's
 * own turn binding.
 */
export function readSessionTurnRun(sessionId: string): { runId: string | null; startedAt: number | null } {
  return residentSessionRegistries.readTurnRun(sessionId);
}

/**
 * The session's ledger-derived `processing`, or `null` when no resident host of
 * this process has ever recorded a delivery for it.
 *
 * `null` is not "false": a session with no ledger here is one the resident
 * driver has nothing to say about — a per-run provider's session, or one this
 * process has never hosted — and its caller must fall back to its own reading
 * rather than read the absence as idle. A session whose host is gone but whose
 * ledger was published answers `false` once everything terminal, which is the
 * honest reading of "this host ended its work".
 */
export function readSessionProcessing(sessionId: string): ClaudeResidentProcessingReading | null {
  return residentSessionRegistries.readProcessing(sessionId);
}

/**
 * Every session whose ledger currently reads `processing`, with its reading.
 *
 * The enumerated half of {@link readSessionProcessing}: a consumer that has to
 * *list* the sessions processing rather than ask about one (the run registry's
 * `listRunningRuns`) cannot discover a session that has no run of its own from
 * the registry's own maps, so the ledger states the whole set here.
 */
export function listProcessingSessions(): Array<ClaudeResidentProcessingReading & { sessionId: string }> {
  return residentSessionRegistries.listProcessing();
}

/** Whether the delivery's state is one the snapshot calls live. */
export function deliveryIsLive(state: ClaudeResidentDeliveryState): boolean {
  return state === 'pushed' || state === 'queued' || state === 'started';
}

/** The tier the snapshot states, if the write was made under one of the CLI's three. */
export function snapshotPriority(priority: string | null): HostInputPriority | null {
  return priority === 'now' || priority === 'next' || priority === 'later' ? priority : null;
}

/**
 * The `cancelled` reason the snapshot states, if it is one of the four it names.
 *
 * `cli` — a terminal the CLI stated that nobody here asked for — is not a reason
 * the channel carries: it is the ordinary ending of a command that simply
 * finished, and a client drawing a row has nothing to do with that fact beyond
 * `completed`. `null` is therefore the honest answer for it, and for a live or
 * cleanly completed delivery alike.
 */
export function snapshotReason(reason: ClaudeResidentDeliveryReason | null): DeliveryEntryReason | null {
  if (
    reason === 'withdrawn'
    || reason === 'interrupt'
    || reason === 'process-exit'
    || reason === 'owed-terminal-missing'
  ) {
    return reason;
  }
  return null;
}

/**
 * One ledger delivery as one snapshot entry — the ten facts, always present.
 *
 * The key set is constant on purpose (see {@link DeliveryEntry}): `reason` and
 * `text` travel as `null` rather than as absent keys, so a reader's shape does not
 * depend on the delivery's state, and `text` is bounded here because this is the
 * only place the projection leaves the driver.
 */
export function snapshotDelivery(delivery: ResidentLedgerDelivery): DeliveryEntry {
  const live = deliveryIsLive(delivery.state);
  return {
    deliveryId: delivery.commandUuid,
    state: live
      ? (delivery.state === 'started' ? 'started' : 'queued')
      : (delivery.state === 'completed' ? 'completed' : 'cancelled'),
    source: delivery.source,
    priority: snapshotPriority(delivery.priority),
    enqueuedAt: delivery.enqueuedAt,
    startedAt: delivery.startedAt,
    endedAt: delivery.endedAt,
    turnId: delivery.turnId,
    reason: live || delivery.state === 'completed' ? null : snapshotReason(delivery.reason),
    text: live ? delivery.text.slice(0, DELIVERY_TEXT_MAX_CHARS) : null,
  };
}

/**
 * One ledger delivery as one by-id reading — what `run_get` resolves (SPEC §8.2).
 *
 * The same facts {@link snapshotDelivery} states, projected for a different
 * reader. Two differences are deliberate:
 *
 *  - it carries the session and the bound turn's run, because the reader holds
 *    neither and has only the id;
 *  - its `reason` is the ledger's own, `cli` residual included, because the
 *    reader asked why its command ended rather than what to draw.
 */
export function lookupDelivery(state: ResidentHostState, delivery: ResidentLedgerDelivery): ResidentDeliveryLookup {
  const live = deliveryIsLive(delivery.state);
  return {
    deliveryId: delivery.commandUuid,
    sessionId: state.appSessionId,
    turnId: delivery.turnId,
    runId: delivery.runId,
    state: live
      ? (delivery.state === 'started' ? 'started' : 'queued')
      : (delivery.state === 'completed' ? 'completed' : 'cancelled'),
    reason: live || delivery.state === 'completed' ? null : delivery.reason,
    source: delivery.source,
    enqueuedAt: delivery.enqueuedAt,
    startedAt: delivery.startedAt,
    endedAt: delivery.endedAt,
  };
}

/**
 * The ledger projected for the activity channel, as of `at`.
 *
 * Two rules shape it, and both are about the reading rather than the ledger:
 *
 *  - a **terminal** entry is kept only while it is inside
 *    {@link DEFAULT_DELIVERY_RETENTION_MS}, so a session that has been running for
 *    hours does not carry yesterday's endings in every frame;
 *  - at most {@link DELIVERY_TERMINAL_LIMIT} terminals are kept, the newest ones,
 *    while every live entry is kept unconditionally.
 *
 * The order is the ledger's — the order the sends were accepted — so a client
 * reading the list reads a queue in the order the process will take it, with the
 * recently ended entries interleaved where they happened.
 */
export function projectDeliveries(state: ResidentHostState, at: number): DeliveryEntry[] {
  const rows = ledgerDeliveries(state.turnLedger).map((delivery) => ({
    delivery,
    entry: snapshotDelivery(delivery),
  }));
  const kept = new Set<ResidentLedgerDelivery>();
  const retainedTerminals = rows.filter((row) => {
    if (deliveryIsLive(row.delivery.state)) {
      return false;
    }
    const endedAt = row.entry.endedAt;
    return endedAt === null || at - endedAt <= DEFAULT_DELIVERY_RETENTION_MS;
  });
  for (const row of retainedTerminals.slice(-DELIVERY_TERMINAL_LIMIT)) {
    kept.add(row.delivery);
  }
  return rows
    .filter((row) => deliveryIsLive(row.delivery.state) || kept.has(row.delivery))
    .map((row) => row.entry);
}

/**
 * The ledger's own signature of what the snapshot states, with no clock in it.
 *
 * This is what `publishDeliveries` compares: the ten facts of every delivery the
 * ledger holds, in order. It is deliberately the *unfiltered* projection — a
 * terminal ageing out of its retention window changes the reading without anybody
 * changing anything, and a tick for that would be an upsert per expired entry.
 */
export function deliveryChannelSignature(state: ResidentHostState): string {
  return JSON.stringify(ledgerDeliveries(state.turnLedger).map(snapshotDelivery));
}

/** The origin a dispatch stated for its send, as the runtime option carries it. */
export function readDeliverySource(options: AnyRecord | undefined): ChatRunSource {
  const stated = options?.[DELIVERY_SOURCE_OPTION];
  return stated === 'user' || stated === 'scheduled' || stated === 'unattended' || stated === 'mcp' || stated === 'voice'
    ? stated
    : 'user';
}
