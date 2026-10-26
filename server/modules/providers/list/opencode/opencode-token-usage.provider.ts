import Database from 'better-sqlite3';

import type {
  IProviderTokenUsage,
  ProviderTokenUsageDependencies,
  ProviderTokenUsageReading,
  ProviderTokenUsageSession,
} from '@/shared/interfaces.js';
import { AppError } from '@/shared/utils.js';

type OpenCodeTokenRow = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
};

function readUsageNumber(value: unknown): number {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
}

function readOpenCodeTokenUsage(databasePath: string, providerSessionId: string): ProviderTokenUsageReading {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const columns = database.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>;
    const columnNames = new Set(columns.map((column) => column.name));
    const requiredColumns = [
      'tokens_input',
      'tokens_output',
      'tokens_reasoning',
      'tokens_cache_read',
      'tokens_cache_write',
    ];

    if (!requiredColumns.every((column) => columnNames.has(column))) {
      return {
        used: 0,
        inputTokens: 0,
        outputTokens: 0,
        breakdown: { input: 0, output: 0 },
        unsupported: true,
        message: 'Token usage tracking is not available in this OpenCode database schema',
      };
    }

    const row = database.prepare(`
      SELECT
        tokens_input AS inputTokens,
        tokens_output AS outputTokens,
        tokens_reasoning AS reasoningTokens,
        tokens_cache_read AS cacheReadTokens,
        tokens_cache_write AS cacheWriteTokens
      FROM session
      WHERE id = ?
    `).get(providerSessionId) as OpenCodeTokenRow | undefined;

    if (!row) {
      throw new AppError('OpenCode session was not found.', {
        code: 'OPENCODE_SESSION_NOT_FOUND',
        statusCode: 404,
      });
    }

    const inputTokens = readUsageNumber(row.inputTokens) + readUsageNumber(row.cacheReadTokens);
    const outputTokens = readUsageNumber(row.outputTokens);
    const used = readUsageNumber(row.inputTokens)
      + outputTokens
      + readUsageNumber(row.reasoningTokens)
      + readUsageNumber(row.cacheReadTokens)
      + readUsageNumber(row.cacheWriteTokens);

    return {
      used,
      inputTokens,
      outputTokens,
      breakdown: { input: inputTokens, output: outputTokens },
    };
  } finally {
    database.close();
  }
}

/**
 * OpenCode's usage reader: the token columns of the row in OpenCode's own
 * SQLite store.
 *
 * OpenCode keeps usage on the session row rather than in a transcript, so this
 * facet reads its database directly; a schema without the token columns is an
 * `unsupported` reading, not an error.
 */
export class OpenCodeTokenUsageProvider implements IProviderTokenUsage {
  readSessionUsage(
    session: ProviderTokenUsageSession,
    dependencies: ProviderTokenUsageDependencies,
  ): ProviderTokenUsageReading {
    const providerSessionId = session.provider_session_id || session.session_id;
    const databasePath = dependencies.getOpenCodeDatabasePath();
    if (!dependencies.fileExists(databasePath)) {
      throw new AppError('OpenCode database was not found.', {
        code: 'OPENCODE_DATABASE_NOT_FOUND',
        statusCode: 404,
      });
    }

    return readOpenCodeTokenUsage(databasePath, providerSessionId);
  }
}
