/**
 * The cockpit's address grammar, and the return trip through it.
 *
 * WHY THIS IS A LEAF CONTRACT. The sidebar mints the same `/cockpit?view=…&project=…` link the
 * cockpit page parses, and the session round trip (`remember` on the way in, `read` on the way
 * back) is written by the sidebar too. If the sidebar reached those helpers through
 * `@/modules/cockpit` (its barrel), the package graph would contain a cycle: cockpit imports the
 * sidebar's mode switch, the sidebar imports cockpit's barrel. This module is the leaf both
 * sides can import: it owns the grammar and imports nothing from another feature module (not
 * even the cockpit's own files), so no import may point back at the barrel.
 *
 * The view description is deliberately serializable: the URL carries exactly these fields, so a
 * view can be linked, reloaded and restored without any client-side registry.
 */

/**
 * What the cockpit stage currently shows. Four views ship:
 *
 *   { type: 'wall' }                     — the observation wall: session/project/architecture tiles
 *   { type: 'fleet' }                    — every quay project as a tile (the 「全部项目」 view)
 *   { type: 'board', project: <id> }     — one project's board / in-flight tasks
 *   { type: 'initiatives' }              — the initiative view and its decision queue
 *   { type: 'cards' }                    — every provider's open cards, one list, one confirm path
 *
 * THE WALL IS THE HOME. The project grid is kept as one reachable view rather than the landing
 * page, because the cockpit's first job is "what needs me now", not "list everything".
 *
 * The cards view is ADDITIVE: it mounts the card list beside the existing views and changes none
 * of their addresses, so `/cockpit?view=wall|fleet|board|initiatives` keeps rendering exactly what
 * it rendered before.
 */
export type CockpitView =
  | { type: 'wall' }
  | { type: 'fleet' }
  | { type: 'board'; project: string }
  | { type: 'initiatives' }
  | { type: 'cards' };

/** The top-level cockpit route; the view description travels in the query string. */
export const COCKPIT_PATH = '/cockpit';

const VIEW_QUERY_KEY = 'view';
const PROJECT_QUERY_KEY = 'project';

/**
 * Where the browser session remembers the page the person left to enter the cockpit.
 *
 * Session storage, not local storage: the return trip belongs to this tab, and a second
 * window opened on the cockpit (Ctrl+click) must not overwrite the first tab's origin.
 */
const RETURN_PATH_STORAGE_KEY = 'cockpit.returnPath';

/**
 * Remembers the router-relative path the cockpit was entered from, so the cockpit's
 * 「会话」 segment can lead back to it. Relative to the router (basename already stripped),
 * matching what {@link readCockpitReturnPath} hands back to `useHref`.
 */
export function rememberCockpitReturnPath(path: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(RETURN_PATH_STORAGE_KEY, path);
  } catch {
    // A blocked storage area must not break the switch: the cockpit simply falls back home.
  }
}

/**
 * The remembered pre-cockpit route, or `/` when nothing usable was recorded.
 *
 * Only a single-slash absolute path is accepted: a stored value that is empty, relative or
 * protocol-relative would navigate somewhere the person never was (and `//host` is an
 * off-site redirect), so it reads as "no record" instead.
 */
export function readCockpitReturnPath(): string {
  if (typeof window === 'undefined') return '/';
  try {
    const stored = window.sessionStorage.getItem(RETURN_PATH_STORAGE_KEY);
    if (stored !== null && stored.startsWith('/') && !stored.startsWith('//')) {
      return stored;
    }
  } catch {
    // Fall through to the home route.
  }
  return '/';
}

/**
 * Parses the cockpit's query string into a view description.
 *
 * Every malformed or unknown reading falls back to the WALL — the product's home — rather than
 * throwing: the URL is user-editable, and a broken link must still land on the most useful
 * stage. An unknown `view` value and a `board` with no project are both "not a view I can
 * render", and the wall is what a person sees when there is nothing more specific to show.
 */
export function parseCockpitView(search: string): CockpitView {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const viewType = params.get(VIEW_QUERY_KEY);
  if (viewType === 'board') {
    const project = params.get(PROJECT_QUERY_KEY)?.trim() ?? '';
    return project === '' ? { type: 'wall' } : { type: 'board', project };
  }
  if (viewType === 'fleet') return { type: 'fleet' };
  if (viewType === 'initiatives') return { type: 'initiatives' };
  if (viewType === 'cards') return { type: 'cards' };
  return { type: 'wall' };
}

/**
 * Formats a view description as a query string (leading `?`), the inverse of
 * {@link parseCockpitView}: `parse(format(view))` returns `view` for every renderable view.
 * `URLSearchParams` owns the escaping, so a project id with a space or slash survives the
 * round trip unchanged.
 */
export function formatCockpitView(view: CockpitView): string {
  const params = new URLSearchParams();
  params.set(VIEW_QUERY_KEY, view.type);
  if (view.type === 'board') {
    params.set(PROJECT_QUERY_KEY, view.project);
  }
  return `?${params.toString()}`;
}

/** The full router path for a view description, used by `navigate` and by the link-out. */
export function cockpitViewPath(view: CockpitView): string {
  return `${COCKPIT_PATH}${formatCockpitView(view)}`;
}

/**
 * The `quay://` address of the view itself, for the status bar's fallback when no object is
 * focused (a board whose snapshot failed still names the board it is showing).
 *
 * The project segment is the board project's quay-fleet REGISTRY ID, passed in because the
 * view description itself carries the CloudCLI project id (the id the snapshot route is keyed
 * by). `null` when the fleet does not register the project: there is no honest address, and
 * the fleet view — a CloudCLI-level view — has none either.
 */
export function cockpitViewUri(view: CockpitView, fleetProjectId: string | null): string | null {
  return view.type === 'board' && fleetProjectId !== null
    ? `quay://${fleetProjectId}/board`
    : null;
}
