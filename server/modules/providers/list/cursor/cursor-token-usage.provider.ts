import type {
  IProviderTokenUsage,
  ProviderTokenUsageReading,
  ProviderTokenUsageSession,
} from '@/shared/interfaces.js';

/**
 * Cursor's usage reader: nothing to read.
 *
 * Cursor's CLI keeps no token accounting this app can reach, so the honest
 * answer is the `unsupported` reading the service used to hard-code behind its
 * `provider === 'cursor'` branch. Selecting a Cursor session therefore shows no
 * counter rather than a zero that reads as "no usage yet".
 */
export class CursorTokenUsageProvider implements IProviderTokenUsage {
  readSessionUsage(_session: ProviderTokenUsageSession): ProviderTokenUsageReading {
    return {
      used: 0,
      total: 0,
      inputTokens: 0,
      outputTokens: 0,
      breakdown: { input: 0, output: 0 },
      unsupported: true,
      message: 'Token usage tracking not available for Cursor sessions',
    };
  }
}
