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

/** How much of the assistant's own words a card quote carries. */
export const ASSISTANT_QUOTE_MAX_CHARS = 200;

/**
 * The reason prefix a model-output parse failure carries.
 *
 * The reader uses this token to find digests stored before the digest's output ceiling was
 * raised (`模型输出不可用：…`) and recompute them once. It lives beside the code that writes the
 * reason so the two cannot drift into a repair that never matches.
 */
export const SESSION_ASK_OUTPUT_UNUSABLE_REASON = '模型输出不可用';

/** One asking turn as a transcript-wide scan states it. */
export type TranscriptAsk = {
  /** `<sessionId>:<first asking message id in the span>` — the fleet's dedup key. */
  askId: string;
  /** The assistant message that asked first in this span. */
  messageId: string;
  /** How many asking messages the span contains (a re-ask bumps it). */
  revision: number;
  /** The last asking message's own text. */
  assistantText: string;
};

/**
 * Everything one transcript says about its asks, old and current.
 *
 * `settled` names every ask a LATER user prompt answered, oldest first, so a single turn-end
 * can state the answer for all of them — not only the one the final prompt answered. `current`
 * is the open ask in the transcript's tail span, or null when that span ends on a statement.
 */
export type SessionAskTranscriptScan = {
  settled: Array<{ askId: string; answerMessageId: string }>;
  current: TranscriptAsk | null;
};

/**
 * The assistant's own words from the paragraph its question lives in.
 *
 * The T1 digest restates the question; the card also shows one short verbatim fragment so the
 * reader can see the assistant's tone and qualifications for themselves. The paragraph that
 * carries the question (or the last non-empty paragraph) is used, with hard line breaks folded
 * and the length capped — the quote is an excerpt, never the whole message.
 */
export function assistantQuoteOf(assistantText: string): string | null {
  const paragraphs = assistantText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph !== '');
  if (paragraphs.length === 0) return null;
  const questionParagraph =
    [...paragraphs].reverse().find((paragraph) => /[?？]/.test(paragraph)) ?? paragraphs.at(-1);
  if (questionParagraph === undefined) return null;
  return questionParagraph.length > ASSISTANT_QUOTE_MAX_CHARS
    ? `${questionParagraph.slice(0, ASSISTANT_QUOTE_MAX_CHARS)}…`
    : questionParagraph;
}

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
  /**
   * The debug sink for a failed parse. The raw output's head/tail is written HERE — never into
   * the reading's `reason`, which is what the card shows. Defaults to `console.warn`.
   */
  debugLog?: (message: string) => void;
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

/** The indexes of the transcript's real user prompts, in order. */
function promptIndexesOf(rows: TranscriptRow[]): number[] {
  return rows.map((row, index) => (isUserPromptRow(row) ? index : -1)).filter((index) => index >= 0);
}

/**
 * The ask ending at `endIndex`: its identity, its revision and the message whose words are
 * restated. The ask exists only when the last assistant message at or before `endIndex` is
 * itself asking — a later, non-asking assistant message means that turn already moved on.
 */
function askEndingAt(
  rows: TranscriptRow[],
  sessionId: string,
  endIndex: number,
): SessionAskReading['current'] {
  let lastAssistantIndex = -1;
  for (let index = Math.min(endIndex, rows.length - 1); index >= 0; index -= 1) {
    const row = rows[index];
    if (row !== undefined && transcriptRowRole(row) === 'assistant' && transcriptRowText(row) !== '') {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex < 0) return null;
  const assistantText = transcriptRowText(rows[lastAssistantIndex] ?? {});
  if (!analyzeAsking(assistantText).isAsking) return null;

  // The ask span starts after the last user prompt before the asking message; a re-ask keeps the
  // span's FIRST asking id and bumps the revision.
  const promptIndexes = promptIndexesOf(rows.slice(0, lastAssistantIndex + 1));
  const spanStart = (promptIndexes.at(-1) ?? -1) + 1;
  const asks = askingRows(rows.slice(spanStart, lastAssistantIndex + 1));
  if (asks.length === 0) return null;

  return {
    askId: `${sessionId}:${asks[0]?.messageId ?? ''}`,
    messageId: transcriptRowMessageId(rows[lastAssistantIndex] ?? {}),
    revision: asks.length,
    assistantText,
  };
}

/** The previous ask the last user prompt at or before `endIndex` answers. */
function answeredEndingAt(
  rows: TranscriptRow[],
  sessionId: string,
  endIndex: number,
): SessionAskReading['answered'] {
  const promptIndexes = promptIndexesOf(rows.slice(0, endIndex + 1));
  const answerIndex = promptIndexes.at(-1);
  const previousIndex = promptIndexes.at(-2);
  if (answerIndex === undefined || previousIndex === undefined) return null;
  const previousAsks = askingRows(rows.slice(previousIndex + 1, answerIndex));
  const userMessageId = transcriptRowMessageId(rows[answerIndex] ?? {});
  if (previousAsks.length === 0 || userMessageId === '') return null;
  return { askId: `${sessionId}:${previousAsks[0]?.messageId ?? ''}`, messageId: userMessageId };
}

/**
 * Reads one transcript's ask identity and the bounded context the summariser is given.
 *
 * `askId` is `<sessionId>:<first asking message since the last user prompt>`; `revision` counts
 * the asking messages in that span, so a re-ask before the answer keeps the id and bumps the
 * revision. Without `messageId` the reading follows the transcript's LAST assistant message.
 *
 * WITH `messageId` THE ASK IS LOCATED BY ID. quay-fleet names the assistant message its
 * session-ask card is about; by the time the cockpit reads that card the conversation may have
 * moved on, so requiring the LAST message to be asking leaves the card unresolved forever (the
 * live quay card's named message was twenty turns behind the transcript's end). The named
 * message is the ask; the context stops at it, so the model is shown the turns around the ask
 * rather than the transcript's tail.
 */
export function readSessionAsk(raw: string, sessionId: string, messageId = ''): SessionAskReading {
  const rows = parseTranscriptRows(raw);
  const allPromptIndexes = promptIndexesOf(rows);

  if (messageId !== '') {
    let namedIndex = -1;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (
        row !== undefined &&
        transcriptRowRole(row) === 'assistant' &&
        transcriptRowText(row) !== '' &&
        transcriptRowMessageId(row) === messageId
      ) {
        namedIndex = index;
        break;
      }
    }
    if (namedIndex < 0) {
      return {
        current: null,
        answered: answeredEndingAt(rows, sessionId, rows.length - 1),
        context: renderContext(rows, allPromptIndexes),
      };
    }
    const visibleRows = rows.slice(0, namedIndex + 1);
    return {
      current: askEndingAt(rows, sessionId, namedIndex),
      answered: answeredEndingAt(rows, sessionId, namedIndex),
      context: renderContext(
        visibleRows,
        allPromptIndexes.filter((index) => index <= namedIndex),
      ),
    };
  }

  return {
    current: askEndingAt(rows, sessionId, rows.length - 1),
    answered: answeredEndingAt(rows, sessionId, rows.length - 1),
    context: renderContext(rows, allPromptIndexes),
  };
}

