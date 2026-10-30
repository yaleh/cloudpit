/**
 * Reads BACK the two session-ask kinds from the context-event stream.
 *
 * The writer beside this file is the CloudCLI producer's only route into
 * `~/.quay-fleet/context/events/<day>.jsonl`. This reader is the boot-time consumer: it answers
 * which asks this host stated as `session.asking` and never followed with `session.answered`.
 *
 * WHY IT EXISTS. The observation layer's ask ledger lives inside a session digest, so a session
 * whose digest revision was never written (the LLM summary was still in flight when the process
 * died, the session was written before the ledger existed) has no record of its open ask. The
 * stream does: every `session.asking` row was appended when the ask was stated. Rebuilding the
 * ledger from the stream is what makes 「未结束的提问」 independent of whether a digest write
 * happened at all.
 *
 * READ-ONLY, TOLERANT, BOUNDED. It never writes a fleet file, never throws, and reads only day
 * files inside the lookback window. Rows from another producer (`source !== 'cloudcli'`) are
 * somebody else's facts and are ignored.
 *
 * Consumers: `server/modules/observation/session-digest.producer.ts` (the startup sweep's ledger
 * rebuild) and `tests/session-ask-decision-digest.test.ts`.
 */
import { readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** The only producer whose rows this host may rebuild its own ledger from. */
const CLOUDCLI_SOURCE = 'cloudcli';

/** The three kinds this reader understands; every other row is somebody else's business. */
const SESSION_ASK_KINDS = new Set(['session.asking', 'session.answered', 'session.asking.retracted']);

/** How far back the rebuild looks; an older ask is no longer worth a boot-time model-free pass. */
export const DEFAULT_SESSION_ASK_LOOKBACK_DAYS = 7;

const DAY_FILE = /^(\d{4})-(\d{2})-(\d{2})\.jsonl$/;

/** One ask the stream still shows open: stated, never answered. */
export type OpenSessionAsk = {
  /** `<sessionId>:<first asking message id>` — the fleet's dedup key. */
  askId: string;
  sessionId: string;
  /** The assistant message the question came from. */
  messageId: string;
  /** The highest revision the stream stated for this ask. */
  revision: number;
  project: string;
  /** The first `session.asking` row's timestamp, so callers can order the rebuild. */
  askedAt: string;
};

/** What the reader needs from the world; production supplies every default. */
export type ReadOpenSessionAsksOptions = {
  /** The stream directory. Defaults to `~/.quay-fleet/context/events`. */
  eventsDir?: string;
  /** The clock the lookback window is measured from. Defaults to `Date.now`. */
  nowMs?: number;
  /** Days of stream to read. Defaults to {@link DEFAULT_SESSION_ASK_LOOKBACK_DAYS}. */
  lookbackDays?: number;
};

type AskRow = { row: Record<string, unknown>; at: number };

function recordOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Milliseconds for an ISO timestamp, or `null` when it does not parse. */
function timeOf(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The UTC midnight of the day `ms` falls on, in milliseconds. */
function dayStart(ms: number): number {
  return Math.floor(ms / 86_400_000) * 86_400_000;
}

/** The day files inside the window, oldest first. A file name is the row's own day. */
async function dayFiles(eventsDir: string, cutoffMs: number): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(eventsDir);
  } catch {
    return [];
  }
  const files: Array<{ name: string; day: number }> = [];
  for (const name of entries) {
    const match = DAY_FILE.exec(name);
    if (match === null) continue;
    const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (!Number.isFinite(day) || day < dayStart(cutoffMs)) continue;
    files.push({ name, day });
  }
  return files.sort((left, right) => left.day - right.day).map((file) => path.join(eventsDir, file.name));
}

/** Parses one day file into rows the rebuild cares about, in file order. */
async function readDay(file: string, cutoffMs: number): Promise<AskRow[]> {
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return [];
  }
  const rows: AskRow[] = [];
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // A torn last line is a write in flight, not this reader's failure.
      continue;
    }
    const row = recordOf(parsed);
    if (row === null) continue;
    if (row.source !== CLOUDCLI_SOURCE) continue;
    if (typeof row.kind !== 'string' || !SESSION_ASK_KINDS.has(row.kind)) continue;
    const at = timeOf(row.at);
    if (at === null || at < cutoffMs) continue;
    const data = recordOf(row.data);
    if (data === null || textOf(data.askId) === '') continue;
    rows.push({ row, at });
  }
  return rows;
}

