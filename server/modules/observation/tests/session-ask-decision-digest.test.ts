/**
 * The T1 ask decision digest and its two events (AC-423).
 *
 * The fixture transcripts cover the five shapes the criterion names:
 *   · an assistant that recommends one option;
 *   · an assistant that recommends nothing (the model's recommendation is normalised away and
 *     the same call's judge supplies the default — `source: 'judge'`);
 *   · a question whose context is not in the sent turns (`incomplete`, no suggestion);
 *   · a re-ask before the user answered (same askId, revision increments);
 *   · a stored digest whose `askingYou` excerpt lags a turn (the restatement follows the LAST
 *     assistant message, not the stored excerpt);
 * plus the answer side (`session.answered` exactly once) and the malformed-answer failure mode
 * (no digest, never the last sentence passed off as the question).
 *
 * The LLM client is stubbed; the event writer is in memory.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/observation/tests/session-ask-decision-digest.test.ts
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { LlmCompletion, LlmCompletionRequest } from '@/modules/llm-gateway/index.js';
import { readOpenSessionAsks, type OpenSessionAsk } from '@/modules/context-events/index.js';
import { ApiCredential, createReplySuggestionsSettingsSource } from '@/modules/reply-suggestions/index.js';
import type { ISessionAskEventWriter } from '@/shared/interfaces.js';
import type { SessionAskDecisionReading, SessionAskEvent } from '@/shared/types.js';

import type { ObservedObject, ObservationStore } from '../observation-store.js';
import { formatSessionUri } from '../observation-uri.js';
import {
  assistantQuoteOf,
  createSessionAskDecisionDigest,
  readSessionAsk,
  readSessionAsks,
  SESSION_ASK_OUTPUT_UNUSABLE_REASON,
  SESSION_ASK_DECISION_HISTORY_LIMIT,
  stableOptionId,
  type SessionAskDecisionDigest,
} from '../session-ask-decision-digest.js';
import {
  createSessionAskDecisionReader,
  SESSION_ASK_DECISION_ASK_MISSING_REASON,
  SESSION_ASK_DECISION_ASK_RETRY_LIMIT,
  SESSION_ASK_DECISION_LIMIT_REASON,
  SESSION_ASK_DECISION_NOT_GENERATED_REASON,
  SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON,
} from '../session-ask-decision-reader.js';
import {
  buildSessionAskingData,
  createSessionDigestProducer,
  readSessionAskEventLedger,
} from '../session-digest.producer.js';
import { createSessionDigestLlmSettingsSource, type SessionDigestLlmSettings } from '../session-digest-llm-settings.js';
import { analyzeAssistantAsk, buildSessionDigest, prefilterAssistantAsk } from '../session-digest.js';

const CLOCK = 1_800_000_000_000;
const SESSION_ID = 'ask-session';
const PROJECT_PATH = '/repo/project';

/** One reading of the tier settings that is switched on but talks to no real gateway. */
const STUB_SETTINGS: SessionDigestLlmSettings = {
  enabled: true,
  configuredEnabled: true,
  model: 'stub-model',
  maxPerHour: 6,
  minTurnChars: 0,
  apiKeyFile: '',
  protocol: 'anthropic',
  baseUrl: 'http://stub.invalid',
  authScheme: 'bearer',
  disableThinking: true,
  timeoutMs: 1_000,
  maxOutputTokens: 800,
  temperature: 0.2,
  apiKey: 'stub-key',
  source: 'file',
  path: null,
  problems: [],
};

type Turn = { role: 'user' | 'assistant'; id: string; text: string };

/** Renders rows as the JSONL shape the observation layer reads. */
function transcript(turns: Turn[]): string {
  return `${turns
    .map((turn) =>
      JSON.stringify({
        type: turn.role,
        uuid: turn.id,
        message: { role: turn.role, content: [{ type: 'text', text: turn.text }] },
      }),
    )
    .join('\n')}\n`;
}

/** The model answer for the "assistant recommends B" fixture. */
const RECOMMENDED_ANSWER = {
  ask: '先补测试还是先改实现，你想先做哪一个？',
  situation: '正在二选一：先补测试还是先改实现。',
  incomplete: false,
  recommendedOptionId: 'b',
  options: [
    { id: 'a', label: '先补测试', does: '先锁住行为，再改实现', tags: [{ kind: 'risk', text: '改动晚一步' }], source: 'assistant' },
    { id: 'b', label: '先改实现', does: '先改实现，再补测试', tags: [{ kind: 'consequence', text: '更快看到修复' }], source: 'assistant' },
  ],
};

/** A provider-shaped completion around one answer text. */
function completion(text: string): LlmCompletion {
  return { text, inputTokens: 100, outputTokens: 20 };
}

type Harness = {
  producer: ReturnType<typeof createSessionDigestProducer>;
  setTranscript: (raw: string) => void;
  writes: ObservedObject[];
  events: SessionAskEvent[];
  requests: LlmCompletionRequest[];
  turnEnd: () => Promise<ObservedObject | null>;
  userTurn: (messageId?: string) => Promise<void>;
  sweep: () => ReturnType<ReturnType<typeof createSessionDigestProducer>['sweepOpenAsks']>;
};

/**
 * Builds a producer whose world is entirely in memory.
 *
 * `objects` is injectable so a criterion can build a SECOND producer over the FIRST one's store —
 * that is how a process restart is simulated: the in-memory emitted set is gone, but the ledger
 * persisted in the digest survives.
 */
function createHarness(
  answer: string | ((request: LlmCompletionRequest) => string),
  options: {
    objects?: Map<string, ObservedObject>;
    listObservedSessionIds?: () => string[];
    log?: (message: string) => void;
    sweepDelayMs?: number;
    /** Replaces the real (stubbed-gateway) summariser; a throwing one is a failed summary. */
    summarizeAsk?: SessionAskDecisionDigest;
    /** Replaces the stream seam; absent means no rebuild (the sweep reads no host file). */
    readOpenSessionAsks?: () => Promise<readonly OpenSessionAsk[]>;
  } = {},
): Harness {
  let raw = '';
  const writes: ObservedObject[] = [];
  const events: SessionAskEvent[] = [];
  const requests: LlmCompletionRequest[] = [];
  const objects = options.objects ?? new Map<string, ObservedObject>();

  const store = {
    writeRevision(input: Parameters<ObservationStore['writeRevision']>[0]): ObservedObject {
      const object: ObservedObject = {
        uri: input.uri,
        kind: input.kind,
        title: input.title,
        status: input.status,
        digest: input.digest ?? {},
        blindSpots: [],
        revision: (objects.get(input.uri)?.revision ?? 0) + 1,
        updatedAt: CLOCK,
        provenance: {
          producer: input.provenance.producer,
          tier: input.provenance.tier,
          evaluatedAt: input.provenance.evaluatedAt ?? CLOCK,
        },
      };
      objects.set(input.uri, object);
      writes.push(object);
      return object;
    },
    getObject: (uri: string) => objects.get(uri) ?? null,
  } as unknown as ObservationStore;

  const eventWriter: ISessionAskEventWriter = {
    write(event) {
      events.push(event);
    },
  };

  const summarizeAsk = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async (request) => {
      requests.push(request);
      return completion(typeof answer === 'function' ? answer(request) : answer);
    },
  });

  const producer = createSessionDigestProducer({
    store,
    resolveSession: () => ({ title: '会话：选中方案', projectPath: PROJECT_PATH, jsonlPath: '/tmp/ask.jsonl' }),
    readTranscript: async () => raw,
    isObserved: () => true,
    now: () => CLOCK,
    summarizeAsk: options.summarizeAsk ?? summarizeAsk,
    eventWriter,
    ...(options.listObservedSessionIds === undefined
      ? {}
      : { listObservedSessionIds: options.listObservedSessionIds }),
    ...(options.readOpenSessionAsks === undefined
      ? {}
      : { readOpenSessionAsks: options.readOpenSessionAsks }),
    ...(options.log === undefined ? {} : { log: options.log }),
    ...(options.sweepDelayMs === undefined ? {} : { sweepDelayMs: options.sweepDelayMs }),
  });

  return {
    producer,
    setTranscript: (next) => {
      raw = next;
    },
    writes,
    events,
    requests,
    turnEnd: () =>
      producer.handleTurnEnd({
        appSessionId: SESSION_ID,
        runId: `run-${writes.length}`,
        status: 'completed',
        completedAt: CLOCK,
        error: null,
      }),
    userTurn: (messageId) =>
      producer.handleUserTurn({
        appSessionId: SESSION_ID,
        ...(messageId === undefined ? {} : { messageId }),
      }),
    sweep: () => producer.sweepOpenAsks(),
  };
}

function askEvents(events: SessionAskEvent[]): SessionAskEvent[] {
  return events.filter((event) => event.kind === 'session.asking');
}

// ---------------------------------------------------------------------------------------------
// The digest rules
// ---------------------------------------------------------------------------------------------

test('AC-423: a recommended option is the only suggested one, sourced from the assistant', async () => {
  const raw = transcript([
    { role: 'user', id: 'u1', text: '你选一个方案' },
    { role: 'assistant', id: 'a1', text: '有两个方案：\n1. 方案 A：先补测试\n2. 方案 B：先改实现\n\n我建议选方案 B，因为它能先锁住行为。你想选哪个？' },
  ]);
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER));
  harness.setTranscript(raw);

  const written = await harness.turnEnd();
  const reading = written?.digest.askDecision as SessionAskDecisionReading | undefined;

  assert.ok(reading, 'the digest must carry the ask decision');
  assert.equal(reading.state, 'evaluated');
  if (reading.state !== 'evaluated') return;
  assert.equal(reading.askId, `${SESSION_ID}:a1`);
  assert.equal(reading.revision, 1);
  assert.equal(reading.incomplete, false);
  assert.equal(reading.ask, RECOMMENDED_ANSWER.ask);
  assert.notEqual(reading.ask, '我建议选方案 B，因为它能先锁住行为。', 'the question is restated, not copied');
  assert.equal(reading.inputTokens, 100);
  assert.equal(reading.outputTokens, 20);

  const suggested = reading.options.filter((option) => option.suggested);
  assert.equal(suggested.length, 1);
  // The written id is derived from the LABEL, never the model's own `a`/`b`.
  assert.equal(suggested[0]?.id, stableOptionId('先改实现'));
  assert.equal(suggested[0]?.source, 'assistant');
  assert.equal(reading.options.find((option) => option.id === stableOptionId('先补测试'))?.suggested, false);
  assert.deepEqual(suggested[0]?.tags, [{ kind: 'consequence', text: '更快看到修复' }]);
});

test('AC-423: when the original text recommends nothing the judge supplies the suggestion', async () => {
  const raw = transcript([
    { role: 'user', id: 'u1', text: '给我两个选择' },
    { role: 'assistant', id: 'a1', text: '你可以选：\n1. 方案 A\n2. 方案 B' },
  ]);
  // The model TRIES to recommend A; the original text does not, so the assistant recommendation
  // rule must clear it — and the SAME answer's judge supplies the default instead.
  const answer = {
    ask: '方案 A 和方案 B，你想选哪一个？',
    situation: '两个方案二选一。',
    incomplete: false,
    recommendedOptionId: 'a',
    judgeOptionId: 'b',
    judgeReason: '方案 B 与对话里刚验证过的做法一致。',
    options: [
      { id: 'a', label: '方案 A', does: '走方案 A', tags: [], source: 'assistant' },
      { id: 'b', label: '方案 B', does: '走方案 B', tags: [], source: 'assistant' },
    ],
  };
  const summariser = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async () => completion(JSON.stringify(answer)),
  });

  const reading = await summariser.summarize({
    sessionId: SESSION_ID,
    sessionTitle: '会话',
    askId: `${SESSION_ID}:a1`,
    revision: 1,
    assistantText: '你可以选：\n1. 方案 A\n2. 方案 B',
    context: raw,
  });

  assert.equal(reading.state, 'evaluated');
  if (reading.state !== 'evaluated') return;
  const suggested = reading.options.filter((option) => option.suggested);
  assert.equal(suggested.length, 1, 'the judge fills exactly one default');
  assert.equal(
    suggested[0]?.id,
    stableOptionId('方案 B'),
    'the assistant cue was absent, so the judge pick is the default',
  );
  assert.equal(suggested[0]?.source, 'judge', 'the judge never labels its pick as the assistant’s');
  assert.equal(suggested[0]?.why, answer.judgeReason);
});

