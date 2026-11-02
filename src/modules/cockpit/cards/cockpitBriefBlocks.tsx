import type { TFunction } from 'i18next';
import type { ReactElement, ReactNode } from 'react';

import type {
  CockpitBriefBlock,
  CockpitBriefCalloutBlock,
  CockpitBriefChecklistBlock,
  CockpitBriefCompareTableBlock,
  CockpitBriefDiffstatBlock,
  CockpitBriefGraphBlock,
  CockpitBriefRadarBlock,
  CockpitBriefTimelineBlock,
} from '@/shared/types';
import { cn } from '@/shared/utils';

/**
 * The BriefSpec block renderers: one drawing per preset, reached through the description table
 * `BRIEF_BLOCK_RENDERERS` rather than a `switch` on the block type.
 *
 * WHY A TABLE. The wire declares exactly seven block types, and the server's preset registry is
 * the authority on what each one means. A table makes the vocabulary a list a new preset joins
 * once; the unknown-type path is then the table miss itself on purpose, so a future server block
 * degrades to its title and raw content instead of throwing. The criterion flips this to a
 * `switch` with no default arm to prove the unknown-block case can fail.
 *
 * WHAT A BLOCK MAY NOT DO. It does not invent values: a missing cell draws 「—」, a missing score
 * draws 「—」, an absent `done` reads as not done. Radar axis names and their 「high means」 line
 * are drawn as HTML beneath the chart, so a narrow stage can wrap them instead of squeezing the
 * SVG labels into a vertical column.
 *
 * Consumers: `CockpitBriefView.tsx` and `tests/CockpitBriefView.test.tsx`.
 */

/** What one renderer needs from the surrounding brief: the translator and option id labels. */
export type CockpitBriefBlockContext = {
  t: TFunction;
  /** Option id → the label the brief gave it; an id absent here is drawn as itself. */
  optionLabels: Readonly<Record<string, string>>;
};

type RendererTable = {
  [K in CockpitBriefBlock['type']]: (props: {
    block: Extract<CockpitBriefBlock, { type: K }>;
    context: CockpitBriefBlockContext;
  }) => ReactElement;
};

/** The radar's series strokes, in wire order; a fourth series reuses the first colour. */
const SERIES_CLASSES = [
  'stroke-primary fill-primary/10',
  'stroke-amber-500 fill-amber-500/10',
  'stroke-emerald-500 fill-emerald-500/10',
];

/** One titled block frame; every preset root carries its type for the renderer criterion. */
function BlockFrame({
  block,
  title,
  children,
}: {
  block: CockpitBriefBlock;
  /** Absent for a preset that carries no title of its own (callout); nothing is invented. */
  title?: string;
  children: ReactNode;
}) {
  return (
    <section
      data-testid={`cockpit-brief-${block.type}`}
      data-brief-block-type={block.type}
      className="mt-2"
    >
      {title !== undefined && title !== '' && (
        <h4 className="text-[11px] font-semibold text-foreground">{title}</h4>
      )}
      <div className="mt-1">{children}</div>
    </section>
  );
}

/** The option label a series/column id names, or the id itself when the brief named none. */
function optionLabel(context: CockpitBriefBlockContext, optionId: string): string {
  return context.optionLabels[optionId] ?? optionId;
}

/** A readable timestamp: the wire's ISO string, reduced to its time when it parses. */
function eventTime(at: string): string {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return at;
  return new Date(parsed).toISOString().slice(11, 16);
}

