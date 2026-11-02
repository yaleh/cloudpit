/**
 * The cockpit card list's pure derivations: everything that turns the provider's cards (plus the
 * person's own readings) into the values the list draws, with no state and no outside world.
 *
 * WHY THIS IS A SEPARATE MODULE. `cockpitCardController` owns the snapshot, its commands and its
 * lifecycle; these functions only transform their arguments. Keeping them here means each one is
 * provable from its inputs alone — no React, no clock, no transport, no store — while the
 * controller stays the single owner of "what is remembered and when it is repaired". A change to
 * how a card's default option, confirm target, dismiss target or chip count is computed therefore
 * lands in one place that any caller (the controller, a criterion) reads identically.
 *
 * NOTHING HERE READS OR WRITES STATE. None of these functions touches `Date.now`, a timer, a
 * transport or a memory store; every reading is a function of the arguments.
 *
 * The controller re-exports the public names (`shownOptionOf`, `defaultShownOption`,
 * `isIrreversibleOption`, `confirmTargetOf`, `dismissTargetOf`, `cockpitCardStateKey`,
 * `startedSessionIdOf`) so its own public surface — and therefore every existing consumer — is
 * unchanged by the extraction.
 */
import type { CockpitCard, CockpitCardOption } from '@/shared/types';
import type { CockpitCardTypeFilter } from '@/modules/cockpit-contract';
import { FEEDBACK_LOCKED_REASON } from '@/modules/cockpit/cards/cockpitCardFeedback';

/** What one card currently displays in its option area. */
export type CockpitCardShown =
  | { kind: 'option'; optionId: string }
  | { kind: 'ownReply' };

/** The confirmation the bar is bound to; when it is pending, that bar draws the confirm state. */
export type CockpitCardConfirmTarget = {
  cardId: string;
  /** The card revision the confirmation would send; the server refuses a stale one. */
  revision: number;
  /** The provider option's id, or `null` when the target is the person's own reply. */
  optionId: string | null;
  /** The reply text, or `null` when the target is a provider option. */
  replyText: string | null;
  /** What the confirm bar calls the target: the option label or the reply text. */
  label: string;
  /** True when the option carries a warning tag (or its own `warn`): draws the warning style. */
  irreversible: boolean;
  /** A target exists but may not be sent yet (an own reply with no text, an undeclared executor). */
  disabled: boolean;
  /** Why the target is disabled, drawn on the confirm bar; `null` when it can be sent. */
  disabledReason: string | null;
};

/**
 * The card-level 「忽略/丢弃」 target: a THIRD choice offered beside the shown option and the
 * person's own reply, on session-ask cards.
 *
 * It carries no option id because it sends nothing back to the conversation: the server hands the
 * provider's feedback executor a `dismiss: true` signal and the card settles. It is locked exactly
 * like the other choices while a sent action waits for its receipt.
 */
export type CockpitCardDismissTarget = {
  cardId: string;
  /** The revision the dismiss would name; the server refuses a stale one. */
  revision: number;
  /** A target exists but may not be sent yet (a sent action is awaiting its receipt). */
  disabled: boolean;
  disabledReason: string | null;
};

/** The option a shown reading names, or `null` for "nothing shown" / a vanished option. */
export function shownOptionOf(
  card: CockpitCard,
  shown: CockpitCardShown | undefined,
): CockpitCardOption | null {
  if (shown === undefined || shown.kind !== 'option') return null;
  return card.options.find((option) => option.id === shown.optionId) ?? null;
}

/**
 * The key a card's per-content state is bound to: the provider's item revision plus the local
 * content revision's own (empty when the card carries no locally resolved summary).
 *
 * Both halves are needed. The provider bumps `revision` when ITS item changes, but a locally
 * recomputed summary does not move it; `contentRevision` moves when the summary does. State
 * opened for one content (the shown option, an open dropdown, the situation's inline expansion)
 * must not be drawn over a different one, so `normalize` resets it when this key changes.
 */