/**
 * Scans the WHOLE transcript for asks and answers, not only the final turn.
 *
 * The single-ask reading above answers "what is being asked right now and what did the last
 * prompt answer". That is enough to state one event per turn, but a session that asked twice
 * between two user messages, or one whose answer arrived while the process was restarting,
 * leaves older asks unresolved forever. This scan groups rows into the spans between user
 * prompts: every span that asked has an identity, and every span followed by another prompt has
 * an answer. The tail span, when it ends on an asking message, is the open ask.
 */
export function readSessionAsks(raw: string, sessionId: string): SessionAskTranscriptScan {
  const rows = parseTranscriptRows(raw);
  const promptIndexes = promptIndexesOf(rows);
  const settled: Array<{ askId: string; answerMessageId: string }> = [];
  let current: TranscriptAsk | null = null;

  // `promptIndexes` are the boundaries: span i runs from just after prompt i-1 to just before
  // prompt i. The last span runs to the transcript's end. This also covers a transcript whose
  // first row is already an assistant message.
  for (let index = 0; index <= promptIndexes.length; index += 1) {
    const start = index === 0 ? 0 : (promptIndexes[index - 1] ?? -1) + 1;
    const answerPrompt = promptIndexes[index];
    const end = answerPrompt === undefined ? rows.length - 1 : answerPrompt - 1;
    if (end < start) continue;
    const asks = askingRows(rows.slice(start, end + 1));
    if (asks.length === 0) continue;
    const first = asks[0];
    if (first === undefined) continue;
    const askId = `${sessionId}:${first.messageId}`;

    if (answerPrompt !== undefined) {
      const answerMessageId = transcriptRowMessageId(rows[answerPrompt] ?? {});
      if (answerMessageId !== '') settled.push({ askId, answerMessageId });
      continue;
    }

    // The tail span: the ask is still open only when the span's LAST assistant message is the
    // asking one; a later non-asking assistant message means that turn moved on.
    let lastAssistantIndex = -1;
    for (let rowIndex = end; rowIndex >= start; rowIndex -= 1) {
      const row = rows[rowIndex];
      if (row !== undefined && transcriptRowRole(row) === 'assistant' && transcriptRowText(row) !== '') {
        lastAssistantIndex = rowIndex;
        break;
      }
    }
    if (lastAssistantIndex < 0) continue;
    const lastAssistantText = transcriptRowText(rows[lastAssistantIndex] ?? {});
    if (!analyzeAsking(lastAssistantText).isAsking) continue;
    current = {
      askId,
      messageId: transcriptRowMessageId(rows[lastAssistantIndex] ?? {}),
      revision: asks.length,
      assistantText: lastAssistantText,
    };
  }

  return { settled, current };
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
  const debugLog = deps.debugLog ?? ((message: string) => console.warn(message));

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
        const reason = failure instanceof Error ? failure.message : String(failure);
        // The raw output is for the operator's log only: the card's reason stays a readable
        // diagnosis, and a half-written answer never becomes the question.
        const head = completion.text.slice(0, 240).replace(/\s+/g, ' ').trim();
        const tail = completion.text.slice(-240).replace(/\s+/g, ' ').trim();
        debugLog(
          `[observation.sessionDigest] 提问摘要解析失败: ${reason}; 原始输出头部=${JSON.stringify(head)}; 尾部=${JSON.stringify(tail)}`,
        );
        return { state: 'unevaluated', reason: `${SESSION_ASK_OUTPUT_UNUSABLE_REASON}：${reason}` };
      }

      const reading = buildAskDecision(parsed, { askId: input.askId, revision: input.revision }, input.assistantText, {
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
      });
      const quote = assistantQuoteOf(input.assistantText);
      return quote === null ? reading : { ...reading, quote };
    },
  };
}
