import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';

import { createCockpitColumnController } from '@/modules/cockpit/cockpitColumnController';
import type {
  CockpitColumnController,
  CockpitColumnSnapshot,
} from '@/modules/cockpit/cockpitColumnController';
import { useCockpitCards } from '@/modules/cockpit/hooks/useCockpitCards';
import type { CockpitCardsBinding } from '@/modules/cockpit/hooks/useCockpitCards';

/**
 * The React binding for `createCockpitColumnController`.
 *
 * IT BINDS, IT DOES NOT DECIDE. The controller owns the layout boundaries, the expand intent,
 * the dragged width, the header count and the key ownership; this hook memoizes the controller,
 * subscribes through `useSyncExternalStore`, keeps the card controller alive for the header
 * count even while the column is collapsed, and forwards the window width to the controller on
 * resize. Nothing here re-derives a rule.
 *
 * ONE BINDING, THREE CONSUMERS. The header button (count + pressed state), the column itself and
 * the sidebar's mode switch all read this one value through the context below, so they cannot
 * disagree about whether the column is open or how wide it is.
 */

/** The frame plus the card binding the column's list draws from. */
export type CockpitColumnBinding = {
  snapshot: CockpitColumnSnapshot;
  controller: CockpitColumnController;
  cards: CockpitCardsBinding;
};

/** Null outside the provider — a header rendered alone (a unit test) draws no cockpit button. */
export const CockpitColumnContext = createContext<CockpitColumnBinding | null>(null);

export function useCockpitColumnContext(): CockpitColumnBinding | null {
  return useContext(CockpitColumnContext);
}

export function useCockpitColumn(): CockpitColumnBinding {
  const cards = useCockpitCards();
  const navigate = useNavigate();

  const controller = useMemo(
    () =>
      createCockpitColumnController({
        cards: cards.controller,
        openSession: (sessionId: string) => {
          navigate(`/session/${encodeURIComponent(sessionId)}`);
        },
      }),
    [cards.controller, navigate],
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    const onResize = (): void => controller.setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      controller.stop();
    };
  }, [controller]);

  return useMemo(() => ({ snapshot, controller, cards }), [snapshot, controller, cards]);
}