/** Radar: one polygon per option on shared axes, then an HTML axis legend that cannot squeeze. */
function RadarBlock({ block, context }: { block: CockpitBriefRadarBlock; context: CockpitBriefBlockContext }) {
  const center = 100;
  const radius = 78;
  const angles = block.axes.map(
    (_axis, index) => (-90 + (360 * index) / Math.max(block.axes.length, 1)) * (Math.PI / 180),
  );
  const pointAt = (value: number, index: number): string => {
    const clamped = Math.max(0, Math.min(100, value));
    const angle = angles[index] ?? 0;
    return `${center + Math.cos(angle) * (clamped / 100) * radius},${
      center + Math.sin(angle) * (clamped / 100) * radius
    }`;
  };

  return (
    <BlockFrame block={block} title={block.title}>
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label={block.title}
        data-testid="cockpit-brief-radar-chart"
        className="mx-auto h-auto w-full max-w-[240px]"
      >
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <circle
            key={ring}
            cx={center}
            cy={center}
            r={radius * ring}
            className="fill-none stroke-border"
            strokeWidth={0.6}
          />
        ))}
        {angles.map((angle, index) => (
          <line
            key={index}
            x1={center}
            y1={center}
            x2={center + Math.cos(angle) * radius}
            y2={center + Math.sin(angle) * radius}
            className="stroke-border"
            strokeWidth={0.6}
          />
        ))}
        {block.series.map((series, index) => (
          <polygon
            key={series.optionId}
            data-testid="cockpit-brief-radar-series"
            data-brief-option-id={series.optionId}
            points={block.axes
              .map((axis, axisIndex) => pointAt(series.values[axis.id] ?? 0, axisIndex))
              .join(' ')}
            strokeWidth={1.4}
            className={SERIES_CLASSES[index % SERIES_CLASSES.length]}
          />
        ))}
      </svg>

      <p className="mt-1 text-[10px] text-muted-foreground">{context.t('cockpit.briefRadarLegend')}</p>
      <ul data-testid="cockpit-brief-radar-axes" className="mt-1 space-y-1">
        {block.axes.map((axis) => (
          <li
            key={axis.id}
            data-testid="cockpit-brief-radar-axis"
            data-brief-axis-id={axis.id}
            data-brief-axis-basis={axis.basis}
          >
            <p className="flex flex-wrap items-baseline gap-1 text-[11px] text-foreground">
              <span aria-hidden>{axis.basis === 'mechanical' ? '●' : '○'}</span>
              <span className="font-medium">{axis.label}</span>
              <span className="text-[10px] text-muted-foreground">{axis.id}</span>
            </p>
            <p className="text-[10px] text-muted-foreground">
              {context.t('cockpit.briefHighMeans', { definition: axis.definition })}
            </p>
            <p className="flex flex-wrap gap-x-2 text-[10px] text-muted-foreground">
              {block.series.map((series) => (
                <span key={series.optionId}>
                  {optionLabel(context, series.optionId)}: {series.values[axis.id] ?? '—'}
                </span>
              ))}
            </p>
          </li>
        ))}
      </ul>
    </BlockFrame>
  );
}

