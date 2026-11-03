/**
 * The resident host's runtime primitives: the background-work ledger, the input
 * queue, the CLI spawn path, the per-host round record, and the reconcile beat.
 * Extracted from `claude-host-driver.provider.ts`.
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
  ClaudeResidentQuery,
  ClaudeResidentReconcileMode
} from './resident-process.types.js';
import {
  buildResidentSdkOptions
} from './resident-launch.js';

/**
 * What the CLI's own `Stop` hook has said about the work it is holding.
 *
 * One reading per hook firing, newest kept. The list is a *ledger* rather than a
 * single value because the hook fires at the end of every turn: at the end of
 * the turn that started background work it lists that work, and at the end of
 * the unattended turn that work produced it lists nothing again. Reading it
 * "latest first" is therefore only correct if the read happens at the right
 * moment — which is why the trigger is taken when an unattended turn *opens*
 * (no round armed, the previous turn's hook the newest entry) and not when it
 * ends (by then the hook has already reported the empty list it leaves behind).
 */
export type BackgroundWorkLedger = {
  record(input: AnyRecord): void;
  /** The newest reading that carried a task list, or null when none has. */
  latest(): { backgroundTasks?: unknown; sessionCrons?: unknown } | null;
  /** How many hook firings this process has reported. */
  readonly size: number;
};

export function createBackgroundWorkLedger(): BackgroundWorkLedger {
  let entries: Array<{ backgroundTasks?: unknown; sessionCrons?: unknown }> = [];

  return {
    record(input: AnyRecord): void {
      if (!input || typeof input !== 'object') {
        return;
      }
      if (!Array.isArray(input.background_tasks) && !Array.isArray(input.session_crons)) {
        // A hook firing that carries neither list says nothing about what the
        // process holds; keeping it would make the newest entry an empty one and
        // read every later turn as unexplained.
        return;
      }
      entries.push({ backgroundTasks: input.background_tasks, sessionCrons: input.session_crons });
      if (entries.length > 8) {
        entries = entries.slice(-8);
      }
    },
    latest() {
      return entries.at(-1) ?? null;
    },
    get size() {
      return entries.length;
    },
  };
}

// ---------------------------
//----------------- HELD-WORK RECONCILIATION ------------

/**
 * The never-ending prompt iterable one resident process reads.
 *
 * The SDK writes each yielded message to the CLI's stdin and, when the iterable
 * is exhausted, closes it (stdin EOF, which the CLI reads as "wind down"). So
 * this queue is two things at once: the channel a turn is delivered through
 * (`push`) and the process's own off switch (`end`). A pull with something
 * buffered yields it; a pull on an ended queue finishes the generator.
 */
export type ResidentInputQueue = {
  stream: AsyncIterable<AnyRecord>;
  push(...messages: AnyRecord[]): void;
  end(): void;
};

