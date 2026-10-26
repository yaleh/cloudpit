import type { ClaudeSettings } from '@/shared/types';
import { readUserPreference, writeUserPreference } from '@/shared/userSettings';

/**
 * The single reader and writer for Claude's tool-permission settings.
 *
 * Both the chat composer and the shell terminal read them, so they live in the
 * shared layer: the shell seeds its permission toggle from the same stored
 * preference without importing the chat module, which previously closed a
 * package-level dependency cycle (shell -> chat -> ... -> shell).
 *
 * `projectSortOrder` is a separate preference now, but stays on the returned
 * object because `ClaudeSettings` still describes the whole legacy blob.
 */
export function getClaudeSettings(): ClaudeSettings {
  const stored = readUserPreference<Partial<ClaudeSettings>>('claudePermissions', {});

  return {
    allowedTools: Array.isArray(stored.allowedTools) ? stored.allowedTools : [],
    disallowedTools: Array.isArray(stored.disallowedTools) ? stored.disallowedTools : [],
    skipPermissions: Boolean(stored.skipPermissions),
    projectSortOrder: readUserPreference<ClaudeSettings['projectSortOrder']>('projectSortOrder', 'name'),
  };
}

/** Persists Claude's tool permissions after the user grants one from the chat. */
export function saveClaudePermissions(permissions: {
  allowedTools: string[];
  disallowedTools: string[];
  skipPermissions: boolean;
}): void {
  writeUserPreference('claudePermissions', permissions);
}
