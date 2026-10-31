/**
 * The neutral seam for the two "a Codex resident session is blocked / needs a person" context
 * events quay-fleet reads out of the host-level stream: `session.blocked` and its pairing
 * `session.blocked.resolved`.
 *
 * WHY THIS FILE EXISTS. The facts live in two places — the Codex approval broker knows when a
 * server request parks a turn on a person, and the Codex host driver knows when a turn settled
 * `failed`/`interrupted` — while the only writer of those rows is `modules/context-events`. A
 * direct import from either producer into that sibling would be a new cross-module edge (AC-394).
 * This port is the seam: the composition root installs the real adapter, and each producer reads
 * it lazily at the moment the fact is true.
 *
 * ONE KIND, THREE REASONS. The fleet projects the row onto three card classes by `data.reason`
 * (`approval` → need, `failed` → fix, `interrupted` → stuck), so a consumer that only knows
 * `session.blocked` loses no information. `blockId` (`<sessionId>:<requestId|turnId>`) is the
 * dedup and resolution key: a `session.blocked.resolved` carrying the same id withdraws the card.
 *
 * FAIL CLOSED. An uninstalled port means "do not write": a process that never assembled the
 * composition root (a focused criterion, a display-only mount) has no evidence stream to address,
 * and inventing one would be worse than staying silent.
 *
 * NEVER THE TURN'S PROBLEM. The port states the event, not the write: the installed adapter owns
 * its own failure handling and cannot throw into the producer's path. A stream that is unavailable
 * (no fleet install, a schema predating the kinds) is a counted reading there, never a failed turn.
 *
 * Consumers: `modules/providers/list/codex/codex-approval-broker.ts` (approval park/resolve),
 * `modules/providers/list/codex/codex-resident-blocked-events.ts` (turn failed/interrupted and
 * session close), and `server/index.ts` (the assembly that installs the adapter). The file defines
 * its slot as a class instance and imports nothing, so it adds no edge back into `modules/**` and
 * no module-level mutable state.
 */

/** Why a session is blocked; the fleet derives one card class per reason. */
export type SessionBlockedReason = 'approval' | 'failed' | 'interrupted';

/**
 * One blocked session.
 *
 * `session` is the CloudCLI application session id. `blockId` is `<sessionId>:<requestId|turnId>`
 * and is the identity a later `session.blocked.resolved` names. The approval arm carries
 * `requestId`/`toolName` (plus `question` when the protocol states one); the turn arm carries
 * `turnId` (plus `errorMessage` on `failed` only).
 */
export type SessionBlockedEvent = {
  kind: 'session.blocked';
  session: string;
  reason: SessionBlockedReason;
  blockId: string;
  requestId?: string;
  toolName?: string;
  question?: string;
  turnId?: string;
  errorMessage?: string;
  /** ISO-8601 instant the block was observed. The writer mints it when absent. */
  at?: string;
};

/** The withdrawal of one `session.blocked`: same `session` and the same `blockId`. */
export type SessionBlockedResolvedEvent = {
  kind: 'session.blocked.resolved';
  session: string;
  blockId: string;
  /** ISO-8601 instant the block was cleared. The writer mints it when absent. */
  at?: string;
};

/** One event as a producer states it. */
export type SessionBlockedEventRecord = SessionBlockedEvent | SessionBlockedResolvedEvent;

/** The installed writer shape: the seam's one verb. */
export type SessionBlockedEventWriterPort = {
  /** Appends one event. The real adapter counts failures instead of throwing. */
  write(event: SessionBlockedEventRecord): void;
};

/**
 * The process's writer slot.
 *
 * The one piece of mutable state this port owns lives in this object: the composition root
 * installs through it and the producers read through it. The last installation wins so a focused
 * criterion can swap in its own fixture.
 */
class SessionBlockedEventWriterPortSlot {
  private port: SessionBlockedEventWriterPort | null = null;

  /** Installs (or replaces, or with `null` removes) the process's blocked-event writer. */
  install(port: SessionBlockedEventWriterPort | null): void {
    this.port = port;
  }

  /** Reads the installed writer, or `null` before the composition root installs one. */
  read(): SessionBlockedEventWriterPort | null {
    return this.port;
  }
}

const sessionBlockedEventWriterPortSlot = new SessionBlockedEventWriterPortSlot();

/**
 * Installs the process's blocked-event writer; called by `server/index.ts`.
 *
 * `null` removes it, which a criterion uses to leave the process-wide slot as it found it rather
 * than leaving a dead adapter pointed at a directory it is about to delete.
 */
export function installSessionBlockedEventWriterPort(
  port: SessionBlockedEventWriterPort | null,
): void {
  sessionBlockedEventWriterPortSlot.install(port);
}

/** Reads the installed writer, or `null` before the composition root installs one. */
export function readSessionBlockedEventWriterPort(): SessionBlockedEventWriterPort | null {
  return sessionBlockedEventWriterPortSlot.read();
}
