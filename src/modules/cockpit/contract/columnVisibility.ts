import { createContext, useContext } from 'react';

/**
 * The only part of the cockpit column's binding the sidebar's mode switch reads: whether the
 * column exists at this viewport and whether it is currently open.
 *
 * WHY A NARROW CONTEXT AND NOT THE FULL BINDING. The sidebar hides its mode switch while the
 * PC column is expanded — switching modes would leave the session page the column is pinned
 * to. Reading `CockpitColumnBinding` from the cockpit's own module would put the sidebar and
 * the cockpit in one package cycle. This context is provided by the cockpit's column provider
 * from the SAME snapshot the rest of the column reads, so there is still one truth; the type
 * is restated here (three known layouts, one boolean) instead of imported, keeping the
 * contract a leaf.
 */

/** The column's three viewport layouts. Mirrors `CockpitColumnLayout` from the controller. */
export type CockpitColumnVisibility = {
  layout: 'squeeze' | 'overlay' | 'hidden';
  expanded: boolean;
};

/** Null outside the provider — a sidebar rendered alone (a unit test) shows the switch. */
export const CockpitColumnVisibilityContext =
  createContext<CockpitColumnVisibility | null>(null);

export function useCockpitColumnVisibility(): CockpitColumnVisibility | null {
  return useContext(CockpitColumnVisibilityContext);
}
