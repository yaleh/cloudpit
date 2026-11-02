import { cockpitFactShortForm } from '@/modules/cockpit/cockpitCardDescriptors';
import CockpitCardViz from '@/modules/cockpit/cards/CockpitCardViz';
import type { CockpitCard as CockpitCardData, CockpitCardFact } from '@/shared/types';

export type CockpitCardFactsProps = {
  /** The whole card, because the small visualization reads the card's own `viz` reading. */
  card: CockpitCardData;
  /** The facts this card still has to state; facts the situation repeats are already filtered out. */
  facts: CockpitCardFact[];
};

/**
 * The A zone's fact row: pills with the small visualization on the right.
 *
 * A pill is a SHORT FORM: the sentence it abbreviates stays in `title` and, untruncated, in
 * Details. It is a pure presentational block — `CockpitCard` decides whether the row is drawn
 * at all (Cards only, and only when there is a fact or a viz) and which facts survive the
 * situation filter; this component draws them. Used by `CockpitCard` only.
 */
export default function CockpitCardFacts({ card, facts }: CockpitCardFactsProps) {
  return (
    <div className="mt-1.5 flex items-center justify-between gap-2">
      {facts.length > 0 && (
        <div
          data-testid="cockpit-card-zone-a-facts"
          className="flex min-w-0 flex-wrap items-center gap-1"
        >
          {facts.map((fact, index) => (
            <span
              key={`${fact.text}:${index}`}
              data-testid="cockpit-card-fact"
              data-mechanical={fact.mechanical ? 'true' : 'false'}
              data-full-text={fact.text}
              title={fact.text}
              className="max-w-[16rem] truncate rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
            >
              <span aria-hidden className="mr-0.5">{fact.mechanical ? '●' : '○'}</span>
              {cockpitFactShortForm(fact.text)}
            </span>
          ))}
        </div>
      )}
      <span className="ml-auto shrink-0">
        <CockpitCardViz card={card} />
      </span>
    </div>
  );
}
