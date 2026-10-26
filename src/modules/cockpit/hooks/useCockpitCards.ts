import { useEffect, useMemo, useSyncExternalStore } from 'react';
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
 * rather than leaving them on a card that now points at a conversation they have to find.
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

export function useCockpitCards(overrides: CockpitCardsDepsOverride = {}): CockpitCardsBinding {
  const { fetchCards, confirm, fetchBrief, clock, refreshIntervalMs, onEvent } = overrides;
  const navigate = useNavigate();
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
            navigate(`/session/${encodeURIComponent(event.sessionId)}`);
          }
        }),
      ...(clock === undefined ? {} : { clock }),
      ...(refreshIntervalMs === undefined ? {} : { refreshIntervalMs }),
    }),
    [fetchCards, confirm, fetchBrief, clock, refreshIntervalMs, onEvent, navigate],
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

  return { snapshot, controller };
}
