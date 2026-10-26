/**
 * The T1 structured decision digest — what one session is asking, and what each answer would do.
 *
 * WHY IT EXISTS. A third of the person's messages are answers to the assistant's questions, yet
 * the observation layer's own `askingYou` reading is only a verbatim excerpt of the turn's last
 * paragraph: no situation, no options, no consequences. The cockpit needs the question RESTATED,
 * not copied, so this module makes one model call — through the exact gateway client and
 * settings reader the session-digest LLM tier already uses, no new channel — and validates the
 * answer against a fixed shape before any of it reaches a card.
 *
 * WHAT IT READS. The question comes from the transcript's LAST assistant message, never from the
 * stored digest's `askingYou` excerpt: that excerpt can lag a turn (measured 2026-10-27: 2 of 8
 * sampled sessions named the wrong question), while the last assistant row is the one the person
 * is actually looking at.
 *
 * FAILURE IS LOUD AND EMPTY. A malformed model answer is `unevaluated` with the reason; the
 * assistant's last sentence is NEVER passed off as the restated question.
 *
 * Consumers: `session-digest.producer.ts` (attaches `digest.askDecision` and states the
 * `session.asking`/`session.answered` events) and `tests/session-ask-decision-digest.test.ts`.
 */
import { completeLlm, credentialFromKey, type LlmCompletion, type LlmCompletionRequest } from '@/modules/llm-gateway/index.js';
import type { SessionAskDecisionReading } from '@/shared/types.js';

import {
  analyzeAsking,
  isUserPromptRow,
  parseTranscriptRows,
  transcriptRowMessageId,
  transcriptRowRole,
  transcriptRowText,
} from './session-digest.js';
import type { ParsedAskAnswer } from './session-ask-decision-answer.js';
import { buildAskDecision, parseAskDecisionAnswer, SYSTEM_PROMPT } from './session-ask-decision-answer.js';
import { createSessionDigestLlmSettingsSource, type SessionDigestLlmSettings } from './session-digest-llm-settings.js';

/** How many user turns of transcript the model is shown; older turns are left out. */
export const SESSION_ASK_CONTEXT_TURNS = 3;
/** Per-message cap inside the prompt, so one huge tool-heavy message cannot fill the window. */
const CONTEXT_MESSAGE_CHARS = 1200;
/** Whole-prompt cap; the tail is kept because the question is at the end. */
const CONTEXT_MAX_CHARS = 6000;

type TranscriptRow = Record<string, unknown>;

/** One asking message: the id the dedup key names, and the words the model restates. */
type AskingRow = { messageId: string; text: string };

/** What one transcript says about the ask it ends on and the ask its last prompt answered. */
export type SessionAskReading = {
  /** The current turn's ask, or null when the last assistant message does not ask anything. */
  current: { askId: string; messageId: string; revision: number; assistantText: string } | null;
  /** The previous ask this transcript's last user prompt answers, or null. */
  answered: { askId: string; messageId: string } | null;
  /** The bounded recent-turn rendering sent to the model, oldest first. */
  context: string;
};

/** One digest call's input: the recent turns plus the last assistant message they end on. */
export type SessionAskSummaryInput = {
  sessionId: string;
  sessionTitle: string;
  /** The first asking message since the last user prompt — the fleet dedup key's second half. */
  askId: string;
  /** How many asking messages have appeared before the user answered. */
  revision: number;
  /** The last assistant message's own text — the only source for the restated question. */
  assistantText: string;
  /** The bounded recent-turn rendering, oldest first. */
  context: string;
};

/** The summariser the producer calls for one asking turn. */
export type SessionAskDecisionDigest = {
  summarize(input: SessionAskSummaryInput): Promise<SessionAskDecisionReading>;
};

/** What the summariser needs from the world; production supplies every default. */
export type SessionAskDecisionDigestDeps = {
  /** The model settings, re-read per call. Defaults to the observation.sessionDigest reader. */
  readSettings?: () => SessionDigestLlmSettings;
  /** The completion seam. Defaults to the gateway leaf client. */
  complete?: (request: LlmCompletionRequest) => Promise<LlmCompletion>;
};

/** The asking messages among `rows`, oldest first, with rows that carry no id dropped. */
function askingRows(rows: TranscriptRow[]): AskingRow[] {
  const asks: AskingRow[] = [];
  for (const row of rows) {
    if (transcriptRowRole(row) !== 'assistant') continue;
    const text = transcriptRowText(row);
    const messageId = transcriptRowMessageId(row);
    if (text !== '' && messageId !== '' && analyzeAsking(text).isAsking) asks.push({ messageId, text });
  }
  return asks;
}

