/**
 * The sidebar session list's reading — the rows a scenario checks for last activity.
 *
 * WHY THIS IS A SIBLING FILE. The sidebar reading is a self-contained slice of the scenario
 * surface: a reading taken from the rows' own `data-session-*` declaration. The surface's own
 * criterion caps every source file at 800 lines, so the slice lives here and `scenarioSurface`
 * imports it; the module's `index.ts` barrel re-exports the two public types, so the frontend
 * boundary rule still has one cross-module import path.
 */

/**
 * One row of the sidebar's session list, read from the row's own activity contract.
 *
 * The row publishes the session it names, the last-activity timestamp it formats the age from,
 * and the age text it actually drew ({@link SidebarSessionItem}'s `data-session-*` attributes).
 * The timestamp is the pre-format reading of the same value the visible age shows, so a scenario
 * can say WHICH activity time the list shows while a person can still read the row itself.
 */
export type ScenarioSidebarRowReading = {
  /** The app session id the row links to (`/session/<id>`). */
  sessionId: string;
  /** The row's rendered title, as its own `title` attribute carries it. */
  title: string;
  /** The `lastActivity` timestamp the age is formatted from, or `null` when the row has none. */
  lastActivity: string | null;
  /** The age text drawn beside the title (`3h`, `2d`, …), or `null` while a running row hides it. */
  ageText: string | null;
};

/** The sidebar's session list reading; `mounted: false` when the sidebar is not on the page. */
export type ScenarioSidebarReading = {
  mounted: boolean;
  /** Every session row the panel draws, in DOM order. */
  rows: ScenarioSidebarRowReading[];
};

/** The reading returned when the sidebar is not on the page. */
const EMPTY_SIDEBAR_READING: ScenarioSidebarReading = { mounted: false, rows: [] };

/**
 * Reads the sidebar's session rows from the activity contract each row draws.
 *
 * The panel is addressed by its documented element id (`#sidebar-panel`) rather than by any
 * component name; a page without it — the cockpit, a bare session route with the sidebar
 * collapsed behind the mobile drawer — answers `mounted: false` instead of inventing rows.
 */
export function readSidebarReading(): ScenarioSidebarReading {
  if (typeof document === 'undefined') {
    return { ...EMPTY_SIDEBAR_READING, rows: [] };
  }
  const panel = document.getElementById('sidebar-panel');
  if (!(panel instanceof HTMLElement)) {
    return { ...EMPTY_SIDEBAR_READING, rows: [] };
  }
  const rows: ScenarioSidebarRowReading[] = [];
  for (const node of panel.querySelectorAll('[data-session-id]')) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }
    const sessionId = node.dataset.sessionId;
    if (!sessionId) {
      continue;
    }
    rows.push({
      sessionId,
      title: node.querySelector('[title]')?.getAttribute('title') ?? '',
      lastActivity: node.dataset.sessionLastActivity ?? null,
      ageText: node.dataset.sessionAge ?? null,
    });
  }
  return { mounted: true, rows };
}
