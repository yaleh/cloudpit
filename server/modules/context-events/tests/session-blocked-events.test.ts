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
 *     the same guard a typo hits, and the accepted arm proves the guard is not vacuous.
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
      session: 'optional CloudCLI session id',
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
  options: { recordThrows?: boolean } = {},
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
