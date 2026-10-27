import type { TFunction } from 'i18next';

import type { CockpitCard, CockpitCardKind, CockpitCardVizKind } from '@/shared/types';

// The viz vocabulary lives on the wire (`src/shared/types.ts`) because a provider states the
// shape it wants; the descriptor table is the client-side authority on which kind may draw one.
// Re-exported here so the table and its consumers keep one import site for the vocabulary.
export type { CockpitCardVizKind } from '@/shared/types';

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

/** The short session reading used in the waiting title: the first eight id characters. */
function shortSessionId(sessionId: string): string {
  return sessionId.slice(0, 8);
}

/**
 * The card's headline, derived from its content rather than from the provider.
 *
 * A card always states an `ask` when its content was resolved. When it did not, the fallback
 * chain names what the card is about in a person's words — the session it is waiting on, the
 * task it concerns, the first measured fact — and only then the machine URI. The session copy
 * is the one case where the card is ABOUT the conversation: a session-ask card whose content
 * could not be filled says which session is waiting instead of showing `quay://…`.
 *
 * Used by `CockpitCard` (the list row) and `CockpitCardDetails` (the drawer heading).
 */
export function cockpitCardTitle(card: CockpitCard, t: TFunction): string {
  if (card.ask !== undefined && card.ask.trim() !== '') return card.ask;

  const sessionId = card.subject.sessionId?.trim() ?? '';
  if (card.contentUnavailable !== undefined && sessionId !== '') {
    return t('cockpit.cardSessionWaiting', { id: shortSessionId(sessionId) });
  }

  const taskId = card.subject.taskId?.trim() ?? '';
  if (taskId !== '') return taskId;

  const firstFact = card.facts[0]?.text.trim() ?? '';
  if (firstFact !== '') return firstFact;

  return card.subject.uri;
}