export function createResidentInputQueue(): ResidentInputQueue {
  const buffered: AnyRecord[] = [];
  let wake: (() => void) | null = null;
  let ended = false;

  const stream = (async function* () {
    for (;;) {
      const next = buffered.shift();
      if (next) {
        yield next;
        continue;
      }
      if (ended) {
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  })();

  return {
    stream,
    push(...messages: AnyRecord[]): void {
      if (ended || messages.length === 0) {
        return;
      }
      buffered.push(...messages);
      const resume = wake;
      wake = null;
      resume?.();
    },
    end(): void {
      if (ended) {
        return;
      }
      ended = true;
      const resume = wake;
      wake = null;
      resume?.();
    },
  };
}

/**
 * The SDK's process contract as it really is at this seam: a Node child, which
 * carries a pid.
 *
 * The SDK interface leaves `pid` out (`SpawnedProcess` is what the transport
 * consumes, and its own default spawn returns a facade that hides the child),
 * but both spawn paths this driver can end up wrapping — the SDK's default and
 * the session-scope hook — return the real `ChildProcess`. Widening it here is
 * what makes the pid readable without pretending the SDK promised one.
 */
export type ClaudeResidentProcessHandle = SpawnedProcess & { readonly pid?: number };

/**
 * Spawns the CLI the way the SDK's own default spawn does.
 *
 * Used only when the SDK options carry no `spawnClaudeCodeProcess` hook — a host
 * with no usable systemd user manager, where `mapCliOptionsToSDK` leaves the
 * hook unset. It mirrors that default's stdio shape (the CLI's stderr is dropped
 * unless SDK debugging is on) and forwards the abort signal, which the SDK has
 * already delayed past its own stdin-EOF grace window.
 */
export function spawnResidentCli(spawnOptions: SdkSpawnOptions): ClaudeResidentProcessHandle {
  const pipedStderr = Boolean(process.env.DEBUG_CLAUDE_AGENT_SDK);
  const child = nodeSpawn(spawnOptions.command, spawnOptions.args, {
    cwd: spawnOptions.cwd,
    env: spawnOptions.env,
    signal: spawnOptions.signal,
    stdio: ['pipe', 'pipe', pipedStderr ? 'pipe' : 'ignore'],
    windowsHide: true,
  });

  if (pipedStderr) {
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  }

  return child as unknown as ClaudeResidentProcessHandle;
}

/**
 * The real SDK, plus the one fact the SDK does not expose: the child pid.
 *
 * The launch options are the runtime's own — `mapCliOptionsToSDK` is the same
 * builder a per-run turn goes through, so a resident process is launched with
 * the same env overlay, executable resolution, effort and permission mapping the
 * per-run path produces. What is added is a spawn hook that wraps whatever hook
 * the builder installed (the memory-capped systemd scope, when this host has
 * one) and keeps the child it returns.
 */
/**
 * The SDK options one resident launch is built from, decided in one place.
 *
 * Split out of {@link createSdkResidentProcess} so the *decisions* about a
 * resident launch can be read without a CLI: the factory's remaining body is the
 * spawn hook, the pid capture and the raw-stdin writer, none of which a reading
 * needs, while the mode and the three entries are exactly what a criterion has to
 * hold the driver to. A factory that substitutes a scripted stream calls this and
 * reads them back; so does the real one, which is what keeps the two from being
 * two different option bags.
 */
/**
 * The SDK entry point one resident launch goes through.
 *
 * `query` is a module-level function — the per-run driver's `ClaudeHostQueryFactory`
 * states the same problem for the same reason — so there is no seam to stub and
 * no module-mocking precedent in this repository. A caller that wants to *read*
 * the options a launch is built with hands in its own, and that is the only way
 * the reading can come from the production path rather than from a second copy
 * of it: the option bag is built by {@link buildResidentSdkOptions}, handed
 * straight to this, and the default is the SDK.
 */
export type ClaudeResidentQueryFactory = (input: {
  prompt: AsyncIterable<AnyRecord>;
  options: AnyRecord;
}) => ClaudeResidentQuery;

/** The real SDK, at the one boundary where its wide type meets this module's narrow one. */
export const sdkResidentQuery: ClaudeResidentQueryFactory = (input) =>
  query(input as unknown as Parameters<typeof query>[0]) as unknown as ClaudeResidentQuery;

/**
 * One turn handed to a resident process, and the promise its dispatcher awaits.
 *
 * `settled` is what makes "the turn is over" idempotent across the two paths
 * that can end a round — its own `result` and an `interrupt` that got there
 * first — and `interrupted` is how the `result` that follows an interrupt knows
 * not to write a terminal `complete` the abort path has already written.
 *
 * Which turn a round belongs to is **not** kept here any more. The ledger binds
 * a delivery to a turn by the id the CLI states (`command_lifecycle started`
 * while a turn is open), and the rounds a turn closes are read from that
 * binding. This record is only what the *dispatcher* owns: who to write to, and
 * the promise to settle.
 */
export type ResidentRound = {
  appSessionId: string;
  turn: HostTurnInput;
  writer: ProviderRuntimeWriter;
  context: ProviderRuntimeContext;
  done: Promise<void>;
  settle(): void;
  fail(error: Error): void;
  settled: boolean;
  interrupted: boolean;
};

/**
 * One delivery: one accepted send, and its ledger record.
 *
 * The record itself — its vocabulary, its fields and the rule that a terminal is
 * written once — lives in the ledger module now (AC-395): this file reads it and
 * never writes it. What stays here is the runtime half of the same delivery, in
 * {@link ResidentDeliveryRuntime}.
 */

/**
 * The driver's own half of one delivery, indexed by `commandUuid` (AC-395 (d)).
 *
 * The ledger records what the CLI said; none of this is the CLI's business, and
 * keeping it out of the ledger is what stops the ledger type from carrying a
 * driver type. Three facts, all of them about how this process is wired:
 *
 *  - `round` — the dispatcher's own record, which holds the writer its frames go
 *    to and the promise its dispatch awaits;
 *  - `leaseId` — the key the manager knows this delivery's `turn` lease by;
 *  - `leaseHeld` — whether that lease is currently reported, so the projection is
 *    a convergence rather than a repeated add.
 *
 * `turnWriter` is the fourth: the run writer a delivery's terminal frame must end
 * up on when the run belongs to its TURN rather than to the delivery.
 */
export type ResidentDeliveryRuntime = {
  round: ResidentRound;
  leaseId: string;
  leaseHeld: boolean;
  turnWriter?: ProviderRuntimeWriter;
};


/**
 * One delivery, as {@link ClaudeResidentHostDriver.ledgerReading} reports it.
 *
 * A copy, so a reader cannot reach into host state. It is the criterion's whole
 * input: AC-378 drives a real host through scripted sequences and reads the
 * ledger back rather than reaching into the driver, so a red lands on a stated
 * reading rather than on a private field.
 */
export type ClaudeResidentLedgerReading = {
  deliveries: Array<{
    deliveryId: string;
    state: ClaudeResidentDeliveryState;
    reason: ClaudeResidentDeliveryReason | null;
    turnId: string | null;
    runOpen: boolean;
    owed: boolean;
    enqueuedAt: number;
    startedAt: number | null;
    endedAt: number | null;
    priority: string | null;
  }>;
  foreign: string[];
  turn: {
    id: string;
    kind: 'delivered' | 'unattended';
    open: boolean;
    ownerDeliveryId: string | null;
    interruptRequested: boolean;
  } | null;
  closedTurns: Array<{
    id: string;
    kind: 'delivered' | 'unattended';
    outcome: 'completed' | 'aborted';
    ownerDeliveryId: string | null;
  }>;
  pendingStart: string[];
  anomalies: Array<{ code: string; detail: string }>;
  /** How many deliveries still have a run open — the projection the leases follow. */
  openRuns: number;
};

// ---------------------------------------------------------------------------
// The reconciler (SPEC §10.1) and the §10.2 log lines
// ---------------------------------------------------------------------------

/**
 * The anomaly codes the reconciler states (SPEC §10.1's table).
 *
 * `late-started-after-unattended-init` is deliberately absent: it is a 50 ms
 * ordering observation about a turn's `init`, not a check this host runs at a
 * `RESULT`/heartbeat boundary.
 */
export type ClaudeResidentReconcileAnomalyCode =
  | 'phantom-run'
  | 'owed-terminal-missing'
  | 'double-init'
  | 'interrupt-no-result'
  | 'frame-without-turn';

/**
 * One run the registry still holds as `running`, in the shape §10.1 reads.
 *
 * `sessionId` is the app session id, so a check running for one host can ask
 * "is there a run the registry still thinks is going for THIS session" without
 * the host having to know anything else the registry holds.
 */
export type ClaudeResidentRunningRun = {
  readonly sessionId: string;
  readonly runId: string;
};

/**
 * The run registry, as the reconciler reads it and acts on it.
 *
 * A PORT, injected, and that is a structural constraint rather than a taste:
 * the registry lives in the websocket module, which imports this one, so an
 * import from here would close a cycle (the file header states the gap, and
 * `claude-resident-unattended-turn.test.ts`'s structural reading holds this file
 * to zero imports of `modules/websocket`). `connectedClientCount` is the
 * precedent: the reading is handed in, and the composition root — the one place
 * both modules are in scope — is what binds the real one.
 *
 * The default ({@link NO_RESIDENT_RUN_REGISTRY}) reports no runs and closes
 * nothing: a host that cannot reach the registry must not conclude that a run is
 * phantom, for the same reason the browser-count default must not conclude that
 * somebody is watching.
 */
export type ClaudeResidentRunRegistryPort = {
  /** Every run the registry still holds as `running`, one row per run. */
  runningRuns(): readonly ClaudeResidentRunningRun[];
  /**
   * Closes one run, stating how it ended and why (§10.1's `enforce` arm).
   *
   * `outcome: 'aborted'` is the whole of it — a reconciled run is a run this
   * side decided had no ending of its own — and `reason` is what distinguishes a
   * reconciled close from an abort somebody asked for.
   */
  closeRun(input: {
    readonly runId: string;
    readonly outcome: 'aborted';
    readonly reason: string;
  }): void;
};

/**
 * The reason an `enforce` close states (SPEC §10.1: `reason: reconciled`).
 *
 * A constant because two readers hold it to the same word: the run's own
 * terminal record, and the criterion that reads the outcome back off the port.
 */
export const RESIDENT_RECONCILED_REASON = 'reconciled';

/**
 * The port a host that cannot reach the registry reads: nothing is running.
 *
 * Deliberately not "throw": the reconcile check runs at every `RESULT` and every
 * beat, and a host without the seam installed is an ordinary host (every
 * criterion, and every process before the composition root binds it), not a
 * broken one.
 */
export const NO_RESIDENT_RUN_REGISTRY: ClaudeResidentRunRegistryPort = {
  runningRuns: () => [],
  closeRun: () => undefined,
};

/**
 * How long a host's ledger may stand still before a registry run is `phantom-run`
 * (SPEC §10.1's `T_q`).
 *
 * A grace, not a policy about how long a turn takes: the window it covers is the
 * one between a turn's `RESULT` and the next piece of work, where the ledger has
 * legitimately not moved yet. Ten seconds is the shipped value.
 */
export const CLAUDE_RESIDENT_QUIESCE_MS = 10_000;

/**
 * The interval a host's own reconcile beat runs at, in milliseconds.
 *
 * §10.1's second check point is "the heartbeat", and it has to exist WITHOUT a
 * browser subscription: the websocket module's activity heartbeat is per-socket
 * and only armed while a client is attached (`activity-heartbeat.service.ts`),
 * so a reconcile wired to it would never see the phantom run the host closes
 * into no client. This beat is therefore armed per HOST — see
 * {@link ClaudeResidentHostDriver.startHost} — and runs for the host's whole
 * lifetime, whether or not anybody is watching.
 *
 * Five seconds mirrors the cadence §10.1 names, but it is the server-side beat
 * rather than a second binding to the client-driven one. It is unref'd for the
 * same reason the activity heartbeat is: a liveness check is never a reason for
 * the process to stay alive.
 */
export const CLAUDE_RESIDENT_RECONCILE_BEAT_MS = 5_000;

/**
 * The handle one host's reconcile beat hands back.
 *
 * A handle rather than just a stop function because AC5's "unref, and does not
 * hold the process" is a reading of the Node timer itself: {@link hasRef}
 * answers whether this beat is still keeping the event loop alive.
 */
export type ClaudeResidentReconcileBeat = {
  /** Stops the beat. Safe to call more than once. */
  stop(): void;
  /**
   * Whether the timer still keeps the event loop alive.
   *
   * An unref'd beat — the shipped one — answers `false`.
   */
  hasRef(): boolean;
};

/**
 * Arms one reconcile beat and answers the handle that owns it.
 *
 * The tick is the caller's callback: the driver binds it to `reconcileTick` for
 * one host, and a criterion can bind it to a spy to read that the beat really
 * fires with no client anywhere in the process — the property the per-socket
 * activity heartbeat cannot offer. The timer is unref'd here rather than at the
 * call site, so every beat this module arms has the same lifetime rule.
 *
 * `intervalMs <= 0` arms nothing and answers a stopped handle. That is the
 * disabled arm the criterion uses as the false form for "the beat exists"; the
 * driver's shipped default is {@link CLAUDE_RESIDENT_RECONCILE_BEAT_MS}.
 */
export function startResidentReconcileBeat(
  intervalMs: number,
  tick: () => void,
): ClaudeResidentReconcileBeat {
  if (!(intervalMs > 0)) {
    return { stop: () => undefined, hasRef: () => false };
  }
  const timer = setInterval(tick, intervalMs);
  // A beat is a liveness CHECK, never a reason for the process to stay alive —
  // the same rule the activity heartbeat states for its own timer.
  timer.unref?.();
  return {
    stop: () => clearInterval(timer),
    hasRef: () => timer.hasRef(),
  };
}

/**
 * What one reconcile check read (SPEC §10.1).
 *
 * Returned rather than only logged, because the criterion's readings have to
 * come from the driver's own answer rather than from a re-derivation of it: the
 * guard the false form removes ("a turn is open, so nothing here is phantom")
 * is readable here, and the line that names an anomaly is readable in the sink.
 */
export type ClaudeResidentReconcileReading = {
  /** The session this check ran for. */
  sessionId: string;
  /** The arm this host is on. */
  mode: ClaudeResidentReconcileMode;
  /** How long the host's ledger had stood still when the check read it. */
  quiescentMs: number;
  /** Whether the ledger had an open turn — §10.1's guard against over-settling. */
  turnOpen: boolean;
  /** How many runs the registry reported as running for this session. */
  runningRuns: number;
  /** The anomaly the check named, or `null` when the readings agree. */
  anomaly: ClaudeResidentReconcileAnomalyCode | null;
  /** The run ids this check closed (`enforce` only); empty under `log`. */
  closedRuns: readonly string[];
};

// ---------------------------------------------------------------------------
// The delivery state channel (SPEC §7.1): the ledger projected for the activity
// protocol, and the tick that announces a change to it.
// ---------------------------------------------------------------------------

/**
 * How long a terminal delivery stays in the snapshot after it ends.
 *
 * The same window the run registry keeps a terminal run for, and for the same
 * reason: it is the span in which a client that was away — a sleeping tab, a
 * reconnect — can still learn how a delivery it watched ended. It is stated here
 * as its own constant because this module may not import the registry's (the
 * registry lives in the websocket module, which imports this one), and the two
 * are held equal by the criterion that reads both.
 */
export const DEFAULT_DELIVERY_RETENTION_MS = 5 * 60 * 1000;

/**
 * How many terminal deliveries one session's snapshot keeps.
 *
 * A bound rather than a policy: the queue and the in-flight set are naturally
 * small, while a long session's *history* of ended deliveries is unbounded, and
 * the snapshot is re-sent on every change. The newest entries are the ones kept —
 * a client cares about what just happened — and the live entries are never
 * counted against this, because they are the reason the channel exists.
 */
export const DELIVERY_TERMINAL_LIMIT = 50;
