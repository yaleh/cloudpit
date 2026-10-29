/**
 * The ask SEMANTIC GATE: mechanical prefilter → T1 summary verdict → event/object.
 *
 * The two live shapes this criterion exists for:
 *   · 62d959c0 / 3818a9e5 — a three-part review whose decision ("先拆 observation producer 的
 *     ask ledger 和恢复/sweep") sits in a MIDDLE paragraph and whose last paragraph is a note
 *     ("本轮没有运行测试；以上是只读审查"). The prefilter must surface it and the summary's `ask`
 *     must point at the middle decision.
 *   · 5b984a5f / fea61be5 — long reports with a numbered list and a final statement. They pass
 *     the prefilter (which is allowed to be wide) and the summary answers `isAsking:false`, so no
 *     `session.asking` event and no observation object are written.
 *
 * The model is stubbed; the store and the event writer are in memory.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/observation/tests/session-ask-semantic-gate.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { ISessionAskEventWriter } from '@/shared/interfaces.js';
import type { SessionAskDecisionReading, SessionAskEvent } from '@/shared/types.js';

import type { ObservedObject, ObservationStore } from '../observation-store.js';
import {
  prefilterAssistantAsk,
  type AskPrefilterReading,
} from '../session-digest.js';
import {
  SESSION_ASK_NOT_ASKING_REASON,
  type SessionAskDecisionDigest,
} from '../session-ask-decision-digest.js';
import { createSessionDigestProducer } from '../session-digest.producer.js';

const CLOCK = 1_800_000_100_000;
const SESSION_ID = 'semantic-gate-session';
const PROJECT_PATH = '/repo/project';

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

/** 62d959c0's shape: the pending decision is the middle numbered list; the tail is a note. */
const MIDDLE_DECISION_TEXT = [
  '审查完成。现状：producer 只在 turn-end 写 ledger，恢复时没有 ask 的落账路径。',
  '',
  '值得优先讨论的下一步：',
  '1. 先拆 observation producer 的 ask ledger',
  '2. 再做恢复/sweep',
  '3. 最后补 UI',
  '',
  '本轮没有运行测试；以上是只读审查。',
].join('\n');

/** 5b984a5f's shape: a long report whose numbered list and final paragraph are statements. */
const LONG_REPORT_TEXT = [
  '我复核了整条链路，下面是发现：',
  Array.from({ length: 6 }, (_, index) => `${index + 1}. 第${index + 1}项检查已完成`).join('\n'),
  '要的话我可以把 P0 的三条拆成 quay 任务，之后再一起看。',
].join('\n\n');

const MIDDLE_DECISION_ASK = '是否先拆 observation producer 的 ask ledger，再做恢复/sweep，最后补 UI？';

/** A summary stub that answers one fixed reading and records its calls. */
function stubSummary(
  reading: SessionAskDecisionReading | (() => Promise<SessionAskDecisionReading>),
): { digest: SessionAskDecisionDigest; calls: () => number; inputs: Array<{ assistantText: string }> } {
  let calls = 0;
  const inputs: Array<{ assistantText: string }> = [];
  return {
    digest: {
      async summarize(input) {
        calls += 1;
        inputs.push(input);
        return typeof reading === 'function' ? reading() : reading;
      },
    },
    calls: () => calls,
    inputs,
  };
}

/** The evaluated reading the summary returns when it judges the message to be a question. */
function evaluated(ask: string): SessionAskDecisionReading {
  return {
    state: 'evaluated',
    isAsking: true,
    askId: `${SESSION_ID}:a1`,
    revision: 1,
    ask,
    situation: '正在决定检索与恢复链路的下一步。',
    options: [
      { id: 'opt-a', label: '先拆 ledger', does: '先拆 ledger，再恢复。', tags: [], suggested: false, source: 'assistant' },
      { id: 'opt-b', label: '先做 sweep', does: '先做 sweep，再拆 ledger。', tags: [], suggested: false, source: 'assistant' },
    ],
    incomplete: false,
    inputTokens: 10,
    outputTokens: 5,
  };
}

