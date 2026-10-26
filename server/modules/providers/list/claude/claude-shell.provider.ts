import type {
  IProviderShell,
  ProviderShellLaunchOptions,
} from '@/shared/interfaces.js';

/**
 * Single-quotes one argv element for bash or PowerShell so profile-supplied
 * values cannot be re-interpreted by the shell.
 *
 * `platform` is a parameter rather than a fresh `os.platform()` call so both
 * platforms' quoting is reachable from one process (and one criterion).
 */
function quoteShellArg(arg: string, platform: NodeJS.Platform): string {
  return `'${arg.replace(/'/g, platform === 'win32' ? "''" : `'\\''`)}'`;
}

/**
 * Claude's terminal launch contract.
 *
 * Extracted verbatim from `shell-websocket.service.ts`'s former provider
 * branch: launching with `--dangerously-skip-permissions` is what unlocks
 * "bypass permissions" in the CLI's shift+tab permission-mode cycle, and it
 * cannot be enabled from inside a session started without it. The compiled
 * model argv rides on the first launch, the `--resume` attempt and the fallback
 * launch so a resumed terminal matches the original.
 */
export class ClaudeShellProvider implements IProviderShell {
  readonly displayName = 'Claude';

  launchCommand({
    resumeSessionId,
    initialCommand,
    platform = process.platform,
    bypassPermissions = false,
    modelArgv = [],
  }: ProviderShellLaunchOptions): string {
    const bypassFlag = bypassPermissions ? ' --dangerously-skip-permissions' : '';
    const argvSuffix = modelArgv
      .map((arg) => ` ${quoteShellArg(arg, platform)}`)
      .join('');
    const claudeFlags = `${bypassFlag}${argvSuffix}`;
    const command = initialCommand || `claude${claudeFlags}`;

    if (resumeSessionId) {
      if (platform === 'win32') {
        return `claude --resume "${resumeSessionId}"${claudeFlags}; if ($LASTEXITCODE -ne 0) { claude${claudeFlags} }`;
      }
      return `claude --resume "${resumeSessionId}"${claudeFlags} || claude${claudeFlags}`;
    }

    return command;
  }
}
