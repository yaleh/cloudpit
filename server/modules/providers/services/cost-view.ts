import type { ProviderTokenUsageCounts } from '../../../shared/interfaces.js';

//----------------- COST VIEW ------------

/**
 * The cache-accounting statement `/cost` shows for each selectable provider.
 *
 * Every provider reports cache quantities as a SUBSET of input rather than as
 * separate spend, but they name the quantities differently; the statement says
 * which quantities the provider's own reading reports so a reader does not add
 * the cache rows to input a second time. The mapping lives here rather than as a
 * branch in the panel: adding a provider adds one row.
 */
const COST_ACCOUNTING_NOTES: Record<string, string> = {
  claude:
    'Input already includes cache reads and cache writes. Anthropic reports them separately as '
    + 'cache_read_input_tokens and cache_creation_input_tokens, but they are a breakdown of input, '
    + 'never additional tokens.',
  cursor:
    'Input already includes any cached prompt tokens Cursor reports; cached quantities are a '
    + 'subset of input, never additional tokens.',
  codex:
    'Input already includes cached input tokens (cached_input_tokens). Cache writes '
    + '(cache_write_input_tokens) are the write half of that same prompt, so neither is added again.',
  opencode:
    'Input already includes cache reads and cache writes. The cache rows are a breakdown of input, '
    + 'never additional tokens.',
};

/**
 * The accounting statement for a provider id this build has no row for.
 *
 * It states the contract every provider satisfies — cache quantities are a
 * subset of input — without claiming which quantities that provider reports.
 */
const FALLBACK_COST_ACCOUNTING_NOTE =
  'Input includes any cached prompt tokens this provider reports; cache reads and cache writes are '
  + 'a breakdown of input, never additional tokens.';

/**
 * One session's whole-spend view, already normalized across providers.
 *
 * `total`, `input` and `output` describe the session, never one request's
 * context occupancy: a context-scoped reading (Claude) contributes its
 * cumulative block here while its newest-turn occupancy stays in
 * {@link CostViewContext.used}. Cache quantities are detail reads that are
 * already contained in `input`; they are never re-added to it.
 */
export type CostViewSession = {
  /** Whole-session spend: the source's own total, else input + output. */
  total?: number;
  input?: number;
  output?: number;
  /** Cached input tokens read back; a subset of `input`. */
  cacheRead?: number;
  /** Cached input tokens written; a subset of `input`, absent when not reported. */
  cacheWrite?: number;
  /** Reasoning tokens; a subset of `output`. */
  reasoningOutput?: number;
  /**
   * `cacheRead / input`. Emitted only when the source reported cache reads and
   * a positive input, because a missing numerator is not a claimed "0% cached".
   */
  cacheHitRatio?: number;
  /** `input - cacheRead - cacheWrite`, floored at 0; emitted only with `cacheHitRatio`. */
  fresh?: number;
};

/** The current context reading: what this session's newest request occupies. */
export type CostViewContext = {
  /** Newest-turn occupancy for a context-scoped reading; absent for a cumulative one. */
  used?: number;
  /** Window capacity in tokens, independent of either occupancy or session total. */
  window?: number;
};

/**
 * The `/cost` answer the browser renders: one provider-agnostic view of the
 * session, its newest request and its window, plus the provider's accounting
 * statement. The panel renders these values and derives nothing itself.
 */
export type CostView = {
  session?: CostViewSession;
  context?: CostViewContext;
  /** Newest single request, as the provider reported it; only a context estimate. */
  lastRequest?: ProviderTokenUsageCounts;
  /** The provider's own cache-accounting statement, resolved server-side. */
  accountingNote: string;
};

/**
 * The reading `/cost` derives its view from.
 *
 * It accepts the provider readers' shape plus the snake_case and legacy field
 * names an older client payload may still carry; every quantity is `unknown`
 * because the wire can hand over a string and "unparsable" must stay absent
 * rather than become a fabricated zero.
 */
export type CostViewReading = {
  used?: unknown;
  total?: unknown;
  contextWindow?: unknown;
  totalUsed?: unknown;
  total_tokens?: unknown;
  inputTokens?: unknown;
  input_tokens?: unknown;
  input?: unknown;
  cumulativeInputTokens?: unknown;
  promptTokens?: unknown;
  outputTokens?: unknown;
  output_tokens?: unknown;
  output?: unknown;
  cumulativeOutputTokens?: unknown;
  completionTokens?: unknown;
  cacheReadTokens?: unknown;
  cache_read_input_tokens?: unknown;
  cacheReadInputTokens?: unknown;
  cacheCreationTokens?: unknown;
  cache_creation_input_tokens?: unknown;
  cacheCreationInputTokens?: unknown;
  breakdown?: { input?: unknown; output?: unknown };
  cumulative?: unknown;
  lastRequest?: unknown;
  usageScope?: 'context' | 'session-cumulative';
};

/** Reads one numeric quantity while preserving "unknown" as `undefined`. */
const readQuantity = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Copies only the quantities a usage block actually reported.
 *
 * Fields the source did not report are omitted, not zero-filled; an explicit
 * zero survives. snake_case fallbacks keep an older payload readable.
 */
