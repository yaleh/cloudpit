/**
 * The deterministic session digest — what one finished turn was about.
 *
 * A digest is READ OFF THE TRANSCRIPT, never inferred by a model: the conclusion is the
 * assistant's own final words (marked `tier: 'deterministic'`, excerpted verbatim), the changed
 * files and commands are the turn's own tool calls, and the test reading is parsed out of the
 * command's real output. When any of those cannot be read the digest says so with
 * `state: 'unevaluated'` and a reason — the same "get it wrong loudly" rule the observation
 * layer applies to every other reading.
 *
 * The turn boundary is the provider's own: the rows after the last REAL user prompt. Tool-result
 * rows are `user` rows in Claude's transcript but they are not prompts, so a turn that ends in a
 * long test run still reads as the turn that started with the person's message.
 *
 * Consumers: `server/modules/observation/session-digest.producer.ts` (the write path) and
 * `server/modules/observation/tests/session-digest.test.ts` (the criterion).
 */

import type { SessionAskDecisionReading } from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

/** What one turn's activity reads as on the wall. */
export type SessionActivity = 'running' | 'waiting' | 'idle' | 'error';

/** The test runners whose summary output the digest knows how to read. */
export type SessionTestRunner = 'vitest' | 'node-test' | 'playwright';

/**
 * One turn's test reading.
 *
 * `unevaluated` is not a failure: it is "this turn produced no output we could read a count
 * from", and it always carries the reason it could not.
 */
export type SessionTestReading =
  | { state: 'evaluated'; runner: SessionTestRunner; passed: number; failed: number }
  | { state: 'unevaluated'; reason: string };

/** One turn's deterministic summary. The observation store carries it as an opaque JSON digest. */
export type SessionDigest = {
  /** `running` only ever comes from activity outside the transcript; a digest is written at rest. */
  activity: SessionActivity;
  /** The assistant's final paragraph, verbatim, marked as an excerpt. */
  conclusion: {
    text: string;
    truncated: boolean;
    tier: 'deterministic';
    label: '原文摘录';
  };
  /** Files this turn edited, deduplicated, in first-touched order. */
  changedFiles: string[];
  /** Commands this turn ran, as a description or the command's first segment. */
  commands: string[];
  /** The last parseable test run of the turn, or why none was readable. */
  tests: SessionTestReading;
  /** The final paragraph's question and numbered options, when it asks one. */
  askingYou: {
    isAsking: boolean;
    question: string | null;
    options: string[];
  };
  /** How many real user prompts the transcript holds — the delta's "新增 N 轮" baseline. */
  turnCount: number;
  /**
   * The T1 structured decision digest for the question this turn ends on, when one was produced.
   *
   * Optional because it is written by the model tier, not read off the transcript: a turn that
   * does not ask, or a deployment that has the tier switched off, carries no such field at all.
   *
   * THIS IS THE LATEST ASK'S SLOT, kept for readers that ask the session rather than a card. A
   * card is about ONE asking message, and a session can have several open asks at once, so the
   * per-ask history below is what a card resolves; a card must never borrow this slot.
   */
  askDecision?: SessionAskDecisionReading;
  /**
   * Every ask this session summarized, keyed by its askId, newest last.
   *
   * A session can have several unanswered questions on screen at the same time (the live
   * 2026-10-29 case had three), and each card must show ITS OWN question and options. The map is
   * the bounded history: `SESSION_ASK_DECISION_HISTORY_LIMIT` entries, oldest dropped first.
   * Absent on digests written before the per-ask history existed.
   */
  askDecisions?: Record<string, SessionAskDecisionReading>;
  /**
   * The asking message id each summarized ask belongs to, so a card's `contentRef.messageId`
   * resolves to its own `askId` without reading the transcript. The producer indexes the message
   * its `session.asking` event named, and the reader indexes the card's message on repair — a
   * re-ask keeps the first message id as its askId but is stated under the re-ask's message.
   */
  askDecisionMessages?: Record<string, string>;
};

/** Either a readable digest or the reason one could not be read. */
export type SessionDigestResult =
  | { state: 'evaluated'; digest: SessionDigest }
  | { state: 'unevaluated'; reason: string };

