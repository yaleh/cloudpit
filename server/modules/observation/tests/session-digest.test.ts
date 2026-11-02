/**
 * The session-digest producer's criteria (AC1, AC2).
 *
 * AC1 — the deterministic reading, over the fixed transcript fixture:
 *   · edited files are deduplicated and keep first-touched order;
 *   · vitest / node --test / playwright summaries each yield pass/fail counts, and output none
 *     of them recognizes reads `unevaluated` with a reason;
 *   · a paragraph ending in a question, and one ending in numbered options, both read as
 *     「问你」; a statement does not;
 *   · the conclusion is the assistant's own final paragraph, truncated to ~280 characters and
 *     marked `tier: 'deterministic'`.
 *
 * AC2 — the write path:
 *   · one turn-end event writes exactly one revision, and the next event bumps it by one;
 *   · a session nobody watches that ends on a statement is not written at all;
 *   · an unreadable transcript writes `unevaluated` with a reason.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/observation/tests/session-digest.test.ts
 */
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  observationDb,
  sessionsDb,
} from '@/modules/database/index.js';
import type { SessionAskDecisionReading, SessionAskEvent } from '@/shared/types.js';

import type { OpenSessionAsk } from '../../context-events/index.js';
import {
  analyzeAsking,
  analyzeAssistantAsk,
  buildSessionDigest,
  createObservationStore,
  formatSessionUri,
  parseTestOutput,
  SESSION_DIGEST_CONCLUSION_CHARS,
  type ObservedObject,
  type ObservationStore,
} from '../core/index.js';
import {
  createSessionDigestProducer,
  readSessionAskEventLedger,
  SESSION_ASK_EVENTS_DIGEST_KEY,
  type SessionAskEventLedger,
  type SessionAskSweepableProducer,
} from '../session-digest/index.js';
import {
  SESSION_ASK_NOT_ASKING_REASON,
  type SessionAskDecisionDigest,
} from '../session-ask/index.js';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(TEST_DIRECTORY, 'fixtures', 'session-transcript.jsonl');
const USER_ID = 'digest-watcher';

let temporaryDirectory = '';
let previousDatabasePath: string | undefined;
let clock = 2_000_000;

const store = createObservationStore({ now: () => clock });
const producer = createSessionDigestProducer({ store, now: () => clock });

test.before(async () => {
  previousDatabasePath = process.env.DATABASE_PATH;
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'observation-session-digest-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(temporaryDirectory, 'auth.db');
  await initializeDatabase();
});

test.after(async () => {
  closeConnection();
  if (previousDatabasePath === undefined) {
    delete process.env.DATABASE_PATH;
  } else {
    process.env.DATABASE_PATH = previousDatabasePath;
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
});

test.beforeEach(() => {
  const db = getConnection();
  db.exec('DELETE FROM observed_revisions');
  db.exec('DELETE FROM observed_objects');
  db.exec('DELETE FROM observation_seen_cursors');
  db.exec('DELETE FROM observation_watch_entries');
  clock = 2_000_000;
});

/** Writes a transcript file into this criterion's own temp dir and returns its path. */
async function writeTranscript(name: string, rows: unknown[]): Promise<string> {
  const filePath = path.join(temporaryDirectory, name);
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return filePath;
}

/** Records one app-owned session row pointing at `jsonlPath`. */
function createSessionRow(sessionId: string, jsonlPath: string | null): void {
  sessionsDb.createSession(sessionId, 'claude', temporaryDirectory, `Session ${sessionId}`, undefined, undefined, jsonlPath);
}

/** Pins a session, which is the observation layer's "someone is watching this" fact. */
function watch(sessionId: string): void {
  clock += 1;
  observationDb.writeWatchEntry(USER_ID, formatSessionUri(sessionId), clock);
}

/** One turn that ends on a statement, with no question and no failing test. */
const STATEMENT_ROWS = [
  {
    type: 'user',
    uuid: 's-u1',
    sessionId: 'statement-session',
    message: { role: 'user', content: [{ type: 'text', text: '跑一下测试' }] },
  },
  {
    type: 'assistant',
    uuid: 's-a1',
    sessionId: 'statement-session',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '改动已经完成，测试全绿。' }],
    },
  },
];

// ---------------------------------------------------------------------------------------------
// AC1 — the deterministic reading
// ---------------------------------------------------------------------------------------------

test('AC1: the fixed fixture dedupes edited files and parses the vitest summary', async () => {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  const result = buildSessionDigest(raw);

  assert.equal(result.state, 'evaluated');
  if (result.state !== 'evaluated') return;
  const { digest } = result;

  // Edit /repo/src/login.tsx twice, Write /repo/src/login.test.ts once — two distinct files.
  assert.deepEqual(digest.changedFiles, ['/repo/src/login.tsx', '/repo/src/login.test.ts']);

  assert.deepEqual(digest.commands, ['Run login tests']);
  assert.deepEqual(digest.tests, {
    state: 'evaluated',
    runner: 'vitest',
    passed: 8,
    failed: 1,
  });

  // Two real user prompts, so the delta baseline is not hard-coded to one.
  assert.equal(digest.turnCount, 2);
});

test('AC1: vitest, node --test and playwright summaries each yield their own counts', () => {
  assert.deepEqual(parseTestOutput('      Tests  1 failed | 8 passed (9)\n'), {
    state: 'evaluated',
    runner: 'vitest',
    passed: 8,
    failed: 1,
  });

  assert.deepEqual(parseTestOutput('# tests 5\n# pass 4\n# fail 1\n'), {
    state: 'evaluated',
    runner: 'node-test',
    passed: 4,
    failed: 1,
  });

  assert.deepEqual(parseTestOutput('  1 failed\n  9 passed (5.2s)\n'), {
    state: 'evaluated',
    runner: 'playwright',
    passed: 9,
    failed: 1,
  });
});

