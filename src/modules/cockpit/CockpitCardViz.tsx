import type { CockpitCard as CockpitCardData, CockpitCardViz as CockpitCardVizData } from '@/shared/types';
import { cn } from '@/shared/utils';
import { cockpitCardDescriptor } from '@/modules/cockpit/cockpitCardDescriptors';

/**
 * The small visualization a card's A zone draws, selected by the known kind's descriptor row.
 *
 * Used by `CockpitCard`; exported through the cockpit barrel so a sibling criterion can render a
 * shape without the whole card. The table lookup is the authority: the shape is chosen from
 * `descriptor.viz`, never from the card's kind or provider, so a new provider kind gets a shape by
 * adding a descriptor row and a card gains one only by naming that same kind.
 *
 * The graphic is decoration for scanning: `aria-hidden`, no locale copy, and every reading is
 * repeated as a `data-*` attribute so a criterion reads the same numbers a person sees. Rendering
 * is total — an unknown kind, a card with no viz, or a viz whose kind disagrees with the
 * descriptor all draw nothing and never throw, because card data comes from a provider.
 */

/** The circled numerals the `parts` shape draws. Past ten, the plain 1-based index is used. */
const PART_NUMERALS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

/** A finite, non-negative whole number, or `fallback` when the provider's reading is unusable. */
function wholeReading(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/** The shape itself, chosen by the descriptor-vetted viz kind. */
function VizShape({ viz }: { viz: CockpitCardVizData }) {
  switch (viz.kind) {
    case 'attempts': {
      const count = wholeReading(viz.count, 0);
      return (
        <>
          <span data-viz-count={count} className="tabular-nums text-[10px]">
            {count}×
          </span>
          <span className="flex items-center gap-0.5">
            {Array.from({ length: count }, (_, index) => (
              <span key={index} data-viz-dot="attempt" className="h-1.5 w-1.5 rounded-full bg-current" />
            ))}
          </span>
        </>
      );
    }
    case 'steps': {
      // The step position is 1-based; anything outside 1..3 is clamped so the three nodes always
      // keep one current marker.
      const current = Math.min(3, Math.max(1, wholeReading(viz.count, 1)));
      return (
        <span className="flex items-center gap-0.5">
          {[1, 2, 3].map((step) => (
            <span
              key={step}
              data-viz-step={step}
              data-viz-current={step === current ? 'true' : undefined}
              className={cn(
                'h-1.5 w-3 rounded-full',
                step <= current ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </span>
      );
    }
    case 'history': {
      const history = viz.history ?? { yes: 0, no: 0, other: 0 };
      const segments = [
        { key: 'yes', weight: wholeReading(history.yes, 0), className: 'bg-emerald-500' },
        { key: 'no', weight: wholeReading(history.no, 0), className: 'bg-rose-500' },
        { key: 'other', weight: wholeReading(history.other, 0), className: 'bg-muted-foreground/40' },
      ];
      const total = segments.reduce((sum, segment) => sum + segment.weight, 0);
      return (
        <span className="flex h-1.5 w-16 overflow-hidden rounded-full">
          {segments.map((segment) => (
            <span
              key={segment.key}
              data-viz-segment={segment.key}
              className={segment.className}
              style={{ width: total > 0 ? `${(segment.weight / total) * 100}%` : '0%' }}
            />
          ))}
        </span>
      );
    }
    case 'size': {
      const current = wholeReading(viz.size?.current, 0);
      const total = wholeReading(viz.size?.total, 0);
      const ratio = total > 0 ? current / total : 0;
      // The reading stays the literal current/total; only the fill is clamped to its track.
      return (
        <span
          data-viz-ratio={ratio}
          className="relative h-1.5 w-16 overflow-hidden rounded-full bg-muted"
        >
          <span
            data-viz-fill="size"
            className="absolute inset-y-0 left-0 bg-primary"
            style={{ width: `${Math.min(1, ratio) * 100}%` }}
          />
        </span>
      );
    }
    case 'parts': {
      const count = wholeReading(viz.count, 0);
      return (
        <span className="flex items-center gap-0.5">
          {Array.from({ length: count }, (_, index) => (
            <span
              key={index}
              data-viz-part={index + 1}
              className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted text-[9px] text-muted-foreground"
            >
              {PART_NUMERALS[index] ?? String(index + 1)}
            </span>
          ))}
        </span>
      );
    }
    default:
      return null;
  }
}

export default function CockpitCardViz({ card }: { card: CockpitCardData }) {
  const descriptor = cockpitCardDescriptor(card.kind);
  const viz = card.viz;

  // The descriptor owns whether this kind may draw anything; the card only supplies the reading.
  // A mismatch is not an error condition — it is a card that draws no shape.
  if (descriptor.viz === null || viz === undefined || viz.kind !== descriptor.viz) {
    return null;
  }

  return (
    <span
      data-testid="cockpit-card-viz"
      data-viz-kind={viz.kind}
      aria-hidden="true"
      className="inline-flex items-center gap-1 text-muted-foreground"
    >
      <VizShape viz={viz} />
    </span>
  );
}
