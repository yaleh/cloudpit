/**
 * The session-lifecycle half of the context stream: `session.run.ended` (what a finished turn
 * turned out to be) and `session.closed` (a resident host went away, or a session was removed).
 *
 * WHAT IS REAL HERE. The writer is the production `createContextEventWriter` over a temporary
 * fleet home with a fixture schema; the adapter is the production one; the producers are the
 * REAL chat run registry and the REAL session-host manager, each driven at its own terminal
 * point (a `complete` frame; `closeHost`). Only the world around them is a stub — the transcript
 * is never read, the observation hook is a no-op, and no process is spawned.
 *
 * THE READINGS, in the order the criteria name them:
 *
 *   · completed / aborted / failed each write exactly one `session.run.ended`, and the outcome
 *     is the honest one (`aborted` wins; a completed run that also carried an error is `failed`);
 *   · closing a RESIDENT host writes one `session.closed` naming the session and the reason;
 *     closing a per-run host writes none (that is the ordinary end of a turn, not a close);
 *   · a record seam that throws is counted and NEVER reaches the chat caller.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/context-events/tests/session-run-events.test.ts
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createContextEventWriter,
  createContextEvents,
  createSessionRunEventWriter,
  sessionRunOutcome,
  type SessionRunEventWriter,
} from '@/modules/context-events/index.js';
import { createSessionHostManager } from '@/modules/session-hosts/index.js';
import { createChatRunRegistry } from '@/modules/websocket/index.js';
import type { IProviderHostDriver } from '@/shared/interfaces.js';
import { installSessionRunEventWriterPort } from '@/shared/ports/session-run-events.port.js';
import type { ProcessHost } from '@/shared/types.js';

const CLOCK = 1_800_000_000_000;
const DAY = new Date(CLOCK).toISOString().slice(0, 10);

/** The kinds a fleet document must carry for these readings; the envelope is the shared one. */
const LIFECYCLE_KINDS = {
  utterance: { producer: 'cloudcli' as const, group: 'interaction' },
  'session.run.ended': { producer: 'cloudcli' as const, group: 'lifecycle' },
  'session.closed': { producer: 'cloudcli' as const, group: 'lifecycle' },
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
  kinds: LIFECYCLE_KINDS,
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
  adapter: SessionRunEventWriter;
};