export function cockpitCardStateKey(card: CockpitCard): string {
  return `${card.revision}:${card.contentRevision ?? ''}`;
}

/**
 * The option a card shows when the person has not chosen one: the one option marked `suggested`,
 * regardless of whether the recommendation came from the assistant or the judge, or nothing at
 * all. `null` is the important answer — the cockpit never promotes the first option to a default
 * the provider did not recommend.
 */
export function defaultShownOption(card: CockpitCard): CockpitCardShown | null {
  const suggested = card.options.find((option) => option.suggested);
  return suggested === undefined ? null : { kind: 'option', optionId: suggested.id };
}

/**
 * Whether choosing this option is irreversible, read from the contract's own vocabulary: a
 * `warn` sentence or a consequence tag. Both the current tag name (`irreversible`) and the
 * pre-vocabulary one (`warn`) count, so an older provider's card keeps the warning style.
 * Nothing here branches on a kind or provider.
 */
export function isIrreversibleOption(option: CockpitCardOption): boolean {
  return (
    option.warn !== undefined ||
    (option.tags ?? []).some((tag) => tag.kind === 'irreversible' || tag.kind === 'warn')
  );
}

/** The confirm target a shown reading resolves to, or `null` when there is nothing to confirm. */
export function confirmTargetOf(
  card: CockpitCard,
  shown: CockpitCardShown | undefined,
  ownReply: string | undefined,
): CockpitCardConfirmTarget | null {
  if (shown === undefined) return null;
  if (shown.kind === 'ownReply') {
    const replyText = ownReply ?? '';
    const empty = replyText.trim() === '';
    // A card whose feedback is awaiting a receipt already ran its action: only the feedback may
    // be resent, so the confirm path is locked until the receipt returns it.
    const locked = card.feedback !== undefined;
    return {
      cardId: card.id,
      revision: card.revision,
      optionId: null,
      replyText,
      label: replyText.trim(),
      irreversible: false,
      disabled: empty || locked,
      disabledReason: locked ? FEEDBACK_LOCKED_REASON : null,
    };
  }
  const option = shownOptionOf(card, shown);
  if (option === null) return null;
  // An option whose executor no provider declared stays readable and selectable, but its
  // confirmation is refused by the server; the bar states that up front instead of inviting
  // a press that is guaranteed to fail.
  const locked = card.feedback !== undefined;
  const confirmable = option.confirmable !== false && !locked;
  return {
    cardId: card.id,
    revision: card.revision,
    optionId: option.id,
    replyText: null,
    label: option.label,
    irreversible: isIrreversibleOption(option),
    disabled: !confirmable,
    disabledReason: confirmable
      ? null
      : locked
        ? FEEDBACK_LOCKED_REASON
        : (option.confirmableReason ?? option.action.executor),
  };
}

/**
 * The card-level 「忽略/丢弃」 target, or `null` when this card does not offer one.
 *
 * Only a session-ask card (`kind: 'ask'`) has the third choice: those are the cards a fleet item
 * behind an assistant question, where discarding is a meaningful alternative to answering. Any
 * other kind keeps the two-choice contract it shipped with, so the control never appears where
 * the server has no item to close.
 *
 * A sent action awaiting its receipt locks it exactly like the confirm target: the action already
 * ran, so discarding would be a second, contradictory decision on the same item.
 */
export function dismissTargetOf(card: CockpitCard): CockpitCardDismissTarget | null {
  if (card.kind !== 'ask') return null;
  const locked = card.feedback !== undefined;
  return {
    cardId: card.id,
    revision: card.revision,
    disabled: locked,
    disabledReason: locked ? FEEDBACK_LOCKED_REASON : null,
  };
}

/**
 * The conversation a confirmation opened, read from the executor's answer.
 *
 * Only `session.start` creates one, and only an answer that actually names the id can be
 * navigated to. The id is deliberately read from the RESULT rather than from the card's subject:
 * the server mints it while handling the confirmation, so the card cannot have known it.
 */
