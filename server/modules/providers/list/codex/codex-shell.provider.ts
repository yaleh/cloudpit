import type { IProviderShell, ProviderShellLaunchOptions } from '@/shared/interfaces.js';

/**
 * Codex's terminal launch contract.
 *
 * The Shell tab is an ordinary terminal, never a second door onto a conversation
 * the app already holds: a Codex session — resident or per-run — launches
 * `codex`, and a resident process keeps its own thread to itself. Handing the
 * stored thread id to the terminal would put a second process on that
 * conversation, which is why the option is ignored rather than turned into a
 * `resume` launch.
 */
export class CodexShellProvider implements IProviderShell {
  readonly displayName = 'Codex';

  /** Takes the facet's launch options for parity and deliberately ignores them. */
  launchCommand(_options: ProviderShellLaunchOptions): string {
    return 'codex';
  }
}
