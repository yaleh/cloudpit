/**
 * The ask-ledger owner's criteria (gap-observation-ask-ledger-owner).
 *
 * AC — the ledger owner is the ONE write path for `digest.askEvents`:
 *   · recording an ask snapshots the state, and a replayed revision is not stated twice while a
 *     genuine re-ask keeps ONE pending entry and bumps the asking key;
 *   · answering marks the askId answered and removes it from the unfinished set;
 *   · a withdrawal is remembered once, clears both open sets, and is never re-recorded;
 *   · persisting writes ONLY the ledger into the previous digest, under the ask-events key;
 *   · the producer references the owner/helper modules instead of holding their write details.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/observation/tests/session-ask-ledger.test.ts
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { SessionAskEvent } from '@/shared/types.js';

import type { ObservedObject, ObservationStore, WriteObservationInput } from '../observation-store.js';
import {
  createSessionAskLedgerOwner,
  dropAnsweredPending,
  isAskResolved,
  readSessionAskEventLedger,
  SESSION_ASK_EVENTS_DIGEST_KEY,
  unfinishedAskEntries,
  withdrawAskFromLedger,
  type SessionAskEventLedger,
  type SessionAskLedgerOwner,
} from '../session-ask-ledger.js';

const PRODUCER_PATH = fileURLToPath(new URL('../session-digest.producer.ts', import.meta.url));
const LEDGER_PATH = fileURLToPath(new URL('../session-ask-ledger.ts', import.meta.url));
const RECOVERY_PATH = fileURLToPath(new URL('../session-ask-recovery.ts', import.meta.url));

type Harness = {
  owner: SessionAskLedgerOwner;
  events: SessionAskEvent[];
  writes: WriteObservationInput[];
  objects: Map<string, ObservedObject>;
};

/**
 * Builds the owner over a recording store double and an in-memory event capture.
 *
 * The double implements exactly the two store verbs the owner uses; the cast is deliberate so
 * this criterion exercises the owner's own transitions without a database setup shared with the
 * producer's criteria.
 */
function createHarness(): Harness {
  const events: SessionAskEvent[] = [];
  const writes: WriteObservationInput[] = [];
  const objects = new Map<string, ObservedObject>();
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
  const owner = createSessionAskLedgerOwner({
    store,
    now: () => 1_234,
    producer: 'session-digest',
    emitOnce(key, event) {
      if (emitted.has(key)) return false;
      emitted.add(key);
      events.push(event);
      return true;
    },
  });
  return { owner, events, writes, objects };
}

const ASK_ID = 'session-1:msg-a1';
const TARGET = { sessionId: 'session-1', projectPath: '/repo', at: '2026-10-30T00:00:00.000Z' };

test('ledger: recording an ask snapshots the state and a replay is not stated twice', () => {
  const { owner, events } = createHarness();
  const ledger = owner.read(null);
  const input = {
    ...TARGET,
    askId: ASK_ID,
    messageId: 'msg-a1',
    revision: 1,
    data: { askId: ASK_ID, messageId: 'msg-a1' },
  };

  const first = owner.recordAsking(ledger, input);
  assert.notEqual(first, null);
  assert.equal(first?.key, `asking:${ASK_ID}:1`);
  assert.equal(first?.event.kind, 'session.asking');
  assert.deepEqual(first?.event.refs, ['msg-a1']);

  // The same revision replayed states nothing, and the pending set is unchanged.
  assert.equal(owner.recordAsking(ledger, input), null);
  assert.deepEqual(ledger, {
    answered: [],
    asking: [`${ASK_ID}:1`],
    pending: [{ askId: ASK_ID, messageId: 'msg-a1' }],
    retracted: [],
  });
  assert.equal(events.length, 0, 'recording returns the event; the caller states it after writing');

  // A genuine re-ask bumps the asking key but still keeps ONE pending entry for the askId.
  const reask = owner.recordAsking(ledger, { ...input, revision: 2 });
  assert.notEqual(reask, null);
  assert.equal(reask?.key, `asking:${ASK_ID}:2`);
  assert.deepEqual(ledger.asking, [`${ASK_ID}:1`, `${ASK_ID}:2`]);
  assert.equal(ledger.pending.length, 1, 'one pending entry per askId');
});

test('ledger: answering states once, marks the askId answered and empties the unfinished set', () => {
  const { owner, events } = createHarness();
  const ledger: SessionAskEventLedger = {
    answered: [],
    asking: [`${ASK_ID}:1`],
    pending: [{ askId: ASK_ID, messageId: 'msg-a1' }],
    retracted: [],
  };

  assert.deepEqual(owner.unfinished(ledger), [{ askId: ASK_ID, messageId: 'msg-a1' }]);
  assert.equal(
    owner.answerOnce(ledger, { ...TARGET, askId: ASK_ID, messageId: 'user-1' }),
    true,
  );
  assert.deepEqual(ledger.answered, [ASK_ID]);
  assert.deepEqual(owner.unfinished(ledger), []);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.kind, 'session.answered');
  assert.deepEqual(events[0]?.data, { askId: ASK_ID, messageId: 'user-1' });

  // A second answer (another turn-end or a repeated send) states nothing.
  assert.equal(owner.answerOnce(ledger, { ...TARGET, askId: ASK_ID, messageId: 'user-2' }), false);
  assert.equal(events.length, 1);

  owner.dropAnsweredPending(ledger);
  assert.deepEqual(ledger.pending, [], 'an answered ask is no longer pending');
});

