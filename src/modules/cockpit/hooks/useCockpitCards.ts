import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';

import type { CockpitBriefResponse, CockpitCard } from '@/shared/types';
import { api, readApiJson } from '@/shared/api';
import { createCockpitCardController } from '@/modules/cockpit/cockpitCardController';
import type {
  CockpitCardConfirmRequest,
  CockpitCardController,
  CockpitCardControllerDeps,
  CockpitCardControllerEvent,
  CockpitCardControllerSnapshot,
  CockpitCardMemory,
  CockpitCardMemoryState,
} from '@/modules/cockpit/cockpitCardController';

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
 * The one decision the binding does make is where a `session.start` confirmation lands: the
 * person asked to start a conversation, so the page switches to it at once (user, 2026-10-27)
 * rather than leaving them on a card that now points at a conversation they have to find. It also
 * supplies the controller's route memory — the tab-scoped store the card page leaves its
 * selection and scroll offset in — because "which storage" is a browser fact, not a list rule.
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

export function useCockpitCards(overrides: CockpitCardsDepsOverride = {}): CockpitCardsBinding {
  const {
    fetchCards,
    confirm,
    fetchBrief,
    clock,
    refreshIntervalMs,
    onEvent,
    remember: rememberOverride,
  } = overrides;
  const navigate = useNavigate();
  // One store per mounted binding: a fresh object every render would rebuild the controller (and
  // the deps memo), which would discard the selection and the Details stack on every paint.
  const sessionMemory = useMemo(() => createSessionCockpitCardMemory(), []);
  const remember = rememberOverride ?? sessionMemory;
  // `navigate` changes identity when the route changes; keeping it in a ref keeps the controller
  // — and therefore the selection and the Details stack — alive across a navigation. A controller
  // rebuilt on every route change would silently reset the card the person was reading.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
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
      // The cockpit's own navigation rule: a confirmation that started a conversation switches
      // to it immediately. A caller that supplies its own listener replaces this behaviour.
      onEvent:
        onEvent ??
        ((event: CockpitCardControllerEvent) => {
          if (event.type === 'sessionStarted') {
            navigateRef.current(`/session/${encodeURIComponent(event.sessionId)}`);
          }
        }),
      ...(clock === undefined ? {} : { clock }),
      ...(refreshIntervalMs === undefined ? {} : { refreshIntervalMs }),
      // Where the selection and scroll offset survive the route unmounting: this tab's storage,
      // unless the caller brought its own (a criterion passes a plain object).
      remember,
    }),
    [fetchCards, confirm, fetchBrief, clock, refreshIntervalMs, onEvent, remember],
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
