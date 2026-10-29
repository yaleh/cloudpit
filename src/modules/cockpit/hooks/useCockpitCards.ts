import { useEffect, useMemo, useSyncExternalStore } from 'react';

import type { CockpitBriefResponse, CockpitCard } from '@/shared/types';
import { api, readApiJson } from '@/shared/api';
import { createCockpitCardController } from '@/modules/cockpit/cockpitCardController';
import type {
  CockpitCardConfirmRequest,
  CockpitCardController,
  CockpitCardControllerDeps,
  CockpitCardControllerEvent,
  CockpitCardControllerSnapshot,
  CockpitCardDismissRequest,
  CockpitCardFilterMemory,
  CockpitCardFilters,
  CockpitCardMemory,
  CockpitCardMemoryState,
} from '@/modules/cockpit/cockpitCardController';
import type { CockpitCardTypeFilter } from '@/modules/cockpit/contract';

/**
 * The React binding for `createCockpitCardController`.
 *
 * IT BINDS, IT DOES NOT DECIDE. The controller owns every rule; this hook builds its two HTTP
 * transports, memoizes the controller, subscribes through `useSyncExternalStore`, and starts the
 * background re-read while a reader is mounted. Nothing here re-derives a confirm target or a
 * default option — a second derivation would be a second answer.
 *
 * The route documents: `GET /api/cockpit/cards` answers `{cards}`; `POST /api/cockpit/cards/confirm`
 * answers `{ok, cardId, executor, params, result}` or the server's error envelope, which
 * `readApiJson` turns into an `ApiRequestError` carrying the server's code and message.
 *
 * The one decision it must NOT make any more is where a `session.start` confirmation lands: a
 * card-started conversation runs in the BACKGROUND (user, 2026-10-28), so the binding stays on
 * the cards page instead of switching into the new session. The card carries the 「打开会话」
 * link, so following it is one deliberate press rather than an automatic move. (Before this,
 * the default listener navigated on `sessionStarted` — see
 * `createCockpitCardsDefaultOnEvent`, which keeps that seam stubbed and provably inert.)
 *
 * It also supplies the controller's route memory — the tab-scoped store the card page leaves
 * its selection and scroll offset in — because "which storage" is a browser fact, not a list rule.
 */

/** The API's confirmation answer, narrowed to what the controller records. */
type CockpitConfirmAnswer = {
  ok: true;
  cardId: string;
  executor: string;
  params: Record<string, unknown>;
  result: unknown;
};

export type CockpitCardsBinding = {
  snapshot: CockpitCardControllerSnapshot;
  controller: CockpitCardController;
};

/** The deps a caller may override (a test binds its own transports and clock). */
export type CockpitCardsDepsOverride = Partial<CockpitCardControllerDeps>;

/** Tab-scoped: the reading is where THIS tab was, not a preference that outlives it. */
const CARD_MEMORY_STORAGE_KEY = 'cockpit.cards.memory.v1';

/** Device-scoped: a filter is a preference, so it outlives the tab and the session. */
const CARD_FILTER_STORAGE_KEY = 'cockpit.cards.filters.v1';

/**
 * The card page's route memory, backed by `sessionStorage`.
 *
 * It lives in the binding, not the controller: the controller states the rule ("the person
 * returns to the card and offset they left") through a two-verb seam, while where that seam is
 * kept — a tab's storage — is a browser decision. A blocked storage area (private mode, quota)
 * degrades to "start at the top", never to a crash: the same contract as the controller's own
 * unreadable-memory path.
 */
