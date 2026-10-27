import type { CockpitCardKind } from '@/shared/types';

/**
 * The card list's published reading, and the two filter shapes it names.
 *
 * WHY THIS IS A LEAF CONTRACT. The dev-only scenario surface (`ui-scenario`) types its card
 * reading as `CockpitCardReading & { … }`; importing the type through `@/modules/cockpit`
 * would keep ui-scenario inside the cockpit's package cycle (cockpit → quay → ui-scenario →
 * cockpit). The type is data only — no runtime value — so this module imports nothing but a
 * shared type and the contract stays a leaf.
 */

/** The list's two densities: the full card and the one-line-compact shape. */
export type CockpitCardDensity = 'cards' | 'compact';

/** The type filter: every kind, or one of the known kinds. */
export type CockpitCardTypeFilter = 'all' | CockpitCardKind;

/** The one line the card list publishes for the scenario runner. */
export type CockpitCardReading = {
  visibleCardIds: string[];
  selectedCardId: string | null;
  density: CockpitCardDensity;
  typeFilter: CockpitCardTypeFilter;
  projectFilter: string | null;
  detailsOpenCardId: string | null;
  cards: Array<{
    id: string;
    shownOptionId: string | null;
    ownReply: boolean;
    confirmOptionId: string | null;
    confirmLabel: string | null;
  }>;
};
