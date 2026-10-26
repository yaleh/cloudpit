import type { CockpitCardKind } from '@/shared/types';

/**
 * What the cockpit knows about a card kind without asking the provider: a translated badge and
 * the one small visualization the card's A zone may draw.
 *
 * WHY A TABLE AND NOT A BRANCH. `CockpitCard.kind` is an open string, so a provider may ship a
 * kind this build has never heard of. Rendering looks the kind up here and falls back to
 * {@link DEFAULT_COCKPIT_CARD_DESCRIPTOR} — the fallback is the point, not an afterthought: an
 * unknown kind must draw as an ordinary card with its facts and options, never throw and never
 * lose the confirmation path. Adding a kind is one row; no provider name appears anywhere.
 */

/** The small visualizations a card's A zone can draw. */
export type CockpitCardVizKind = 'attempts' | 'steps' | 'history' | 'size' | 'parts';

export type CockpitCardDescriptor = {
  /** The i18n key of the badge drawn in the card header. The kind label, translated. */
  labelKey: string;
  /** The small visualization this kind draws, or `null` when it draws none. */
  viz: CockpitCardVizKind | null;
};

/** Every kind this build renders, each with the reading it is best summarized by. */
const DESCRIPTORS: Record<CockpitCardKind, CockpitCardDescriptor> = {
  // A ruling with history: the same question has been asked before, and that history is the
  // most useful thing to show beside it.
  ask: { labelKey: 'cockpit.cardKindAsk', viz: 'history' },
  // Several independent decisions in one card: the useful reading is how many parts it holds.
  multi: { labelKey: 'cockpit.cardKindMulti', viz: 'parts' },
  // Something the person must supply: the reading is how much is missing.
  need: { labelKey: 'cockpit.cardKindNeed', viz: 'size' },
  // A stalled session: the reading is how many attempts it has already made.
  stuck: { labelKey: 'cockpit.cardKindStuck', viz: 'attempts' },
  // A proposed repair: the reading is the steps it would take.
  fix: { labelKey: 'cockpit.cardKindFix', viz: 'steps' },
  // A choice among release/market options: the same question's history is the useful reading.
  decision: { labelKey: 'cockpit.cardKindDecision', viz: 'history' },
};

/** The shape an unknown kind draws: a plain card, no badge text beyond the generic label, no viz. */
export const DEFAULT_COCKPIT_CARD_DESCRIPTOR: CockpitCardDescriptor = {
  labelKey: 'cockpit.cardKindOther',
  viz: null,
};

/**
 * The descriptor for a kind, known or not.
 *
 * `hasOwnProperty` rather than a bare lookup: a provider naming its kind `constructor` or
 * `toString` would otherwise receive a function from `Object.prototype` and the badge would
 * render as source code. The fallback is the same row an unknown kind gets.
 */
export function cockpitCardDescriptor(kind: string): CockpitCardDescriptor {
  if (!Object.prototype.hasOwnProperty.call(DESCRIPTORS, kind)) {
    return DEFAULT_COCKPIT_CARD_DESCRIPTOR;
  }
  return DESCRIPTORS[kind as CockpitCardKind];
}
