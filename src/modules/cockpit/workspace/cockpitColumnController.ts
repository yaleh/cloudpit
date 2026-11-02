import type { CockpitCard } from '@/shared/types';
import { createExternalStore } from '@/shared/utils';
import type { CockpitCardController } from '@/modules/cockpit/cards/cockpitCardController';

/**
 * The PC cockpit column's rules, with no React in the file.
 *
 * THE LAYOUT IS STATED IN THE WORKSPACE, NOT THE WINDOW. The column and the session share the
 * layout row left over after the sidebar (and the editor panel) have taken their width, so the
 * window is the wrong unit: at a 1440 px window with the sidebar open the row is 1151 px, and a
 * 400 px column leaves the session 751 px — not the 1040 px the window arithmetic suggests. A
 * layout read off `window.innerWidth` therefore squeezed the session to 591 px at a 1280 px
 * window, which is exactly where this file used to start squeezing. The caller measures the row
 * and hands its width in; nothing here reads the window.
 *
 * THREE LAYOUTS, ONE BOUNDARY EACH. The column keeps the session at least 640 px:
 *
 *   - `squeeze` — a width that fits above that floor sits beside the session and the session
 *     gives up exactly the column's width. The column is never drawn wider than the floor
 *     allows, so `workspace − width >= 640` holds for every squeeze reading.
 *   - `overlay` — when the smallest readable column (320 px) would still push the session under
 *     640, the column covers the session instead, from a 600 px workspace up.
 *   - `hidden` — under 600 px of workspace the phone model owns the page and nothing mounts.
 *
 * The width itself is the person's choice when they have made one (a drag, remembered across
 * mounts) and the shipped 400 px otherwise. The auto width steps DOWN to the 320 px minimum when
 * 400 would leave the session under 640, instead of sitting on the odd remainder (at a 991 px
 * workspace that is 320 + 671 rather than 351 + 640); a dragged width is honoured as far as the
 * floor allows and never silently rewritten in storage.
 *
 * THE COLUMN OWNS ONLY ITS OWN FRAME. Every card reading and every card command is the card
 * controller's; this file adds the frame (layout, expanded, width), the header count, the
 * "opened on the left" marker and the key ownership rule. It never re-derives a selected card
 * or a shown option — a second derivation would be a second answer.
 *
 * KEY OWNERSHIP IS DECIDED HERE, NOT IN A COMPONENT. When neither of the two input boxes has
 * focus, keys belong to the column: `↑`/`↓` move the selection, `←`/`→` and `1`–`9` change the
 * shown option, `E` writes the person's own reply, `Enter` is the confirm state's two presses
 * (open it in place, then send from the same bar), `Backspace`
 * goes back / closes. `Escape` is never consumed — it aborts a running turn elsewhere in the
 * app. An editable target (the session composer, the cockpit input) ends the handler, so a
 * keystroke can never land in both places.
 */

/** How the column meets the session area at the current workspace width. */
export type CockpitColumnLayout = 'squeeze' | 'overlay' | 'hidden';

/** The width the column opens at, before any drag or stored value. */
export const COCKPIT_COLUMN_DEFAULT_WIDTH = 400;
/** The narrowest the drag may make the column; below this the card text stops being readable. */
export const COCKPIT_COLUMN_MIN_WIDTH = 320;
/** The widest the drag may make the column; above this the session is the smaller half. */
export const COCKPIT_COLUMN_MAX_WIDTH = 720;
/** The least the session area must keep before the column covers it instead of squeezing it. */
export const COCKPIT_COLUMN_MIN_SESSION_WIDTH = 640;
/** At or above this WORKSPACE width the column exists at all; below it the phone model owns. */
export const COCKPIT_COLUMN_OVERLAY_MIN_WIDTH = 600;
/** Per-device, per-browser memory of the expand intent and the dragged width. */
export const COCKPIT_COLUMN_STORAGE_KEY = 'cockpit.column.v1';