/** Compare-table: rows of facts per option; `columns` are option ids, not human labels. */
function CompareTableBlock({
  block,
  context,
}: {
  block: CockpitBriefCompareTableBlock;
  context: CockpitBriefBlockContext;
}) {
  return (
    <BlockFrame block={block} title={block.title}>
      <div className="overflow-x-auto">
        <table data-testid="cockpit-brief-compare-table-grid" className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th className="border-b border-border px-1 py-0.5 text-left text-muted-foreground" />
              {block.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="border-b border-border px-1 py-0.5 text-left font-medium text-foreground"
                >
                  {optionLabel(context, column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.label} data-testid="cockpit-brief-compare-row">
                <th scope="row" className="border-b border-border px-1 py-0.5 text-left font-medium text-foreground">
                  {row.label}
                  {row.basis === 'llm' && <span aria-hidden className="ml-1 text-muted-foreground">○</span>}
                </th>
                {block.columns.map((column) => (
                  <td key={column} className="border-b border-border px-1 py-0.5 text-foreground">
                    {row.cells[column] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BlockFrame>
  );
}

/** Diffstat: one row per file with its additions/deletions and a proportional bar. */
function DiffstatBlock({ block }: { block: CockpitBriefDiffstatBlock; context: CockpitBriefBlockContext }) {
  const largest = Math.max(1, ...block.files.map((file) => file.add + file.del));
  return (
    <BlockFrame block={block} title={block.title}>
      <ul data-testid="cockpit-brief-diffstat-files" className="space-y-1">
        {block.files.map((file) => (
          <li key={file.path} data-brief-file={file.path} className="text-[10px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate font-mono text-foreground">{file.path}</span>
              <span className="shrink-0 text-muted-foreground">
                <span className="text-emerald-600 dark:text-emerald-400">+{file.add}</span>{' '}
                <span className="text-rose-600 dark:text-rose-400">−{file.del}</span>
              </span>
            </div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max(2, ((file.add + file.del) / largest) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </BlockFrame>
  );
}

/** Checklist: `done` is optional; an item without it is drawn as not done. */
function ChecklistBlock({ block }: { block: CockpitBriefChecklistBlock; context: CockpitBriefBlockContext }) {
  return (
    <BlockFrame block={block} title={block.title}>
      <ul data-testid="cockpit-brief-checklist-items" className="space-y-1">
        {block.items.map((item, index) => {
          const done = item.done === true;
          return (
            <li
              key={`${item.text}:${index}`}
              data-testid="cockpit-brief-checklist-item"
              data-done={done ? 'true' : 'false'}
              className="flex items-start gap-1.5 text-[11px]"
            >
              <span
                aria-hidden
                className={cn('mt-0.5 shrink-0', done ? 'text-primary' : 'text-muted-foreground')}
              >
                {done ? '✓' : '○'}
              </span>
              <span className={cn('min-w-0', done ? 'text-muted-foreground line-through' : 'text-foreground')}>
                {item.text}
              </span>
            </li>
          );
        })}
      </ul>
    </BlockFrame>
  );
}

/** Timeline: one ordered event per row, its dot coloured by the wire state. */
function TimelineBlock({ block }: { block: CockpitBriefTimelineBlock; context: CockpitBriefBlockContext }) {
  return (
    <BlockFrame block={block} title={block.title}>
      <ol data-testid="cockpit-brief-timeline-events" className="space-y-1">
        {block.events.map((event, index) => (
          <li
            key={`${event.at}:${index}`}
            data-testid="cockpit-brief-timeline-event"
            data-event-state={event.state}
            className="flex items-start gap-1.5 text-[11px]"
          >
            <span
              aria-hidden
              className={cn(
                'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                event.state === 'ok'
                  ? 'bg-emerald-500'
                  : event.state === 'bad'
                    ? 'bg-rose-500'
                    : 'bg-muted-foreground',
              )}
            />
            <span className="min-w-0">
              <span className="text-foreground">{event.label}</span>
              <span className="ml-1 text-[10px] text-muted-foreground">{eventTime(event.at)}</span>
            </span>
          </li>
        ))}
      </ol>
    </BlockFrame>
  );
}

/** Graph: nodes laid out left-to-right in two rows, edges drawn between their centres. */
function GraphBlock({ block }: { block: CockpitBriefGraphBlock; context: CockpitBriefBlockContext }) {
  const width = 260;
  const height = 112;
  const positions = new Map<string, { x: number; y: number }>(
    block.nodes.map((node, index) => [
      node.id,
      {
        x: 28 + (index * (width - 56)) / Math.max(block.nodes.length - 1, 1),
        y: index % 2 === 0 ? 30 : 72,
      },
    ]),
  );
  const stateClass = (state: string): string =>
    state === 'changed'
      ? 'fill-primary stroke-primary'
      : state === 'new'
        ? 'fill-emerald-500 stroke-emerald-500'
        : state === 'bad'
          ? 'fill-rose-500 stroke-rose-500'
          : 'fill-muted-foreground stroke-muted-foreground';

  return (
    <BlockFrame block={block} title={block.title}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={block.title}
        data-testid="cockpit-brief-graph-chart"
        className="h-auto w-full max-w-[360px]"
      >
        {block.edges.map((edge, index) => {
          const from = positions.get(edge.from);
          const to = positions.get(edge.to);
          if (from === undefined || to === undefined) return null;
          return (
            <line
              key={`${edge.from}->${edge.to}:${index}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              className="stroke-border"
              strokeWidth={1}
            />
          );
        })}
        {block.nodes.map((node) => {
          const position = positions.get(node.id);
          if (position === undefined) return null;
          return (
            <g key={node.id} data-testid="cockpit-brief-graph-node" data-brief-node-state={node.state}>
              <circle cx={position.x} cy={position.y} r={7} className={stateClass(node.state)} />
              <text
                x={position.x}
                y={position.y + 18}
                textAnchor="middle"
                fontSize={8}
                className="fill-foreground"
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>
    </BlockFrame>
  );
}

/** Callout: one short note, warn toned differently from info. */
function CalloutBlock({ block }: { block: CockpitBriefCalloutBlock; context: CockpitBriefBlockContext }) {
  return (
    <BlockFrame block={block}>
      <p
        data-testid="cockpit-brief-callout-body"
        data-tone={block.tone}
        className={cn(
          'rounded-md border px-2 py-1.5 text-[11px]',
          block.tone === 'warn'
            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/60 dark:bg-amber-900/30 dark:text-amber-200'
            : 'border-border bg-muted/40 text-foreground',
        )}
      >
        {block.text}
      </p>
    </BlockFrame>
  );
}

/** The description table: block type → its one renderer. A miss is the unknown-block path. */
const BRIEF_BLOCK_RENDERERS: RendererTable = {
  radar: RadarBlock,
  'compare-table': CompareTableBlock,
  diffstat: DiffstatBlock,
  checklist: ChecklistBlock,
  timeline: TimelineBlock,
  graph: GraphBlock,
  callout: CalloutBlock,
};

/** The fallback for a block type this build does not know: its title and its raw content. */
function UnknownBlock({
  block,
  context,
}: {
  block: CockpitBriefBlock;
  context: CockpitBriefBlockContext;
}) {
  const title = (block as { title?: unknown }).title;
  return (
    <BlockFrame block={block} title={typeof title === 'string' ? title : undefined}>
      <p data-testid="cockpit-brief-unknown-block" className="text-[11px] text-muted-foreground">
        {context.t('cockpit.briefUnknownBlock', { type: block.type })}
      </p>
      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/40 p-1.5 text-[10px] text-foreground">
        {JSON.stringify(block, null, 2)}
      </pre>
    </BlockFrame>
  );
}

/** Draws one brief block through the description table, or the unknown-block fallback. */
export function CockpitBriefBlockView({
  block,
  context,
}: {
  block: CockpitBriefBlock;
  context: CockpitBriefBlockContext;
}) {
  const renderer = (BRIEF_BLOCK_RENDERERS as Record<string, unknown>)[block.type];
  if (typeof renderer !== 'function') {
    return <UnknownBlock block={block} context={context} />;
  }
  const Rendered = renderer as (props: {
    block: CockpitBriefBlock;
    context: CockpitBriefBlockContext;
  }) => ReactElement;
  return <Rendered block={block} context={context} />;
}