test('AC-423: a question missing its context is incomplete and suggests nothing', async () => {
  const summariser = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async () =>
      completion(
        JSON.stringify({
          ask: '刚才那份 diff 要不要合并？',
          situation: '对话里只有“继续”，没有 diff 内容。',
          incomplete: true,
          recommendedOptionId: 'merge',
          options: [
            { id: 'merge', label: '合并', does: '把 diff 合入', tags: [], source: 'assistant' },
            { id: 'wait', label: '先不合并', does: '保持现状', tags: [], source: 'assistant' },
          ],
        }),
      ),
  });

  const reading = await summariser.summarize({
    sessionId: SESSION_ID,
    sessionTitle: '会话',
    askId: `${SESSION_ID}:a1`,
    revision: 1,
    assistantText: '上面那个 diff 你觉得要合并吗？',
    context: '[用户] 继续\n\n[助手] 上面那个 diff 你觉得要合并吗？',
  });

  assert.equal(reading.state, 'evaluated');
  if (reading.state !== 'evaluated') return;
  assert.equal(reading.incomplete, true);
  assert.equal(
    reading.options.some((option) => option.suggested),
    false,
    'an incomplete digest never claims a recommendation',
  );
});

test('AC-423: malformed model output yields no digest and never echoes the last sentence', async () => {
  const lastSentence = '所以我建议选方案 B。';
  const summariser = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async () => completion('这不是 JSON，只是一句话。'),
  });

  const reading = await summariser.summarize({
    sessionId: SESSION_ID,
    sessionTitle: '会话',
    askId: `${SESSION_ID}:a1`,
    revision: 1,
    assistantText: `要不要按方案 B 做？\n\n${lastSentence}`,
    context: `[助手] 要不要按方案 B 做？\n\n${lastSentence}`,
  });

  assert.equal(reading.state, 'unevaluated');
  assert.equal('ask' in reading, false, 'a failed parse carries no question restatement');
  assert.equal(JSON.stringify(reading).includes(lastSentence), false, 'the last sentence is not a fallback');
});

