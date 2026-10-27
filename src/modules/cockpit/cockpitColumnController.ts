import type { CockpitCard } from '@/shared/types';
import { createExternalStore } from '@/shared/utils';
import type { CockpitCardController } from '@/modules/cockpit/cockpitCardController';

/**
 * The PC cockpit column's rules, with no React in the file.
 *
 * THREE LAYOUTS, ONE BOUNDARY EACH. A wide window shows the column beside the session and the
 * chat area gives up exactly the column's width (`squeeze`); a middle window overlays it on the
 * session area (`overlay`); a phone-width window does not mount it at all (`hidden`). The
 * boundaries are 1280 and 900 because those are the two widths the design names: below 1280 a
 * 400 px column would leave a session less than 880 px, and below 900 there is no room for the
 * column and the session to be read together.
 *
 * THE COLUMN OWNS ONLY ITS OWN FRAME. Every card reading and every card command is the card
 * controller's; this file adds the frame (layout, expanded, width), the header count, the
 * "opened on the left" marker and the key ownership rule. It never re-derives a selected card
 * or a shown option — a second derivation would be a second answer.
 *
 * KEY OWNERSHIP IS DECIDED HERE, NOT IN A COMPONENT. When neither of the two input boxes has
 * focus, keys belong to the column: `↑`/`↓` move the selection, `←`/`→` and `1`–`9` change the
 * shown option, `E` writes the person's own reply, `Enter` opens the confirm card, `Backspace`
 * goes back / closes. `Escape` is never consumed — it aborts a running turn elsewhere in the
 * app. An editable target (the session composer, the cockpit input) ends the handler, so a
 * keystroke can never land in both places.
 */

/** How the column meets the session area at the current viewport width. */
export type CockpitColumnLayout = 'squeeze' | 'overlay' | 'hidden';

/** The width the column opens at, before any drag or stored value. */
export const COCKPIT_COLUMN_DEFAULT_WIDTH = 400;
/** The narrowest the drag may make the column; below this the card text stops being readable. */
export const COCKPIT_COLUMN_MIN_WIDTH = 320;
/** The widest the drag may make the column; above this the session is the smaller half. */
export const COCKPIT_COLUMN_MAX_WIDTH = 720;
/** At or above this viewport width the column squeezes the session instead of covering it. */
export const COCKPIT_COLUMN_SQUEEZE_MIN_WIDTH = 1280;
/** At or above this viewport width the column exists at all. */
export const COCKPIT_COLUMN_OVERLAY_MIN_WIDTH = 900;
/** Per-device, per-browser memory of the expand intent and the dragged width. */
export const COCKPIT_COLUMN_STORAGE_KEY = 'cockpit.column.v1';

/** The layout a viewport width calls for. Exported so a criterion reads the same boundaries. */
export function cockpitColumnLayoutFor(viewportWidth: number): CockpitColumnLayout {
  if (viewportWidth >= COCKPIT_COLUMN_SQUEEZE_MIN_WIDTH) return 'squeeze';
  if (viewportWidth >= COCKPIT_COLUMN_OVERLAY_MIN_WIDTH) return 'overlay';
  return 'hidden';
}

function clampWidth(width: number): number {
  return Math.min(COCKPIT_COLUMN_MAX_WIDTH, Math.max(COCKPIT_COLUMN_MIN_WIDTH, Math.round(width)));
}

/** The two storage verbs the column needs; a test passes a plain object. */
export type CockpitColumnStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

/** The immutable reading the column, its header button and the sidebar switch render. */
export type CockpitColumnSnapshot = {
  layout: CockpitColumnLayout;
  /** The last viewport width the column was told about. */
  viewportWidth: number;
  /** Whether the column is on screen right now (`hidden` always reads false). */
  expanded: boolean;
  /** The dragged width; the column draws at exactly this width. */
  width: number;
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
  /** Injected so a test states a viewport instead of resizing jsdom. */
  readViewportWidth?: () => number;
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
  /** Tells the column the window width changed; the layout is derived, never set. */
  setViewportWidth: (viewportWidth: number) => void;
  /** Expands/collapses the column. Ignored at phone width, where it does not exist. */
  setExpanded: (expanded: boolean) => void;
  toggle: () => void;
  /** Sets the dragged width and remembers it for the next mount. */
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
  width: number;
};

function readStoredFrame(storage: CockpitColumnStorage | null): StoredFrame {
  const fallback: StoredFrame = { expanded: false, width: COCKPIT_COLUMN_DEFAULT_WIDTH };
  if (storage === null) return fallback;
  try {
    const raw = storage.getItem(COCKPIT_COLUMN_STORAGE_KEY);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as { expanded?: unknown; width?: unknown };
    return {
      expanded: parsed.expanded === true,
      width: typeof parsed.width === 'number' && Number.isFinite(parsed.width)
        ? clampWidth(parsed.width)
        : COCKPIT_COLUMN_DEFAULT_WIDTH,
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

function defaultViewportWidth(): number {
  return typeof window === 'undefined' ? COCKPIT_COLUMN_SQUEEZE_MIN_WIDTH : window.innerWidth;
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
  const readViewportWidth = deps.readViewportWidth ?? defaultViewportWidth;
  const isEditableFocused = deps.isEditableFocused ?? defaultIsEditableFocused;

  let viewportWidth = readViewportWidth();
  let wantExpanded = stored.expanded;
  let width = stored.width;
  let resizing = false;
  let resizeOrigin: { clientX: number; width: number } | null = null;
  let openedCardId: string | null = null;
  let openedSessionId: string | null = null;
  let unsubscribeCards: (() => void) | null = null;
  let disposed = false;

  const readSnapshot = (): CockpitColumnSnapshot => {
    const cards = deps.cards.getSnapshot();
    const layout = cockpitColumnLayoutFor(viewportWidth);
    const openCount = cards.cards.length;
    return {
      layout,
      viewportWidth,
      expanded: layout === 'hidden' ? false : wantExpanded,
      width,
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
      storage.setItem(COCKPIT_COLUMN_STORAGE_KEY, JSON.stringify({ expanded: wantExpanded, width }));
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
    setViewportWidth: (next: number) => {
      if (disposed || !Number.isFinite(next) || next <= 0) return;
      const rounded = Math.round(next);
      if (rounded === viewportWidth) return;
      viewportWidth = rounded;
      commit();
    },
    setExpanded,
    toggle: () => setExpanded(!store.getSnapshot().expanded),
    setWidth: (next: number) => {
      if (disposed || !Number.isFinite(next)) return;
      const clamped = clampWidth(next);
      if (clamped === width) return;
      width = clamped;
      persist();
      commit();
    },
    beginResize: (clientX: number) => {
      const snapshot = store.getSnapshot();
      if (disposed || !snapshot.expanded || snapshot.layout !== 'squeeze') return;
      resizing = true;
      resizeOrigin = { clientX, width };
      commit();
    },
    resizeTo: (clientX: number) => {
      if (disposed || !resizing || resizeOrigin === null) return;
      // The column grows as the pointer moves LEFT (its handle is on its left edge).
      const next = clampWidth(resizeOrigin.width + (resizeOrigin.clientX - clientX));
      if (next === width) return;
      width = next;
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
        // The first press is always the confirm card, never an executor write.
        return deps.cards.requestConfirm(selectedId);
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
