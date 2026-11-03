import { readdirSync, statSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { ProviderTokenUsageFileTail } from './interfaces.js';

/**
 * The total size in bytes of every regular file directly under `directory`.
 *
 * DIRECT CHILDREN ONLY. A subdirectory is skipped, not walked: both callers keep
 * a flat store (`<dir>/<file>`) and cap that flat store, so walking deeper would
 * count bytes the trim loop below can never remove. The read is BEST-EFFORT: a
 * file that vanishes between the listing and the stat contributes no bytes
 * instead of throwing, because the trim runs after a write in a directory a
 * concurrent connection or request may be emptying, and this figure is only ever
 * compared against a ceiling — one missed file costs a slightly conservative
 * reading, never a failed write.
 *
 * Consumed by `server/modules/voice-realtime/voice-realtime-log.ts` (the
 * per-connection realtime journal's ceiling) and
 * `server/modules/voice/voice-data.ts` (the local voice-record store's ceiling).
 * Both write first and then trim to this figure, so the two must sum the same
 * bytes or a deployment's disk bound would mean different things per store.
 */
export function directoryBytes(directory: string): number {
  let total = 0;
  for (const name of readdirSync(directory)) {
    try {
      const stats = statSync(path.join(directory, name));
      if (stats.isFile()) {
        total += stats.size;
      }
    } catch {
      // A file that vanished between the listing and the stat is not bytes we have to account for.
    }
  }
  return total;
}

/**
 * Reads the last `maxBytes` bytes of a UTF-8 text file, reporting whether that
 * window is the whole file.
 *
 * The window almost never starts on a row boundary, so everything up to the
 * first newline is dropped: callers parse a newline-delimited rollout, and a
 * partial leading row would be a parse error rather than a reading. Dropping
 * the same prefix also discards a split multi-byte character, so the returned
 * content never starts mid-codepoint.
 *
 * Consumed by the provider token-usage I/O bags
 * (`server/modules/providers/services/provider-token-usage.service.ts` and
 * `server/modules/providers/list/codex/codex-token-usage-files.ts`). Both keep
 * the function behind their injectable `readTextFileTail` seam so tests can
 * substitute a fixed tail.
 */
export async function readTextFileTail(
  filePath: string,
  maxBytes: number,
): Promise<ProviderTokenUsageFileTail> {
  const handle = await fsp.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (size <= maxBytes) {
      return { content: await handle.readFile({ encoding: 'utf8' }), isComplete: true };
    }

    const buffer = Buffer.alloc(maxBytes);
    await handle.read(buffer, 0, maxBytes, size - maxBytes);
    const content = buffer.toString('utf8');
    const firstNewline = content.indexOf('\n');
    return {
      content: firstNewline === -1 ? '' : content.slice(firstNewline + 1),
      isComplete: false,
    };
  } finally {
    await handle.close();
  }
}
