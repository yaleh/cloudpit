/**
 * The single reader of Claude's transcript formatting conventions.
 *
 * The Claude CLI writes a mix of truly internal transcript rows and
 * "UI-hidden" local command artifacts into the same JSONL stream. Two readers
 * consume that stream — the history projection in
 * `claude-sessions.provider.ts` (what the chat transcript shows) and
 * `session-conversations-search.service.ts` (what search finds). Both must
 * give the same answer to "is this row internal?" and "how does a slash
 * command read?", so those readings live here once rather than as two copies
 * that silently drift apart when one side is fixed.
 *
 * Consumers:
 * - `claude-sessions.provider.ts` — projects transcript rows into chat messages.
 * - `session-conversations-search.service.ts` — extracts searchable text from
 *   the same rows.
 * - `claude-sessions.provider.ts`'s `readTranscriptMessage` — the narrow prose
 *   reader Quay's session-mentions scan consumes.
 */

import { isRecord } from '@/shared/utils.js';
import type { ProviderTranscriptMessage } from '@/shared/types.js';

/**
 * Prefixes that mark a Claude transcript row as internal machinery rather than
 * conversation.
 *
 * The first group is shared by every Claude reader:
 * - system reminders / caveats / interruption banners should stay hidden.
 *
 * The local command wrappers (`<command-name>...`) and stdout wrappers
 * (`<local-command-stdout>...`) are deliberately NOT here: both readers remap
 * them into normal chat or searchable text instead of discarding them.
 *
 * Skill bodies belong in this group. When a skill is invoked, Claude injects
 * the entire SKILL.md as a synthetic user turn. Persisted transcripts tag it
 * `isMeta: true`, but the live SDK stream does not, so without a content-level
 * check the same payload renders as a huge user bubble during the run and then
 * vanishes on reload. The skill is already represented by the `Skill` tool
 * call, so it is never user-visible content.
 *
 * `Invalid API key` is an authentication banner the CLI records as a user row;
 * it is a diagnostic, not something the reader typed, so search and history
 * both hide it.
 */
export const INTERNAL_CONTENT_PREFIXES = [
  '<system-reminder>',
  'Caveat:',
  '[Request interrupted',
  'Base directory for this skill:',
  'Invalid API key',
] as const;

/**
 * Whether a transcript row's text is internal machinery rather than
 * conversation.
 *
 * Shared by `claude-sessions.provider.ts` (history projection) and
 * `session-conversations-search.service.ts` (search) so a row is classified
 * identically on both read surfaces.
 */
export function isInternalContent(content: string): boolean {
  return INTERNAL_CONTENT_PREFIXES.some((prefix) => content.startsWith(prefix));
}

/**
 * The body of the first `<tagName>…</tagName>` pair in a plain string payload,
 * or `null` when the tag is absent.
 *
 * Claude wraps local slash-command metadata in lightweight XML-like tags inside
 * a plain string payload. We intentionally parse only the small tag surface we
 * care about instead of introducing a generic XML parser for untrusted
 * history. Consumed by the history projection and search, for command
 * metadata and `<local-command-stdout>` output alike.
 */
