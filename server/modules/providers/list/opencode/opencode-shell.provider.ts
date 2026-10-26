import type {
  IProviderShell,
  ProviderShellLaunchOptions,
} from '@/shared/interfaces.js';

/**
 * OpenCode's terminal launch contract.
 *
 * A new session may be opened with a caller-supplied command (the CLI's own
 * "run this" form); a resumed one must use `--session "<id>"`, because the id
 * and not a prompt is what selects the conversation.
 */
export class OpenCodeShellProvider implements IProviderShell {
  readonly displayName = 'OpenCode';

  launchCommand({ resumeSessionId, initialCommand }: ProviderShellLaunchOptions): string {
    if (resumeSessionId) {
      return `opencode --session "${resumeSessionId}"`;
    }
    return initialCommand || 'opencode';
  }
}
