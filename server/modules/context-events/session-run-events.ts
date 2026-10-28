/**
 * The session-lifecycle half of the host-level context-event stream: `session.run.ended` and
 * `session.closed`.
 *
 * WHY A SEPARATE FILE. The shared writer (`context-event-writer.ts`) is already at 794 lines,
 * hard against the architecture ratchet's 800-line ceiling, and the two session-ask adapter
 * shapes there are a different feature's vocabulary. This module owns the two lifecycle kinds
 * end to end: the draft each event becomes, and the adapter the composition root installs on
 * `shared/ports/session-run-events.port.ts`.
 *
 * WRITE FAILURE NEVER REACHES THE CHAT. A record seam that rejects, throws synchronously or
 * answers a non-`ok` result is counted and logged once per reason; `write` returns normally.
 * That is the same discipline the session-ask adapter follows, and it is load-bearing here:
 * the producers are the run registry's terminal-frame path and the host manager's close path,
 * neither of which may fail because the fleet's schema does not yet carry these kinds.
 *
 * Consumed by `server/index.ts` (the adapter installation) and the criterion
 * `tests/session-run-events.test.ts`.
 */
import type {
  SessionClosedEvent,
  SessionRunEndedEvent,
  SessionRunEvent,
} from '@/shared/ports/session-run-events.port.js';
import { sessionRunOutcome } from '@/shared/ports/session-run-events.port.js';

import type { AppendContextEventResult, ContextEventDraft } from './context-event-writer.js';

// The outcome mapping is shared with the run registry, which states the event; re-export it so
// the lifecycle criterion reads every rule through this module.
export { sessionRunOutcome };

/**
 * The append seam the adapter writes through. Production passes `contextEvents.record`; a
 * criterion passes its own recorder, and the criterion for the real JSONL shape passes a real
 * writer over a temporary events directory.
 */
export type SessionRunEventRecord = (
  draft: ContextEventDraft,
) => Promise<AppendContextEventResult | null>;

/** The adapter's reading: how many events landed, and why the rest did not. */
export type SessionRunEventWriterStatus = {
  /** Events the stream accepted (one line each). */
  written: number;
  /** Events the stream refused, threw on, or swallowed. Never thrown to the caller. */
  rejected: number;
  /** Rejections keyed by the writer's reason (`invalid-kind`, `schema-unavailable`, …). */
  rejectedByReason: Record<string, number>;
};

/** The adapter the composition root installs on the session-run port. */
export type SessionRunEventWriter = {
  write(event: SessionRunEvent): void;
  status(): SessionRunEventWriterStatus;
  /** Resolves once every append started so far has settled. Criteria and shutdown only. */
  settled(): Promise<void>;
};

/**
 * Turns one event into the stream draft.
 *
 * `session` and `at` are envelope fields; `runId`/`outcome` (and `reason`) are kind-specific
 * and go under `data`, where the fleet's per-kind declarations read them.
 */
export function toSessionRunEventDraft(event: SessionRunEvent): ContextEventDraft {
  if (event.kind === 'session.run.ended') {
    return {
      kind: 'session.run.ended',
      session: event.session,
      at: event.at,
      data: { runId: event.runId, outcome: event.outcome },
    };
  }
  return {
    kind: 'session.closed',
    session: event.session,
    ...(event.at === undefined ? {} : { at: event.at }),
    data: { reason: event.reason },
  };
}

/** Builds the adapter that carries the two lifecycle kinds to the context stream. */
export function createSessionRunEventWriter(options: {
  record: SessionRunEventRecord;
  /** Debug sink for the first rejection of each reason; defaults to `console.debug`. */
  log?: (line: string) => void;
}): SessionRunEventWriter {
  const log = options.log ?? ((line: string) => console.debug(line));
  let written = 0;
  let rejected = 0;
  const rejectedByReason: Record<string, number> = {};
  const loggedReasons = new Set<string>();
  let tail: Promise<void> = Promise.resolve();

  const logOnce = (reason: string, detail: string): void => {
    if (loggedReasons.has(reason)) return;
    loggedReasons.add(reason);
    log(`[session-run-events] ${reason}: ${detail}`);
  };

  const append = async (event: SessionRunEvent): Promise<void> => {
    try {
      const result = await options.record(toSessionRunEventDraft(event));
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
        // `then` itself cannot throw here, but the chat turn must never learn it if it did.
      }
    },
    status: () => ({ written, rejected, rejectedByReason: { ...rejectedByReason } }),
    settled: () => tail.then(() => undefined),
  };
}

/**
 * The two drafts the producers state, kept here so a producer never assembles the stream
 * envelope itself (a second assembly would drift from `toSessionRunEventDraft`).
 */
export function sessionRunEnded(
  event: Omit<SessionRunEndedEvent, 'kind'>,
): SessionRunEndedEvent {
  return { kind: 'session.run.ended', ...event };
}

export function sessionClosed(event: Omit<SessionClosedEvent, 'kind'>): SessionClosedEvent {
  return { kind: 'session.closed', ...event };
}
