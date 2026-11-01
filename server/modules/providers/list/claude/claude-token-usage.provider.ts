import path from 'node:path';

import type {
  IProviderTokenUsage,
  ProviderTokenUsageCounts,
  ProviderTokenUsageDependencies,
  ProviderTokenUsageReading,
  ProviderTokenUsageSession,
} from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';
import { resolveContextWindow } from '@/modules/providers/services/launch-spec.service.js';

/**
 * The newest-turn (context-occupancy) read only needs the row at or near the
 * end of the transcript, but the session-cumulative sum needs every main-thread
 * turn. `readSessionUsage` therefore reads the whole file for any transcript
 * larger than the tail window; the tail is just the fast path for small
 * transcripts, where it is the whole file.
 */
const TOKEN_USAGE_TAIL_BYTES = 4 * 1024 * 1024;

function readUsageNumber(value: unknown): number {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

/**
 * Reads an optional quantity, keeping "the source reported a number" distinct
 * from "the source did not report this quantity". Used for the cache subset
 * reads so an absent field stays absent in the counts shape instead of being
 * fabricated as zero.
 */
function readReportedUsageNumber(value: unknown): number | null {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
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

/** One assistant row's usage, with its cache detail kept separate. */
type ClaudeUsageRowTotals = {
  /** Whole prompt: direct input + cache read + cache write. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** True when this row (or any summed row) reported a cache-read quantity. */
  sawCacheRead: boolean;
  /** True when this row (or any summed row) reported a cache-write quantity. */
  sawCacheWrite: boolean;
};

/**
 * Reads one assistant row's usage, or `null` for any other row.
 *
 * `inputTokens` is the row's whole prompt (`input_tokens + cache_read +
 * cache_creation`), which is what the context window holds after that request.
 * The two cache quantities are returned separately as subset detail reads.
 */
function readClaudeUsageRow(entry: AnyRecord): ClaudeUsageRowTotals | null {
  const usage = entry?.type === 'assistant' ? entry.message?.usage : null;
  if (!usage) {
    return null;
  }

  const directInputTokens = readUsageNumber(usage.input_tokens ?? usage.inputTokens);
  const cacheReadTokens = readReportedUsageNumber(
    usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? usage.cacheReadTokens,
  );
  const cacheWriteTokens = readReportedUsageNumber(
    usage.cache_creation_input_tokens
      ?? usage.cacheCreationInputTokens
      ?? usage.cacheCreationTokens,
  );

  return {
    inputTokens: directInputTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0),
    outputTokens: readUsageNumber(usage.output_tokens ?? usage.outputTokens),
    cacheReadTokens: cacheReadTokens ?? 0,
    cacheWriteTokens: cacheWriteTokens ?? 0,
    sawCacheRead: cacheReadTokens !== null,
    sawCacheWrite: cacheWriteTokens !== null,
  };
}

function addClaudeUsageTotals(target: ClaudeUsageRowTotals, row: ClaudeUsageRowTotals): void {
  target.inputTokens += row.inputTokens;
  target.outputTokens += row.outputTokens;
  target.cacheReadTokens += row.cacheReadTokens;
  target.cacheWriteTokens += row.cacheWriteTokens;
  target.sawCacheRead ||= row.sawCacheRead;
  target.sawCacheWrite ||= row.sawCacheWrite;
}

function toUsageCounts(totals: ClaudeUsageRowTotals): ProviderTokenUsageCounts {
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    // Cache subsets only when some summed row actually reported them:
    // "reported zero" is a real answer, "reported nothing" is not.
    ...(totals.sawCacheRead ? { cacheReadTokens: totals.cacheReadTokens } : {}),
    ...(totals.sawCacheWrite ? { cacheWriteTokens: totals.cacheWriteTokens } : {}),
  };
}

