/**
 * The ask-recovery walks' criteria (gap-observation-ask-ledger-owner).
 *
 * AC — the recovery/sweep helper owns both walks:
 *   · a startup sweep states ONE answer per settled pending ask, naming the askId and the
 *     settling user message, and a second pass states nothing;
 *   · a user turn answers every unfinished ask from the send itself, once, and a repeat is a
 *     no-op;
 *   · a mis-stated pending ask is withdrawn by the replay instead of answered;
 *   · one unreadable session never blocks the rest of the sweep.
 *
 * The producer's own criteria (`session-digest.test.ts`) drive the same walks through the real
 * producer; this file pins the helper's contract directly.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/observation/tests/session-ask-recovery.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionAskDecisionReading, SessionAskEvent } from '@/shared/types.js';

import type { ObservedObject, ObservationStore, WriteObservationInput } from '../observation-store.js';
import { formatSessionUri } from '../observation-uri.js';
import {
  createSessionAskLedgerOwner,
  SESSION_ASK_EVENTS_DIGEST_KEY,
  type SessionAskEventLedger,
  type SessionAskLedgerOwner,
} from '../session-ask-ledger.js';
import { createSessionAskRecovery, type SessionAskRecovery } from '../session-ask-recovery.js';
import { createSessionAskRetraction } from '../session-ask-retraction.js';

type HarnessOptions = {
  /** Transcript text keyed by session id; `null` means the file is unreadable. */
  transcripts?: Record<string, string | null>;
  /** Sessions `resolveSession` knows about; the sweep lists them separately. */
  sessions?: string[];
  summarize?: (input: { assistantText: string }) => Promise<SessionAskDecisionReading>;
};

type Harness = {
  recovery: SessionAskRecovery;
  ledger: SessionAskLedgerOwner;
  store: ObservationStore;
  events: SessionAskEvent[];
  objects: Map<string, ObservedObject>;
};

const USER_QUESTION_ROWS = [
  { type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: '开始' }] } },
  {
    type: 'assistant',
    uuid: 'a1',
    message: { role: 'assistant', content: [{ type: 'text', text: '要不要继续？' }] },
  },
  { type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'text', text: '继续' }] } },
];

const STATEMENT_ROWS = [
  { type: 'user', uuid: 'u1', message: { role: 'user', content: [{ type: 'text', text: '看报告' }] } },
  {
    type: 'assistant',
    uuid: 'a1',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: '长篇审查报告如下：\n1. 第一点\n2. 第二点\n\n本轮没有运行测试。' }],
    },
  },
];

