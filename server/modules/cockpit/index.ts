// The cockpit hub's public surface. `server/index.ts` builds the one process-wide instance
// and hands it to the websocket gateway; the gateway drives `hello` / `handleEvent` /
// `disconnect` through the structurally-typed seam it declares itself, so this barrel never
// becomes a dependency of `modules/websocket` (the directory stays a leaf for AC-394).
export { createCockpitModule, createCockpitCardsModule } from '@/modules/cockpit/cockpit.module.js';
export type {
  CockpitCardsModule,
  CockpitCardsModuleDeps,
  CockpitModuleDeps,
} from '@/modules/cockpit/cockpit.module.js';
export type { CockpitHub, CockpitHubDeps } from '@/modules/cockpit/cockpit-hub.service.js';
// The card contract's backend implementation: the registry (projection), the action
// channel and the fixture provider. Consumers are the composition root and the card
// criterion; a future fleet adapter implements `ICockpitCardProvider` from
// `server/shared/interfaces.ts` and is registered here.
export { createCockpitCardActions } from '@/modules/cockpit/cockpit-card-actions.js';
export type {
  CockpitCardActions,
  CockpitCardConfirmRequest,
  CockpitCardConfirmResult,
} from '@/modules/cockpit/cockpit-card-actions.js';
export { createCockpitCardRegistry } from '@/modules/cockpit/cockpit-card-registry.js';
export type { CockpitCardRegistry } from '@/modules/cockpit/cockpit-card-registry.js';
export { createCockpitFixtureCardProvider } from '@/modules/cockpit/cockpit-fixture-card-provider.js';
export type {
  CockpitFixtureCardProvider,
  CockpitFixtureConfirmation,
} from '@/modules/cockpit/cockpit-fixture-card-provider.js';
// The two built-in content executors: `session.send` writes into the subject's
// conversation, `session.start` opens a new one and navigates to it. They take their
// outside world as injected functions, so the leaf module never imports a sibling.
export {
  COCKPIT_SESSION_SEND_EXECUTOR_ID,
  CockpitSessionSendExecutor,
} from '@/modules/cockpit/cockpit-session-send.executor.js';
export type {
  CockpitSessionSendDeps,
  CockpitSessionSendRequest,
  CockpitSessionSendResult,
} from '@/modules/cockpit/cockpit-session-send.executor.js';
export {
  COCKPIT_SESSION_START_EXECUTOR_ID,
  COCKPIT_SESSION_PROVIDERS,
  CockpitSessionStartExecutor,
  DEFAULT_COCKPIT_SESSION_PROVIDER,
  resolveSessionProject,
} from '@/modules/cockpit/cockpit-session-start.executor.js';
export type {
  CockpitProjectLookup,
  CockpitSessionStartDeps,
  CockpitSessionStartRequest,
  CockpitSessionStartResult,
} from '@/modules/cockpit/cockpit-session-start.executor.js';
// The brief service: card content in, BriefSpec (or the deterministic default) out. The
// composition root injects its gateway/session/transcript seams; the card router calls it.
export { createCockpitBriefService } from '@/modules/cockpit/cockpit-brief.service.js';
export type {
  CockpitBrief,
  CockpitBriefAuthScheme,
  CockpitBriefComplete,
  CockpitBriefCompletion,
  CockpitBriefCompletionRequest,
  CockpitBriefDeps,
  CockpitBriefGateway,
  CockpitBriefProtocol,
  CockpitBriefResult,
} from '@/modules/cockpit/cockpit-brief.service.js';
export { createCockpitBriefSettingsSource } from '@/modules/cockpit/cockpit-brief-settings.js';
export type {
  CockpitBriefSettings,
  CockpitBriefSettingsSource,
} from '@/modules/cockpit/cockpit-brief-settings.js';
// The state vocabulary is published for the hub's consumers (the composition root types its
// target resolver against `CockpitState`) and for the criteria that drive the pure reducer.
export { COCKPIT_HISTORY_LIMIT, buildCockpitMessageBody, classifyCockpitUtterance, createCockpitState, reduceCockpit } from '@/modules/cockpit/cockpit.reducer.js';
export type {
  CockpitDirection,
  CockpitEvent,
  CockpitEventSource,
  CockpitFocusable,
  CockpitPendingSend,
  CockpitRole,
  CockpitSendTarget,
  CockpitState,
  CockpitUtteranceIntent,
  CockpitView,
  CockpitVisibleProject,
  CockpitVisibleSet,
} from '@/modules/cockpit/cockpit.reducer.js';