async function withHarness(
  run: (harness: Harness) => Promise<void>,
  options: { recordThrows?: boolean } = {},
): Promise<void> {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'session-run-events-'));
  const eventsDir = path.join(homeDir, '.quay-fleet', 'context', 'events');
  const schemaPath = path.join(homeDir, 'fixture', 'context-event.schema.v0.json');
  try {
    await mkdir(path.dirname(schemaPath), { recursive: true });
    await writeFile(schemaPath, JSON.stringify(SCHEMA), 'utf8');
    const writer = createContextEventWriter({ eventsDir, schemaPath, now: () => CLOCK });
    const stream = createContextEvents({ writer, now: () => CLOCK });
    const adapter = createSessionRunEventWriter({
      record: options.recordThrows
        ? async () => {
            throw new Error('the stream exploded');
          }
        : (draft) => stream.record(draft),
      log: () => undefined,
    });
    installSessionRunEventWriterPort(adapter);
    await run({ eventsDir, adapter });
  } finally {
    // The port is a process-wide slot: leaving the dead adapter installed would let a later
    // file's producer write into a directory this test just removed.
    installSessionRunEventWriterPort(null);
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

/** A registry whose only outside effect is the port; the observation hook is a no-op. */
function createRegistry() {
  return createChatRunRegistry({
    now: () => CLOCK,
    bootId: () => 'boot-1',
    onTurnEnd: () => undefined,
  });
}

/** The passive driver `live-host-for-session.test.ts` uses: no process, just the binding table. */
function createPassiveDriver(): IProviderHostDriver {
  return {
    multiplexedHost: false,
    async startHost(host: ProcessHost): Promise<ProcessHost> {
      return host;
    },
    async bind(): Promise<void> {},
    async submit(): Promise<void> {},
    async interrupt(): Promise<boolean> {
      return false;
    },
    async reconfigure(): Promise<'live' | 'next-turn'> {
      return 'live';
    },
    async unbind(): Promise<void> {},
    async closeHost(): Promise<void> {},
  };
}

// ---------------------------------------------------------------------------------------------
// The outcome mapping
// ---------------------------------------------------------------------------------------------

test('the outcome is honest: aborted wins, and a completed run with an error is failed', () => {
  assert.equal(sessionRunOutcome('completed', null), 'completed');
  assert.equal(sessionRunOutcome('aborted', null), 'aborted');
  assert.equal(sessionRunOutcome('aborted', 'cancelled'), 'aborted');
  assert.equal(sessionRunOutcome('completed', 'the tool exited 1'), 'failed');
});

// ---------------------------------------------------------------------------------------------
// session.run.ended, through the real run registry
// ---------------------------------------------------------------------------------------------

test('completed, aborted and failed each write exactly one session.run.ended', async () => {
  await withHarness(async ({ eventsDir, adapter }) => {
    const registry = createRegistry();

    const completed = registry.startRun({
      appSessionId: 'sess-completed',
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId: null,
    });
    assert.ok(completed);
    completed.writer.send({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'native-completed',
      exitCode: 0,
    });

    const aborted = registry.startRun({
      appSessionId: 'sess-aborted',
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId: null,
    });
    assert.ok(aborted);
    aborted.writer.send({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'native-aborted',
      exitCode: 1,
      aborted: true,
    });

    const failed = registry.startRun({
      appSessionId: 'sess-failed',
      provider: 'claude',
      providerSessionId: null,
      connection: null,
      userId: null,
    });
    assert.ok(failed);
    failed.writer.send({
      kind: 'error',
      provider: 'claude',
      sessionId: 'native-failed',
      text: 'the build step exited 1',
    });
    failed.writer.send({
      kind: 'complete',
      provider: 'claude',
      sessionId: 'native-failed',
      exitCode: 1,
    });

    await adapter.settled();

    const lines = (await readDay(eventsDir)).filter((line) => line.kind === 'session.run.ended');
    assert.equal(lines.length, 3, 'one terminal frame is one row; a duplicate complete writes none');

    const bySession = new Map(lines.map((line) => [line.session, line]));
    assert.deepEqual(
      bySession.get('sess-completed')?.data,
      { runId: completed.runId, outcome: 'completed' },
    );
    assert.deepEqual(
      bySession.get('sess-aborted')?.data,
      { runId: aborted.runId, outcome: 'aborted' },
      'the provider’s own aborted flag must survive as aborted, not be flattened into completed',
    );
    assert.deepEqual(
      bySession.get('sess-failed')?.data,
      { runId: failed.runId, outcome: 'failed' },
      'a completed run whose error frame was recorded is a failed run',
    );

    for (const line of lines) {
      assert.equal(line.v, 1);
      assert.equal(line.source, 'cloudcli');
      assert.match(String(line.id), /^[0-9A-HJKMNP-TV-Z]{26}$/);
      assert.equal(line.at, new Date(CLOCK).toISOString());
    }
    assert.deepEqual(adapter.status(), { written: 3, rejected: 0, rejectedByReason: {} });
  });
});

// ---------------------------------------------------------------------------------------------
// session.closed, through the real host manager
// ---------------------------------------------------------------------------------------------

test('closing a resident host writes one session.closed; closing a per-run host writes none', async () => {
  await withHarness(async ({ eventsDir, adapter }) => {
    const manager = createSessionHostManager();

    const resident = await manager.openHost({
      provider: 'claude',
      mode: 'resident',
      appSessionId: 'sess-resident',
      driver: createPassiveDriver(),
      pid: 4242,
    });
    manager.closeHost(resident.hostId, 'user');

    const perRun = await manager.openHost({
      provider: 'claude',
      mode: 'per-run',
      appSessionId: 'sess-per-run',
      driver: createPassiveDriver(),
    });
    manager.closeHost(perRun.hostId, 'idle');

    await adapter.settled();

    const lines = (await readDay(eventsDir)).filter((line) => line.kind === 'session.closed');
    assert.equal(lines.length, 1, 'only the resident host going away is a close');
    assert.equal(lines[0]?.session, 'sess-resident');
    assert.deepEqual(lines[0]?.data, { reason: 'user' });
    assert.equal(lines[0]?.at, new Date(CLOCK).toISOString());
  });
});

// ---------------------------------------------------------------------------------------------
// Failure containment
// ---------------------------------------------------------------------------------------------

test('a record seam that throws never reaches the chat caller', async () => {
  await withHarness(
    async ({ eventsDir, adapter }) => {
      const registry = createRegistry();
      const run = registry.startRun({
        appSessionId: 'sess-unwritable',
        provider: 'claude',
        providerSessionId: null,
        connection: null,
        userId: null,
      });
      assert.ok(run);

      assert.doesNotThrow(() => {
        run.writer.send({
          kind: 'complete',
          provider: 'claude',
          sessionId: 'native-unwritable',
          exitCode: 0,
        });
      }, 'the terminal frame must be recorded even when the event stream fails');

      assert.equal(
        run.events.filter((event) => event.kind === 'complete').length,
        1,
        'the run’s own transcript still received the terminal frame',
      );

      await adapter.settled();
      assert.deepEqual(adapter.status(), {
        written: 0,
        rejected: 1,
        rejectedByReason: { 'write-failed': 1 },
      });
      assert.deepEqual(await readDay(eventsDir), [], 'a failed append writes nothing');
    },
    { recordThrows: true },
  );
});
