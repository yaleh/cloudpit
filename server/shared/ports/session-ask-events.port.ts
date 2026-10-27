/**
 * The neutral accessor for the observation layer's session-ask event writer.
 *
 * WHY THIS FILE EXISTS. The observation producer (`modules/observation`) states
 * `session.asking` / `session.answered`, but the only real writer of those rows is the
 * host-level context-event stream (`modules/context-events`). The observation directory must
 * not import that sibling feature module (AC-394's cycle budget), and the producer is built at
 * module load — before `server/index.ts` has composed the stream. This port is the seam:
 * the composition root installs the real adapter, the producer reads it lazily at write time.
 *
 * FAIL CLOSED. An uninstalled port means "do not write": a process that never assembled the
 * composition root (a focused criterion, a display-only mount) has no evidence stream to
 * address, and inventing one would be worse than staying silent. A criterion that means to
 * exercise the writer installs a recorder of its own.
 *
 * Consumers: `modules/observation/session-digest-llm.ts` (the process-wide producer's
 * write-time read) and `server/index.ts` (the assembly that installs it). The file imports
 * only the event type, so it adds no edge back into `modules/**`.
 */
import type { SessionAskEvent } from '@/shared/types.js';

/** The installed writer shape: the observation seam's one verb. */
export type SessionAskEventWriterPort = {
  /** Appends one event. The real adapter counts failures instead of throwing. */
  write(event: SessionAskEvent): void;
};

/** The installed writer, or null before `server/index.ts` assembles the process. */
let installedSessionAskEventWriter: SessionAskEventWriterPort | null = null;

/**
 * Installs the process's session-ask event writer.
 *
 * Called by `server/index.ts` next to the other port installations. The last installation
 * wins so a focused criterion can swap in its own fixture.
 */
export function installSessionAskEventWriterPort(port: SessionAskEventWriterPort): void {
  installedSessionAskEventWriter = port;
}

/**
 * Reads the installed writer, or `null` before the composition root installs one — the
 * producer then writes nothing, which is the correct reading for a process with no stream.
 */
export function readSessionAskEventWriterPort(): SessionAskEventWriterPort | null {
  return installedSessionAskEventWriter;
}
