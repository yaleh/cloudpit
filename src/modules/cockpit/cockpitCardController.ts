import type {
  Clock,
  CockpitBriefResponse,
  CockpitCard,
} from '@/shared/types';
import { createBoundedLru, createExternalStore, defaultClock } from '@/shared/utils';
import type {
  CockpitCardDensity,
  CockpitCardReading,
  CockpitCardTypeFilter,
} from '@/modules/cockpit-contract';
import {
  awaitingFeedbackCount,
  canResendFeedback,
  feedbackOptionGone,
  feedbackPhaseOf,
  feedbackPhasesOf,
  FEEDBACK_OPTION_GONE_REASON,
  type CockpitCardFeedbackPhase,
} from '@/modules/cockpit/cockpitCardFeedback';
import { cockpitCardDuplicateGroups } from '@/modules/cockpit/cockpitCardDuplicates';
import {
  cockpitCardStateKey,
  defaultShownOption,
  dismissTargetsOf,
  normalizeProjectFilters,
  projectCountsOf,
  projectsOf,
  startedSessionIdOf,
  targetsOf,
  typeCountsOf,
  visibleCardsOf,
  type CockpitCardConfirmTarget,
  type CockpitCardDismissTarget,
  type CockpitCardShown,
} from '@/modules/cockpit/cockpitCardDerived';

/**
 * The pure derivations live in `cockpitCardDerived.ts`; the controller re-exports its public
 * names so the module's surface — and every existing consumer — is unchanged by the extraction.
 */
export {
  cockpitCardStateKey,
  confirmTargetOf,
  defaultShownOption,
  dismissTargetOf,
  isIrreversibleOption,
  shownOptionOf,
  startedSessionIdOf,
} from '@/modules/cockpit/cockpitCardDerived';
export type {
  CockpitCardConfirmTarget,
  CockpitCardDismissTarget,
  CockpitCardShown,
} from '@/modules/cockpit/cockpitCardDerived';

/**
 * The cockpit card list's model: cards, filters, density, the Details stack, the option each
 * card currently shows, and the one confirmation each card owns — all outside React.
 *
 * WHY IT IS A CONTROLLER AND NOT COMPONENT STATE. Every rule here is a decision, not a
 * rendering detail: which option a card shows by default, what a confirmation is bound to,
 * whether the first press only opens the in-place confirm state, whether a key press may change
 * the selection, and what survives a re-read. Those rules have to be provable without a browser,
 * so the controller takes its clock and its two transports through an injected seam and
 * publishes one immutable snapshot. `useCockpitCards` is only the React binding.
 *
 * THE RULES, in the order they matter:
 *
 * - ONE CONFIRMATION PER CARD, BOUND TO THE SHOWN OPTION. The confirm bar's target is derived
 *   from the shown option, so switching the option switches the target with no second write;
 *   the person's own reply is a third kind of target on the same path.
 * - TWO KINDS OF CONFIRMATION, BOUND TO THE SHOWN OPTION. A reversible option is ONE press: a
 *   five-second countdown runs on the injected clock, fires the request exactly once, and the
 *   same button cancels it while it runs. Switching the shown option, moving the revision or
 *   selecting another card cancels it without sending. An irreversible option keeps the
 *   in-place two-press state: the first press opens it, the second sends, and the ~6 s retreat
 *   sends nothing. Both states replace the card's own bar in the same element and place.
 * - NO SUGGESTION, NO DEFAULT. The card shows the one option the provider marked `suggested`,
 *   whatever its source (`assistant`, `judge` or `provider`). Only a card where the provider
 *   marks nothing shows nothing and confirms nothing. The cockpit never invents a default.
 * - NUMBER KEYS ONLY SELECT OPTIONS. `1`–`9` change the selected card's shown option and never
 *   move the selection; Escape is never handled (it aborts a conversation turn elsewhere).
 * - A NEW REVISION UPDATES IN PLACE. Re-reading replaces card content by id, keeps the
 *   selected card and the scroll anchor, and keeps every card's position in provider order.
 * - AN EXPANDED SITUATION BELONGS TO ITS REVISION. The inline expand control is a reading of one
 *   situation, so it is recorded with the card id AND the revision it was opened at; a re-read
 *   that moves the revision drops it, because the new situation would otherwise be drawn full
 *   height without the person asking for it.
 * - THE SAME QUESTION IS ONE CARD. Cards that name the same session and normalize to the same
 *   question are folded behind the latest one (`cockpitCardDuplicates.ts`); the folded cards are
 *   not visible, not counted and own no confirmation target until the person expands them. The
 *   expansion is a reading keyed by the kept card id, re-derived on every read, never persisted.
 *
 * Consumers: `useCockpitCards` (the React binding) and `cockpitCardController.test.ts`.
 *
 * WHAT IT IS NOT. The pure derivations — the shown option, the confirm/dismiss target, the chip
 * counts, the filtered list, the project list — live in `cockpitCardDerived.ts` and are re-exported
 * here unchanged. This module owns the snapshot, the one write path and the lifecycle; a rule that
 * only transforms its arguments does not belong in it.
 */

/** The list's two densities: the full card and the one-line-compact shape. */
export type {
  CockpitCardDensity,
  CockpitCardReading,
  CockpitCardTypeFilter,
} from '@/modules/cockpit-contract';

/**
 * One card's brief reading. Every non-idle state carries the CARD revision it was read at, so a
 * re-read that bumps the revision invalidates the reading without a second comparison rule; the
 * wire response's own `revision` is the transcript's ask revision and is not interchangeable.
 */
export type CockpitBriefState =
  | { status: 'idle' }
  | { status: 'loading'; cardRevision: number }
  | { status: 'ready'; cardRevision: number; response: CockpitBriefResponse }
  | { status: 'error'; cardRevision: number; message: string };

/**
 * The delayed send a normal option's confirmation is counting down.
 *
 * A reversible confirmation is ONE press: the request leaves when the countdown fires, and the
 * same button cancels it while it runs. The countdown carries the card and the revision it would
 * send (a revision move invalidates it, exactly like a pending confirmation) plus both clock
 * readings the button needs — the deadline for the seconds it states, and the start for the
 * progress fill. Times are read from the injected clock; the component writes no timer.
 */
export type CockpitCardSendCountdown = {
  /** The card whose confirmation will be sent. */
  cardId: string;
  /** The card revision the send names; a revision change cancels the countdown. */
  revision: number;
  /** The clock reading the countdown started at (the progress fill's zero). */
  startedAt: number;
  /** The clock reading the send fires at. */
  firesAt: number;
};

/** One confirmation request's transport fields, matching `POST /api/cockpit/cards/confirm`. */
export type CockpitCardConfirmRequest = {
  cardId: string;
  revision: number;
  optionId?: string;
  replyText?: string;
  /**
   * The server-issued reference a knowledge suggestion's decision must present. Copied from the
   * card's own `knowledge.confirmationRef`; the controller never invents one.
   */
  confirmationRef?: string;
};

/** One dismiss request's transport fields, matching `POST /api/cockpit/cards/dismiss`. */
export type CockpitCardDismissRequest = {
  cardId: string;
  revision: number;
};

/** The one-line notice a dismiss leaves in the list; the card itself has usually left by then. */
export type CockpitCardDismissNotice = {
  cardId: string;
  ok: boolean;
  message: string;
};

/** What a successful dismiss says: the card was discarded, not sent. */
export const CARD_DISMISSED_NOTICE = '已忽略';

