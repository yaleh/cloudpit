/**
 * The blocked-session half of the host-level context-event stream: `session.blocked` and its
 * pairing `session.blocked.resolved`.
 *
 * WHY A SEPARATE FILE. The shared writer (`context-event-writer.ts`) is already at the architecture
 * ratchet's 800-line ceiling, and the adapters living there belong to other features' vocabulary.
 * This module owns the two blocked kinds end to end: the draft each event becomes, and the adapter
 * the composition root installs on `shared/ports/session-blocked-events.port.ts`.
 *
 * ONE KIND, THREE REASONS. The reason travels in `data.reason` (`approval` / `failed` /
 * `interrupted`) so the fleet can project one card class per value without a kind per class. The
 * identity a resolution names is `data.blockId`, `<sessionId>:<requestId|turnId>`.
 *
 * WRITE FAILURE NEVER REACHES THE TURN. A record seam that rejects, throws synchronously or answers
 * a non-`ok` result is counted and logged once per reason; `write` returns normally. That is the
 * same discipline the session-run and session-ask adapters follow, and it is load-bearing here:
 * the producers are the approval broker's server-request path and the driver's turn-settlement
 * path, neither of which may fail because the fleet's schema does not yet carry these kinds.
 *
 * FIXTURE SESSIONS NEVER REACH THE REAL HOME. A DoD/fixture scenario mints synthetic session ids
 * (`dod-*`, `fixture-*`, `synthetic-*`). The adapter cannot see where its `record` seam writes, so
 * a synthetic id is treated as fixture-only and refused BEFORE the seam unless the scenario
 * declares `fixtureHome` — an isolated fleet home, checked against the real `~/.quay-fleet` (and
 * an operator's `QUAY_FLEET_HOME`) and refused when it resolves to the real one. This is the same
 * discipline as ADR-003's "fixture HOME 隔离与清理": the fixture root is declared, never defaulted
 * to the real home. Real Cloudpit session ids are unaffected. The failure that motivated the guard
 * was a DoD run writing `dod-codex-blocked-*` rows through the production adapter into the real
 * `~/.quay-fleet/context/events/`, where the fleet upgraded them into ghost cards.
 *
 * Consumed by `server/index.ts` (the adapter installation) and the criterion
 * `tests/session-blocked-events.test.ts`.
 */
import os from 'node:os';
import path from 'node:path';

import type { SessionBlockedEventRecord } from '@/shared/ports/session-blocked-events.port.js';

import type { AppendContextEventResult, ContextEventDraft } from './context-event-writer.js';

/**
 * The append seam the adapter writes through. Production passes `contextEvents.record`; a
 * criterion passes its own recorder, and the criterion for the real JSONL shape passes a real
 * writer over a temporary events directory.
 */
export type SessionBlockedEventAppend = (
  draft: ContextEventDraft,
) => Promise<AppendContextEventResult | null>;

/** The adapter's reading: how many events landed, and why the rest did not. */
export type SessionBlockedEventWriterStatus = {
  /** Events the stream accepted (one line each). */
  written: number;
  /** Events the stream refused, threw on, or swallowed. Never thrown to the caller. */
  rejected: number;
  /** Rejections keyed by the writer's reason (`invalid-kind`, `schema-unavailable`, …). */
  rejectedByReason: Record<string, number>;
};

/** The adapter the composition root installs on the blocked-event port. */
export type SessionBlockedEventWriter = {
  write(event: SessionBlockedEventRecord): void;
  status(): SessionBlockedEventWriterStatus;
  /** Resolves once every append started so far has settled. Criteria and shutdown only. */
  settled(): Promise<void>;
};

/**
 * Turns one event into the stream draft.
 *
 * `session` and `at` are envelope fields; `reason`/`blockId` (and the arm-specific identity) go
 * under `data`, where the fleet's per-kind declarations read them. Optional members are only
 * written when the producer supplied them, so an approval row carries no `turnId` and a turn row
 * carries no `requestId`.
 */
export function toSessionBlockedEventDraft(event: SessionBlockedEventRecord): ContextEventDraft {
  if (event.kind === 'session.blocked.resolved') {
    return {
      kind: 'session.blocked.resolved',
      session: event.session,
      ...(event.at === undefined ? {} : { at: event.at }),
      data: { blockId: event.blockId },
    };
  }
  return {
    kind: 'session.blocked',
    session: event.session,
    ...(event.at === undefined ? {} : { at: event.at }),
    data: {
      reason: event.reason,
      blockId: event.blockId,
      ...(event.requestId === undefined ? {} : { requestId: event.requestId }),
      ...(event.toolName === undefined ? {} : { toolName: event.toolName }),
      ...(event.question === undefined ? {} : { question: event.question }),
      ...(event.turnId === undefined ? {} : { turnId: event.turnId }),
      ...(event.errorMessage === undefined ? {} : { errorMessage: event.errorMessage }),
    },
  };
}

/**
 * The marker a fixture/DoD scenario puts on a session id it synthesised, as opposed to a real
 * Cloudpit session (a UUID or ULID). The repository's DoD scenarios name their sessions `dod-*`
 * (`dod-codex-session`, `dod-codex-blocked-<epoch>`); `fixture-*` and `synthetic-*` are the same
 * declaration under other spellings.
 */
