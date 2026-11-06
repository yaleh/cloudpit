/**
 * Host subpackage barrel — the resident Codex host driver and its collaborators
 * (approvals, background leases/processes, the resident queue, live settings and
 * resident frame normalization). `runtime.provider.ts` is the per-run gateway and
 * lives here because it composes the same host-facing pieces.
 *
 * Dependency direction: `host/` may import `app-server/` and the one
 * `sessions/token-usage-files` reader; nothing here imports the package root or
 * another codex directory in return.
 */
export {
  CodexApprovalBroker,
  CODEX_APPROVAL_METHODS,
  approvalToolForMethod,
  buildApprovalResponse,
  buildServerRequestFallbackResult,
  createCodexApprovalBroker,
} from './codex-approval-broker.js';
export type {
  CodexApprovalToolName,
  CodexApprovalDriverOptions,
  CodexApprovalBrokerDeps,
  PendingCodexApproval,
} from './codex-approval-broker.js';

export { createCodexBackgroundLeaseLedger } from './codex-background-lease-ledger.js';
export type {
  CodexBackgroundLease,
  CodexBackgroundLeaseRelease,
  CodexBackgroundLeaseLedgerOptions,
  CodexBackgroundLeaseLedger,
} from './codex-background-lease-ledger.js';

export { CodexBackgroundProcesses } from './codex-background-processes.js';
export type { CodexBackgroundProcessDeps } from './codex-background-processes.js';

export {
  readThreadId,
  readTurnId,
  normalizeTurnStatus,
  residentThreadDefaults,
  threadDefaultsFromLaunchOptions,
  codexMcpGatewayLaunch,
  backgroundSpawnParams,
  threadParams,
  CODEX_RESIDENT_PERMISSION_MODE,
  CODEX_MCP_GATEWAY_SERVER_NAME,
  CODEX_MCP_GATEWAY_TOKEN_ENV,
} from './codex-host-driver.contract.js';
export type {
  CodexTurnStatus,
  CodexResidentSessionReading,
  CodexThreadDefaults,
  CodexResidentHostPort,
  CodexHostDriverOptions,
  CodexBackgroundProcessSpec,
  PendingTurn,
  ResidentSession,
  PendingResidentLaunch,
} from './codex-host-driver.contract.js';

export { CodexHostDriver } from './codex-host-driver.provider.js';

export { createCodexLiveSettings } from './codex-live-settings.js';
export type {
  CodexSettingsCapabilities,
  CodexTurnSettingsPatch,
  HostReconfigureOutcome,
  CodexLiveSettingsConnection,
  CodexLiveSettingsOptions,
  CodexLiveSettings,
} from './codex-live-settings.js';

export { CodexResidentBlockedTurns, readTurnErrorMessage } from './codex-resident-blocked-events.js';

export {
  normalizeResidentNotification,
  createCodexResidentFrameRelay,
} from './codex-resident-normalize.js';
export type {
  CodexResidentNormalizeOptions,
  CodexResidentTranscriptOptions,
  CodexResidentFrameRelay,
  CodexResidentRelayOptions,
} from './codex-resident-normalize.js';

export {
  residentProviderIdFromLaunchOptions,
  residentLaunchForOptions,
  pendingLaunchForHost,
} from './codex-resident-provider-launch.js';

export { CodexResidentQueue } from './codex-resident-queue.js';
export type { QueuedEntry, CodexResidentQueueDeps } from './codex-resident-queue.js';

export { steerCurrentTurn } from './codex-resident-steer.js';
export type { CodexSteerResult } from './codex-resident-steer.js';

export { codexRuntime } from './codex-runtime.provider.js';
