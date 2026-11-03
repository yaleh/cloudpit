/**
 * The judge-supplied default of a session-ask card (AC-434).
 *
 * THE RULE. Every session-ask card has a default option. The assistant's own recommendation wins
 * when its text carries one (`source: 'assistant'`, ●). When it does not, the SAME summarising
 * call's judge picks the most likely option and states one line of why (`source: 'judge'`, ○,
 * with `why`). Only an `incomplete` digest has no default. The judge never overrides the
 * assistant and never labels its pick as the assistant's.
 *
 * This criterion drives the pure digest with a stubbed LLM client (so the call count is
 * observable) and the read-time repair over a memory store for a digest evaluated under the old
 * "no recommendation, no default" rule.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/observation/tests/session-ask-judge-default.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { LlmCompletion, LlmCompletionRequest } from '@/modules/llm-gateway/index.js';
import type { SessionAskDecisionReading } from '@/shared/types.js';

import {
  formatSessionUri,
  type ObservedObject,
  type ObservationStore,
  type SessionDigestLlmSettings,
} from '../core/index.js';
import {
  createSessionAskDecisionDigest,
  stableOptionId,
  createSessionAskDecisionReader,
} from '../session-ask/index.js';

const CLOCK = 1_800_000_000_000;
const SESSION_ID = 'judge-session';
const ASK_ID = `${SESSION_ID}:a1`;

/** Tier settings that are switched on but reach only the stub completion. */
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

function completion(text: string): LlmCompletion {
  return { text, inputTokens: 100, outputTokens: 20 };
}

type SummaryInput = Parameters<ReturnType<typeof createSessionAskDecisionDigest>['summarize']>[0];

/**
 * Runs one summarising call against a fixed model answer and returns both the reading and the
 * number of LLM calls the digest made — the criterion for "the judge is not a second call".
 */
async function summarize(
  answer: string,
  overrides: Partial<SummaryInput> = {},
): Promise<{ reading: SessionAskDecisionReading; calls: number; requests: LlmCompletionRequest[] }> {
  const requests: LlmCompletionRequest[] = [];
  const summariser = createSessionAskDecisionDigest({
    readSettings: () => STUB_SETTINGS,
    complete: async (request) => {
      requests.push(request);
      return completion(answer);
    },
  });
  const reading = await summariser.summarize({
    sessionId: SESSION_ID,
    sessionTitle: '会话：二选一',
    askId: ASK_ID,
    revision: 1,
    assistantText: '你可以选：\n1. 方案 A\n2. 方案 B',
    context: '[用户] 给我两个选择\n\n[助手] 你可以选：\n1. 方案 A\n2. 方案 B',
    ...overrides,
  });
  return { reading, calls: requests.length, requests };
}

/** The model answer for a two-option question with a judge pick and no assistant cue. */
const JUDGE_ANSWER = {
  ask: '方案 A 和方案 B，你想选哪一个？',
  situation: '两个方案二选一。',
  incomplete: false,
  recommendedOptionId: null,
  judgeOptionId: 'b',
  judgeReason: '方案 B 与对话里刚验证过的做法一致。',
  options: [
    { id: 'a', label: '方案 A', does: '走方案 A', tags: [], source: 'assistant' },
    { id: 'b', label: '方案 B', does: '走方案 B', tags: [], source: 'assistant' },
  ],
};

function suggestedOf(reading: SessionAskDecisionReading | null): Array<{
  id: string;
  source: string;
  why?: string;
}> {
  assert.ok(reading !== null, 'the reading must exist');
  assert.equal(reading.state, 'evaluated');
  if (reading.state !== 'evaluated') return [];
  return reading.options
    .filter((option) => option.suggested)
    .map((option) => ({ id: option.id, source: option.source, ...(option.why === undefined ? {} : { why: option.why }) }));
}

// ---------------------------------------------------------------------------------------------
// The digest: priority, source and call count
// ---------------------------------------------------------------------------------------------

test('AC-434: an assistant recommendation is the one suggested option, sourced from the assistant', async () => {
  const answer = {
    ...JUDGE_ANSWER,
    recommendedOptionId: 'a',
    judgeOptionId: 'b',
    judgeReason: '判官也选了 B，但不能覆盖助手。',
  };
  const assistantText = '有两个方案：1. 方案 A 2. 方案 B。我建议选方案 A。';
  const { reading, calls } = await summarize(JSON.stringify(answer), { assistantText });

  assert.equal(calls, 1, 'one summary is one call, judge included');
  const suggested = suggestedOf(reading);
  assert.equal(suggested.length, 1, 'exactly one default');
  assert.deepEqual(
    suggested[0],
    { id: stableOptionId('方案 A'), source: 'assistant' },
    'the judge does not override the assistant',
  );
  assert.equal(suggested.some((option) => option.source === 'judge'), false, 'the judge never labels its pick as the assistant’s');
});

test('AC-434: with no assistant recommendation the judge supplies one, with a reason, in the same call', async () => {
  const { reading, calls } = await summarize(JSON.stringify(JUDGE_ANSWER));
  const suggested = suggestedOf(reading);

  assert.equal(calls, 1, 'the judge is a field pair in the SAME answer, never a second call');
  assert.equal(suggested.length, 1, 'exactly one default');
  assert.equal(suggested[0]?.id, stableOptionId('方案 B'));
  assert.equal(suggested[0]?.source, 'judge', 'the judge’s pick is sourced as the judge, not the assistant');
  assert.equal(suggested[0]?.why, JUDGE_ANSWER.judgeReason);
  assert.ok((suggested[0]?.why ?? '').trim() !== '', 'the judge states a reason');
});

