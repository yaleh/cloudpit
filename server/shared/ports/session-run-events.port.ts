/**
 * The neutral seam for the two session-lifecycle events quay-fleet reads out of the
 * host-level context-event stream: `session.run.ended` and `session.closed`.
 *
 * WHY THIS FILE EXISTS. The facts live in two feature modules — the websocket module's run
 * registry knows when a turn reached its terminal frame, and the session-host manager knows
 * when a resident process was closed — while the only writer of those rows is
 * `modules/context-events`. A direct import from either producer into that sibling would be a
 * new cross-module edge (AC-394). This port is the seam: the composition root installs the
 * real adapter, and each producer reads it lazily at the moment the fact is true.
 *
 * FAIL CLOSED. An uninstalled port means "do not write": a process that never assembled the
 * composition root (a focused criterion, a display-only mount) has no evidence stream to
 * address, and inventing one would be worse than staying silent.
 *
 * NEVER THE CHAT'S PROBLEM. The port states the event, not the write: the installed adapter
 * owns its own failure handling and cannot throw into the producer's path. A stream that is
 * unavailable (no fleet install, a schema that predates the two kinds) is a counted reading
 * there, never a failed turn or a session that cannot close.
 *
 * Consumers: `modules/websocket/services/chat-run-registry.service.ts` (run end) and
 * `modules/session-hosts/session-host-manager.service.ts` plus
 * `modules/providers/services/sessions.service.ts` (session close), and `server/index.ts`
 * (the assembly that installs the adapter). The file defines its slot as a class instance and
 * imports nothing, so it adds no edge back into `modules/**` and no module-level mutable state.
 */

/** How a run ended, as the fleet's `session.run.ended` row reports it. */
export type SessionRunOutcome = 'completed' | 'aborted' | 'failed';

/** One completed run: which session, which run, how it ended, and when. */
export type SessionRunEndedEvent = {
  kind: 'session.run.ended';
  /** The CloudCLI application session id. */
  session: string;
  /** The run id the shared registry minted for this turn. */
  runId: string;
  /** `completed`, `aborted` at the person's request, or `failed` on an error frame. */
  outcome: SessionRunOutcome;
  /** ISO-8601 instant the run reached its terminal frame. */
  at: string;
};

/**
 * One closed session.
 *
 * `reason` is honest vocabulary rather than a normalized code: a host close reports the
 * manager's own `HostCloseReason` (`user`, `idle`, `exited`, `server-shutdown`, …), while a
 * row that was deleted or archived reports `deleted` / `archived`. The fleet reads the word it
 * was given instead of inferring why from the absence of later events.
 */
export type SessionClosedEvent = {
  kind: 'session.closed';
  /** The CloudCLI application session id. */
  session: string;
  /** Why the session is closed; see above. */
  reason: string;
  /** ISO-8601 instant the close happened. The writer mints it when absent. */
  at?: string;
};

/** One event as a producer states it. */
export type SessionRunEvent = SessionRunEndedEvent | SessionClosedEvent;

/**
 * Maps a terminal run reading onto the fleet's outcome word.
 *
 * `aborted` wins over an error frame: a person who stopped a turn may also have seen an error
 * frame before the stop, and the stop is the fact they caused. A completed run that forwarded
 * an error frame is `failed`; without one it is `completed`.
 *
 * It lives with the vocabulary rather than in either producer because both the registry (which
 * states the event) and the context-events adapter (which tests the mapping) read the same
 * rule; a second copy is exactly how the two would drift.
 */
export function sessionRunOutcome(
  status: 'completed' | 'aborted',
  error: string | null,
): SessionRunOutcome {
  if (status === 'aborted') return 'aborted';
  return error === null ? 'completed' : 'failed';
}

/** The installed writer shape: the seam's one verb. */
export type SessionRunEventWriterPort = {
  /** Appends one event. The real adapter counts failures instead of throwing. */
  write(event: SessionRunEvent): void;
};

/**
 * The process's writer slot.
 *
 * The one piece of mutable state this port owns lives in this object: the composition root
 * installs through it and the producers read through it. The last installation wins so a
 * focused criterion can swap in its own fixture.
 */
class SessionRunEventWriterPortSlot {
  private port: SessionRunEventWriterPort | null = null;

  /** Installs (or replaces, or with `null` removes) the process's session-run event writer. */
  install(port: SessionRunEventWriterPort | null): void {
    this.port = port;
  }

  /** Reads the installed writer, or `null` before the composition root installs one. */
  read(): SessionRunEventWriterPort | null {
    return this.port;
  }
}

const sessionRunEventWriterPortSlot = new SessionRunEventWriterPortSlot();

/**
 * Installs the process's session-run event writer; called by `server/index.ts`.
 *
 * `null` removes it, which a criterion uses to leave the process-wide slot as it found it
 * rather than leaving a dead adapter pointed at a directory it is about to delete.
 */
export function installSessionRunEventWriterPort(
  port: SessionRunEventWriterPort | null,
): void {
  sessionRunEventWriterPortSlot.install(port);
}

/** Reads the installed writer, or `null` before the composition root installs one. */
export function readSessionRunEventWriterPort(): SessionRunEventWriterPort | null {
  return sessionRunEventWriterPortSlot.read();
}
