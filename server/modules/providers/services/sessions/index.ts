/**
 * Sessions subpackage barrel — session-scoped projections that own no provider
 * selection of their own: the history-load cache the Claude provider reads, the
 * `/cost` view derivation and the UI's last-opened-session pointer.
 *
 * Dependency direction: `sessions/` imports only `server/shared/**` (plus the
 * database module); it never imports the package root or another
 * `providers/services` directory. The runtime-backed session service stays in
 * the package root because it reads `provider.registry`, and moving it here
 * would close a directory cycle with `modules/providers`.
 */
export { buildCostView } from './cost-view.js';
export type {
  CostView,
  CostViewContext,
  CostViewReading,
  CostViewSession,
} from './cost-view.js';

export {
  SessionHistoryCache,
  sessionHistoryCache,
  createSessionHistoryCache,
  takeHistoryLoadContext,
} from './session-history-cache.service.js';
export type { HistoryLoadContext } from './session-history-cache.service.js';

export { uiLastOpenedSessionService } from './ui-last-opened-session.service.js';
