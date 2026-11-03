/**
 * The blocked-session half of the context stream: `session.blocked` and `session.blocked.resolved`.
 *
 * WHAT IS REAL HERE. The writer is the production `createContextEventWriter` over a temporary
 * fleet home with a fixture schema; the adapter is the production one. Only the world around them
 * is a stub — nothing physical is parked.
 *
 * THE READINGS, in the order the criteria name them:
 *
 *   · both kinds are mintable (`CLOUDCLI_CONTEXT_EVENT_KINDS`), and the `session.blocked` row's
 *     `data` carries exactly the declared shape (`reason`/`blockId` plus the arm's identity);
 *   · the pairing is by `blockId`: a resolution names the same `<sessionId>:<requestId|turnId>`
 *     the block did;
 *   · deleting a kind from the constant is observable as `invalid-kind` (the negative form) —
 *     the same guard a typo hits, and the accepted arm proves the guard is not vacuous;
 *   · a fixture/DoD synthetic session lands only in a DECLARED isolated fleet home: production
 *     wiring refuses it before the record seam, and declaring the real home as `fixtureHome` is
 *     refused too (the positive control: writing the real home fails); a real session id still
 *     lands through the production adapter (the regression arm).
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/context-events/tests/session-blocked-events.test.ts
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  CLOUDCLI_CONTEXT_EVENT_KINDS,
  createContextEventWriter,
  createContextEvents,
  createSessionBlockedEventWriter,
  toSessionBlockedEventDraft,
  type CloudCliContextEventKind,
  type ContextEventDraft,
  type SessionBlockedEventAppend,
  type SessionBlockedEventWriter,
} from '@/modules/context-events/index.js';
import type {
  SessionBlockedEvent,
  SessionBlockedEventRecord,
} from '@/shared/ports/session-blocked-events.port.js';

const CLOCK = 1_800_000_000_000;
const DAY = new Date(CLOCK).toISOString().slice(0, 10);

/** The kinds a fleet document must carry for these readings; the envelope is the shared one. */
const BLOCKED_KINDS = {
  utterance: { producer: 'cloudcli' as const, group: 'interaction' },
  'session.blocked': { producer: 'cloudcli' as const, group: 'lifecycle' },
  'session.blocked.resolved': { producer: 'cloudcli' as const, group: 'lifecycle' },
};

/** A descriptive document in the fleet's shipped shape (`row` + `kinds`). */
const SCHEMA = {
  version: 1,
  name: 'context-event',
  row: {
    required: ['v', 'id', 'at', 'source', 'kind', 'data'],
    optional: ['project', 'session', 'refs'],
    fields: {
      v: 'schema version of this row (integer)',
      id: 'producer-unique event id (non-empty string)',
      at: 'ISO-8601 instant the event happened',
      source: 'the writer: cloudcli | fleet',
      kind: 'one of `kinds` below',
      project: 'optional Quay project id',
      session: 'optional Cloudpit session id',
      refs: 'optional array of references',
      data: 'kind-specific payload (a JSON object)',
    },
  },
  kinds: BLOCKED_KINDS,
};

type StreamRow = {
  v: number;
  id: string;
  at: string;
  source: string;
  kind: string;
  session?: string;
  data: Record<string, unknown>;
};

/** One isolated fleet home plus the real writer/stream/adapter over it. */
type Harness = {
  eventsDir: string;
  schemaPath: string;
  adapter: SessionBlockedEventWriter;
};

