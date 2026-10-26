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