test('AC1: the repo\'s own tsx --test invocation is read as a node --test run', () => {
  // Every server criterion in this repo runs node's test runner through the TS loader. The
  // command gate must recognise that shape, not only a literal `node --test`.
  const rows = [
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'run the criterion' }] } },
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 't-tsx',
            name: 'Bash',
            input: {
              command:
                'npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts',
              description: 'Run the digest criterion',
            },
          },
        ],
      },
    },
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't-tsx',
            content: [{ type: 'text', text: 'ℹ tests 9\nℹ pass 9\nℹ fail 0\n' }],
          },
        ],
      },
    },
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'The criterion passes.' }] },
    },
  ];

  const result = buildSessionDigest(rows.map((row) => JSON.stringify(row)).join('\n'));

  assert.equal(result.state, 'evaluated');
  if (result.state !== 'evaluated') return;
  assert.deepEqual(result.digest.tests, { state: 'evaluated', runner: 'node-test', passed: 9, failed: 0 });
});

test('AC1: output no runner recognizes reads unevaluated with a reason', () => {
  const reading = parseTestOutput('all good, nothing to report\n');

  assert.equal(reading.state, 'unevaluated');
  if (reading.state !== 'unevaluated') return;
  assert.match(reading.reason, /未识别/);

  // A skipped run's `0 passed / 0 failed` is a readable summary but not a green reading.
  const vacuous = parseTestOutput('ℹ tests 1\nℹ pass 0\nℹ fail 0\nℹ skipped 1\n');
  assert.equal(vacuous.state, 'unevaluated');
  if (vacuous.state !== 'unevaluated') return;
  assert.match(vacuous.reason, /0 通过 0 失败/);
});

test('AC1: a question ending and a numbered-options ending both ask you, a statement does not', () => {
  assert.equal(analyzeAsking('要不要我现在就把旧断言改掉？').isAsking, true);
  assert.equal(analyzeAsking('要不要我现在就把旧断言改掉？').question, '要不要我现在就把旧断言改掉？');

  const options = analyzeAsking('你可以选一个：\n1. 继续改登录页\n2. 先补测试');
  assert.equal(options.isAsking, true);
  assert.deepEqual(options.options, ['继续改登录页', '先补测试']);

  const statement = analyzeAsking('改动已经完成，测试全绿。');
  assert.equal(statement.isAsking, false);
  assert.deepEqual(statement.options, []);
});

test('AC: a question anywhere asks you; a numbered list only counts as the last paragraph', () => {
  /** `count` consecutive short numbered lines — the shape that used to read as "pick one". */
  const numbered = (count: number): string =>
    Array.from({ length: count }, (_, index) => `${index + 1}. 第${index + 1}项检查已完成`).join('\n');

  // A long answer whose numbered list sits in a MIDDLE paragraph ends on a statement.
  for (const count of [3, 4, 14]) {
    const longAnswer = [
      '我复核了整条链路，下面是发现：',
      numbered(count),
      '要的话我可以把 P0 的三条拆成 quay 任务，之后再一起看。',
    ].join('\n\n');
    assert.equal(analyzeAssistantAsk(longAnswer).isAsking, false, `${count} 行编号的长回答按最后一段判为陈述`);

    const rows = [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '复核一下' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: longAnswer }] } },
    ];
    const result = buildSessionDigest(rows.map((row) => JSON.stringify(row)).join('\n'));
    assert.equal(result.state, 'evaluated');
    if (result.state !== 'evaluated') return;
    assert.equal(result.digest.askingYou.isAsking, false, `${count} 行编号的长回答 digest 判为陈述`);
  }

  // A question mark in an EARLIER paragraph is a real question: 62d959c0's decision sat in the
  // middle of a three-part report whose last paragraph was a note. Position must not hide it.
  assert.equal(analyzeAssistantAsk('这里要先确认一件事？\n\n最后的结论是改动已完成。').isAsking, true);

  // The two real asking shapes still read as asking when they are the LAST paragraph.
  assert.equal(analyzeAssistantAsk('前面做了很多。\n\n要不要我现在就把旧断言改掉？').isAsking, true);
  const options = analyzeAssistantAsk('前面做了很多。\n\n你可以选一个：\n1. 继续改登录页\n2. 先补测试');
  assert.equal(options.isAsking, true);
  assert.deepEqual(options.options, ['继续改登录页', '先补测试']);
});

test('AC1: the conclusion is the final paragraph, truncated and marked deterministic', async () => {
  const raw = await readFile(FIXTURE_PATH, 'utf8');
  const result = buildSessionDigest(raw);

  assert.equal(result.state, 'evaluated');
  if (result.state !== 'evaluated') return;
  const { conclusion, askingYou } = result.digest;

  assert.equal(conclusion.tier, 'deterministic');
  assert.equal(conclusion.label, '原文摘录');
  assert.equal(conclusion.truncated, true);
  assert.equal(conclusion.text.length, SESSION_DIGEST_CONCLUSION_CHARS);
  // The tail is kept, so the question and its options survive the excerpt.
  assert.match(conclusion.text, /下一步你想怎么处理/);
  assert.match(conclusion.text, /2\. 先补一条新的回归测试/);
  assert.equal(askingYou.isAsking, true);
  assert.equal(askingYou.options.length, 2);
});

// ---------------------------------------------------------------------------------------------
// AC2 — the write path
// ---------------------------------------------------------------------------------------------

