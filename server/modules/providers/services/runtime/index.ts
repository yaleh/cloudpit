/**
 * Provider-runtime subpackage barrel — the launch-spec compilers and the session
 * model/provider binding readers, i.e. the leaf helpers the provider runtime and
 * the Claude/Codex adapters consult before spawning a run.
 *
 * Dependency direction: `runtime/` imports only `server/shared/**` and
 * `modules/database`; it never imports the package root or another
 * `providers/services` directory. That one-way shape is what keeps the AC-394
 * directory graph acyclic after the god-package split.
 */
export { resolveContextWindow, isAllowedLaunchEnvKey } from './launch-spec.service.js';

export { resolveModelLaunchSpec, resolveModelContextWindowRow } from './model-launch-spec.service.js';
export type { LaunchSpecGuards } from './model-launch-spec.service.js';

export { createSessionModelResolver } from './session-model-resolver.js';
export type {
  RecordedSessionSelection,
  SessionModelResolverDependencies,
} from './session-model-resolver.js';

export {
  resolveModelProviderId,
  resolveRequestedProviderId,
  readRecordedProviderBinding,
  assertProviderSwitchAllowed,
  assertProviderAvailable,
} from './session-provider-binding.js';
export type {
  SessionProviderBindingCatalog,
  SessionProviderBinding,
} from './session-provider-binding.js';
