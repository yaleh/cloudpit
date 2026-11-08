import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readLastTranscriptRecord } from '../transcript/transcript-activity.js';
import type { AnyRecord } from '../types/index.js';
import { readObjectRecord } from './providers.js';

// ---------------------------
//----------------- SESSION SYNCHRONIZER TITLE HELPERS ------------
/**
 * Produces a compact session title suitable for UI rendering and DB storage.
 *
 * Use this when converting provider-native names into a consistent title value.
 * The helper collapses repeated whitespace, trims the result, and truncates it
 * to 120 characters so every provider writes stable and bounded metadata.
 * If the normalized input is empty, it returns the supplied fallback title.
 */
export function normalizeSessionName(rawValue: string | undefined, fallback: string): string {
  const normalized = (rawValue ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 120);
}

// ---------------------------
//----------------- PROVIDER SESSION VALUE NORMALIZATION UTILITIES ------------
/**
 * Converts provider-native timestamps into ISO strings.
 *
 * Provider CLIs commonly persist epoch timestamps as milliseconds, seconds, or
 * already-formatted date strings. Use this helper when normalizing session
 * metadata or transcript events so every provider writes the same ISO timestamp
 * shape to API responses and database rows.
 */
export function normalizeProviderTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const millis = value < 1_000_000_000_000 ? value * 1000 : value;
    return new Date(millis).toISOString();
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return normalizeProviderTimestamp(parsed);
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return new Date().toISOString();
}

/** Parses a JSON string or narrows an existing object into a plain record, or `null`. */
export function readJsonRecord(value: unknown): AnyRecord | null {
  if (typeof value !== 'string') {
    return readObjectRecord(value);
  }

  try {
    return readObjectRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

// ---------------------------
//----------------- OPENCODE SESSION STORAGE UTILITIES ------------
/**
 * Resolves the OpenCode SQLite session database path.
 *
 * OpenCode stores session, message, part, and project metadata in one shared
 * `opencode.db` file under its XDG data directory. Provider readers and
 * synchronizers should use this path for read-only access and should never store
 * it as a deletable transcript path for an individual app session row.
 */
export function getOpenCodeDatabasePath(): string {
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
}

/**
 * Decodes an OpenCode text payload that was persisted as a JSON string literal.
 *
 * OpenCode can store the first user prompt (and other text parts) as `"hello"`
 * instead of `hello`. Used by both the OpenCode session reader (transcript
 * history) and the OpenCode synchronizer (session titling) so a session name or
 * message body never surfaces with surrounding quote characters. Only fully
 * quoted, valid JSON string literals are unwrapped; ordinary prose that merely
 * happens to start/end with a quote is returned untouched.
 */
export function unwrapJsonStringLiteral(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return value;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'string' ? parsed : value;
  } catch {
    return value;
  }
}

// ---------------------------
//----------------- SAFE DIRECTORY NAME UTILITIES ------------
/**
 * Validates that a user or provider supplied identifier can safely be treated
 * as one leaf directory name under an existing root folder.
 *
 * Use this before composing paths like `<root>/<session-id>/file.db>` to block
 * path traversal and accidental nested paths. The returned string is trimmed but
 * otherwise unchanged so callers can still match the provider's on-disk naming.
 */
export function sanitizeLeafDirectoryName(inputName: string, label = 'directory name'): string {
  const normalized = inputName.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  if (
    normalized.includes('..')
    || normalized.includes(path.posix.sep)
    || normalized.includes(path.win32.sep)
    || normalized !== path.basename(normalized)
  ) {
    throw new Error(`Invalid ${label} "${inputName}".`);
  }

  return normalized;
}

// ---------------------------
//----------------- SESSION SYNCHRONIZER FILESYSTEM HELPERS ------------
/**
 * Recursively discovers files that match one extension, with optional incremental filtering.
 *
 * Provider synchronizers call this to find transcript artifacts under provider
 * home directories. Pass `lastScanAt` to include files the previous scan could
 * not have seen, or pass `null` to perform a full rescan. Missing directories
 * are treated as empty because not every provider exists on every machine.
 *
 * A file is "new to this scan" when EITHER its birthtime or its mtime is after
 * the cursor. The birthtime half covers transcripts created since the previous
 * scan. The mtime half covers the restart gap: a session that already existed
 * can have rows appended while this server was down, and `birthtime` never
 * moves for it. Without the mtime half such a file is invisible to the startup
 * scan for the rest of its life — the watcher is `ignoreInitial: true` and
 * cannot replay the downtime either — so the appended turn never reaches the
 * database or the sidebar.
 *
 * Re-reading a modified file is idempotent (every synchronizer upserts by
 * provider session id) and is what an incremental scan is allowed to cost: the
 * set is bounded by files changed since the cursor, not by the corpus size.
 * Activity time is NOT taken from this mtime; each provider reads it from the
 * transcript content (see `readTranscriptLastActivity`), so a touch or a copy
 * that changes no content re-indexes the file without moving last activity.
 */
export async function findFilesRecursivelyCreatedAfter(
  rootDir: string,
  extension: string,
  lastScanAt: Date | null,
  fileList: string[] = []
): Promise<string[]> {
  try {
    const entries = await readdir(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);

      if (entry.isDirectory()) {
        await findFilesRecursivelyCreatedAfter(fullPath, extension, lastScanAt, fileList);
        continue;
      }

      if (!entry.isFile() || !entry.name.endsWith(extension)) {
        continue;
      }

      if (!lastScanAt) {
        fileList.push(fullPath);
        continue;
      }

      const fileStat = await stat(fullPath);
      if (fileStat.birthtime > lastScanAt || fileStat.mtime > lastScanAt) {
        fileList.push(fullPath);
      }
    }
  } catch {
    // Missing provider folders are expected in first-run or partial setups.
  }

  return fileList;
}

