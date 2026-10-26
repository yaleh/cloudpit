import type {
  IProvider,
  IProviderAuth,
  IProviderMcp,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderShell,
  IProviderSkills,
  IProviderSessions,
  IProviderTokenUsage,
} from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';

/**
 * Shared provider base.
 *
 * Concrete providers expose their live runtime plus model, auth, MCP, skill,
 * session, and synchronization facets behind one registry-owned object.
 */
export abstract class AbstractProvider implements IProvider {
  readonly id: LLMProvider;
  abstract readonly runtime: IProviderRuntime;
  abstract readonly models: IProviderModels;
  abstract readonly mcp: IProviderMcp;
  abstract readonly auth: IProviderAuth;
  abstract readonly skills: IProviderSkills;
  abstract readonly sessions: IProviderSessions;
  abstract readonly sessionSynchronizer: IProviderSessionSynchronizer;
  abstract readonly shell: IProviderShell;
  abstract readonly tokenUsage: IProviderTokenUsage;

  protected constructor(id: LLMProvider) {
    this.id = id;
  }
}
