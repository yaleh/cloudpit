import type { Clock, CockpitCard, CockpitCardKind, CockpitCardOption } from '@/shared/types';
import { createExternalStore, defaultClock } from '@/shared/utils';

/**
 * The cockpit card list's model: cards, filters, density, the Details stack, the option each
 * card currently shows, and the one confirmation each card owns — all outside React.
 *
 * WHY IT IS A CONTROLLER AND NOT COMPONENT STATE. Every rule here is a decision, not a
 * rendering detail: which option a card shows by default, what a confirmation is bound to,
 * whether the first press only opens the confirm card, whether a key press may change the
 * selection, and what survives a re-read. Those rules have to be provable without a browser,
 * so the controller takes its clock and its two transports through an injected seam and
 * publishes one immutable snapshot. `useCockpitCards` is only the React binding.
 *
 * THE RULES, in the order they matter:
 *
 * - ONE CONFIRMATION PER CARD, BOUND TO THE SHOWN OPTION. The confirm bar's target is derived
 *   from the shown option, so switching the option switches the target with no second write;
 *   the person's own reply is a third kind of target on the same path.
 * - TWO PRESSES, ONE REQUEST. A first press only opens the confirm card. The request leaves on
 *   the confirm card's own button, exactly once; cancelling sends nothing.
 * - NO SUGGESTION, NO DEFAULT. A provider that marks no option `suggested` leaves the card
 *   showing nothing and its confirmation unavailable. The cockpit never invents a default.
 * - NUMBER KEYS ONLY SELECT OPTIONS. `1`–`9` change the selected card's shown option and never
 *   move the selection; Escape is never handled (it aborts a conversation turn elsewhere).
 * - A NEW REVISION UPDATES IN PLACE. Re-reading replaces card content by id, keeps the
 *   selected card and the scroll anchor, and keeps every card's position in provider order.
 *
 * Consumers: `useCockpitCards` (the React binding) and `cockpitCardController.test.ts`.
 */

/** The list's two densities: the full card and the one-line-compact shape. */
export type CockpitCardDensity = 'cards' | 'compact';

/** The type filter: every kind, or one of the known kinds. */
export type CockpitCardTypeFilter = 'all' | CockpitCardKind;

/** What one card currently displays in its option area. */
export type CockpitCardShown =
  | { kind: 'option'; optionId: string }
  | { kind: 'ownReply' };

/** The confirmation the bar (and, once opened, the confirm card) is bound to. */
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
  /** A target exists but may not be sent yet (an own reply with no text). */
  disabled: boolean;
};

/** One confirmation request's transport fields, matching `POST /api/cockpit/cards/confirm`. */
export type CockpitCardConfirmRequest = {
  cardId: string;
  revision: number;
  optionId?: string;
  replyText?: string;
};

/** What a confirmation names and what the executor answered. */
export type CockpitCardConfirmOutcome =
  | { ok: true; cardId: string; executor: string; result: unknown }
  | { ok: false; cardId: string; message: string };

/**
 * The one thing the controller announces rather than stores: a confirmation that OPENED a new
 * conversation. The controller does not navigate (that is the binding's job and a router is not
 * a model), but the rule that a `session.start` confirmation is immediately followed by the new
 * conversation belongs here, where the answer is read — not re-derived in the hook.
 */
export type CockpitCardControllerEvent = {
  type: 'sessionStarted';
  /** The id the server minted for the new conversation. */
  sessionId: string;
};

/** The controller's two transports and its clock; a criterion binds all three. */
export type CockpitCardControllerDeps = {
  /** Reads every open card, in the provider's order. */
  fetchCards: () => Promise<readonly CockpitCard[]>;
  /** Sends exactly one confirmation; a rejected promise is a stated failure. */
  confirm: (
    request: CockpitCardConfirmRequest,
  ) => Promise<{ executor: string; result: unknown }>;
  /** The only clock; defaults to the browser's. */
  clock?: Clock;
  /**
   * How often to re-read in the background while started. `0` disables polling, which is what
   * a criterion uses; the hook keeps the default so another display's change arrives.
   */
  refreshIntervalMs?: number;
  /**
   * Called when a confirmation answered `session.start` and named the conversation it opened.
   * The binding navigates to it; a criterion records the event. Absent means the controller
   * still records the outcome, only nobody is told to move.
   */
  onEvent?: (event: CockpitCardControllerEvent) => void;
};

