import { Activity, Coins, Gauge, Sparkles, TerminalSquare } from 'lucide-react';

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
};

/** Reads a reported quantity, keeping "unknown" distinct from an explicit zero. */
const readTokenQuantity = (value: unknown): number | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

/** The provider/model/ai-title card shared by both `/cost` layouts. */
function CostMetaCard({
  provider,
  model,
  aiTitle,
}: {
  provider: string;
  model: string;
  aiTitle: string;
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
      </div>
    </div>
  );
}

export function CostContent({ data }: { data: CostCommandData }) {
  const model = data.model || 'Unknown';
  const provider = getProviderLabel(data.provider, data.provider || 'Unknown');
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
    const sections = [
      {
        title: 'Session cumulative',
        note: 'Whole-session spend. Cached input and reasoning output are already inside input and output.',
        rows: [
          ...(used !== undefined
            ? [{ label: 'Total tokens used', value: formatNumber(used), icon: Activity }]
            : []),
          ...buildCountRows(data.tokenUsage?.cumulative),
        ],
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
      <div className="scrollbar-thin h-full space-y-4 overflow-y-auto pr-1">
        {sections.map((section) => (
          <div
            key={section.title}
            className="overflow-hidden rounded-2xl border border-border/70 bg-background/75"
          >
            <div className="border-b border-border/60 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{section.title}</p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{section.note}</p>
            </div>
            {section.rows.map((row) => {
              const Icon = row.icon;

              return (
                <div
                  key={row.label}
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
            })}
          </div>
        ))}

        <CostMetaCard provider={provider} model={model} aiTitle={aiTitle} />
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
    <div className="scrollbar-thin h-full space-y-4 overflow-y-auto pr-1">
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/75">
        {usageRows.map((row) => {
          const Icon = row.icon;

          return (
            <div
              key={row.label}
              className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="truncate text-sm font-medium text-foreground">{row.label}</span>
              </div>
              <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          );
        })}
      </div>

      <CostMetaCard provider={provider} model={model} aiTitle={aiTitle} />
    </div>
  );
}
