/**
 * The observation URI grammar — the SERVER entry, a pure re-export.
 *
 * The grammar itself lives in the repository-root `shared/` tree
 * (`shared/observation/observationUri.ts`), which BOTH compiler configurations compile
 * (ADR-004 decision 2). It used to be restated here and again in
 * `src/modules/cockpit-contract/observationUri.ts`; the two copies had to be kept in step by
 * hand, and archguard's duplicate-code probe reported them as one structurally identical
 * 14-statement parser with no test that could notice the two sides drifting apart. Both files
 * are now shims onto the single implementation, so a change to the addressing grammar reaches
 * both ends by construction.
 *
 * Consumers reach this path (or the `core` / `observation` barrels above it) unchanged:
 * `observation-store.ts` for write validation and the wall, `observation.routes.ts` for
 * transport validation, and the Cloudpit runtime / URI parity criteria through the barrel.
 */
export {
  canonicalObservationUri,
  formatArchitectureUri,
  formatInitiativeUri,
  formatObservationUri,
  formatProjectUri,
  formatSessionUri,
  parseObservationUri,
} from '@shared/observation/observationUri.js';
export type { ObservationKind, ObservationUri } from '@shared/observation/observationUri.js';
