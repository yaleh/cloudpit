import { OpenCodeProviderAuth } from '@/modules/providers/list/opencode/opencode-auth.provider.js';
import { OpenCodeProviderModels } from '@/modules/providers/list/opencode/opencode-models.provider.js';
import { opencodeRuntime } from '@/modules/providers/list/opencode/opencode-runtime.provider.js';
import { OpenCodeMcpProvider } from '@/modules/providers/list/opencode/opencode-mcp.provider.js';
import { OpenCodeSessionSynchronizer } from '@/modules/providers/list/opencode/opencode-session-synchronizer.provider.js';
import { OpenCodeShellProvider } from '@/modules/providers/list/opencode/opencode-shell.provider.js';
import { OpenCodeSessionsProvider } from '@/modules/providers/list/opencode/opencode-sessions.provider.js';
import { OpenCodeSkillsProvider } from '@/modules/providers/list/opencode/opencode-skills.provider.js';
import { OpenCodeTokenUsageProvider } from '@/modules/providers/list/opencode/opencode-token-usage.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderShell,
  IProviderSkills,
  IProviderSessions,
  IProviderTokenUsage,
} from '@/shared/interfaces.js';

export class OpenCodeProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = opencodeRuntime;
  readonly models: IProviderModels = new OpenCodeProviderModels();
  readonly mcp = new OpenCodeMcpProvider();
  readonly auth: IProviderAuth = new OpenCodeProviderAuth();
  readonly skills: IProviderSkills = new OpenCodeSkillsProvider();
  readonly sessions: IProviderSessions = new OpenCodeSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new OpenCodeSessionSynchronizer();
  readonly shell: IProviderShell = new OpenCodeShellProvider();
  readonly tokenUsage: IProviderTokenUsage = new OpenCodeTokenUsageProvider();

  constructor() {
    super('opencode');
  }
}
