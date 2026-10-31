import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';

/**
 * Reads a Codex rollout together with the history it was forked from.
 *
 * WHY THIS EXISTS. `codex app-server`'s `thread/fork` does not always copy the
 * turns it keeps. When the source rollout was written in the CLI's `paginated`
 * history mode, the fork file contains just two rows — a `session_meta` naming
 * the source thread and an exclusive ordinal, and the thread settings — and the
 * turns live on in the source file. The CLI's own resume path follows that
 * pointer, so the fork is a real conversation; an app-side reader that opens
 * only the fork file sees an empty session and the user's history appears to
 * have vanished after an edit.
 *
 * Measured 2026-10-31 against the bundled `@openai/codex 0.166.0`:
 *
 *   fork file rows: 2
 *   session_meta.payload.forked_from_id: 01a18fa6-…
 *   session_meta.payload.forked_from_ordinal_exclusive: 129
 *   session_meta.payload.history_base: {thread_id, end_ordinal_exclusive: 129, end_byte_offset}
 *
 * The copy is exact: rows `ordinal < end_ordinal_exclusive` of the source are
 * the fork's prefix. This module exposes that prefix as lines in the same order
 * the fork's own rows follow, so every caller that already parses rollout JSONL
 * gets the whole conversation without a second parser.
 */

/** The source a fork's kept turns are read from. */
export type CodexForkPrefix = {
  /** Thread id of the rollout the prefix lives in. */
  baseThreadId: string;
  /** Rows of the source with `ordinal < endOrdinalExclusive` are the prefix. */
  endOrdinalExclusive: number;
  /** Byte cut of the same prefix, used when a source row carries no ordinal. */
  endByteOffset: number | null;
};

/** How many chained forks a reader follows before it gives up. */
const MAX_FORK_DEPTH = 8;

/** How many directory levels below `sessions/` a source rollout is searched for. */
const SESSIONS_SEARCH_DEPTH = 3;

/** How far up from a fork file the shared `sessions/` root may be. */
const SESSIONS_ROOT_LEVELS = 4;

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readOrdinal(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The fork pointer a rollout's first row carries, or `null` for an ordinary
 * transcript.
 *
 * `forked_from_ordinal_exclusive` is the stable field; `history_base` restates
 * it and adds the byte cut. Either alone is enough, so a protocol drift that
 * drops one still reads the prefix.
 */
export async function readCodexForkPrefix(filePath: string): Promise<CodexForkPrefix | null> {
  let firstLine: string | null = null;
  try {
    const stream = fs.createReadStream(filePath);
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (line.trim()) {
          firstLine = line;
          break;
        }
      }
    } finally {
      lines.close();
      stream.destroy();
    }
  } catch {
    return null;
  }

  if (firstLine === null) {
    return null;
  }

  let entry: Record<string, unknown>;
  try {
    entry = JSON.parse(firstLine) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (entry.type !== 'session_meta') {
    return null;
  }

  const payload = readRecord(entry.payload);
  if (!payload) {
    return null;
  }
  const historyBase = readRecord(payload.history_base);
  const baseThreadId = readNonEmptyString(payload.forked_from_id)
    ?? readNonEmptyString(historyBase?.thread_id);
  const endOrdinalExclusive = readOrdinal(payload.forked_from_ordinal_exclusive)
    ?? readOrdinal(historyBase?.end_ordinal_exclusive);
  if (!baseThreadId || endOrdinalExclusive === undefined || endOrdinalExclusive === 0) {
    return null;
  }

  return {
    baseThreadId,
    endOrdinalExclusive,
    endByteOffset: readOrdinal(historyBase?.end_byte_offset) ?? null,
  };
}

/** Depth-limited search for a file whose name ends with `suffix`. */
async function findFileWithSuffix(directory: string, suffix: string, depth: number): Promise<string | null> {
  let entries;
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  const subdirectories: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      subdirectories.push(path.join(directory, entry.name));
      continue;
    }
    if (entry.name.endsWith(suffix)) {
      return path.join(directory, entry.name);
    }
  }

  if (depth <= 0) {
    return null;
  }
  for (const subdirectory of subdirectories) {
    const match = await findFileWithSuffix(subdirectory, suffix, depth - 1);
    if (match) {
      return match;
    }
  }

  return null;
}