/**
 * Usage of a Claude transcript's already-parsed rows, in three scopes:
 * - `used`/`inputTokens`/`cache*` stay the NEWEST main-thread turn, i.e. what
 *   the context window currently holds, and `lastRequest` mirrors that same
 *   newest turn in the counts shape. Summing turns there would count the same
 *   cached prefix once per turn.
 * - `cumulative` is the session's total spend, summed over every main-thread
 *   assistant turn: the same per-row arithmetic as the newest-turn read,
 *   accumulated instead of last-wins. `sidechain` accumulates subagent turns
 *   separately — they bill to the session but own a separate context, so
 *   folding them into `cumulative` would mix two conversations' prompt sizes.
 *
 * Exported because the session-messages reader hands the same usage back on
 * every history page, the way the Codex and OpenCode readers do. Without that,
 * a Claude session's counter only moved when the session was reselected, and
 * the store's "this provider reports no usage" path overwrote it with zero.
 */
export function summarizeClaudeTokenUsage(
  entries: AnyRecord[],
  configuredContextWindow: string | undefined = process.env.CONTEXT_WINDOW,
  modelContextWindow?: number | string | null,
): ProviderTokenUsageReading {
  // Newest qualifying main-thread row: the context-occupancy reading.
  let lastRequest: ClaudeUsageRowTotals | null = null;
  const cumulativeTotals: ClaudeUsageRowTotals = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    sawCacheRead: false, sawCacheWrite: false,
  };
  const sidechainTotals: ClaudeUsageRowTotals = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    sawCacheRead: false, sawCacheWrite: false,
  };
  let sawCumulativeUsage = false;
  let sawSidechainUsage = false;

  for (const entry of entries) {
    const row = readClaudeUsageRow(entry);
    if (!row) {
      continue;
    }

    // `<synthetic>` rows — interrupts, API errors, "No response requested" —
    // are written with an all-zero usage block rather than none at all. They
    // never carried a prompt, so letting one win the newest-turn read zeroed a
    // counter that a live event had just set correctly; adding it to the sums
    // would likewise contribute nothing but a lie.
    if (row.inputTokens === 0 && row.outputTokens === 0) {
      continue;
    }

    // A subagent's turns report the subagent's context window, not this
    // conversation's; reading one as the newest turn made the counter drop to
    // the subagent's number and bounce back on the next main-thread turn.
    if (entry?.isSidechain === true) {
      sawSidechainUsage = true;
      addClaudeUsageTotals(sidechainTotals, row);
      continue;
    }

    sawCumulativeUsage = true;
    addClaudeUsageTotals(cumulativeTotals, row);
    // File order is chronological, so the last qualifying row is the newest.
    lastRequest = row;
  }

  const contextWindow = resolveContextWindow(modelContextWindow, configuredContextWindow);
  const inputTokens = lastRequest?.inputTokens ?? 0;
  const outputTokens = lastRequest?.outputTokens ?? 0;
  const cacheReadTokens = lastRequest?.cacheReadTokens ?? 0;
  const cacheCreationTokens = lastRequest?.cacheWriteTokens ?? 0;

  return {
    used: inputTokens + outputTokens,
    total: contextWindow,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    cacheTokens: cacheReadTokens + cacheCreationTokens,
    // Only when a main-thread usage row exists: an empty transcript reported no
    // spend snapshot, which is not the same answer as a session that spent zero.
    ...(sawCumulativeUsage ? { cumulative: toUsageCounts(cumulativeTotals) } : {}),
    ...(sawSidechainUsage ? { sidechain: toUsageCounts(sidechainTotals) } : {}),
    ...(lastRequest ? { lastRequest: toUsageCounts(lastRequest) } : {}),
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
    // `cumulative` sums the whole session, so a transcript larger than the
    // tail window must be read in full: a tail-only read would silently
    // undercount every turn that fell before the last 4MB. The tail remains
    // the cheap path for small transcripts, where it is the whole file.
    const entries = tail.isComplete
      ? parseClaudeUsageEntries(tail.content)
      : parseClaudeUsageEntries(await dependencies.readTextFile(sessionFilePath));
    const modelId = session.model || findNewestClaudeModelId(entries);
    const modelRow = modelId ? dependencies.getClaudeModelContextWindow?.(modelId) : undefined;
    return summarizeClaudeTokenUsage(entries, dependencies.getClaudeContextWindow(), modelRow);
  }
}