test('AC-423: the question comes from the last assistant message, not the stored askingYou', async () => {
  const harness = createHarness(JSON.stringify({ ...RECOMMENDED_ANSWER, ask: '第二个问题：先改实现可以吗？' }));
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始吧' },
      { role: 'assistant', id: 'a1', text: '第一个问题：要不要先补测试？' },
    ]),
  );

  const first = await harness.turnEnd();
  const firstAsking = ((first?.digest ?? {}).askingYou as { question: string | null }).question;
  assert.equal(firstAsking, '第一个问题：要不要先补测试？');

  // No user message in between: the assistant asks again in a later message. The stored digest's
  // askingYou still names the FIRST question; the restatement must follow the last message.
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始吧' },
      { role: 'assistant', id: 'a1', text: '第一个问题：要不要先补测试？' },
      { role: 'assistant', id: 'a2', text: '第二个问题：先改实现可以吗？' },
    ]),
  );
  const second = await harness.turnEnd();
  const reading = second?.digest.askDecision as SessionAskDecisionReading | undefined;
  assert.equal(reading?.state, 'evaluated');
  if (reading?.state !== 'evaluated') return;

  assert.equal(reading.ask, '第二个问题：先改实现可以吗？');
  assert.notEqual(reading.ask, firstAsking);
  assert.equal(reading.askId, `${SESSION_ID}:a1`, 'the dedup key names the FIRST asking message');
  assert.equal(reading.revision, 2);

  const prompt = harness.requests.at(-1)?.user ?? '';
  assert.match(prompt, /最后一条助手消息（提问所在，问题重述只能来自这里）：\n"""\n第二个问题：先改实现可以吗？/);
});

test('AC-423: re-asking before the answer keeps askId and increments revision', async () => {
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER));
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始吧' },
      { role: 'assistant', id: 'a1', text: '要我先跑测试吗？' },
    ]),
  );
  await harness.turnEnd();

  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始吧' },
      { role: 'assistant', id: 'a1', text: '要我先跑测试吗？' },
      { role: 'assistant', id: 'a2', text: '还是先改 lint 更合适？' },
    ]),
  );
  await harness.turnEnd();

  const asks = askEvents(harness.events);
  assert.equal(asks.length, 2, 'the re-ask states one more asking event');
  const [first, second] = asks;
  assert.equal(first?.data.askId, `${SESSION_ID}:a1`);
  assert.equal(first?.data.revision, 1);
  assert.deepEqual(first?.refs, ['a1']);
  assert.equal(second?.data.askId, `${SESSION_ID}:a1`, 'the same askId is reused');
  assert.equal(second?.data.revision, 2);
  assert.deepEqual(second?.refs, ['a2'], 'the event names the new asking message');
  assert.deepEqual(second?.data.contentRef, {
    resolver: 'cloudcli.session-ask',
    sessionId: SESSION_ID,
    messageId: 'a2',
  });
});

// ---------------------------------------------------------------------------------------------
// The events
// ---------------------------------------------------------------------------------------------

test('AC-423: one asking event per asking turn, and one answered event after the user speaks', async () => {
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER));
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '你选一个方案' },
      { role: 'assistant', id: 'a1', text: '有两个方案：\n1. 方案 A\n2. 方案 B\n\n我建议选方案 B。你想选哪个？' },
    ]),
  );
  await harness.turnEnd();
  await harness.turnEnd(); // a repeated turn-end must not re-state the same ask

  assert.equal(askEvents(harness.events).length, 1);
  const asking = askEvents(harness.events)[0];
  assert.equal(asking?.kind, 'session.asking');
  assert.equal(asking?.session, SESSION_ID);
  assert.equal(asking?.project, PROJECT_PATH);
  assert.equal(asking?.at, new Date(CLOCK).toISOString());
  assert.deepEqual(asking?.data, {
    askId: `${SESSION_ID}:a1`,
    messageId: 'a1',
    revision: 1,
    questionText: '有两个方案：\n1. 方案 A\n2. 方案 B\n\n我建议选方案 B。你想选哪个？',
    contentRef: { resolver: 'cloudcli.session-ask', sessionId: SESSION_ID, messageId: 'a1' },
  });

  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '你选一个方案' },
      { role: 'assistant', id: 'a1', text: '有两个方案：\n1. 方案 A\n2. 方案 B\n\n我建议选方案 B。你想选哪个？' },
      { role: 'user', id: 'u2', text: '就按方案 B' },
      { role: 'assistant', id: 'a2', text: '好，我按方案 B 开始。' },
    ]),
  );
  await harness.turnEnd();
  await harness.turnEnd();

  const answered = harness.events.filter((event) => event.kind === 'session.answered');
  assert.equal(answered.length, 1, 'the answer is stated exactly once');
  assert.deepEqual(answered[0]?.data, { askId: `${SESSION_ID}:a1`, messageId: 'u2' });
  assert.equal(answered[0]?.session, SESSION_ID);
  assert.equal(answered[0]?.project, PROJECT_PATH);
  assert.equal(askEvents(harness.events).length, 1, 'the answering turn ends on a statement');
});

// ---------------------------------------------------------------------------------------------
// `questionText`: fleet's 「session + normalised question text」 dedup key needs the words
// ---------------------------------------------------------------------------------------------

test('the asking event states the question message verbatim as questionText', async () => {
  const asked = '先补测试还是先改实现？我先说取舍。\n\n我建议先补测试，能先锁住行为。\n\n要按这个顺序开始吗？';
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER));
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始吧' },
      { role: 'assistant', id: 'a1', text: asked },
    ]),
  );

  await harness.turnEnd();
  const asking = askEvents(harness.events)[0];
  assert.ok(asking, 'the asking turn states one event');

  // The AC compares after trimming; the field itself is the row's own text (already trimmed by
  // the transcript reader), never an excerpt or a restatement.
  assert.equal(typeof asking.data.questionText, 'string');
  assert.equal((asking.data.questionText as string).trim(), asked.trim());
  assert.equal(asking.data.questionText, asked, 'questionText is the message text verbatim');
  assert.equal(asking.data.askId, `${SESSION_ID}:a1`, 'the pre-existing askId is unchanged');
  assert.equal(asking.data.messageId, 'a1');
  assert.equal(asking.data.revision, 1);
});

test('questionText is the UNTRUNCATED full message, even at 200000 characters', async () => {
  // The head and tail are distinct sentinels, so ANY truncation — head-keeping or tail-keeping —
  // makes this criterion red while a full pass-through keeps both ends. The message must still END
  // on a question mark, or `analyzeAsking` never yields the asking turn in the first place.
  const HEAD = '从'.repeat(100);
  const TAIL = `${'问'.repeat(99)}？`;
  const text = `${HEAD}${'中'.repeat(200_000 - 200)}${TAIL}`;
  assert.equal(text.length, 200_000);

  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER));
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始吧' },
      { role: 'assistant', id: 'a1', text },
    ]),
  );

  await harness.turnEnd();
  const questionText = askEvents(harness.events)[0]?.data.questionText;

  assert.equal(typeof questionText, 'string');
  assert.equal((questionText as string).length, text.length, 'questionText.length equals the original message length');
  assert.equal((questionText as string).slice(0, 100), HEAD, 'the first 100 characters match the original');
  assert.equal((questionText as string).slice(-100), TAIL, 'the last 100 characters match the original');
  assert.equal(questionText, text, 'questionText is the whole message, not an excerpt');
});

test('a replay of the same askId + revision states the same questionText', async () => {
  // Two producers over the same transcript is the replay a restart performs: the in-memory
  // emitted set is gone, so the same ask is stated again — and fleet's text key must land on the
  // same hash both times, which requires the string to be byte-identical.
  const asked = '要我现在跑测试，还是先补用例？\n\n我先说结论：先跑测试。\n\n这样可以吗？';
  const raw = transcript([
    { role: 'user', id: 'u1', text: '开始吧' },
    { role: 'assistant', id: 'a1', text: asked },
  ]);

  const first = createHarness(JSON.stringify(RECOMMENDED_ANSWER));
  first.setTranscript(raw);
  await first.turnEnd();

  const replay = createHarness(JSON.stringify(RECOMMENDED_ANSWER));
  replay.setTranscript(raw);
  await replay.turnEnd();

  const firstEvent = askEvents(first.events)[0];
  const replayEvent = askEvents(replay.events)[0];
  assert.equal(firstEvent?.data.askId, replayEvent?.data.askId);
  assert.equal(firstEvent?.data.revision, replayEvent?.data.revision);
  assert.equal(firstEvent?.data.questionText, replayEvent?.data.questionText, 'the replayed string is identical');
});

test('a blank question message omits questionText from the payload', () => {
  // The transcript scan never yields an asking turn with blank text (`analyzeAsking` rejects it),
  // so the omission rule is pinned at the payload builder the producer writes through: a blank
  // text must produce NO key, never `questionText: ''` (whose hash would merge every blank ask).
  const data = buildSessionAskingData(SESSION_ID, {
    askId: `${SESSION_ID}:a1`,
    messageId: 'a1',
    revision: 1,
    assistantText: '  \n\t ',
  });

  assert.equal('questionText' in data, false, 'blank text contributes no questionText key');
  assert.deepEqual(data, {
    askId: `${SESSION_ID}:a1`,
    messageId: 'a1',
    revision: 1,
    contentRef: { resolver: 'cloudcli.session-ask', sessionId: SESSION_ID, messageId: 'a1' },
  });
});

test('AC-423: readSessionAsk derives the ask identity and the answered span from the transcript', () => {
  const reading = readSessionAsk(
    transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: '第一问？' },
      { role: 'user', id: 'u2', text: '回答' },
      { role: 'assistant', id: 'a2', text: '第二问？' },
    ]),
    SESSION_ID,
  );

  assert.equal(reading.current?.askId, `${SESSION_ID}:a2`);
  assert.equal(reading.current?.messageId, 'a2');
  assert.equal(reading.current?.revision, 1);
  assert.equal(reading.answered?.askId, `${SESSION_ID}:a1`);
  assert.equal(reading.answered?.messageId, 'u2');
  assert.match(reading.context, /\[用户\] 开始/);
  assert.match(reading.context, /第二问？/);
});

/**
 * The event path's `current` is now a mechanical CANDIDATE (the summary is the verdict), while
 * `buildSessionDigest.askingYou` is the deterministic reading. For a long report containing a
 * numbered list the two intentionally differ: the candidate reaches the summary, which rejects
 * it. Both layers are asserted separately so neither can drift unnoticed.
 */
test('AC: the prefilter yields candidates, and readSessionAsk/digest share the deterministic reading', () => {
  /** `count` consecutive short numbered lines — the shape that used to read as "pick one". */
  const numbered = (count: number): string =>
    Array.from({ length: count }, (_, index) => `${index + 1}. 第${index + 1}项检查已完成`).join('\n');
  const longAnswer = (count: number): string =>
    ['我复核了整条链路，下面是发现：', numbered(count), '要的话我可以把 P0 的三条拆成 quay 任务，之后再一起看。'].join(
      '\n\n',
    );

  const cases: Array<{ name: string; text: string; candidate: boolean; asking: boolean }> = [
    { name: '3 行编号的长回答', text: longAnswer(3), candidate: true, asking: false },
    { name: '4 行编号的长回答', text: longAnswer(4), candidate: true, asking: false },
    { name: '14 行编号的长回答', text: longAnswer(14), candidate: true, asking: false },
    {
      name: '问号在中间段落、末段是陈述',
      text: '这里要先确认一件事？\n\n最后的结论是改动已完成。',
      candidate: true,
      asking: true,
    },
    { name: '最后一行是问号', text: '前面做了很多。\n\n要不要现在改？', candidate: true, asking: true },
    {
      name: '最后一段是两条短选项',
      text: '前面做了很多。\n\n你可以选一个：\n1. 继续改登录页\n2. 先补测试',
      candidate: true,
      asking: true,
    },
    { name: '无任何标记的纯陈述', text: '改动已经完成，测试全绿。', candidate: false, asking: false },
  ];

  for (const item of cases) {
    const raw = transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: item.text },
    ]);
    const reading = readSessionAsk(raw, SESSION_ID);
    const result = buildSessionDigest(raw);
    assert.equal(result.state, 'evaluated', `${item.name}: digest 可读`);
    if (result.state !== 'evaluated') return;

    assert.equal(prefilterAssistantAsk(item.text).candidate, item.candidate, `${item.name}: 机械预筛`);
    assert.equal(analyzeAssistantAsk(item.text).isAsking, item.asking, `${item.name}: 共享判定函数`);
    assert.equal(reading.current !== null, item.candidate, `${item.name}: readSessionAsk.current 是候选`);
    assert.equal(result.digest.askingYou.isAsking, item.asking, `${item.name}: buildSessionDigest.askingYou`);
  }
});

// ---------------------------------------------------------------------------------------------
// The read-time repair of a digest stored while the tier was switched off
// ---------------------------------------------------------------------------------------------

/** The exact reason the summariser stores when `observation.sessionDigest` is off. */
const DISABLED_SKIP_REASON = '未启用 observation.sessionDigest（提问决策摘要）';

/** A memory-backed store: only the two members the reader touches are needed. */
function createMemoryStore(): { store: ObservationStore; objects: Map<string, ObservedObject> } {
  const objects = new Map<string, ObservedObject>();
  const store = {
    writeRevision(input: Parameters<ObservationStore['writeRevision']>[0]): ObservedObject {
      const object: ObservedObject = {
        uri: input.uri,
        kind: input.kind,
        title: input.title,
        status: input.status,
        digest: input.digest ?? {},
        blindSpots: [],
        revision: (objects.get(input.uri)?.revision ?? 0) + 1,
        updatedAt: CLOCK,
        provenance: {
          producer: input.provenance.producer,
          tier: input.provenance.tier,
          evaluatedAt: input.provenance.evaluatedAt ?? CLOCK,
        },
      };
      objects.set(input.uri, object);
      return object;
    },
    getObject: (uri: string) => objects.get(uri) ?? null,
  } as unknown as ObservationStore;
  return { store, objects };
}

/** The turn the stale digest belongs to: one ask, no answer yet. */
const YES_NO_TRANSCRIPT = transcript([
  { role: 'user', id: 'u1', text: '释放浏览器 profile' },
  {
    role: 'assistant',
    id: 'a1',
    text: '是否要经 SendMessage 向会话发送 browser_close 以释放 MCP 浏览器 profile？',
  },
]);

/** The model's restatement of that ask: two options, no recommendation in the original. */
const YES_NO_ANSWER = {
  ask: '是否要发送 browser_close 释放浏览器 profile？',
  situation: 'MCP 浏览器 profile 仍被占用。',
  incomplete: false,
  recommendedOptionId: null,
  options: [
    { id: 'yes', label: '是', does: '发送 browser_close 释放 profile。', tags: [{ kind: 'consequence', text: '释放资源' }], source: 'assistant' },
    { id: 'no', label: '否', does: '保持 profile 占用。', tags: [{ kind: 'consequence', text: '保持现状' }], source: 'assistant' },
  ],
};

function seedSkipped(store: ObservationStore): void {
  store.writeRevision({
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：浏览器 profile',
    status: { state: 'attention', reason: '本轮以提问结束，等你回复' },
    digest: { activity: 'waiting', askDecision: { state: 'skipped', reason: DISABLED_SKIP_REASON } },
    provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
  });
}

/** A reader over a memory store and a stub completion; `requests` records every model call. */
function readerOver(
  store: ObservationStore,
  options: {
    settings?: SessionDigestLlmSettings;
    answer?: string;
    requests?: LlmCompletionRequest[];
    resolveSession?: (sessionId: string) => {
      title: string;
      jsonlPath: string | null;
      providerSessionId?: string | null;
    } | null;
    readTranscript?: (jsonlPath: string) => Promise<string | null>;
    /** Finds a transcript by provider id (or the card's own id) across the projects dirs. */
    findTranscript?: (providerSessionId: string) => Promise<string | null>;
    claudeProjectsRoot?: string;
    /** The reader's clock; the temporal-retry criterion advances it between reads. */
    now?: () => number;
  } = {},
): ReturnType<typeof createSessionAskDecisionReader> {
  const settings = options.settings ?? STUB_SETTINGS;
  const requests = options.requests ?? [];
  return createSessionAskDecisionReader({
    store,
    readSettings: () => settings,
    summarize: createSessionAskDecisionDigest({
      readSettings: () => settings,
      complete: async (request) => {
        requests.push(request);
        return completion(options.answer ?? JSON.stringify(YES_NO_ANSWER));
      },
    }),
    resolveSession:
      options.resolveSession ??
      (() => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/ask.jsonl' })),
    readTranscript: options.readTranscript ?? (async () => YES_NO_TRANSCRIPT),
    ...(options.findTranscript === undefined ? {} : { findTranscript: options.findTranscript }),
    ...(options.claudeProjectsRoot === undefined
      ? {}
      : { claudeProjectsRoot: options.claudeProjectsRoot }),
    now: options.now ?? (() => CLOCK),
  });
}

/** The digest the reader wrote back, or `undefined` when nothing was written. */
function storedAskDecision(
  objects: Map<string, ObservedObject>,
): SessionAskDecisionReading | undefined {
  return objects.get(formatSessionUri(SESSION_ID))?.digest.askDecision as
    | SessionAskDecisionReading
    | undefined;
}

test('read-time repair: a disabled-tier reading is recomputed once after the switch is enabled', async () => {
  const { store, objects } = createMemoryStore();
  seedSkipped(store);
  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, { requests });

  // The first read still answers the stored reading; the repair runs in the background.
  assert.equal(reader.read(SESSION_ID)?.state, 'skipped');
  await reader.settled();

  const repaired = reader.read(SESSION_ID);
  assert.equal(repaired?.state, 'evaluated');
  assert.equal(requests.length, 1, 'the repair makes exactly one model call');
  const stored = objects.get(formatSessionUri(SESSION_ID))?.digest.askDecision as SessionAskDecisionReading;
  assert.equal(stored.state, 'evaluated', 'the repaired reading is written back to the digest');
  assert.equal(reader.read(SESSION_ID)?.state, 'evaluated');
  await reader.settled();
  assert.equal(requests.length, 1, 'the same askId is never repaired twice');
});

test('read-time repair: with the setting still off no summariser call is made and nothing is written', async () => {
  const { store, objects } = createMemoryStore();
  seedSkipped(store);
  // A raw summariser that ALWAYS answers, so the reader's own enabled check is what must stop
  // the repair. Wrapping the real summariser here would let ITS enabled check hide a missing
  // guard in the reader (both would answer `skipped`, so the test could not tell them apart).
  const attempts: Parameters<SessionAskDecisionDigest['summarize']>[0][] = [];
  const reader = createSessionAskDecisionReader({
    store,
    readSettings: () => ({ ...STUB_SETTINGS, enabled: false, configuredEnabled: false }),
    summarize: {
      async summarize(input) {
        attempts.push(input);
        return {
          state: 'evaluated',
          inputTokens: 1,
          outputTokens: 1,
          askId: input.askId,
          revision: input.revision,
          ask: '不该生成的问题',
          situation: '不该生成的情境',
          options: [],
          incomplete: false,
        };
      },
    },
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/ask.jsonl' }),
    readTranscript: async () => YES_NO_TRANSCRIPT,
    now: () => CLOCK,
  });

  assert.equal(reader.read(SESSION_ID)?.state, 'skipped');
  await reader.settled();
  assert.equal(attempts.length, 0, 'the disabled tier must not start a repair');
  const stored = objects.get(formatSessionUri(SESSION_ID))?.digest.askDecision as SessionAskDecisionReading;
  assert.equal(stored.state, 'skipped', 'nothing is written while the tier is off');
  assert.equal(stored.state === 'skipped' ? stored.reason : '', DISABLED_SKIP_REASON);
});

test('read-time repair: an exhausted hourly ceiling keeps the stored reading and names the limit', async () => {
  const { store, objects } = createMemoryStore();
  seedSkipped(store);
  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, {
    settings: { ...STUB_SETTINGS, maxPerHour: 0 },
    requests,
  });

  const reading = reader.read(SESSION_ID);
  assert.equal(reading?.state, 'skipped');
  assert.equal(reading?.state === 'skipped' ? reading.reason : '', SESSION_ASK_DECISION_LIMIT_REASON);
  await reader.settled();
  assert.equal(requests.length, 0, 'the ceiling refuses the call before the model is reached');
  const stored = objects.get(formatSessionUri(SESSION_ID))?.digest.askDecision as SessionAskDecisionReading;
  assert.equal(stored.state, 'skipped');
  assert.equal(stored.state === 'skipped' ? stored.reason : '', DISABLED_SKIP_REASON, 'the stored reading is untouched');
});

test('read-time repair: a failed recompute is remembered, not retried on every read', async () => {
  const { store } = createMemoryStore();
  seedSkipped(store);
  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, { requests, answer: '这不是 JSON。' });

  assert.equal(reader.read(SESSION_ID)?.state, 'skipped');
  await reader.settled();
  assert.equal(requests.length, 1);
  const failed = reader.read(SESSION_ID);
  assert.equal(failed?.state, 'unevaluated', 'the failure is written back as the honest reading');
  await reader.settled();
  assert.equal(requests.length, 1, 'a recorded failure must not be retried for the same ask');
});

test('read-time repair: a stored 「模型输出不可用」 failure is recomputed once', async () => {
  const { store, objects } = createMemoryStore();
  store.writeRevision({
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：浏览器 profile',
    status: { state: 'attention', reason: '本轮以提问结束，等你回复' },
    digest: {
      activity: 'waiting',
      askDecision: {
        state: 'unevaluated',
        reason: `${SESSION_ASK_OUTPUT_UNUSABLE_REASON}：模型输出不是合法 JSON`,
      },
    },
    provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
  });
  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, { requests });

  // The first frame still answers the stored failure; the repair runs in the background.
  const first = reader.read(SESSION_ID, 'a1');
  assert.equal(first?.state, 'unevaluated');
  await reader.settled();

  const repaired = storedAskDecision(objects);
  assert.equal(repaired?.state, 'evaluated', 'the old model-output failure is recomputed');
  assert.equal(requests.length, 1, 'the repair makes exactly one model call');
  assert.equal(
    repaired?.state === 'evaluated' ? typeof repaired.quote : 'missing',
    'string',
    'the recomputed reading carries the assistant quote',
  );

  // The stored evaluated reading no longer matches the stale predicate: a second read is free.
  assert.equal(reader.read(SESSION_ID, 'a1')?.state, 'evaluated');
  await reader.settled();
  assert.equal(requests.length, 1, 'a second read does not call the model again');
});

test('read-time repair: a stored 「转写里找不到这次提问」 failure heals once the transcript carries the ask', async () => {
  const { store, objects } = createMemoryStore();
  // THE LIVE SHAPE (session 8d8a6d0d, message 710beefe): the old reader compared the stored
  // digest's ask with the card's and, on a transient miss, wrote this permanent sentence.
  store.writeRevision({
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：浏览器 profile',
    status: { state: 'attention' },
    digest: {
      activity: 'waiting',
      askDecision: { state: 'unevaluated', reason: SESSION_ASK_DECISION_ASK_MISSING_REASON },
    },
    provenance: { producer: 'session-ask-decision-reader', tier: 'deterministic', evaluatedAt: CLOCK },
  });
  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, { requests });

  // The first frame still answers the stored failure; the repair runs in the background.
  assert.equal(reader.read(SESSION_ID, 'a1')?.state, 'unevaluated');
  await reader.settled();

  assert.equal(requests.length, 1, 'the stored wrong verdict is recomputed, not remembered');
  const repaired = storedAskDecision(objects);
  assert.equal(repaired?.state, 'evaluated');
  assert.equal(repaired?.state === 'evaluated' ? repaired.askId : '', `${SESSION_ID}:a1`);

  assert.equal(reader.read(SESSION_ID, 'a1')?.state, 'evaluated');
  await reader.settled();
  assert.equal(requests.length, 1, 'a second read does not call the model again');
});

test('read-time repair: an evaluated reading without the assistant quote is recomputed once', async () => {
  const { store, objects } = createMemoryStore();
  store.writeRevision({
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：浏览器 profile',
    status: { state: 'attention' },
    digest: {
      activity: 'waiting',
      askDecision: {
        state: 'evaluated',
        inputTokens: 1,
        outputTokens: 1,
        askId: `${SESSION_ID}:a1`,
        revision: 1,
        ask: '是否要发送 browser_close 释放浏览器 profile？',
        situation: 'MCP 浏览器 profile 仍被占用。',
        options: [
          {
            id: 'yes',
            label: '是',
            does: '发送 browser_close 释放 profile。',
            tags: [],
            suggested: true,
            source: 'assistant',
          },
          { id: 'no', label: '否', does: '保持 profile 占用。', tags: [], suggested: false, source: 'assistant' },
        ],
        incomplete: false,
      },
    },
    provenance: { producer: 'session-digest', tier: 'llm', evaluatedAt: CLOCK },
  });
  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, { requests });

  const first = reader.read(SESSION_ID, 'a1');
  assert.equal(first?.state, 'evaluated');
  assert.equal(first?.state === 'evaluated' ? first.quote : 'unexpected', undefined, 'the stored reading predates the quote field');
  await reader.settled();

  const repaired = storedAskDecision(objects);
  assert.equal(repaired?.state, 'evaluated');
  assert.equal(
    repaired?.state === 'evaluated' ? typeof repaired.quote : 'missing',
    'string',
    'the quote is filled by the one recompute',
  );
  assert.equal(requests.length, 1);

  assert.equal(reader.read(SESSION_ID, 'a1')?.state, 'evaluated');
  await reader.settled();
  assert.equal(requests.length, 1, 'a second read does not call the model again');
});

test('read-time repair: a missing transcript writes the failure reason, never the stale disabled skip', async () => {
  const { store, objects } = createMemoryStore();
  seedSkipped(store);
  const reader = readerOver(store, {
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/missing.jsonl' }),
    readTranscript: async () => null,
  });

  assert.equal(reader.read(SESSION_ID)?.state, 'skipped', 'the first frame still answers the stored reading');
  await reader.settled();

  const stored = storedAskDecision(objects);
  assert.equal(stored?.state, 'unevaluated');
  assert.equal(stored?.state === 'unevaluated' ? stored.reason : '', SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON);
  assert.equal(stored?.state === 'unevaluated' ? stored.reason.includes('未启用') : true, false);
  assert.equal(reader.read(SESSION_ID)?.state, 'unevaluated', 'the failure is what the card now reads');
});

test('read-time repair: a transcript read that throws writes that failure, not silence', async () => {
  const { store, objects } = createMemoryStore();
  seedSkipped(store);
  const reader = readerOver(store, {
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/unreadable.jsonl' }),
    readTranscript: async () => {
      throw new Error('EACCES: permission denied');
    },
  });

  reader.read(SESSION_ID);
  await reader.settled();

  const stored = storedAskDecision(objects);
  assert.equal(stored?.state, 'unevaluated');
  const reason = stored?.state === 'unevaluated' ? stored.reason : '';
  assert.match(reason, /重算失败/);
  assert.match(reason, /EACCES/, 'the failure names the cause instead of being swallowed');
  assert.equal(reason.includes('未启用'), false);
});

test('read-time repair: a transcript without the card’s ask writes its own reason, distinct from the limit', async () => {
  const { store, objects } = createMemoryStore();
  seedSkipped(store);
  // The transcript ends on a statement, and the card names a message that is not in it.
  const statement = transcript([
    { role: 'user', id: 'u1', text: '继续' },
    { role: 'assistant', id: 'a1', text: '已经跑完了，状态如下。' },
  ]);
  let clock = CLOCK;
  const reader = readerOver(store, {
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/ask.jsonl' }),
    readTranscript: async () => statement,
    now: () => clock,
  });

  // 「暂不可判定」 until the cap: the provider process may not have appended the row yet, so an
  // early miss writes NOTHING and the stored reading stays on the card.
  for (let attempt = 1; attempt < SESSION_ASK_DECISION_ASK_RETRY_LIMIT; attempt += 1) {
    reader.read(SESSION_ID, 'missing-message');
    await reader.settled();
    const untouched = storedAskDecision(objects);
    assert.equal(untouched?.state, 'skipped', `attempt ${attempt} must not write a verdict`);
    clock += 60_000;
  }

  reader.read(SESSION_ID, 'missing-message');
  await reader.settled();

  const stored = storedAskDecision(objects);
  assert.equal(stored?.state, 'unevaluated');
  const reason = stored?.state === 'unevaluated' ? stored.reason : '';
  assert.equal(reason, SESSION_ASK_DECISION_ASK_MISSING_REASON);
  assert.notEqual(SESSION_ASK_DECISION_ASK_MISSING_REASON, SESSION_ASK_DECISION_LIMIT_REASON);
  assert.notEqual(SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON, SESSION_ASK_DECISION_LIMIT_REASON);
  assert.notEqual(SESSION_ASK_DECISION_ASK_MISSING_REASON, SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON);
});

test('read-time repair: a transcript that has not caught up yet is 「暂不可判定」 and retried, then repaired', async () => {
  const { store, objects } = createMemoryStore();
  seedSkipped(store);
  // The provider process appends the asking row asynchronously; the card can be read first.
  let raw = transcript([
    { role: 'user', id: 'u1', text: '继续' },
    { role: 'assistant', id: 'a2', text: '已经跑完了，状态如下。' },
  ]);
  let clock = CLOCK;
  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, {
    requests,
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/ask.jsonl' }),
    readTranscript: async () => raw,
    now: () => clock,
  });

  reader.read(SESSION_ID, 'a1');
  await reader.settled();
  assert.equal(requests.length, 0, 'no model call while the row is missing');
  assert.equal(storedAskDecision(objects)?.state, 'skipped', '暂不可判定 writes no verdict');

  // A read inside the backoff interval pays for nothing at all.
  reader.read(SESSION_ID, 'a1');
  await reader.settled();
  assert.equal(requests.length, 0, 'the widening interval gates the second transcript read');

  // The row arrives; the next allowed read repairs the card.
  raw = YES_NO_TRANSCRIPT;
  clock += 60_000;
  reader.read(SESSION_ID, 'a1');
  await reader.settled();
  assert.equal(requests.length, 1);
  assert.equal(storedAskDecision(objects)?.state, 'evaluated', 'the retry, not the first miss, decides');
});

test('read-time repair: a card naming another ask never borrows the session slot, and its own ask is repaired under its askId', async () => {
  const { store, objects } = createMemoryStore();
  // THE LIVE DEFECT (#3): the stored digest belongs to the PREVIOUS turn (a0) — its own write for
  // the asking turn never landed — and the card names a1. The old reader compared the two askIds,
  // reported 「转写里找不到这次提问」 and remembered it, although the transcript carried a1 all along.
  store.writeRevision({
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：浏览器 profile',
    status: { state: 'attention' },
    digest: {
      activity: 'waiting',
      askDecision: {
        state: 'evaluated',
        inputTokens: 1,
        outputTokens: 1,
        askId: `${SESSION_ID}:a0`,
        revision: 1,
        ask: '上一轮的问题',
        situation: '上一轮的情境',
        options: [
          { id: 'yes', label: '是', does: '继续。', tags: [], suggested: true, source: 'assistant' },
          { id: 'no', label: '否', does: '停下。', tags: [], suggested: false, source: 'assistant' },
        ],
        incomplete: false,
        // No `quote`: the stale shape that makes this reading eligible for repair.
      },
    },
    provenance: { producer: 'session-digest', tier: 'llm', evaluatedAt: CLOCK },
  });
  const raw = transcript([
    { role: 'user', id: 'u0', text: '开始' },
    { role: 'assistant', id: 'a0', text: '第一问：要不要先补测试？' },
    { role: 'user', id: 'u1', text: '先补测试' },
    { role: 'assistant', id: 'a1', text: '第二问：先改实现可以吗？' },
  ]);
  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, {
    requests,
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/ask.jsonl' }),
    readTranscript: async () => raw,
  });

  const first = reader.read(SESSION_ID, 'a1');
  assert.equal(
    first?.state,
    'unevaluated',
    'the card names its own ask: the session slot (a0) is never its answer',
  );
  assert.equal(
    first?.state === 'unevaluated' ? first.reason : '',
    SESSION_ASK_DECISION_NOT_GENERATED_REASON,
    'a card with no summary of its own says so, instead of showing another ask’s options',
  );
  await reader.settled();

  assert.equal(requests.length, 1, 'the ask the card names is recomputed');
  const digest = objects.get(formatSessionUri(SESSION_ID))?.digest;
  const askDecisions = (digest?.askDecisions ?? {}) as Record<string, SessionAskDecisionReading>;
  const askDecisionMessages = (digest?.askDecisionMessages ?? {}) as Record<string, string>;
  const perAsk = askDecisions[`${SESSION_ID}:a1`];
  assert.equal(perAsk?.state, 'evaluated', 'the repair lands under the card’s own askId');
  assert.equal(perAsk?.state === 'evaluated' ? perAsk.askId : '', `${SESSION_ID}:a1`);
  assert.equal(
    JSON.stringify(perAsk).includes(SESSION_ASK_DECISION_ASK_MISSING_REASON),
    false,
    'the transcript does carry the card’s ask: the missing-ask sentence must never be written',
  );
  assert.equal(
    perAsk?.state === 'evaluated' ? typeof perAsk.quote : 'missing',
    'string',
    'the card’s ask is the one now stored, with the quote a fresh recompute produces',
  );
  assert.equal(
    askDecisionMessages['a1'],
    `${SESSION_ID}:a1`,
    'the message index resolves the card’s message to its own ask',
  );
  // The legacy slot names the session's LATEST ask; repairing an older card's ask must not move
  // it backwards.
  const slot = storedAskDecision(objects);
  assert.equal(slot?.state === 'evaluated' ? slot.askId : '', `${SESSION_ID}:a0`);
});

test('read-time repair: the card’s message id locates the ask when the transcript has moved on', async () => {
  const { store, objects } = createMemoryStore();
  seedSkipped(store);
  // THE LIVE QUAY SHAPE: the asking message is twenty turns behind the transcript's end, whose
  // last assistant message is a status statement. A session-last-message walk finds no ask.
  const movedOn = transcript([
    { role: 'user', id: 'u1', text: '开始吧' },
    { role: 'assistant', id: 'a1', text: '要我先跑测试吗？' },
    { role: 'user', id: 'u2', text: '先跑吧' },
    { role: 'assistant', id: 'a2', text: '已经跑完了，状态如下。' },
  ]);
  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, {
    requests,
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/ask.jsonl' }),
    readTranscript: async () => movedOn,
  });

  // Without the message id there is no current ask: the last assistant message is a statement.
  assert.equal(readSessionAsk(movedOn, SESSION_ID).current, null);

  reader.read(SESSION_ID, 'a1');
  await reader.settled();

  assert.equal(requests.length, 1, 'the named ask is recomputed');
  const stored = storedAskDecision(objects);
  assert.equal(stored?.state, 'evaluated');
  if (stored?.state !== 'evaluated') return;
  assert.equal(stored.askId, `${SESSION_ID}:a1`);
  // The context stops at the ask, so the model is not shown the later turn as "the question".
  const prompt = requests[0]?.user ?? '';
  assert.match(prompt, /要我先跑测试吗？/);
  assert.equal(prompt.includes('已经跑完了'), false);
});

test('read-time repair: a transcript in another project’s encoded directory is located by provider id', async () => {
  const { store, objects } = createMemoryStore();
  seedSkipped(store);

  const root = await mkdtemp(join(tmpdir(), 'ask-reader-'));
  const quayProjectDir = join(root, '-data-home-yale-work-quay');
  await mkdir(quayProjectDir, { recursive: true });
  const providerSessionId = '03a388ed-5590-4da3-afd0-9f79086eb026';
  await writeFile(join(quayProjectDir, `${providerSessionId}.jsonl`), YES_NO_TRANSCRIPT, 'utf8');

  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, {
    requests,
    claudeProjectsRoot: root,
    // The stored path names the WRONG project's encoded directory (as a row indexed from a
    // different project would), so only the provider-id lookup can find the transcript.
    resolveSession: () => ({
      title: '会话：浏览器 profile',
      jsonlPath: join(root, '-data-home-yale-work-claudecodeui', `${providerSessionId}.jsonl`),
      providerSessionId,
    }),
  });

  reader.read(SESSION_ID);
  await reader.settled();

  assert.equal(requests.length, 1, 'the cross-project transcript was found and recomputed');
  const stored = storedAskDecision(objects);
  assert.equal(stored?.state, 'evaluated');
});

// ---------------------------------------------------------------------------------------------
// The missing-object self-heal: a card whose session object was never written
// ---------------------------------------------------------------------------------------------

/** A second session, so 「no object yet」 cannot be confused with the suite's seeded one. */
const HEAL_SESSION_ID = 'heal-session';

test('self-heal: a missing object is rebuilt from the session row and transcript, never answered null', async () => {
  const { store, objects } = createMemoryStore();
  const uri = formatSessionUri(HEAL_SESSION_ID);
  // THE LIVE SHAPE (15 of 18 live cards): `session.asking` reached the fleet, the card names a
  // real session, but `observed_objects` has no row for it. The old read returned null here —
  // 「尚未生成」 forever — BEFORE the transcript that carries the ask was ever consulted.
  assert.equal(store.getObject(uri), null);

  const requests: LlmCompletionRequest[] = [];
  const reader = readerOver(store, {
    requests,
    // The sessions row the live case had: a readable jsonl_path carrying the card's message.
    resolveSession: () => ({
      title: '会话：浏览器 profile',
      jsonlPath: '/tmp/heal.jsonl',
      providerSessionId: 'provider-heal',
    }),
    readTranscript: async () => YES_NO_TRANSCRIPT,
  });

  const first = reader.read(HEAL_SESSION_ID, 'a1');
  assert.notEqual(first, null, 'a missing object is not a dead end — null draws 「尚未生成」 forever');
  await reader.settled();

  const healed = store.getObject(uri);
  assert.notEqual(healed, null, 'the background repair writes the object it rebuilt');
  const stored = healed?.digest.askDecision as SessionAskDecisionReading | undefined;
  assert.equal(stored?.state, 'evaluated');
  assert.equal(requests.length, 1, 'the transcript was summarized exactly once');

  // The next poll answers the real decision (the card's own ask), not the placeholder again.
  const second = reader.read(HEAL_SESSION_ID, 'a1');
  assert.equal(second?.state, 'evaluated');
  assert.equal(second?.state === 'evaluated' ? second.ask : '', YES_NO_ANSWER.ask);
  assert.equal(objects.get(uri)?.digest.askDecision === undefined, false);
});

test('self-heal: with neither a session row nor a transcript the read stays null and never throws', async () => {
  const { store } = createMemoryStore();
  const reader = readerOver(store, {
    resolveSession: () => null,
    findTranscript: async () => null,
    // The transcript read must not be reached: there is no path to read.
    readTranscript: async () => {
      throw new Error('readTranscript must not be called without a resolved path');
    },
  });

  assert.equal(reader.read('unknown-session', 'a1'), null, 'no row and no transcript ⇒ the old null answer');
  await assert.doesNotReject(async () => reader.settled());

  // The failure is recorded as a reading (the a1690759 shape), so the next poll names WHY
  // instead of drawing 「尚未生成」; still no throw and no model call.
  const recorded = store.getObject(formatSessionUri('unknown-session'))?.digest.askDecision as
    | SessionAskDecisionReading
    | undefined;
  assert.equal(recorded?.state, 'unevaluated');
  assert.equal(
    recorded?.state === 'unevaluated' ? recorded.reason : '',
    SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON,
  );
});

test('self-heal: one missing-object attempt is bounded — an unreadable transcript is not retried on every read', async () => {
  const { store } = createMemoryStore();
  let transcriptReads = 0;
  const reader = readerOver(store, {
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/missing.jsonl', providerSessionId: null }),
    readTranscript: async () => {
      transcriptReads += 1;
      return null;
    },
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.doesNotThrow(() => reader.read(HEAL_SESSION_ID, 'a1'));
    await reader.settled();
  }

  assert.ok(transcriptReads <= 2, `the same card pays for at most two transcript reads, got ${transcriptReads}`);
  assert.notEqual(store.getObject(formatSessionUri(HEAL_SESSION_ID)), null, 'the failure is recorded once');
});

test('self-heal: the hourly ceiling refuses the rebuild before any transcript is read', async () => {
  const { store, objects } = createMemoryStore();
  let transcriptReads = 0;
  const reader = readerOver(store, {
    settings: { ...STUB_SETTINGS, maxPerHour: 0 },
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/ask.jsonl', providerSessionId: null }),
    readTranscript: async () => {
      transcriptReads += 1;
      return YES_NO_TRANSCRIPT;
    },
  });

  assert.equal(reader.read(HEAL_SESSION_ID, 'a1'), null);
  await reader.settled();
  assert.equal(transcriptReads, 0, 'the ceiling is checked before the transcript is read');
  assert.equal(objects.size, 0, 'nothing is written under the ceiling');
});

// ---------------------------------------------------------------------------------------------
// Yes/no questions get two options
// ---------------------------------------------------------------------------------------------

test('yes/no: a yes/no question with no listed options gets 是/否 and the judge’s pick is the default', async () => {
  const summariser = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async () =>
      completion(
        JSON.stringify({
          ask: '是否要关闭浏览器释放 profile？',
          situation: 'profile 仍被占用。',
          incomplete: false,
          recommendedOptionId: null,
          judgeOptionId: 'yes',
          judgeReason: '释放 profile 才能让下一个会话启动浏览器。',
          options: [],
        }),
      ),
  });

  const reading = await summariser.summarize({
    sessionId: SESSION_ID,
    sessionTitle: '会话',
    askId: `${SESSION_ID}:a1`,
    revision: 1,
    assistantText: '是否要关闭浏览器释放 profile？',
    context: '[助手] 是否要关闭浏览器释放 profile？',
  });

  assert.equal(reading.state, 'evaluated');
  if (reading.state !== 'evaluated') return;
  assert.deepEqual(
    reading.options.map((option) => ({ id: option.id, label: option.label, suggested: option.suggested })),
    [
      { id: stableOptionId('是'), label: '是', suggested: true },
      { id: stableOptionId('否'), label: '否', suggested: false },
    ],
    'the two synthesized options are 是/否 with label-derived ids, and the judge picks one of them',
  );
  assert.deepEqual(reading.options.map((option) => option.source), ['judge', 'assistant']);
  assert.equal(reading.options[0]?.why, '释放 profile 才能让下一个会话启动浏览器。');
  assert.ok(reading.options.every((option) => option.tags.length > 0), 'each option carries a consequence tag');
});

test('yes/no: a recommendation in the assistant text marks 是 and sources it from the assistant', async () => {
  const summariser = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async () => completion(JSON.stringify({ ...YES_NO_ANSWER, recommendedOptionId: 'yes' })),
  });

  const reading = await summariser.summarize({
    sessionId: SESSION_ID,
    sessionTitle: '会话',
    askId: `${SESSION_ID}:a1`,
    revision: 1,
    assistantText: '是否先关闭浏览器释放 profile？我建议先关闭。',
    context: '[助手] 是否先关闭浏览器释放 profile？我建议先关闭。',
  });

  assert.equal(reading.state, 'evaluated');
  if (reading.state !== 'evaluated') return;
  const yes = reading.options.find((option) => option.id === stableOptionId('是'));
  const no = reading.options.find((option) => option.id === stableOptionId('否'));
  assert.equal(yes?.suggested, true);
  assert.equal(yes?.source, 'assistant');
  assert.equal(no?.suggested, false);
});

// ---------------------------------------------------------------------------------------------
// Stable option identity: the written id names the LABEL, not the model's own id
//
// The cockpit's local receipt and the fleet feedback call use `options[].id` as the option's
// identity. A model-chosen id is free text and changes between two computations of the same
// question, so a sent choice could no longer be matched to a current option. The digest therefore
// derives the id from the normalised label; these cases pin that derivation end to end.
// ---------------------------------------------------------------------------------------------

const IDENTITY_ASSISTANT_TEXT = '你可以从这些做法里挑一个：先补测试 / 先改实现 / 先看日志';
const IDENTITY_CONTEXT = `[用户] 下一步做什么？\n[助手] ${IDENTITY_ASSISTANT_TEXT}`;

/** One model answer over the given (model-id, label) pairs, with no suggestion of any kind. */
function identityAnswer(options: Array<{ id: string; label: string }>): Record<string, unknown> {
  return {
    ask: '下一步先做哪一件？',
    situation: '刚讨论完三件可做的事。',
    incomplete: false,
    recommendedOptionId: null,
    judgeOptionId: null,
    judgeReason: null,
    options: options.map(({ id, label }) => ({
      id,
      label,
      does: `执行「${label}」。`,
      tags: [],
      source: 'assistant',
    })),
  };
}

/** The evaluated member of the reading union; every identity case asserts its way into it. */
type EvaluatedReading = Extract<SessionAskDecisionReading, { state: 'evaluated' }>;

async function summarizeIdentity(answer: Record<string, unknown>): Promise<EvaluatedReading> {
  const summariser = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async () => completion(JSON.stringify(answer)),
  });
  const reading = await summariser.summarize({
    sessionId: SESSION_ID,
    sessionTitle: '会话',
    askId: `${SESSION_ID}:a1`,
    revision: 1,
    assistantText: IDENTITY_ASSISTANT_TEXT,
    context: IDENTITY_CONTEXT,
  });
  assert.equal(reading.state, 'evaluated', JSON.stringify(reading));
  if (reading.state !== 'evaluated') throw new Error('the digest must be evaluated');
  return reading;
}

test('option identity: the same labels in a different order carry IDENTICAL ids', async () => {
  const forwards = await summarizeIdentity(
    identityAnswer([
      { id: 'a', label: '先补测试' },
      { id: 'b', label: '先改实现' },
      { id: 'c', label: '先看日志' },
    ]),
  );
  // The second computation hands different model ids to the SAME labels, in the opposite order:
  // a model's id is free text and changes between recomputations, which is exactly the defect.
  // Only the labels agree, so only a label-derived id can match.
  const backwards = await summarizeIdentity(
    identityAnswer([
      { id: 'z', label: '先看日志' },
      { id: 'y', label: '先改实现' },
      { id: 'x', label: '先补测试' },
    ]),
  );

  const idByLabel = (
    options: ReadonlyArray<{ label: string; id: string }>,
  ): Record<string, string> => Object.fromEntries(options.map((option) => [option.label, option.id]));
  // `backwards` first, so the expected object reads in its own order.
  assert.deepEqual(idByLabel(backwards.options), idByLabel(forwards.options));
  assert.deepEqual(Object.keys(idByLabel(forwards.options)), ['先补测试', '先改实现', '先看日志']);
});

test('option identity: a label changed by one character is a DIFFERENT option', async () => {
  const [original] = (await summarizeIdentity(identityAnswer([{ id: 'a', label: '先补测试' }]))).options;
  const [edited] = (await summarizeIdentity(identityAnswer([{ id: 'a', label: '先补测' }]))).options;

  assert.equal(original?.id, stableOptionId('先补测试'));
  assert.equal(edited?.id, stableOptionId('先补测'));
  assert.notEqual(original?.id, edited?.id, 'one character is a different label, so a different id');
});

test('option identity: duplicate labels in ONE output get a suffix instead of collapsing', async () => {
  const reading = await summarizeIdentity(
    identityAnswer([
      { id: 'first', label: '先跑测试' },
      { id: 'second', label: '先跑测试' },
    ]),
  );
  const base = stableOptionId('先跑测试');
  assert.deepEqual(
    reading.options.map((option) => option.id),
    [base, `${base}-2`],
    'the second copy of a label gets the `-2` suffix, so two options never share one id',
  );
  assert.deepEqual(
    reading.options.map((option) => option.label),
    ['先跑测试', '先跑测试'],
    'the labels themselves are untouched',
  );
});

test('option identity: the model-provided id is NEVER written into the decision', async () => {
  const modelIds = ['baseline-first', 'bb', 'cc'];
  const reading = await summarizeIdentity(
    identityAnswer([
      { id: modelIds[0]!, label: '先补测试' },
      { id: modelIds[1]!, label: '先改实现' },
      { id: modelIds[2]!, label: '先看日志' },
    ]),
  );

  for (const option of reading.options) {
    assert.match(option.id, /^opt-[0-9a-f]{8}(-\d+)?$/, 'every id is the label-derived shape');
    assert.ok(!modelIds.includes(option.id), `the model id ${option.id} must not survive`);
  }
  const serialized = JSON.stringify(reading.options);
  for (const modelId of modelIds) {
    assert.ok(!serialized.includes(`"id":${JSON.stringify(modelId)}`), `no option carries the model id ${modelId}`);
  }
});

// ---------------------------------------------------------------------------------------------
// Reliable session.answered: every answered ask, across rounds and across restarts, exactly once
// ---------------------------------------------------------------------------------------------

test('answered: two asks the ledger still marks unfinished are BOTH stated by one turn-end', async () => {
  // The ledger is what a restart leaves behind: both asks were stated (`pending`) before the
  // process stopped, and the transcript now shows both answered. The single turn-end resolves
  // both — not only the ask the final prompt answered.
  const objects = new Map<string, ObservedObject>();
  objects.set(formatSessionUri(SESSION_ID), {
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：选中方案',
    status: { state: 'attention' },
    digest: {
      activity: 'waiting',
      askEvents: {
        answered: [],
        asking: [`${SESSION_ID}:a1:1`, `${SESSION_ID}:a3:1`],
        pending: [
          { askId: `${SESSION_ID}:a1`, messageId: 'a1' },
          { askId: `${SESSION_ID}:a3`, messageId: 'a3' },
        ],
      },
    },
    blindSpots: [],
    revision: 1,
    updatedAt: CLOCK,
    provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
  });
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER), { objects });
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: '第一问：要不要先补测试？' },
      { role: 'user', id: 'u2', text: '先补测试' },
      { role: 'assistant', id: 'a2', text: '好，已经补上。' },
      { role: 'user', id: 'u3', text: '还有别的吗' },
      { role: 'assistant', id: 'a3', text: '第二问：先改实现可以吗？' },
      { role: 'user', id: 'u4', text: '可以' },
      { role: 'assistant', id: 'a4', text: '开始改实现。' },
    ]),
  );

  await harness.turnEnd();

  const answered = harness.events
    .filter((event) => event.kind === 'session.answered')
    .map((event) => event.data);
  assert.deepEqual(answered, [
    { askId: `${SESSION_ID}:a1`, messageId: 'u2' },
    { askId: `${SESSION_ID}:a3`, messageId: 'u4' },
  ]);
});

test('answered: a fresh producer over the same store backfills the ask answered across the restart', async () => {
  const objects = new Map<string, ObservedObject>();
  // a1 was stated as asking by the turn that ended ON a1 (before this transcript's tail), so
  // its ledger entry is the persisted "unfinished" fact — the only thing a restart cannot lose.
  objects.set(formatSessionUri(SESSION_ID), {
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：选中方案',
    status: { state: 'attention' },
    digest: {
      activity: 'waiting',
      askEvents: {
        answered: [],
        asking: [`${SESSION_ID}:a1:1`],
        pending: [{ askId: `${SESSION_ID}:a1`, messageId: 'a1' }],
      },
    },
    blindSpots: [],
    revision: 1,
    updatedAt: CLOCK,
    provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
  });

  // Before the restart: the first ask is answered and the second is left open.
  const before = createHarness(JSON.stringify(RECOMMENDED_ANSWER), { objects });
  before.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: '第一问：要不要先补测试？' },
      { role: 'user', id: 'u2', text: '先补测试' },
      { role: 'assistant', id: 'a2', text: '第二问：先改实现可以吗？' },
    ]),
  );
  await before.turnEnd();
  assert.deepEqual(
    before.events.filter((event) => event.kind === 'session.answered').map((event) => event.data),
    [{ askId: `${SESSION_ID}:a1`, messageId: 'u2' }],
  );
  assert.equal(before.events.filter((event) => event.kind === 'session.asking').length, 1);

  // The process restarts (new producer, no in-memory emitted set). While it was down the second
  // ask was answered and a later round closed the turn. The first turn-end after the restart must
  // state that answer — and must NOT re-state the first one: only the digest's persisted ledger
  // remembers it, which is exactly the reading a memory-only askId set loses.
  const after = createHarness(JSON.stringify(RECOMMENDED_ANSWER), { objects });
  after.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: '第一问：要不要先补测试？' },
      { role: 'user', id: 'u2', text: '先补测试' },
      { role: 'assistant', id: 'a2', text: '第二问：先改实现可以吗？' },
      { role: 'user', id: 'u3', text: '可以' },
      { role: 'assistant', id: 'a3', text: '开始改实现。' },
    ]),
  );
  await after.turnEnd();

  const answered = after.events.filter((event) => event.kind === 'session.answered');
  assert.deepEqual(
    answered.map((event) => event.data),
    [{ askId: `${SESSION_ID}:a2`, messageId: 'u3' }],
  );
});

test('answered: an ask whose summary FAILED is still in the unfinished ledger, and the next user message answers it', async () => {
  // THE LIVE DEFECT: the asking event was stated, the T1 summary never finished (the process was
  // restarted while the call was in flight), and because the ledger rode only on the FINAL write
  // the ask was never recorded as unfinished — so the answer that followed could not end it.
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER), {
    summarizeAsk: {
      async summarize() {
        throw new Error('gateway 502');
      },
    },
  });
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: '要不要先补测试？' },
    ]),
  );

  const written = await harness.turnEnd();
  assert.equal(harness.writes.length, 2, 'the turn is written before the model call, then enriched');
  // The FIRST revision — the one written before the summary was even attempted — carries the
  // ledger. That is what makes the ledger independent of the summary's outcome.
  const ledgerBeforeSummary = readSessionAskEventLedger(harness.writes[0]?.digest);
  assert.deepEqual(ledgerBeforeSummary.pending, [{ askId: `${SESSION_ID}:a1`, messageId: 'a1' }]);
  assert.equal(written?.digest.askDecision !== null && typeof written?.digest.askDecision === 'object', true);
  const decision = written?.digest.askDecision as SessionAskDecisionReading | undefined;
  assert.equal(decision?.state, 'unevaluated', 'the failed summary is stated, not hidden');

  // The person answers: the ledger — not the summary — is what states the answer.
  await harness.userTurn('u2');
  assert.deepEqual(
    harness.events.filter((event) => event.kind === 'session.answered').map((event) => event.data),
    [{ askId: `${SESSION_ID}:a1`, messageId: 'u2' }],
  );
});

test('answered: a user message states the answer immediately, and the next turn-end does not repeat it', async () => {
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER));
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: '要不要先补测试？' },
    ]),
  );
  await harness.turnEnd();

  // The provider process has NOT written the user's row yet: the transcript still ends on the
  // asking message. The send alone is the answer's fact, so the answer is stated now — the
  // transcript is never consulted on this path.
  await harness.userTurn('u2');
  const afterSend = harness.events.filter((event) => event.kind === 'session.answered');
  assert.deepEqual(
    afterSend.map((event) => event.data),
    [{ askId: `${SESSION_ID}:a1`, messageId: 'u2' }],
  );

  // The turn-end that follows (with the row now on disk) must not state the same answer again,
  // and a second send has no unfinished ask left to answer.
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: '要不要先补测试？' },
      { role: 'user', id: 'u2', text: '先补测试' },
      { role: 'assistant', id: 'a2', text: '补好了。' },
    ]),
  );
  await harness.turnEnd();
  await harness.userTurn('u3');
  assert.equal(harness.events.filter((event) => event.kind === 'session.answered').length, 1);
});

test('answered: backfill re-states NOTHING the ledger already answered or never marked unfinished', async () => {
  // THE LIVE SHAPE: one turn over a transcript carrying many old answered rounds wrote ~70
  // duplicate `session.answered` rows. Only the ledger's unfinished ask may be backfilled.
  const objects = new Map<string, ObservedObject>();
  objects.set(formatSessionUri(SESSION_ID), {
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：选中方案',
    status: { state: 'attention' },
    digest: {
      activity: 'waiting',
      askEvents: {
        answered: [`${SESSION_ID}:a1`],
        asking: [`${SESSION_ID}:a1:1`, `${SESSION_ID}:a3:1`, `${SESSION_ID}:a5:1`],
        // a3 is the one still open; a1 was answered before, a5 was never stated as pending
        // (an old digest, or an ask this process never saw).
        pending: [{ askId: `${SESSION_ID}:a3`, messageId: 'a3' }],
      },
    },
    blindSpots: [],
    revision: 1,
    updatedAt: CLOCK,
    provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
  });
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER), { objects });
  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: '第一问：要不要先补测试？' },
      { role: 'user', id: 'u2', text: '先补测试' },
      { role: 'assistant', id: 'a2', text: '好，已经补上。' },
      { role: 'user', id: 'u3', text: '还有别的吗' },
      { role: 'assistant', id: 'a3', text: '第二问：先改实现可以吗？' },
      { role: 'user', id: 'u4', text: '可以' },
      { role: 'assistant', id: 'a4', text: '开始改实现。' },
      { role: 'user', id: 'u5', text: '再问一个问题' },
      { role: 'assistant', id: 'a5', text: '第三问：要不要先提交？' },
      { role: 'user', id: 'u6', text: '提交' },
      { role: 'assistant', id: 'a6', text: '已提交。' },
    ]),
  );

  await harness.turnEnd();

  const answered = harness.events.filter((event) => event.kind === 'session.answered');
  assert.deepEqual(
    answered.map((event) => event.data),
    [{ askId: `${SESSION_ID}:a3`, messageId: 'u4' }],
    'exactly the one ledger-unfinished ask is backfilled; a1 (answered) and a5 (never pending) are not',
  );
  assert.equal(answered.length, 1, 'the backfill count equals the unfinished count');
});

test('answered: the startup sweep backfills only sessions whose transcript shows the answer', async () => {
  const SESSION_A = 'ask-sweep-a';
  const SESSION_B = 'ask-sweep-b';
  const SESSION_QUIET = 'ask-sweep-quiet';
  const { store } = createMemoryStore();
  const transcripts = new Map<string, string>([
    // A: the open ask was answered while no turn-end ran.
    [
      SESSION_A,
      transcript([
        { role: 'user', id: 'u1', text: '开始' },
        { role: 'assistant', id: 'a1', text: '要不要先补测试？' },
        { role: 'user', id: 'u2', text: '先补测试' },
        { role: 'assistant', id: 'a2', text: '补好了。' },
      ]),
    ],
    // B: the ask is still open — no later user message anywhere in the transcript.
    [
      SESSION_B,
      transcript([
        { role: 'user', id: 'u1', text: '开始' },
        { role: 'assistant', id: 'b1', text: '要我先跑测试吗？' },
      ]),
    ],
  ]);
  const seed = (sessionId: string, pending: Array<{ askId: string; messageId: string }>): void => {
    store.writeRevision({
      uri: formatSessionUri(sessionId),
      kind: 'session',
      title: sessionId,
      status: { state: 'attention' },
      digest: { activity: 'waiting', askEvents: { answered: [], asking: [], pending } },
      provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
    });
  };
  seed(SESSION_A, [{ askId: `${SESSION_A}:a1`, messageId: 'a1' }]);
  seed(SESSION_B, [{ askId: `${SESSION_B}:b1`, messageId: 'b1' }]);
  // A session with no unfinished ask is not swept (and is not counted as inspected).
  store.writeRevision({
    uri: formatSessionUri(SESSION_QUIET),
    kind: 'session',
    title: SESSION_QUIET,
    status: { state: 'ok' },
    digest: { activity: 'idle', askEvents: { answered: [], asking: [], pending: [] } },
    provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
  });

  const events: SessionAskEvent[] = [];
  const logs: string[] = [];
  const producer = createSessionDigestProducer({
    store,
    resolveSession: (sessionId) => ({ title: sessionId, projectPath: PROJECT_PATH, jsonlPath: `/tmp/${sessionId}.jsonl` }),
    readTranscript: async (jsonlPath) => transcripts.get(jsonlPath.split('/').at(-1)?.replace('.jsonl', '') ?? '') ?? null,
    isObserved: () => true,
    now: () => CLOCK,
    eventWriter: { write: (event) => events.push(event) },
    listObservedSessionIds: () => [SESSION_A, SESSION_B, SESSION_QUIET],
    sweepDelayMs: 0,
    log: (message) => logs.push(message),
  });

  const summary = await producer.sweepOpenAsks();

  assert.deepEqual(
    summary,
    { sessions: 2, answered: 1, rebuilt: 0 },
    'two sessions still had an open ask; one answer was stated; no stream seam, so nothing was rebuilt',
  );
  assert.deepEqual(
    events.filter((event) => event.kind === 'session.answered').map((event) => ({ session: event.session, data: event.data })),
    [{ session: SESSION_A, data: { askId: `${SESSION_A}:a1`, messageId: 'u2' } }],
    'only the session whose transcript carries a later user message is backfilled',
  );
  assert.equal(logs.length, 1, 'the sweep states one count line');
  assert.match(logs[0] ?? '', /检查 2 个有未结束提问的会话/);
  assert.match(logs[0] ?? '', /补发 1 条/);

  // A second boot pass has nothing left for A; B is still open and still unanswered.
  const again = await producer.sweepOpenAsks();
  assert.deepEqual(again, { sessions: 1, answered: 0, rebuilt: 0 });
  assert.equal(events.filter((event) => event.kind === 'session.answered').length, 1, 'no answer is stated twice');
});

test('answered: the startup sweep rebuilds the stream’s open askIds, then backfills only the answered ones', async () => {
  const SESSION_OPEN = 'ask-stream-open';
  const SESSION_SETTLED = 'ask-stream-settled';
  const { store } = createMemoryStore();
  const transcripts = new Map<string, string>([
    [
      SESSION_OPEN,
      transcript([
        { role: 'user', id: 'u1', text: '开始' },
        { role: 'assistant', id: 'o1', text: '要我先跑测试吗？' },
      ]),
    ],
    [
      SESSION_SETTLED,
      transcript([
        { role: 'user', id: 'u1', text: '开始' },
        { role: 'assistant', id: 's1', text: '要我先跑测试吗？' },
        { role: 'user', id: 'u2', text: '先跑吧' },
        { role: 'assistant', id: 's2', text: '跑完了。' },
      ]),
    ],
  ]);
  // The ledger was never written for either session: that is exactly the state the live restart
  // left behind (the digest revision carrying it never completed).
  for (const sessionId of [SESSION_OPEN, SESSION_SETTLED]) {
    store.writeRevision({
      uri: formatSessionUri(sessionId),
      kind: 'session',
      title: sessionId,
      status: { state: 'attention' },
      digest: { activity: 'waiting' },
      provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
    });
  }

  const events: SessionAskEvent[] = [];
  const logs: string[] = [];
  const producer = createSessionDigestProducer({
    store,
    resolveSession: (sessionId) => ({ title: sessionId, projectPath: PROJECT_PATH, jsonlPath: `/tmp/${sessionId}.jsonl` }),
    readTranscript: async (jsonlPath) => transcripts.get(jsonlPath.split('/').at(-1)?.replace('.jsonl', '') ?? '') ?? null,
    isObserved: () => true,
    now: () => CLOCK,
    eventWriter: { write: (event) => events.push(event) },
    listObservedSessionIds: () => [SESSION_OPEN, SESSION_SETTLED],
    readOpenSessionAsks: async () => [
      { askId: `${SESSION_OPEN}:o1`, sessionId: SESSION_OPEN, messageId: 'o1', revision: 1, project: PROJECT_PATH, askedAt: '2026-10-28T01:00:00.000Z' },
      { askId: `${SESSION_SETTLED}:s1`, sessionId: SESSION_SETTLED, messageId: 's1', revision: 1, project: PROJECT_PATH, askedAt: '2026-10-28T02:00:00.000Z' },
    ],
    sweepDelayMs: 0,
    log: (message) => logs.push(message),
  });

  const summary = await producer.sweepOpenAsks();

  assert.deepEqual(
    summary,
    { sessions: 2, answered: 1, rebuilt: 2 },
    'both old askIds are rebuilt into the ledger; only the one whose transcript shows a later user message is answered',
  );
  assert.deepEqual(
    events.filter((event) => event.kind === 'session.answered').map((event) => ({ session: event.session, data: event.data })),
    [{ session: SESSION_SETTLED, data: { askId: `${SESSION_SETTLED}:s1`, messageId: 'u2' } }],
    'the still-open session is NOT answered: no later user message exists',
  );

  const openLedger = readSessionAskEventLedger(store.getObject(formatSessionUri(SESSION_OPEN))?.digest);
  assert.deepEqual(openLedger.asking, [`${SESSION_OPEN}:o1:1`]);
  assert.deepEqual(openLedger.pending, [{ askId: `${SESSION_OPEN}:o1`, messageId: 'o1' }]);
  const settledLedger = readSessionAskEventLedger(store.getObject(formatSessionUri(SESSION_SETTLED))?.digest);
  assert.deepEqual(settledLedger.answered, [`${SESSION_SETTLED}:s1`]);
  assert.equal(settledLedger.pending.length, 0, 'an answered rebuilt ask is no longer unfinished');

  assert.match(logs[0] ?? '', /从事件流补进 2 个旧 askId/);
  assert.match(logs[0] ?? '', /检查 2 个有未结束提问的会话/);
  assert.match(logs[0] ?? '', /补发 1 条/);

  // A second boot pass re-reads the same stream: the settled askId is already answered and the
  // open one is already ledgered, so neither is rebuilt or answered a second time.
  const again = await producer.sweepOpenAsks();
  assert.deepEqual(again, { sessions: 1, answered: 0, rebuilt: 0 });
});

test('the stream reader answers the askIds this host stated and never answered, inside the lookback window', async () => {
  // The parser behind the rebuild, over a real directory: an answered ask, a foreign producer's
  // ask and an ask beyond the lookback window must all stay out of the sweep's rebuild.
  const dir = await mkdtemp(join(tmpdir(), 'ask-stream-'));
  const row = (fields: Record<string, unknown>): string =>
    `${JSON.stringify({ v: 1, id: 'row', source: 'cloudcli', ...fields })}\n`;
  try {
    await writeFile(
      join(dir, '2026-10-28.jsonl'),
      [
        row({
          at: '2026-10-28T09:00:00.000Z',
          kind: 'session.asking',
          project: '/repo/p',
          session: 's-fresh',
          data: { askId: 's-fresh:a1', messageId: 'a1', revision: 1 },
        }),
        row({
          at: '2026-10-28T09:05:00.000Z',
          kind: 'session.answered',
          project: '/repo/p',
          session: 's-fresh',
          data: { askId: 's-fresh:a1', messageId: 'u1' },
        }),
        row({
          at: '2026-10-28T10:00:00.000Z',
          kind: 'session.asking',
          project: '/repo/p',
          session: 's-open',
          data: { askId: 's-open:b1', messageId: 'b1', revision: 2 },
        }),
        row({
          at: '2026-10-28T10:30:00.000Z',
          kind: 'session.asking',
          source: 'quay',
          session: 's-other',
          data: { askId: 's-other:c1', messageId: 'c1' },
        }),
      ].join(''),
    );
    // Eight days before the clock below: outside the seven-day window.
    await writeFile(
      join(dir, '2026-10-20.jsonl'),
      row({
        at: '2026-10-20T10:00:00.000Z',
        kind: 'session.asking',
        session: 's-old',
        data: { askId: 's-old:z1', messageId: 'z1' },
      }),
    );

    const open = await readOpenSessionAsks({
      eventsDir: dir,
      nowMs: Date.parse('2026-10-28T12:00:00.000Z'),
    });

    assert.deepEqual(open.map((ask) => ask.askId), ['s-open:b1']);
    assert.equal(open[0]?.revision, 2, 'a re-ask is carried with its latest revision');
    assert.equal(open[0]?.sessionId, 's-open');
    assert.equal(open[0]?.messageId, 'b1');
    assert.equal(open[0]?.project, '/repo/p');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the startup sweep rebuilds from asking rows that carry questionText, without re-stating them', async () => {
  // A row written by the new producer carries `questionText` beside the identity fields. The
  // rebuild only reads `askId`/`messageId`/`revision`, so the added member must change nothing:
  // the ledger still gains the old askId, and the boot pass never re-states an asking event.
  const sessionId = 'ask-stream-question';
  const dir = await mkdtemp(join(tmpdir(), 'ask-stream-question-'));
  const asked = '先跑测试还是先改实现？\n\n我建议先跑测试。';
  try {
    await writeFile(
      join(dir, '2026-10-28.jsonl'),
      `${JSON.stringify({
        v: 1,
        id: 'row',
        source: 'cloudcli',
        at: '2026-10-28T09:00:00.000Z',
        kind: 'session.asking',
        project: PROJECT_PATH,
        session: sessionId,
        data: {
          askId: `${sessionId}:o1`,
          messageId: 'o1',
          revision: 1,
          questionText: asked,
          contentRef: { resolver: 'cloudcli.session-ask', sessionId, messageId: 'o1' },
        },
      })}\n`,
    );

    const { store } = createMemoryStore();
    store.writeRevision({
      uri: formatSessionUri(sessionId),
      kind: 'session',
      title: sessionId,
      status: { state: 'attention' },
      digest: { activity: 'waiting' },
      provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
    });

    const events: SessionAskEvent[] = [];
    const producer = createSessionDigestProducer({
      store,
      resolveSession: (id) => ({ title: id, projectPath: PROJECT_PATH, jsonlPath: `/tmp/${id}.jsonl` }),
      readTranscript: async () =>
        transcript([
          { role: 'user', id: 'u1', text: '开始' },
          { role: 'assistant', id: 'o1', text: asked },
        ]),
      isObserved: () => true,
      now: () => CLOCK,
      eventWriter: { write: (event) => events.push(event) },
      listObservedSessionIds: () => [sessionId],
      readOpenSessionAsks: () => readOpenSessionAsks({ eventsDir: dir, nowMs: Date.parse('2026-10-28T12:00:00.000Z') }),
      sweepDelayMs: 0,
      log: () => undefined,
    });

    const summary = await producer.sweepOpenAsks();

    assert.deepEqual(summary, { sessions: 1, answered: 0, rebuilt: 1 }, 'the row with questionText still rebuilds the open ask');
    assert.deepEqual(events, [], 'the boot pass never re-states an asking event');
    const ledger = readSessionAskEventLedger(store.getObject(formatSessionUri(sessionId))?.digest);
    assert.deepEqual(ledger.asking, [`${sessionId}:o1:1`]);
    assert.deepEqual(ledger.pending, [{ askId: `${sessionId}:o1`, messageId: 'o1' }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('answered: readSessionAsks names every answered span and the tail ask', () => {
  const scan = readSessionAsks(
    transcript([
      { role: 'user', id: 'u1', text: '开始' },
      { role: 'assistant', id: 'a1', text: '第一问？' },
      { role: 'user', id: 'u2', text: '答' },
      { role: 'assistant', id: 'a2', text: '第二问？' },
    ]),
    SESSION_ID,
  );

  assert.deepEqual(scan.settled, [{ askId: `${SESSION_ID}:a1`, answerMessageId: 'u2' }]);
  assert.equal(scan.current?.askId, `${SESSION_ID}:a2`);
  assert.equal(scan.current?.revision, 1);
});

// ---------------------------------------------------------------------------------------------
// A background-task notification is not a user prompt: it must not answer a pending ask
// ---------------------------------------------------------------------------------------------

/** One row whose content is a BARE STRING — the shape the harness writes a notification in. */
function stringContentRow(role: 'user' | 'assistant', id: string, text: string): string {
  return JSON.stringify({ type: role, uuid: id, message: { role, content: text } });
}

/** One `<task-notification>` row exactly as the harness persists a background completion. */
function taskNotificationRow(id: string): string {
  return stringContentRow(
    'user',
    id,
    '<task-notification>\n<task-id>t1</task-id>\n<status>completed</status>\n<summary>检查完毕</summary>\n</task-notification>',
  );
}

/** The transcript up to a question, then the background notice — no answer from the person. */
function askThenNotification(): string {
  return `${[
    stringContentRow('user', 'u1', '开始'),
    stringContentRow('assistant', 'a1', '先补测试还是先改实现？'),
    taskNotificationRow('n1'),
  ].join('\n')}\n`;
}

test('AC1: a <task-notification> user row after a pending ask leaves it current, not settled', () => {
  const scan = readSessionAsks(askThenNotification(), SESSION_ID);

  assert.deepEqual(scan.settled, [], 'a background completion is not an answer from the person');
  assert.equal(scan.current?.askId, `${SESSION_ID}:a1`, 'the ask is still the open question');
  assert.equal(scan.current?.revision, 1);
});

test('AC2: a real user message still settles the ask, even after a <task-notification> row', () => {
  const raw = `${[
    stringContentRow('user', 'u1', '开始'),
    stringContentRow('assistant', 'a1', '先补测试还是先改实现？'),
    taskNotificationRow('n1'),
    stringContentRow('user', 'u2', '先补测试'),
    stringContentRow('assistant', 'a2', '补完了，还要先跑一遍吗？'),
  ].join('\n')}\n`;
  const scan = readSessionAsks(raw, SESSION_ID);

  assert.deepEqual(scan.settled, [{ askId: `${SESSION_ID}:a1`, answerMessageId: 'u2' }]);
  assert.equal(scan.current?.askId, `${SESSION_ID}:a2`, 'the tail ask is the newer question');
});

test('AC3: turn-end states no session.answered for a <task-notification> row', async () => {
  // The ledger a restart leaves behind: a1 was stated as asking and is still unanswered.
  const objects = new Map<string, ObservedObject>();
  objects.set(formatSessionUri(SESSION_ID), {
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：选中方案',
    status: { state: 'attention' },
    digest: {
      activity: 'waiting',
      askEvents: {
        answered: [],
        asking: [`${SESSION_ID}:a1:1`],
        pending: [{ askId: `${SESSION_ID}:a1`, messageId: 'a1' }],
      },
    },
    blindSpots: [],
    revision: 1,
    updatedAt: CLOCK,
    provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
  });
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER), { objects });
  harness.setTranscript(askThenNotification());

  await harness.turnEnd();

  assert.deepEqual(
    harness.events.filter((event) => event.kind === 'session.answered'),
    [],
    'no answer is stated when nobody answered',
  );
  const ledger = readSessionAskEventLedger(objects.get(formatSessionUri(SESSION_ID))?.digest);
  assert.deepEqual(ledger.pending, [{ askId: `${SESSION_ID}:a1`, messageId: 'a1' }], 'the ask stays open');
});

// ---------------------------------------------------------------------------------------------
// A cross-session message is not a user prompt either: it must not answer a pending ask
// ---------------------------------------------------------------------------------------------

/**
 * One peer row exactly as the CLI persists another session's SendMessage: a fixed lead-in, an
 * attribute-bearing envelope, and the row markers that say a machine injected it.
 */
function crossSessionRow(id: string): string {
  return JSON.stringify({
    type: 'user',
    uuid: id,
    isMeta: true,
    promptSource: 'system',
    turnOrigin: 'peer',
    origin: { kind: 'peer', from: 'uds:/tmp/peer.sock', name: 'peer' },
    message: {
      role: 'user',
      content:
        'Another Claude session sent a message:\n'
        + '<cross-session-message from="uds:/tmp/peer.sock" from-name="peer" from-mode="bypass">\n'
        + '选 2\n'
        + '</cross-session-message>',
    },
  });
}

/** The transcript up to a question, then another session's message — no answer from the person. */
function askThenCrossSession(): string {
  return `${[
    stringContentRow('user', 'u1', '开始'),
    stringContentRow('assistant', 'a1', '先补测试还是先改实现？'),
    crossSessionRow('p1'),
  ].join('\n')}\n`;
}

test('a cross-session-message row after a pending ask leaves it current, not settled', () => {
  const scan = readSessionAsks(askThenCrossSession(), SESSION_ID);

  assert.deepEqual(scan.settled, [], 'another session speaking is not the person answering');
  assert.equal(scan.current?.askId, `${SESSION_ID}:a1`, 'the ask is still the open question');
  assert.equal(scan.current?.revision, 1);
});

test('a real user message still settles the ask, even after a cross-session-message row', () => {
  const raw = `${[
    stringContentRow('user', 'u1', '开始'),
    stringContentRow('assistant', 'a1', '先补测试还是先改实现？'),
    crossSessionRow('p1'),
    stringContentRow('user', 'u2', '先补测试'),
    stringContentRow('assistant', 'a2', '补完了，还要先跑一遍吗？'),
  ].join('\n')}\n`;
  const scan = readSessionAsks(raw, SESSION_ID);

  assert.deepEqual(
    scan.settled,
    [{ askId: `${SESSION_ID}:a1`, answerMessageId: 'u2' }],
    'the answer is the person\'s row, never the peer row',
  );
  assert.equal(scan.current?.askId, `${SESSION_ID}:a2`, 'the tail ask is the newer question');
});

test('turn-end states no session.answered for a cross-session-message row', async () => {
  const objects = new Map<string, ObservedObject>();
  objects.set(formatSessionUri(SESSION_ID), {
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：选中方案',
    status: { state: 'attention' },
    digest: {
      activity: 'waiting',
      askEvents: {
        answered: [],
        asking: [`${SESSION_ID}:a1:1`],
        pending: [{ askId: `${SESSION_ID}:a1`, messageId: 'a1' }],
      },
    },
    blindSpots: [],
    revision: 1,
    updatedAt: CLOCK,
    provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: CLOCK },
  });
  const harness = createHarness(JSON.stringify(RECOMMENDED_ANSWER), { objects });
  harness.setTranscript(askThenCrossSession());

  await harness.turnEnd();

  assert.deepEqual(
    harness.events.filter((event) => event.kind === 'session.answered'),
    [],
    'no answer is stated when only another session spoke',
  );
  const ledger = readSessionAskEventLedger(objects.get(formatSessionUri(SESSION_ID))?.digest);
  assert.deepEqual(ledger.pending, [{ askId: `${SESSION_ID}:a1`, messageId: 'a1' }], 'the ask stays open');

  // The person's own reply still settles it exactly once, with the person's message id. The
  // assistant turn after it is what a real stop hook sees; without it the transcript ends on a
  // user row and the digest is unevaluated for a different reason.
  const secondRaw = `${askThenCrossSession()}${stringContentRow('user', 'u2', '先补测试')}\n${stringContentRow('assistant', 'a2', '好的，先补测试。')}\n`;
  harness.setTranscript(secondRaw);
  await harness.turnEnd();
  const answered = harness.events.filter((event) => event.kind === 'session.answered');
  assert.equal(answered.length, 1);
  assert.deepEqual((answered[0]?.data as { messageId?: string } | undefined)?.messageId, 'u2');

  // A replay of the same transcript must not state the answer twice.
  await harness.turnEnd();
  assert.equal(
    harness.events.filter((event) => event.kind === 'session.answered').length,
    1,
    'the stated answer survives a turn-end replay',
  );
});

// ---------------------------------------------------------------------------------------------
// The ask digest's JSON contract: its own output ceiling, fences, and a loud truncation
// ---------------------------------------------------------------------------------------------

test('the ask digest uses observation.sessionDigest.maxOutputTokens, not the reply-suggestions 400', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'session-ask-settings-'));
  try {
    const keyPath = join(directory, 'key.txt');
    await writeFile(keyPath, 'sk-test-key\n', { encoding: 'utf8', mode: 0o600 });
    const replyPath = join(directory, 'reply.json');
    await writeFile(
      replyPath,
      JSON.stringify({ enabled: true, baseUrl: 'http://gw.local', model: 'reply-model', apiKeyFile: keyPath, maxOutputTokens: 400 }),
      'utf8',
    );
    const serverPath = join(directory, 'server.json');
    // The block deliberately says nothing about maxOutputTokens.
    await writeFile(serverPath, JSON.stringify({ observation: { sessionDigest: { enabled: true, model: 'digest-model' } } }), 'utf8');

    const source = createSessionDigestLlmSettingsSource({
      settingsPath: serverPath,
      homeDir: directory,
      replySource: createReplySuggestionsSettingsSource({ settingsPath: replyPath, homeDir: directory }),
    });
    const reading = source.read();
    assert.equal(reading.maxOutputTokens, 1200, 'the digest tier has its own default, not the reply ceiling');
    assert.notEqual(reading.maxOutputTokens, 400);

    // An explicit knob still wins.
    await writeFile(
      serverPath,
      JSON.stringify({ observation: { sessionDigest: { enabled: true, model: 'digest-model', maxOutputTokens: 2000 } } }),
      'utf8',
    );
    assert.equal(source.read().maxOutputTokens, 2000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a fenced JSON answer is parsed, and a truncated one is an unreadable reading with a debug log', async () => {
  const fenced = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async () => completion('```json\n' + JSON.stringify(RECOMMENDED_ANSWER) + '\n```'),
  });
  const fencedReading = await fenced.summarize({
    sessionId: SESSION_ID,
    sessionTitle: '会话',
    askId: `${SESSION_ID}:a1`,
    revision: 1,
    assistantText: '先补测试还是先改实现？',
    context: '[助手] 先补测试还是先改实现？',
  });
  assert.equal(fencedReading.state, 'evaluated');

  const logs: string[] = [];
  const truncatedText = '{"ask":"先补测试还是先改实现？","situation":"二选一","incomplete":false,"options":[{"id":"a","label":"先补测';
  const truncated = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async () => completion(truncatedText),
    debugLog: (message) => logs.push(message),
  });
  const truncatedReading = await truncated.summarize({
    sessionId: SESSION_ID,
    sessionTitle: '会话',
    askId: `${SESSION_ID}:a1`,
    revision: 1,
    assistantText: '先补测试还是先改实现？',
    context: '[助手] 先补测试还是先改实现？',
  });

  assert.equal(truncatedReading.state, 'unevaluated');
  if (truncatedReading.state !== 'unevaluated') return;
  assert.match(truncatedReading.reason, /模型输出.*JSON/, 'the reason is a readable diagnosis');
  assert.equal(truncatedReading.reason.includes('原始输出'), false, 'the raw output stays out of the card');
  assert.equal(logs.length, 1, 'one debug line names the failure');
  assert.match(logs[0] ?? '', /原始输出头部=/);
  assert.match(logs[0] ?? '', /先补测试还是先改实现/, 'the head of the raw output is logged');
});

test('assistantQuoteOf keeps the question paragraph and caps the quote', () => {
  assert.equal(
    assistantQuoteOf('先说背景。\n\n是否要重启服务？重启会中断当前会话。'),
    '是否要重启服务？重启会中断当前会话。',
  );
  assert.equal(assistantQuoteOf('没有问句的一段。'), '没有问句的一段。');
  assert.equal(assistantQuoteOf(''), null);
  const long = `${'很长的段落'.repeat(100)}？`;
  assert.ok((assistantQuoteOf(long) ?? '').length <= 201, 'the quote is capped');
});

// ---------------------------------------------------------------------------------------------
// The per-ask history: a card reads ITS OWN ask, never the session's latest slot
// ---------------------------------------------------------------------------------------------

test('per-ask history: every ask keeps its own decision, a card reads it by message id, and the retention drops the oldest', async () => {
  const { store, objects } = createMemoryStore();
  // One model answer per asking turn, numbered by call order: each ask must keep ITS OWN labels,
  // so the assertion "A's labels are not B's" has a fixture that can actually disagree.
  let call = 0;
  const harness = createHarness(() => {
    call += 1;
    const n = call;
    return JSON.stringify({
      ask: `第 ${n} 问的复述：要继续吗？`,
      situation: `第 ${n} 问的情境。`,
      incomplete: false,
      recommendedOptionId: null,
      options: [
        { id: `opt-${n}-a`, label: `选项 ${n}A`, does: `第 ${n} 问的第一个做法。`, tags: [], source: 'assistant' },
        { id: `opt-${n}-b`, label: `选项 ${n}B`, does: `第 ${n} 问的第二个做法。`, tags: [], source: 'assistant' },
      ],
    });
  }, { objects });

  const turns: Turn[] = [];
  const askTurn = (n: number): Turn[] => [
    { role: 'user', id: `u${n}`, text: `第 ${n} 轮开始` },
    { role: 'assistant', id: `a${n}`, text: `第 ${n} 问：要继续吗？` },
  ];

  for (let n = 1; n <= 2; n += 1) {
    turns.push(...askTurn(n));
    harness.setTranscript(transcript(turns));
    await harness.turnEnd();
  }

  // The digest now carries BOTH asks, keyed by their own askIds, with the message index a card's
  // `contentRef.messageId` resolves through.
  const digest = objects.get(formatSessionUri(SESSION_ID))?.digest;
  const decisions = (digest?.askDecisions ?? {}) as Record<string, SessionAskDecisionReading>;
  const messages = (digest?.askDecisionMessages ?? {}) as Record<string, string>;
  assert.deepEqual(Object.keys(decisions), [`${SESSION_ID}:a1`, `${SESSION_ID}:a2`]);
  assert.equal(messages['a1'], `${SESSION_ID}:a1`);
  assert.equal(messages['a2'], `${SESSION_ID}:a2`);
  // The legacy slot still names the LATEST ask; the cards never read it.
  const slotReading = digest?.askDecision as SessionAskDecisionReading | undefined;
  assert.equal(
    slotReading?.state === 'evaluated' ? slotReading.askId : '',
    `${SESSION_ID}:a2`,
  );

  // A card reads its own ask by the message it names. A is A's labels, B is B's — never each
  // other's, and never the session slot's.
  const reader = readerOver(store);
  const readingA = reader.read(SESSION_ID, 'a1');
  const readingB = reader.read(SESSION_ID, 'a2');
  const labelsOf = (reading: SessionAskDecisionReading | null): string[] =>
    reading?.state === 'evaluated' ? reading.options.map((option) => option.label) : [];
  assert.equal(readingA?.state, 'evaluated', 'the older ask is readable on its own');
  assert.equal(readingB?.state, 'evaluated');
  assert.deepEqual(labelsOf(readingA), ['选项 1A', '选项 1B'], 'A reads A’s own decision');
  assert.deepEqual(labelsOf(readingB), ['选项 2A', '选项 2B'], 'B reads B’s own decision');
  assert.notDeepEqual(labelsOf(readingA), labelsOf(readingB), 'the two cards cannot share one reading');

  // Eleven asks: the history is bounded at ten, and the OLDEST is the one dropped.
  for (let n = 3; n <= 11; n += 1) {
    turns.push(...askTurn(n));
    harness.setTranscript(transcript(turns));
    await harness.turnEnd();
  }
  const after = objects.get(formatSessionUri(SESSION_ID))?.digest;
  const kept = (after?.askDecisions ?? {}) as Record<string, SessionAskDecisionReading>;
  const keptMessages = (after?.askDecisionMessages ?? {}) as Record<string, string>;
  assert.equal(Object.keys(kept).length, SESSION_ASK_DECISION_HISTORY_LIMIT);
  assert.equal(kept[`${SESSION_ID}:a1`], undefined, 'the 11th-oldest ask is dropped');
  assert.equal(kept[`${SESSION_ID}:a2`]?.state, 'evaluated', 'the next-oldest ask survives');
  assert.equal(kept[`${SESSION_ID}:a11`]?.state, 'evaluated', 'the newest ask is present');
  assert.equal(keptMessages['a1'], undefined, 'the dropped ask’s message index goes with it');
  assert.equal(keptMessages['a11'], `${SESSION_ID}:a11`);
});