/** One frame reading: which layout, and the width the column draws at. */
export type CockpitColumnFrame = {
  layout: CockpitColumnLayout;
  width: number;
};

function clampWidth(width: number): number {
  return Math.min(COCKPIT_COLUMN_MAX_WIDTH, Math.max(COCKPIT_COLUMN_MIN_WIDTH, Math.round(width)));
}

/**
 * The frame a workspace width and the person's preferred column width call for.
 *
 * Exported so a criterion reads the same rule the controller applies. `hasOwnWidth` tells the
 * two apart: a width the person chose is clamped to what the 640 px floor allows, while the
 * shipped default steps down to the readable minimum when 400 does not fit. Under this rule a
 * squeeze always leaves at least `COCKPIT_COLUMN_MIN_SESSION_WIDTH`, whatever the drag did.
 */
export function cockpitColumnFrameFor(
  workspaceWidth: number,
  preferredWidth: number,
  hasOwnWidth: boolean,
): CockpitColumnFrame {
  const preferred = clampWidth(preferredWidth);
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) {
    return { layout: 'hidden', width: preferred };
  }
  const squeezeCap = Math.min(
    COCKPIT_COLUMN_MAX_WIDTH,
    workspaceWidth - COCKPIT_COLUMN_MIN_SESSION_WIDTH,
  );
  if (squeezeCap >= COCKPIT_COLUMN_MIN_WIDTH) {
    if (hasOwnWidth) {
      const width = Math.max(COCKPIT_COLUMN_MIN_WIDTH, Math.min(preferred, squeezeCap));
      return { layout: 'squeeze', width };
    }
    return { layout: 'squeeze', width: preferred <= squeezeCap ? preferred : COCKPIT_COLUMN_MIN_WIDTH };
  }
  if (workspaceWidth >= COCKPIT_COLUMN_OVERLAY_MIN_WIDTH) {
    return { layout: 'overlay', width: preferred };
  }
  return { layout: 'hidden', width: preferred };
}

/** The two storage verbs the column needs; a test passes a plain object. */
export type CockpitColumnStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

/** The immutable reading the column, its header button and the sidebar switch render. */
export type CockpitColumnSnapshot = {
  layout: CockpitColumnLayout;
  /** The width of the layout row the column shares with the session area (0 = not measured). */
  workspaceWidth: number;
  /** Whether the column is on screen right now (`hidden` always reads false). */
  expanded: boolean;
  /** The width the column draws at: the preferred width, clamped to keep the session readable. */
  width: number;
  /** The person's own width (a drag or a stored value), before the squeeze floor clamps it. */
  preferredWidth: number;
  /** True between `beginResize` and `endResize`, for the handle's drag lifecycle. */
  resizing: boolean;
  /** Every open card the provider returned, filters included (the header count's source). */
  openCount: number;
  /** The header badge's text: empty at 0, `99+` above 99. */
  badgeText: string;
  /** Mirrors of the card controller's selection and Details stack, for the column's own keys. */
  selectedCardId: string | null;
  detailsOpenCardId: string | null;
  /** The card whose conversation was last opened on the left, and that conversation. */
  openedCardId: string | null;
  openedSessionId: string | null;
};

/** The card controller verbs the column frame drives. */
type CockpitColumnCards = Pick<
  CockpitCardController,
  | 'subscribe'
  | 'getSnapshot'
  | 'handleKey'
  | 'selectCard'
  | 'openDetails'
  | 'closeDetails'
  | 'showOption'
  | 'showOwnReply'
  | 'requestConfirm'
  | 'openDropdown'
>;

