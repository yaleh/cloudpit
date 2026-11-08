// The cards subpackage's public surface: the registry (projection), the action channel,
// the feedback store, the fixture provider and the two built-in content executors.
// The knowledge-card readers/authority live in the same subpackage but stay internal
// here — they are reached from the card files that need them, not from the root barrel.
//
// Dependency direction: this subpackage sits BELOW `fleet` (the fleet provider composes
// the card registry and actions) and ABOVE `brief` (the fixture provider reads
// `BRIEF_VERSION`). It never imports the cockpit package root, so the directory graph
// stays acyclic.
export { createCockpitCardActions } from './cockpit-card-actions.js';
export type {
  CockpitCardActions,
  CockpitCardConfirmRequest,
  CockpitCardConfirmResult,
  CockpitCardResendResult,
  CockpitExecutorResolver,
} from './cockpit-card-actions.js';
export { createCockpitCardFeedbackStore } from './cockpit-card-feedback-store.js';
export type {
  CockpitCardFeedbackStore,
  StoredCockpitCardFeedback,
} from './cockpit-card-feedback-store.js';
export { createCockpitCardRegistry } from './cockpit-card-registry.js';
export type {
  CockpitCardProviderDiagnostic,
  CockpitCardRegistry,
  ICockpitCardProviderWithDiagnostics,
  ICockpitCardProviderWithFeedback,
} from './cockpit-card-registry.js';
export {
  createCockpitFixtureCardProvider,
  DEFAULT_COCKPIT_FIXTURE_FEEDBACK,
  FIXTURE_FEEDBACK_EXECUTOR_ID,
} from './cockpit-fixture-card-provider.js';
export type {
  CockpitFixtureCardProvider,
  CockpitFixtureConfirmation,
  CockpitFixtureFeedbackCall,
  CockpitFixtureFeedbackMode,
  CockpitFixtureFeedbackSettings,
} from './cockpit-fixture-card-provider.js';
export { createCockpitKnowledgeAuthority } from './cockpit-knowledge-decision.js';
export {
  COCKPIT_SESSION_SEND_EXECUTOR_ID,
  CockpitSessionSendExecutor,
} from './cockpit-session-send.executor.js';
export type {
  CockpitSessionSendDeps,
  CockpitSessionSendRequest,
  CockpitSessionSendResult,
} from './cockpit-session-send.executor.js';
export {
  COCKPIT_SESSION_START_EXECUTOR_ID,
  COCKPIT_SESSION_PROVIDERS,
  CockpitSessionStartExecutor,
  createCockpitSessionStarter,
  DEFAULT_COCKPIT_SESSION_PROVIDER,
  resolveSessionProject,
} from './cockpit-session-start.executor.js';
export type {
  CockpitProjectLookup,
  CockpitSessionStartCapabilities,
  CockpitSessionStartControl,
  CockpitSessionStartDeps,
  CockpitSessionStartModels,
  CockpitSessionStartPreferences,
  CockpitSessionStartRequest,
  CockpitSessionStartResult,
  CockpitSessionStartSessions,
  CockpitSessionStarterDeps,
} from './cockpit-session-start.executor.js';