/** The immutable reading the components render. */
export type CockpitCardControllerSnapshot = {
  status: 'idle' | 'loading' | 'loaded' | 'error';
  /** The last read's failure, or `null`. */
  error: string | null;
  /** Every card the provider returned, untouched and in provider order. */
  cards: readonly CockpitCard[];
  /** The cards matching the current filters, in provider order. */
  visibleCards: readonly CockpitCard[];
  /** The project names the cards carry, sorted; the filter's options. */
  projects: readonly string[];
  typeFilter: CockpitCardTypeFilter;
  projectFilter: string | null;
  density: CockpitCardDensity;
  selectedCardId: string | null;
  /** The card the list should keep at the top of the viewport across re-reads. */
  anchorCardId: string | null;
  /** The Details stack, oldest first; the last entry is the open drawer. */
  detailsStack: readonly string[];
  /** Each card's shown option (or own reply); absent means "nothing shown yet". */
  shown: Readonly<Record<string, CockpitCardShown>>;
  /** Each card's own-reply draft. */
  ownReplies: Readonly<Record<string, string>>;
  /** The card whose option dropdown is open, if any. */
  openDropdownCardId: string | null;
  /** The confirm bar target derived from each card's shown option; absent when unavailable. */
  targets: Readonly<Record<string, CockpitCardConfirmTarget>>;
  /** The open confirm card: set by the first press, cleared by send or cancel. */
  pendingConfirm: CockpitCardConfirmTarget | null;
  /** True while the one confirmation request is in flight. */
  confirming: boolean;
  /** The last confirmation's answer, for the list's one-line echo. */
  lastOutcome: CockpitCardConfirmOutcome | null;
  /** The controller's clock reading at the last commit; the waiting-time renderer uses it. */
  now: number;
};

/** The controller's public surface: one snapshot reader, one subscription, and the commands. */
export type CockpitCardController = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => CockpitCardControllerSnapshot;
  /** Loads once, then re-reads on the configured interval until `stop`. */
  start: () => void;
  /** Stops the background re-read; the controller stays usable. */
  stop: () => void;
  /** Stops the timer and refuses later reads. */
  dispose: () => void;
  /** Reads every card and replaces the list in place. */
  load: () => Promise<void>;
  selectCard: (cardId: string) => void;
  setAnchor: (cardId: string | null) => void;
  setTypeFilter: (filter: CockpitCardTypeFilter) => void;
  setProjectFilter: (project: string | null) => void;
  setDensity: (density: CockpitCardDensity) => void;
  openDetails: (cardId: string) => void;
  closeDetails: () => void;
  openDropdown: (cardId: string | null) => void;
  showOption: (cardId: string, optionId: string) => void;
  showOwnReply: (cardId: string) => void;
  setOwnReply: (cardId: string, text: string) => void;
  /** The first press: opens the confirm card. `true` when a target was available. */
  requestConfirm: (cardId?: string) => boolean;
  /** The second press: sends the pending confirmation exactly once. */
  confirm: () => Promise<boolean>;
  /** Closes the confirm card without sending. `true` when one was open. */
  cancelConfirm: () => boolean;
  /** Handles one key; returns whether the cockpit consumed it. Escape is never consumed. */
  handleKey: (key: string) => boolean;
};

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