const FIXTURE_SESSION_ID = /(^|[-_.])(dod|fixture|synthetic)([-_.]|$)/i;

/** True when the session id declares itself a fixture rather than a real Cloudpit session. */
function isFixtureSession(session: string | null | undefined): boolean {
  return typeof session === 'string' && FIXTURE_SESSION_ID.test(session);
}

/** True when `parent` is `child` itself or one of its ancestors. */
function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * The fleet homes the real event stream can live in: the writer's `~/.quay-fleet` default and the
 * operator's `QUAY_FLEET_HOME` when set. A declared fixture home that overlaps either is the real
 * home under another name.
 */
function realFleetHomes(): string[] {
  const homes = [path.resolve(os.homedir(), '.quay-fleet')];
  const override = process.env.QUAY_FLEET_HOME?.trim();
  if (override) homes.push(path.resolve(override));
  return homes;
}

/**
 * Why a fixture-session append must be refused, or `null` when `fixtureHome` is a usable isolated
 * fleet home.
 *
 * `undefined` means the adapter was wired as production (no fixture declaration at all), where a
 * synthetic session id has no legitimate target — that refusal is what keeps a fixture run on the
 * production wiring out of the real stream. A declared home that is blank, or that overlaps the
 * real fleet home, is refused for the same reason: a fixture may only write somewhere the real
 * home is not.
 */
function readFixtureRefusal(
  fixtureHome: string | undefined,
): { reason: string; detail: string } | null {
  if (fixtureHome === undefined) {
    return {
      reason: 'fixture-session',
      detail: 'a synthetic session id needs a declared isolated fixtureHome; production wiring has none',
    };
  }
  const declared = fixtureHome.trim();
  if (declared === '') {
    return {
      reason: 'fixture-home-unset',
      detail: 'fixtureHome is blank; an isolated fleet home is mandatory',
    };
  }
  const resolved = path.resolve(declared);
  if (realFleetHomes().some((real) => containsPath(real, resolved) || containsPath(resolved, real))) {
    return {
      reason: 'fixture-home-is-real',
      detail: `fixtureHome ${JSON.stringify(declared)} is (or contains) the real fleet home; fixtures may only write to an isolated temporary home`,
    };
  }
  return null;
}

/** Builds the adapter that carries the two blocked kinds to the context stream. */
export function createSessionBlockedEventWriter(options: {
  record: SessionBlockedEventAppend;
  /** Debug sink for the first rejection of each reason; defaults to `console.debug`. */
  log?: (line: string) => void;
  /**
   * Declares this adapter a fixture/DoD scenario writing into an ISOLATED fleet home, never the
   * real `~/.quay-fleet`. Production omits it. While it is omitted, a synthetic session id is
   * refused before the record seam; when it is declared, the home is checked against the real one
   * and a blank or real value is refused the same way. No effect on real session ids.
   *
   * The value is a gate, not a destination: the caller still builds the writer/`record` seam over
   * that home (as the criterion does with a temporary directory). It exists so a fixture scenario
   * cannot reach the real stream by simply forgetting to isolate.
   */
  fixtureHome?: string;
}): SessionBlockedEventWriter {
  const log = options.log ?? ((line: string) => console.debug(line));
  const fixtureRefusal = readFixtureRefusal(options.fixtureHome);
  let written = 0;
  let rejected = 0;
  const rejectedByReason: Record<string, number> = {};
  const loggedReasons = new Set<string>();
  let tail: Promise<void> = Promise.resolve();

  const logOnce = (reason: string, detail: string): void => {
    if (loggedReasons.has(reason)) return;
    loggedReasons.add(reason);
    log(`[session-blocked-events] ${reason}: ${detail}`);
  };

  const append = async (event: SessionBlockedEventRecord): Promise<void> => {
    if (fixtureRefusal !== null && isFixtureSession(event.session)) {
      // Refused BEFORE the seam: a fixture run wired to production must not be able to leak a
      // row into the real stream at all, so this is not a post-hoc result check.
      rejected += 1;
      rejectedByReason[fixtureRefusal.reason] = (rejectedByReason[fixtureRefusal.reason] ?? 0) + 1;
      logOnce(
        fixtureRefusal.reason,
        `${fixtureRefusal.detail} (session ${JSON.stringify(event.session)})`,
      );
      return;
    }
    try {
      const result = await options.record(toSessionBlockedEventDraft(event));
      if (result !== null && result.ok) {
        written += 1;
        return;
      }
      const reason = result === null ? 'write-failed' : result.reason;
      const detail =
        result === null ? 'the context event stream swallowed the append' : result.detail;
      rejected += 1;
      rejectedByReason[reason] = (rejectedByReason[reason] ?? 0) + 1;
      logOnce(reason, detail);
    } catch (failure) {
      rejected += 1;
      rejectedByReason['write-failed'] = (rejectedByReason['write-failed'] ?? 0) + 1;
      logOnce('write-failed', failure instanceof Error ? failure.message : String(failure));
    }
  };

  return {
    write(event) {
      // The chain never stays rejected: one refused append must not wedge the next.
      try {
        tail = tail.then(() => append(event), () => undefined);
      } catch {
        // `then` itself cannot throw here, but the turn must never learn it if it somehow did.
      }
    },
    status: () => ({ written, rejected, rejectedByReason: { ...rejectedByReason } }),
    settled: () => tail.then(() => undefined),
  };
}
