import type { Dirent } from 'node:fs';
import path from 'node:path';

import type {
  IProviderTokenUsage,
  ProviderTokenUsageDependencies,
  ProviderTokenUsageReading,
  ProviderTokenUsageSession,
} from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/**
 * Both JSONL usage readers only need the newest usage row, which sits at or
 * near the end of the transcript. Reading just this much of the tail keeps a
 * session-open usage lookup O(1) in the transcript's size; the rare tail with
 * no usage row at all falls back to the full read.
 */
const TOKEN_USAGE_TAIL_BYTES = 4 * 1024 * 1024;

function readUsageNumber(value: unknown): number {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

async function findCodexSessionFile(
  directoryPath: string,
  providerSessionId: string,
  dependencies: ProviderTokenUsageDependencies,
): Promise<string | null> {
  let entries: Dirent[];
  try {
    entries = await dependencies.readDirectory(directoryPath);
  } catch {
    // Codex session folders are date-partitioned and can disappear while a
    // cleanup is running. An unreadable branch is simply not a match.
    return null;
  }

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nestedMatch = await findCodexSessionFile(entryPath, providerSessionId, dependencies);
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

/** Newest `token_count` snapshot in the given JSONL text, or null when it has none. */
function findCodexTokenUsage(fileContent: string): ProviderTokenUsageReading | null {
  const lines = fileContent.trim().split('\n');

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;
      const tokenInfo = entry.type === 'event_msg' && entry.payload?.type === 'token_count'
        ? entry.payload.info
        : null;
      if (!tokenInfo) {
        continue;
      }

      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      if (tokenInfo.total_token_usage) {
        inputTokens = readUsageNumber(tokenInfo.total_token_usage.input_tokens);
        outputTokens = readUsageNumber(tokenInfo.total_token_usage.output_tokens);
        totalTokens = readUsageNumber(tokenInfo.total_token_usage.total_tokens)
          || inputTokens + outputTokens;
      }
      return {
        used: totalTokens,
        total: readUsageNumber(tokenInfo.model_context_window) || 200_000,
        inputTokens,
        outputTokens,
        breakdown: { input: inputTokens, output: outputTokens },
      };
    } catch {
      // A provider may be writing the last JSONL line while this read happens.
    }
  }

  return null;
}

function emptyCodexTokenUsage(): ProviderTokenUsageReading {
  return {
    used: 0,
    total: 200_000,
    inputTokens: 0,
    outputTokens: 0,
    breakdown: { input: 0, output: 0 },
  };
}

/**
 * Codex's usage reader: the newest `token_count` snapshot in the session's
 * rollout JSONL.
 *
 * The indexed `jsonl_path` is used when it exists; otherwise the session file
 * is located under `~/.codex/sessions` by provider session id, because Codex
 * partitions rollouts by date rather than by project.
 */
export class CodexTokenUsageProvider implements IProviderTokenUsage {
  async readSessionUsage(
    session: ProviderTokenUsageSession,
    dependencies: ProviderTokenUsageDependencies,
  ): Promise<ProviderTokenUsageReading> {
    const providerSessionId = session.provider_session_id || session.session_id;
    const indexedFilePath = session.jsonl_path && dependencies.fileExists(session.jsonl_path)
      ? session.jsonl_path
      : null;
    const sessionFilePath = indexedFilePath ?? await findCodexSessionFile(
      path.join(dependencies.getHomeDirectory(), '.codex', 'sessions'),
      providerSessionId,
      dependencies,
    );

    if (!sessionFilePath) {
      throw new AppError(`Codex session file for "${session.session_id}" was not found.`, {
        code: 'CODEX_SESSION_FILE_NOT_FOUND',
        statusCode: 404,
      });
    }

    const tail = await dependencies.readTextFileTail(sessionFilePath, TOKEN_USAGE_TAIL_BYTES);
    const tailUsage = findCodexTokenUsage(tail.content);
    if (tailUsage || tail.isComplete) {
      return tailUsage ?? emptyCodexTokenUsage();
    }

    // A tail this large with no token_count row is pathological, but the whole
    // file is still authoritative when it happens.
    return findCodexTokenUsage(await dependencies.readTextFile(sessionFilePath))
      ?? emptyCodexTokenUsage();
  }
}