test('AC2: one turn-end event writes one revision and the next event bumps it by one', async () => {
  const sessionId = 'watched-asking-session';
  const transcript = await writeTranscript('watched.jsonl', [
    { type: 'user', uuid: 'w-u1', message: { role: 'user', content: [{ type: 'text', text: '怎么办？' }] } },
    {
      type: 'assistant',
      uuid: 'w-a1',
      message: { role: 'assistant', content: [{ type: 'text', text: '要我现在就动手吗？' }] },
    },
  ]);
  createSessionRow(sessionId, transcript);
  watch(sessionId);
  const uri = formatSessionUri(sessionId);

  const first = await producer.handleTurnEnd({
    appSessionId: sessionId,
    runId: 'run-1',
    status: 'completed',
    completedAt: clock,
    error: null,
  });

  assert.notEqual(first, null);
  assert.equal(first?.revision, 1);
  assert.equal(first?.status.state, 'attention');
  assert.equal(store.listRevisions(uri, 0).length, 1);

  clock += 1_000;
  const second = await producer.handleTurnEnd({
    appSessionId: sessionId,
    runId: 'run-2',
    status: 'completed',
    completedAt: clock,
    error: null,
  });

  assert.equal(second?.revision, 2);
  assert.equal(store.listRevisions(uri, 0).length, 2);
});

test('AC2: a session nobody watches that ends on a statement is not written', async () => {
  const sessionId = 'unwatched-idle-session';
  const transcript = await writeTranscript('statement.jsonl', STATEMENT_ROWS);
  createSessionRow(sessionId, transcript);

  const written = await producer.handleTurnEnd({
    appSessionId: sessionId,
    runId: 'run-3',
    status: 'completed',
    completedAt: clock,
    error: null,
  });

  assert.equal(written, null);
  // The control: the SAME transcript IS written once someone watches it, so the skip above is
  // the watch rule and not some unrelated early return.
  watch(sessionId);
  const watched = await producer.handleTurnEnd({
    appSessionId: sessionId,
    runId: 'run-4',
    status: 'completed',
    completedAt: clock,
    error: null,
  });
  assert.equal(watched?.status.state, 'ok');
});

test('AC2: a failed run reads red even when the transcript ends on a statement', async () => {
  const sessionId = 'watched-failing-session';
  const transcript = await writeTranscript('failing.jsonl', STATEMENT_ROWS);
  createSessionRow(sessionId, transcript);
  watch(sessionId);

  const written = await producer.handleTurnEnd({
    appSessionId: sessionId,
    runId: 'run-5',
    status: 'completed',
    completedAt: clock,
    error: 'provider exited with code 1',
  });

  assert.equal(written?.status.state, 'red');
  assert.equal(written?.status.reason, 'provider exited with code 1');
});

test('AC2: a missing transcript writes unevaluated with a reason', async () => {
  const sessionId = 'watched-missing-transcript';
  createSessionRow(sessionId, path.join(temporaryDirectory, 'does-not-exist.jsonl'));
  watch(sessionId);

  const written = await producer.handleTurnEnd({
    appSessionId: sessionId,
    runId: 'run-6',
    status: 'completed',
    completedAt: clock,
    error: null,
  });

  assert.equal(written?.status.state, 'unevaluated');
  assert.equal(typeof written?.status.reason, 'string');
  assert.notEqual(written?.status.reason, '');
  assert.match(String(written?.digest.unevaluatedReason), /transcript/);
});

// ---------------------------------------------------------------------------------------------
// Ask retraction and answered backfill (gap-cockpit-ask-retraction-and-ledger-backfill)
// ---------------------------------------------------------------------------------------------

/** A captured session-ask event; only the fields the retraction criteria read. */
type CapturedSessionAskEvent = {
  kind: string;
  session: string;
  project: string;
  at: string;
  data: Record<string, unknown>;
};

/** The semantic verdict stub: a long report is a non-ask, everything else is a real ask. */
function retractionSummarize(input: { assistantText: string }): SessionAskDecisionReading {
  if (input.assistantText.includes('长篇审查报告') || input.assistantText.includes('不是提问')) {
    return { state: 'unevaluated', isAsking: false, reason: '语义判定：这条助手消息不是在提问' };
  }
  return askingReading('要不要继续？');
}

/** Builds a producer over the real store with an in-memory event capture and a stub summariser. */
function retractionProducer(options: {
  sessionIds?: string[];
  streamAsks?: ReadonlyArray<{
    askId: string;
    sessionId: string;
    messageId: string;
    revision: number;
    project: string;
    askedAt: string;
  }>;
  summarize?: (input: { assistantText: string }) => Promise<SessionAskDecisionReading>;
}): { producer: ReturnType<typeof createSessionDigestProducer>; events: CapturedSessionAskEvent[] } {
  const events: CapturedSessionAskEvent[] = [];
  const eventWriter = {
    write(event: CapturedSessionAskEvent) {
      events.push(event);
    },
  };
  const producer = createSessionDigestProducer({
    store,
    now: () => clock,
    eventWriter,
    isObserved: () => false,
    summarizeAsk: {
      summarize: async (input) =>
        (options.summarize ?? (async () => retractionSummarize(input)))(input),
    },
    listObservedSessionIds: () => options.sessionIds ?? [],
    ...(options.streamAsks === undefined
      ? {}
      : { readOpenSessionAsks: async () => options.streamAsks ?? [] }),
    sweepDelayMs: 0,
  });
  return { producer, events };
}

/** Seeds one observation object whose ledger already names an unfinished ask. */
function seedLedger(sessionId: string, ledger: SessionAskEventLedger): void {
  clock += 1;
  store.writeRevision({
    uri: formatSessionUri(sessionId),
    kind: 'session',
    title: `Session ${sessionId}`,
    status: { state: 'attention', reason: 'seeded' },
    digest: { activity: 'waiting', askEvents: ledger },
    deltaItems: [],
    provenance: { producer: 'test-seed', tier: 'deterministic', evaluatedAt: clock },
  });
}

const RETRACTION_FALSE_POSITIVE_ROWS = [
  {
    type: 'user',
    uuid: 'fp-u1',
    sessionId: 'retract-false-positive',
    message: { role: 'user', content: [{ type: 'text', text: '看这份审查报告' }] },
  },
  {
    type: 'assistant',
    uuid: 'fp-a1',
    sessionId: 'retract-false-positive',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '长篇审查报告如下：\n1. 第一点\n2. 第二点\n\n本轮没有运行测试。' }],
    },
  },
];