async function withHarness(
  run: (harness: Harness) => Promise<void>,
  options: { recordThrows?: boolean; fixture?: boolean } = {},
): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'session-blocked-events-'));
  const eventsDir = path.join(homeDir, '.quay-fleet', 'context', 'events');
  const schemaPath = path.join(homeDir, 'fixture', 'context-event.schema.v0.json');
  try {
    await mkdir(path.dirname(schemaPath), { recursive: true });
    await writeFile(schemaPath, JSON.stringify(SCHEMA), 'utf8');
    const writer = createContextEventWriter({ eventsDir, schemaPath, now: () => CLOCK });
    const stream = createContextEvents({ writer, now: () => CLOCK });
    const adapter = createSessionBlockedEventWriter({
      record: options.recordThrows
        ? async () => {
            throw new Error('the stream exploded');
          }
        : (draft) => stream.record(draft),
      log: () => undefined,
      // The isolated home is the temporary one this harness built; the fixture arm declares it
      // so the adapter accepts synthetic session ids (production wiring omits it and refuses).
      ...(options.fixture === true ? { fixtureHome: path.join(homeDir, '.quay-fleet') } : {}),
    });
    await run({ eventsDir, schemaPath, adapter });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

/** The day file's parseable lines, or `[]` when the writer never created it. */
async function readDay(eventsDir: string): Promise<StreamRow[]> {
  try {
    const raw = await readFile(path.join(eventsDir, `${DAY}.jsonl`), 'utf8');
    return raw
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as StreamRow);
  } catch {
    return [];
  }
}

const APPROVAL_BLOCK: SessionBlockedEvent = {
  kind: 'session.blocked',
  session: 'sess-approval',
  reason: 'approval',
  blockId: 'sess-approval:req-1',
  requestId: 'req-1',
  toolName: 'commandExecution',
};

/** The synthetic session a DoD/fixture scenario mints; never a real Cloudpit session id. */
const FIXTURE_SESSION = 'dod-codex-blocked-1793458130445';
const FIXTURE_BLOCK: SessionBlockedEvent = {
  kind: 'session.blocked',
  session: FIXTURE_SESSION,
  reason: 'failed',
  blockId: `${FIXTURE_SESSION}:turn-1`,
  turnId: 'turn-1',
  errorMessage: 'the build exited 1',
};
const FIXTURE_RESOLVED: SessionBlockedEventRecord = {
  kind: 'session.blocked.resolved',
  session: FIXTURE_SESSION,
  blockId: FIXTURE_BLOCK.blockId,
};

// ---------------------------------------------------------------------------------------------
// The contract shape
// ---------------------------------------------------------------------------------------------

test('both blocked kinds are in the closed kind set, and the draft carries exactly the declared data', () => {
  assert.ok((CLOUDCLI_CONTEXT_EVENT_KINDS as readonly string[]).includes('session.blocked'));
  assert.ok((CLOUDCLI_CONTEXT_EVENT_KINDS as readonly string[]).includes('session.blocked.resolved'));

  const approval = toSessionBlockedEventDraft(APPROVAL_BLOCK);
  assert.equal(approval.kind, 'session.blocked');
  assert.equal(approval.session, 'sess-approval');
  assert.deepEqual(approval.data, {
    reason: 'approval',
    blockId: 'sess-approval:req-1',
    requestId: 'req-1',
    toolName: 'commandExecution',
  });

  const failed = toSessionBlockedEventDraft({
    kind: 'session.blocked',
    session: 'sess-turn',
    reason: 'failed',
    blockId: 'sess-turn:turn-9',
    turnId: 'turn-9',
    errorMessage: 'the build exited 1',
  });
  assert.deepEqual(failed.data, {
    reason: 'failed',
    blockId: 'sess-turn:turn-9',
    turnId: 'turn-9',
    errorMessage: 'the build exited 1',
  });

  const interrupted = toSessionBlockedEventDraft({
    kind: 'session.blocked',
    session: 'sess-turn',
    reason: 'interrupted',
    blockId: 'sess-turn:turn-10',
    turnId: 'turn-10',
  });
  assert.deepEqual(interrupted.data, {
    reason: 'interrupted',
    blockId: 'sess-turn:turn-10',
    turnId: 'turn-10',
  });

  const resolved = toSessionBlockedEventDraft({
    kind: 'session.blocked.resolved',
    session: 'sess-turn',
    blockId: 'sess-turn:turn-9',
  });
  assert.equal(resolved.kind, 'session.blocked.resolved');
  assert.deepEqual(resolved.data, { blockId: 'sess-turn:turn-9' });
  console.log(`kinds=${JSON.stringify(['session.blocked', 'session.blocked.resolved'])}`);
});