export function createSessionCockpitCardMemory(): CockpitCardMemory {
  return {
    read: () => {
      if (typeof window === 'undefined') return null;
      try {
        const stored = window.sessionStorage.getItem(CARD_MEMORY_STORAGE_KEY);
        if (stored === null) return null;
        const parsed: unknown = JSON.parse(stored);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const state = parsed as Partial<CockpitCardMemoryState>;
        return {
          selectedCardId:
            typeof state.selectedCardId === 'string' ? state.selectedCardId : null,
          scrollPosition:
            typeof state.scrollPosition === 'number' ? state.scrollPosition : 0,
        };
      } catch {
        return null;
      }
    },
    write: (state) => {
      if (typeof window === 'undefined') return;
      try {
        window.sessionStorage.setItem(CARD_MEMORY_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // See above: remembering is an enhancement, never a precondition.
      }
    },
  };
}

/**
 * The card page's filter memory, backed by `localStorage`.
 *
 * A filter is a device preference, not a route reading: the person who narrowed the list to
 * their projects on a phone expects that choice on the next visit, and a second window on the
 * same device must read the same one. Session storage would lose both facts. The values are
 * re-validated by the controller, so a hand-edited store degrades to "unfiltered" rather than
 * filtering on a project that never existed.
 */
export function createLocalCockpitCardFilterMemory(): CockpitCardFilterMemory {
  return {
    read: () => {
      if (typeof window === 'undefined') return null;
      try {
        const stored = window.localStorage.getItem(CARD_FILTER_STORAGE_KEY);
        if (stored === null) return null;
        const parsed: unknown = JSON.parse(stored);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const state = parsed as Partial<CockpitCardFilters>;
        return {
          typeFilter: (typeof state.typeFilter === 'string'
            ? state.typeFilter
            : 'all') as CockpitCardTypeFilter,
          projectFilters: Array.isArray(state.projectFilters)
            ? state.projectFilters.filter((entry): entry is string => typeof entry === 'string')
            : [],
        };
      } catch {
        return null;
      }
    },
    write: (state) => {
      if (typeof window === 'undefined') return;
      try {
        window.localStorage.setItem(CARD_FILTER_STORAGE_KEY, JSON.stringify(state));
      } catch {
        // A blocked storage area still filters for this visit; only the preference did not stick.
      }
    },
  };
}

/**
 * The binding's DEFAULT listener for a started conversation: it does nothing.
 *
 * WHY IT TAKES A NAVIGATE SEAM AT ALL. The seam is the one the binding used to call, and this
 * factory is exported so the controller's criterion can inject a stub there and state that a
 * `session.start` confirmation reaches the default binding with ZERO navigations. The started
 * session runs in the background; the card's 「打开会话」 link is how a person deliberately
 * follows it. (`void navigate` is deliberate: an unused parameter named without it would read
 * as an oversight rather than as a kept seam.)
 */
export function createCockpitCardsDefaultOnEvent(
  navigate?: (path: string) => void,
): (event: CockpitCardControllerEvent) => void {
  void navigate;
  return () => {
    // Intentionally empty — see the doc above.
  };
}

export function useCockpitCards(overrides: CockpitCardsDepsOverride = {}): CockpitCardsBinding {
  const {
    fetchCards,
    confirm,
    fetchBrief,
    resendFeedback,
    dismiss,
    clock,
    refreshIntervalMs,
    onEvent,
    remember: rememberOverride,
    rememberFilters: rememberFiltersOverride,
  } = overrides;
  // One store per mounted binding: a fresh object every render would rebuild the controller (and
  // the deps memo), which would discard the selection and the Details stack on every paint.
  const sessionMemory = useMemo(() => createSessionCockpitCardMemory(), []);
  const deviceFilters = useMemo(() => createLocalCockpitCardFilterMemory(), []);
  const remember = rememberOverride ?? sessionMemory;
  const rememberFilters = rememberFiltersOverride ?? deviceFilters;
  const deps = useMemo<CockpitCardControllerDeps>(
    () => ({
      fetchCards:
        fetchCards ??
        (async () => {
          const answer = await readApiJson<{ cards: CockpitCard[] }>(await api.cockpitCards());
          return answer.cards;
        }),
      confirm:
        confirm ??
        (async (request: CockpitCardConfirmRequest) => {
          const answer = await readApiJson<CockpitConfirmAnswer>(
            await api.cockpitConfirmCard(request),
          );
          return { executor: answer.executor, result: answer.result };
        }),
      fetchBrief:
        fetchBrief ??
        (async (cardId: string) =>
          readApiJson<CockpitBriefResponse>(await api.cockpitCardBrief(cardId))),
      resendFeedback:
        resendFeedback ??
        (async (cardId: string) =>
          readApiJson<unknown>(await api.cockpitResendFeedback(cardId))),
      dismiss:
        dismiss ??
        (async (request: CockpitCardDismissRequest) =>
          readApiJson<unknown>(await api.cockpitDismissCard(request))),
      // A started conversation runs in the BACKGROUND: the default listener does not navigate.
      // A caller that supplies its own listener replaces it (and may choose to move the page).
      onEvent: onEvent ?? createCockpitCardsDefaultOnEvent(),
      ...(clock === undefined ? {} : { clock }),
      ...(refreshIntervalMs === undefined ? {} : { refreshIntervalMs }),
      // Where the selection and scroll offset survive the route unmounting: this tab's storage,
      // unless the caller brought its own (a criterion passes a plain object).
      remember,
      // The filters survive the reload, not just the route: they live in this device's storage.
      rememberFilters,
    }),
    [
      fetchCards,
      confirm,
      fetchBrief,
      resendFeedback,
      dismiss,
      clock,
      refreshIntervalMs,
      onEvent,
      remember,
      rememberFilters,
    ],
  );

  const controller = useMemo(() => createCockpitCardController(deps), [deps]);
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  // Stable identity: the column's provider hands this value down through a context, and a fresh
  // object on every render would re-render every consumer of an unchanged card reading.
  return useMemo(() => ({ snapshot, controller }), [snapshot, controller]);
}