export type CockpitColumnControllerDeps = {
  cards: CockpitColumnCards;
  /** Injected so a test states a workspace instead of measuring a row. The only width source. */
  readWorkspaceWidth?: () => number;
  /** Injected so a test restores a stored frame; absent uses `localStorage` when it exists. */
  storage?: CockpitColumnStorage | null;
  /** True when a text field owns the keyboard. Defaults to reading `document.activeElement`. */
  isEditableFocused?: () => boolean;
  /** Navigates to the conversation a card link names; the hook binds it to the router. */
  openSession?: (sessionId: string) => void;
};

export type CockpitColumnController = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => CockpitColumnSnapshot;
  /** Subscribes to the card controller so the count follows a re-read. Idempotent. */
  start: () => void;
  /** Drops the card subscription; the column stays usable. */
  stop: () => void;
  /** Stops for good; later commands are no-ops. */
  dispose: () => void;
  /** Tells the column the layout row's width changed; the layout is derived, never set. */
  setWorkspaceWidth: (workspaceWidth: number) => void;
  /** Expands/collapses the column. Ignored where the column does not exist. */
  setExpanded: (expanded: boolean) => void;
  toggle: () => void;
  /** Sets the person's width and remembers it for the next mount. */
  setWidth: (width: number) => void;
  beginResize: (clientX: number) => void;
  resizeTo: (clientX: number) => void;
  endResize: () => void;
  /**
   * A conversation link in a card: record that it is open on the left, navigate, and — only in
   * the overlay layout, where the column covers the conversation it just opened — collapse.
   */
  openConversation: (cardId: string, sessionId: string) => void;
  /** Forgets the "opened on the left" marker (the marker belongs to one visit). */
  clearOpened: () => void;
  /** Handles one key; returns whether the column consumed it. `Escape` is never consumed. */
  handleKey: (key: string) => boolean;
};

type StoredFrame = {
  expanded: boolean;
  /** The person's own width, or null when the shipped default still applies. */
  width: number | null;
};

function readStoredFrame(storage: CockpitColumnStorage | null): StoredFrame {
  const fallback: StoredFrame = { expanded: false, width: null };
  if (storage === null) return fallback;
  try {
    const raw = storage.getItem(COCKPIT_COLUMN_STORAGE_KEY);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as { expanded?: unknown; width?: unknown };
    const stored =
      typeof parsed.width === 'number' && Number.isFinite(parsed.width)
        ? clampWidth(parsed.width)
        : null;
    return {
      expanded: parsed.expanded === true,
      // A frame persisted by the previous release always carried the default width, so a stored
      // 400 is the shipped value, not a drag: keeping it out of the "own width" branch is what
      // lets that install shrink to 320 where the floor demands it.
      width: stored === null || stored === COCKPIT_COLUMN_DEFAULT_WIDTH ? null : stored,
    };
  } catch {
    // A storage-disabled browser (or corrupt JSON) starts at the shipped frame.
    return fallback;
  }
}

function defaultStorage(): CockpitColumnStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * An unmeasured workspace. The column lives on a session page whose layout row reports its own
 * width; until that reading arrives there is no workspace to lay out in, and guessing one from
 * the window is exactly the defect this controller stopped making.
 */
function defaultWorkspaceWidth(): number {
  return 0;
}

function isEditableElement(element: Element | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT';
}

function defaultIsEditableFocused(): boolean {
  return typeof document === 'undefined' ? false : isEditableElement(document.activeElement);
}

/** Moves one row in the visible list, wrapping; a missing selection enters at the matching end. */
function nextSelectedCardId(
  cards: readonly CockpitCard[],
  selectedCardId: string | null,
  delta: number,
): string | null {
  if (cards.length === 0) return null;
  const index = selectedCardId === null ? -1 : cards.findIndex((card) => card.id === selectedCardId);
  if (index === -1) return delta > 0 ? cards[0].id : cards[cards.length - 1].id;
  return cards[(index + delta + cards.length) % cards.length].id;
}