test('retraction: a ledger ask whose message is a long report is withdrawn exactly once', async () => {
  const sessionId = 'retract-ledger-session';
  const messageId = 'fp-a1';
  const askId = `${sessionId}:${messageId}`;
  seedLedger(sessionId, { answered: [], asking: [`${askId}:1`], pending: [{ askId, messageId }], retracted: [] });
  const transcriptRows = RETRACTION_FALSE_POSITIVE_ROWS.map((row) => ({ ...row, sessionId }));
  createSessionRow(sessionId, await writeTranscript('retract-ledger.jsonl', transcriptRows));

  const { producer, events } = retractionProducer({ sessionIds: [sessionId] });
  await producer.sweepOpenAsks();

  const retracted = events.filter((event) => event.kind === 'session.asking.retracted');
  assert.equal(retracted.length, 1, 'one mis-stated ask is withdrawn once');
  assert.deepEqual(retracted[0]?.data, { askId, messageId });

  const ledger = readSessionAskEventLedger(store.getObject(formatSessionUri(sessionId))?.digest);
  assert.deepEqual(ledger.asking, [], 'the asking key is cleared');
  assert.deepEqual(ledger.pending, [], 'the pending entry is cleared');
  assert.deepEqual(ledger.retracted, [askId], 'the withdrawn askId is remembered');

  // A second pass never re-states the withdrawal.
  await producer.sweepOpenAsks();
  assert.equal(events.filter((event) => event.kind === 'session.asking.retracted').length, 1);
});

test('retraction: a genuine question is not withdrawn, and an unreadable transcript is left alone', async () => {
  const sessionId = 'retract-genuine-session';
  const messageId = 'gen-a1';
  const askId = `${sessionId}:${messageId}`;
  seedLedger(sessionId, { answered: [], asking: [`${askId}:1`], pending: [{ askId, messageId }], retracted: [] });
  const rows = [
    { type: 'user', uuid: 'gen-u1', sessionId, message: { role: 'user', content: [{ type: 'text', text: '开始' }] } },
    { type: 'assistant', uuid: messageId, sessionId, message: { role: 'assistant', content: [{ type: 'text', text: '要不要先补测试？' }] } },
  ];
  createSessionRow(sessionId, await writeTranscript('retract-genuine.jsonl', rows));

  const { producer, events } = retractionProducer({ sessionIds: [sessionId] });
  await producer.sweepOpenAsks();
  assert.equal(events.filter((event) => event.kind === 'session.asking.retracted').length, 0, 'a real ask is never withdrawn');

  // An unreadable transcript (path does not exist) must not produce a withdrawal either.
  const unreadableId = 'retract-unreadable-session';
  const unreadableAskId = `${unreadableId}:${messageId}`;
  seedLedger(unreadableId, { answered: [], asking: [`${unreadableAskId}:1`], pending: [{ askId: unreadableAskId, messageId }], retracted: [] });
  createSessionRow(unreadableId, path.join(temporaryDirectory, 'missing-retract.jsonl'));
  const { producer: unreadableProducer, events: unreadableEvents } = retractionProducer({ sessionIds: [unreadableId] });
  await unreadableProducer.sweepOpenAsks();
  assert.equal(unreadableEvents.filter((event) => event.kind === 'session.asking.retracted').length, 0, 'an unreadable message is never withdrawn');
});

test('retraction: an event-only ask with no observation object is withdrawn once', async () => {
  const sessionId = 'retract-event-only-session';
  const messageId = 'fp-a1';
  const askId = `${sessionId}:${messageId}`;
  createSessionRow(sessionId, await writeTranscript('retract-event-only.jsonl', RETRACTION_FALSE_POSITIVE_ROWS.map((row) => ({ ...row, sessionId }))));

  const streamAsks = [
    { askId, sessionId, messageId, revision: 1, project: temporaryDirectory, askedAt: '2026-10-29T00:00:00.000Z' },
  ];
  const { producer, events } = retractionProducer({ sessionIds: [], streamAsks });
  await producer.sweepOpenAsks();

  const retracted = events.filter((event) => event.kind === 'session.asking.retracted');
  assert.equal(retracted.length, 1);
  assert.deepEqual(retracted[0]?.data, { askId, messageId });

  // The event-only session has no object, so the in-process emit guard is what stops a repeat.
  await producer.sweepOpenAsks();
  assert.equal(events.filter((event) => event.kind === 'session.asking.retracted').length, 1);
});

test('retraction: an asking turn writes the object before the asking event, even unwatched', async () => {
  const sessionId = 'ask-object-before-event';
  const rows = [
    { type: 'user', uuid: 'ask-u1', sessionId, message: { role: 'user', content: [{ type: 'text', text: '开始' }] } },
    { type: 'assistant', uuid: 'ask-a1', sessionId, message: { role: 'assistant', content: [{ type: 'text', text: '要不要先补测试？' }] } },
  ];
  createSessionRow(sessionId, await writeTranscript('ask-before-event.jsonl', rows));

  const events: CapturedSessionAskEvent[] = [];
  const eventWriter = {
    write(event: CapturedSessionAskEvent) {
      if (event.kind === 'session.asking') {
        assert.notEqual(
          store.getObject(formatSessionUri(sessionId)),
          null,
          'the object must exist before its asking event is stated',
        );
      }
      events.push(event);
    },
  };
  const producer = createSessionDigestProducer({
    store,
    now: () => clock,
    eventWriter,
    isObserved: () => false,
    summarizeAsk: { summarize: async () => askingReading('要不要先补测试？') },
  });

  const written = await producer.handleTurnEnd({
    appSessionId: sessionId,
    runId: 'run-ask-before-event',
    status: 'completed',
    completedAt: clock,
    error: null,
  });
  assert.notEqual(written, null, 'an asking turn is written even when nobody watches');
  assert.equal(written?.status.state, 'attention');
  assert.equal(events.filter((event) => event.kind === 'session.asking').length, 1);
});