/** The excerpt cap: about 280 characters of the assistant's own final words. */
export const SESSION_DIGEST_CONCLUSION_CHARS = 280;

/** Tool names whose calls name a file this turn changed. */
const FILE_TOOL_NAMES = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

/** Commands that are a test run, by the words the runner itself prints. */
// `tsx` is in the same arm as `node` because every server criterion in this repo runs node's
// own test runner through the TS loader (`npx tsx --tsconfig server/tsconfig.json --test …`);
// leaving it out read those turns as "no test command" even though node printed the summary.
const TEST_COMMAND = /\b(?:vitest|playwright)\b|\b(?:node|tsx)\b[^\n]*\s--test\b|\bnpm\s+(?:run\s+)?test\b|\bjest\b/;

/** The vitest summary line: `Tests  2 failed | 8 passed (10)`, or a passed-only line. */
const VITEST_SUMMARY = /^\s*Tests\s+(.+)$/m;
const VITEST_FAILED = /(\d+)\s+failed/;
const VITEST_PASSED = /(\d+)\s+passed/;

/** node:test's TAP/spec summaries: `# pass 5` / `ℹ fail 0`. */
const NODE_TEST_PASSED = /(?:^|\n)\s*(?:#|ℹ)\s*pass\s+(\d+)/;
const NODE_TEST_FAILED = /(?:^|\n)\s*(?:#|ℹ)\s*fail\s+(\d+)/;

/** Playwright's summary lines: `  9 passed (5.2s)` / `  1 failed`. */
const PLAYWRIGHT_COUNT = /^\s*(\d+)\s+(passed|failed)\b/gm;

/** A numbered option line: `1.`, `1)`, `1、`, `(1)`. */
const NUMBERED_OPTION = /^\s*(?:\(?\d+[.)、]|（\d+）)\s+(.+)$/;

/** A Markdown heading line; a paragraph that carries one is prose, never a pick-one list. */
const MARKDOWN_HEADING = /^\s{0,3}#{1,6}\s/;

/**
 * A numbered line longer than this is prose that happens to start with `1.`, not an option.
 * The CLI's own option lines are short labels; this is the "短行" half of the option shape.
 */
const OPTION_LINE_MAX_CHARS = 80;

type UnknownRecord = Record<string, unknown>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The message object of a transcript row, whichever provider shape it uses. */
function rowMessage(row: UnknownRecord): UnknownRecord | null {
  return isRecord(row.message) ? row.message : null;
}

/** One row's content blocks, normalised from the string and array forms transcripts use. */
function rowContentBlocks(row: UnknownRecord): UnknownRecord[] {
  const message = rowMessage(row);
  const content = message?.content;
  if (Array.isArray(content)) {
    return content.filter(isRecord);
  }
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return [];
}

/** A text block's text, or the empty string. */
function blockText(block: UnknownRecord): string {
  const text = block.text;
  return typeof text === 'string' ? text : '';
}

/**
 * The envelopes the harness writes as `user` rows but no person typed.
 *
 * A background-task completion arrives as a bare `<task-notification>…</task-notification>`
 * string in a `user` row. Reading that as a prompt makes the transcript claim "the user spoke
 * again" after every background task: it opens a new turn span and, for the ask ledger, answers
 * a pending question nobody answered. The other tags are the same kind of row — slash-command
 * and bash-escape bookkeeping, and the metadata blocks the CLI appends.
 *
 * `cross-session-message` is another Claude session's SendMessage. It arrives as a `user` row
 * because it enters this session as a turn, but the person did not type it; counting it as a
 * prompt answered a pending ask the human had not answered yet.
 */
const SYNTHETIC_USER_TURN_TAGS = [
  'task-notification',
  'cross-session-message',
  'system-reminder',
  'local-command-stdout',
  'local-command-stderr',
  'command-name',
  'command-message',
  'command-args',
  'bash-input',
  'bash-stdout',
  'bash-stderr',
] as const;

/**
 * The fixed lead-in the CLI puts before a peer-session envelope. It is harness prose, not the
 * person's words, so it strips together with the envelope; older rows that carry no
 * `origin.kind` marker are still recognised by their text alone.
 */
const SYNTHETIC_USER_TURN_LEAD_IN = /^\s*Another Claude session sent a message:\s*/;

/**
 * One leading synthetic envelope; matched repeatedly so stacked blocks still strip fully.
 *
 * The opening tag may carry attributes (`<cross-session-message from="…" from-name="…">`), so
 * the name is followed by an optional attribute run. Matching only the bare form left those
 * envelopes in place and made the whole row read as a prompt.
 */
const SYNTHETIC_USER_TURN_ENVELOPE = new RegExp(
  `^\\s*<(${SYNTHETIC_USER_TURN_TAGS.join('|')})(?:\\s[^>]*)?>[\\s\\S]*?<\\/\\1>`,
);

/**
 * Whether one text block is nothing but harness-injected envelopes.
 *
 * A real prompt that merely CARRIES a metadata block (the CLI often prepends a
 * `<system-reminder>` to the person's own words) keeps a non-envelope remainder and is still a
 * prompt — the whole block must strip to emptiness to stop being one.
 */
function isSyntheticUserText(text: string): boolean {
  let remainder = text.replace(SYNTHETIC_USER_TURN_LEAD_IN, '');
  for (;;) {
    const match = SYNTHETIC_USER_TURN_ENVELOPE.exec(remainder);
    if (match === null) break;
    remainder = remainder.slice(match[0].length);
  }
  return remainder.trim() === '';
}

/**
 * Whether this row is a message another Claude session injected, not the person speaking.
 *
 * The CLI writes such a row as `isMeta: true` with `origin.kind === 'peer'` and
 * `turnOrigin === 'peer'`. Checking the origin first is what makes the rule independent of the
 * envelope's prose and attributes; the text fallback in {@link isSyntheticUserText} covers
 * older rows that predate the origin fields.
 */
function isPeerInjectedRow(row: UnknownRecord): boolean {
  const origin = row.origin;
  if (isRecord(origin) && origin.kind === 'peer') return true;
  return row.turnOrigin === 'peer';
}

/**
 * Whether one row is a real prompt — a person's message, not a tool result and not a
 * harness-injected synthetic turn.
 *
 * Claude records tool results as `user` rows. Treating those as turn boundaries would split a
 * single turn at every tool call, so the boundary is a row that carries non-empty text. A
 * `<task-notification>` or cross-session `user` row also carries non-empty text, but nobody
 * typed it: counting it as a prompt makes a pending ask look answered and shifts the digest's
 * turn boundary.
 */
export function isUserPromptRow(row: UnknownRecord): boolean {
  if (transcriptRowRole(row) !== 'user') return false;
  if (isPeerInjectedRow(row)) return false;
  const texts = rowContentBlocks(row)
    .filter((block) => block.type === 'text')
    .map(blockText)
    .filter((text) => text.trim() !== '');
  if (texts.length === 0) return false;
  // Every non-empty block must be synthetic for the row to be synthetic; a real block beside an
  // injected one means the person did speak on this row.
  return texts.some((text) => !isSyntheticUserText(text));
}

/**
 * One transcript row's role, normalised across the provider shapes transcripts use.
 *
 * Consumers: `session-ask-decision-digest.ts`, which walks the same rows the digest reads to
 * find the asking message; keeping the role rule in one place stops the two walks drifting.
 */
export function transcriptRowRole(row: UnknownRecord): 'user' | 'assistant' | '' {
  const message = rowMessage(row);
  const role = asString(message?.role) || asString(row.type);
  return role === 'user' || role === 'assistant' ? role : '';
}

/** The row's own text blocks joined — the assistant's words for that message, nothing else. */
export function transcriptRowText(row: UnknownRecord): string {
  return rowContentBlocks(row)
    .filter((block) => block.type === 'text')
    .map(blockText)
    .join('\n')
    .trim();
}

/**
 * The row's stable message id: the transcript `uuid` when present, else the provider message id.
 *
 * Consumers: `session-ask-decision-digest.ts`, where `askId` is `<sessionId>:<messageId>` and the
 * event's `refs` names this id. A row with neither id cannot be deduplicated and is skipped.
 */
export function transcriptRowMessageId(row: UnknownRecord): string {
  const uuid = asString(row.uuid);
  return uuid !== '' ? uuid : asString(rowMessage(row)?.id);
}

/** The content of a tool_result block, as text (providers store it either way). */
function toolResultText(block: UnknownRecord): string {
  const content = block.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .map((part) => (part.type === 'text' ? blockText(part) : ''))
      .filter((text) => text !== '')
      .join('\n');
  }
  return '';
}

/** The first segment of a shell command — what the wall shows as "the command". */
function commandLabel(command: string): string {
  const first = command.split(/\s*(?:&&|\|\||;|\n)\s*/)[0]?.trim() ?? '';
  return (first === '' ? command.trim() : first).slice(0, 160);
}

/** Parses a vitest summary, or `null` when the output carries none. */
function parseVitestOutput(output: string): { passed: number; failed: number } | null {
  const summary = VITEST_SUMMARY.exec(output);
  if (summary === null) return null;
  const line = summary[1] ?? '';
  const failed = VITEST_FAILED.exec(line);
  const passed = VITEST_PASSED.exec(line);
  if (failed === null && passed === null) return null;
  return {
    passed: passed === null ? 0 : Number(passed[1]),
    failed: failed === null ? 0 : Number(failed[1]),
  };
}

/** Parses a node:test summary, or `null` when the output carries none. */
function parseNodeTestOutput(output: string): { passed: number; failed: number } | null {
  const passed = NODE_TEST_PASSED.exec(output);
  const failed = NODE_TEST_FAILED.exec(output);
  if (passed === null && failed === null) return null;
  return {
    passed: passed === null ? 0 : Number(passed[1]),
    failed: failed === null ? 0 : Number(failed[1]),
  };
}

/** Parses a playwright summary, or `null` when the output carries none. */
function parsePlaywrightOutput(output: string): { passed: number; failed: number } | null {
  let passed = 0;
  let failed = 0;
  let matched = false;
  for (const match of output.matchAll(PLAYWRIGHT_COUNT)) {
    matched = true;
    const count = Number(match[1]);
    if (match[2] === 'passed') passed += count;
    else failed += count;
  }
  return matched ? { passed, failed } : null;
}

/**
 * Reads passed/failed counts out of one test command's output.
 *
 * The three runners this project uses are recognized in turn; anything else is `unevaluated`
 * with the reason spelled out, never silently zero.
 */
export function parseTestOutput(output: string): SessionTestReading {
  const vitest = parseVitestOutput(output);
  if (vitest !== null) return evaluatedOrVacuous('vitest', vitest);
  const nodeTest = parseNodeTestOutput(output);
  if (nodeTest !== null) return evaluatedOrVacuous('node-test', nodeTest);
  const playwright = parsePlaywrightOutput(output);
  if (playwright !== null) return evaluatedOrVacuous('playwright', playwright);
  return { state: 'unevaluated', reason: '未识别到 vitest / node --test / playwright 的通过失败计数输出' };
}

/**
 * A `0 passed / 0 failed` summary is what a skipped or not-executed run prints. Calling that
 * green would be the "silent green" the observation layer exists to avoid, so it is reported as
 * unevaluated instead of as a healthy zero.
 */
function evaluatedOrVacuous(
  runner: SessionTestRunner,
  counts: { passed: number; failed: number },
): SessionTestReading {
  if (counts.passed === 0 && counts.failed === 0) {
    return { state: 'unevaluated', reason: `${runner} 报告 0 通过 0 失败：测试未执行或全部跳过` };
  }
  return { state: 'evaluated', runner, ...counts };
}

/**
 * Whether one PARAGRAPH asks the person something.
 *
 * Two endings count as "asking you": a question mark, and a paragraph of numbered options (the
 * CLI's own "pick one" shape). Everything else is a statement. This is the paragraph-level
 * primitive; production callers pass a whole assistant message through `analyzeAssistantAsk`,
 * which judges only its last paragraph — judging the whole message is what made a long report
 * with a numbered list anywhere in it read as a question.
 */
export function analyzeAsking(paragraph: string): SessionDigest['askingYou'] {
  const lines = nonEmptyLines(paragraph);
  if (lines.length === 0) return { isAsking: false, question: null, options: [] };
  const options = lines
    .map((line) => NUMBERED_OPTION.exec(line)?.[1]?.trim() ?? '')
    .filter((option) => option !== '');
  return askingReading(lines, options);
}

/**
 * Two endings count as "asking you": a question mark on the last line, or a paragraph that IS a
 * numbered pick-one list. Shared so both entry points report the same question/options shape.
 */
function askingReading(lines: string[], options: string[]): SessionDigest['askingYou'] {
  const lastLine = lines.at(-1) ?? '';
  const endsWithQuestion = /[?？][」』"'）)]*\s*$/.test(lastLine);
  const isAsking = endsWithQuestion || options.length >= 2;

  if (!isAsking) return { isAsking: false, question: null, options: [] };
  // Prefer the line that actually poses the question; "pick one" paragraphs often carry a
  // lead-in line above the options rather than ending on the question mark.
  const questionLine = [...lines].reverse().find((line) => /[?？]/.test(line)) ?? null;
  return {
    isAsking: true,
    question: questionLine ?? (endsWithQuestion ? lastLine : null),
    options,
  };
}

function nonEmptyLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * The numbered pick-one options a paragraph ends on, or none when it is not that shape.
 *
 * The paragraph must END on a run of two or more consecutive numbered lines whose own text is
 * short, with no Markdown heading. A long answer that merely mentions a numbered list in the
 * middle of prose is not asking; a long lead-in line above the options is fine — the CLI writes
 * exactly that ("下一步你想怎么处理？请从下面选一个：" then the options).
 */
function numberedOptionsOf(lines: string[]): string[] {
  if (lines.some((line) => MARKDOWN_HEADING.test(line))) return [];
  const parsed = lines.map((line) => NUMBERED_OPTION.exec(line)?.[1]?.trim() ?? '');
  // The options must be the paragraph's ending, not a list quoted inside a statement.
  if ((parsed.at(-1) ?? '') === '') return [];

  const options: string[] = [];
  let index = parsed.length - 1;
  for (; index >= 0; index -= 1) {
    const option = parsed[index] ?? '';
    if (option === '') break;
    options.unshift(option);
  }
  // One run only: a numbered line before the final run belongs to prose, not to the choice.
  if (parsed.slice(0, index + 1).some((option) => option !== '')) return [];

  if (options.length < 2) return [];
  // A numbered line longer than this is a paragraph that happens to start with `1.`, not an option.
  if (options.some((option) => option.length > OPTION_LINE_MAX_CHARS)) return [];
  return options;
}

/**
 * Whether one assistant message is a MECHANICAL CANDIDATE for asking the person.
 *
 * THIS IS A PREFILTER, NOT A VERDICT. Whether a message asks is semantic — the decision can sit
 * in a middle paragraph while the last one is a note (the live 62d case) — so the only place a
 * verdict is made is the T1 summary call. What this function decides is whether that call is
 * worth making at all: it matches the marker vocabulary of the repo's real asks ANYWHERE in the
 * message (question marks, 「是否/要不要」, 「请选择/请确认」, 「值得优先/下一步/建议」, and any run
 * of two or more short numbered lines). The numbered-run arm is deliberately WIDE: it also
 * matches the long review reports (5b/fea61b) that are not questions, which is fine because the
 * summary is what rejects them. A message with no marker at all is a statement and never reaches
 * the model.
 *
 * Consumers: `session-ask-decision-digest.ts` (candidate detection in `readSessionAsk` /
 * `readSessionAsks`) and `tests/session-ask-semantic-gate.test.ts`.
 */
export type AskPrefilterMarker = 'question-mark' | 'choice-phrase' | 'request-phrase' | 'priority-phrase' | 'numbered-run';

/** What the mechanical prefilter saw in one assistant message. */
export type AskPrefilterReading = {
  /** At least one marker class matched anywhere in the message. */
  candidate: boolean;
  /** The marker classes that matched, in a fixed order (for the replay table and tests). */
  markers: AskPrefilterMarker[];
};

/**
 * Wide marker vocabulary. 「建议」/「推荐」 are included on purpose: they are frequent in genuine
 * asks and the summary, not this filter, refuses a recommendation that is merely a report.
 */
const ASK_PREFILTER_PHRASES: ReadonlyArray<readonly [AskPrefilterMarker, RegExp]> = [
  ['choice-phrase', /要不要|是否|需不需要|用不用|能不能|可不可以|该不该|会不会|有没有|是不是/],
  ['request-phrase', /请选择|请确认|请你?决定|选一个|选哪个|从下面选/],
  ['priority-phrase', /值得优先|下一步|接下来(?:要|做|怎么|如何)|建议|推荐|倾向于?/],
];

/** Whether `lines` contain a run of at least two consecutive short numbered lines (anywhere). */
function hasShortNumberedRun(lines: string[]): boolean {
  let run = 0;
  for (const line of lines) {
    const option = NUMBERED_OPTION.exec(line)?.[1]?.trim() ?? '';
    if (option !== '' && option.length <= OPTION_LINE_MAX_CHARS) {
      run += 1;
      if (run >= 2) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

/**
 * The mechanical ask prefilter described above. Pure and position-free: it only asks whether any
 * marker appears, never where it appears.
 */
export function prefilterAssistantAsk(assistantText: string): AskPrefilterReading {
  const lines = nonEmptyLines(assistantText);
  const markers: AskPrefilterMarker[] = [];
  if (lines.some((line) => /[?？]/.test(line))) markers.push('question-mark');
  for (const [marker, pattern] of ASK_PREFILTER_PHRASES) {
    if (lines.some((line) => pattern.test(line))) markers.push(marker);
  }
  if (hasShortNumberedRun(lines)) markers.push('numbered-run');
  return { candidate: markers.length > 0, markers };
}

/**
 * The deterministic ask reading for a whole assistant message.
 *
 * It is NOT a position heuristic and NOT the prefilter. A question mark or an explicit ask phrase
 * ANYWHERE makes the message read as asking (the 62d regression: the decision was mid-message),
 * while a numbered list only counts when it is the LAST paragraph's own pick-one ending — a long
 * report that merely contains a numbered list stays a statement (the 5b/fea61b false-card arm).
 * The richer semantic verdict, including a model's `isAsking:false`, comes from the T1 summary;
 * this reading is what `buildSessionDigest.askingYou` can state synchronously.
 */
export function analyzeAssistantAsk(assistantText: string): SessionDigest['askingYou'] {
  const lines = nonEmptyLines(assistantText);
  if (lines.length === 0) return { isAsking: false, question: null, options: [] };
  const options = numberedOptionsOf(nonEmptyLines(lastParagraph(assistantText)));
  const questionLine = [...lines].reverse().find((line) => /[?？]/.test(line)) ?? null;
  const phraseLine = [...lines].reverse().find((line) => DETERMINISTIC_ASK_PHRASE.test(line)) ?? null;
  if (questionLine === null && phraseLine === null && options.length < 2) {
    return { isAsking: false, question: null, options: [] };
  }
  return { isAsking: true, question: questionLine ?? phraseLine ?? null, options };
}

/**
 * The ask vocabulary the deterministic reading accepts anywhere in a message. It is narrower than
 * the prefilter: 「建议/推荐」 alone is far too common in reports, so it only reaches the summary.
 */
const DETERMINISTIC_ASK_PHRASE =
  /是否|要不要|需不需要|用不用|能不能|可不可以|该不该|会不会|有没有|是不是|请选择|请确认|请你?决定|选一个|选哪个|从下面选|值得优先|下一步/;

/** The last non-empty paragraph of a text, which is the part a reader skims for the conclusion. */
export function lastParagraph(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
  return paragraphs.at(-1) ?? '';
}

/** Truncates a conclusion excerpt to the tail that carries the answer. */
function excerptConclusion(paragraph: string): SessionDigest['conclusion'] {
  const truncated = paragraph.length > SESSION_DIGEST_CONCLUSION_CHARS;
  const text = truncated ? paragraph.slice(paragraph.length - SESSION_DIGEST_CONCLUSION_CHARS).trim() : paragraph;
  return { text, truncated, tier: 'deterministic', label: '原文摘录' };
}

/**
 * Parses one transcript's non-empty lines, keeping the rows that are JSON objects.
 *
 * Consumers: `buildSessionDigest` below and `session-ask-decision-digest.ts`, so both walks see
 * exactly the same rows (a half-written trailing line is skipped in both).
 */
export function parseTranscriptRows(raw: string): UnknownRecord[] {
  const rows: UnknownRecord[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isRecord(parsed)) rows.push(parsed);
    } catch {
      // A transcript can end mid-line while a turn is being written. A line that does not
      // parse is skipped here; a file where NOTHING parses is reported as unreadable below.
    }
  }
  return rows;
}

/**
 * Builds one turn's deterministic digest from a transcript's raw JSONL text.
 *
 * `error` is the terminal run's own reading (the registry saw an `error` frame); the digest
 * cannot invent an error from text alone, and it does not try to.
 */
export function buildSessionDigest(raw: string, options: { error?: boolean } = {}): SessionDigestResult {
  const rows = parseTranscriptRows(raw);
  if (rows.length === 0) {
    return { state: 'unevaluated', reason: 'transcript 为空或没有任何可解析的行' };
  }

  const promptIndexes = rows
    .map((row, index) => (isUserPromptRow(row) ? index : -1))
    .filter((index) => index >= 0);
  if (promptIndexes.length === 0) {
    return { state: 'unevaluated', reason: 'transcript 中没有可识别的用户输入行' };
  }

  const turnRows = rows.slice((promptIndexes.at(-1) ?? 0) + 1);
  const assistantTexts: string[] = [];
  const changedFiles: string[] = [];
  const commands: string[] = [];
  const commandsById = new Map<string, string>();
  const testOutputs: Array<{ command: string; output: string }> = [];

  for (const row of turnRows) {
    const message = rowMessage(row);
    const role = asString(message?.role) || asString(row.type);
    for (const block of rowContentBlocks(row)) {
      if (block.type === 'text' && role === 'assistant') {
        const text = blockText(block).trim();
        if (text !== '') assistantTexts.push(text);
        continue;
      }
      if (block.type === 'tool_use') {
        const name = asString(block.name);
        const input = isRecord(block.input) ? block.input : {};
        const toolUseId = asString(block.id);
        if (FILE_TOOL_NAMES.has(name)) {
          const filePath = asString(input.file_path) || asString(input.notebook_path) || asString(input.path);
          if (filePath !== '' && !changedFiles.includes(filePath)) changedFiles.push(filePath);
        }
        if (name === 'Bash') {
          const command = asString(input.command);
          if (command.trim() !== '') {
            const label = asString(input.description).trim() || commandLabel(command);
            commands.push(label);
            if (toolUseId !== '') commandsById.set(toolUseId, command);
          }
        }
        continue;
      }
      if (block.type === 'tool_result') {
        const command = commandsById.get(asString(block.tool_use_id)) ?? '';
        const output = toolResultText(block);
        if (command !== '' && TEST_COMMAND.test(command)) {
          testOutputs.push({ command, output });
        }
      }
    }
  }

  if (assistantTexts.length === 0) {
    return { state: 'unevaluated', reason: '本轮没有可读的助手文本' };
  }

  const lastText = assistantTexts.at(-1) ?? '';
  const conclusionParagraph = lastParagraph(lastText);
  const askingYou = analyzeAssistantAsk(lastText);

  const lastTestOutput = testOutputs.at(-1);
  const tests: SessionTestReading =
    lastTestOutput === undefined
      ? { state: 'unevaluated', reason: '本轮未识别到测试命令' }
      : parseTestOutput(lastTestOutput.output);

  const activity: SessionActivity =
    options.error === true ? 'error' : askingYou.isAsking ? 'waiting' : 'idle';

  return {
    state: 'evaluated',
    digest: {
      activity,
      conclusion: excerptConclusion(conclusionParagraph),
      changedFiles,
      commands,
      tests,
      askingYou,
      turnCount: promptIndexes.length,
    },
  };
}
