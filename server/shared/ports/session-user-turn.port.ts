/**
 * The neutral notification seam for "a user message was sent to this session".
 *
 * WHY THIS FILE EXISTS. The observation layer states `session.answered` for a session's asks,
 * and the most reliable moment for that fact is the send itself — not the next turn-end, which
 * only arrives when the assistant finishes. The send path lives in `modules/websocket`, and
 * `modules/observation` must not import that sibling feature module (AC-394's cycle budget).
 * This port is the seam: the composition root installs the listener, the send path fires it,
 * and the observation producer reads nothing about chat.
 *
 * FIRE-AND-FORGET, FAIL-OPEN. The send path reports the event after the turn was admitted; a
 * listener that throws must never turn an accepted send into a failed one. The installed
 * listener therefore owns its own failure handling (the observation producer swallows errors).
 *
 * FAIL CLOSED. An uninstalled port means "nobody is listening": a process that never assembled
 * the composition root (a focused criterion, a display-only mount) has no observation layer to
 * notify, and inventing one would be worse than staying silent.
 *
 * Consumers: `modules/websocket/services/chat-control.service.ts` (the one shared send path) and
 * `server/index.ts` (the assembly that installs it). The file imports nothing, so it adds no
 * edge back into `modules/**`.
 */

/** The one fact the send path states: which session received a user message. */
export type SessionUserTurnEvent = {
  /** The app-level session id the user's message was sent to. */
  appSessionId: string;
  /**
   * The transcript id of the user's message, when the sender knows it.
   *
   * The send is admitted before the provider process writes the row, so the ordinary send path
   * cannot name it and leaves this absent. The observation producer still treats the send as the
   * answer's fact — the `session.answered` row then carries an empty message id rather than
   * waiting for a transcript that may lag — and an adapter that DOES know the id (a replay, a
   * test) supplies it here.
   */
  messageId?: string;
};

/** The installed listener shape. */
export type SessionUserTurnPort = {
  /** Reports one accepted user message. Must not throw into the send path. */
  onUserTurn(event: SessionUserTurnEvent): void;
};

/**
 * The process's listener slot.
 *
 * The one piece of mutable state this port owns lives in this object, not in a module-scope
 * binding: the composition root installs through it and the send path reads through it. The
 * last installation wins, so a focused criterion can swap in its own fixture.
 */
class SessionUserTurnPortSlot {
  private port: SessionUserTurnPort | null = null;

  /** Installs (or replaces) the process's user-turn listener. */
  install(port: SessionUserTurnPort): void {
    this.port = port;
  }

  /** Reads the installed listener, or `null` before the composition root installs one. */
  read(): SessionUserTurnPort | null {
    return this.port;
  }
}

const sessionUserTurnPortSlot = new SessionUserTurnPortSlot();

/** Installs the process's user-turn listener; called by `server/index.ts`. */
export function installSessionUserTurnPort(port: SessionUserTurnPort): void {
  sessionUserTurnPortSlot.install(port);
}

/** Reads the installed listener, or `null` before the composition root installs one. */
export function readSessionUserTurnPort(): SessionUserTurnPort | null {
  return sessionUserTurnPortSlot.read();
}