/** What a confirmation names and what the executor answered. */
export type CockpitCardConfirmOutcome =
  | { ok: true; cardId: string; executor: string; result: unknown }
  | { ok: false; cardId: string; message: string };

/**
 * The one thing the controller announces rather than stores: a confirmation that OPENED a new
 * conversation. The controller does not navigate (a router is not a model) and neither does the
 * binding any more — a card-started session runs in the BACKGROUND, so moving the display into
 * it would be the opposite of what the person asked for. What the controller does do is attach
 * the minted id to the confirmed card as its `conversation`, so the card states 「打开会话」 the
 * moment the answer lands (and keeps stating it across the re-read) instead of making the person
 * hunt for the session. The announcement stays for a binding that wants to do something else
 * with it.
 */
export type CockpitCardControllerEvent = {
  type: 'sessionStarted';
  /** The id the server minted for the new conversation. */
  sessionId: string;
};

/**
 * What the cards page leaves behind when its route unmounts, and reads back when it returns.
 *
 * WHY A SEAM AND NOT COMPONENT STATE. The page is a ROUTE: opening a card's conversation unmounts
 * it, and coming back mounts a new controller. The rule this type carries is "the person returns
 * to the card they were reading, at the scroll offset they left", so the memory has to outlive
 * one controller. Injecting it also makes the round trip provable without a browser.
 */
export type CockpitCardMemoryState = {
  selectedCardId: string | null;
  /** The list's `scrollTop`, in CSS pixels. */
  scrollPosition: number;
};

/** The two verbs the controller needs from a memory; a test passes a plain object. */
export type CockpitCardMemory = {
  read: () => CockpitCardMemoryState | null;
  write: (state: CockpitCardMemoryState) => void;
};

/**
 * The two filter readings the card page keeps PER DEVICE, not per tab.
 *
 * The route memory above belongs to one tab (coming back from a conversation should land where
 * the person left). A filter is a preference: the same person filtering to their projects on a
 * phone expects that choice on the next visit, and a second window must read the same one. That
 * is why this is a separate seam with its own storage — local, not session.
 */
export type CockpitCardFilters = {
  typeFilter: CockpitCardTypeFilter;
  /** The selected projects; an empty set means every project. */
  projectFilters: readonly string[];
};

/** The two verbs the controller needs from the filter memory; a test passes a plain object. */
export type CockpitCardFilterMemory = {
  read: () => CockpitCardFilters | null;
  write: (state: CockpitCardFilters) => void;
};

/** The controller's two transports and its clock; a criterion binds all three. */
export type CockpitCardControllerDeps = {
  /** Reads every open card, in the provider's order. */
  fetchCards: () => Promise<readonly CockpitCard[]>;
  /** Sends exactly one confirmation; a rejected promise is a stated failure. */
  confirm: (
    request: CockpitCardConfirmRequest,
  ) => Promise<{ executor: string; result: unknown }>;
  /**
   * Reads one card's brief. Absent means the surface cannot show a brief: `loadBrief` then does
   * nothing and the Details drawer keeps its other sections.
   */
  fetchBrief?: (cardId: string) => Promise<CockpitBriefResponse>;
  /**
   * Re-sends the feedback of a card whose action already ran. Absent means the surface cannot
   * resend: the button then states that instead of disappearing without a reason.
   */
  resendFeedback?: (cardId: string) => Promise<unknown>;
  /**
   * Discards a card without sending anything back to its conversation. Absent means the surface
   * cannot dismiss: no target is offered, so the button never appears without a path.
   */
  dismiss?: (request: CockpitCardDismissRequest) => Promise<unknown>;
  /** The only clock; defaults to the browser's. */
  clock?: Clock;
  /**
   * Where the selection and scroll offset survive a route change. Absent means the list starts
   * fresh; the page's binding supplies a tab-scoped store.
   */
  remember?: CockpitCardMemory;
  /**
   * Where the type/project filters survive a reload. Absent means every visit starts unfiltered;
   * the page's binding supplies a device-scoped store.
   */
  rememberFilters?: CockpitCardFilterMemory;
  /**
   * How often to re-read in the background while started. `0` disables polling, which is what
   * a criterion uses; the hook keeps the default so another display's change arrives.
   */
  refreshIntervalMs?: number;
  /**
   * Called when a confirmation answered `session.start` and named the conversation it opened.
   * Informational only: the controller has already attached the id to the card, and the binding
   * does NOT navigate (the session runs in the background). A criterion records the event.
   * Absent means nobody else is told; the card's own reading is unchanged.
   */
  onEvent?: (event: CockpitCardControllerEvent) => void;
};

/**
 * The folded duplicates behind one KEPT card.
 *
 * `hiddenIds` is in provider order, so an expansion draws the earlier cards where they already
 * were; `expanded` is the only part the person controls. The reading is keyed by the kept card id
 * and recomputed from the card list on every read — never persisted, like `openDropdownCardId`.
 */
export type CockpitCardDuplicatesState = {
  hiddenIds: string[];
  expanded: boolean;
};