test('AC-434: a yes/no question with no recommendation gets the judge’s 是/否 pick', async () => {
  const answer = {
    ask: '是否要发送 browser_close 释放浏览器 profile？',
    situation: 'MCP 浏览器 profile 仍被占用。',
    incomplete: false,
    recommendedOptionId: null,
    judgeOptionId: 'no',
    judgeReason: '对话里还要继续用浏览器，先不释放。',
    options: [],
  };
  const { reading, calls } = await summarize(JSON.stringify(answer), {
    assistantText: '是否要发送 browser_close 释放浏览器 profile？',
    context: '[助手] 是否要发送 browser_close 释放浏览器 profile？',
  });

  assert.equal(calls, 1);
  assert.equal(reading.state, 'evaluated');
  if (reading.state !== 'evaluated') return;
  assert.deepEqual(
    reading.options.map((option) => ({ id: option.id, label: option.label, suggested: option.suggested, source: option.source })),
    [
      { id: stableOptionId('是'), label: '是', suggested: false, source: 'assistant' },
      { id: stableOptionId('否'), label: '否', suggested: true, source: 'judge' },
    ],
  );
  assert.equal(
    reading.options.find((option) => option.id === stableOptionId('否'))?.why,
    answer.judgeReason,
  );
});

test('AC-434: an incomplete digest has no default, even when the model offers a judge pick', async () => {
  const answer = { ...JUDGE_ANSWER, incomplete: true };
  const { reading } = await summarize(JSON.stringify(answer));

  assert.equal(reading.state, 'evaluated');
  if (reading.state !== 'evaluated') return;
  assert.equal(reading.incomplete, true);
  assert.deepEqual(suggestedOf(reading), [], 'an incomplete digest never claims a default');
});

test('AC-434: a judge pick without a reason is not a judge and leaves the card without a default', async () => {
  const answer = { ...JUDGE_ANSWER, judgeReason: null };
  const { reading, calls } = await summarize(JSON.stringify(answer));

  assert.equal(calls, 1);
  assert.deepEqual(suggestedOf(reading), [], 'a pick the card cannot explain is not shown as the default');
});

// ---------------------------------------------------------------------------------------------
// The read-time repair of a digest stored under the old rule
// ---------------------------------------------------------------------------------------------

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

/** The ask transcript the stale reading belongs to. */
const ASK_TRANSCRIPT = transcript([
  { role: 'user', id: 'u1', text: '给我两个选择' },
  { role: 'assistant', id: 'a1', text: '你可以选：\n1. 方案 A\n2. 方案 B' },
]);

/** An `evaluated` reading stored before the judge could supply a default: no suggested option. */
function seedNoDefault(store: ObservationStore): void {
  store.writeRevision({
    uri: formatSessionUri(SESSION_ID),
    kind: 'session',
    title: '会话：二选一',
    status: { state: 'attention', reason: '本轮以提问结束，等你回复' },
    digest: {
      activity: 'waiting',
      askDecision: {
        state: 'evaluated',
        inputTokens: 100,
        outputTokens: 20,
        askId: ASK_ID,
        revision: 1,
        ask: '方案 A 和方案 B，你想选哪一个？',
        situation: '两个方案二选一。',
        incomplete: false,
        options: [
          { id: 'a', label: '方案 A', does: '走方案 A', tags: [], suggested: false, source: 'assistant' },
          { id: 'b', label: '方案 B', does: '走方案 B', tags: [], suggested: false, source: 'assistant' },
        ],
      },
    },
    provenance: { producer: 'session-digest', tier: 'llm', evaluatedAt: CLOCK },
  });
}

test('AC-434: a stored digest with no default is recomputed once on read, then never again', async () => {
  const { store, objects } = createMemoryStore();
  seedNoDefault(store);
  const requests: LlmCompletionRequest[] = [];
  const reader = createSessionAskDecisionReader({
    store,
    readSettings: () => STUB_SETTINGS,
    summarize: createSessionAskDecisionDigest({
      readSettings: () => STUB_SETTINGS,
      complete: async (request) => {
        requests.push(request);
        return completion(JSON.stringify(JUDGE_ANSWER));
      },
    }),
    resolveSession: () => ({ title: '会话：二选一', jsonlPath: '/tmp/judge.jsonl' }),
    readTranscript: async () => ASK_TRANSCRIPT,
    now: () => CLOCK,
  });

  // The first read still answers the stored reading; the repair runs in the background.
  const first = reader.read(SESSION_ID, 'a1');
  assert.equal(first?.state, 'evaluated');
  assert.deepEqual(suggestedOf(first), [], 'the first frame shows the stored, default-less reading');
  await reader.settled();

  const repaired = reader.read(SESSION_ID, 'a1');
  assert.deepEqual(
    suggestedOf(repaired).map((option) => [option.id, option.source]),
    [[stableOptionId('方案 B'), 'judge']],
    'the repaired reading carries the judge default',
  );
  assert.equal(requests.length, 1, 'the repair makes exactly one model call');

  const stored = objects.get(formatSessionUri(SESSION_ID))?.digest.askDecision as SessionAskDecisionReading;
  assert.deepEqual(suggestedOf(stored).map((option) => option.source), ['judge'], 'the result is written back');

  await reader.settled();
  assert.equal(requests.length, 1, 'the second read does not call the model again');
  assert.deepEqual(suggestedOf(reader.read(SESSION_ID, 'a1')).map((option) => option.source), ['judge']);
});
