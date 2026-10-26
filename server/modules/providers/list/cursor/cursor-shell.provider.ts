import type {
  IProviderShell,
  ProviderShellLaunchOptions,
} from '@/shared/interfaces.js';

/**
 * Cursor's terminal launch contract.
 *
 * `cursor-agent` resumes with `--resume="<id>"` and ignores a caller-supplied
 * initial command: the CLI takes no positional prompt on this path.
 */
export class CursorShellProvider implements IProviderShell {
  readonly displayName = 'Cursor';

  launchCommand({ resumeSessionId }: ProviderShellLaunchOptions): string {
    if (resumeSessionId) {
      return `cursor-agent --resume="${resumeSessionId}"`;
    }
    return 'cursor-agent';
  }
}