/**
 * Reads file creation/update timestamps and maps them to DB-friendly ISO strings.
 *
 * Session indexers use this to persist `created_at` and `updated_at` metadata
 * when upserting sessions. If the file cannot be read, an empty object is
 * returned so indexing can continue for other files.
 */
export async function readFileTimestamps(
  filePath: string
): Promise<{ createdAt?: string; updatedAt?: string }> {
  try {
    const fileStat = await stat(filePath);
    return {
      createdAt: fileStat.birthtime.toISOString(),
      updatedAt: fileStat.mtime.toISOString(),
    };
  } catch {
    return {};
  }
}

/**
 * Reads the newest activity time a transcript's own content records.
 *
 * Session indexers must not take a session's "last activity" from the
 * transcript's mtime. A file's mtime moves for reasons that are not user
 * activity — a CLI flushing bookkeeping records, an external process rewriting
 * or restoring the file — so a session idle for days can be shown as active
 * minutes ago. The records that do describe activity are the ones carrying a
 * `timestamp`, which is what this helper returns.
 *
 * Only a bounded tail window is read, growing from
 * `TRANSCRIPT_ACTIVITY_INITIAL_WINDOW_BYTES` to
 * `TRANSCRIPT_ACTIVITY_MAX_WINDOW_BYTES` in `@/shared/transcript-activity.js`:
 * the newest activity is at the end of the file, and transcripts reach hundreds
 * of megabytes, so walking the whole file line by line is not an option. Within
 * a window the lines are walked backwards, and the first parseable record with a
 * usable `timestamp` wins.
 *
 * Returns the record's timestamp string exactly as stored, or null when no
 * record in the scanned window carries one. Callers must fall back to a
 * filesystem timestamp on null: a transcript that was just created has no
 * records yet, and it still needs an activity time. A missing or unreadable
 * file also returns null rather than throwing, so one bad transcript cannot
 * abort a scan.
 */
export async function readTranscriptLastActivity(filePath: string): Promise<string | null> {
  return readLastTranscriptRecord(filePath, readRecordedTimestamp);
}

/**
 * Reads the activity timestamp one transcript record carries, if it carries one.
 *
 * A value the database layer cannot parse would be written as
 * `CURRENT_TIMESTAMP` — i.e. "active just now", the exact reading this helper
 * exists to stop — so an unparseable `timestamp` is treated as no timestamp and
 * the walk continues to an older record.
 */
function readRecordedTimestamp(record: unknown): string | null {
  const value = readObjectRecord(record)?.timestamp;
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