type Harness = {
  writes: ObservedObject[];
  events: SessionAskEvent[];
  turnEnd: () => ReturnType<ReturnType<typeof createSessionDigestProducer>['handleTurnEnd']>;
};

/** A producer over an in-memory store and event writer; `summarizeAsk` absent means no tier. */
function harness(
  assistantText: string,
  summarizeAsk?: SessionAskDecisionDigest,
  options: { observed?: boolean } = {},
): Harness {
  const objects = new Map<string, ObservedObject>();
  const writes: ObservedObject[] = [];
  const events: SessionAskEvent[] = [];
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
  const raw = transcript([
    { role: 'user', id: 'u1', text: '开始审查' },
    { role: 'assistant', id: 'a1', text: assistantText },
  ]);
  const producer = createSessionDigestProducer({
    store,
    resolveSession: () => ({ title: '会话：审查', projectPath: PROJECT_PATH, jsonlPath: '/tmp/gate.jsonl' }),
    readTranscript: async () => raw,
    isObserved: () => options.observed ?? true,
    now: () => CLOCK,
    eventWriter,
    ...(summarizeAsk === undefined ? {} : { summarizeAsk }),
  });
  return {
    writes,
    events,
    turnEnd: () =>
      producer.handleTurnEnd({
        appSessionId: SESSION_ID,
        runId: 'run-1',
        status: 'completed',
        completedAt: CLOCK,
        error: null,
      }),
  };
}

function askingEvents(events: SessionAskEvent[]): SessionAskEvent[] {
  return events.filter((event) => event.kind === 'session.asking');
}

// ---------------------------------------------------------------------------------------------
// AC1 — the prefilter itself (candidate only, never a verdict)
// ---------------------------------------------------------------------------------------------

test('AC: the prefilter is wide but a pure statement does not pass it', () => {
  const middle: AskPrefilterReading = prefilterAssistantAsk(MIDDLE_DECISION_TEXT);
  assert.equal(middle.candidate, true, '62d 的中段决策（值得优先 + 编号行）进入候选');
  assert.ok(middle.markers.includes('priority-phrase'));
  assert.ok(middle.markers.includes('numbered-run'));

  const report = prefilterAssistantAsk(LONG_REPORT_TEXT);
  assert.equal(report.candidate, true, '5b 长报告的编号列表也进入候选，交由摘要判否');
  assert.ok(report.markers.includes('numbered-run'));

  assert.equal(prefilterAssistantAsk('前面做了很多。\n\n要不要现在改？').candidate, true);
  const statement = prefilterAssistantAsk('改动已经完成，测试全绿。');
  assert.equal(statement.candidate, false);
  assert.deepEqual(statement.markers, []);
});

// ---------------------------------------------------------------------------------------------
// AC1/AC2 — the summary verdict gates the event and the object
// ---------------------------------------------------------------------------------------------

test('AC: 62d-style middle decision → prefilter passes, summary offers an ask, the event states it', async () => {
  const stub = stubSummary(evaluated(MIDDLE_DECISION_ASK));
  const { writes, events, turnEnd } = harness(MIDDLE_DECISION_TEXT, stub.digest);

  const written = await turnEnd();

  assert.equal(stub.calls(), 1, 'the candidate reaches the summary');
  assert.match(stub.inputs[0]?.assistantText ?? '', /值得优先讨论的下一步/, 'the summary sees the WHOLE message');
  const asking = askingEvents(events);
  assert.equal(asking.length, 1, 'a confirmed ask states session.asking');
  const decision = written?.digest.askDecision as SessionAskDecisionReading | undefined;
  assert.equal(decision?.state, 'evaluated');
  if (decision === undefined || decision.state !== 'evaluated') return;
  assert.equal(decision.isAsking, true);
  assert.match(decision.ask, /observation producer 的 ask ledger/, 'the ask points at the MIDDLE decision');
  assert.equal(written?.status.state, 'attention');
  assert.ok(writes.length >= 1);
});

