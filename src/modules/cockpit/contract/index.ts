/**
 * The cockpit's leaf contract.
 *
 * This is the one cockpit surface other feature modules may import. It exists so the sidebar
 * (project/session rows, the mode switch) and the dev-only ui-scenario surface can share the
 * cockpit's addresses, observation URIs, pin button and card reading without importing
 * `@/modules/cockpit` — an edge that closes a package cycle because the cockpit imports the
 * sidebar's mode switch back.
 *
 * LEAF RULE: every file under this directory imports React and `src/shared` only. Never a
 * feature module, and never another cockpit file outside `contract/`. `.oxlintrc.json` declares
 * the directory as `frontend-leaf-contract` and enforces the barrel (no deep imports).
 */
export {
  COCKPIT_PATH,
  cockpitViewPath,
  cockpitViewUri,
  formatCockpitView,
  parseCockpitView,
  readCockpitReturnPath,
  rememberCockpitReturnPath,
} from '@/modules/cockpit/contract/viewAddress';
export type { CockpitView } from '@/modules/cockpit/contract/viewAddress';
export {
  formatArchitectureUri,
  formatInitiativeUri,
  formatObservationUri,
  formatProjectUri,
  formatSessionUri,
  parseObservationUri,
} from '@/modules/cockpit/contract/observationUri';
export type { ObservationKind, ObservationUri } from '@/modules/cockpit/contract/observationUri';
export {
  OBSERVATION_BASE,
  observationPinnedUris,
  primeObservationPins,
  setObservationWatch,
  toggleObservationPin,
  useObservationPin,
  WatchPinToggle,
} from '@/modules/cockpit/contract/observationPin';
export type { PinnableWall } from '@/modules/cockpit/contract/observationPin';
export type {
  CockpitCardDensity,
  CockpitCardReading,
  CockpitCardTypeFilter,
} from '@/modules/cockpit/contract/cardReading';
export {
  CockpitColumnVisibilityContext,
  useCockpitColumnVisibility,
} from '@/modules/cockpit/contract/columnVisibility';
export type { CockpitColumnVisibility } from '@/modules/cockpit/contract/columnVisibility';
