import { Fragment } from 'react';
import { Activity, Coins, Gauge, Layers, Sparkles, TerminalSquare } from 'lucide-react';

import { resolveProviderDescriptor } from '@/shared/constants';
import type { CostCommandData, TokenUsageCounts } from '@/shared/types';
import { getProviderLabel } from '@/shared/utils';

/**
 * The `/cost` panel's body. Used by `CommandResultModal`; kept in its own file
 * so the modal's command dispatcher stays under the source-size ratchet.
 *
 * Two layouts share the meta card: providers that report one context reading
 * (Claude) keep the legacy total/breakdown/window rows, while cumulative
 * providers (Codex) get the grouped cumulative, latest-request and window
 * sections.
 */

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString();
};

/** One rendered usage line; `hint` names a subset relationship so the value is not read as another addend. */
type UsageRow = {
  label: string;
  value: string;
  icon: typeof Activity;
  hint?: string;
  /** Stable role for the scenario surface, when a step needs to read this exact row. */
  role?: string;
};

/** Reads a reported quantity, keeping "unknown" distinct from an explicit zero. */
const readTokenQuantity = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** The cache quantities one usage block reported, with "not reported" kept absent. */
export type CacheUsageCounts = {
  input?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

/** One usage block's cache accounting, derived for display only (never a stored reading). */
export type CacheUsageBreakdown = {
  /** `cacheRead / input`; the share of input that was served from cache. */
  ratio: number;
  /**
   * `input - cacheRead - cacheWrite`, floored at 0.
   *
   * The provider contracts say both cache quantities are already inside input, so
   * this is the remaining uncached portion of the same total. A malformed source
   * whose caches exceed its input floors here rather than drawing a negative bar.
   */
  fresh: number;
  /** The three segments, in draw order and in the same unit as `input`. */
  segments: { fresh: number; cacheRead: number; cacheWrite: number };
  /** The denominator the ratio and segment widths use. */
  input: number;
  /** Whether the source reported a cache-write quantity at all (absent is not zero). */
  cacheWriteReported: boolean;
};

/**
 * Derives the cache hit ratio and the fresh/cacheRead/cacheWrite split.
 *
 * React-free and side-effect-free: the panel renders this result and the unit
 * criterion exercises it directly. Returns `null` when no positive input was
 * reported — there is no denominator, so no ratio to claim.
 */
export function buildCacheUsageBreakdown(
  counts: CacheUsageCounts | undefined,
): CacheUsageBreakdown | null {
  const input = readTokenQuantity(counts?.input);
  if (input === undefined || input <= 0) {
    return null;
  }
  const reportedCacheRead = readTokenQuantity(counts?.cacheRead);
  const reportedCacheWrite = readTokenQuantity(counts?.cacheWrite);
  const cacheRead = reportedCacheRead ?? 0;
  const cacheWrite = reportedCacheWrite ?? 0;
  const fresh = Math.max(0, input - cacheRead - cacheWrite);
  return {
    ratio: cacheRead / input,
    fresh,
    segments: { fresh, cacheRead, cacheWrite },
    input,
    cacheWriteReported: reportedCacheWrite !== undefined,
  };
}

/** Reads the cache quantities out of a wire usage block without inventing missing ones. */
const toCacheUsageCounts = (
  counts: TokenUsageCounts | undefined,
): CacheUsageCounts | undefined =>
  counts === undefined
    ? undefined
    : {
        input: counts.inputTokens,
        cacheRead: counts.cacheReadTokens,
        cacheWrite: counts.cacheWriteTokens,
      };

/** Formats `cacheRead / input` as a percentage, keeping one decimal below 10%. */
export const formatCacheHitRatio = (ratio: number): string => {
  const percent = ratio * 100;
  const rounded = percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10;
  return `${rounded}%`;
};

/**
 * Renders one usage block's known quantities only.
 *
 * Cached input and reasoning output are detail reads that are already contained
 * in their parent totals, so they carry a subset hint and are never summed into
 * another row. An absent field renders nothing.
 */
const buildCountRows = (
  counts: TokenUsageCounts | undefined,
  options: { prefix?: string; includeTotal?: boolean } = {},
): UsageRow[] => {
  if (!counts) {
    return [];
  }

  const rows: UsageRow[] = [];
  const prefix = options.prefix ? `${options.prefix} ` : '';
  const input = readTokenQuantity(counts.inputTokens);
  if (input !== undefined) {
    rows.push({ label: `${prefix}Input tokens`, value: formatNumber(input), icon: TerminalSquare });
  }
  const cacheRead = readTokenQuantity(counts.cacheReadTokens);
  if (cacheRead !== undefined) {
    rows.push({
      label: `${prefix}Cached input tokens`,
      value: formatNumber(cacheRead),
      icon: Gauge,
      hint: 'subset of input — not added again',
    });
  }
  // The write half of the same prompt. Rendered only when the provider reported
  // it: an absent quantity is not a zero, so there is no row to draw.
  const cacheWrite = readTokenQuantity(counts.cacheWriteTokens);
  if (cacheWrite !== undefined) {
    rows.push({
      label: `${prefix}Cached write tokens`,
      value: formatNumber(cacheWrite),
      icon: Layers,
      hint: 'subset of input — not added again',
    });
  }
  const output = readTokenQuantity(counts.outputTokens);
  if (output !== undefined) {
    rows.push({ label: `${prefix}Output tokens`, value: formatNumber(output), icon: Coins });
  }
  const reasoning = readTokenQuantity(counts.reasoningOutputTokens);
  if (reasoning !== undefined) {
    rows.push({
      label: `${prefix}Reasoning output tokens`,
      value: formatNumber(reasoning),
      icon: Sparkles,
      hint: 'subset of output — not added again',
    });
  }
  const total = readTokenQuantity(counts.totalTokens);
  if (options.includeTotal && total !== undefined) {
    rows.push({ label: `${prefix}Total tokens`, value: formatNumber(total), icon: Activity });
  }

  return rows;
};

/** One usage line, shared by both layouts so a row reads the same everywhere. */
function UsageRowView({ row }: { row: UsageRow }) {
  const Icon = row.icon;

  return (
    <div
      data-testid="cost-usage-row"
      data-cost-role={row.role}
      data-cost-label={row.label}
      data-cost-value={row.value}
      className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{row.label}</span>
          {row.hint && (
            <span className="block text-[11px] leading-4 text-muted-foreground">{row.hint}</span>
          )}
        </span>
      </div>
      <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{row.value}</span>
    </div>
  );
}

/** Segment fills, one per cache quantity; the three must stay visually distinct. */
const CACHE_SEGMENT_CLASSES = {
  fresh: 'bg-primary',
  cacheRead: 'bg-sky-500',
  cacheWrite: 'bg-amber-500',
} as const;

/**
 * The fresh/cacheRead/cacheWrite proportion bar.
 *
 * Widths are shares of the same input total the ratio uses, so the three
 * segments and the percentage describe one reading. A cache-write segment is
 * drawn only when the provider reported that quantity.
 */
function CacheUsageBar({ breakdown }: { breakdown: CacheUsageBreakdown }) {
  const segmentShare = (value: number) =>
    breakdown.input > 0 ? `${(value / breakdown.input) * 100}%` : '0%';
  const segments = [
    { key: 'fresh' as const, label: 'Fresh', value: breakdown.segments.fresh },
    { key: 'cacheRead' as const, label: 'Cache read', value: breakdown.segments.cacheRead },
    ...(breakdown.cacheWriteReported
      ? [{ key: 'cacheWrite' as const, label: 'Cache write', value: breakdown.segments.cacheWrite }]
      : []),
  ];

  return (
    <div data-testid="cost-cache-usage-bar" className="border-b border-border/60 px-4 py-3">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {segments.map((segment) => (
          <div
            key={segment.key}
            data-cost-segment={segment.key}
            data-cost-percent={String((segment.value / breakdown.input) * 100)}
            className={`h-full ${CACHE_SEGMENT_CLASSES[segment.key]}`}
            style={{ width: segmentShare(segment.value) }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((segment) => (
          <span key={segment.key} className="text-[11px] leading-4 text-muted-foreground">
            {segment.label} <span className="font-mono font-semibold text-foreground">{formatNumber(segment.value)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** The provider/model/ai-title card shared by both `/cost` layouts. */
function CostMetaCard({
  provider,
  model,
  aiTitle,
  cacheAccountingNote,
}: {
  provider: string;
  model: string;
  aiTitle: string;
  cacheAccountingNote: string;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Provider</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{provider}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Model</p>
          <p className="mt-1 break-all font-mono text-sm text-foreground">{model}</p>
        </div>
        {/* Under the pair it describes, and across both columns: this is a
            sentence Claude wrote, not a short identifier, so it wraps rather
            than truncates. Sessions without one — every non-Claude provider,
            and any Claude session whose transcript has no generated title —
            render nothing here instead of a placeholder. */}
        {aiTitle && (
          <div className="sm:col-span-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">AI title</p>
            <p className="mt-1 break-words text-sm font-semibold text-foreground">{aiTitle}</p>
          </div>
        )}
        {/* The provider's own cache accounting, across both columns: the cache
            rows above are a breakdown of input, and which quantities make up
            that breakdown differs by provider. */}
        <div className="sm:col-span-2" data-testid="cost-cache-accounting-note">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Cache accounting
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{cacheAccountingNote}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The accounting statement for a provider id this build has no row for.
 *
 * It states the contract every provider satisfies — cache quantities are a
 * subset of input — without claiming which quantities that provider reports.
 */
const FALLBACK_CACHE_ACCOUNTING_NOTE =
  'Input includes any cached prompt tokens this provider reports; cache reads and cache writes are '
  + 'a breakdown of input, never additional tokens.';

export function CostContent({ data }: { data: CostCommandData }) {
  const model = data.model || 'Unknown';
  const providerLabel = getProviderLabel(data.provider, data.provider || 'Unknown');
  const cacheAccountingNote =
    resolveProviderDescriptor(data.provider)?.cacheAccountingNote ?? FALLBACK_CACHE_ACCOUNTING_NOTE;
  // A blank title is as absent as a missing one: the server only omits the
  // field when the transcript carries none, and an empty string in it would
  // otherwise render a labelled row saying nothing.
  const aiTitle = typeof data.aiTitle === 'string' ? data.aiTitle.trim() : '';

  // Cumulative providers (Codex) answer with three separate facts. Keep them
  // grouped and independent: the cumulative total is never a context fraction,
  // and the latest request is only an approximation of what the window holds.
  const isStructured =
    data.tokenUsage?.scope === 'session-cumulative'
    || Boolean(data.tokenUsage?.cumulative)
    || Boolean(data.tokenUsage?.lastRequest);

  if (isStructured) {
    const used = readTokenQuantity(data.tokenUsage?.used);
    const window = readTokenQuantity(data.tokenUsage?.total);
    const cumulative = data.tokenUsage?.cumulative;
    // The ratio is `cacheRead / input`. Rendering it when cache read was not
    // reported would turn silence into a claimed "0% cached", so the derived
    // panel exists only when the numerator was actually reported.
    const cacheBreakdown =
      readTokenQuantity(cumulative?.cacheReadTokens) !== undefined
        ? buildCacheUsageBreakdown(toCacheUsageCounts(cumulative))
        : null;
    const ratioRow: UsageRow | null = cacheBreakdown
      ? {
          label: 'Cache hit rate',
          value: formatCacheHitRatio(cacheBreakdown.ratio),
          icon: Gauge,
          hint: 'cache read ÷ input — free, comparable across providers',
          role: 'cache-hit-ratio',
        }
      : null;
    const sections: Array<{
      title: string;
      note: string;
      rows: UsageRow[];
      cacheBreakdown?: CacheUsageBreakdown;
    }> = [
      {
        title: 'Session cumulative',
        note: 'Whole-session spend. Cached input, cache writes and reasoning output are already inside input and output.',
        rows: [
          ...(used !== undefined
            ? [{ label: 'Total tokens used', value: formatNumber(used), icon: Activity }]
            : []),
          ...(ratioRow ? [ratioRow] : []),
          ...buildCountRows(cumulative),
        ],
        ...(cacheBreakdown ? { cacheBreakdown } : {}),
      },
      {
        title: 'Latest request (context estimate)',
        note: 'Approximate context occupancy from the newest request; not a measured window reading.',
        rows: buildCountRows(data.tokenUsage?.lastRequest, { includeTotal: true }),
      },
      {
        title: 'Context window',
        note: 'Window capacity, independent of the cumulative total.',
        rows: window !== undefined
          ? [{ label: 'Window capacity', value: formatNumber(window), icon: Gauge }]
          : [],
      },
    ].filter((section) => section.rows.length > 0);

    return (
      <div
        data-testid="cost-panel"
        className="scrollbar-thin h-full space-y-4 overflow-y-auto pr-1"
      >
        {sections.map((section) => (
          <div
            key={section.title}
            className="overflow-hidden rounded-2xl border border-border/70 bg-background/75"
          >
            <div className="border-b border-border/60 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{section.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{section.note}</p>
            </div>
            {section.rows.map((row) => (
              <Fragment key={row.label}>
                <UsageRowView row={row} />
                {section.cacheBreakdown && row.role === 'cache-hit-ratio' && (
                  <CacheUsageBar breakdown={section.cacheBreakdown} />
                )}
              </Fragment>
            ))}
          </div>
        ))}

        <CostMetaCard
          provider={providerLabel}
          model={model}
          aiTitle={aiTitle}
          cacheAccountingNote={cacheAccountingNote}
        />
      </div>
    );
  }

  const used = Number(data.tokenUsage?.used ?? 0);
  const total = Number(data.tokenUsage?.total ?? 0);
  const hasBreakdown =
    typeof data.tokenBreakdown?.input === 'number' ||
    typeof data.tokenBreakdown?.output === 'number';
  const usageRows = [
    { label: 'Total tokens used', value: formatNumber(used), icon: Activity },
    ...(hasBreakdown
      ? [
          {
            label: 'Input tokens',
            value: formatNumber(Number(data.tokenBreakdown?.input ?? 0)),
            icon: TerminalSquare,
          },
          {
            label: 'Output tokens',
            value: formatNumber(Number(data.tokenBreakdown?.output ?? 0)),
            icon: Coins,
          },
        ]
      : [
          {
            label: 'Breakdown',
            value: 'Unavailable',
            icon: TerminalSquare,
          },
        ]),
    // Only when it is consistent with what was actually used. The window comes
    // from the CONTEXT_WINDOW setting, which cannot know whether a session is
    // running a 200K or a 1M variant of the same model name — and a row reading
    // "used 404,009 / window 160,000" is worse than no row at all.
    ...(total > used
      ? [{ label: 'Context window', value: formatNumber(total), icon: Gauge }]
      : []),
  ];

  return (
    <div
      data-testid="cost-panel"
      className="scrollbar-thin h-full space-y-4 overflow-y-auto pr-1"
    >
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/75">
        {usageRows.map((row) => (
          <UsageRowView key={row.label} row={row} />
        ))}
      </div>

      <CostMetaCard
        provider={providerLabel}
        model={model}
        aiTitle={aiTitle}
        cacheAccountingNote={cacheAccountingNote}
      />
    </div>
  );
}