test('answered: a session with no observation object states the answer from the stream once', async () => {
  const sessionId = 'no-object-answered-session';
  const messageId = 'no-a1';
  const askId = `${sessionId}:${messageId}`;
  const rows = [
    { type: 'user', uuid: 'no-u1', sessionId, message: { role: 'user', content: [{ type: 'text', text: '开始' }] } },
    { type: 'assistant', uuid: messageId, sessionId, message: { role: 'assistant', content: [{ type: 'text', text: '要不要先补测试？' }] } },
    { type: 'user', uuid: 'no-u2', sessionId, message: { role: 'user', content: [{ type: 'text', text: '先补测试' }] } },
    { type: 'assistant', uuid: 'no-a2', sessionId, message: { role: 'assistant', content: [{ type: 'text', text: '补好了。' }] } },
  ];
  createSessionRow(sessionId, await writeTranscript('no-object-answered.jsonl', rows));

  const streamAsks = [
    { askId, sessionId, messageId, revision: 1, project: temporaryDirectory, askedAt: '2026-10-29T00:00:00.000Z' },
  ];
  const { producer, events } = retractionProducer({ sessionIds: [], streamAsks });
  await producer.sweepOpenAsks();

  const answered = events.filter((event) => event.kind === 'session.answered');
  assert.equal(answered.length, 1);
  assert.equal(answered[0]?.data.askId, askId);
  assert.equal(answered[0]?.data.messageId, 'no-u2', 'the answer names the user message that settled the ask');
  assert.equal(events.filter((event) => event.kind === 'session.asking.retracted').length, 0);

  await producer.sweepOpenAsks();
  assert.equal(events.filter((event) => event.kind === 'session.answered').length, 1);
});

test('answered: a false-positive ask in a session with no object is withdrawn, not answered', async () => {
  const sessionId = 'no-object-retract-session';
  const messageId = 'fp-a1';
  const askId = `${sessionId}:${messageId}`;
  createSessionRow(sessionId, await writeTranscript('no-object-retract.jsonl', RETRACTION_FALSE_POSITIVE_ROWS.map((row) => ({ ...row, sessionId }))));

  const streamAsks = [
    { askId, sessionId, messageId, revision: 1, project: temporaryDirectory, askedAt: '2026-10-29T00:00:00.000Z' },
  ];
  const { producer, events } = retractionProducer({ sessionIds: [], streamAsks });
  await producer.sweepOpenAsks();

  assert.equal(events.filter((event) => event.kind === 'session.answered').length, 0, 'a mis-stated ask is never answered');
  assert.equal(events.filter((event) => event.kind === 'session.asking.retracted').length, 1, 'it is withdrawn instead');
});

test('retraction: the 62d mid-message decision is a real ask — answered, never withdrawn', async () => {
  // The live fixture: the question sits in the MIDDLE of the message, the last paragraph is a
  // caveat. A position heuristic would read it as a statement; the semantic verdict must not.
  const sessionId = '62d959c0-5487-4649-a5f2-ab38462c438b';
  const messageId = '3818a9e5-1fb5-4c9f-9d99-eb8b7ee0647a';
  const askId = `${sessionId}:${messageId}`;
  const rows = [
    { type: 'user', uuid: '62d-u1', sessionId, message: { role: 'user', content: [{ type: 'text', text: '帮我审查封装实践' }] } },
    {
      type: 'assistant',
      uuid: messageId,
      sessionId,
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '值得优先讨论的下一步：\n1. 先拆 observation producer 的 ask ledger\n2. 再核对 cockpit controller\n\n本轮没有运行测试，以上是只读审查。',
          },
        ],
      },
    },
    { type: 'user', uuid: '62d-u2', sessionId, message: { role: 'user', content: [{ type: 'text', text: '先拆 observation producer 的 ask ledger 和恢复/sweep。' }] } },
  ];
  createSessionRow(sessionId, await writeTranscript('retract-62d.jsonl', rows));

  const streamAsks = [
    { askId, sessionId, messageId, revision: 1, project: temporaryDirectory, askedAt: '2026-10-29T16:05:53.000Z' },
  ];
  const { producer, events } = retractionProducer({ sessionIds: [], streamAsks });
  await producer.sweepOpenAsks();

  assert.equal(
    events.filter((event) => event.kind === 'session.asking.retracted').length,
    0,
    'the mid-message decision is never withdrawn',
  );
  const answered = events.filter((event) => event.kind === 'session.answered');
  assert.equal(answered.length, 1, 'the user reply settles the ask');
  assert.equal(answered[0]?.data.askId, askId);
  assert.equal(answered[0]?.data.messageId, '62d-u2');
});


// ---------------------------------------------------------------------------------------------
// Retraction of mis-stated asks, and answers for sessions that hold no observation object
// ---------------------------------------------------------------------------------------------

const ASK_CLOCK = 1_800_000_500_000;
const ASK_PROJECT = '/repo/project';

type AskTurn = { role: 'user' | 'assistant'; id: string; text: string };