test('ledger: a withdrawal is remembered once, clears both open sets and blocks re-recording', () => {
  const { owner } = createHarness();
  const ledger: SessionAskEventLedger = {
    answered: [],
    asking: [`${ASK_ID}:1`, `${ASK_ID}:2`, 'other:1'],
    pending: [
      { askId: ASK_ID, messageId: 'msg-a1' },
      { askId: 'other', messageId: 'msg-b1' },
    ],
    retracted: [],
  };

  withdrawAskFromLedger(ledger, ASK_ID);
  assert.deepEqual(ledger, {
    answered: [],
    asking: ['other:1'],
    pending: [{ askId: 'other', messageId: 'msg-b1' }],
    retracted: [ASK_ID],
  });
  assert.equal(isAskResolved(ledger, ASK_ID), true);
  assert.deepEqual(unfinishedAskEntries(ledger), [{ askId: 'other', messageId: 'msg-b1' }]);

  // Withdrawing twice is idempotent, and the withdrawn ask is never recorded again.
  withdrawAskFromLedger(ledger, ASK_ID);
  assert.deepEqual(ledger.retracted, [ASK_ID]);
  assert.equal(
    owner.recordAsking(ledger, {
      ...TARGET,
      askId: ASK_ID,
      messageId: 'msg-a1',
      revision: 3,
      data: {},
    }),
    null,
  );
});

test('ledger: persisting writes only the ledger into the previous digest', () => {
  const { owner, writes } = createHarness();
  const ledger: SessionAskEventLedger = {
    answered: [ASK_ID],
    asking: [],
    pending: [],
    retracted: [],
  };
  const previous: ObservedObject = {
    uri: 'observation://session/session-1',
    kind: 'session',
    title: 'Session one',
    status: { state: 'attention', reason: 'seeded' },
    digest: { activity: 'waiting', turnCount: 3 },
    blindSpots: [],
    revision: 7,
    updatedAt: 10,
    provenance: { producer: 'test-seed', tier: 'deterministic', evaluatedAt: 10 },
  };

  owner.persist(previous.uri, previous, ledger);

  assert.equal(writes.length, 1);
  const written = writes[0];
  assert.equal(written?.uri, previous.uri);
  assert.equal(written?.title, previous.title);
  assert.deepEqual(written?.status, previous.status);
  assert.deepEqual(written?.deltaItems, []);
  assert.deepEqual(written?.digest, {
    activity: 'waiting',
    turnCount: 3,
    [SESSION_ASK_EVENTS_DIGEST_KEY]: ledger,
  });
  assert.deepEqual(written?.provenance, {
    producer: 'session-digest',
    tier: 'deterministic',
    evaluatedAt: 1_234,
  });

  // Reading the written digest back yields the same ledger state.
  assert.deepEqual(readSessionAskEventLedger(written?.digest), ledger);
});

test('ledger: a missing or malformed digest reads as an empty ledger', () => {
  assert.deepEqual(readSessionAskEventLedger(null), { answered: [], asking: [], pending: [], retracted: [] });
  assert.deepEqual(readSessionAskEventLedger({ askEvents: 'not-an-object' }), {
    answered: [],
    asking: [],
    pending: [],
    retracted: [],
  });
  assert.deepEqual(
    readSessionAskEventLedger({
      askEvents: { answered: [1, 'a', ''], asking: ['x'], pending: [{ askId: 'a', messageId: 'm' }, { askId: '' }], retracted: 'no' },
    }),
    { answered: ['a'], asking: ['x'], pending: [{ askId: 'a', messageId: 'm' }], retracted: [] },
  );
});

test('producer: delegates ledger state and the recovery walks to their own owners', async () => {
  const exporter = await readFile(PRODUCER_PATH, 'utf8');
  assert.match(exporter, /from '\.\/session-ask-ledger\.js'/);
  assert.match(exporter, /from '\.\/session-ask-recovery\.js'/);
  assert.match(exporter, /createSessionAskLedgerOwner\(/);
  assert.match(exporter, /createSessionAskRecovery\(/);

  // The write details and the sweep must NOT live in the producer any more: it delegates.
  assert.doesNotMatch(exporter, /const persistLedger\s*=/);
  assert.doesNotMatch(exporter, /const stateSettledPending\s*=/);
  assert.doesNotMatch(exporter, /function runAskSweep/);
  assert.doesNotMatch(exporter, /ledger\.asking\.push\(/);
  assert.doesNotMatch(exporter, /ledger\.pending\.push\(/);

  // And the owners really carry the moved implementations.
  const ledgerOwner = await readFile(LEDGER_PATH, 'utf8');
  assert.match(ledgerOwner, /export function createSessionAskLedgerOwner\(/);
  assert.match(ledgerOwner, /const persist = /);
  const recovery = await readFile(RECOVERY_PATH, 'utf8');
  assert.match(recovery, /export function createSessionAskRecovery\(/);
  assert.match(recovery, /const sweepOpenAsks = async \(\)/);
});
