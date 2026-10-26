/**
 * The T1 ask decision digest and its two events (AC-423).
 *
 * The fixture transcripts cover the five shapes the criterion names:
 *   · an assistant that recommends one option;
 *   · an assistant that recommends nothing (the model's suggestion is normalised away);
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
import test from 'node:test';

import type { LlmCompletion, LlmCompletionRequest } from '@/modules/llm-gateway/index.js';
import type { ISessionAskEventWriter } from '@/shared/interfaces.js';
import type { SessionAskDecisionReading, SessionAskEvent } from '@/shared/types.js';

import type { ObservedObject, ObservationStore } from '../observation-store.js';
import { createSessionAskDecisionDigest, readSessionAsk } from '../session-ask-decision-digest.js';
import { createSessionDigestProducer } from '../session-digest.producer.js';
import type { SessionDigestLlmSettings } from '../session-digest-llm-settings.js';

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
};

/** Builds a producer whose world is entirely in memory. */
function createHarness(answer: string | ((request: LlmCompletionRequest) => string)): Harness {
  let raw = '';
  const writes: ObservedObject[] = [];
  const events: SessionAskEvent[] = [];
  const requests: LlmCompletionRequest[] = [];
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
    summarizeAsk,
    eventWriter,
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
    { role: 'assistant', id: 'a1', text: '有两个方案：\n1. 方案 A：先补测试\n2. 方案 B：先改实现\n\n我建议选方案 B，因为它能先锁住行为。' },
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
  assert.equal(suggested[0]?.id, 'b');
  assert.equal(suggested[0]?.source, 'assistant');
  assert.equal(reading.options.find((option) => option.id === 'a')?.suggested, false);
  assert.deepEqual(suggested[0]?.tags, [{ kind: 'consequence', text: '更快看到修复' }]);
});

test('AC-423: no recommendation cue in the original means no option is suggested', async () => {
  const raw = transcript([
    { role: 'user', id: 'u1', text: '给我两个选择' },
    { role: 'assistant', id: 'a1', text: '你可以选：\n1. 方案 A\n2. 方案 B' },
  ]);
  // The model TRIES to recommend A; the original text does not, so the rule must clear it.
  const answer = {
    ask: '方案 A 和方案 B，你想选哪一个？',
    situation: '两个方案二选一。',
    incomplete: false,
    recommendedOptionId: 'a',
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
  assert.deepEqual(
    reading.options.map((option) => option.suggested),
    [false, false],
    'no cue in the assistant text means nothing may be suggested',
  );
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
      { role: 'assistant', id: 'a1', text: '有两个方案：\n1. 方案 A\n2. 方案 B\n\n我建议选方案 B。' },
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
    contentRef: { resolver: 'cloudcli.session-ask', sessionId: SESSION_ID, messageId: 'a1' },
  });

  harness.setTranscript(
    transcript([
      { role: 'user', id: 'u1', text: '你选一个方案' },
      { role: 'assistant', id: 'a1', text: '有两个方案：\n1. 方案 A\n2. 方案 B\n\n我建议选方案 B。' },
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