/** Renders turns as the JSONL the observation layer reads; the row `uuid` is the message id. */
function askTranscript(turns: AskTurn[]): string {
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

/**
 * A long report whose numbered list passes the WIDE prefilter but whose last paragraph is a
 * statement. It is the 5b/fea61b arm: a card built from it was never a question.
 */
const ASK_STATEMENT_TEXT = [
  '我复核了整条链路，下面是我的发现：',
  '',
  '1. 第一项检查已经完成',
  '2. 第二项检查已经完成',
  '3. 第三项检查已经完成',
  '',
  '结论都写在上面的报告里。',
].join('\n');

/** A plain, unambiguous question (the control arm). */
const ASK_QUESTION_TEXT = '前面做了很多。\n\n要不要现在改？';

/** The T1 verdict for the 5b/fea61b arm: a mechanically-wide candidate that is not a question. */
const NOT_ASKING: SessionAskDecisionReading = {
  state: 'unevaluated',
  isAsking: false,
  reason: SESSION_ASK_NOT_ASKING_REASON,
};

function askingReading(ask: string): SessionAskDecisionReading {
  return {
    state: 'evaluated',
    isAsking: true,
    askId: 'x:y',
    revision: 1,
    ask,
    situation: '正在决定下一步。',
    options: [],
    incomplete: false,
    inputTokens: 10,
    outputTokens: 5,
  };
}

/** A summary stub over one fixed reading, recording how many times it was consulted. */
function summaryStub(reading: SessionAskDecisionReading): {
  digest: SessionAskDecisionDigest;
  calls: () => number;
} {
  let calls = 0;
  return {
    digest: {
      async summarize() {
        calls += 1;
        return reading;
      },
    },
    calls: () => calls,
  };
}

type AskHarness = {
  producer: SessionAskSweepableProducer;
  events: SessionAskEvent[];
  writes: ObservedObject[];
  order: string[];
  object: () => ObservedObject | null;
};

/**
 * A producer over an in-memory store and event recorder, with the transcript and the stream
 * seam supplied by the criterion. `seed` puts a digest (and thus a ledger) on the object before
 * the first pass; the seeding writes are not counted as the criterion's own.
 */
function askHarness(options: {
  sessionId: string;
  raw: string | null;
  summarizeAsk?: SessionAskDecisionDigest;
  observed?: boolean;
  readOpenSessionAsks?: () => Promise<readonly OpenSessionAsk[]>;
  listObservedSessionIds?: () => string[];
  seed?: Record<string, unknown>;
}): AskHarness {
  const objects = new Map<string, ObservedObject>();
  const writes: ObservedObject[] = [];
  const events: SessionAskEvent[] = [];
  const order: string[] = [];
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
        updatedAt: ASK_CLOCK,
        provenance: {
          producer: input.provenance.producer,
          tier: input.provenance.tier,
          evaluatedAt: input.provenance.evaluatedAt ?? ASK_CLOCK,
        },
      };
      objects.set(input.uri, object);
      writes.push(object);
      order.push(`write:${input.kind}`);
      return object;
    },
    getObject: (uri: string) => objects.get(uri) ?? null,
  } as unknown as ObservationStore;

  if (options.seed !== undefined) {
    store.writeRevision({
      uri: formatSessionUri(options.sessionId),
      kind: 'session',
      title: 'seeded session',
      status: { state: 'ok' },
      digest: options.seed,
      deltaItems: [],
      provenance: { producer: 'session-digest', tier: 'deterministic', evaluatedAt: ASK_CLOCK },
    });
    writes.length = 0;
    order.length = 0;
  }

  const producer = createSessionDigestProducer({
    store,
    resolveSession: () => ({ title: '会话：撤回', projectPath: ASK_PROJECT, jsonlPath: '/tmp/retraction.jsonl' }),
    readTranscript: async () => options.raw,
    isObserved: () => options.observed ?? true,
    now: () => ASK_CLOCK,
    sweepDelayMs: 0,
    eventWriter: {
      write(event) {
        events.push(event);
        order.push(`event:${event.kind}`);
      },
    },
    ...(options.summarizeAsk === undefined ? {} : { summarizeAsk: options.summarizeAsk }),
    ...(options.readOpenSessionAsks === undefined ? {} : { readOpenSessionAsks: options.readOpenSessionAsks }),
    ...(options.listObservedSessionIds === undefined ? {} : { listObservedSessionIds: options.listObservedSessionIds }),
  }) as unknown as SessionAskSweepableProducer;

  return {
    producer,
    events,
    writes,
    order,
    object: () => store.getObject(formatSessionUri(options.sessionId)),
  };
}

function eventsOf(events: SessionAskEvent[], kind: SessionAskEvent['kind']): SessionAskEvent[] {
  return events.filter((event) => event.kind === kind);
}

function ledgerOf(object: ObservedObject | null): SessionAskEventLedger {
  return readSessionAskEventLedger(object?.digest);
}

test('AC: a ledger asking that points at a statement is withdrawn once, and the ledger records it', async () => {
  const sessionId = 'replay-retraction-session';
  const askId = `${sessionId}:a1`;
  const raw = askTranscript([
    { role: 'user', id: 'u1', text: '审查一下' },
    { role: 'assistant', id: 'a1', text: ASK_STATEMENT_TEXT },
  ]);
  const stub = summaryStub(NOT_ASKING);
  const harness = askHarness({
    sessionId,
    raw,
    summarizeAsk: stub.digest,
    listObservedSessionIds: () => [sessionId],
    seed: {
      [SESSION_ASK_EVENTS_DIGEST_KEY]: {
        answered: [],
        asking: [`${askId}:1`],
        pending: [{ askId, messageId: 'a1' }],
      },
    },
  });

  await harness.producer.sweepOpenAsks();

  const retractions = eventsOf(harness.events, 'session.asking.retracted');
  assert.equal(retractions.length, 1, 'the ledger replay states exactly one retraction');
  assert.equal(retractions[0]?.session, sessionId);
  assert.deepEqual(retractions[0]?.data, { askId, messageId: 'a1' });
  assert.ok(stub.calls() >= 1, 'the withdrawal needs the T1 semantic verdict, never a position');

  const ledger = ledgerOf(harness.object());
  assert.deepEqual(ledger.asking, []);
  assert.deepEqual(ledger.pending, []);
  assert.deepEqual(ledger.retracted, [askId]);
});

