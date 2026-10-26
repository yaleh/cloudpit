/**
 * AC-427's criterion: the cockpit brief service's round loop, cache and two token ceilings.
 *
 * THE GATEWAY IS STUBBED. `complete` is the service's injected seam, so every case here is a
 * scripted sequence of answers with explicit token readings; no network, no key, no clock. The
 * cases map onto the acceptance criteria:
 *
 *   · a first-round pass is cached by (askId, revision): the second identical request does not
 *     reach the gateway again;
 *   · two rejected rounds then a pass returns the model brief on round three;
 *   · three rejected rounds return `defaultBrief` and keep every failure's rules and RAW text;
 *   · the per-brief cap stops a round whose CACHE-READ-INCLUSIVE total crosses it;
 *   · once the UTC day's ledger is at the cap, a new card falls back without a call;
 *   · the question is the last assistant message's text, not an `askingYou` excerpt.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/cockpit/tests/cockpit-brief.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createCockpitBriefService } from '@/modules/cockpit/cockpit-brief.service.js';
import type {
  CockpitBriefAsk,
  CockpitBriefComplete,
  CockpitBriefCompletionRequest,
} from '@/modules/cockpit/cockpit-brief.service.js';
import type { CockpitBriefSettings } from '@/modules/cockpit/cockpit-brief-settings.js';

/** One fixed instant, so "UTC day" is deterministic. */
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

/** The last assistant message — the only authoritative source for the question. */
const LAST_ASSISTANT = '要我把 staging 目录直接删掉吗？';

/** The digest's old `askingYou` excerpt. It names the PREVIOUS turn and must never be used. */
const DIGEST_EXCERPT = '你想先跑哪一组测试？';

const CONVERSATION = ['[用户] 整理一下临时目录', '', '[助手] 已经列过清单了。'].join('\n');

/** The shipped-shaped settings, overridden per case. */
function settings(overrides: Partial<CockpitBriefSettings> = {}): CockpitBriefSettings {
  return {
    enabled: true,
    perBriefTokenCap: 30_000,
    dailyTokenCap: 500_000,
    source: 'file',
    path: null,
    problems: [],
    ...overrides,
  };
}

/** A checker-passing document. A fresh object every call so a case can mutate its own copy. */
const goodBrief = (): Record<string, unknown> => ({
  v: 0,
  itemRef: 'cloudcli://session/sess-1#msg-9',
  headline: '要删除 staging 目录吗？',
  options: [
    {
      id: 'delete',
      label: '直接删除',
      does: '删除 staging 目录',
      consequence: [{ kind: 'irreversible', text: '删除后不可恢复' }],
    },
    {
      id: 'keep',
      label: '先保留',
      does: '移入备份区保留 7 天',
      consequence: [{ kind: 'reversible', text: '7 天内可以移回' }],
    },
  ],
  recommendation: { optionId: 'keep', why: ['目录里还有未提交的草稿'] },
  evidence: [],
  blocks: [],
});

/** A parseable document the checker rejects: no options at all. */
const badBrief = (): Record<string, unknown> => ({ ...goodBrief(), options: [] });

/** One scripted gateway answer. */
type Answer = {
  text: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadInputTokens?: number | null;
  cacheCreationInputTokens?: number | null;
};

/** What a test harness hands back. */
type Harness = {
  requests: CockpitBriefCompletionRequest[];
  briefFor: ReturnType<typeof createCockpitBriefService>['briefFor'];
  dispose: () => void;
};

