import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import type { RefObject } from 'react';
import { useNavigate } from 'react-router-dom';

import { createCockpitColumnController } from '@/modules/cockpit/workspace/cockpitColumnController';
import type {
  CockpitColumnController,
  CockpitColumnSnapshot,
} from '@/modules/cockpit/workspace/cockpitColumnController';
import { useCockpitCards } from '@/modules/cockpit/hooks/useCockpitCards';
import type { CockpitCardsBinding } from '@/modules/cockpit/hooks/useCockpitCards';

/**
 * The React binding for `createCockpitColumnController`.
 *
 * IT BINDS, IT DOES NOT DECIDE. The controller owns the layout boundaries, the expand intent,
 * the dragged width, the header count and the key ownership; this hook memoizes the controller,
 * subscribes through `useSyncExternalStore`, keeps the card controller alive for the header
 * count even while the column is collapsed, and hands the measured workspace width to the
 * controller. Nothing here re-derives a rule.
 *
 * THE WORKSPACE IS MEASURED, NOT ASSUMED. The controller lays the column out against the row it
 * shares with the session area, so this module watches that row (`useCockpitWorkspaceWidth`)
 * instead of the window: the sidebar, the editor panel and the device settings change the row
 * without resizing the window, and a window-sized reading is what squeezed the session to 591 px
 * at a 1280 px window.
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
  // The router's `navigate` changes identity on a route change. Holding it in a ref keeps this
  // controller — the frame, the "opened on the left" marker and the overlay auto-collapse — alive
  // across the very navigation a conversation link performs.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const controller = useMemo(
    () =>
      createCockpitColumnController({
        cards: cards.controller,
        openSession: (sessionId: string) => {
          navigateRef.current(`/session/${encodeURIComponent(sessionId)}`);
        },
      }),
    [cards.controller],
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  return useMemo(() => ({ snapshot, controller, cards }), [snapshot, controller, cards]);
}

/**
 * Feeds the layout row's width to the controller. Used by `CockpitColumnRegion`.
 *
 * THE ROW'S WIDTH IS THE WORKSPACE. The session area and the column are siblings inside the row,
 * so the row's own width is the space they share; subtracting the column's width from it would
 * make the reading depend on the frame it is deciding, and the row does not resize when the
 * column squeezes it (the column is inside it), so this reading cannot feed back into itself.
 *
 * A ResizeObserver, not a window `resize` listener: the row also narrows when the sidebar is
 * dragged or the editor panel opens, and neither resizes the window.
 *
 * A zero `clientWidth` (an unmeasured row, or a jsdom render) leaves the controller's injected
 * reading standing instead of hiding the column on a bogus measurement.
 */
export function useCockpitWorkspaceWidth(
  controller: CockpitColumnController | null,
  rowRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (controller === null) return undefined;
    const row = rowRef.current;
    if (row === null) return undefined;
    if (row.clientWidth > 0) controller.setWorkspaceWidth(row.clientWidth);
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last === undefined) return;
      controller.setWorkspaceWidth(last.contentRect.width);
    });
    observer.observe(row);
    // Leaving the session page unmounts the row; an unmeasured workspace is the honest reading
    // there, and it keeps the header button from offering a column with nowhere to draw.
    return () => {
      observer.disconnect();
      controller.setWorkspaceWidth(0);
    };
  }, [controller, rowRef]);
}
