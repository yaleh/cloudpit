// The fleet subpackage's public surface: the quay-fleet card provider (the fleet read
// port projected into the card contract), its projection reader and the disposal
// executors. The composition root (`server/cockpit-fleet-wiring.ts`) injects the CLI and
// digest readers, which is what keeps this directory from reaching a sibling module.
//
// It imports the `cards` subpackage (registry, actions) and never the package root, so
// the cockpit directory graph stays a DAG: root -> {brief, cards, fleet}, cards -> brief,
// fleet -> cards.
export type { CockpitFleetContentReader } from './cockpit-fleet-card-projection.js';
export {
  COCKPIT_FLEET_PROVIDER_ID,
  createCockpitFleetCardProvider,
  DEFAULT_COCKPIT_FLEET_CARDS_TTL_MS,
  DEFAULT_COCKPIT_FLEET_EXECUTORS_TTL_MS,
} from './cockpit-fleet-card-provider.js';
export type {
  CockpitFleetCardProvider,
  CockpitFleetCardProviderDeps,
  CockpitFleetReadOptions,
} from './cockpit-fleet-card-provider.js';
export {
  COCKPIT_FLEET_EXECUTORS_ARGS,
  COCKPIT_FLEET_LOG_EXECUTOR_ID,
  CockpitFleetExecutor,
  createCockpitFleetExecutors,
  readCockpitFleetExecutors,
} from './cockpit-fleet-executor.js';
export type {
  CockpitFleetCommandResult,
  CockpitFleetExecutorDeclaration,
  CockpitFleetExecutorDeps,
  CockpitFleetExecutorParam,
  CockpitFleetExecutorReading,
} from './cockpit-fleet-executor.js';
