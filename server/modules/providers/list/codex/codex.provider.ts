import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import { CodexProviderAuth } from '@/modules/providers/list/codex/codex-auth.provider.js';
import { CodexForkProvider } from '@/modules/providers/list/codex/codex-fork.provider.js';
import { CodexHostDriver } from '@/modules/providers/list/codex/codex-host-driver.provider.js';
import { CodexProviderModels } from '@/modules/providers/list/codex/codex-models.provider.js';
import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import { CodexMcpProvider } from '@/modules/providers/list/codex/codex-mcp.provider.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexShellProvider } from '@/modules/providers/list/codex/codex-shell.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';
import { CodexSkillsProvider } from '@/modules/providers/list/codex/codex-skills.provider.js';
import { CodexTokenUsageProvider } from '@/modules/providers/list/codex/codex-token-usage.provider.js';
import { sessionHostManager } from '@/modules/session-hosts/index.js';
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
   * and the restore pass) opens a host this manager tracks. Codex declares no
   * `resident` lifecycle mode yet — that declaration is a later task — so the
   * dispatch does not route a turn here; the driver is mounted and reachable,
   * which is what makes the declaration a one-line change rather than a
   * re-wiring.
   */
  readonly residentHostDriver: CodexHostDriver = new CodexHostDriver({ host: sessionHostManager });

  /** The same instance under the facet every provider mounts; see the Claude mount. */
  readonly hostDriver: IProviderHostDriver = this.residentHostDriver;

  constructor() {
    super('codex');
  }
}
