/**
 * The cockpit's entry action, as the cockpit module reaches it.
 *
 * The action itself lives in the leaf contract (`contract/viewAddress`) because the sidebar's
 * mode switch enters the same surface and may not import this package's internals — importing
 * the cockpit's barrel would close the sidebar ⇄ cockpit cycle the contract exists to break.
 * This file is the cockpit-side home for it: the session header's gauge and any future in-module
 * door import `enterCockpit` here, while the sidebar reaches the SAME function through
 * `@/modules/cockpit/contract`, so both entries record the return path through one implementation
 * instead of each remembering on its own.
 *
 * Used by `CockpitHeaderButton` (the session header's gauge, both the column and page variants)
 * and, through the contract, by `SidebarModeSwitch` (the sidebar header, collapsed rail, mobile
 * drawer and the cockpit page's own header).
 */
export { enterCockpit } from '@/modules/cockpit/contract';
export type { CockpitEntryOptions } from '@/modules/cockpit/contract';
