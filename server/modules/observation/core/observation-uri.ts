/**
 * The observation layer's URI grammar.
 *
 * One object is addressed by one string, and the string is the key every other reading uses:
 * the observed-object row, the revision log, the seen cursor and the watch entry all join on
 * it. The grammar is deliberately small and total — a parser that accepts a loose shape would
 * let a typo create a second object for the same conversation, which is exactly the
 * "unobservable-because-misaddressed" failure this layer exists to prevent.
 *
 *   cloudpit://session/<id>              — one Cloudpi session (canonical since 2.1)
 *   cloudpit://architecture/<projectId>  — one project's architecture graph
 *   quay://<fleetProjectId>/board        — one fleet project's board (the fleet's own grammar)
 *   quay://fleet/initiative/<slug>       — one cross-project initiative (the fleet's reserved segment)
 *
 * 3.0 OWNS ONE SPELLING. 2.1 switched the write and kept the legacy `cloudcli://session/<id>` /
 * `cloudcli://architecture/<id>` read spellings; this release retires those reads, so the parser
 * accepts only the canonical `cloudpit://` forms. The 2.1 key normalization already moved stored
 * object rows onto that spelling. See `docs/proposals/cloudpit-compat-retirement.md` (R6/R7).
 *
 * The initiative address is the fleet's (`ADR-013` reserves `fleet` for exactly this object).
 * The cockpit's initiative view pins it to the wall, so the watch routes must accept it even
 * though no observation producer writes an object ROW for it: a pin is a user's bookmark, and
 * refusing the fleet's own address would make 「钉到观察墙」 impossible for the object the
 * initiative view is about.
 *
 * The cloud scheme is Cloudpi's; quay's board URI is kept verbatim because the fleet owns that
 * address space and will own its "seen" write-back later (see the task's Notes). An id segment
 * may not be empty, may not contain `/`, `?`, `#` or whitespace, and is not percent-decoded
 * here: the routes decode the path parameter once, and every other caller builds the URI with
 * the formatters below.
 *
 * Consumers: `server/modules/observation/core/observation-store.ts` (write validation and the wall)
 * and `server/modules/observation/observation.routes.ts` (transport validation).
 */

/** The object kinds the observation layer models. */
export type ObservationKind = 'session' | 'project' | 'architecture';

/**
 * A parsed observation URI.
 *
 * `uri` is the canonical spelling (exactly what {@link formatObservationUri} produces), so a
 * caller can use the parsed value as a map key without re-formatting it.
 */
export type ObservationUri =
  | { scheme: 'cloudpit'; kind: 'session'; id: string; uri: string }
  | { scheme: 'cloudpit'; kind: 'architecture'; id: string; uri: string }
  | { scheme: 'quay'; kind: 'project'; id: string; uri: string }
  | { scheme: 'quay'; kind: 'initiative'; id: string; uri: string };

/** One path segment: at least one character, none of the URI's structural characters. */
const SEGMENT = '[^/?#\\s]+';

const CLOUDPIT_URI = new RegExp(`^cloudpit://(session|architecture)/(${SEGMENT})$`);
const QUAY_BOARD_URI = new RegExp(`^quay://(${SEGMENT})/board$`);
/** The fleet's one reserved address: `fleet` is not a project, and only `initiative` lives there. */
const QUAY_INITIATIVE_URI = new RegExp(`^quay://fleet/initiative/(${SEGMENT})$`);

/** The canonical `cloudpit://session/<id>` spelling 2.1 writes. */
export function formatSessionUri(id: string): string {
  return `cloudpit://session/${id}`;
}

/** The canonical `cloudpit://architecture/<id>` spelling 2.1 writes. */
export function formatArchitectureUri(projectId: string): string {
  return `cloudpit://architecture/${projectId}`;
}

/** The canonical `quay://<fleetProjectId>/board` spelling. */
export function formatProjectUri(fleetProjectId: string): string {
  return `quay://${fleetProjectId}/board`;
}

/** The canonical `quay://fleet/initiative/<slug>` spelling. */
export function formatInitiativeUri(slug: string): string {
  return `quay://fleet/initiative/${slug}`;
}

/** Formats a parsed URI back to its canonical spelling. */
export function formatObservationUri(parsed: ObservationUri): string {
  switch (parsed.kind) {
    case 'session':
      return formatSessionUri(parsed.id);
    case 'architecture':
      return formatArchitectureUri(parsed.id);
    case 'project':
      return formatProjectUri(parsed.id);
    case 'initiative':
      return formatInitiativeUri(parsed.id);
  }
}

/**
 * Parses one URI, returning `null` for anything outside the grammar.
 *
 * `null` rather than a throw is the right shape here: the routes turn it into their own 400,
 * and the store turns it into its own rejected write. Neither wants a parser exception to leak
 * as a 500.
 */
export function parseObservationUri(value: unknown): ObservationUri | null {
  if (typeof value !== 'string') return null;
  const cloud = CLOUDPIT_URI.exec(value);
  if (cloud !== null) {
    const kind = cloud[1] === 'session' ? 'session' : 'architecture';
    const id = cloud[2]!;
    return { scheme: 'cloudpit', kind, id, uri: kind === 'session' ? formatSessionUri(id) : formatArchitectureUri(id) };
  }
  const initiative = QUAY_INITIATIVE_URI.exec(value);
  if (initiative !== null) {
    return { scheme: 'quay', kind: 'initiative', id: initiative[1]!, uri: value };
  }
  const quay = QUAY_BOARD_URI.exec(value);
  if (quay !== null) {
    return { scheme: 'quay', kind: 'project', id: quay[1]!, uri: value };
  }
  return null;
}

/**
 * Maps an accepted object address onto its canonical `cloudpit://` form; a `quay://` address (or
 * an unparseable value) is returned verbatim. Consumers: the observation store's row mapping and
 * the wall's join keys.
 */
export function canonicalObservationUri(value: string): string {
  const parsed = parseObservationUri(value);
  return parsed === null ? value : parsed.uri;
}