/** Builds a service over a queue of answers and one ask reading. */
function harness(options: {
  answers: Answer[];
  settings?: CockpitBriefSettings;
  ask?: CockpitBriefAsk;
}): Harness {
  const requests: CockpitBriefCompletionRequest[] = [];
  const queue = [...options.answers];
  const complete: CockpitBriefComplete = async (request) => {
    requests.push(request);
    const next = queue.shift();
    if (next === undefined) throw new Error('the service made an unexpected gateway call');
    return {
      text: next.text,
      inputTokens: next.inputTokens ?? 10,
      outputTokens: next.outputTokens ?? 5,
      cacheReadInputTokens: next.cacheReadInputTokens,
      cacheCreationInputTokens: next.cacheCreationInputTokens,
    };
  };
  const ask: CockpitBriefAsk = options.ask ?? {
    current: { askId: 'sess-1:msg-9', messageId: 'msg-9', revision: 1, assistantText: LAST_ASSISTANT },
    context: CONVERSATION,
  };
  const service = createCockpitBriefService({
    readSettings: () => options.settings ?? settings(),
    readGateway: () => ({
      protocol: 'anthropic',
      baseUrl: 'http://gateway.invalid',
      model: 'test-model',
      authScheme: 'x-api-key',
      apiKey: 'test-key-not-printed',
      disableThinking: true,
      timeoutMs: 1000,
      temperature: 0,
      maxOutputTokens: 4000,
    }),
    readAsk: () => ask,
    resolveSession: () => ({ jsonlPath: '/tmp/session.jsonl' }),
    readTranscript: () => 'transcript rows',
    complete,
    now: () => NOW,
  });
  return { requests, briefFor: (input) => service.briefFor(input), dispose: () => service.dispose() };
}

test('a first-round pass is cached by askId + revision', async () => {
  const h = harness({ answers: [{ text: JSON.stringify(goodBrief()) }] });
  const first = await h.briefFor({ cardId: 'card-1', sessionId: 'sess-1' });
  assert.equal(first.status, 'generated');
  assert.equal(first.rounds, 1);
  assert.equal(first.failures.length, 0);
  assert.equal(first.cached, false);
  assert.equal(h.requests.length, 1);

  const second = await h.briefFor({ cardId: 'card-1', sessionId: 'sess-1' });
  assert.equal(second.status, 'generated');
  assert.equal(second.cached, true);
  assert.equal(h.requests.length, 1, 'the second read of the same ask must not reach the gateway');
  h.dispose();
});

test('two rejected rounds then a pass lands on round three', async () => {
  const h = harness({
    answers: [
      { text: 'I think the answer is yes.' },
      { text: JSON.stringify(badBrief()) },
      { text: JSON.stringify(goodBrief()) },
    ],
  });
  const result = await h.briefFor({ cardId: 'card-1', sessionId: 'sess-1' });
  assert.equal(result.status, 'generated');
  assert.equal(result.rounds, 3);
  assert.equal(result.failures.length, 2);
  assert.deepEqual(result.failures[0]?.rules, ['unparseable-json']);
  assert.ok(result.failures[1]?.rules.includes('option-count'));
  assert.equal(h.requests.length, 3);
  // The repair turn carries the previous raw answer and the checker's errors.
  assert.ok(h.requests[1]?.user.includes('I think the answer is yes.'));
  h.dispose();
});

test('three rejected rounds fall back to the default brief and keep raw output', async () => {
  const h = harness({
    answers: [
      { text: 'not json at all' },
      { text: JSON.stringify(badBrief()) },
      { text: JSON.stringify(badBrief()) },
    ],
  });
  const result = await h.briefFor({ cardId: 'card-1', sessionId: 'sess-1' });
  assert.equal(result.status, 'fallback');
  assert.equal(result.reason, 'check-failed-after-3-rounds');
  assert.equal(result.rounds, 3);
  assert.equal(result.failures.length, 3);
  assert.equal(result.failures[0]?.raw, 'not json at all', 'the unparseable answer must be kept verbatim');
  assert.deepEqual(result.failures[0]?.rules, ['unparseable-json']);
  assert.ok(result.failures[2]?.rules.includes('option-count'));
  assert.equal(result.brief.fallback, true);
  assert.equal(h.requests.length, 3);
  h.dispose();
});

