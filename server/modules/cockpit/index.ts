// The cockpit hub's public surface. `server/index.ts` builds the one process-wide instance
// and hands it to the websocket gateway; the gateway drives `hello` / `handleEvent` /
// `disconnect` through the structurally-typed seam it declares itself, so this barrel never
// becomes a dependency of `modules/websocket` (the directory stays a leaf for AC-394).
//
// The package is split by concern into three subpackages, each with its own barrel:
// `brief/` (the LLM-backed brief service and its spec/prompt/settings family), `cards/`
// (registry, action channel, feedback store, fixture provider, knowledge readers and the
// two built-in content executors) and `fleet/` (the quay-fleet provider, its projection and
// the disposal executors). The directory graph is a DAG — root -> {brief, cards, fleet},
// cards -> brief, fleet -> cards — so the split adds no directory SCC.
export { createCockpitModule, createCockpitCardsModule } from './cockpit.module.js';
export type {
  CockpitCardsModule,
  CockpitCardsModuleDeps,
  CockpitModuleDeps,
} from './cockpit.module.js';
export type { CockpitHub, CockpitHubDeps } from './cockpit-hub.service.js';
export * from './brief/index.js';
export * from './cards/index.js';
export * from './fleet/index.js';
// The state vocabulary is published for the hub's consumers (the composition root types its
// target resolver against `CockpitState`) and for the criteria that drive the pure reducer.
export { COCKPIT_HISTORY_LIMIT, buildCockpitMessageBody, classifyCockpitUtterance, createCockpitState, reduceCockpit } from './cockpit.reducer.js';
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
} from './cockpit.reducer.js';