export function startedSessionIdOf(executor: string, result: unknown): string | null {
  if (executor !== 'session.start') return null;
  if (typeof result !== 'object' || result === null) return null;
  const sessionId = (result as { sessionId?: unknown }).sessionId;
  return typeof sessionId === 'string' && sessionId.trim() !== '' ? sessionId : null;
}

/** True when the card names one of the selected projects (an empty set matches everything). */
export function matchesProjectFilters(
  card: CockpitCard,
  projectFilters: readonly string[],
): boolean {
  if (projectFilters.length === 0) return true;
  return card.subject.project !== undefined && projectFilters.includes(card.subject.project);
}

/** Applies the type and project filters, preserving provider order. */
export function visibleCardsOf(
  cards: readonly CockpitCard[],
  typeFilter: CockpitCardTypeFilter,
  projectFilters: readonly string[],
): readonly CockpitCard[] {
  return cards.filter((card) => {
    if (typeFilter !== 'all' && card.kind !== typeFilter) return false;
    return matchesProjectFilters(card, projectFilters);
  });
}

/**
 * The counts on the type chips: every card that survives the PROJECT filter, grouped by kind
 * (plus `all`). A chip's number therefore answers 「how many of this type would I see」 under the
 * projects currently selected, which is what pressing it shows.
 */
export function typeCountsOf(
  cards: readonly CockpitCard[],
  projectFilters: readonly string[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = { all: 0 };
  for (const card of cards) {
    if (!matchesProjectFilters(card, projectFilters)) continue;
    counts.all += 1;
    counts[card.kind] = (counts[card.kind] ?? 0) + 1;
  }
  return counts;
}

/** The counts on the project drawer's rows: every card that survives the TYPE filter. */
export function projectCountsOf(
  cards: readonly CockpitCard[],
  typeFilter: CockpitCardTypeFilter,
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const card of cards) {
    if (typeFilter !== 'all' && card.kind !== typeFilter) continue;
    const project = card.subject.project;
    if (project === undefined || project.trim() === '') continue;
    counts[project] = (counts[project] ?? 0) + 1;
  }
  return counts;
}

/** Deduplicates a stored project selection and drops empty entries; order is the person's. */
export function normalizeProjectFilters(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  const projects: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const project = entry.trim();
    if (project !== '' && !projects.includes(project)) projects.push(project);
  }
  return projects;
}

/** Every distinct project a card names, sorted; a card with no project adds nothing. */
export function projectsOf(cards: readonly CockpitCard[]): readonly string[] {
  const projects = new Set<string>();
  for (const card of cards) {
    const project = card.subject.project;
    if (project !== undefined && project.trim() !== '') projects.add(project);
  }
  return [...projects].sort((left, right) => left.localeCompare(right));
}

/** One confirm target per card that has something to confirm; a card with nothing is absent. */
export function targetsOf(
  cards: readonly CockpitCard[],
  shown: Readonly<Record<string, CockpitCardShown>>,
  ownReplies: Readonly<Record<string, string>>,
): Readonly<Record<string, CockpitCardConfirmTarget>> {
  const targets: Record<string, CockpitCardConfirmTarget> = {};
  for (const card of cards) {
    const target = confirmTargetOf(card, shown[card.id], ownReplies[card.id]);
    if (target !== null) targets[card.id] = target;
  }
  return targets;
}

/** One dismiss target per card that offers one; a card of any other kind is absent. */
export function dismissTargetsOf(
  cards: readonly CockpitCard[],
): Readonly<Record<string, CockpitCardDismissTarget>> {
  const targets: Record<string, CockpitCardDismissTarget> = {};
  for (const card of cards) {
    const target = dismissTargetOf(card);
    if (target !== null) targets[card.id] = target;
  }
  return targets;
}