/** The immutable reading the components render. */
export type CockpitCardControllerSnapshot = {  status: 'idle' | 'loading' | 'loaded' | 'error';
  /** The last read's failure, or `null`. */
  error: string | null;
  /** Every card the provider returned, untouched and in provider order. */
  cards: readonly CockpitCard[];
  /**
   * The cards the list draws, in provider order: folded duplicates removed until their kept card
   * is expanded, when they return at their original position.
   */
  visibleCards: readonly CockpitCard[];
  /**
   * Each KEPT card whose question was asked more than once, mapped to the folded cards and
   * whether the person expanded them. A card with nothing folded has no entry.
   */
  duplicates: Readonly<Record<string, CockpitCardDuplicatesState>>;
  /**
   * How many distinct open questions the provider returned — every folded duplicate counts once,
   * and the filters do not apply (this is the column/header's 「N waiting for you」).
   */
  openCount: number;
  /** The project names the cards carry, sorted; the filter's options. */
  projects: readonly string[];
  typeFilter: CockpitCardTypeFilter;
  /** The projects whose cards are shown; empty means every project. */
  projectFilters: readonly string[];
  /**
   * The single-project compatibility reading of {@link projectFilters}: the one project when
   * exactly one is selected, `null` when none or several. The published card reading predates
   * multi-select and still carries one id-or-null field.
   */
  projectFilter: string | null;
  /** Cards per type under the PROJECT filter and after folding, keyed by kind plus `all`. */
  typeCounts: Readonly<Record<string, number>>;
  /** Cards per project under the TYPE filter and after folding; the drawer's counts. */
  projectCounts: Readonly<Record<string, number>>;
  density: CockpitCardDensity;
  selectedCardId: string | null;
  /** The scroll offset the list last reported, restored when the page is mounted again. */
  scrollPosition: number;
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
  /** Each card's brief reading; absent means "never asked for". */
  briefs: Readonly<Record<string, CockpitBriefState>>;
  /**
   * Each card whose over-long situation is expanded in place (Cards density), mapped to the card
   * REVISION it was expanded at. The revision is the reset key: new content is a new situation,
   * so an expansion opened for the old one does not carry over.
   */
  situationExpanded: Readonly<Record<string, number>>;
  /** The confirm bar target derived from each card's shown option; absent when unavailable. */
  targets: Readonly<Record<string, CockpitCardConfirmTarget>>;
  /**
   * The card-level 「忽略/丢弃」 target per session-ask card. It sits BESIDE {@link targets} rather
   * than replacing the shown option's target: the two are separate choices, and the person may
   * confirm either one.
   */
  dismissTargets: Readonly<Record<string, CockpitCardDismissTarget>>;
  /** The dismiss confirmation state: set by the first press, cleared by send or cancel. */
  pendingDismiss: CockpitCardDismissTarget | null;
  /** The card whose dismiss request is in flight, or `null`. */
  dismissingCardId: string | null;
  /** The last dismiss answer, drawn as one line in the list; `null` until the first one. */
  dismissNotice: CockpitCardDismissNotice | null;
  /**
   * The irreversible option's two-step confirmation: set by the first press, cleared by send,
   * cancel or the ~6 s retreat. A REVERSIBLE option never appears here — its first press starts
   * {@link sendCountdown} instead.
   */
  pendingConfirm: CockpitCardConfirmTarget | null;
  /**
   * The reversible option's delayed send: the card, its revision and the deadline. The same
   * button cancels it while it runs; the countdown survives `stop()` so a route change still
   * sends.
   */
  sendCountdown: CockpitCardSendCountdown | null;
  /** True while the one confirmation request is in flight. */
  confirming: boolean;
  /**
   * The card whose confirmation request is in flight, or `null`. The boolean above says a request
   * is running; this says WHICH bar keeps its countdown/confirm state while it does, so the send
   * that starts when the countdown expires is still drawn on the same button instead of the bar
   * briefly falling back to its idle label.
   */
  confirmingCardId: string | null;
  /** The last confirmation's answer, for the list's one-line echo. */
  lastOutcome: CockpitCardConfirmOutcome | null;
  /**
   * Each card with a sent-but-unconfirmed feedback, mapped to its phase at `now`. Derived in
   * `normalize` from the card overlay and the injected clock, so the status line, the resend
   * control and the header count read one answer.
   */
  feedbackPhases: Readonly<Record<string, CockpitCardFeedbackPhase>>;
  /** How many cards are waiting for a receipt; the list header's second number. */
  awaitingFeedback: number;
  /** The card whose feedback resend is in flight, or `null`. */
  resendingFeedbackCardId: string | null;
  /** The last failed resend, drawn beside that card; cleared by the next attempt. */
  feedbackResendError: { cardId: string; message: string } | null;
  /**
   * Each card's `(revision, contentRevision)` key at the previous normalize. A change between two
   * reads means the card's content was replaced, so the per-content state below (shown option,
   * open dropdown, inline expansion, brief) is dropped rather than carried over. Internal
   * bookkeeping; the display never reads it.
   */
  cardStateKeys: Readonly<Record<string, string>>;
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
  /** Records the list's scroll offset, so returning to the page restores it. */
  setScrollPosition: (position: number) => void;
  setAnchor: (cardId: string | null) => void;
  setTypeFilter: (filter: CockpitCardTypeFilter) => void;
  /** Replaces the project selection with one project (or clears it) — the single-select shim. */
  setProjectFilter: (project: string | null) => void;
  /** Adds or removes one project from the multi-select drawer's set. */
  toggleProjectFilter: (project: string) => void;
  /** Clears every project filter (「All projects」). */
  clearProjectFilters: () => void;
  setDensity: (density: CockpitCardDensity) => void;
  openDetails: (cardId: string) => void;
  /** Reads one card's brief once per (card, revision); a failed read may be retried. */
  loadBrief: (cardId: string) => void;
  closeDetails: () => void;
  openDropdown: (cardId: string | null) => void;
  /** Expands or collapses one card's over-long situation in place (Cards density). */
  toggleSituationExpanded: (cardId: string) => void;
  /**
   * Expands or collapses the earlier cards folded behind one KEPT card, in place. A card with
   * nothing folded has no entry in `duplicates` and nothing to toggle.
   */
  toggleDuplicates: (cardId: string) => void;
  showOption: (cardId: string, optionId: string) => void;
  showOwnReply: (cardId: string) => void;
  setOwnReply: (cardId: string, text: string) => void;
  /** The first press: opens the in-place confirm state. `true` when a target was available. */
  requestConfirm: (cardId?: string) => boolean;
  /** Sends an irreversible option's pending confirmation exactly once (the second press). */
  confirm: () => Promise<boolean>;
  /**
   * Re-sends ONLY the feedback after the 2-minute window; the action is never re-executed.
   * Returns whether a resend request was made.
   */
  resendFeedback: (cardId: string) => Promise<boolean>;
  /**
   * The first press on 「忽略/丢弃」: opens the in-place dismiss confirmation. Sends nothing; the
   * card's options and its own confirm bar are untouched.
   */
  requestDismiss: (cardId: string) => boolean;
  /** The dismiss confirmation's second press: sends exactly one dismiss request. */
  confirmDismiss: () => Promise<boolean>;
  /** Leaves the dismiss confirmation without sending; the card keeps its options. */
  cancelDismiss: () => boolean;
  /** Cancels either the irreversible confirm state or a running countdown, sending nothing. */
  cancelConfirm: () => boolean;
  /** Handles one key; returns whether the cockpit consumed it. Escape is never consumed. */
  handleKey: (key: string) => boolean;
};

const initialState: CockpitCardControllerSnapshot = {
  status: 'idle',
  error: null,
  cards: [],
  visibleCards: [],
  duplicates: {},
  openCount: 0,
  projects: [],
  typeFilter: 'all',
  projectFilters: [],
  projectFilter: null,
  typeCounts: {},
  projectCounts: {},
  density: 'cards',
  selectedCardId: null,
  scrollPosition: 0,
  anchorCardId: null,
  detailsStack: [],
  shown: {},
  ownReplies: {},
  openDropdownCardId: null,
  briefs: {},
  situationExpanded: {},
  targets: {},
  dismissTargets: {},
  pendingDismiss: null,
  dismissingCardId: null,
  dismissNotice: null,
  pendingConfirm: null,
  sendCountdown: null,
  confirming: false,
  confirmingCardId: null,
  lastOutcome: null,
  feedbackPhases: {},
  awaitingFeedback: 0,
  resendingFeedbackCardId: null,
  feedbackResendError: null,
  cardStateKeys: {},
  now: 0,
};

/**
 * How long the in-place confirm state waits for its second press.
 *
 * The confirm state replaces the card's own bar, so it stays visible only while the person is
 * still looking at the card they pressed: roughly six seconds without a second press and it
 * retreats, sending nothing. The delay goes through the injected clock (never a component timer),
 * which is what lets a criterion drive it without sleeping.
 */
const CONFIRM_RETREAT_MS = 6_000;

/**
 * How long a reversible option waits before it sends.
 *
 * The first press starts this countdown and the request leaves when it expires; the same button
 * cancels it while it runs. Five seconds is long enough to catch a mis-press and short enough
 * that the person who pressed once is not left wondering. A refresh or a closed tab kills the
 * browser timer (nothing is sent); a route change does NOT — `stop()` deliberately leaves it
 * armed, so leaving the page after pressing still sends.
 */
const DELAYED_SEND_MS = 5_000;

/**
 * How often the feedback reading is recomputed while a card waits for a receipt. It only
 * re-publishes `now`, so the 2-minute window and its resend appear without a provider push.
 */
const FEEDBACK_TICK_MS = 1_000;

/**
 * How often the countdown re-publishes `now` while it runs.
 *
 * The seconds and the progress fill are read from the injected clock, so the snapshot has to move
 * for the button to count down. A quarter second keeps the fill smooth without a render per frame.
 */
const SEND_COUNTDOWN_TICK_MS = 250;

/** The types a card kind can be filtered to, in the order the chips list them. */
const KNOWN_CARD_KINDS = ['need', 'stuck', 'fix', 'ask', 'multi', 'decision'] as const;

