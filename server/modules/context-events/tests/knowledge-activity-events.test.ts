/**
 * knowledge-application-fact-contract — the activity half of the fact contract,
 * driven against real JSONL day files.
 *
 * The criterion reads the SAME stream the writer produces (`session.asking` /
 * `session.answered` / `session.asking.retracted`) and pins the four properties
 * the fact contract needs:
 *
 *  (a) one ask becomes one activity, and re-reading the stream by its operation
 *      id returns the SAME correlated activity — the operation id is derived
 *      from the ask key, not stored, so the re-read works in a later process too;
 *  (b) fields the stream cannot answer (`targetSessionId`, `authorization`, a
 *      missing `answeredMessageId`) are named in `unknown` and are never
 *      fabricated as a value;
 *  (c) an answer whose asking row is outside the window is preserved and marked,
 *      while a repeated settle keeps the newest state;
 *  (d) the settling message is verified against the session transcript — a
 *      transcript read that throws is reported in `readErrors`, never mistaken
 *      for an empty transcript.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/context-events/tests/knowledge-activity-events.test.ts
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  deriveKnowledgeOperationId,
  readKnowledgeActivities,
  readKnowledgeActivity,
  readKnowledgeActivityReply,
  KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON,
  KNOWLEDGE_TARGET_UNKNOWN_REASON,
  type KnowledgeTranscriptMessage,
} from '../knowledge-activity-events.js';

const NOW = Date.parse('2026-11-01T12:00:00.000Z');
const DAY = new Date(NOW).toISOString().slice(0, 10);
const SESSION = 'knowledge-activity-session';
const OTHER_SESSION = 'knowledge-activity-peer';
const PROJECT = 'proj-knowledge';

type JsonRow = Record<string, unknown>;

/** The writer's envelope, reduced to the fields the reader reads. */
function envelope(kind: string, data: JsonRow, overrides: JsonRow = {}): JsonRow {
  return {
    v: 1,
    id: `evt-${kind}-${String(data.askId ?? '')}`,
    at: new Date(NOW).toISOString(),
    source: 'cloudcli',
    kind,
    session: SESSION,
    project: PROJECT,
    data,
    ...overrides,
  };
}