export function createCockpitColumnController(
  deps: CockpitColumnControllerDeps,
): CockpitColumnController {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  const stored = readStoredFrame(storage);
  const readWorkspaceWidth = deps.readWorkspaceWidth ?? defaultWorkspaceWidth;
  const isEditableFocused = deps.isEditableFocused ?? defaultIsEditableFocused;

  let workspaceWidth = readWorkspaceWidth();
  let wantExpanded = stored.expanded;
  let preferredWidth = stored.width ?? COCKPIT_COLUMN_DEFAULT_WIDTH;
  // Whether the width is the person's own (a drag or a stored non-default value) rather than the
  // shipped default. Only the auto width is allowed to step down to the minimum on its own.
  let hasOwnWidth = stored.width !== null;
  let resizing = false;
  let resizeOrigin: { clientX: number; width: number } | null = null;
  let openedCardId: string | null = null;
  let openedSessionId: string | null = null;
  let unsubscribeCards: (() => void) | null = null;
  let disposed = false;

  const readSnapshot = (): CockpitColumnSnapshot => {
    const cards = deps.cards.getSnapshot();
    const frame = cockpitColumnFrameFor(workspaceWidth, preferredWidth, hasOwnWidth);
    // The card controller's own count: folded duplicates are one open question, and the filters
    // (which are the list's, not the column's) do not apply to this number.
    const openCount = cards.openCount;
    return {
      layout: frame.layout,
      workspaceWidth,
      expanded: frame.layout === 'hidden' ? false : wantExpanded,
      width: frame.width,
      preferredWidth,
      resizing,
      openCount,
      badgeText: openCount === 0 ? '' : openCount > 99 ? '99+' : String(openCount),
      selectedCardId: cards.selectedCardId,
      detailsOpenCardId: cards.detailsStack[cards.detailsStack.length - 1] ?? null,
      openedCardId,
      openedSessionId,
    };
  };

  const store = createExternalStore<CockpitColumnSnapshot>(readSnapshot());

  const commit = (): void => {
    if (disposed) return;
    store.set(readSnapshot());
  };

  const persist = (): void => {
    if (storage === null) return;
    try {
      storage.setItem(
        COCKPIT_COLUMN_STORAGE_KEY,
        JSON.stringify({ expanded: wantExpanded, width: preferredWidth }),
      );
    } catch {
      // A full or forbidden storage must not make the column unopenable.
    }
  };

  const setExpanded = (expanded: boolean): void => {
    if (disposed) return;
    if (store.getSnapshot().layout === 'hidden') return;
    if (wantExpanded === expanded) return;
    wantExpanded = expanded;
    persist();
    commit();
  };

  return {
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
    start: () => {
      if (disposed || unsubscribeCards !== null) return;
      unsubscribeCards = deps.cards.subscribe(commit);
      commit();
    },
    stop: () => {
      if (unsubscribeCards === null) return;
      unsubscribeCards();
      unsubscribeCards = null;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (unsubscribeCards !== null) {
        unsubscribeCards();
        unsubscribeCards = null;
      }
    },
    setWorkspaceWidth: (next: number) => {
      if (disposed || !Number.isFinite(next) || next < 0) return;
      const rounded = Math.round(next);
      if (rounded === workspaceWidth) return;
      workspaceWidth = rounded;
      commit();
    },
    setExpanded,
    toggle: () => setExpanded(!store.getSnapshot().expanded),
    setWidth: (next: number) => {
      if (disposed || !Number.isFinite(next)) return;
      const clamped = clampWidth(next);
      if (clamped === preferredWidth && hasOwnWidth) return;
      preferredWidth = clamped;
      hasOwnWidth = true;
      persist();
      commit();
    },
    beginResize: (clientX: number) => {
      const snapshot = store.getSnapshot();
      if (disposed || !snapshot.expanded || snapshot.layout !== 'squeeze') return;
      resizing = true;
      // The origin is the width ON SCREEN, so the frame follows the pointer from where the
      // handle actually is — not from a preferred width the 640 px floor may have clamped.
      resizeOrigin = { clientX, width: snapshot.width };
      commit();
    },
    resizeTo: (clientX: number) => {
      if (disposed || !resizing || resizeOrigin === null) return;
      // The column grows as the pointer moves LEFT (its handle is on its left edge).
      const next = clampWidth(resizeOrigin.width + (resizeOrigin.clientX - clientX));
      if (next === preferredWidth && hasOwnWidth) return;
      preferredWidth = next;
      hasOwnWidth = true;
      commit();
    },
    endResize: () => {
      if (!resizing) return;
      resizing = false;
      resizeOrigin = null;
      persist();
      commit();
    },
    openConversation: (cardId: string, sessionId: string) => {
      if (disposed) return;
      openedCardId = cardId;
      openedSessionId = sessionId;
      const layout = store.getSnapshot().layout;
      // Overlay covers the conversation it opens, so it must get out of the way; squeeze sits
      // beside the conversation, which is exactly where the person wants to read the answer.
      if (layout === 'overlay') wantExpanded = false;
      commit();
      deps.openSession?.(sessionId);
    },
    clearOpened: () => {
      if (disposed || (openedCardId === null && openedSessionId === null)) return;
      openedCardId = null;
      openedSessionId = null;
      commit();
    },
    handleKey: (key: string) => {
      if (disposed) return false;
      const snapshot = store.getSnapshot();
      if (snapshot.layout === 'hidden') return false;
      // Escape aborts a running turn elsewhere; the cockpit must never swallow it.
      if (key === 'Escape') return false;
      if (isEditableFocused()) return false;
      const cardsSnapshot = deps.cards.getSnapshot();
      const selectedId = cardsSnapshot.selectedCardId;
      const selectedCard =
        selectedId === null ? null : cardsSnapshot.cards.find((card) => card.id === selectedId) ?? null;

      if (key === 'ArrowDown' || key === 'ArrowUp') {
        const nextId = nextSelectedCardId(
          cardsSnapshot.visibleCards,
          selectedId,
          key === 'ArrowDown' ? 1 : -1,
        );
        if (nextId === null) return false;
        deps.cards.selectCard(nextId);
        return true;
      }

      if (key === 'ArrowLeft' || key === 'ArrowRight') {
        if (selectedCard === null || selectedCard.options.length === 0) return false;
        const shown = cardsSnapshot.shown[selectedCard.id];
        const shownOptionId = shown?.kind === 'option' ? shown.optionId : undefined;
        const currentIndex = shownOptionId === undefined
          ? selectedCard.options.findIndex((option) => option.suggested)
          : selectedCard.options.findIndex((option) => option.id === shownOptionId);
        const from = currentIndex < 0 ? 0 : currentIndex;
        const delta = key === 'ArrowRight' ? 1 : -1;
        const nextIndex = (from + delta + selectedCard.options.length) % selectedCard.options.length;
        deps.cards.showOption(selectedCard.id, selectedCard.options[nextIndex].id);
        return true;
      }

      if (key === 'e' || key === 'E') {
        if (selectedId === null) return false;
        deps.cards.showOwnReply(selectedId);
        return true;
      }

      if (key === 'Enter') {
        if (selectedId === null) return false;
        // Enter is the same key twice: the first press turns the selected card's bar into its
        // confirm state, the second sends from that same bar. The card controller owns that
        // machine, so the column forwards the key rather than deciding which press it is here.
        return deps.cards.handleKey('Enter');
      }

      if (key === 'Backspace') {
        if (cardsSnapshot.detailsStack.length > 0) {
          deps.cards.closeDetails();
          return true;
        }
        if (cardsSnapshot.openDropdownCardId !== null) {
          deps.cards.openDropdown(null);
          return true;
        }
        return false;
      }

      // Digits select an option and nothing else — the card controller owns that mapping.
      if (/^[1-9]$/.test(key)) return deps.cards.handleKey(key);

      return false;
    },
  };
}