/** Renders the last few user turns, skipping rows with no text (tool results included). */
function renderContext(rows: TranscriptRow[], promptIndexes: number[]): string {
  const start = promptIndexes.at(-SESSION_ASK_CONTEXT_TURNS) ?? 0;
  const lines: string[] = [];
  for (const row of rows.slice(start)) {
    const role = transcriptRowRole(row);
    const text = transcriptRowText(row);
    if (role === '' || text === '') continue;
    const clipped = text.length > CONTEXT_MESSAGE_CHARS ? `${text.slice(0, CONTEXT_MESSAGE_CHARS)}…` : text;
    lines.push(`[${role === 'user' ? '用户' : '助手'}] ${clipped}`);
  }
  const context = lines.join('\n\n');
  return context.length > CONTEXT_MAX_CHARS ? context.slice(context.length - CONTEXT_MAX_CHARS) : context;
}

/**
 * Reads one transcript's ask identity and the bounded context the summariser is given.
 *
 * `askId` is `<sessionId>:<first asking message since the last user prompt>`; `revision` counts
 * the asking messages in that span, so a re-ask before the answer keeps the id and bumps the
 * revision. The answered reading mirrors the rule on the span before the last user prompt.
 */
export function readSessionAsk(raw: string, sessionId: string): SessionAskReading {
  const rows = parseTranscriptRows(raw);
  const promptIndexes = rows.map((row, index) => (isUserPromptRow(row) ? index : -1)).filter((index) => index >= 0);
  const currentRows = rows.slice((promptIndexes.at(-1) ?? -1) + 1);

  const currentAsks = askingRows(currentRows);
  const lastAssistant = [...currentRows]
    .reverse()
    .find((row) => transcriptRowRole(row) === 'assistant' && transcriptRowText(row) !== '');
  const lastAssistantIsAsking = lastAssistant !== undefined && askingRows([lastAssistant]).length > 0;
  const current =
    lastAssistantIsAsking && currentAsks.length > 0
      ? {
          askId: `${sessionId}:${currentAsks[0]?.messageId ?? ''}`,
          messageId: transcriptRowMessageId(lastAssistant),
          revision: currentAsks.length,
          assistantText: transcriptRowText(lastAssistant),
        }
      : null;

  const answerIndex = promptIndexes.at(-1);
  const previousIndex = promptIndexes.at(-2);
  let answered: SessionAskReading['answered'] = null;
  if (answerIndex !== undefined && previousIndex !== undefined) {
    const previousAsks = askingRows(rows.slice(previousIndex + 1, answerIndex));
    const userMessageId = transcriptRowMessageId(rows[answerIndex] ?? {});
    if (previousAsks.length > 0 && userMessageId !== '') {
      answered = { askId: `${sessionId}:${previousAsks[0]?.messageId ?? ''}`, messageId: userMessageId };
    }
  }

  return { current, answered, context: renderContext(rows, promptIndexes) };
}

/** The one prompt: recent turns, then the message whose question is being restated. */
function buildUserPrompt(input: SessionAskSummaryInput): string {
  return [
    `会话标题：${input.sessionTitle}`,
    '',
    '最近几轮对话：',
    '"""',
    input.context,
    '"""',
    '',
    '最后一条助手消息（提问所在，问题重述只能来自这里）：',
    '"""',
    input.assistantText,
    '"""',
  ].join('\n');
}

/** Builds the summariser over its injected world. `summarize` never rejects. */
export function createSessionAskDecisionDigest(deps: SessionAskDecisionDigestDeps = {}): SessionAskDecisionDigest {
  const settingsSource = createSessionDigestLlmSettingsSource();
  const readSettings = deps.readSettings ?? (() => settingsSource.read());
  const complete = deps.complete ?? completeLlm;

  return {
    async summarize(input) {
      const settings = readSettings();
      if (!settings.enabled) return { state: 'skipped', reason: '未启用 observation.sessionDigest（提问决策摘要）' };

      let completion: LlmCompletion;
      try {
        completion = await complete({
          config: {
            protocol: settings.protocol,
            baseUrl: settings.baseUrl,
            model: settings.model,
            authScheme: settings.authScheme,
            credential: credentialFromKey(settings.apiKey),
            disableThinking: settings.disableThinking,
            timeoutMs: settings.timeoutMs,
          },
          system: SYSTEM_PROMPT,
          user: buildUserPrompt(input),
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
        });
      } catch (failure) {
        return { state: 'unevaluated', reason: `模型调用失败：${failure instanceof Error ? failure.message : String(failure)}` };
      }

      let parsed: ParsedAskAnswer;
      try {
        parsed = parseAskDecisionAnswer(completion.text);
      } catch (failure) {
        return { state: 'unevaluated', reason: `模型输出不可用：${failure instanceof Error ? failure.message : String(failure)}` };
      }

      return buildAskDecision(parsed, { askId: input.askId, revision: input.revision }, input.assistantText, {
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      });
    },
  };
}