export function extractTaggedContent(content: string, tagName: string): string | null {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<${escapedTagName}>([\\s\\S]*?)<\\/${escapedTagName}>`).exec(content);
  return match ? match[1] : null;
}

/**
 * The structured metadata a Claude local slash-command wrapper carries.
 *
 * Each field is the body of one wrapper tag, or an empty string when the tag
 * is unavailable in an older transcript variant. Consumed by the history
 * projection (to expose `commandName`/`commandMessage`/`commandArgs` on the
 * normalized message) and by search (to read the user-visible command text).
 */
export type ClaudeLocalCommandPayload = {
  commandName: string;
  commandMessage: string;
  commandArgs: string;
};

/**
 * Converts Claude's hidden local command wrapper into structured metadata.
 *
 * The three tags often coexist in one string payload. Returning `null` lets the
 * normal text path continue untouched for unrelated messages. Shared by the
 * history projection and search so both read the same wrapper the same way.
 */
export function parseLocalCommandPayload(content: string): ClaudeLocalCommandPayload | null {
  const commandName = extractTaggedContent(content, 'command-name');
  const commandMessage = extractTaggedContent(content, 'command-message');
  const commandArgs = extractTaggedContent(content, 'command-args');

  if (commandName === null && commandMessage === null && commandArgs === null) {
    return null;
  }

  return {
    commandName: commandName ?? '',
    commandMessage: commandMessage ?? '',
    commandArgs: commandArgs ?? '',
  };
}

/**
 * Produces the short user-visible command string that should appear in chat
 * and in search results.
 *
 * We prefer the slash-prefixed command name because that most closely matches
 * what the user actually typed, and only fall back to the message body when the
 * command name is unavailable in older transcript variants. Shared by the
 * history projection and search.
 */
export function buildLocalCommandDisplayText(payload: ClaudeLocalCommandPayload): string {
  const commandName = payload.commandName.trim();
  const commandMessage = payload.commandMessage.trim();
  const commandArgs = payload.commandArgs.trim();
  const baseCommand = commandName || commandMessage;

  if (!baseCommand) {
    return '';
  }

  return commandArgs ? `${baseCommand} ${commandArgs}` : baseCommand;
}

// --------------------------- PROSE READER ------------

/**
 * Prefixes that mark a persisted row as an event this app DELIVERS but the
 * conversation never authored.
 *
 * These are deliberately NOT added to {@link INTERNAL_CONTENT_PREFIXES}: the
 * history projection renders a `<task-notification>` as a real notification
 * line, so hiding it there would change what a person sees. The prose reader
 * answers a different question — "did the conversation SAY this?" — and a
 * notification body the harness wrote is not something the user or the model
 * said, so it contributes no mention. `isMeta` rows (skill bodies, caveats,
 * cross-session transport envelopes) are rejected whole by the caller for the
 * same reason.
 */
const NON_PROSE_ROW_PREFIXES = ['<task-notification>'] as const;

/**
 * The conversation-bearing text blocks of one Claude `content` value.
 *
 * A plain string is one block (the older user-message shape). An array keeps
 * ONLY blocks whose own `type` is `text`: `tool_use`, `tool_result`, `thinking`
 * and image blocks are different types in the same array, and a hit inside one
 * of them is not something the conversation said.
 */
function proseBlocks(content: unknown): string[] {
  if (typeof content === 'string') {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const texts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type !== 'text') continue;
    if (typeof block.text === 'string') texts.push(block.text);
  }
  return texts;
}

/**
 * Whether one text block is internal machinery rather than authored prose.
 *
 * Covers the shared internal prefixes (system reminders, caveats, skill bodies,
 * interruption banners, auth diagnostics), the delivered-not-authored
 * notification rows above, and Claude's local slash-command surface: the
 * command wrapper is metadata and `<local-command-stdout>` is the command's
 * output, so neither is a message the conversation wrote.
 */
function isNonProseBlock(text: string): boolean {
  if (isInternalContent(text)) return true;
  if (NON_PROSE_ROW_PREFIXES.some((prefix) => text.trimStart().startsWith(prefix))) return true;
  if (parseLocalCommandPayload(text) !== null) return true;
  if (extractTaggedContent(text, 'local-command-stdout') !== null) return true;
  return false;
}

/**
 * The prose one Claude transcript row carries, or `null` when it carries none.
 *
 * Consumed by `ClaudeSessionsProvider.readTranscriptMessage`, which is the
 * capability Quay's session-mentions scan reaches through the provider
 * registry. The gate mirrors the history projection's own visible-row rule:
 * only `user`/`assistant` rows, never `isMeta` (synthetic skill bodies,
 * transport envelopes) or a compaction summary, and only `text` content blocks.
 * The remaining internal/command rules live in {@link isNonProseBlock}.
 *
 * This is a rules-level reader, not a history projection: it deliberately does
 * not remap a slash command to its display text, because "the person ran
 * /model" is a command event, not a sentence that mentions a task.
 */
export function readClaudeTranscriptMessage(row: unknown): ProviderTranscriptMessage | null {
  if (!isRecord(row)) return null;
  if (row.type !== 'user' && row.type !== 'assistant') return null;
  if (row.isMeta === true || row.isCompactSummary === true) return null;

  // The message envelope is `row.message` in persisted rows; the flat shape
  // accepts `content` on the row itself for callers that already unwrapped it.
  const message = isRecord(row.message) ? row.message : row;
  const texts = proseBlocks(message.content).filter((text) => !isNonProseBlock(text));
  const text = texts.join('\n').trim();
  if (text === '') return null;

  return {
    role: row.type,
    text,
    timestamp: typeof row.timestamp === 'string' ? row.timestamp : null,
  };
}