test('the per-brief cap counts cache reads and stops the brief', async () => {
  const h = harness({
    // 30 + 20 + 60 cache-read = 110, over a 100-token brief. Excluding the cache class would
    // leave 50 and wrongly let this pass — the criterion reds if the sum stops counting it.
    answers: [{ text: JSON.stringify(goodBrief()), inputTokens: 30, outputTokens: 20, cacheReadInputTokens: 60 }],
    settings: settings({ perBriefTokenCap: 100 }),
  });
  const result = await h.briefFor({ cardId: 'card-1', sessionId: 'sess-1' });
  assert.equal(result.status, 'fallback');
  assert.equal(result.reason, 'per-brief-token-cap-reached');
  assert.equal(result.tokens.total, 110);
  assert.equal(result.tokens.cacheRead, 60);
  assert.equal(result.brief.fallback, true);
  assert.equal(h.requests.length, 1);
  h.dispose();
});

test('once the day ledger reaches the cap, a new card falls back without calling the gateway', async () => {
  const asks: CockpitBriefAsk[] = [
    {
      current: { askId: 'sess-1:msg-1', messageId: 'msg-1', revision: 1, assistantText: LAST_ASSISTANT },
      context: CONVERSATION,
    },
    {
      current: { askId: 'sess-1:msg-2', messageId: 'msg-2', revision: 1, assistantText: LAST_ASSISTANT },
      context: CONVERSATION,
    },
  ];
  let askIndex = 0;
  const requests: CockpitBriefCompletionRequest[] = [];
  const service = createCockpitBriefService({
    readSettings: () => settings({ dailyTokenCap: 100, perBriefTokenCap: 1_000_000 }),
    readGateway: () => ({
      protocol: 'anthropic',
      baseUrl: 'http://gateway.invalid',
      model: 'test-model',
      authScheme: 'x-api-key',
      apiKey: 'test-key-not-printed',
      disableThinking: true,
      timeoutMs: 1000,
      temperature: 0,
      maxOutputTokens: 4000,
    }),
    readAsk: () => asks[Math.min(askIndex, asks.length - 1)] as CockpitBriefAsk,
    resolveSession: () => ({ jsonlPath: '/tmp/session.jsonl' }),
    readTranscript: () => 'transcript rows',
    complete: async (request) => {
      requests.push(request);
      return { text: JSON.stringify(goodBrief()), inputTokens: 120, outputTokens: 0 };
    },
    now: () => NOW,
  });

  const first = await service.briefFor({ cardId: 'card-1', sessionId: 'sess-1' });
  assert.equal(first.status, 'generated');
  assert.equal(first.tokens.total, 120);
  assert.equal(requests.length, 1);

  askIndex = 1;
  const second = await service.briefFor({ cardId: 'card-2', sessionId: 'sess-1' });
  assert.equal(second.status, 'fallback');
  assert.equal(second.reason, 'daily-token-cap-reached');
  assert.equal(second.tokens.total, 0);
  assert.equal(requests.length, 1, 'a card over the daily cap must not reach the gateway');
  service.dispose();
});

test('the question comes from the last assistant message, not the digest excerpt', async () => {
  // The extra `askingYou` field is the observation digest's old excerpt. The service's seam does
  // not read it; attaching it here makes "did the prompt use it?" observable.
  const ask = {
    current: { askId: 'sess-1:msg-9', messageId: 'msg-9', revision: 1, assistantText: LAST_ASSISTANT },
    context: CONVERSATION,
    askingYou: DIGEST_EXCERPT,
  } as CockpitBriefAsk;
  const h = harness({ answers: [{ text: JSON.stringify(goodBrief()) }], ask });

  const result = await h.briefFor({ cardId: 'card-1', sessionId: 'sess-1' });
  assert.equal(result.question, LAST_ASSISTANT);
  const prompt = h.requests[0]?.user ?? '';
  assert.ok(prompt.includes(LAST_ASSISTANT), 'the authoritative question must be in the prompt');
  assert.ok(!prompt.includes(DIGEST_EXCERPT), 'the digest excerpt must never reach the prompt');
  h.dispose();
});
