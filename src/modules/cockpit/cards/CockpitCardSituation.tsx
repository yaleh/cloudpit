import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';

/** How many lines of a situation the Cards density draws before its inline expand control. */
const SITUATION_PREVIEW_LINES = 6;

/** The width of one card line, in Latin-glyph units (a CJK glyph is charged two). */
const SITUATION_LINE_UNITS = 56;

/**
 * Whether a situation must be previewed instead of drawn in full.
 *
 * DECIDED FROM THE TEXT, NOT FROM MEASURED HEIGHT. A criterion runs under jsdom, where every
 * element has zero height, so a measured-overflow test would green there without proving the
 * browser case. Counting explicit lines and wrapping each at a conservative phone-width line
 * gives the same answer in both places. The estimate is deliberately pessimistic: drawing the
 * expand control on a card that would just have fitted is harmless, while letting one provider's
 * paragraph push the confirm bar arbitrarily far down is the defect this control prevents.
 */
function situationRunsLong(text: string): boolean {
  let lines = 0;
  for (const line of text.split('\n')) {
    let units = 0;
    for (const char of line) {
      units += (char.codePointAt(0) ?? 0) >= 0x2e80 ? 2 : 1;
    }
    lines += Math.max(1, Math.ceil(units / SITUATION_LINE_UNITS));
  }
  return lines > SITUATION_PREVIEW_LINES;
}

export type CockpitCardSituationProps = {
  /** The decision evidence; `null` when the card has none beyond its own question. */
  situation: string | null;
  /** Why the local content resolver could not fill the card, drawn where the situation would be. */
  contentUnavailable?: string;
  /** Compact cards keep their one-line shape; Cards draws the situation in full or previewed. */
  compact: boolean;
  /** True when this card's over-long situation is expanded past the six-line preview. */
  expanded: boolean;
  /** Toggles the expansion in place (Cards only); absent means no expand control is drawn. */
  onToggleExpanded?: () => void;
};

/**
 * The card's situation block: the decision evidence, or the reason it is missing. Cards draws
 * the text in full until it runs past six lines, then keeps it behind an in-place expand control
 * so one provider's paragraph cannot push the confirm bar off the screen; Compact keeps its
 * one-line truncation. Used by `CockpitCard` only — the expansion state itself lives in
 * `cockpitCardController`, so this component renders a reading and forwards one event.
 */
export default function CockpitCardSituation({
  situation,
  contentUnavailable,
  compact,
  expanded,
  onToggleExpanded,
}: CockpitCardSituationProps) {
  const { t } = useTranslation();
  const preview =
    situation !== null &&
    !compact &&
    onToggleExpanded !== undefined &&
    situationRunsLong(situation);
  const clamped = preview && !expanded;
  return (
    <>
      {/* Why the card is missing its situation: drawn where it would have been, so the card
          never reads as an unexplained blank. In Cards the reason is decision evidence too, so
          it is never line-clamped there. */}
      {contentUnavailable !== undefined && (
        <p
          data-testid="cockpit-card-content-unavailable"
          className={cn('mt-0.5 text-xs text-muted-foreground', compact && 'line-clamp-1')}
        >
          {contentUnavailable}
        </p>
      )}

      {situation !== null && (
        <>
          <p
            data-testid="cockpit-card-zone-a-situation"
            data-clamped={clamped ? 'true' : 'false'}
            // `whitespace-pre-line` keeps provider line breaks: a situation written as several
            // lines is read as several lines, and the six-line preview then counts real lines.
            className={cn(
              'mt-0.5 whitespace-pre-line text-xs text-muted-foreground',
              compact ? 'line-clamp-1' : clamped && 'line-clamp-6',
            )}
          >
            {situation}
          </p>
          {preview && (
            <button
              type="button"
              data-testid="cockpit-card-situation-toggle"
              data-expanded={expanded ? 'true' : 'false'}
              aria-expanded={expanded}
              // The control lives inside zone A, so both its click and its Enter/Space
              // activation must stop before the zone's Details handler.
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpanded?.();
              }}
              onKeyDown={(event) => event.stopPropagation()}
              className="mt-0.5 block rounded px-1 text-[11px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
            >
              {expanded ? t('cockpit.cardSituationCollapse') : t('cockpit.cardSituationExpand')}
            </button>
          )}
        </>
      )}
    </>
  );
}
