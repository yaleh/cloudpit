/**
 * AC-433 — the observation layer's `session.asking` / `session.answered` events, driven through
 * the REAL writer against three installed-schema readings.
 *
 * The criterion writes a temporary fleet home with, in turn:
 *
 *   · a v1 document that carries both kinds  → an asking turn then an answering turn each land
 *     exactly one line, with the fleet's `askId`/`messageId`/`contentRef` shape;
 *   · a v0 document that does NOT carry them → the same two events are refused as
 *     `invalid-kind`, nothing reaches the events directory, and nothing throws;
 *   · no document at all                    → `schema-unavailable`, nothing written.
 *
 * It also pins the two failure modes the task names:
 *
 *   · a repeated turn-end does not duplicate an asking row (the producer's emit-once key);
 *   · a record seam that throws is contained and counted — the observation layer never sees it.
 *
 * The producer is the real `createSessionDigestProducer`; only its world (transcript, store,
 * clock) is in memory. The writer, the schema reader and the stream are the production ones.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/context-events/tests/session-ask-event-writer.test.ts
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createContextEventWriter,
  createContextEvents,
  createSessionAskEventWriter,
  type SessionAskEventWriter,
} from '@/modules/context-events/index.js';
import { createSessionDigestProducer, type ObservedObject, type ObservationStore } from '@/modules/observation/index.js';
import type { SessionAskEvent } from '@/shared/types.js';

const CLOCK = 1_800_000_000_000;
const DAY = new Date(CLOCK).toISOString().slice(0, 10);
const SESSION_ID = 'ask-writer-session';
const PROJECT_PATH = '/repo/project';

/** The kinds quay-fleet's v0 document carries (its own table, not the writer's constant). */
const V0_KINDS: Record<string, { producer: 'cloudcli' | 'fleet'; group: string }> = {
  utterance: { producer: 'cloudcli', group: 'interaction' },
  'chip.shown': { producer: 'cloudcli', group: 'interaction' },
  'chip.picked': { producer: 'cloudcli', group: 'interaction' },
  'chip.redrawn': { producer: 'cloudcli', group: 'interaction' },
  focus: { producer: 'cloudcli', group: 'interaction' },
  'reference.resolved': { producer: 'cloudcli', group: 'interaction' },
  'send.previewed': { producer: 'cloudcli', group: 'interaction' },
  'send.confirmed': { producer: 'cloudcli', group: 'interaction' },
  'send.cancelled': { producer: 'cloudcli', group: 'interaction' },
  'task.status': { producer: 'fleet', group: 'flow' },
  'fanin.landed': { producer: 'fleet', group: 'flow' },
  'fanin.failed': { producer: 'fleet', group: 'flow' },
  'build.completed': { producer: 'cloudcli', group: 'flow' },
  'service.restarted': { producer: 'cloudcli', group: 'flow' },
  correction: { producer: 'cloudcli', group: 'learning' },
  'shadow.prediction': { producer: 'cloudcli', group: 'learning' },
  'shadow.prediction.outcome': { producer: 'cloudcli', group: 'learning' },
};

/** The v1 document: the same envelope description plus the two session-ask kinds. */
const V1_KINDS = {
  ...V0_KINDS,
  'session.asking': { producer: 'cloudcli' as const, group: 'interaction' },
  'session.answered': { producer: 'cloudcli' as const, group: 'interaction' },
};

/**
 * A descriptive document in the fleet's shipped shape (`row` + `kinds`). The writer reads the
 * kind set from it, which is exactly what the v0→v1 comparison below measures.
 */
function descriptiveSchema(version: number, kinds: Record<string, unknown>): Record<string, unknown> {
  return {
    version,
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
    kinds,
  };
}

const V0_SCHEMA = descriptiveSchema(0, V0_KINDS);
const V1_SCHEMA = descriptiveSchema(1, V1_KINDS);

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

const ASK_QUESTION = '有两个方案，你想先做哪一个？';

const ASKING_TURNS: Turn[] = [
  { role: 'user', id: 'u1', text: '你选一个方案' },
  { role: 'assistant', id: 'a1', text: ASK_QUESTION },
];

const ANSWERED_TURNS: Turn[] = [
  ...ASKING_TURNS,
  { role: 'user', id: 'u2', text: '先做方案 B' },
  { role: 'assistant', id: 'a2', text: '好，我按方案 B 开始。' },
];

