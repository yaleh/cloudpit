/**
 * Compatibility re-export of the observation URI grammar.
 *
 * The grammar moved to `@/modules/cockpit/contract/observationUri` (the cockpit's leaf
 * contract) so the sidebar's rows can mint the same addresses the cockpit parses without
 * importing this package's barrel — the edge that closed a package cycle. Cockpit files keep
 * this import path; it must stay a pure re-export so there is one implementation.
 */
export {
  formatArchitectureUri,
  formatInitiativeUri,
  formatObservationUri,
  formatProjectUri,
  formatSessionUri,
  parseObservationUri,
} from '@/modules/cockpit/contract';
export type { ObservationKind, ObservationUri } from '@/modules/cockpit/contract';
