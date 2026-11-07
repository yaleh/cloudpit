/**
 * The observation wall's URI grammar — the FRONTEND entry, a pure re-export.
 *
 * The grammar itself lives in the repository-root `shared/` tree
 * (`shared/observation/observationUri.ts`), which BOTH compiler configurations compile
 * (ADR-004 decision 2). It used to be restated in this file and again in
 * `server/modules/observation/core/observation-uri.ts`; archguard's duplicate-code probe
 * reported the two copies as one structurally identical 14-statement parser, and nothing
 * forced them to move together. Both files are now shims onto the single implementation.
 *
 * WHY THIS STAYS A LEAF CONTRACT. The sidebar mints the pin/board addresses for its project
 * and session rows (`formatProjectUri` / `formatSessionUri`), and the cockpit wall parses the
 * same strings. Importing the grammar through `@/modules/cockpit` would give the package graph
 * a cycle (cockpit → sidebar for the mode switch, sidebar → cockpit for this file), so the
 * grammar stays reachable from the cockpit's leaf contract: `shared/` is outside the frontend
 * module graph entirely, so this import adds no module edge.
 *
 *   cloudpit://session/<id>              — one Cloudpi session (canonical since 2.1)
 *   cloudpit://architecture/<projectId>  — one project's architecture graph
 *   quay://<fleetProjectId>/board        — one fleet project's board (the fleet's grammar)
 *   quay://fleet/initiative/<slug>       — one cross-project initiative (the fleet's reserved segment)
 *
 * 3.0 owns one spelling: the formatters mint `cloudpit://` and the parser accepts only those
 * canonical forms. The 2.1 legacy `cloudcli://session/<id>` and `cloudcli://architecture/<id>`
 * read spellings are retired, in step with the server's entry onto the same module.
 *
 * Consumers: the cockpit wall view, the initiative view, their deep-link builders, the
 * sidebar's project/session rows, and the frontend half of the shared URI fixture
 * (`shared/observation/observationUri.fixtures.ts`).
 */
export {
  formatArchitectureUri,
  formatInitiativeUri,
  formatObservationUri,
  formatProjectUri,
  formatSessionUri,
  parseObservationUri,
} from '@shared/observation/observationUri';
export type { ObservationKind, ObservationUri } from '@shared/observation/observationUri';
