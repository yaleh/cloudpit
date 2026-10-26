import path from 'node:path';

import type {
  IProviderTokenUsage,
  ProviderTokenUsageDependencies,
  ProviderTokenUsageReading,
  ProviderTokenUsageSession,
} from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';
import { resolveContextWindow } from '@/modules/providers/services/launch-spec.service.js';

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

// Model id of the newest main-thread assistant turn; its library entry's env row supplies the window.
function findNewestClaudeModelId(entries: AnyRecord[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.isSidechain !== true && entry?.type === 'assistant' && typeof entry.message?.model === 'string') {
      return entry.message.model;
    }
  }
  return null;
}

/**
 * Latest context-window usage from a Claude transcript's already-parsed rows.
 *
 * Exported because the session-messages reader hands the same usage back on
 * every history page, the way the Codex and OpenCode readers do. Without that,
 * a Claude session's counter only moved when the session was reselected, and
 * the store's "this provider reports no usage" path overwrote it with zero.
 *
 * Reads the newest assistant turn only: `input_tokens + cache_read +
 * cache_creation` is that one request's whole prompt, i.e. what the context
 * window currently holds. Summing turns would count the same cached prefix
 * once per turn.
 */
export function summarizeClaudeTokenUsage(
  entries: AnyRecord[],
  configuredContextWindow: string | undefined = process.env.CONTEXT_WINDOW,
  modelContextWindow?: number | string | null,
): ProviderTokenUsageReading {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    // A subagent's turns report the subagent's context window, not this
    // conversation's; reading one makes the counter drop to the subagent's
    // number and bounce back on the next main-thread turn.
    if (entry?.isSidechain === true) {
      continue;
    }

    const usage = entry?.type === 'assistant' ? entry.message?.usage : null;
    if (!usage) {
      continue;
    }

    const directInputTokens = readUsageNumber(usage.input_tokens ?? usage.inputTokens);
    const rowCacheReadTokens = readUsageNumber(
      usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cacheReadTokens,
    );
    const rowCacheCreationTokens = readUsageNumber(
      usage.cache_creation_input_tokens
        ?? usage.cacheCreationInputTokens
        ?? usage.cacheCreationTokens,
    );
    const rowInputTokens = directInputTokens + rowCacheReadTokens + rowCacheCreationTokens;
    const rowOutputTokens = readUsageNumber(usage.output_tokens ?? usage.outputTokens);

    // `<synthetic>` rows — interrupts, API errors, "No response requested" —
    // are written with an all-zero usage block rather than none at all. They
    // never carried a prompt, so treating one as the newest turn zeroed a
    // counter that a live event had just set correctly.
    if (rowInputTokens === 0 && rowOutputTokens === 0) {
      continue;
    }

    cacheReadTokens = rowCacheReadTokens;
    cacheCreationTokens = rowCacheCreationTokens;
    inputTokens = rowInputTokens;
    outputTokens = rowOutputTokens;
    break;
  }

  const contextWindow = resolveContextWindow(modelContextWindow, configuredContextWindow);
  const cacheTokens = cacheReadTokens + cacheCreationTokens;

  return {
    used: inputTokens + outputTokens,
    total: contextWindow,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens,
    breakdown: { input: inputTokens, output: outputTokens },
  };
}

function parseClaudeUsageEntries(fileContent: string): AnyRecord[] {
  const entries: AnyRecord[] = [];
  for (const line of fileContent.trim().split('\n')) {
    try {
      entries.push(JSON.parse(line) as AnyRecord);
    } catch {
      // Skip malformed lines without discarding usage from earlier messages.
    }
  }
  return entries;
}

function claudeEntriesHaveUsage(entries: AnyRecord[]): boolean {
  return entries.some((entry) => entry?.type === 'assistant' && entry.message?.usage);
}

/**
 * Claude's usage reader: the newest assistant turn of the session's JSONL
 * transcript, with the context window the session's model declares.
 *
 * Moved out of `provider-token-usage.service.ts` so the service only
 * dispatches; the reader itself knows how a Claude transcript stores usage.
 */
export class ClaudeTokenUsageProvider implements IProviderTokenUsage {
  async readSessionUsage(
    session: ProviderTokenUsageSession,
    dependencies: ProviderTokenUsageDependencies,
  ): Promise<ProviderTokenUsageReading> {
    const providerSessionId = session.provider_session_id || session.session_id;

    let sessionFilePath = session.jsonl_path;
    if (!sessionFilePath) {
      if (!session.project_path) {
        throw new AppError(`Session file for "${session.session_id}" was not found.`, {
          code: 'SESSION_FILE_NOT_FOUND',
          statusCode: 404,
        });
      }

      const encodedProjectPath = session.project_path.replace(/[^a-zA-Z0-9-]/g, '-');
      const projectDirectory = path.join(
        dependencies.getHomeDirectory(),
        '.claude',
        'projects',
        encodedProjectPath,
      );
      sessionFilePath = path.join(projectDirectory, `${providerSessionId}.jsonl`);

      const relativePath = path.relative(path.resolve(projectDirectory), path.resolve(sessionFilePath));
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new AppError('Resolved session path is invalid.', {
          code: 'INVALID_SESSION_PATH',
          statusCode: 400,
        });
      }
    }

    // The session row is created when the provider allocates it, but the
    // transcript only appears when the first turn is written — for a fresh
    // Claude session the file can lag the row by many seconds. In that window
    // the file the row names is legitimately absent, and reporting 404 left
    // the composer's token/context counter blank until the first turn
    // completed (or a realtime token_budget frame arrived). The session is
    // known and simply has no usage recorded yet, so answer with the same
    // zero reading the file-exists-with-no-usage path returns: an empty
    // summary that still carries the context window. That is what
    // `emptyCodexTokenUsage` reports for its own "no usage yet" case, and it
    // keeps the panel's context row populated instead of dropping to no row
    // at all. A genuinely unknown session is still SESSION_NOT_FOUND.
    if (!dependencies.fileExists(sessionFilePath)) {
      const modelRow = session.model
        ? dependencies.getClaudeModelContextWindow?.(session.model)
        : undefined;
      return summarizeClaudeTokenUsage([], dependencies.getClaudeContextWindow(), modelRow);
    }

    const tail = await dependencies.readTextFileTail(sessionFilePath, TOKEN_USAGE_TAIL_BYTES);
    let entries = parseClaudeUsageEntries(tail.content);
    if (!claudeEntriesHaveUsage(entries) && !tail.isComplete) {
      entries = parseClaudeUsageEntries(await dependencies.readTextFile(sessionFilePath));
    }
    const modelId = session.model || findNewestClaudeModelId(entries);
    const modelRow = modelId ? dependencies.getClaudeModelContextWindow?.(modelId) : undefined;
    return summarizeClaudeTokenUsage(entries, dependencies.getClaudeContextWindow(), modelRow);
  }
}
