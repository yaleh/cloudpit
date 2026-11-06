import path from 'node:path';

import type {
  IProviderTokenUsage,
  ProviderTokenUsageDependencies,
  ProviderTokenUsageReading,
  ProviderTokenUsageSession,
} from '@/shared/interfaces.js';
import { AppError } from '@/shared/utils.js';

import {
  findCodexSessionFile,
  readCodexTokenUsageFromFile,
} from './codex-token-usage-files.js';

/**
 * Codex's usage reader: the newest `token_count` snapshot in the session's
 * rollout JSONL.
 *
 * The normalization (cumulative vs latest-request quantities, subsets, window,
 * missing fields) lives in `codex-token-usage-normalization.ts` and is shared
 * with the history reader and the live runtime, so all three surfaces describe
 * the same snapshot identically.
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

    return (await readCodexTokenUsageFromFile(sessionFilePath, dependencies))
      ?? emptyCodexTokenUsage();
  }
}

/**
 * The answer for a session whose rollout exists but records no usage yet.
 *
 * No window and no detail blocks are invented: the session simply has no
 * snapshot, and a caller that receives a number here reads it as "zero recorded
 * so far", which is the legacy contract of `used`/`inputTokens`/`outputTokens`.
 */
function emptyCodexTokenUsage(): ProviderTokenUsageReading {
  return {
    used: 0,
    inputTokens: 0,
    outputTokens: 0,
    breakdown: { input: 0, output: 0 },
  };
}