const initialState: CockpitCardControllerSnapshot = {
  status: 'idle',
  error: null,
  cards: [],
  visibleCards: [],
  projects: [],
  typeFilter: 'all',
  projectFilter: null,
  density: 'cards',
  selectedCardId: null,
  anchorCardId: null,
  detailsStack: [],
  shown: {},
  ownReplies: {},
  openDropdownCardId: null,
  targets: {},
  pendingConfirm: null,
  confirming: false,
  lastOutcome: null,
  now: 0,
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
 * The option a card shows when the person has not chosen one: the provider's suggested
 * option, or nothing at all. `null` is the important answer — the cockpit never promotes the
 * first option to a default the provider did not recommend.
 */
export function defaultShownOption(card: CockpitCard): CockpitCardShown | null {
  const suggested = card.options.find((option) => option.suggested);
  return suggested === undefined ? null : { kind: 'option', optionId: suggested.id };
}

/**
 * Whether choosing this option is irreversible, read from the contract's own vocabulary: a
 * `warn` tag or the option's own `warn` sentence. Nothing here branches on a kind or provider.
 */
export function isIrreversibleOption(option: CockpitCardOption): boolean {
  return option.warn !== undefined || (option.tags ?? []).some((tag) => tag.kind === 'warn');
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
    return {
      cardId: card.id,
      revision: card.revision,
      optionId: null,
      replyText,
      label: replyText.trim(),
      irreversible: false,
      disabled: replyText.trim() === '',
    };
  }
  const option = shownOptionOf(card, shown);
  if (option === null) return null;
  return {
    cardId: card.id,
    revision: card.revision,
    optionId: option.id,
    replyText: null,
    label: option.label,
    irreversible: isIrreversibleOption(option),
    disabled: false,
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

/** Applies the type and project filters, preserving provider order. */
function visibleCardsOf(
  cards: readonly CockpitCard[],
  typeFilter: CockpitCardTypeFilter,
  projectFilter: string | null,
): readonly CockpitCard[] {
  return cards.filter((card) => {
    if (typeFilter !== 'all' && card.kind !== typeFilter) return false;
    if (projectFilter !== null && card.subject.project !== projectFilter) return false;
    return true;
  });
}

/** Every distinct project a card names, sorted; a card with no project adds nothing. */
function projectsOf(cards: readonly CockpitCard[]): readonly string[] {
  const projects = new Set<string>();
  for (const card of cards) {
    const project = card.subject.project;
    if (project !== undefined && project.trim() !== '') projects.add(project);
  }
  return [...projects].sort((left, right) => left.localeCompare(right));
}

function targetsOf(
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

/** A failure rendered as a sentence without leaking a stack trace into the stage. */
function failureMessage(failure: unknown): string {
  if (failure instanceof Error && failure.message.trim() !== '') return failure.message;
  return String(failure);
}

/**
 * Normalizes a patched snapshot. Every derived reading and every piece of per-card state is
 * repaired here, in one place, so no command has to remember the invariants:
 *
 *   - a removed card drops its shown option, draft, dropdown and Details entry;
 *   - the selection and the anchor fall back only when their card is no longer visible;
 *   - the confirm card closes when its card is gone or its revision moved (a stale revision
 *     would be refused by the server, so leaving it open would invite a guaranteed failure).
 */
function normalize(
  next: CockpitCardControllerSnapshot,
  now: number,
): CockpitCardControllerSnapshot {
  const cards = next.cards;
  const byId = new Map(cards.map((card) => [card.id, card]));
  const visibleCards = visibleCardsOf(cards, next.typeFilter, next.projectFilter);
  const visibleIds = new Set(visibleCards.map((card) => card.id));

  // Every card gets a shown reading when it first arrives: the provider's suggested option, or
  // nothing. A stored reading that no longer resolves (the revision dropped that option, or the
  // card no longer offers a free-text reply) falls back the same way instead of leaving a
  // confirm bar pointing at an option the card no longer has.
  const shown: Record<string, CockpitCardShown> = {};
  for (const card of cards) {
    const previous = next.shown[card.id];
    const resolvable =
      previous !== undefined &&
      (previous.kind === 'ownReply'
        ? card.ownReply !== undefined
        : card.options.some((option) => option.id === previous.optionId));
    const reading = resolvable ? previous : defaultShownOption(card);
    if (reading !== null) shown[card.id] = reading;
  }
  const ownReplies: Record<string, string> = {};
  for (const [cardId, text] of Object.entries(next.ownReplies)) {
    if (byId.has(cardId)) ownReplies[cardId] = text;
  }

  const selectedCardId =
    next.selectedCardId !== null && visibleIds.has(next.selectedCardId)
      ? next.selectedCardId
      : (visibleCards[0]?.id ?? null);
  const anchorCardId =
    next.anchorCardId !== null && byId.has(next.anchorCardId)
      ? next.anchorCardId
      : null;
  const detailsStack = next.detailsStack.filter((cardId) => byId.has(cardId));
  const openDropdownCardId =
    next.openDropdownCardId !== null && byId.has(next.openDropdownCardId)
      ? next.openDropdownCardId
      : null;

  const targets = targetsOf(cards, shown, ownReplies);
  let pendingConfirm = next.pendingConfirm;
  if (pendingConfirm !== null) {
    const card = byId.get(pendingConfirm.cardId);
    if (card === undefined || card.revision !== pendingConfirm.revision) pendingConfirm = null;
  }

  return {
    ...next,
    cards,
    visibleCards,
    projects: projectsOf(cards),
    shown,
    ownReplies,
    selectedCardId,
    anchorCardId,
    detailsStack,
    openDropdownCardId,
    targets,
    pendingConfirm,
    now,
  };
}

/**
 * Builds one controller. `deps` is the whole outside world: two transports and a clock.
 */
export function createCockpitCardController(
  deps: CockpitCardControllerDeps,
): CockpitCardController {
  const clock = deps.clock ?? defaultClock;
  const refreshIntervalMs = Math.max(0, deps.refreshIntervalMs ?? 20_000);
  const store = createExternalStore<CockpitCardControllerSnapshot>(initialState);

  let started = false;
  let disposed = false;
  let timer: unknown = null;
  let inFlightRead: Promise<void> | null = null;
  let confirming = false;

  /** The one write path: patch the snapshot, normalize it, publish. */
  const commit = (patch: Partial<CockpitCardControllerSnapshot>): void => {
    if (disposed) return;
    store.update((previous) => normalize({ ...previous, ...patch }, clock.now()));
  };

  const read = async (): Promise<void> => {
    if (disposed) return;
    if (inFlightRead !== null) return inFlightRead;
    const run = (async () => {
      if (store.getSnapshot().status !== 'loaded') {
        commit({ status: 'loading', error: null });
      }
      try {
        const cards = await deps.fetchCards();
        if (disposed) return;
        commit({ status: 'loaded', error: null, cards: [...cards] });
      } catch (failure) {
        if (disposed) return;
        commit({ status: 'error', error: failureMessage(failure) });
      }
    })();
    inFlightRead = run;
    try {
      await run;
    } finally {
      inFlightRead = null;
    }
  };

  const start = (): void => {
    if (started || disposed) return;
    started = true;
    void read();
    if (refreshIntervalMs > 0) {
      timer = clock.setInterval(() => {
        void read();
      }, refreshIntervalMs);
    }
  };

  const stop = (): void => {
    started = false;
    if (timer !== null) {
      clock.clearInterval(timer);
      timer = null;
    }
  };

  const showReading = (cardId: string, shown: CockpitCardShown): void => {
    const card = store.getSnapshot().cards.find((candidate) => candidate.id === cardId);
    if (card === undefined) return;
    // Changing what is shown changes what would be confirmed: an open confirm card for this
    // card no longer names the person's current choice, so it closes rather than sending it.
    const pending = store.getSnapshot().pendingConfirm;
    commit({
      shown: { ...store.getSnapshot().shown, [cardId]: shown },
      openDropdownCardId: null,
      ...(pending !== null && pending.cardId === cardId ? { pendingConfirm: null } : {}),
    });
  };

  const requestConfirm = (cardId?: string): boolean => {
    const snapshot = store.getSnapshot();
    const targetId = cardId ?? snapshot.selectedCardId;
    if (targetId === null) return false;
    const target = snapshot.targets[targetId];
    if (target === undefined || target.disabled) return false;
    commit({ pendingConfirm: target, lastOutcome: null });
    return true;
  };

  const confirm = async (): Promise<boolean> => {
    const pending = store.getSnapshot().pendingConfirm;
    if (pending === null || confirming) return false;
    confirming = true;
    commit({ confirming: true });
    const request: CockpitCardConfirmRequest = {
      cardId: pending.cardId,
      revision: pending.revision,
      ...(pending.optionId === null
        ? { replyText: pending.replyText ?? '' }
        : { optionId: pending.optionId }),
    };
    let outcome: CockpitCardConfirmOutcome;
    try {
      const answer = await deps.confirm(request);
      outcome = {
        ok: true,
        cardId: pending.cardId,
        executor: answer.executor,
        result: answer.result,
      };
    } catch (failure) {
      outcome = { ok: false, cardId: pending.cardId, message: failureMessage(failure) };
      // A failed confirmation did not happen; closing the card avoids re-sending a revision
      // the server may already have moved past.
      commit({ pendingConfirm: null, lastOutcome: outcome });
    } finally {
      confirming = false;
      commit({ confirming: false });
    }
    if (outcome.ok) {
      commit({ pendingConfirm: null, lastOutcome: outcome });
      // A `session.start` confirmation opened a conversation: announce it BEFORE the re-read so
      // the binding's navigation is not queued behind a network round-trip. The announcement is
      // outside the try above on purpose — a listener that throws is not a failed confirmation.
      const sessionId = startedSessionIdOf(outcome.executor, outcome.result);
      if (sessionId !== null) deps.onEvent?.({ type: 'sessionStarted', sessionId });
      // Re-read so a provider that bumped the revision is reflected IN PLACE. The selection,
      // anchor and order are preserved by `normalize`.
      await read();
    }
    return outcome.ok;
  };

  const handleKey = (key: string): boolean => {
    if (key === 'Escape') return false;
    const match = /^([1-9])$/.exec(key);
    if (match === null) return false;
    const snapshot = store.getSnapshot();
    if (snapshot.selectedCardId === null) return false;
    const card = snapshot.cards.find((candidate) => candidate.id === snapshot.selectedCardId);
    if (card === undefined) return false;
    const option = card.options[Number(match[1]) - 1];
    if (option === undefined) return false;
    showReading(card.id, { kind: 'option', optionId: option.id });
    return true;
  };

  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    start,
    stop,
    dispose: () => {
      disposed = true;
      stop();
    },
    load: read,
    selectCard: (cardId) => {
      const snapshot = store.getSnapshot();
      if (!snapshot.visibleCards.some((card) => card.id === cardId)) return;
      commit({ selectedCardId: cardId });
    },
    setAnchor: (cardId) => commit({ anchorCardId: cardId }),
    setTypeFilter: (filter) => commit({ typeFilter: filter }),
    setProjectFilter: (project) => commit({ projectFilter: project }),
    setDensity: (density) => commit({ density }),
    openDetails: (cardId) => {
      const snapshot = store.getSnapshot();
      if (!snapshot.cards.some((card) => card.id === cardId)) return;
      const without = snapshot.detailsStack.filter((candidate) => candidate !== cardId);
      commit({ detailsStack: [...without, cardId] });
    },
    closeDetails: () => {
      const snapshot = store.getSnapshot();
      if (snapshot.detailsStack.length === 0) return;
      commit({ detailsStack: snapshot.detailsStack.slice(0, -1) });
    },
    openDropdown: (cardId) => commit({ openDropdownCardId: cardId }),
    showOption: (cardId, optionId) => {
      const card = store.getSnapshot().cards.find((candidate) => candidate.id === cardId);
      if (card === undefined || !card.options.some((option) => option.id === optionId)) return;
      showReading(cardId, { kind: 'option', optionId });
    },
    showOwnReply: (cardId) => {
      const card = store.getSnapshot().cards.find((candidate) => candidate.id === cardId);
      // A card with no own-reply executor would produce a confirmation the server refuses
      // (`declares no own-reply executor`), so the editor is only offered where it can send.
      if (card === undefined || card.ownReply === undefined) return;
      showReading(cardId, { kind: 'ownReply' });
    },
    setOwnReply: (cardId, text) => {
      const snapshot = store.getSnapshot();
      const card = snapshot.cards.find((candidate) => candidate.id === cardId);
      if (card === undefined || card.ownReply === undefined) return;
      const pending = snapshot.pendingConfirm;
      commit({
        ownReplies: { ...snapshot.ownReplies, [cardId]: text },
        shown: { ...snapshot.shown, [cardId]: { kind: 'ownReply' } },
        ...(pending !== null && pending.cardId === cardId ? { pendingConfirm: null } : {}),
      });
    },
    requestConfirm,
    confirm,
    cancelConfirm: () => {
      if (store.getSnapshot().pendingConfirm === null) return false;
      commit({ pendingConfirm: null });
      return true;
    },
    handleKey,
  };
}

/**
 * The card list's `data-cockpit-cards` reading: visible ids in order, the selection, each
 * card's shown option / confirm target, and whether Details is open. Published on the list's
 * root so a scenario runner reads state instead of inferring it from the DOM.
 */
export function cockpitCardsReading(
  snapshot: CockpitCardControllerSnapshot,
): CockpitCardReading {
  return {
    visibleCardIds: snapshot.visibleCards.map((card) => card.id),
    selectedCardId: snapshot.selectedCardId,
    density: snapshot.density,
    typeFilter: snapshot.typeFilter,
    projectFilter: snapshot.projectFilter,
    detailsOpenCardId: snapshot.detailsStack[snapshot.detailsStack.length - 1] ?? null,
    cards: snapshot.visibleCards.map((card) => {
      const shown = snapshot.shown[card.id];
      const target = snapshot.targets[card.id];
      return {
        id: card.id,
        shownOptionId: shown !== undefined && shown.kind === 'option' ? shown.optionId : null,
        ownReply: shown !== undefined && shown.kind === 'ownReply',
        confirmOptionId: target?.optionId ?? null,
        confirmLabel: target?.label ?? null,
      };
    }),
  };
}
