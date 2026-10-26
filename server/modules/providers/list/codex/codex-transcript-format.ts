/**
 * The single reader of Codex's transcript formatting conventions.
 *
 * Two readers consume a Codex rollout JSONL stream — the history projection in
 * `codex-sessions.provider.ts` (what the chat transcript shows) and
 * `session-conversations-search.service.ts` (what search finds). Both must give
 * the same answer to "is this a user-visible prompt?" and "what text does this
 * content block carry?", so those readings live here once rather than as two
 * copies that silently drift apart when Codex changes its record format.
 *
 * This mirrors `providers/list/claude/claude-transcript-format.ts`, which is
 * the same split for the Claude side.
 *
 * Consumers:
 * - `codex-sessions.provider.ts` — projects transcript rows into chat messages.
 * - `session-conversations-search.service.ts` — extracts searchable text from
 *   the same rows.
 */

import type { AnyRecord } from '@/shared/types.js';

/**
 * Whether a Codex `event_msg` / `user_message` payload is a prompt the user
 * actually typed.
 *
 * Codex also writes `user_message` rows for internal machinery (compaction
 * notices, knowledge injections) and tags those with a non-`plain` `kind`.
 * Only a plain, non-empty string message is conversation.
 */
export function isVisibleCodexUserMessage(payload: AnyRecord | null | undefined): boolean {
  if (!payload || payload.type !== 'user_message') {
    return false;
  }

  if (payload.kind && payload.kind !== 'plain') {
    return false;
  }

  return typeof payload.message === 'string' && payload.message.trim().length > 0;
}

/**
 * Flattens a Codex message `content` value into its text.
 *
 * Content is either a plain string (older rollouts) or an array of typed
 * blocks; only the three text-bearing block types carry conversation, and an
 * entry that is not an object contributes nothing.
 *
 * `separator` is a parameter rather than a constant because the two readers
 * join blocks differently on purpose: the history projection joins with a
 * newline (each block renders as its own line), while search joins with a space
 * so a phrase spanning two blocks still matches. Both readings are pinned by
 * `codex-transcript-format.test.ts`, so neither can drift unnoticed.
 */
export function extractCodexText(content: unknown, separator: string): string {
  if (!Array.isArray(content)) {
    return typeof content === 'string' ? content : '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const record = item as AnyRecord;
      if (
        (record.type === 'input_text' || record.type === 'output_text' || record.type === 'text')
        && typeof record.text === 'string'
      ) {
        return record.text;
      }

      return '';
    })
    .filter(Boolean)
    .join(separator);
}

/**
 * Codex includes extra internal metadata tags that should not surface as
 * user-facing searchable conversation content.
 */
export const CODEX_INTERNAL_CONTENT_PREFIXES = [
  '<environment_context>',
  '<cwd>',
] as const;

/**
 * Whether a Codex row's text is internal metadata rather than conversation.
 *
 * Search reads this to skip injected context; the history projection already
 * filters those rows by type, so the reading lives here for the surface that
 * needs it and to keep the rule next to the rest of the Codex format.
 */
export function isInternalCodexContent(content: string): boolean {
  const normalized = content.trimStart();
  return CODEX_INTERNAL_CONTENT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
