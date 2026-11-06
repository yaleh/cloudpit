import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';
import {
  CodexForkProvider,
  CodexSessionSynchronizer,
  CodexSessionsProvider,
  CodexTokenUsageProvider,
} from '@/modules/providers/list/codex/sessions/index.js';
import { CodexAppServerConnection } from '@/modules/providers/list/codex/app-server/index.js';
import {
  codexMcpGatewayLaunch,
  CodexHostDriver,
  codexRuntime,
} from '@/modules/providers/list/codex/host/index.js';
import { CodexProviderModels } from '@/modules/providers/list/codex/codex-models.provider.js';
import { CodexMcpProvider } from '@/modules/providers/list/codex/codex-mcp.provider.js';
import { CodexShellProvider } from '@/modules/providers/list/codex/codex-shell.provider.js';
import { CodexSkillsProvider } from '@/modules/providers/list/codex/codex-skills.provider.js';
import { sessionHostManager } from '@/modules/session-hosts/index.js';
import { readMcpGatewayClientTarget } from '@/shared/ports/mcp-gateway-client.port.js';
import type {
  IProviderAuth,
  IProviderFork,
  IProviderHostDriver,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderShell,
  IProviderSkills,
  IProviderSessions,
  IProviderTokenUsage,
} from '@/shared/interfaces.js';

export class CodexProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = codexRuntime;
  readonly models: IProviderModels = new CodexProviderModels();
  readonly mcp = new CodexMcpProvider();
  readonly auth: IProviderAuth = new CodexProviderAuth();
  readonly skills: IProviderSkills = new CodexSkillsProvider();
  readonly sessions: IProviderSessions = new CodexSessionsProvider();
  readonly fork: IProviderFork = new CodexForkProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new CodexSessionSynchronizer();
  readonly shell: IProviderShell = new CodexShellProvider();
  readonly tokenUsage: IProviderTokenUsage = new CodexTokenUsageProvider();

  /**
   * Process ownership: the resident host driver.
   *
   * Mounted with the process-wide session-host manager so an on-demand start
   * (`provider-runtime.service.startResidentSession`, reached by the host route
   * and the restore pass) opens a host this manager tracks. Codex declares
   * `resident` in `provider-capabilities.service.ts` (`lifecycleModes:
   * ['per-run', 'resident']`, default `resident`), so the dispatch routes a turn
   * here; the driver is mounted and reachable for that path.
   */
  readonly residentHostDriver: CodexHostDriver = new CodexHostDriver({
    host: sessionHostManager,
    /**
     * The connection factory is the injection point for this server's `/mcp`
     * gateway. It runs when a host is opened (long after `server/index.ts` read the
     * settings file and installed the port), so the target is resolved per spawn
     * rather than captured at module load — the provider singletons are built
     * before that reading exists.
     *
     * The port fails closed: an uninstalled reader (a focused criterion, a process
     * without a composition root) yields `null` and the launch goes through
     * untouched.
     */
    createConnection: (launch) =>
      new CodexAppServerConnection({
        launch: codexMcpGatewayLaunch(launch, readMcpGatewayClientTarget()),
      }),
  });

  /** The same instance under the facet every provider mounts; see the Claude mount. */
  readonly hostDriver: IProviderHostDriver = this.residentHostDriver;

  constructor() {
    super('codex');
  }
}
