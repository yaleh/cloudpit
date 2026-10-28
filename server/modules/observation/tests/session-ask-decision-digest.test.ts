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
  type SessionAskDecisionDigest,
} from '../session-ask-decision-digest.js';
import {
  createSessionAskDecisionReader,
  SESSION_ASK_DECISION_ASK_MISSING_REASON,
  SESSION_ASK_DECISION_LIMIT_REASON,
  SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON,
} from '../session-ask-decision-reader.js';
import { createSessionDigestProducer } from '../session-digest.producer.js';
import { createSessionDigestLlmSettingsSource, type SessionDigestLlmSettings } from '../session-digest-llm-settings.js';

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
    summarizeAsk,
    eventWriter,
    ...(options.listObservedSessionIds === undefined
      ? {}
      : { listObservedSessionIds: options.listObservedSessionIds }),
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
  assert.equal(suggested[0]?.id, 'b', 'the assistant cue was absent, so the judge pick is the default');
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
    claudeProjectsRoot?: string;
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
    ...(options.claudeProjectsRoot === undefined
      ? {}
      : { claudeProjectsRoot: options.claudeProjectsRoot }),
    now: () => CLOCK,
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
  const reader = readerOver(store, {
    resolveSession: () => ({ title: '会话：浏览器 profile', jsonlPath: '/tmp/ask.jsonl' }),
    readTranscript: async () => statement,
  });

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
      { id: 'yes', label: '是', suggested: true },
      { id: 'no', label: '否', suggested: false },
    ],
    'the two synthesized options are 是/否, and the judge picks one of them',
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
  const yes = reading.options.find((option) => option.id === 'yes');
  const no = reading.options.find((option) => option.id === 'no');
  assert.equal(yes?.suggested, true);
  assert.equal(yes?.source, 'assistant');
  assert.equal(no?.suggested, false);
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

  assert.deepEqual(summary, { sessions: 2, answered: 1 }, 'two sessions still had an open ask; one answer was stated');
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
  assert.deepEqual(again, { sessions: 1, answered: 0 });
  assert.equal(events.filter((event) => event.kind === 'session.answered').length, 1, 'no answer is stated twice');
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
