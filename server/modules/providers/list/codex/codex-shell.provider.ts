import type {
  IProviderShell,
  ProviderShellLaunchOptions,
} from '@/shared/interfaces.js';

/**
 * Codex's terminal launch contract.
 *
 * A resumed Codex process falls back to a fresh one when the saved thread is
 * gone: `codex resume <id>` exits non-zero in that case, and the `|| codex`
 * (PowerShell: `if ($LASTEXITCODE -ne 0)`) is what keeps the terminal usable
 * rather than showing a dead session.
 */
export class CodexShellProvider implements IProviderShell {
  readonly displayName = 'Codex';

  launchCommand({
    resumeSessionId,
    platform = process.platform,
  }: ProviderShellLaunchOptions): string {
    if (resumeSessionId) {
      if (platform === 'win32') {
        return `codex resume "${resumeSessionId}"; if ($LASTEXITCODE -ne 0) { codex }`;
      }
      return `codex resume "${resumeSessionId}" || codex`;
    }
    return 'codex';
  }
}
