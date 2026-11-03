// Transport/busy-window tuning constants used by the connection orchestrator.


/** How often a spoken instruction re-tries a session that is mid-turn. */
export const BUSY_RETRY_INTERVAL_MS = 2_000;
/** How long it keeps trying before giving up and saying so. A turn longer than this is not waited out. */
export const BUSY_RETRY_MAX_MS = 120_000;

/**
 * How often a held merged message re-reads the host's `busy` reading so the words leave the moment
 * the run does (ruling 2026-10-14; see {@link VoiceRealtimeProxySeams.busyPollMs}).
 *
 * Well under the S-A rate window on purpose: this poll decides when the person's words are DELIVERED,
 * not how often a line is drawn, and a quarter second is the point past which "Claude finished" and
 * "my sentence went in" would read as two separate events. It is armed only while something is held,
 * so its cost is bounded by the wait it is watching.
 */
export const VOICE_REALTIME_BUSY_POLL_MS = 250;

/**
 * How long the upstream must have been QUIET before a held merged message is released into the
 * running turn instead of waiting for it to end (X3' replay, 2026-10-15; see
 * {@link VoiceRealtimeProxySeams.busyQuietWindowMs}).
 *
 * `2000` is the middle of the window the replay's D arm measured: releasing on "the person stopped
 * speaking" rather than on "the run ended" moved the delivery delay's p90 from 18.5 s (A) / 10.8 s
 * (B) to 1.6 s, and the first reaction's p90 from 22.5 s / 14.0 s to 8.4 s, on the same 84 readings.
 * The number is the replay's own `lastStop + 2000`, kept rather than re-derived.
 */
export const VOICE_BUSY_QUIET_WINDOW_MS = 2000;

/**
 * The floor under the quiet window: no release lands sooner than this after the LAST held piece
 * joined the buffer, however quiet the upstream already was.
 *
 * Without it a piece relayed into an ALREADY-quiet session would leave on the very next tick, which
 * is the 1 s coalescing window's job done badly — a sentence the endpoint cut into two pieces would
 * go in as two messages. `800` is the replay's own `lastPiece + 800`.
 */
export const VOICE_BUSY_QUIET_SINCE_PIECE_MS = 800;

/**
 * The ceiling on a busy hold, counted from its FIRST piece: at this point the merged message is
 * released whether or not the person ever stopped talking.
 *
 * `20000` is the replay's own `buf[0] + 20_000`. It exists because the quiet window is only as
 * reliable as the upstream's turn reporting: an endpoint that never closes its turn (the stall the
 * 2026-10-15 00:08 reading recorded) would otherwise hold a person's words for the whole run.
 */
export const VOICE_BUSY_QUIET_CAP_MS = 20_000;

/**
 * The tier the busy quiet window's release writes its one merged message under — `next`, so the frame
 * is merged into the turn in flight at its next tool boundary instead of queueing behind it.
 *
 * THE OTHER HALF OF THE SAME MEASUREMENT. The replay's C, D and E arms shared one window and differed
 * only in priority: `now` pre-empted the turn (2/16 `error_during_execution`, both zero-output turns)
 * and `later` (the tier every other busy write uses) waited the turn out. `next` is the tier that
 * neither cuts the turn nor waits for it. Kept as a literal here rather than imported from the host
 * driver's `HostInputPriority`: the relay speaks the CLI's vocabulary on the wire, and importing the
 * provider module would drag the whole provider registry into a lean, offline-provable seam.
 */
export const VOICE_BUSY_RELEASE_PRIORITY = 'next';

/**
 * Which of the two ways a BUSY hold ended asked for the delivery. Only the quiet window's release
 * carries {@link VOICE_BUSY_RELEASE_PRIORITY}; the run ending needs no tier (there is no turn left to
 * queue behind), and the interrupt/teardown releases are the person's own stop, not this window's.
 *
 * Declared at module scope, and not exported, because it is this file's own accounting of a release:
 * the journal line is the only reader, and a criterion reads the line, not the value.
 */
export type VoiceBusyRelease = 'run-end' | 'quiet-window';


/**
 * The default bound on the uplink VAD's exit-path wait (§6.3): how long the connection lets the
 * endpoint commit, transcribe and (ideally) relay the last utterance before the socket goes.
 *
 * A WAIT, not a sleep: the exit resolves the moment BOTH the `committed` and the final transcription
 * have arrived and only times out when they do not (an exit with nothing said times out, which is the
 * benign branch §6.4 describes). 1.5 s bounds how long a person waits for the session to close.
 */
export const UPLINK_VAD_EXIT_WAIT_MS = 1_500;
