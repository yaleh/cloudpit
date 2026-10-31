import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

/**
 * The tail window the transcript tail walk starts from, and the ceiling it
 * may grow to.
 *
 * A transcript ends with a run of bookkeeping records — `last-prompt`,
 * `cost-state`, `mode`, `permission-mode`, `atis-latch` — that carry no
 * `timestamp`, so the newest real activity can sit well behind the end of the
 * file. Measured over one machine's corpus (1189 transcripts): a 64 KiB window
 * answered 1144 of them, 256 KiB answered 37 more, and 512 KiB answered the
 * last 6. The two that no window answers are ~700-byte files that record no
 * activity at all, so nothing on that corpus asked to look further back than
 * the ceiling. Starting small keeps the common case to one 64 KiB read; the
 * ceiling stops a pathological file from turning a sidebar refresh into a
 * whole-file read, and keeps one synchronizer pass over a large transcript
 * inside the byte budget its callers are held to.
 */
const TRANSCRIPT_ACTIVITY_INITIAL_WINDOW_BYTES = 64 * 1024;
const TRANSCRIPT_ACTIVITY_MAX_WINDOW_BYTES = 512 * 1024;

/**
 * Reads the newest tail record one transcript's content contains, as chosen by `select`.
 *
 * This is the bounded tail walk `readTranscriptLastActivity` is built on. A
 * provider whose activity semantics are richer than "the record carries a
 * `timestamp`" (Codex distinguishes conversation/turn rows from bookkeeping
 * rows) supplies its own `select` and gets the same bounded, backwards,
 * short-read-tolerant reading instead of a second copy of this machinery.
 *
 * `select` returns the value to report for a record, or `null` when the record
 * is not evidence of the thing being asked about — the walk then continues to
 * an older record. The window growth, half-line handling and null-on-unreadable
 * contract are exactly `readTranscriptLastActivity`'s; see that function's
 * documentation for why each exists.
 */
export async function readLastTranscriptRecord<T>(
  filePath: string,
  select: (record: unknown) => T | null
): Promise<T | null> {
  let handle: FileHandle | undefined;

  try {
    handle = await open(filePath, 'r');

    const { size } = await handle.stat();
    if (size <= 0) {
      return null;
    }

    let windowBytes = Math.min(TRANSCRIPT_ACTIVITY_INITIAL_WINDOW_BYTES, size);
    let windowStart = size - windowBytes;
    let window = await readFileRange(handle, windowStart, windowBytes);

    for (;;) {
      const selected = findLastSelectedRecord(
        window.toString('utf8'),
        await startsMidLine(handle, windowStart),
        select
      );
      if (selected !== null) {
        return selected;
      }

      // The window already covered the whole file, so the transcript holds no
      // selected record at all; enlarging it further cannot change that.
      if (windowStart === 0 || windowBytes >= TRANSCRIPT_ACTIVITY_MAX_WINDOW_BYTES) {
        return null;
      }

      // Widening reads only the bytes the window does not already hold: the
      // newest record usually sits in the first window, and a transcript that
      // needs the ceiling should cost one read of the ceiling rather than the
      // sum of every window on the way there.
      const widenedBytes = Math.min(windowBytes * 4, TRANSCRIPT_ACTIVITY_MAX_WINDOW_BYTES, size);
      const widenedStart = size - widenedBytes;
      const prefix = await readFileRange(handle, widenedStart, windowStart - widenedStart);
      if (prefix.length === 0) {
        // The file shrank under the scan, so there is nothing older to read
        // and the window that was already searched is all this file has.
        return null;
      }

      window = Buffer.concat([prefix, window]);
      windowStart -= prefix.length;
      windowBytes = window.length;
    }
  } catch {
    return null;
  } finally {
    try {
      await handle?.close();
    } catch {
      // A close failure cannot change the answer this helper already produced.
    }
  }
}

/**
 * Reads up to `length` bytes at `offset`, returning fewer when the file ends.
 *
 * One `FileHandle.read` is allowed to return a short count — and does when
 * another process rewrites or truncates a transcript mid-scan — so a caller
 * cannot treat a single read as the whole range it asked for. Callers therefore
 * advance their cursors by `buffer.length`, which keeps the buffer's start
 * offset honest even when the read came up short.
 */
async function readFileRange(handle: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(length);
  let filled = 0;

  while (filled < length) {
    const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
    if (bytesRead === 0) {
      break;
    }
    filled += bytesRead;
  }

  return filled === length ? buffer : buffer.subarray(0, filled);
}

/**
 * Reports whether a read starting at `offset` begins inside a line.
 *
 * A window that opens mid-line begins with the tail of a record whose head lies
 * before it, and a fragment is not evidence of anything — so the caller drops
 * it. Testing the byte that precedes the offset, rather than assuming any
 * offset past zero is mid-line, keeps a window that happens to open exactly on
 * a line boundary from discarding the complete record sitting there.
 */
async function startsMidLine(handle: FileHandle, offset: number): Promise<boolean> {
  if (offset <= 0) {
    return false;
  }

  const precedingByte = Buffer.allocUnsafe(1);
  const { bytesRead } = await handle.read(precedingByte, 0, 1, offset - 1);
  return bytesRead === 1 && precedingByte[0] !== 0x0a;
}

/**
 * Walks one tail window backwards for the newest record `select` accepts.
 *
 * `hasLeadingFragment` drops the window's first line when the read started
 * mid-line: that line is the tail of a record whose head lies before the window,
 * and a fragment is not evidence of anything. The last line needs no such
 * treatment — a record still being written fails `JSON.parse` and falls through
 * to the record before it, which is how a half-written append must behave
 * instead of throwing.
 */
function findLastSelectedRecord<T>(
  windowText: string,
  hasLeadingFragment: boolean,
  select: (record: unknown) => T | null
): T | null {
  const lines = windowText.split('\n');
  if (hasLeadingFragment) {
    lines.shift();
  }

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }

    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    const selected = select(record);
    if (selected !== null) {
      return selected;
    }
  }

  return null;
}