/**
 * The stored filter selection, or `null` for "nothing usable". A blocked or malformed store is
 * not a card-page failure: the next visit simply starts unfiltered.
 */
function readFilterMemory(
  memory: CockpitCardFilterMemory | undefined,
): CockpitCardFilters | null {
  if (memory === undefined) return null;
  try {
    const state = memory.read();
    if (state === null) return null;
    const typeFilter = (KNOWN_CARD_KINDS as readonly string[]).includes(state.typeFilter)
      ? state.typeFilter
      : 'all';
    return {
      typeFilter: typeFilter as CockpitCardTypeFilter,
      projectFilters: normalizeProjectFilters(state.projectFilters),
    };
  } catch {
    return null;
  }
}

/**
 * The remembered state, or `null` for "nothing usable". A disabled/unreadable store is not a
 * failure the card page may show: it just starts at the top.
 */
function readMemory(memory: CockpitCardMemory | undefined): CockpitCardMemoryState | null {
  if (memory === undefined) return null;
  try {
    const state = memory.read();
    if (state === null) return null;
    return {
      selectedCardId:
        typeof state.selectedCardId === 'string' && state.selectedCardId.trim() !== ''
          ? state.selectedCardId
          : null,
      scrollPosition:
        typeof state.scrollPosition === 'number' && Number.isFinite(state.scrollPosition)
          ? Math.max(0, state.scrollPosition)
          : 0,
    };
  } catch {
    return null;
  }
}

/** A failure rendered as a sentence without leaking a stack trace into the stage. */
function failureMessage(failure: unknown): string {
  if (failure instanceof Error && failure.message.trim() !== '') return failure.message;
  return String(failure);
}

/** The stable machine code a transport failure carries, when it carries one. */
function failureCode(failure: unknown): string | null {
  if (typeof failure !== 'object' || failure === null) return null;
  const code = (failure as { code?: unknown }).code;
  return typeof code === 'string' && code !== '' ? code : null;
}

/**
 * Normalizes a patched snapshot. Every derived reading and every piece of per-card state is
 * repaired here, in one place, so no command has to remember the invariants:
 *
 *   - a removed card drops its shown option, draft, dropdown and Details entry;
 *   - a card whose `(revision, contentRevision)` key moved drops every reading opened on the
 *     previous content (shown option, open dropdown, inline expansion, brief);
 *   - the selection and the anchor fall back only when their card is no longer visible;
 *   - the confirm state closes when its card is gone or its revision moved (a stale revision
 *     would be refused by the server, so leaving it open would invite a guaranteed failure).
 */