test('a block and its resolution land as two rows naming the same blockId', async () => {
  await withHarness(async ({ eventsDir, adapter }) => {
    adapter.write(APPROVAL_BLOCK);
    adapter.write({ kind: 'session.blocked.resolved', session: 'sess-approval', blockId: 'sess-approval:req-1' });
    await adapter.settled();

    const rows = await readDay(eventsDir);
    assert.deepEqual(rows.map((row) => row.kind), ['session.blocked', 'session.blocked.resolved']);
    const [blocked, resolved] = rows;
    assert.equal(blocked?.v, 1);
    assert.equal(blocked?.source, 'cloudcli');
    assert.equal(blocked?.session, 'sess-approval');
    assert.match(String(blocked?.id), /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal(blocked?.at, new Date(CLOCK).toISOString());
    assert.deepEqual(blocked?.data, {
      reason: 'approval',
      blockId: 'sess-approval:req-1',
      requestId: 'req-1',
      toolName: 'commandExecution',
    });
    assert.deepEqual(resolved?.data, { blockId: 'sess-approval:req-1' });
    assert.equal(resolved?.data.blockId, blocked?.data.blockId, 'the resolution must name the same key');
    assert.deepEqual(adapter.status(), { written: 2, rejected: 0, rejectedByReason: {} });
    console.log(`rows=${JSON.stringify(rows.map((row) => ({ kind: row.kind, data: row.data })))}`);
  });
});

// ---------------------------------------------------------------------------------------------
// The negative form: a kind outside the closed set is refused
// ---------------------------------------------------------------------------------------------

test('a kind outside CLOUDCLI_CONTEXT_EVENT_KINDS is refused as invalid-kind; the declared kind is accepted', async () => {
  await withHarness(async ({ eventsDir, schemaPath, adapter }) => {
    // The `session.blocked` sibling proves the guard still ACCEPTS the kinds this producer
    // declares; only the kind absent from the constant is refused. That is the same code path a
    // deleted entry in CLOUDCLI_CONTEXT_EVENT_KINDS takes.
    const writer = createContextEventWriter({ eventsDir, schemaPath, now: () => CLOCK });
    const declared = await writer.append({ kind: 'session.blocked', session: 's', data: { reason: 'failed', blockId: 's:t' } });
    assert.equal(declared.ok, true, 'the declared kind must be accepted, or the guard below is vacuous');
    const undeclared = await writer.append({
      kind: 'session.blocked.unknown' as CloudCliContextEventKind,
      session: 's',
      data: { blockId: 's:unknown' },
    });
    assert.equal(undeclared.ok, false);
    assert.equal(undeclared.ok === false ? undeclared.reason : null, 'invalid-kind');
    console.log(`declared_ok=${declared.ok} undeclared_reason=${undeclared.ok === false ? undeclared.reason : 'n/a'}`);
    void adapter;
  });
});

// ---------------------------------------------------------------------------------------------
// Failure containment
// ---------------------------------------------------------------------------------------------

test('a record seam that throws is counted and never thrown at the producer', async () => {
  await withHarness(
    async ({ eventsDir, adapter }) => {
      assert.doesNotThrow(() => {
        adapter.write(APPROVAL_BLOCK as SessionBlockedEventRecord);
      });
      await adapter.settled();
      assert.deepEqual(adapter.status(), {
        written: 0,
        rejected: 1,
        rejectedByReason: { 'write-failed': 1 },
      });
      assert.deepEqual(await readDay(eventsDir), [], 'a failed append writes nothing');
      console.log(`throwContained=${JSON.stringify(adapter.status())}`);
    },
    { recordThrows: true },
  );
});

// ---------------------------------------------------------------------------------------------
// Fixture isolation: a synthetic session never reaches the real fleet home
// ---------------------------------------------------------------------------------------------

test('a fixture session lands only in the DECLARED isolated fleet home (AC1)', async () => {
  await withHarness(
    async ({ eventsDir, adapter }) => {
      adapter.write(FIXTURE_BLOCK);
      adapter.write(FIXTURE_RESOLVED);
      await adapter.settled();

      const rows = await readDay(eventsDir);
      assert.deepEqual(rows.map((row) => row.kind), [
        'session.blocked',
        'session.blocked.resolved',
      ]);
      assert.equal(rows[0]?.session, FIXTURE_SESSION);
      assert.deepEqual(rows[0]?.data, {
        reason: 'failed',
        blockId: FIXTURE_BLOCK.blockId,
        turnId: 'turn-1',
        errorMessage: 'the build exited 1',
      });
      assert.deepEqual(rows[1]?.data, { blockId: FIXTURE_BLOCK.blockId });
      assert.deepEqual(adapter.status(), { written: 2, rejected: 0, rejectedByReason: {} });
      console.log(`fixtureRows=${JSON.stringify(rows.map((row) => row.kind))}`);
    },
    { fixture: true },
  );
});

test('a fixture session is refused before the record seam: production wiring, and a fixtureHome that is the real home (AC1 positive control)', async () => {
  // The seam stands for the real production wiring: if it is reached with a fixture session, the
  // real fleet home is exactly where the row would land. The assertion is that it never is.
  const reached: ContextEventDraft[] = [];
  const realHomeSeam: SessionBlockedEventAppend = async (draft) => {
    reached.push(draft);
    return { ok: true, id: 'would-be-real', path: 'would-be-real' };
  };

  const production = createSessionBlockedEventWriter({ record: realHomeSeam, log: () => undefined });
  production.write(FIXTURE_BLOCK);
  production.write(FIXTURE_RESOLVED);
  await production.settled();
  assert.deepEqual(reached, [], 'production wiring must never hand a fixture session to the record seam');
  assert.deepEqual(production.status(), {
    written: 0,
    rejected: 2,
    rejectedByReason: { 'fixture-session': 2 },
  });

  // Positive control: declaring the REAL fleet home as the fixture home must fail the same way.
  const misdeclared = createSessionBlockedEventWriter({
    record: realHomeSeam,
    log: () => undefined,
    fixtureHome: path.join(os.homedir(), '.quay-fleet'),
  });
  misdeclared.write(FIXTURE_BLOCK);
  misdeclared.write(FIXTURE_RESOLVED);
  await misdeclared.settled();
  assert.deepEqual(reached, [], 'a fixtureHome that is the real home must be refused before the seam');
  assert.deepEqual(misdeclared.status(), {
    written: 0,
    rejected: 2,
    rejectedByReason: { 'fixture-home-is-real': 2 },
  });
  console.log(`fixtureRefused=${JSON.stringify(misdeclared.status())}`);
});

test('the same production adapter still writes a real session id (AC2 regression arm)', async () => {
  // The guard must be discriminating, not a blanket refusal: a real Cloudpit session id goes
  // through the production-wired adapter untouched, in the same run that refused the fixture.
  const reached: ContextEventDraft[] = [];
  const adapter = createSessionBlockedEventWriter({
    record: async (draft) => {
      reached.push(draft);
      return { ok: true, id: 'real', path: 'real' };
    },
    log: () => undefined,
  });
  adapter.write(APPROVAL_BLOCK);
  adapter.write(FIXTURE_BLOCK);
  await adapter.settled();

  assert.deepEqual(
    reached.map((draft) => draft.session),
    ['sess-approval'],
    'the real session must still reach the production seam; only the fixture is refused',
  );
  assert.deepEqual(adapter.status(), {
    written: 1,
    rejected: 1,
    rejectedByReason: { 'fixture-session': 1 },
  });
  console.log(`productionPassThrough=${JSON.stringify(adapter.status())}`);
});