function transcript(rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

const ASKING: SessionAskDecisionReading = { state: 'skipped', reason: 'test-stub', isAsking: true };
const NOT_ASKING: SessionAskDecisionReading = { state: 'skipped', reason: 'test-stub', isAsking: false };

/**
 * Builds the recovery walks over a recording store double, a transcript map and an event
 * capture. The retraction module is the real one, with a stub verdict.
 */
function createHarness(options: HarnessOptions = {}): Harness {
  const events: SessionAskEvent[] = [];
  const objects = new Map<string, ObservedObject>();
  const writes: WriteObservationInput[] = [];
  const store = {
    writeRevision(input: WriteObservationInput): ObservedObject {
      writes.push(input);
      const previous = objects.get(input.uri);
      const object: ObservedObject = {
        uri: input.uri,
        kind: input.kind,
        title: input.title,
        status: input.status,
        digest: input.digest ?? {},
        blindSpots: [],
        revision: (previous?.revision ?? 0) + 1,
        updatedAt: input.provenance.evaluatedAt ?? 0,
        provenance: {
          producer: input.provenance.producer,
          tier: input.provenance.tier,
          evaluatedAt: input.provenance.evaluatedAt ?? 0,
        },
      };
      objects.set(input.uri, object);
      return object;
    },
    getObject(uri: string): ObservedObject | null {
      return objects.get(uri) ?? null;
    },
  } as unknown as ObservationStore;

  const emitted = new Set<string>();
  const emitOnce = (key: string, event: SessionAskEvent): boolean => {
    if (emitted.has(key)) return false;
    emitted.add(key);
    events.push(event);
    return true;
  };

  const ledger = createSessionAskLedgerOwner({
    store,
    now: () => 1_700_000_000_000,
    producer: 'session-digest',
    emitOnce,
  });
  const retraction = createSessionAskRetraction({
    summarizeAsk: { summarize: async (input) => (options.summarize ?? (async () => ASKING))(input) },
    emitOnce,
  });
  const transcripts = options.transcripts ?? {};
  const knownSessions = new Set(options.sessions ?? Object.keys(transcripts));
  const recovery = createSessionAskRecovery({
    store,
    resolveSession: (sessionId) =>
      knownSessions.has(sessionId)
        ? { title: `Session ${sessionId}`, projectPath: '/repo', jsonlPath: `/transcripts/${sessionId}.jsonl` }
        : null,
    readTranscript: async (jsonlPath) => {
      const sessionId = jsonlPath.replace('/transcripts/', '').replace('.jsonl', '');
      return transcripts[sessionId] ?? null;
    },
    listObservedSessionIds: () => [...objects.keys()].map((uri) => uri.split('/').at(-1) ?? '').filter((id) => id !== ''),
    retraction,
    ledger,
    now: () => 1_700_000_000_000,
    log: () => {},
    sweepDelayMs: 0,
  });
  return { recovery, ledger, store, events, objects };
}

/** Seeds one observation object whose digest carries the given ledger. */
function seedLedger(store: ObservationStore, sessionId: string, ledger: SessionAskEventLedger): void {
  store.writeRevision({
    uri: formatSessionUri(sessionId),
    kind: 'session',
    title: `Session ${sessionId}`,
    status: { state: 'attention', reason: 'seeded' },
    digest: { activity: 'waiting', [SESSION_ASK_EVENTS_DIGEST_KEY]: ledger },
    deltaItems: [],
    provenance: { producer: 'test-seed', tier: 'deterministic', evaluatedAt: 1 },
  });
}

function pendingLedger(sessionId: string, messageId = 'a1'): SessionAskEventLedger {
  const askId = `${sessionId}:${messageId}`;
  return { answered: [], asking: [`${askId}:1`], pending: [{ askId, messageId }], retracted: [] };
}

// ---------------------------------------------------------------------------------------------
// The startup sweep
// ---------------------------------------------------------------------------------------------

test('sweep: one pass states the settled answer, a second pass states nothing', async () => {
  const sessionId = 'sweep-once';
  const askId = `${sessionId}:a1`;
  const { recovery, ledger: ledgerOwner, store, events } = createHarness({
    transcripts: { [sessionId]: transcript(USER_QUESTION_ROWS) },
  });
  seedLedger(store, sessionId, pendingLedger(sessionId));

  const first = await recovery.sweepOpenAsks();
  assert.deepEqual(first, { sessions: 1, answered: 1, rebuilt: 0 });

  const answers = events.filter((event) => event.kind === 'session.answered');
  assert.equal(answers.length, 1);
  assert.deepEqual(answers[0]?.data, { askId, messageId: 'u2' }, 'the answer names the settling user row');

  const persisted = ledgerOwner.read(store.getObject(formatSessionUri(sessionId))?.digest);
  assert.deepEqual(persisted.answered, [askId]);
  assert.deepEqual(persisted.pending, [], 'the answered ask is removed from the unfinished set');

  // A repeated pass sees no candidate and states nothing again.
  const second = await recovery.sweepOpenAsks();
  assert.deepEqual(second, { sessions: 0, answered: 0, rebuilt: 0 });
  assert.equal(events.filter((event) => event.kind === 'session.answered').length, 1);
  assert.deepEqual(ledgerOwner.read(store.getObject(formatSessionUri(sessionId))?.digest), persisted);
});

test('sweep: one unreadable session never blocks the next one', async () => {
  const brokenId = 'sweep-broken';
  const healthyId = 'sweep-healthy';
  const healthyAskId = `${healthyId}:a1`;
  const { recovery, ledger: ledgerOwner, store, events } = createHarness({
    transcripts: { [brokenId]: null, [healthyId]: transcript(USER_QUESTION_ROWS) },
  });
  seedLedger(store, brokenId, pendingLedger(brokenId));
  seedLedger(store, healthyId, pendingLedger(healthyId));

  const summary = await recovery.sweepOpenAsks();
  assert.equal(summary.answered, 1);
  assert.equal(summary.sessions, 2, 'both sessions still named an unfinished ask');

  assert.equal(events.filter((event) => event.kind === 'session.answered').length, 1);
  assert.equal(events.find((event) => event.kind === 'session.answered')?.data.askId, healthyAskId);
  // The unreadable session's ledger is left exactly as seeded: no answer was invented.
  assert.deepEqual(ledgerOwner.read(store.getObject(formatSessionUri(brokenId))?.digest), pendingLedger(brokenId));
});

// ---------------------------------------------------------------------------------------------
// The user turn
// ---------------------------------------------------------------------------------------------

test('user turn: the send answers each unfinished ask once, and a repeat is a no-op', async () => {
  const sessionId = 'user-turn-once';
  const askId = `${sessionId}:a1`;
  const { recovery, ledger: ledgerOwner, store, events } = createHarness({
    transcripts: { [sessionId]: transcript(USER_QUESTION_ROWS) },
  });
  // The producer reads the ledger out of the previous revision before mutating it.
  seedLedger(store, sessionId, pendingLedger(sessionId));
  const uri = formatSessionUri(sessionId);
  const ledger = ledgerOwner.read(store.getObject(uri)?.digest);
  const input = {
    raw: transcript(USER_QUESTION_ROWS),
    sessionId,
    sessionTitle: `Session ${sessionId}`,
    projectPath: '/repo',
    at: '2026-10-30T00:00:00.000Z',
    answerMessageId: 'send-1',
    ledger,
  };

  const first = await recovery.stateUserTurnAnswers(input);
  assert.deepEqual(first, { retracted: 0, stated: 1 });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'session.answered');
  assert.deepEqual(events[0]?.data, { askId, messageId: 'send-1' }, 'the send itself is the answer');
  assert.deepEqual(ledger.answered, [askId]);

  // Persisting (what the producer does after the walk) makes the answer survive a repeat.
  ledgerOwner.dropAnsweredPending(ledger);
  const previous = store.getObject(uri);
  assert.notEqual(previous, null);
  if (previous !== null) ledgerOwner.persist(uri, previous, ledger);

  const second = await recovery.stateUserTurnAnswers({ ...input, ledger });
  assert.deepEqual(second, { retracted: 0, stated: 0 });
  assert.equal(events.length, 1, 'a repeated send states nothing again');
  const stored = ledgerOwner.read(store.getObject(uri)?.digest);
  assert.deepEqual(stored.answered, [askId]);
  assert.deepEqual(stored.pending, []);
});

test('user turn: a mis-stated pending ask is withdrawn, never answered', async () => {
  const sessionId = 'user-turn-retract';
  const askId = `${sessionId}:a1`;
  const { recovery, events } = createHarness({
    transcripts: { [sessionId]: transcript(STATEMENT_ROWS) },
    summarize: async () => NOT_ASKING,
  });
  const ledger = pendingLedger(sessionId);

  const outcome = await recovery.stateUserTurnAnswers({
    raw: transcript(STATEMENT_ROWS),
    sessionId,
    sessionTitle: `Session ${sessionId}`,
    projectPath: '/repo',
    at: '2026-10-30T00:00:00.000Z',
    answerMessageId: 'send-1',
    ledger,
  });

  assert.deepEqual(outcome, { retracted: 1, stated: 0 });
  assert.equal(events.filter((event) => event.kind === 'session.asking.retracted').length, 1);
  assert.equal(events.filter((event) => event.kind === 'session.answered').length, 0);
  assert.deepEqual(ledger.retracted, [askId]);
  assert.deepEqual(ledger.pending, []);
  assert.deepEqual(ledger.answered, []);
});
