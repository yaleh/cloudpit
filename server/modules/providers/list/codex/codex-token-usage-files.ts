import type { Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type {
  ProviderTokenUsageFileTail,
  ProviderTokenUsageReading,
} from '@/shared/interfaces.js';

import { findCodexTokenUsage } from './codex-token-usage-normalization.js';

/**
 * Filesystem side of the Codex usage readers: locating a session's rollout
 * under the date-partitioned `~/.codex/sessions` tree and reading the newest
 * `token_count` snapshot from it.
 *
 * The normalization itself lives in `codex-token-usage-normalization.ts`; this
 * file only knows where the bytes are. The live runtime, which has the thread
 * id but no indexed path, uses {@link readCodexSessionTokenUsage}; the history
 * and endpoint readers prefer the session row's `jsonl_path`.
 */

/** Bytes read from the tail of a rollout before falling back to the whole file. */
const TOKEN_USAGE_TAIL_BYTES = 4 * 1024 * 1024;

/** The file operations the Codex usage readers need; injected for testability. */
export type CodexTokenUsageIo = {
  getHomeDirectory(): string;
  readDirectory(directoryPath: string): Promise<Dirent[]>;
  readTextFile(filePath: string): Promise<string>;
  readTextFileTail(filePath: string, maxBytes: number): Promise<ProviderTokenUsageFileTail>;
};

/**
 * The production I/O seam. The home directory is resolved at call time so a
 * test that temporarily replaces `os.homedir` is honored.
 */
const defaultCodexTokenUsageIo: CodexTokenUsageIo = {
  getHomeDirectory: () => os.homedir(),
  readDirectory: (directoryPath) => fsp.readdir(directoryPath, { withFileTypes: true }),
  readTextFile: (filePath) => fsp.readFile(filePath, 'utf8'),
  readTextFileTail: async (filePath, maxBytes) => {
    const handle = await fsp.open(filePath, 'r');
    try {
      const { size } = await handle.stat();
      if (size <= maxBytes) {
        return { content: await handle.readFile({ encoding: 'utf8' }), isComplete: true };
      }

      const buffer = Buffer.alloc(maxBytes);
      await handle.read(buffer, 0, maxBytes, size - maxBytes);
      const content = buffer.toString('utf8');
      // The window almost never starts on a row boundary; dropping everything
      // up to the first newline discards the partial row.
      const firstNewline = content.indexOf('\n');
      return {
        content: firstNewline === -1 ? '' : content.slice(firstNewline + 1),
        isComplete: false,
      };
    } finally {
      await handle.close();
    }
  },
};

/**
 * Finds a session's rollout by provider session id under Codex's date-partitioned
 * sessions tree. An unreadable branch is simply not a match.
 */
export async function findCodexSessionFile(
  directoryPath: string,
  providerSessionId: string,
  io: Pick<CodexTokenUsageIo, 'readDirectory'>,
): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await io.readDirectory(directoryPath);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nestedMatch = await findCodexSessionFile(entryPath, providerSessionId, io);
      if (nestedMatch) {
        return nestedMatch;
      }
      continue;
    }

    if (entry.name.includes(providerSessionId) && entry.name.endsWith('.jsonl')) {
      return entryPath;
    }
  }

  return null;
}

/**
 * Reads a rollout file's newest usage snapshot. The tail is enough for every
 * normal rollout; a tail with no snapshot at all falls back to the whole file.
 */
export async function readCodexTokenUsageFromFile(
  filePath: string,
  io: Pick<CodexTokenUsageIo, 'readTextFile' | 'readTextFileTail'>,
): Promise<ProviderTokenUsageReading | null> {
  const tail = await io.readTextFileTail(filePath, TOKEN_USAGE_TAIL_BYTES);
  const tailUsage = findCodexTokenUsage(tail.content);
  if (tailUsage || tail.isComplete) {
    return tailUsage;
  }

  return findCodexTokenUsage(await io.readTextFile(filePath));
}

/**
 * Locates a session's rollout from its provider-native id and returns the
 * newest usage snapshot. Used by the live runtime, which knows the thread id
 * but not the file path; the history and endpoint readers prefer the indexed
 * `jsonl_path` when the session row carries one.
 *
 * Returns `null` when the id is missing or no rollout can be found — callers
 * must not invent an all-zero reading for that case.
 */
export async function readCodexSessionTokenUsage(
  providerSessionId: string | null | undefined,
  io: CodexTokenUsageIo = defaultCodexTokenUsageIo,
): Promise<ProviderTokenUsageReading | null> {
  if (!providerSessionId) {
    return null;
  }

  const sessionFilePath = await findCodexSessionFile(
    path.join(io.getHomeDirectory(), '.codex', 'sessions'),
    providerSessionId,
    io,
  );
  if (!sessionFilePath) {
    return null;
  }

  return readCodexTokenUsageFromFile(sessionFilePath, io);
}