function normalize(
  next: CockpitCardControllerSnapshot,
  now: number,
  dismissAvailable: boolean,
): CockpitCardControllerSnapshot {
  const cards = next.cards;
  const byId = new Map(cards.map((card) => [card.id, card]));
  const projectFilters = normalizeProjectFilters(next.projectFilters);

  // THE SAME QUESTION IS ONE CARD. The grouping is recomputed from the provider's list on every
  // read, so a new duplicate joins the existing fold without any stored state; the only memory is
  // whether the person expanded a fold, kept on the KEPT card's id. A fold whose kept card changed
  // (a newer duplicate arrived) is a different group, so it starts collapsed.
  const folds = cockpitCardDuplicateGroups(cards);
  const foldedIds = new Set<string>();
  const expandedIds = new Set<string>();
  const duplicates: Record<string, CockpitCardDuplicatesState> = {};
  for (const fold of folds) {
    for (const cardId of fold.hidden) foldedIds.add(cardId);
    const previous = next.duplicates[fold.keep];
    const expanded = previous !== undefined && previous.expanded;
    duplicates[fold.keep] = { hiddenIds: [...fold.hidden], expanded };
    if (expanded) for (const cardId of fold.hidden) expandedIds.add(cardId);
  }
  // What a folded duplicate does not do: appear, count, or own a confirmation target. The KEPT
  // cards (plus any expanded earlier card) are the list; the kept cards alone are every count.
  const keptCards = cards.filter((card) => !foldedIds.has(card.id));
  const drawableCards = cards.filter(
    (card) => !foldedIds.has(card.id) || expandedIds.has(card.id),
  );
  const visibleCards = visibleCardsOf(drawableCards, next.typeFilter, projectFilters);
  const visibleIds = new Set(visibleCards.map((card) => card.id));

  // Each card's `(revision, contentRevision)` is the identity of the content its per-card state
  // was opened on. A key that moved between two reads means a DIFFERENT set of options is drawn
  // over the same card: the option ids are label-derived, so an old id may now name nothing (or
  // worse, a different option), and carrying a shown option/dropdown/expansion/brief over would
  // display a reading the person never chose for this content.
  const cardStateKeys: Record<string, string> = {};
  for (const card of cards) cardStateKeys[card.id] = cockpitCardStateKey(card);
  const contentChanged = (cardId: string): boolean => {
    const previous = next.cardStateKeys[cardId];
    return previous !== undefined && previous !== cardStateKeys[cardId];
  };

  // Every card gets a shown reading when it first arrives: the provider's suggested option, or
  // nothing. A stored reading that no longer resolves (the revision dropped that option, or the
  // card no longer offers a free-text reply) falls back the same way instead of leaving a
  // confirm bar pointing at an option the card no longer has. A reading that was opened on
  // replaced content is dropped too, even when its option id happens to still resolve.
  const shown: Record<string, CockpitCardShown> = {};
  for (const card of cards) {
    const previous = next.shown[card.id];
    const resolvable =
      previous !== undefined &&
      !contentChanged(card.id) &&
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
  // A brief reading belongs to the content it was read at: a re-read that bumped either revision
  // makes an already-drawn brief stale, so the next open asks again. A removed card drops its
  // reading with everything else it owned.
  const briefs: Record<string, CockpitBriefState> = {};
  for (const [cardId, reading] of Object.entries(next.briefs)) {
    const card = byId.get(cardId);
    if (card === undefined) continue;
    if (reading.status === 'idle' || (reading.cardRevision === card.revision && !contentChanged(cardId))) {
      briefs[cardId] = reading;
    }
  }

  // An expansion belongs to the situation it was opened on: a removed card drops it, and a card
  // whose content was replaced (either revision moved) drops it too — the re-read brought
  // different content.
  const situationExpanded: Record<string, number> = {};
  for (const [cardId, revision] of Object.entries(next.situationExpanded)) {
    const card = byId.get(cardId);
    if (card !== undefined && card.revision === revision && !contentChanged(cardId)) {
      situationExpanded[cardId] = revision;
    }
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
  // An open dropdown belongs to the content it was opened on: replaced content changes the
  // options, so the open list would show entries the card no longer has.
  const openDropdownCardId =
    next.openDropdownCardId !== null &&
    byId.has(next.openDropdownCardId) &&
    !contentChanged(next.openDropdownCardId)
      ? next.openDropdownCardId
      : null;

  // The feedback reading is derived from the provider's list plus the overlay timestamps: a card
  // keeps its place, and only its phase/status changes with the clock.
  const feedbackPhases = feedbackPhasesOf(cards, now);
  const awaitingFeedback = awaitingFeedbackCount(cards);
  const resendingFeedbackCardId =
    next.resendingFeedbackCardId !== null && byId.has(next.resendingFeedbackCardId)
      ? next.resendingFeedbackCardId
      : null;
  const feedbackResendError =
    next.feedbackResendError !== null && byId.has(next.feedbackResendError.cardId)
      ? next.feedbackResendError
      : null;

  const targets = targetsOf(drawableCards, shown, ownReplies);
  // The dismiss target is offered only when the surface can send one (a binding without the
  // transport must not draw a button that cannot work), and it follows the same folded-duplicate
  // rule as the confirm target: a folded card owns neither.
  const dismissTargets: Readonly<Record<string, CockpitCardDismissTarget>> = dismissAvailable
    ? dismissTargetsOf(drawableCards)
    : {};
  let pendingDismiss = next.pendingDismiss;
  if (pendingDismiss !== null) {
    const target = dismissTargets[pendingDismiss.cardId];
    if (target === undefined || target.disabled || target.revision !== pendingDismiss.revision) {
      pendingDismiss = null;
    }
  }
  // A dismiss in flight names its card only while that card still exists; a removed card leaves
  // nothing to draw the answer on (the list-level notice is what survives the card).
  const dismissingCardId =
    next.dismissingCardId !== null && byId.has(next.dismissingCardId)
      ? next.dismissingCardId
      : null;
  let pendingConfirm = next.pendingConfirm;
  if (pendingConfirm !== null) {
    const card = byId.get(pendingConfirm.cardId);
    if (card === undefined || card.revision !== pendingConfirm.revision) pendingConfirm = null;
  }
  // A running send belongs to the revision it was started on: a removed card or a moved revision
  // cancels it, exactly like the pending confirmation above. (A shown-option switch is cancelled
  // by the command that switches it; this is the re-read's half of the same rule.)
  let sendCountdown = next.sendCountdown;
  if (sendCountdown !== null) {
    const card = byId.get(sendCountdown.cardId);
    if (card === undefined || card.revision !== sendCountdown.revision) sendCountdown = null;
  }
  // A request in flight names its card only while that card still exists; a removed card leaves
  // nothing to draw the answer on.
  const confirmingCardId =
    next.confirmingCardId !== null && byId.has(next.confirmingCardId)
      ? next.confirmingCardId
      : null;

  return {
    ...next,
    cards,
    visibleCards,
    duplicates,
    openCount: keptCards.length,
    projectFilters,
    // The single-value compatibility reading: one selected project, or `null` for "none/many".
    projectFilter: projectFilters.length === 1 ? projectFilters[0] : null,
    projects: projectsOf(cards),
    typeCounts: typeCountsOf(keptCards, projectFilters),
    projectCounts: projectCountsOf(keptCards, next.typeFilter),
    shown,
    ownReplies,
    briefs,
    situationExpanded,
    selectedCardId,
    anchorCardId,
    detailsStack,
    openDropdownCardId,
    targets,
    dismissTargets,
    pendingDismiss,
    dismissingCardId,
    pendingConfirm,
    sendCountdown,
    confirmingCardId,
    feedbackPhases,
    awaitingFeedback,
    resendingFeedbackCardId,
    feedbackResendError,
    cardStateKeys,
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
  const remembered = readMemory(deps.remember);
  const rememberedFilters = readFilterMemory(deps.rememberFilters);
  const store = createExternalStore<CockpitCardControllerSnapshot>({
    ...initialState,
    scrollPosition: remembered?.scrollPosition ?? 0,
    // The filter memory seeds the snapshot directly, unlike the route selection: a filter needs
    // no card list to be usable, so applying it on the first read would flash the unfiltered list.
    typeFilter: rememberedFilters?.typeFilter ?? initialState.typeFilter,
    projectFilters: rememberedFilters?.projectFilters ?? [],
    projectFilter:
      rememberedFilters !== null && rememberedFilters.projectFilters.length === 1
        ? rememberedFilters.projectFilters[0]!
        : null,
  });
  // The selected card from the previous visit. It cannot seed the snapshot directly: `normalize`
  // only keeps a selection whose card is visible, and at construction no card has been read yet.
  // It is applied on the first successful read instead, where the card list can be checked.
  let pendingSelection = remembered?.selectedCardId ?? null;
  /**
   * The conversation each `session.start` confirmation opened, by card id.
   *
   * Kept BESIDE the card rather than written into `lastOutcome` only: the card's Details link
   * reads `conversation`, and a background session that the display did not follow must still be
   * one press away. It survives re-reads (which replace the whole list with the provider's
   * projection) and is the reason a card that had no session before the confirmation shows
   * 「打开会话」 after it.
   */
  const startedSessions = new Map<string, string>();

  let started = false;
  let disposed = false;
  let timer: unknown = null;
  let inFlightRead: Promise<void> | null = null;
  let confirming = false;
  /** The irreversible confirm state's retreat timer, armed by `requestConfirm` on the clock. */
  let confirmRetreatTimer: unknown = null;
  /** The reversible countdown's send deadline and its UI tick, both on the injected clock. */
  let sendCountdownTimer: unknown = null;
  let sendCountdownTicker: unknown = null;
  /** The feedback reading's tick, armed only while some card is waiting for a receipt. */
  let feedbackTicker: unknown = null;

  /** Disarms the retreat; called whenever no confirm state is open any more. */
  const clearConfirmRetreat = (): void => {
    if (confirmRetreatTimer === null) return;
    clock.clearTimeout(confirmRetreatTimer);
    confirmRetreatTimer = null;
  };

  /** Disarms a running countdown's send and its tick; called when the countdown leaves. */
  const clearSendCountdownTimers = (): void => {
    if (sendCountdownTimer !== null) {
      clock.clearTimeout(sendCountdownTimer);
      sendCountdownTimer = null;
    }
    if (sendCountdownTicker !== null) {
      clock.clearInterval(sendCountdownTicker);
      sendCountdownTicker = null;
    }
  };

  /**
   * Arms the one retreat for the confirm state that is opening now.
   *
   * Only a new `requestConfirm` re-arms it. Every way the state can close — the second press, a
   * cancel, an option switch, a revision, another selection — closes it through `commit`, which
   * disarms this timer from the one place that can see the state is gone.
   */
  const armConfirmRetreat = (): void => {
    clearConfirmRetreat();
    confirmRetreatTimer = clock.setTimeout(() => {
      confirmRetreatTimer = null;
      if (disposed || store.getSnapshot().pendingConfirm === null) return;
      commit({ pendingConfirm: null });
    }, CONFIRM_RETREAT_MS);
  };

  /**
   * Arms the one-second re-publish while any card waits for a receipt, and disarms it when none
   * does. The resend control's appearance at 2 minutes is therefore a clock reading, not a
   * component timer.
   */
  const syncFeedbackTicker = (): void => {
    if (disposed) return;
    if (store.getSnapshot().awaitingFeedback === 0) {
      if (feedbackTicker !== null) {
        clock.clearInterval(feedbackTicker);
        feedbackTicker = null;
      }
      return;
    }
    if (feedbackTicker !== null) return;
    feedbackTicker = clock.setInterval(() => {
      if (disposed || store.getSnapshot().awaitingFeedback === 0) return;
      commit({});
    }, FEEDBACK_TICK_MS);
  };

  /** The one write path: patch the snapshot, normalize it, publish. */
  const commit = (patch: Partial<CockpitCardControllerSnapshot>): void => {
    if (disposed) return;
    store.update((previous) =>
      normalize({ ...previous, ...patch }, clock.now(), deps.dismiss !== undefined),
    );
    // `normalize` may also close the state (a vanished card, a moved revision), so the check is
    // on the committed snapshot rather than on `patch`.
    if (store.getSnapshot().pendingConfirm === null) clearConfirmRetreat();
    if (store.getSnapshot().sendCountdown === null) clearSendCountdownTimers();
    syncFeedbackTicker();
  };

  /** Closes a running countdown without sending: cancelling and every retreat share this path. */
  const cancelSendCountdown = (): boolean => {
    if (store.getSnapshot().sendCountdown === null) return false;
    commit({ sendCountdown: null });
    return true;
  };

  /**
   * Leaves the current selection and scroll offset for the next visit. A memory that refuses the
   * write (quota, privacy mode, a test stub) is not a card-page failure: the page still works,
   * it only starts at the top next time.
   */
  const writeMemory = (): void => {
    if (deps.remember === undefined) return;
    const snapshot = store.getSnapshot();
    try {
      deps.remember.write({
        selectedCardId: snapshot.selectedCardId,
        scrollPosition: snapshot.scrollPosition,
      });
    } catch {
      // See above: remembering is an enhancement, never a precondition.
    }
  };

  /** Leaves the filters for the next visit on this device; a refusing store changes nothing. */
  const writeFilters = (): void => {
    const memory = deps.rememberFilters;
    if (memory === undefined) return;
    const snapshot = store.getSnapshot();
    try {
      memory.write({
        typeFilter: snapshot.typeFilter,
        projectFilters: [...snapshot.projectFilters],
      });
    } catch {
      // The page still filters for this visit; only the preference did not stick.
    }
  };

  /**
   * Adds the session a confirmation opened to the card that opened it.
   *
   * The provider's projection is authoritative for a card that already names a conversation;
   * this only fills the gap for a card that had none when the person confirmed it. Without it
   * the next background re-read would erase the id the answer just named, and the person who
   * chose to stay on the cards page would lose the only link to the conversation they started.
   */
  const withStartedSessions = (cards: readonly CockpitCard[]): CockpitCard[] =>
    cards.map((card) => {
      const startedSessionId = startedSessions.get(card.id);
      if (startedSessionId === undefined || card.conversation !== undefined) return card;
      return { ...card, conversation: { sessionId: startedSessionId } };
    });

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
        commit({ status: 'loaded', error: null, cards: withStartedSessions(cards) });
        // `normalize` has just fallen back to the first visible card, because at construction
        // there was no card list to check the remembered selection against. Now there is one:
        // restore it once, and only if the card is still on the list and matches the filters.
        if (pendingSelection !== null) {
          const rememberedCardId = pendingSelection;
          pendingSelection = null;
          if (store.getSnapshot().visibleCards.some((card) => card.id === rememberedCardId)) {
            commit({ selectedCardId: rememberedCardId });
          }
        }
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
    // DELIBERATELY NOT the send countdown. The page is a route: leaving it calls this method, and
    // a confirmation the person already started must still leave. Only `dispose` (the controller
    // being thrown away) disarms it.
  };

  const showReading = (cardId: string, shown: CockpitCardShown): void => {
    const card = store.getSnapshot().cards.find((candidate) => candidate.id === cardId);
    if (card === undefined) return;
    // The options are locked while the feedback is unconfirmed: changing what is shown would
    // offer a confirmation of an action that already ran.
    if (card.feedback !== undefined) return;
    // Changing what is shown changes what would be confirmed: an open confirm state or a running
    // countdown for this card no longer names the person's current choice, so it closes rather
    // than sending it.
    const pending = store.getSnapshot().pendingConfirm;
    const countdown = store.getSnapshot().sendCountdown;
    commit({
      shown: { ...store.getSnapshot().shown, [cardId]: shown },
      openDropdownCardId: null,
      ...(pending !== null && pending.cardId === cardId ? { pendingConfirm: null } : {}),
      ...(countdown !== null && countdown.cardId === cardId ? { sendCountdown: null } : {}),
    });
  };

  /** Whether the card still reads at the revision a brief request was issued for. */
  const briefRevisionIsCurrent = (cardId: string, cardRevision: number): boolean =>
    store
      .getSnapshot()
      .cards.some((candidate) => candidate.id === cardId && candidate.revision === cardRevision);

  /** Brief responses by `cardId#cardRevision`, so closing and reopening Details is a cache read. */
  const briefCache = createBoundedLru<string, CockpitBriefResponse>(64);
  const briefsInFlight = new Set<string>();

  /**
   * The one brief request path. It is called by `openDetails`, so the drawer never decides
   * whether a read is needed: a ready/loading reading for the current revision is a no-op, a
   * cached response is published without a request, and a response that lands after the card
   * moved to another revision is dropped rather than drawn over newer content.
   */
  const loadBrief = (cardId: string): void => {
    if (disposed) return;
    const fetchBrief = deps.fetchBrief;
    const card = store.getSnapshot().cards.find((candidate) => candidate.id === cardId);
    if (fetchBrief === undefined || card === undefined) return;
    const cardRevision = card.revision;
    const current = store.getSnapshot().briefs[cardId];
    if (
      current !== undefined &&
      current.status !== 'idle' &&
      current.status !== 'error' &&
      current.cardRevision === cardRevision
    ) {
      return;
    }
    const key = `${cardId}#${cardRevision}`;
    if (briefsInFlight.has(key)) return;
    const cached = briefCache.get(key);
    if (cached !== undefined) {
      commit({
        briefs: {
          ...store.getSnapshot().briefs,
          [cardId]: { status: 'ready', cardRevision, response: cached },
        },
      });
      return;
    }
    commit({
      briefs: {
        ...store.getSnapshot().briefs,
        [cardId]: { status: 'loading', cardRevision },
      },
    });
    briefsInFlight.add(key);
    void (async () => {
      try {
        const response = await fetchBrief(cardId);
        if (disposed || !briefRevisionIsCurrent(cardId, cardRevision)) return;
        briefCache.set(key, response);
        commit({
          briefs: {
            ...store.getSnapshot().briefs,
            [cardId]: { status: 'ready', cardRevision, response },
          },
        });
      } catch (failure) {
        if (disposed || !briefRevisionIsCurrent(cardId, cardRevision)) return;
        commit({
          briefs: {
            ...store.getSnapshot().briefs,
            [cardId]: {
              status: 'error',
              cardRevision,
              message: failureMessage(failure),
            },
          },
        });
      } finally {
        briefsInFlight.delete(key);
      }
    })();
  };

  /**
   * Starts the reversible option's countdown.
   *
   * The deadline and the UI tick both live on the injected clock: the timeout is the send, the
   * interval only re-publishes `now` so the button's seconds and fill move. Arming happens AFTER
   * the state is committed, so `commit`'s "no countdown ⇒ clear the timers" rule cannot cancel the
   * countdown it just published.
   */
  const startSendCountdown = (target: CockpitCardConfirmTarget): void => {
    clearSendCountdownTimers();
    const startedAt = clock.now();
    commit({
      sendCountdown: {
        cardId: target.cardId,
        revision: target.revision,
        startedAt,
        firesAt: startedAt + DELAYED_SEND_MS,
      },
      lastOutcome: null,
    });
    sendCountdownTicker = clock.setInterval(() => {
      if (store.getSnapshot().sendCountdown === null) return;
      commit({});
    }, SEND_COUNTDOWN_TICK_MS);
    sendCountdownTimer = clock.setTimeout(() => {
      sendCountdownTimer = null;
      fireSendCountdown();
    }, DELAYED_SEND_MS);
  };

  /**
   * The countdown's deadline: closes the countdown and sends exactly once.
   *
   * The target is re-read from the committed snapshot rather than captured, so a countdown whose
   * card left the list, whose revision moved or whose option became unconfirmable sends nothing.
   * `commit({ sendCountdown: null })` disarms the tick through the same rule every other exit uses.
   */
  const fireSendCountdown = (): void => {
    if (disposed) return;
    const snapshot = store.getSnapshot();
    const countdown = snapshot.sendCountdown;
    if (countdown === null) return;
    clearSendCountdownTimers();
    const target = snapshot.targets[countdown.cardId];
    commit({ sendCountdown: null });
    if (target === undefined || target.revision !== countdown.revision || target.disabled) return;
    void send(target);
  };

  const requestConfirm = (cardId?: string): boolean => {
    const snapshot = store.getSnapshot();
    const targetId = cardId ?? snapshot.selectedCardId;
    if (targetId === null) return false;
    // A request already in flight owns the confirm state: reopening it under the running request
    // would let the first answer close a state the person opened for something else.
    if (confirming) return false;
    // One countdown at a time: a second one would arm a second timer nobody can see or cancel.
    if (snapshot.sendCountdown !== null) return false;
    // One decision at a time: an open dismiss confirmation owns the card until it is confirmed
    // or cancelled.
    if (snapshot.pendingDismiss !== null) return false;
    const target = snapshot.targets[targetId];
    if (target === undefined || target.disabled) return false;
    // The warning options keep the two-press confirmation: the person must press again, on the
    // same button, within the retreat window. Everything else sends once the countdown expires.
    if (target.irreversible) {
      commit({ pendingConfirm: target, lastOutcome: null });
      armConfirmRetreat();
      return true;
    }
    startSendCountdown(target);
    return true;
  };

  /**
   * The one request path: the irreversible state's second press and the countdown's deadline
   * both arrive here, and exactly one of them can be in flight at a time (`confirming`).
   */
  const send = async (pending: CockpitCardConfirmTarget): Promise<boolean> => {
    if (confirming) return false;
    confirming = true;
    commit({ confirming: true, confirmingCardId: pending.cardId });
    // A knowledge suggestion's decision presents the reference the SERVER minted for the card
    // revision the person is looking at. It is copied, never constructed: a caller-supplied
    // identity is not proof and the server refuses one.
    const card = store.getSnapshot().cards.find((candidate) => candidate.id === pending.cardId);
    const confirmationRef = card?.knowledge?.confirmationRef;
    const request: CockpitCardConfirmRequest = {
      cardId: pending.cardId,
      revision: pending.revision,
      ...(pending.optionId === null
        ? { replyText: pending.replyText ?? '' }
        : { optionId: pending.optionId }),
      ...(confirmationRef === undefined ? {} : { confirmationRef }),
    };
    let outcome: CockpitCardConfirmOutcome;
    // A stale revision is answered with the CURRENT one. The card on screen must be re-read, or
    // the person would keep pressing a button the server already refused as outdated.
    let staleRevision = false;
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
      staleRevision = failureCode(failure) === 'REVISION_CONFLICT';
      // A failed confirmation did not happen; closing the card avoids re-sending a revision
      // the server may already have moved past.
      commit({ pendingConfirm: null, lastOutcome: outcome });
    }
    try {
      if (!outcome.ok && staleRevision) {
        // Re-read after the request settled, so the refreshed card replaces the stale one in place.
        await read();
      }
      if (outcome.ok) {
        commit({ pendingConfirm: null, lastOutcome: outcome });
        // A `session.start` confirmation opened a conversation: attach it to the card and announce
        // it BEFORE the re-read, so the 「打开会话」 link is readable without waiting for a network
        // round-trip. The announcement is outside the try above on purpose — a listener that
        // throws is not a failed confirmation.
        const sessionId = startedSessionIdOf(outcome.executor, outcome.result);
        if (sessionId !== null) {
          startedSessions.set(pending.cardId, sessionId);
          commit({ cards: withStartedSessions(store.getSnapshot().cards) });
          deps.onEvent?.({ type: 'sessionStarted', sessionId });
        }
        // Re-read so a provider that bumped the revision is reflected IN PLACE. The selection,
        // anchor and order are preserved by `normalize`.
        await read();
      }
    } finally {
      // `confirming` covers the re-read as well: the card is not settled until the reading that
      // follows the write has landed. A scenario's settle therefore observes the provider's
      // POST-decision state, not the batch that was in hand while the write was in flight.
      confirming = false;
      commit({ confirming: false, confirmingCardId: null });
    }
    return outcome.ok;
  };

  /** The irreversible option's second press; a reversible option sends from the countdown. */
  const confirm = async (): Promise<boolean> => {
    const pending = store.getSnapshot().pendingConfirm;
    if (pending === null || confirming) return false;
    return send(pending);
  };

  /**
   * The first press on 「忽略/丢弃」: opens the dismiss confirmation without sending anything.
   *
   * It refuses while another confirmation is open or in flight — one card, one decision at a
   * time — and it never touches the shown option, the own-reply draft or the send countdown. The
   * options stay exactly as they were, so confirming a dismiss is not a choice of answer.
   */
  const requestDismiss = (cardId: string): boolean => {
    if (disposed) return false;
    const snapshot = store.getSnapshot();
    if (confirming) return false;
    // One card, one decision: while a dismissal is in flight (its confirm bar is held until the
    // re-read lands), another card's first press must not replace the pending dismiss — the
    // in-flight command's own cleanup would then close the second card's confirmation.
    if (snapshot.dismissingCardId !== null) return false;
    if (snapshot.pendingConfirm !== null || snapshot.sendCountdown !== null) return false;
    const target = snapshot.dismissTargets[cardId];
    if (target === undefined || target.disabled) return false;
    commit({ pendingDismiss: target, dismissNotice: null });
    return true;
  };

  /** The dismiss confirmation's second press: one request, never the action executor. */
  const confirmDismiss = async (): Promise<boolean> => {
    const pending = store.getSnapshot().pendingDismiss;
    if (pending === null || confirming) return false;
    const dismiss = deps.dismiss;
    if (dismiss === undefined) return false;
    confirming = true;
    commit({ dismissingCardId: pending.cardId, dismissNotice: null });
    let notice: CockpitCardDismissNotice;
    try {
      await dismiss({ cardId: pending.cardId, revision: pending.revision });
      notice = { cardId: pending.cardId, ok: true, message: CARD_DISMISSED_NOTICE };
    } catch (failure) {
      notice = { cardId: pending.cardId, ok: false, message: failureMessage(failure) };
    } finally {
      confirming = false;
    }
    if (!notice.ok) {
      // The dismissal did not happen, so the card keeps its choices; the notice says why.
      commit({ pendingDismiss: null, dismissingCardId: null, dismissNotice: notice });
      return false;
    }
    // The dismissal was accepted. Keep the confirm bar in its 「正在丢弃」 reading until the
    // re-read lands: a successful dismiss settled the provider's item, so the only correct next
    // picture is the card gone. Closing the bar first would put 「忽略/丢弃」 back on a card the
    // server has already discarded, which reads as the dismissal having been undone.
    commit({ dismissNotice: notice });
    try {
      await read();
    } finally {
      commit({ pendingDismiss: null, dismissingCardId: null });
    }
    return true;
  };

  /** Leaves the dismiss confirmation without sending; the card's options are untouched. */
  const cancelDismiss = (): boolean => {
    if (store.getSnapshot().pendingDismiss === null) return false;
    commit({ pendingDismiss: null });
    return true;
  };

  /**
   * Resends ONLY the feedback for a card whose window passed. The action already ran, so this
   * command never touches the confirm target, the action ledger or the card's revision; the
   * server repeats the stored feedback call under the same `feedbackId`.
   */
  const resendFeedback = async (cardId: string): Promise<boolean> => {
    if (disposed) return false;
    const snapshot = store.getSnapshot();
    const card = snapshot.cards.find((candidate) => candidate.id === cardId);
    if (card?.feedback === undefined) return false;
    if (snapshot.resendingFeedbackCardId !== null) return false;
    // Before the window a resend is not offered; the same rule the button draws.
    if (feedbackPhaseOf(card.feedback, clock.now()) !== 'unconfirmed') return false;
    if (!canResendFeedback(card, clock.now())) {
      // Two very different refusals share this control: the provider offers no way to resend at
      // all, or the option the receipt names is no longer on the card (a resend would name an id
      // the provider's current item does not carry). Naming the second one as the first would
      // send the person hunting for a provider setting instead of a changed option.
      const message = feedbackOptionGone(card)
        ? FEEDBACK_OPTION_GONE_REASON
        : (card.feedback.resendUnavailableReason ?? '该提供方无法确认收到反馈');
      commit({ feedbackResendError: { cardId, message } });
      return false;
    }
    const resend = deps.resendFeedback;
    if (resend === undefined) {
      commit({
        feedbackResendError: { cardId, message: '当前界面没有配置重发通道' },
      });
      return false;
    }

    commit({ resendingFeedbackCardId: cardId, feedbackResendError: null });
    try {
      await resend(cardId);
    } catch (failure) {
      commit({
        resendingFeedbackCardId: null,
        feedbackResendError: { cardId, message: failureMessage(failure) },
      });
      return false;
    }
    // Re-read: the server refreshed `sentAt`, so the card reads 「已发出」 again (or is gone).
    await read();
    commit({ resendingFeedbackCardId: null });
    return true;
  };

  const handleKey = (key: string): boolean => {
    if (key === 'Escape') return false;
    // Enter is the whole gesture in one key: with nothing pending it starts the confirmation on
    // the selected card; during the countdown it CANCELS rather than sending early; on an
    // irreversible option's pending state it sends. Escape stays untouched above: it aborts a
    // running turn elsewhere in the app.
    if (key === 'Enter') {
      const snapshot = store.getSnapshot();
      if (snapshot.sendCountdown !== null) return cancelSendCountdown();
      if (snapshot.pendingConfirm === null) return requestConfirm();
      void confirm();
      return true;
    }
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
      if (disposed) return;
      // The last reading leaves with the page, so a route change that skips the unmount-time
      // scroll report still returns to the card the person was on.
      writeMemory();
      clearConfirmRetreat();
      // A running countdown is disarmed only here: `stop` leaves it armed on purpose, because a
      // route change calls `stop` and the press must still send.
      clearSendCountdownTimers();
      if (feedbackTicker !== null) {
        clock.clearInterval(feedbackTicker);
        feedbackTicker = null;
      }
      disposed = true;
      stop();
    },
    load: read,
    selectCard: (cardId) => {
      const snapshot = store.getSnapshot();
      if (!snapshot.visibleCards.some((card) => card.id === cardId)) return;
      if (snapshot.selectedCardId === cardId) return;
      const pending = snapshot.pendingConfirm;
      const countdown = snapshot.sendCountdown;
      commit({
        selectedCardId: cardId,
        // Selecting another card is one of the stated retreats: the confirm state belongs to the
        // card the person was looking at, and the second press must not land on a card they left.
        ...(pending !== null && pending.cardId !== cardId ? { pendingConfirm: null } : {}),
        // The same rule for a running countdown: moving the selection to another card takes the
        // person away from the button that could still cancel it, so it must not fire unseen.
        ...(countdown !== null && countdown.cardId !== cardId ? { sendCountdown: null } : {}),
      });
      writeMemory();
    },
    setScrollPosition: (position) => {
      if (!Number.isFinite(position)) return;
      const next = Math.max(0, position);
      // Scroll reports arrive once per animation frame; an unchanged offset is not a change and
      // must not write the (synchronous) memory store again.
      if (next === store.getSnapshot().scrollPosition) return;
      commit({ scrollPosition: next });
      writeMemory();
    },
    setAnchor: (cardId) => commit({ anchorCardId: cardId }),
    setTypeFilter: (filter) => {
      commit({ typeFilter: filter });
      writeFilters();
    },
    setProjectFilter: (project) => {
      commit({ projectFilters: project === null ? [] : [project] });
      writeFilters();
    },
    toggleProjectFilter: (project) => {
      const current = store.getSnapshot().projectFilters;
      const next = current.includes(project)
        ? current.filter((candidate) => candidate !== project)
        : [...current, project];
      commit({ projectFilters: next });
      writeFilters();
    },
    clearProjectFilters: () => {
      commit({ projectFilters: [] });
      writeFilters();
    },
    setDensity: (density) => commit({ density }),
    toggleSituationExpanded: (cardId) => {
      const snapshot = store.getSnapshot();
      const card = snapshot.cards.find((candidate) => candidate.id === cardId);
      if (card === undefined) return;
      const next = { ...snapshot.situationExpanded };
      if (next[cardId] === card.revision) delete next[cardId];
      else next[cardId] = card.revision;
      commit({ situationExpanded: next });
    },
    toggleDuplicates: (cardId) => {
      const snapshot = store.getSnapshot();
      const current = snapshot.duplicates[cardId];
      if (current === undefined) return;
      commit({
        duplicates: {
          ...snapshot.duplicates,
          [cardId]: { ...current, expanded: !current.expanded },
        },
      });
    },
    openDetails: (cardId) => {
      const snapshot = store.getSnapshot();
      if (!snapshot.cards.some((card) => card.id === cardId)) return;
      const without = snapshot.detailsStack.filter((candidate) => candidate !== cardId);
      commit({ detailsStack: [...without, cardId] });
      loadBrief(cardId);
    },
    loadBrief,
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
      const countdown = snapshot.sendCountdown;
      commit({
        ownReplies: { ...snapshot.ownReplies, [cardId]: text },
        shown: { ...snapshot.shown, [cardId]: { kind: 'ownReply' } },
        ...(pending !== null && pending.cardId === cardId ? { pendingConfirm: null } : {}),
        // The countdown sends the reading it was started on; editing that reading replaces it, so
        // the running timer would send text the person has already changed.
        ...(countdown !== null && countdown.cardId === cardId ? { sendCountdown: null } : {}),
      });
    },
    requestConfirm,
    confirm,
    resendFeedback,
    requestDismiss,
    confirmDismiss,
    cancelDismiss,
    cancelConfirm: () => {
      // Once the request has left it cannot be taken back: the button is disabled and the answer
      // — success or failure — stands. Reporting `false` says 「nothing was cancelled」.
      if (confirming) return false;
      if (cancelSendCountdown()) return true;
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
    awaitingFeedback: snapshot.visibleCards.reduce(
      (count, card) => (card.feedback === undefined ? count : count + 1),
      0,
    ),
    cards: snapshot.visibleCards.map((card) => {
      const shown = snapshot.shown[card.id];
      const target = snapshot.targets[card.id];
      return {
        id: card.id,
        shownOptionId: shown !== undefined && shown.kind === 'option' ? shown.optionId : null,
        ownReply: shown !== undefined && shown.kind === 'ownReply',
        confirmOptionId: target?.optionId ?? null,
        confirmLabel: target?.label ?? null,
        knowledgeState: card.knowledge?.state ?? null,
        knowledgeVerificationState: card.knowledge?.verification?.state ?? null,
      };
    }),
  };
}
