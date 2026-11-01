import type {
  ProviderTokenUsageCounts,
  ProviderTokenUsageReading,
} from '@/shared/interfaces.js';
import type { AnyRecord } from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

/**
 * One Codex `token_count` snapshot, normalized the same way for all three
 * readers: the rollout history path, the live runtime path, and the
 * `/token-usage` endpoint.
 *
 * Codex reports two quantity sets in one event and they mean different things:
 *
 * - `total_token_usage` is the SESSION CUMULATIVE spend. It grows forever and
 *   is never a context-window occupancy reading — dividing 2.5M by a 200K
 *   window is meaningless.
 * - `last_token_usage` is the newest single request. That is the closest
 *   available approximation of what the context window currently holds, but it
 *   is still an approximation, not a measured occupancy.
 *
 * Both sets carry `input_tokens`, `cached_input_tokens`, `output_tokens`,
 * `reasoning_output_tokens` and `total_tokens`, and a rollout may also report
 * `cache_write_input_tokens`. Cached input — read and written — is already part
 * of input, and reasoning output is already part of output, so they are kept as
 * detail reads rather than added in again. The window
 * (`model_context_window`) is independent of both totals.
 *
 * The filesystem side lives in `codex-token-usage-files.ts`.
 */

/**
 * Reads one quantity while preserving the difference between "absent/invalid"
 * (`undefined`) and an explicit zero.
 */
function readQuantity(value: unknown): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Reads one Codex usage block into the shared counts shape.
 *
 * Only fields the source actually reported are copied. Returns `undefined` when
 * the block carries no readable quantity at all, so a reader can tell "no
 * snapshot" apart from "a snapshot that happens to be all zero".
 */
function readCodexUsageCounts(value: unknown): ProviderTokenUsageCounts | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const counts: ProviderTokenUsageCounts = {};
  const inputTokens = readQuantity(value.input_tokens);
  const outputTokens = readQuantity(value.output_tokens);
  const cacheReadTokens = readQuantity(value.cached_input_tokens);
  const cacheWriteTokens = readQuantity(
    value.cache_write_input_tokens ?? value.cacheWriteInputTokens,
  );
  const reasoningOutputTokens = readQuantity(value.reasoning_output_tokens);
  const totalTokens = readQuantity(value.total_tokens);

  if (inputTokens !== undefined) counts.inputTokens = inputTokens;
  if (outputTokens !== undefined) counts.outputTokens = outputTokens;
  if (cacheReadTokens !== undefined) counts.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== undefined) counts.cacheWriteTokens = cacheWriteTokens;
  if (reasoningOutputTokens !== undefined) counts.reasoningOutputTokens = reasoningOutputTokens;
  if (totalTokens !== undefined) counts.totalTokens = totalTokens;

  return Object.keys(counts).length > 0 ? counts : undefined;
}

function readObservedAt(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}

/**
 * Normalizes one `event_msg`/`token_count` `info` payload.
 *
 * Returns `null` when the payload carries neither usage set: that is "no
 * snapshot", not an all-zero one, and callers must not invent numbers for it.
 *
 * `used` stays the legacy cumulative total. When Codex omits `total_tokens` but
 * reports both halves, `used` is derived as input+output (the same arithmetic
 * Codex itself uses); it never adds cached or reasoning tokens on top.
 */
export function normalizeCodexTokenCountInfo(
  info: unknown,
  observedAt?: unknown,
): ProviderTokenUsageReading | null {
  if (!isRecord(info)) {
    return null;
  }

  const cumulative = readCodexUsageCounts(info.total_token_usage);
  const lastRequest = readCodexUsageCounts(info.last_token_usage);
  if (!cumulative && !lastRequest) {
    return null;
  }

  const inputTokens = cumulative?.inputTokens ?? 0;
  const outputTokens = cumulative?.outputTokens ?? 0;
  const derivedCumulativeTotal = cumulative?.inputTokens !== undefined
    && cumulative?.outputTokens !== undefined
    ? cumulative.inputTokens + cumulative.outputTokens
    : undefined;
  const window = readQuantity(info.model_context_window);
  const timestamp = readObservedAt(observedAt);

  return {
    used: cumulative?.totalTokens ?? derivedCumulativeTotal ?? 0,
    ...(window !== undefined && window > 0 ? { total: window } : {}),
    inputTokens,
    outputTokens,
    ...(cumulative?.cacheReadTokens !== undefined
      ? { cacheReadTokens: cumulative.cacheReadTokens }
      : {}),
    ...(cumulative?.reasoningOutputTokens !== undefined
      ? { reasoningOutputTokens: cumulative.reasoningOutputTokens }
      : {}),
    ...(cumulative ? { cumulative } : {}),
    ...(lastRequest ? { lastRequest } : {}),
    usageScope: 'session-cumulative',
    ...(timestamp ? { observedAt: timestamp } : {}),
    breakdown: { input: inputTokens, output: outputTokens },
  };
}

/**
 * Newest readable `token_count` snapshot in a JSONL fragment, or `null`.
 *
 * Scans from the end because the newest snapshot sits at the tail; a blank
 * `info` row (Codex writes those too) is skipped rather than ending the scan.
 * A partially written final row is skipped the same way.
 *
 * Used by `codex-token-usage-files.ts` after it reads a rollout's tail.
 */
export function findCodexTokenUsage(fileContent: string): ProviderTokenUsageReading | null {
  const lines = fileContent.trim().split('\n');

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const entry = JSON.parse(lines[index]) as AnyRecord;
      if (entry?.type !== 'event_msg') {
        continue;
      }
      const payload = entry.payload;
      if (!isRecord(payload) || payload.type !== 'token_count') {
        continue;
      }
      const usage = normalizeCodexTokenCountInfo(payload.info, entry.timestamp);
      if (usage) {
        return usage;
      }
    } catch {
      // A provider may be writing the last JSONL line while this read happens.
    }
  }

  return null;
}