/** A store that keeps revisions in memory, so the criterion needs no database. */
function createMemoryStore(): ObservationStore {
  const objects = new Map<string, ObservedObject>();
  return {
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
}

type Harness = {
  eventsDir: string;
  writer: SessionAskEventWriter;
  setTranscript: (raw: string) => void;
  turnEnd: () => Promise<ObservedObject | null>;
  logs: string[];
};

/** Builds the real producer over a real writer/stream and an in-memory transcript. */
function buildHarness(eventsDir: string, schemaPath: string, logs: string[] = []): Harness {
  let raw = '';
  const writer = createContextEventWriter({ eventsDir, schemaPath, now: () => CLOCK });
  const stream = createContextEvents({ writer, now: () => CLOCK });
  const eventWriter = createSessionAskEventWriter({
    record: (draft) => stream.record(draft),
    log: (line) => logs.push(line),
  });
  const producer = createSessionDigestProducer({
    store: createMemoryStore(),
    resolveSession: () => ({ title: '会话：提问写入器', projectPath: PROJECT_PATH, jsonlPath: '/tmp/ask-writer.jsonl' }),
    readTranscript: async () => raw,
    isObserved: () => true,
    now: () => CLOCK,
    eventWriter,
  });

  return {
    eventsDir,
    writer: eventWriter,
    setTranscript: (next) => {
      raw = next;
    },
    turnEnd: () =>
      producer.handleTurnEnd({
        appSessionId: SESSION_ID,
        runId: 'run-1',
        status: 'completed',
        completedAt: CLOCK,
        error: null,
      }),
    logs,
  };
}

/** One isolated fleet home; `schema` is `null` for the "no document installed" reading. */
async function withHome(
  schema: Record<string, unknown> | null,
  run: (context: { eventsDir: string; schemaPath: string }) => Promise<void>,
): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'session-ask-events-'));
  const eventsDir = path.join(homeDir, '.quay-fleet', 'context', 'events');
  const schemaPath = path.join(homeDir, 'fixture', 'context-event.schema.v0.json');
  try {
    if (schema !== null) {
      await mkdir(path.dirname(schemaPath), { recursive: true });
      await writeFile(schemaPath, JSON.stringify(schema), 'utf8');
    }
    await run({ eventsDir, schemaPath });
  } finally {
    await rm(homeDir, { recursive: true, force: true });
  }
}

/** The subset of an emitted row this criterion reads; `data` is the kind-specific object. */
type StreamRow = {
  v: number;
  id: string;
  at: string;
  source: string;
  kind: string;
  session?: string;
  project?: string;
  refs?: string[];
  data: Record<string, unknown>;
};

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

/** Drives one asking turn, one answering turn, then a repeated turn-end. */
async function askThenAnswer(harness: Harness): Promise<void> {
  harness.setTranscript(transcript(ASKING_TURNS));
  assert.notEqual(await harness.turnEnd(), null, 'the asking turn must produce a revision');
  await harness.writer.settled();

  harness.setTranscript(transcript(ANSWERED_TURNS));
  assert.notEqual(await harness.turnEnd(), null, 'the answering turn must produce a revision');
  await harness.writer.settled();

  // The same turn-end repeated must not re-state either row.
  assert.notEqual(await harness.turnEnd(), null, 'the repeated turn-end must still answer');
  await harness.writer.settled();
}

// ---------------------------------------------------------------------------------------------
// The three schema readings
// ---------------------------------------------------------------------------------------------

