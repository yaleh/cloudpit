// settingsRoutes: used by the server entrypoint to mount protected application-settings endpoints.
export { settingsRoutes } from './settings.module.js';
// createSettingsRouter: used by the settings criteria to mount the production route
// factory on a real express server without importing the assembled module singleton.
export { createSettingsRouter } from './settings.routes.js';
// createSettingsService: used by the settings criteria to assemble the production
// service with injected dependencies (including the OAuth access-token port).
export { createSettingsService } from './settings.service.js';
// loadServerSettings / SERVER_SETTINGS_ENV: the generic SERVER-level settings file
// (`~/.config/claudecodeui/server.settings.json`, or the path `SERVER_SETTINGS_PATH`
// names), read once at boot by `server/index.ts` for knobs that belong to the
// process rather than to a user. Per-user settings stay in the settings store
// behind the routes above; this file is the one carrier for server-wide policy.
export {
  DEFAULT_COCKPIT_SESSION_START_LIFECYCLE_MODE,
  DEFAULT_COCKPIT_SESSION_START_PERMISSION_MODE,
  loadServerSettings,
  SERVER_SETTINGS_ENV,
} from './server-settings.js';
// resolveCodexMcpGateway: turns the `codex.mcpGateway` block into the `{url, token}`
// the composition root installs on the provider-facing port. Kept here (not in
// `server-settings.ts`) so the 800-line ratchet can absorb future blocks without
// moving this one, and so a criterion can drive it over a literal block.
export { resolveCodexMcpGateway, type CodexMcpGatewayResolution } from './codex-mcp-gateway.settings.js';
// createServerFeaturesRouter: mounted by the server entrypoint at
// `/api/settings/features` to publish the server-level switches a client must know before it
// renders an entry point (today: the cockpit). Kept as a factory so a criterion can mount it
// over a literal reading without composing the assembled settings module.
export { createServerFeaturesRouter } from './server-features.routes.js';
// ServerSettings / ResidentRestoreSettings / ObservationSettings / CockpitSettings: the
// reading `server/index.ts` branches on (`residentRestore.enabled`, `max`, `maxAgeMs`,
// `observation.wallLimit`, `cockpit.enabled`) and the shape of those blocks. Exported for that
// composition root and for the resident-restore criterion, which drives the loader over files
// it owns.
export type {
  CockpitSessionStartSettings,
  CockpitSettings,
  InitiativeSettings,
  ObservationSettings,
  ResidentRestoreSettings,
  ServerFeatures,
  ServerSettings,
} from './server-settings.js';
export type { CodexMcpGatewaySettings } from './codex-mcp-gateway.settings.js';
// createCodexModelProvidersSource / CodexModelProvidersSource: the project-owned Codex upstream
// provider registry (`~/.config/cloudpit/codex.settings.json`). The settings API writes through
// the one instance `settings.module.ts` owns; the resident/per-run Codex injection tasks create
// their own source over the same file and call `resolve(id)` AT SPAWN TIME (reads are uncached),
// so an edit reaches the next launch without a restart.
export {
  createCodexModelProvidersSource,
  type CodexModelProviderResolution,
  type CodexModelProvidersSource,
  type ResolvedCodexModelProvider,
} from './codex-model-providers.settings.js';
// The registry's own vocabulary, exported so a sibling task names the same reserved ids and the
// same one accepted wire dialect instead of restating them.
export {
  CODEX_PROVIDER_WIRE_API,
  RESERVED_CODEX_PROVIDER_IDS,
} from './codex-model-providers.schema.js';
export { CODEX_SETTINGS_PATH_ENV } from './codex-model-providers.store.js';
// readCockpitSessionStartBoot / resolveServerSettingsFileTarget: the dual read/write target the
// cockpit session-start settings use when the legacy file is the source. Exported so the
// Cloudpit runtime criterion can drive the legacy-read → Cloudpit-write contract over a temp home.
export {
  readCockpitSessionStartBoot,
  resolveServerSettingsFileTarget,
} from './server-settings-file.js';