test('AC: the withdrawn ask leaves asking/pending and is not restated on the next replay', async () => {
  const sessionId = 'replay-retraction-once-session';
  const askId = `${sessionId}:a1`;
  const raw = askTranscript([
    { role: 'user', id: 'u1', text: '审查一下' },
    { role: 'assistant', id: 'a1', text: ASK_STATEMENT_TEXT },
  ]);
  const harness = askHarness({
    sessionId,
    raw,
    summarizeAsk: summaryStub(NOT_ASKING).digest,
    listObservedSessionIds: () => [sessionId],
    seed: {
      [SESSION_ASK_EVENTS_DIGEST_KEY]: {
        answered: [],
        asking: [`${askId}:1`],
        pending: [{ askId, messageId: 'a1' }],
      },
    },
  });

  await harness.producer.sweepOpenAsks();
  const ledger = ledgerOf(harness.object());
  assert.deepEqual(ledger.asking, [], 'no asking key survives the withdrawal');
  assert.deepEqual(ledger.pending, [], 'no pending entry survives the withdrawal');
  assert.deepEqual(ledger.retracted, [askId], 'the ledger is the cross-process dedup');

  await harness.producer.sweepOpenAsks();
  assert.equal(
    eventsOf(harness.events, 'session.asking.retracted').length,
    1,
    'the second replay does not state the retraction again',
  );
});

test('AC: a real question in the ledger is never withdrawn', async () => {
  const sessionId = 'replay-real-question-session';
  const askId = `${sessionId}:a1`;
  const raw = askTranscript([
    { role: 'user', id: 'u1', text: '开始' },
    { role: 'assistant', id: 'a1', text: ASK_QUESTION_TEXT },
  ]);
  const harness = askHarness({
    sessionId,
    raw,
    summarizeAsk: summaryStub(askingReading('要不要现在改？')).digest,
    listObservedSessionIds: () => [sessionId],
    seed: {
      [SESSION_ASK_EVENTS_DIGEST_KEY]: {
        answered: [],
        asking: [`${askId}:1`],
        pending: [{ askId, messageId: 'a1' }],
      },
    },
  });

  await harness.producer.sweepOpenAsks();

  assert.deepEqual(eventsOf(harness.events, 'session.asking.retracted'), []);
  assert.deepEqual(ledgerOf(harness.object()).retracted, []);
});

test('AC: an unreadable transcript withdraws nothing', async () => {
  const sessionId = 'replay-unreadable-session';
  const askId = `${sessionId}:a1`;
  const harness = askHarness({
    sessionId,
    raw: null,
    summarizeAsk: summaryStub(NOT_ASKING).digest,
    listObservedSessionIds: () => [sessionId],
    seed: {
      [SESSION_ASK_EVENTS_DIGEST_KEY]: {
        answered: [],
        asking: [`${askId}:1`],
        pending: [{ askId, messageId: 'a1' }],
      },
    },
  });

  await harness.producer.sweepOpenAsks();

  assert.deepEqual(eventsOf(harness.events, 'session.asking.retracted'), []);
});

test('AC: an asking that exists only in the event stream is replayed and withdrawn once', async () => {
  const sessionId = 'event-only-retraction-session';
  const askId = `${sessionId}:a1`;
  const open: OpenSessionAsk[] = [
    {
      askId,
      sessionId,
      messageId: 'a1',
      revision: 1,
      project: ASK_PROJECT,
      askedAt: '2026-10-29T16:05:53.000Z',
    },
  ];
  const raw = askTranscript([
    { role: 'user', id: 'u1', text: '审查一下' },
    { role: 'assistant', id: 'a1', text: ASK_STATEMENT_TEXT },
  ]);
  const harness = askHarness({
    sessionId,
    raw,
    summarizeAsk: summaryStub(NOT_ASKING).digest,
    // The stream reader's own rule: a retraction row closes the ask, so a later pass no
    // longer sees it open. This is the cross-restart dedup for a session with no ledger.
    readOpenSessionAsks: async () =>
      harness.events.some(
        (event) => event.kind === 'session.asking.retracted' && event.data.askId === askId,
      )
        ? []
        : open,
    listObservedSessionIds: () => [],
  });

  await harness.producer.sweepOpenAsks();

  const retractions = eventsOf(harness.events, 'session.asking.retracted');
  assert.equal(retractions.length, 1, 'the event-only ask is withdrawn even with no ledger');
  assert.deepEqual(retractions[0]?.data, { askId, messageId: 'a1' });
  assert.equal(harness.object(), null, 'a retraction never invents an observation object');

  await harness.producer.sweepOpenAsks();
  assert.equal(eventsOf(harness.events, 'session.asking.retracted').length, 1, 'no re-statement');
});

test('AC: an event-only real question states no retraction', async () => {
  const sessionId = 'event-only-question-session';
  const askId = `${sessionId}:a1`;
  const raw = askTranscript([
    { role: 'user', id: 'u1', text: '开始' },
    { role: 'assistant', id: 'a1', text: ASK_QUESTION_TEXT },
  ]);
  const harness = askHarness({
    sessionId,
    raw,
    summarizeAsk: summaryStub(askingReading('要不要现在改？')).digest,
    readOpenSessionAsks: async () => [
      { askId, sessionId, messageId: 'a1', revision: 1, project: ASK_PROJECT, askedAt: '2026-10-29T16:05:53.000Z' },
    ],
    listObservedSessionIds: () => [],
  });

  await harness.producer.sweepOpenAsks();

  assert.deepEqual(eventsOf(harness.events, 'session.asking.retracted'), []);
});

