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
 * Consumed by `server/index.ts` (the adapter installation) and the criterion
 * `tests/session-blocked-events.test.ts`.
 */
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

/** Builds the adapter that carries the two blocked kinds to the context stream. */
export function createSessionBlockedEventWriter(options: {
  record: SessionBlockedEventAppend;
  /** Debug sink for the first rejection of each reason; defaults to `console.debug`. */
  log?: (line: string) => void;
}): SessionBlockedEventWriter {
  const log = options.log ?? ((line: string) => console.debug(line));
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
