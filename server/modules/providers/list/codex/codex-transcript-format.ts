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
 * - `codex-sessions.provider.ts`'s `readTranscriptMessage` — the narrow prose
 *   reader Quay's session-mentions scan consumes.
 */

import { isRecord } from '@/shared/utils.js';
import type { AnyRecord, ProviderTranscriptMessage } from '@/shared/types.js';

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

// --------------------------- PROSE READER ------------

/**
 * The prose one Codex rollout row carries, or `null` when it carries none.
 *
 * Consumed by `CodexSessionsProvider.readTranscriptMessage`, which is the
 * capability Quay's session-mentions scan reaches through the provider
 * registry. It answers the same question the history projection does — "is this
 * row a prompt/answer the conversation authored?" — by reusing
 * {@link isVisibleCodexUserMessage} and {@link extractCodexText}, but WITHOUT
 * projecting a whole transcript.
 *
 * CARRIER SELECTION, NOT TEXT DEDUPE. A modern rollout records the same user
 * prompt twice and the same assistant answer twice:
 *   - a user prompt is a `response_item`/`message`/`role=user` row (the wire
 *     form, which also carries the AGENTS.md/environment injection) AND an
 *     `event_msg` (`item_completed`/`UserMessage`, or the older
 *     `user_message`) row;
 *   - an assistant answer is a `response_item`/`message`/`role=assistant` row
 *     AND an `event_msg` `item_completed`/`AgentMessage` row.
 * The history projection reads exactly one carrier per role, so this reader
 * does too: user prose from `event_msg` only, assistant prose from
 * `response_item` only. That is what makes a duplicated prompt count ONCE
 * without the reader comparing text — two genuinely separate messages with
 * identical text are still two rows of the chosen carrier and count twice.
 * Removing the selection (accepting the wire `response_item` user row or the
 * `AgentMessage` item) would double every prompt/answer in a real rollout.
 *
 * Everything else — reasonings, tool calls and outputs, lifecycle events,
 * token counts — is a different `payload.type` and answers `null`.
 */
export function readCodexTranscriptMessage(row: unknown): ProviderTranscriptMessage | null {
  if (!isRecord(row)) return null;
  const payload = row.payload;
  if (!isRecord(payload)) return null;

  const timestamp = typeof row.timestamp === 'string' ? row.timestamp : null;
  const prose = (role: ProviderTranscriptMessage['role'], text: string): ProviderTranscriptMessage | null => {
    const trimmed = text.trim();
    if (trimmed === '' || isInternalCodexContent(trimmed)) return null;
    return { role, text: trimmed, timestamp };
  };

  if (row.type === 'event_msg') {
    // Modern paginated rollouts carry the prompt as an item_completed item.
    if (payload.type === 'item_completed') {
      const item = payload.item;
      if (!isRecord(item) || item.type !== 'UserMessage') return null;
      return prose('user', extractCodexText(item.content, '\n'));
    }
    // Older rollouts carry it as a plain user_message payload.
    if (isVisibleCodexUserMessage(payload)) {
      return prose('user', String(payload.message));
    }
    return null;
  }

  if (row.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
    return prose('assistant', extractCodexText(payload.content, '\n'));
  }

  return null;
}