/**
 * Every ask this host still shows open, within the lookback window.
 *
 * A `session.answered` row settles its askId wherever it sits in the window: the answer may
 * arrive in a later day file than the question, and the sweep must not re-state it. A
 * `session.asking.retracted` row closes the ask the same way — it is this host's own statement
 * that the ask was never a question — so a withdrawn ask is never rebuilt into a ledger nor
 * offered to the retraction check again. The ONE exception is a later `session.asking` for the
 * same askId (a real re-ask in a later span): an asking row newer than the closing row reopens
 * the ask, which is why the closing is compared by time rather than treated as permanent.
 */
export async function readOpenSessionAsks(
  options: ReadOpenSessionAsksOptions = {},
): Promise<OpenSessionAsk[]> {
  const nowMs = options.nowMs ?? Date.now();
  const lookbackDays = options.lookbackDays ?? DEFAULT_SESSION_ASK_LOOKBACK_DAYS;
  const eventsDir = options.eventsDir ?? path.join(os.homedir(), '.quay-fleet', 'context', 'events');
  const cutoffMs = nowMs - lookbackDays * 86_400_000;

  const asks = new Map<string, OpenSessionAsk>();
  /** The newest asking row per askId, so a re-ask after a closing reopens it. */
  const lastAskingAt = new Map<string, number>();
  /** The moment each ask was answered or retracted. */
  const closedAt = new Map<string, number>();

  for (const file of await dayFiles(eventsDir, cutoffMs)) {
    for (const { row, at } of await readDay(file, cutoffMs)) {
      const data = recordOf(row.data) ?? {};
      const askId = textOf(data.askId);
      if (row.kind === 'session.answered' || row.kind === 'session.asking.retracted') {
        closedAt.set(askId, Math.max(closedAt.get(askId) ?? 0, at));
        continue;
      }
      const sessionId = textOf(row.session);
      if (sessionId === '') continue;
      const previousAskingAt = lastAskingAt.get(askId) ?? 0;
      if (at > previousAskingAt) lastAskingAt.set(askId, at);
      const revision = typeof data.revision === 'number' && Number.isFinite(data.revision) ? data.revision : 1;
      const previous = asks.get(askId);
      if (previous === undefined) {
        asks.set(askId, {
          askId,
          sessionId,
          messageId: textOf(data.messageId),
          revision,
          project: textOf(row.project),
          askedAt: new Date(at).toISOString(),
        });
        continue;
      }
      // A re-ask keeps the ask identity (and the first asking message) and bumps the revision.
      if (revision > previous.revision) {
        previous.revision = revision;
        // The newest asking row is the message the latest revision names.
        const messageId = textOf(data.messageId);
        if (messageId !== '') previous.messageId = messageId;
      }
    }
  }

  return [...asks.values()]
    .filter((ask) => {
      const closed = closedAt.get(ask.askId);
      if (closed === undefined) return true;
      // Reopened only by an asking row that arrived AFTER the closing row.
      return (lastAskingAt.get(ask.askId) ?? 0) > closed;
    })
    .sort((left, right) => left.askedAt.localeCompare(right.askedAt));
}

/**
 * The assistant message ids this host has RETRACTED, read from the shared stream.
 *
 * This is the local suppression's input: a fleet card whose `contentRef.messageId` is in this
 * set was built from a mis-stated ask and must not reach the wall. It is deliberately keyed by
 * MESSAGE id, not session, and it never consults the observation store — a session with no
 * observation object at all (no digest revision was ever written) still names its withdrawn
 * card here, which is the whole reason the retraction lives in the shared stream rather than in
 * a ledger.
 */
export async function readRetractedSessionAskMessageIds(
  options: ReadOpenSessionAsksOptions = {},
): Promise<Set<string>> {
  const nowMs = options.nowMs ?? Date.now();
  const lookbackDays = options.lookbackDays ?? DEFAULT_SESSION_ASK_LOOKBACK_DAYS;
  const eventsDir = options.eventsDir ?? path.join(os.homedir(), '.quay-fleet', 'context', 'events');
  const cutoffMs = nowMs - lookbackDays * 86_400_000;

  const messageIds = new Set<string>();
  for (const file of await dayFiles(eventsDir, cutoffMs)) {
    for (const { row } of await readDay(file, cutoffMs)) {
      if (row.kind !== 'session.asking.retracted') continue;
      const data = recordOf(row.data) ?? {};
      const messageId = textOf(data.messageId);
      if (messageId !== '') messageIds.add(messageId);
    }
  }
  return messageIds;
}