test('AC: 5b/fea long report → prefilter passes, summary answers isAsking=false, nothing is written', async () => {
  const stub = stubSummary({
    state: 'unevaluated',
    isAsking: false,
    reason: SESSION_ASK_NOT_ASKING_REASON,
  });
  const { writes, events, turnEnd } = harness(LONG_REPORT_TEXT, stub.digest);

  const written = await turnEnd();

  assert.equal(stub.calls(), 1, 'a mechanically-wide candidate is still sent to the summary');
  assert.equal(written, null);
  assert.deepEqual(events, [], 'a non-ask produces no event');
  assert.deepEqual(writes, [], 'a non-ask produces no observation object');
});

test('AC: a trailing question is a candidate and the summary confirms it', async () => {
  const stub = stubSummary(evaluated('要不要现在改？'));
  const { events, turnEnd } = harness('前面做了很多。\n\n要不要现在改？', stub.digest);

  await turnEnd();

  assert.equal(stub.calls(), 1);
  assert.equal(askingEvents(events).length, 1);
});

test('AC: a pure statement never reaches the summary and states no asking event', async () => {
  const stub = stubSummary(evaluated('不该出现的问题？'));
  const { events, writes, turnEnd } = harness('改动已经完成，测试全绿。', stub.digest);

  await turnEnd();

  assert.equal(stub.calls(), 0, 'the prefilter keeps a marker-less statement away from the model');
  assert.deepEqual(askingEvents(events), []);
  // The turn itself is still an ordinary observed digest; only the ask is absent.
  assert.equal(writes.length, 1);
  const first = writes[0];
  assert.ok(first !== undefined);
  assert.equal((first.digest as Record<string, unknown>).askDecision, undefined);
});

// ---------------------------------------------------------------------------------------------
// AC2 — the fallback when the summary is unavailable, and its visible reason
// ---------------------------------------------------------------------------------------------

test('AC: a failed summary falls back to the candidate and states the failure on the object', async () => {
  const stub = stubSummary(async () => {
    throw new Error('gateway 502');
  });
  const { events, writes, turnEnd } = harness(MIDDLE_DECISION_TEXT, stub.digest);

  const written = await turnEnd();

  assert.equal(askingEvents(events).length, 1, 'the candidate is not silently dropped');
  const decision = written?.digest.askDecision as SessionAskDecisionReading | undefined;
  assert.equal(decision?.state, 'unevaluated');
  assert.equal(decision?.isAsking, undefined, 'a failure is not a semantic false verdict');
  assert.match(decision?.state === 'unevaluated' ? decision.reason : '', /提问摘要生成失败/);
  assert.ok(writes.length >= 1);
  assert.equal(written?.status.state, 'attention');
});

test('AC: a disabled tier falls back to the candidate with 「未启用」 visible, not silence', async () => {
  const stub = stubSummary({
    state: 'skipped',
    reason: '未启用 observation.sessionDigest（提问决策摘要）',
  });
  const { events, writes, turnEnd } = harness(MIDDLE_DECISION_TEXT, stub.digest);

  const written = await turnEnd();

  assert.equal(askingEvents(events).length, 1, 'disabled tier: candidate stays visible');
  const decision = written?.digest.askDecision as SessionAskDecisionReading | undefined;
  assert.equal(decision?.state, 'skipped');
  assert.equal(decision?.isAsking, undefined);
  assert.match(decision?.state === 'skipped' ? decision.reason : '', /未启用/);
  assert.ok(writes.length >= 1);
});

test('AC: with no summariser at all the deterministic revision carries the visible fallback', async () => {
  const { events, writes, turnEnd } = harness(MIDDLE_DECISION_TEXT);

  const written = await turnEnd();

  assert.equal(askingEvents(events).length, 1);
  assert.equal(writes.length, 1, 'a build without the tier keeps one write per turn');
  const decision = written?.digest.askDecision as SessionAskDecisionReading | undefined;
  assert.equal(decision?.state, 'skipped');
  assert.match(decision?.state === 'skipped' ? decision.reason : '', /未启用 observation\.sessionDigest/);
});