test('AC-433 v1: one asking and one answered row land, each exactly once and complete', async () => {
  await withHome(V1_SCHEMA, async ({ eventsDir, schemaPath }) => {
    const harness = buildHarness(eventsDir, schemaPath);
    await askThenAnswer(harness);

    const lines = await readDay(eventsDir);
    assert.equal(lines.length, 2, 'exactly one line per event, and the repeated turn-end writes none');
    const asking = lines.find((line) => line.kind === 'session.asking');
    const answered = lines.find((line) => line.kind === 'session.answered');
    assert.ok(asking, 'the asking row must be on the stream');
    assert.ok(answered, 'the answered row must be on the stream');

    // The envelope the writer minted.
    for (const row of [asking, answered]) {
      assert.equal(row.v, 0);
      assert.equal(row.source, 'cloudcli');
      assert.match(String(row.id), /^[0-9A-HJKMNP-TV-Z]{26}$/, 'the id is a ULID');
      assert.equal(typeof row.at, 'string');
    }

    // `session.asking`: askId `<sessionId>:<assistantMessageId>`, refs and contentRef name the
    // assistant message the question came from.
    assert.equal(asking.session, SESSION_ID);
    assert.equal(asking.project, PROJECT_PATH);
    assert.deepEqual(asking.refs, ['a1']);
    assert.equal(asking.data.askId, `${SESSION_ID}:a1`);
    assert.match(String(asking.data.askId), /^[^:]+:[^:]+$/, 'askId is <sessionId>:<assistantMessageId>');
    assert.equal(asking.data.messageId, 'a1');
    assert.equal(asking.data.revision, 1);
    assert.deepEqual(asking.data.contentRef, {
      resolver: 'cloudcli.session-ask',
      sessionId: SESSION_ID,
      messageId: 'a1',
    });

    // `session.answered`: the same askId, plus the user message that answered.
    assert.equal(answered.session, SESSION_ID);
    assert.equal(answered.data.askId, `${SESSION_ID}:a1`);
    assert.equal(answered.data.messageId, 'u2');

    assert.deepEqual(harness.writer.status(), { written: 2, rejected: 0, rejectedByReason: {} });
    console.log(`AC-433(v1) lines=${lines.length} kinds=${lines.map((line) => line.kind).join(',')} askId=${asking.data.askId}`);
  });
});

test('AC-433 v0: both rows are refused as invalid-kind, nothing is written, nothing throws', async () => {
  await withHome(V0_SCHEMA, async ({ eventsDir, schemaPath }) => {
    const harness = buildHarness(eventsDir, schemaPath);
    await assert.doesNotReject(() => askThenAnswer(harness), 'a refused event never reaches the observation layer');

    assert.deepEqual(await readDay(eventsDir), [], 'a v0 fleet must receive no partial rows');
    const status = harness.writer.status();
    assert.equal(status.written, 0);
    assert.equal(status.rejected, 2);
    assert.equal(status.rejectedByReason['invalid-kind'], 2, 'both kinds are absent from v0');
    assert.ok(harness.logs.some((line) => line.includes('invalid-kind')), 'the reason is logged for the operator');
    console.log(`AC-433(v0) rejected=${JSON.stringify(status.rejectedByReason)} lines=0`);
  });
});

test('AC-433 missing schema: schema-unavailable, nothing written, nothing throws', async () => {
  await withHome(null, async ({ eventsDir, schemaPath }) => {
    const harness = buildHarness(eventsDir, schemaPath);
    await assert.doesNotReject(() => askThenAnswer(harness), 'an absent schema never reaches the observation layer');

    assert.deepEqual(await readDay(eventsDir), []);
    const status = harness.writer.status();
    assert.equal(status.written, 0);
    assert.equal(status.rejected, 2);
    assert.equal(status.rejectedByReason['schema-unavailable'], 2);
    console.log(`AC-433(missing) rejected=${JSON.stringify(status.rejectedByReason)} lines=0`);
  });
});

// ---------------------------------------------------------------------------------------------
// The failure mode: a throwing record seam is contained and counted
// ---------------------------------------------------------------------------------------------

test('AC-433: a record seam that throws is contained, counted, and never thrown to the caller', async () => {
  const logs: string[] = [];
  const writer = createSessionAskEventWriter({
    record: () => {
      throw new Error('the context event stream is unwritable');
    },
    log: (line) => logs.push(line),
  });
  const asking: SessionAskEvent = {
    kind: 'session.asking',
    session: SESSION_ID,
    project: PROJECT_PATH,
    at: new Date(CLOCK).toISOString(),
    refs: ['a1'],
    data: { askId: `${SESSION_ID}:a1`, messageId: 'a1', revision: 1 },
  };

  assert.doesNotThrow(() => writer.write(asking), 'the observation seam must not learn the stream failed');
  await writer.settled();

  assert.equal(writer.status().written, 0);
  assert.equal(writer.status().rejected, 1);
  assert.equal(writer.status().rejectedByReason['write-failed'], 1);
  assert.ok(logs.some((line) => line.includes('unwritable')), 'the failure reason is logged once');
  console.log(`AC-433(throwing) rejected=${JSON.stringify(writer.status().rejectedByReason)}`);
});