const readCounts = (value: unknown): ProviderTokenUsageCounts | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const counts: ProviderTokenUsageCounts = {};
  const add = (field: keyof ProviderTokenUsageCounts, ...keys: string[]) => {
    for (const key of keys) {
      const quantity = readQuantity(record[key]);
      if (quantity !== undefined) {
        counts[field] = quantity;
        return;
      }
    }
  };

  add('inputTokens', 'inputTokens', 'input_tokens');
  add('outputTokens', 'outputTokens', 'output_tokens');
  add('cacheReadTokens', 'cacheReadTokens', 'cache_read_input_tokens', 'cached_input_tokens');
  add('cacheWriteTokens', 'cacheWriteTokens', 'cache_write_input_tokens');
  add('reasoningOutputTokens', 'reasoningOutputTokens', 'reasoning_output_tokens');
  add('totalTokens', 'totalTokens', 'total_tokens');
  return Object.keys(counts).length > 0 ? counts : undefined;
};

/**
 * The session counts of a reading that reports one request rather than a
 * cumulative snapshot.
 *
 * The prompt total is the source's own `inputTokens` when it named one; an
 * older payload that only carried raw counts reports input excluding cache, so
 * the cached quantities are added back once to make the denominator the same
 * quantity the cache rows are a subset of.
 */
const readRequestSessionCounts = (
  reading: CostViewReading,
): ProviderTokenUsageCounts | undefined => {
  const namedInput = readQuantity(
    reading.inputTokens ?? reading.input ?? reading.cumulativeInputTokens
      ?? reading.breakdown?.input ?? reading.promptTokens,
  );
  const rawInput = readQuantity(reading.inputTokens ?? reading.input_tokens);
  const cacheRead = readQuantity(
    reading.cacheReadTokens ?? reading.cache_read_input_tokens ?? reading.cacheReadInputTokens,
  );
  // Anthropic's `cache_creation_input_tokens` is the write half of the prompt,
  // the same quantity Codex names `cache_write_input_tokens`.
  const cacheWrite = readQuantity(
    reading.cacheCreationTokens
      ?? reading.cache_creation_input_tokens
      ?? reading.cacheCreationInputTokens,
  );
  const output = readQuantity(
    reading.outputTokens ?? reading.output ?? reading.output_tokens
      ?? reading.cumulativeOutputTokens ?? reading.breakdown?.output ?? reading.completionTokens,
  );

  const counts: ProviderTokenUsageCounts = {};
  if (
    namedInput !== undefined || rawInput !== undefined
    || cacheRead !== undefined || cacheWrite !== undefined
  ) {
    counts.inputTokens = namedInput
      ?? (rawInput ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0);
  }
  if (output !== undefined) counts.outputTokens = output;
  if (cacheRead !== undefined) counts.cacheReadTokens = cacheRead;
  if (cacheWrite !== undefined) counts.cacheWriteTokens = cacheWrite;
  return Object.keys(counts).length > 0 ? counts : undefined;
};

/**
 * Derives the unified `/cost` view from one provider reading.
 *
 * `used` is decided once here: a `session-cumulative` reading is the whole
 * session's spend, so it lands in `session.total`; every other reading is the
 * newest request's occupancy and lands in `context.used`. The ratio and the
 * fresh remainder are derived here too, so the panel never computes them.
 *
 * Consumed by the commands module's `/cost` handler, which returns the result
 * as `data.cost`.
 */
export function buildCostView(
  reading: CostViewReading,
  provider: string | null | undefined,
): CostView {
  const isCumulativeScope = reading.usageScope === 'session-cumulative';
  const used = readQuantity(reading.used ?? reading.totalUsed ?? reading.total_tokens);
  const window = readQuantity(reading.total ?? reading.contextWindow);
  const cumulative = readCounts(reading.cumulative);
  const lastRequest = readCounts(reading.lastRequest);
  const counts = cumulative ?? readRequestSessionCounts(reading);

  const input = counts?.inputTokens;
  const output = counts?.outputTokens;
  const cacheRead = counts?.cacheReadTokens;
  const cacheWrite = counts?.cacheWriteTokens;
  const reportedTotal = counts?.totalTokens;
  const summedTotal =
    input !== undefined && output !== undefined ? input + output : undefined;
  const sessionTotal = isCumulativeScope
    ? used ?? reportedTotal ?? summedTotal
    : reportedTotal ?? summedTotal;

  const session: CostViewSession = {};
  if (sessionTotal !== undefined) session.total = sessionTotal;
  if (input !== undefined) session.input = input;
  if (output !== undefined) session.output = output;
  if (cacheRead !== undefined) {
    session.cacheRead = cacheRead;
    if (input !== undefined && input > 0) {
      session.cacheHitRatio = cacheRead / input;
      session.fresh = Math.max(0, input - cacheRead - (cacheWrite ?? 0));
    }
  }
  if (cacheWrite !== undefined) session.cacheWrite = cacheWrite;
  if (counts?.reasoningOutputTokens !== undefined) {
    session.reasoningOutput = counts.reasoningOutputTokens;
  }

  const context: CostViewContext = {};
  if (!isCumulativeScope && used !== undefined) context.used = used;
  if (window !== undefined) context.window = window;

  return {
    ...(Object.keys(session).length > 0 ? { session } : {}),
    ...(Object.keys(context).length > 0 ? { context } : {}),
    ...(lastRequest ? { lastRequest } : {}),
    accountingNote:
      COST_ACCOUNTING_NOTES[provider ?? ''] ?? FALLBACK_COST_ACCOUNTING_NOTE,
  };
}