/**
 * The rollout file of `baseThreadId`, looked up under the same `sessions/` root
 * as the fork.
 *
 * A fork lands in today's date directory while its source may be days older, so
 * the search starts at the shared `sessions/` root rather than beside the fork.
 * Codex names every rollout `rollout-<timestamp>-<threadId>.jsonl`, which makes
 * the id a unique suffix.
 */
export async function resolveCodexForkBasePath(
  forkFilePath: string,
  baseThreadId: string,
): Promise<string | null> {
  const suffix = `-${baseThreadId}.jsonl`;
  let directory = path.dirname(forkFilePath);
  let sessionsRoot: string | null = null;
  for (let level = 0; level <= SESSIONS_ROOT_LEVELS; level += 1) {
    if (path.basename(directory) === 'sessions') {
      sessionsRoot = directory;
      break;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }

  if (sessionsRoot === null) {
    return null;
  }

  // The fork's own directory is checked first: a same-day fork is the common
  // case and skips the recursive walk.
  const beside = await findFileWithSuffix(path.dirname(forkFilePath), suffix, 0);
  if (beside) {
    return beside;
  }
  return findFileWithSuffix(sessionsRoot, suffix, SESSIONS_SEARCH_DEPTH);
}

/**
 * Yield one rollout's parsed lines, preceded by the prefix it was forked from.
 *
 * `maxOrdinalExclusive` bounds the WHOLE logical conversation: a chained fork
 * applies the tightest cut any level names, which is what keeps a fork of a
 * fork from resurrecting rows an earlier edit abandoned. `session_meta` rows are
 * dropped — they describe a file, not a turn, and the reader's per-turn state
 * must start from the first real row.
 */
async function* emitRolloutLines(
  filePath: string,
  maxOrdinalExclusive: number | null,
  depth: number,
  visited: Set<string>,
): AsyncGenerator<string> {
  if (depth > MAX_FORK_DEPTH || visited.has(filePath)) {
    return;
  }
  visited.add(filePath);

  const prefix = await readCodexForkPrefix(filePath);
  if (prefix) {
    const basePath = await resolveCodexForkBasePath(filePath, prefix.baseThreadId);
    if (basePath && basePath !== filePath) {
      const cut = maxOrdinalExclusive === null
        ? prefix.endOrdinalExclusive
        : Math.min(maxOrdinalExclusive, prefix.endOrdinalExclusive);
      yield* emitRolloutLines(basePath, cut, depth + 1, visited);
    }
  }

  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath);
  } catch {
    return;
  }
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let bytesSeen = 0;
    for await (const line of lines) {
      if (!line.trim()) {
        bytesSeen += Buffer.byteLength(line) + 1;
        continue;
      }
      let entry: Record<string, unknown>;
      try {
        entry = JSON.parse(line) as Record<string, unknown>;
      } catch {
        bytesSeen += Buffer.byteLength(line) + 1;
        continue;
      }
      if (entry.type === 'session_meta') {
        bytesSeen += Buffer.byteLength(line) + 1;
        continue;
      }
      if (maxOrdinalExclusive !== null) {
        const ordinal = readOrdinal(entry.ordinal);
        if (ordinal === undefined) {
          // A row with no ordinal cannot be placed against the cut. The byte
          // offset is the fallback signal measured on the same fork metadata;
          // without either, stopping is safer than appending a later turn.
          if (prefix?.endByteOffset === null || prefix?.endByteOffset === undefined) {
            break;
          }
        } else if (ordinal >= maxOrdinalExclusive) {
          break;
        }
      }
      yield line;
      bytesSeen += Buffer.byteLength(line) + 1;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

/**
 * Every rollout line of `filePath`, with a fork's inherited prefix in front of
 * its own rows, in the order the CLI itself would replay them.
 */
export async function* codexRolloutLines(filePath: string): AsyncGenerator<string> {
  yield* emitRolloutLines(filePath, null, 0, new Set());
}