test('AC: an unwatched turn that asks writes the object, and the asking event follows it', async () => {
  const sessionId = 'unwatched-asking-session';
  const raw = askTranscript([
    { role: 'user', id: 'u1', text: '怎么办' },
    { role: 'assistant', id: 'a1', text: ASK_QUESTION_TEXT },
  ]);
  const harness = askHarness({
    sessionId,
    raw,
    observed: false,
    summarizeAsk: summaryStub(askingReading('要不要现在改？')).digest,
  });

  const written = await harness.producer.handleTurnEnd({
    appSessionId: sessionId,
    runId: 'run-unwatched-ask',
    status: 'completed',
    completedAt: ASK_CLOCK,
    error: null,
  });

  assert.notEqual(written, null, 'an asking turn is never dropped as idle traffic');
  const asking = eventsOf(harness.events, 'session.asking');
  assert.equal(asking.length, 1);
  assert.notEqual(harness.object(), null, 'there is no asking event without its observation object');
  const objectIndex = harness.order.findIndex((entry) => entry.startsWith('write:'));
  const eventIndex = harness.order.indexOf('event:session.asking');
  assert.ok(objectIndex >= 0, 'the object write happened');
  assert.ok(eventIndex > objectIndex, 'the asking event is stated only after the object lands');
});

test('AC: a session with no observation object gets its stream ask answered from the transcript', async () => {
  const sessionId = 'stream-only-answer-session';
  const askId = `${sessionId}:a1`;
  const raw = askTranscript([
    { role: 'user', id: 'u1', text: '开始' },
    { role: 'assistant', id: 'a1', text: ASK_QUESTION_TEXT },
    { role: 'user', id: 'u2', text: '现在改' },
  ]);
  const harness = askHarness({
    sessionId,
    raw,
    summarizeAsk: summaryStub(askingReading('要不要现在改？')).digest,
    readOpenSessionAsks: async () =>
      harness.events.some(
        (event) => event.kind === 'session.answered' && event.data.askId === askId,
      )
        ? []
        : [{ askId, sessionId, messageId: 'a1', revision: 1, project: ASK_PROJECT, askedAt: '2026-10-29T16:05:53.000Z' }],
    listObservedSessionIds: () => [],
  });

  await harness.producer.sweepOpenAsks();

  const answered = eventsOf(harness.events, 'session.answered');
  assert.equal(answered.length, 1, 'the send answers the stream ask even with no ledger');
  assert.deepEqual(answered[0]?.data, { askId, messageId: 'u2' });
  assert.equal(harness.object(), null, 'the answer states no invented object');

  await harness.producer.sweepOpenAsks();
  assert.equal(eventsOf(harness.events, 'session.answered').length, 1, 'a second sweep does not re-state it');
});

test('AC: a statement answered in a session with no object is withdrawn, not answered', async () => {
  const sessionId = 'stream-only-statement-session';
  const askId = `${sessionId}:a1`;
  const raw = askTranscript([
    { role: 'user', id: 'u1', text: '继续' },
    { role: 'assistant', id: 'a1', text: ASK_STATEMENT_TEXT },
    { role: 'user', id: 'u2', text: '好' },
  ]);
  const harness = askHarness({
    sessionId,
    raw,
    summarizeAsk: summaryStub(NOT_ASKING).digest,
    readOpenSessionAsks: async () => [
      { askId, sessionId, messageId: 'a1', revision: 1, project: ASK_PROJECT, askedAt: '2026-10-29T16:05:53.000Z' },
    ],
    listObservedSessionIds: () => [],
  });

  await harness.producer.sweepOpenAsks();

  assert.equal(eventsOf(harness.events, 'session.asking.retracted').length, 1);
  assert.deepEqual(eventsOf(harness.events, 'session.answered'), [], 'a statement is never answered');
});

test('AC7: the live 62d959c0 fixture is a real question — no retraction, and the send answers it', async () => {
  const SESSION = '62d959c0-5487-4649-a5f2-ab38462c438b';
  const MESSAGE = '3818a9e5-1fb5-4c9f-9d99-eb8b7ee0647a';
  const askId = `${SESSION}:${MESSAGE}`;
  // The questionText the live `session.asking` row stated, verbatim (extracted from
  // ~/.quay-fleet/context/events/2026-10-29.jsonl). Its decision sits in a MIDDLE paragraph
  // ("值得优先讨论的下一步") and its last paragraph is a caveat ("本轮没有运行测试").
  const liveText = await readFile(
    path.join(TEST_DIRECTORY, 'fixtures', 'session-ask-62d959c0-3818a9e5.txt'),
    'utf8',
  );
  const raw = askTranscript([
    { role: 'user', id: 'u1', text: '检查会话历史，了解最近 1 周本项目进行面向对象重构尤其是封装的实践。' },
    { role: 'assistant', id: MESSAGE, text: liveText },
    { role: 'user', id: 'u2', text: '先拆 observation producer 的 ask ledger 和恢复/sweep，创建任务。' },
  ]);
  const stub = summaryStub(askingReading('是否先拆 observation producer 的 ask ledger，再做恢复/sweep？'));
  const harness = askHarness({
    sessionId: SESSION,
    raw,
    summarizeAsk: stub.digest,
    readOpenSessionAsks: async () =>
      harness.events.some(
        (event) =>
          event.kind === 'session.answered' ||
          (event.kind === 'session.asking.retracted' && event.data.askId === askId),
      )
        ? []
        : [{ askId, sessionId: SESSION, messageId: MESSAGE, revision: 1, project: ASK_PROJECT, askedAt: '2026-10-29T16:05:53.000Z' }],
    listObservedSessionIds: () => [],
  });

  await harness.producer.sweepOpenAsks();

  // (a) The real question is never withdrawn — a last-paragraph heuristic would have.
  const retractions = eventsOf(harness.events, 'session.asking.retracted');
  assert.deepEqual(retractions, [], 'the 62d decision is a middle paragraph; it must not be retracted');
  assert.ok(stub.calls() >= 1, 'the withdrawal decision was made by the T1 verdict, not by position');

  // (b) The user reply the live stream never got produces exactly one answered row.
  const answered = eventsOf(harness.events, 'session.answered');
  assert.equal(answered.length, 1, 'the live gap was a missing session.answered');
  assert.deepEqual(answered[0]?.data, { askId, messageId: 'u2' });
});