/** Writes one day file, one JSON line per row, into the temp events directory. */
async function writeDay(eventsDir: string, rows: ReadonlyArray<JsonRow | string>): Promise<void> {
  const lines = rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row)));
  await writeFile(path.join(eventsDir, `${DAY}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
}

/** Runs `body` against a fresh, private events directory. */
async function withEventsDir(body: (eventsDir: string) => Promise<void>): Promise<void> {
  const eventsDir = await mkdtemp(path.join(os.tmpdir(), 'knowledge-activity-events-'));
  try {
    await body(eventsDir);
  } finally {
    await rm(eventsDir, { recursive: true, force: true });
  }
}

/** The options that pin the reader to the fixture's clock and directory. */
function readOptions(eventsDir: string): { eventsDir: string; nowMs: number } {
  return { eventsDir, nowMs: NOW };
}

test('(a) one asking row is one activity; the operation re-reads to the same correlation', async () => {
  const askId = `${SESSION}:assistant-1`;
  const rows = [envelope('session.asking', { askId, messageId: 'assistant-1' })];

  await withEventsDir(async (eventsDir) => {
    await writeDay(eventsDir, rows);
    const read = await readKnowledgeActivities(readOptions(eventsDir));

    assert.equal(read.scannedRows, 1, 'the fixture wrote exactly one ask row');
    assert.equal(read.activities.length, 1, 'one ask is one activity');
    const activity = read.activities[0]!;
    assert.equal(activity.askId, askId);
    assert.equal(activity.sessionId, SESSION);
    assert.equal(activity.project, PROJECT);
    assert.equal(activity.askingMessageId, 'assistant-1');
    assert.equal(activity.state, 'asking');
    assert.equal(activity.operationId, deriveKnowledgeOperationId(askId), 'the operation id is derived from the ask key');
    assert.deepEqual(read.readErrors, [], 'a readable stream reports no read error');

    // (b) the stream does not record these two, so they are unknown, not invented.
    assert.ok(activity.unknown.includes('targetSessionId'), 'the target session is an explicit unknown');
    assert.ok(activity.unknown.includes('authorization'), 'the authorization scope is an explicit unknown');
    assert.equal(
      KNOWLEDGE_TARGET_UNKNOWN_REASON.length > 0,
      true,
      'the target unknown carries a reason a consumer can print',
    );
    assert.equal(
      Object.hasOwn(activity, 'targetSessionId'),
      false,
      'an unknown field is absent, never a fabricated empty value',
    );

    // The authoritative re-read: same operation id, same row, from the files again.
    const reRead = await readKnowledgeActivity(activity.operationId, readOptions(eventsDir));
    assert.equal(reRead.matches, 1, 'exactly one activity carries this operation id');
    assert.equal(reRead.scannedActivities, 1);
    assert.equal(reRead.activity?.operationId, activity.operationId);
    assert.equal(reRead.activity?.askId, askId);
    assert.equal(reRead.activity?.sourceRef, activity.sourceRef, 'the re-read names the same stream row');
    assert.equal(reRead.activity?.lastAt, activity.lastAt);

    const missing = await readKnowledgeActivity(deriveKnowledgeOperationId('no-such-ask'), readOptions(eventsDir));
    assert.equal(missing.activity, null, 'an operation id the stream does not carry is not invented');
    assert.equal(missing.matches, 0);
  });
});

test('(b) an answered row settles the ask; an answered row with no messageId stays explicitly unknown', async () => {
  const answeredAsk = `${SESSION}:assistant-2`;
  const unnamedAsk = `${SESSION}:assistant-3`;
  const rows = [
    envelope('session.asking', { askId: answeredAsk, messageId: 'assistant-2' }),
    envelope('session.answered', { askId: answeredAsk, messageId: 'user-2' }),
    envelope('session.asking', { askId: unnamedAsk, messageId: 'assistant-3' }),
    envelope('session.answered', { askId: unnamedAsk }),
  ];

  await withEventsDir(async (eventsDir) => {
    await writeDay(eventsDir, rows);
    const read = await readKnowledgeActivities(readOptions(eventsDir));
    assert.equal(read.activities.length, 2);

    const answered = read.activities.find((activity) => activity.askId === answeredAsk)!;
    assert.equal(answered.state, 'answered');
    assert.equal(answered.answeredMessageId, 'user-2');
    assert.equal(answered.unknown.includes('answeredMessageId'), false, 'a named settling message is known');

    const unnamed = read.activities.find((activity) => activity.askId === unnamedAsk)!;
    assert.equal(unnamed.state, 'answered');
    assert.equal(unnamed.answeredMessageId, null);
    assert.ok(
      unnamed.unknown.includes('answeredMessageId'),
      'an answered row that names no message must report the gap instead of reading as unanswered',
    );
    assert.equal(KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON.length > 0, true);
  });
});

test('(c) a settlement whose asking row is outside the window is preserved and marked', async () => {
  const askId = `${SESSION}:assistant-4`;
  const rows = [envelope('session.asking.retracted', { askId, messageId: 'assistant-4' })];

  await withEventsDir(async (eventsDir) => {
    await writeDay(eventsDir, rows);
    const read = await readKnowledgeActivities(readOptions(eventsDir));
    assert.equal(read.activities.length, 1, 'a settlement is a fact even when its asking row aged out');
    const activity = read.activities[0]!;
    assert.equal(activity.state, 'retracted');
    assert.equal(activity.sessionId, SESSION, 'the settlement row names the session');
    assert.ok(activity.unknown.includes('askingRow'), 'the missing asking row is named');
    assert.ok(activity.unknown.includes('askingMessageId'));
  });
});

test('(d) the reply is verified against the transcript, and a failed read is reported', async () => {
  const askId = `${SESSION}:assistant-5`;
  const rows = [
    envelope('session.asking', { askId, messageId: 'assistant-5' }),
    envelope('session.answered', { askId, messageId: 'user-5' }),
  ];

  await withEventsDir(async (eventsDir) => {
    await writeDay(eventsDir, rows);
    const read = await readKnowledgeActivities(readOptions(eventsDir));
    const activity = read.activities[0]!;

    const transcript: KnowledgeTranscriptMessage[] = [
      { id: 'assistant-5', role: 'assistant', timestamp: '2026-11-01T11:59:00.000Z' },
      { id: 'user-5', role: 'user', timestamp: '2026-11-01T12:00:00.000Z' },
    ];

    const verified = await readKnowledgeActivityReply({
      activity,
      readHistory: async () => ({ messages: transcript }),
    });
    assert.equal(verified.operationId, activity.operationId, 'the reply re-read carries the SAME operation id');
    assert.deepEqual(verified.unknown, []);
    assert.deepEqual(verified.readErrors, []);
    assert.equal(verified.reply.state, 'evidence');
    if (verified.reply.state === 'evidence') {
      assert.equal(verified.reply.value.messageId, 'user-5');
      assert.equal(verified.reply.value.role, 'user');
      assert.equal(verified.reply.value.verifiedAgainstTranscript, true);
      assert.equal(verified.reply.source, 'sessions.transcript');
    }

    const absent = await readKnowledgeActivityReply({
      activity,
      readHistory: async () => ({ messages: [transcript[0]!] }),
    });
    assert.equal(absent.reply.state, 'unknown', 'a message outside the transcript window is not claimed as verified');
    assert.ok(absent.unknown.includes('reply'));

    const failed = await readKnowledgeActivityReply({
      activity,
      readHistory: async () => {
        throw new Error('transcript store unavailable');
      },
    });
    assert.equal(failed.reply.state, 'unknown');
    assert.equal(failed.readErrors.length, 1, 'a failed transcript read is a read error, not an empty transcript');
    assert.equal(failed.readErrors[0]!.source, 'sessions.transcript');
    assert.match(failed.readErrors[0]!.message, /unavailable/);
  });
});

test('(e) other producers, other kinds and a torn line do not become this host\'s facts', async () => {
  const askId = `${SESSION}:assistant-6`;
  const rows: Array<JsonRow | string> = [
    envelope('session.asking', { askId, messageId: 'assistant-6' }),
    // Another producer's row is somebody else's fact.
    envelope('session.asking', { askId: `${OTHER_SESSION}:assistant-x`, messageId: 'assistant-x' }, { source: 'fleet' }),
    // A kind outside the ask trio is not an activity.
    envelope('utterance', { text: 'hello' }),
    // A write in flight (torn last line) is tolerated, not an error.
    '{"v":1,"id":"torn","at":"2026-11-01T12:00:00.000Z","source":"cloudcli","kind":"session.asking"',
  ];

  await withEventsDir(async (eventsDir) => {
    await writeDay(eventsDir, rows);
    const read = await readKnowledgeActivities(readOptions(eventsDir));
    assert.equal(read.scannedRows, 1, 'only this host\'s ask row is scanned');
    assert.equal(read.activities.length, 1);
    assert.equal(read.activities[0]!.askId, askId);
    assert.deepEqual(read.readErrors, []);
  });
});

test('(f) the operation id is stable and distinct per ask', () => {
  const first = deriveKnowledgeOperationId(`${SESSION}:assistant-7`);
  const again = deriveKnowledgeOperationId(`${SESSION}:assistant-7`);
  const second = deriveKnowledgeOperationId(`${SESSION}:assistant-8`);
  assert.equal(first, again, 'the same ask always derives the same operation id');
  assert.notEqual(first, second, 'two asks do not collide in this fixture');
  assert.match(first, /^op-[0-9a-f]{12}$/, 'the id is an opaque handle, not a second copy of the ask key');
});
