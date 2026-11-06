import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexAppServerConnection,
  type CodexAppServerTransport,
} from '@/modules/providers/list/codex/app-server/codex-app-server.connection.js';
import { CodexHostDriver } from '@/modules/providers/list/codex/host/codex-host-driver.provider.js';
import { providerCapabilitiesService } from '@/modules/providers/services/provider-capabilities.service.js';
import { createProviderRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { sessionHostManager } from '@/modules/session-hosts/index.js';
import type { IProvider, IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  HostTurnInput,
  LLMProvider,
  ProcessHost,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';

/**
 * The criterion for AC-436: busy input on a resident Codex host.
 *
 * The protocol facts this file is graded against were measured on the locked
 * `@openai/codex` 0.153.4 (`tmp/codex-appserver-exp-NuPHhk/REPORT.md`, raw
 * readings in `e2-reading.json` and `e3-reading.json`):
 *
 * - `thread/queue/add` is accepted while `thread/status` is `active`; the reply
 *   carries `queuedSubmission.id` and echoes `clientUserMessageId` (E2).
 * - `thread/queue/list` is the depth truth, and `thread/queue/delete` is how a
 *   still-queued submission leaves the queue (E2).
 * - A normal `turn/completed` drains the queue by itself — the test script never
 *   called `thread/queue/start` and the next turn still started (E2:
 *   `autoStartedAfterFirstTurn=true`).
 * - A `turn/interrupted` keeps the queue but does NOT drain it (E3 measured
 *   `autoStartedAfterInterrupt=false`, 15s window); the next turn starts only
 *   after an explicit `thread/queue/start {queuedSubmissionId}` (E3).
 * - The interrupted turn's terminal status is `interrupted`, not `failed`, and
 *   the process pid never changes (E3).
 *
 * The transport below is an in-memory JSON-RPC server over the same protocol
 * surface. No real Codex process is spawned, no database is opened, and no
 * network is touched: every reading comes from a fake that reproduces the
 * measured notification order, including `thread/queue/changed`.
 */

type Call = { method: string; params: Record<string, unknown> };

type LoggedEvent =
  | { kind: 'call'; method: string; params: Record<string, unknown> }
  | { kind: 'notification'; method: string; params: Record<string, unknown> };

type FakeQueuedSubmission = {
  id: string;
  clientUserMessageId: string;
  text: string;
};

/** What one `thread/start` / `thread/queue/start` reply returned, for the readings. */
type FakeTransportTurn = { id: string; threadId: string };

class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid = 515_151;

  readonly calls: Call[] = [];
  /** Every call and every notification, in the order the fake emitted them. */
  readonly log: LoggedEvent[] = [];
  /** The process's own submission queue — the depth truth `thread/queue/list` reports. */
  readonly queue: FakeQueuedSubmission[] = [];
  /** Whether a started turn completes by itself. The busy legs hold it open. */
  autoComplete = true;
  /** A normal completion drains the queue by itself (E2). */
  autoDrainOnComplete = true;
  /** An interrupt does NOT drain the queue (E3); the driver must call queue/start. */
  autoDrainAfterInterrupt = false;
  /** Holds `thread/queue/start` so the criterion can read the queue between the two. */
  holdQueueStart = false;

  private messageHandler: ((frame: string) => void) | null = null;
  private exitHandler: ((reason: string) => void) | null = null;
  private alive = true;
  private threadSerial = 0;
  private turnSerial = 0;
  private queueSerial = 0;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private heldQueueStart: { requestId: number | string | undefined; params: Record<string, unknown> } | null = null;

  write(frame: string): void {
    const message = JSON.parse(frame) as { id?: number | string; method?: string; params?: unknown };
    if (typeof message.method !== 'string') {
      return;
    }
    const params = (message.params ?? {}) as Record<string, unknown>;
    this.calls.push({ method: message.method, params });
    this.log.push({ kind: 'call', method: message.method, params });
    switch (message.method) {
      case 'initialize':
        this.reply(message.id, { userAgent: 'fake-codex/0.153.4', codexHome: '/fake' });
        return;
      case 'initialized':
        return;
      case 'thread/start': {
        const id = `thread-${++this.threadSerial}`;
        this.threadId = id;
        this.reply(message.id, { thread: { id, status: { type: 'idle' } } });
        this.emit('thread/started', { thread: { id, status: { type: 'idle' } } });
        return;
      }
      case 'thread/resume': {
        const id = String(params.threadId ?? this.threadId ?? '');
        this.reply(message.id, { thread: { id, status: { type: 'idle' } } });
        return;
      }
      case 'turn/start':
        this.reply(message.id, { turn: { id: this.nextTurnId(), status: 'inProgress' } });
        this.startTurn(this.turnSerial.toString());
        return;
      case 'turn/interrupt': {
        const turnId = String(params.turnId ?? this.activeTurnId ?? '');
        this.reply(message.id, {});
        this.finishTurn(turnId, 'interrupted');
        return;
      }
      case 'thread/queue/add': {
        const input = Array.isArray(params.input) ? params.input : [];
        const first = input.find((part) => part && typeof part === 'object');
        const text = first && typeof (first as Record<string, unknown>).text === 'string'
          ? String((first as Record<string, unknown>).text)
          : '';
        const clientUserMessageId = typeof params.clientUserMessageId === 'string'
          ? params.clientUserMessageId
          : `generated-${++this.queueSerial}`;
        const submission: FakeQueuedSubmission = {
          id: `qs-${++this.queueSerial}`,
          clientUserMessageId,
          text,
        };
        this.queue.push(submission);
        this.reply(message.id, {
          queuedSubmission: {
            id: submission.id,
            input,
            clientUserMessageId: submission.clientUserMessageId,
          },
        });
        this.emit('thread/queue/changed', { threadId: this.threadId });
        return;
      }
      case 'thread/queue/list':
        this.reply(message.id, { data: this.queue.map((entry) => this.toWire(entry)), nextCursor: null });
        return;
      case 'thread/queue/delete': {
        const id = String(params.queuedSubmissionId ?? '');
        const index = this.queue.findIndex((entry) => entry.id === id);
        if (index === -1) {
          this.reply(message.id, { deleted: false });
          return;
        }
        this.queue.splice(index, 1);
        this.reply(message.id, { deleted: true });
        this.emit('thread/queue/changed', { threadId: this.threadId });
        return;
      }
      case 'thread/queue/start': {
        if (this.holdQueueStart) {
          this.heldQueueStart = { requestId: message.id, params };
          return;
        }
        this.startQueuedSubmission(message.id, params);
        return;
      }
      default:
        return;
    }
  }

  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }

  onExit(handler: (reason: string) => void): void {
    this.exitHandler = handler;
  }

  isAlive(): boolean {
    return this.alive;
  }

  terminate(): void {
    this.alive = false;
  }

  // -------------------------------------------------- test-only controls ---

  /** Ends the turn in flight with the given status, as the app-server would. */
  finishActiveTurn(status: 'completed' | 'interrupted' = 'completed'): void {
    if (!this.activeTurnId) {
      throw new Error('finishActiveTurn called with no turn in flight');
    }
    this.finishTurn(this.activeTurnId, status);
  }

  /** Deletes one queued submission from the process side, with no driver delete. */
  deleteQueuedExternally(queuedSubmissionId: string): void {
    const index = this.queue.findIndex((entry) => entry.id === queuedSubmissionId);
    if (index === -1) {
      throw new Error(`no queued submission ${queuedSubmissionId}`);
    }
    this.queue.splice(index, 1);
    this.emit('thread/queue/changed', { threadId: this.threadId });
  }

  /** Releases a `thread/queue/start` the fake was holding. */
  releaseQueueStart(): void {
    const held = this.heldQueueStart;
    if (!held) {
      throw new Error('releaseQueueStart called with nothing held');
    }
    this.heldQueueStart = null;
    this.startQueuedSubmission(held.requestId, held.params);
  }

  /** How many `turn/started` notifications the fake emitted. */
  turnStartedCount(): number {
    return this.log.filter(
      (event) => event.kind === 'notification' && event.method === 'turn/started',
    ).length;
  }

  /** The number of `turn/started` notifications between two log indexes. */
  turnStartedBetween(fromIndex: number, toIndex: number): number {
    return this.log
      .slice(fromIndex, toIndex)
      .filter((event) => event.kind === 'notification' && event.method === 'turn/started').length;
  }

  /** The log index of the first completed/interrupted terminal notification. */
  terminalIndex(status: 'completed' | 'interrupted'): number {
    return this.log.findIndex(
      (event) => event.kind === 'notification'
        && event.method === 'turn/completed'
        && (event.params.turn as Record<string, unknown> | undefined)?.status === status,
    );
  }

  /** The log index of the first call to `method`. */
  callIndex(method: string): number {
    return this.log.findIndex((event) => event.kind === 'call' && event.method === method);
  }

  // ------------------------------------------------------------ internals ---

  private nextTurnId(): string {
    this.turnSerial += 1;
    return `turn-${this.turnSerial}`;
  }

  /** Starts the turn the `turn/start` reply just answered for. */
  private startTurn(serial: string): void {
    const turnId = `turn-${serial}`;
    this.activeTurnId = turnId;
    this.emit('turn/started', {
      threadId: this.threadId,
      turn: { id: turnId, status: 'inProgress' },
    });
    if (this.autoComplete) {
      this.finishTurn(turnId, 'completed');
    }
  }

  private startQueuedSubmission(
    requestId: number | string | undefined,
    params: Record<string, unknown>,
  ): void {
    const id = String(params.queuedSubmissionId ?? '');
    const index = this.queue.findIndex((entry) => entry.id === id);
    if (index === -1) {
      this.reply(requestId, {});
      return;
    }
    this.queue.splice(index, 1);
    const turnId = this.nextTurnId();
    this.reply(requestId, { turn: { id: turnId, status: 'inProgress' } });
    this.emit('thread/queue/changed', { threadId: this.threadId });
    this.activeTurnId = turnId;
    this.emit('turn/started', {
      threadId: this.threadId,
      turn: { id: turnId, status: 'inProgress' },
    });
    if (this.autoComplete) {
      this.finishTurn(turnId, 'completed');
    }
  }

  private finishTurn(turnId: string, status: 'completed' | 'interrupted'): void {
    this.activeTurnId = null;
    this.emit('turn/completed', {
      threadId: this.threadId,
      turn: { id: turnId, status },
    });
    const drains = status === 'completed' ? this.autoDrainOnComplete : this.autoDrainAfterInterrupt;
    if (!drains || this.queue.length === 0) {
      return;
    }
    const next = this.queue[0];
    this.queue.splice(0, 1);
    const nextTurnId = this.nextTurnId();
    this.emit('thread/queue/changed', { threadId: this.threadId });
    this.activeTurnId = nextTurnId;
    this.emit('turn/started', {
      threadId: this.threadId,
      turn: { id: nextTurnId, status: 'inProgress' },
    });
    void next;
    if (this.autoComplete) {
      this.finishTurn(nextTurnId, 'completed');
    }
  }

  private toWire(entry: FakeQueuedSubmission): Record<string, unknown> {
    return {
      id: entry.id,
      input: [{ type: 'text', text: entry.text, text_elements: [] }],
      clientUserMessageId: entry.clientUserMessageId,
    };
  }

  private reply(id: number | string | undefined, result: unknown): void {
    this.deliver({ jsonrpc: '2.0', id, result });
  }

  private emit(method: string, params: unknown): void {
    const record = (params ?? {}) as Record<string, unknown>;
    this.log.push({ kind: 'notification', method, params: record });
    this.deliver({ jsonrpc: '2.0', method, params });
  }

  private deliver(frame: unknown): void {
    if (this.alive) {
      this.messageHandler?.(JSON.stringify(frame));
    }
  }
}

function createSink(): IProviderHostDriverSink {
  return {
    leaseAdded: () => {},
    leaseRemoved: () => {},
    activity: () => {},
    identity: () => {},
    exited: () => {},
  };
}

function createHost(): ProcessHost {
  return {
    hostId: 'codex-queue-host-1',
    provider: 'codex',
    mode: 'resident',
    state: 'starting',
    pid: null,
    startedAt: Date.now(),
    bindings: new Map(),
    closeReason: null,
  };
}

function createBinding(appSessionId: string): SessionBinding {
  return {
    appSessionId,
    providerSessionId: null,
    state: 'idle',
    leases: [],
    lastActivityAt: Date.now(),
    peerName: null,
    detachReason: null,
  };
}

function turn(command: string): HostTurnInput {
  return { command, options: {} };
}

type Writer = { writer: ProviderRuntimeWriter; frames: Array<Record<string, unknown>> };

function createWriter(): Writer {
  const frames: Array<Record<string, unknown>> = [];
  return {
    frames,
    writer: {
      send(data: unknown) {
        if (data && typeof data === 'object') {
          frames.push(data as Record<string, unknown>);
        }
      },
    },
  };
}

function createDriver(transport: FakeAppServerTransport): { driver: CodexHostDriver; transport: FakeAppServerTransport } {
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
  });
  return { driver, transport };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** A promise plus the flags a "still pending" reading needs. */
function track(promise: Promise<unknown>): {
  promise: Promise<unknown>;
  settled: () => boolean;
  rejected: () => boolean;
  reason: () => unknown;
} {
  let didSettle = false;
  let didReject = false;
  let failure: unknown = null;
  const tracked = promise.then(
    (value) => {
      didSettle = true;
      return value;
    },
    (error) => {
      didSettle = true;
      didReject = true;
      failure = error;
      throw error;
    },
  );
  return {
    promise: tracked,
    settled: () => didSettle,
    rejected: () => didReject,
    reason: () => failure,
  };
}

// ---------------------------
//----------------- NAMED ASSERTIONS (shared by the real legs and AC8) ------------
/**
 * One busy-send reading. A driver that refuses instead of queueing drives the
 * same assertion into the red that a correct driver passes — which is what makes
 * AC8 and mutation A load-bearing rather than decorative.
 */
type BusyReading = {
  queueAddCalls: number;
  refusal: string | null;
  stillPending: boolean;
  rejected: boolean;
  queuedUuid: string | null;
  listUuid: string | null;
  queuedText: string | null;
  queueAddThreadId: string | null;
  queueAddClientUuid: string | null;
};

function assertBusyAccepted(reading: BusyReading): void {
  assert.equal(reading.refusal, null, `a busy send must not be refused (refusal=${String(reading.refusal)})`);
  assert.equal(reading.queueAddCalls, 1, `the busy send must be one thread/queue/add (got ${reading.queueAddCalls})`);
  assert.equal(reading.stillPending, true, 'the queued run must still be pending while the first turn is in flight');
  assert.equal(reading.rejected, false, 'the queued run must not reject');
  assert.ok(reading.queuedUuid, 'the queued send must carry an app uuid');
  assert.equal(
    reading.queuedUuid,
    reading.listUuid,
    `queuedInputUuid must equal the queue/list clientUserMessageId (queued=${String(reading.queuedUuid)} list=${String(reading.listUuid)})`,
  );
  assert.equal(reading.queuedText, 'queued while busy', 'thread/queue/add must carry the command text');
  assert.equal(
    reading.queueAddClientUuid,
    reading.queuedUuid,
    'the add params and the queue reading must name one uuid',
  );
}

type InterruptQueueReading = {
  interruptStatus: string;
  queuedAfterInterrupt: number;
  autoStartedAfterInterrupt: boolean;
  queueStartCalls: number;
  queueStartThreadId: string | null;
  queueStartSubmissionId: string | null;
  expectedHeadSubmissionId: string | null;
  threadIdBefore: string | null;
  threadIdAfter: string | null;
  pidBefore: number | null;
  pidAfter: number | null;
  aliveBefore: boolean;
  aliveAfter: boolean;
};

function assertExplicitQueueStartAfterInterrupt(reading: InterruptQueueReading): void {
  assert.equal(reading.aliveBefore, true, 'the transport reported the process gone before interrupt');
  assert.equal(reading.aliveAfter, true, 'the transport reported the process gone after interrupt');
  assert.equal(reading.pidAfter, reading.pidBefore, `pid changed across interrupt (${reading.pidBefore} -> ${reading.pidAfter})`);
  assert.equal(
    reading.threadIdAfter,
    reading.threadIdBefore,
    `threadId changed across interrupt (${reading.threadIdBefore} -> ${reading.threadIdAfter})`,
  );
  assert.equal(reading.interruptStatus, 'interrupted', `interruptStatus=${reading.interruptStatus} expected=interrupted`);
  assert.equal(
    reading.queuedAfterInterrupt,
    1,
    `the queue must survive the interrupt (queuedAfterInterrupt=${reading.queuedAfterInterrupt})`,
  );
  assert.equal(
    reading.autoStartedAfterInterrupt,
    false,
    'an interrupted thread must NOT auto-start the next queued turn (E3)',
  );
  assert.equal(
    reading.queueStartCalls,
    1,
    `the driver must push the queue exactly once with thread/queue/start (got ${reading.queueStartCalls})`,
  );
  assert.equal(
    reading.queueStartSubmissionId,
    reading.expectedHeadSubmissionId,
    `thread/queue/start must name the head submission (got ${String(reading.queueStartSubmissionId)})`,
  );
  assert.equal(
    reading.queueStartThreadId,
    reading.threadIdBefore,
    'thread/queue/start must name the same thread',
  );
}

// ---------------------------
//----------------- THE LEGS ------------

test('busy input is queued, not refused (AC2)', async () => {
  const { driver, transport } = createDriver(new FakeAppServerTransport());
  const host = createHost();
  transport.autoComplete = false;
  const firstWriter = createWriter();
  const queuedWriter = createWriter();
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-busy'));

    const first = track(driver.run('session-busy', turn('first turn'), firstWriter.writer, {} as never));
    await waitFor(
      () => driver.readSession('session-busy').turnStatus === 'inProgress',
      'the first turn to be in flight',
    );

    const queued = track(driver.run('session-busy', turn('queued while busy'), queuedWriter.writer, {} as never));
    await waitFor(
      () => transport.calls.some((call) => call.method === 'thread/queue/add'),
      'the busy send to reach thread/queue/add',
    );
    // Let the queue/add reply and the mirror refresh settle before reading.
    await waitFor(
      () => (driver.pendingQueuedInputs('session-busy')?.items ?? 0) === 1,
      'the queue/add to land and the mirror to see it',
    );

    const addCall = transport.calls.find((call) => call.method === 'thread/queue/add');
    const listRow = transport.queue[0];
    const reading: BusyReading = {
      queueAddCalls: transport.calls.filter((call) => call.method === 'thread/queue/add').length,
      refusal: null,
      stillPending: !queued.settled() && !queued.rejected(),
      rejected: queued.rejected(),
      queuedUuid: driver.queuedInputUuid('session-busy'),
      listUuid: listRow?.clientUserMessageId ?? null,
      queuedText: typeof addCall?.params.input === 'object' ? String(
        (addCall.params.input as Array<Record<string, unknown>>)[0]?.text ?? '',
      ) : null,
      queueAddThreadId: typeof addCall?.params.threadId === 'string' ? addCall.params.threadId : null,
      queueAddClientUuid: typeof addCall?.params.clientUserMessageId === 'string'
        ? addCall.params.clientUserMessageId
        : null,
    };
    console.log(
      `busyOutcome=queued queueAddCalls=${reading.queueAddCalls} refusal=none ` +
        `threadId=${String(reading.queueAddThreadId)} queuedUuid=${String(reading.queuedUuid)} ` +
        `listUuid=${String(reading.listUuid)} stillPending=${reading.stillPending}`,
    );
    assert.equal(
      reading.queueAddThreadId,
      driver.readSession('session-busy').threadId,
      'thread/queue/add must name the current thread',
    );
    assertBusyAccepted(reading);

    // Frames of the queued turn reach the writer the queued run was handed.
    // The driver normalizes app-server notifications before writing, so the
    // queued turn's terminal frame is a `complete`, not a raw `turn/completed`.
    transport.autoComplete = true;
    transport.finishActiveTurn('completed');
    await first.promise;
    await queued.promise;
    assert.equal(queued.rejected(), false, 'the queued run must resolve when its turn completes');
    await waitFor(
      () => queuedWriter.frames.some((frame) => frame.kind === 'complete'),
      'the queued run\'s writer to receive its terminal complete',
    );
    const queuedCompletes = queuedWriter.frames.filter((frame) => frame.kind === 'complete').length;
    const firstCompletes = firstWriter.frames.filter((frame) => frame.kind === 'complete').length;
    console.log(
      `queuedRunResolved=${queued.settled()} queuedKinds=${queuedWriter.frames.map((frame) => String(frame.kind)).join(',')} `
        + `queuedCompletes=${queuedCompletes} firstCompletes=${firstCompletes}`,
    );
    assert.equal(queuedCompletes, 1, 'the queued writer must see exactly its own terminal complete');
    assert.equal(firstCompletes, 1, 'the first writer must not receive the queued turn\'s terminal complete');
    assert.equal(
      transport.calls.filter((call) => call.method === 'thread/queue/start').length,
      0,
      'a normal completion must not need an explicit queue/start',
    );
    assert.deepEqual(transport.queue, [], 'the queue must be empty after the drain');
    assert.equal(driver.pendingQueuedInputs('session-busy')?.items, 0);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('queue/list is the depth truth, including an external delete (AC3)', async () => {
  const { driver, transport } = createDriver(new FakeAppServerTransport());
  const host = createHost();
  transport.autoComplete = false;
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-depth'));

    const first = track(driver.run('session-depth', turn('first turn'), createWriter().writer, {} as never));
    await waitFor(() => driver.readSession('session-depth').turnStatus === 'inProgress', 'the first turn');

    const second = track(driver.run('session-depth', turn('second queued'), createWriter().writer, {} as never));
    await waitFor(
      () => (driver.pendingQueuedInputs('session-depth')?.items ?? 0) === 1,
      'the second submission to appear in the mirror',
    );
    const third = track(driver.run('session-depth', turn('third queued'), createWriter().writer, {} as never));
    await waitFor(
      () => (driver.pendingQueuedInputs('session-depth')?.items ?? 0) === 2,
      'the third submission to appear in the mirror',
    );

    const afterTwo = driver.pendingQueuedInputs('session-depth');
    const transportBytesAfterTwo = transport.queue.reduce((sum, entry) => sum + Buffer.byteLength(entry.text, 'utf8'), 0);
    console.log(`depthAfterTwo=${afterTwo?.items} bytes=${afterTwo?.bytes} transportDepth=${transport.queue.length}`);
    assert.equal(afterTwo?.items, 2, 'two queued submissions must read as depth 2');
    assert.equal(afterTwo?.items, transport.queue.length, 'the mirror must equal thread/queue/list');
    assert.equal(afterTwo?.bytes, transportBytesAfterTwo, 'the byte reading must be the list\'s own text bytes');

    // The process deletes one submission; this driver sends no delete.
    const removed = transport.queue[0];
    transport.deleteQueuedExternally(removed.id);
    await waitFor(
      () => (driver.pendingQueuedInputs('session-depth')?.items ?? 0) === 1,
      'the mirror to follow the external delete',
    );
    const afterExternalDelete = driver.pendingQueuedInputs('session-depth');
    const transportBytesAfterDelete = transport.queue.reduce(
      (sum, entry) => sum + Buffer.byteLength(entry.text, 'utf8'),
      0,
    );
    const deleteCalls = transport.calls.filter((call) => call.method === 'thread/queue/delete').length;
    console.log(
      `depthAfterExternalDelete=${afterExternalDelete?.items} bytes=${afterExternalDelete?.bytes} ` +
        `transportDepth=${transport.queue.length} deleteCalls=${deleteCalls}`,
    );
    assert.equal(afterExternalDelete?.items, 1, 'an external delete must lower the depth by one');
    assert.equal(afterExternalDelete?.items, transport.queue.length);
    assert.equal(afterExternalDelete?.bytes, transportBytesAfterDelete);
    assert.equal(deleteCalls, 0, 'the driver must not have sent thread/queue/delete');

    // Drain what is still queued so the run settles before teardown.
    transport.autoComplete = true;
    transport.finishActiveTurn('completed');
    await first.promise;
    await third.promise;
    // Its submission was deleted externally, so closeHost is what settles the
    // run; the run's trailing readSession then has no binding to report on.
    // Swallow that teardown rejection so it cannot leak out of the test.
    void second.promise.catch(() => {});
    await waitFor(() => transport.queue.length === 0, 'the remaining submission to be drained');
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('withdrawal reads withdrawn / already-started / unknown (AC4)', async () => {
  const { driver, transport } = createDriver(new FakeAppServerTransport());
  const host = createHost();
  transport.autoComplete = false;
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-cancel'));

    const first = track(driver.run('session-cancel', turn('first turn'), createWriter().writer, {} as never));
    await waitFor(() => driver.readSession('session-cancel').turnStatus === 'inProgress', 'the first turn');

    const toWithdraw = track(driver.run('session-cancel', turn('withdraw me'), createWriter().writer, {} as never));
    await waitFor(() => (driver.pendingQueuedInputs('session-cancel')?.items ?? 0) === 1, 'the withdrawable submission');
    const toStart = track(driver.run('session-cancel', turn('let it start'), createWriter().writer, {} as never));
    await waitFor(() => (driver.pendingQueuedInputs('session-cancel')?.items ?? 0) === 2, 'the second submission');

    const withdrawUuid = transport.queue[0].clientUserMessageId;
    const deleteCallsBefore = transport.calls.filter((call) => call.method === 'thread/queue/delete').length;
    const withdrawn = await driver.cancelQueuedInput('session-cancel', withdrawUuid);
    const deleteCallsAfterWithdraw = transport.calls.filter((call) => call.method === 'thread/queue/delete').length;
    const remaining = driver.pendingQueuedInputs('session-cancel')?.items;
    console.log(
      `cancel=${withdrawUuid} result=${withdrawn} deleteCalls=${deleteCallsAfterWithdraw - deleteCallsBefore} remaining=${remaining}`,
    );
    assert.equal(withdrawn, 'withdrawn');
    assert.equal(deleteCallsAfterWithdraw - deleteCallsBefore, 1);
    assert.equal(remaining, 1);
    await toWithdraw.promise;
    assert.equal(toWithdraw.settled(), true, 'the withdrawn run must settle rather than stay pending');

    // Let the other submission start and complete.
    transport.autoComplete = true;
    transport.finishActiveTurn('completed');
    await first.promise;
    await toStart.promise;

    const startedUuid = transport.calls
      .filter((call) => call.method === 'thread/queue/add')
      .map((call) => String(call.params.clientUserMessageId ?? ''))
      .find((uuid) => uuid !== withdrawUuid) ?? '';
    const deleteCallsBeforeAlreadyStarted = transport.calls.filter(
      (call) => call.method === 'thread/queue/delete',
    ).length;
    const alreadyStarted = await driver.cancelQueuedInput('session-cancel', startedUuid);
    const deleteCallsAfterAlreadyStarted = transport.calls.filter(
      (call) => call.method === 'thread/queue/delete',
    ).length;
    console.log(
      `alreadyStartedResult=${alreadyStarted} deleteCallsUnchanged=${deleteCallsAfterAlreadyStarted === deleteCallsBeforeAlreadyStarted}`,
    );
    assert.equal(alreadyStarted, 'already-started');
    assert.equal(deleteCallsAfterAlreadyStarted, deleteCallsBeforeAlreadyStarted, 'a started submission must not be deleted');

    const unknown = await driver.cancelQueuedInput('session-cancel', 'uuid-that-never-existed');
    console.log(`unknownResult=${unknown}`);
    assert.equal(unknown, 'unknown');
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('a normal completion drains the queue with zero queue/start (AC5)', async () => {
  const { driver, transport } = createDriver(new FakeAppServerTransport());
  const host = createHost();
  transport.autoComplete = false;
  transport.autoDrainOnComplete = true;
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-drain'));

    const first = track(driver.run('session-drain', turn('first turn'), createWriter().writer, {} as never));
    await waitFor(() => driver.readSession('session-drain').turnStatus === 'inProgress', 'the first turn');
    const queued = track(driver.run('session-drain', turn('drain me'), createWriter().writer, {} as never));
    await waitFor(() => (driver.pendingQueuedInputs('session-drain')?.items ?? 0) === 1, 'the queued submission');

    transport.autoComplete = true;
    transport.finishActiveTurn('completed');
    await first.promise;
    await queued.promise;

    const queueStartCalls = transport.calls.filter((call) => call.method === 'thread/queue/start').length;
    const completedTurns = transport.log.filter(
      (event) => event.kind === 'notification'
        && event.method === 'turn/completed'
        && (event.params.turn as Record<string, unknown> | undefined)?.status === 'completed',
    ).length;
    console.log(
      `completedTurns=${completedTurns} queueStartCallsAfterCompletion=${queueStartCalls} queuedRunResolved=${queued.settled()}`,
    );
    assert.equal(completedTurns, 2, 'the first turn and the drained queued turn must both complete');
    assert.equal(queueStartCalls, 0, 'a normal completion must auto-drain: zero thread/queue/start');
    assert.equal(queued.settled(), true);
    await waitFor(() => (driver.pendingQueuedInputs('session-drain')?.items ?? 0) === 0, 'the mirror to empty');
    assert.equal(driver.pendingQueuedInputs('session-drain')?.items, 0, 'the queue must be empty at the end');
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('an interrupt keeps the queue and needs an explicit queue/start (AC6)', async () => {
  const { driver, transport } = createDriver(new FakeAppServerTransport());
  const host = createHost();
  transport.autoComplete = false;
  transport.autoDrainAfterInterrupt = false;
  transport.holdQueueStart = true;
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-interrupt'));

    const first = track(driver.run('session-interrupt', turn('a turn to interrupt'), createWriter().writer, {} as never));
    await waitFor(() => driver.readSession('session-interrupt').turnStatus === 'inProgress', 'the first turn');
    const queued = track(driver.run('session-interrupt', turn('queued behind the interrupt'), createWriter().writer, {} as never));
    await waitFor(() => (driver.pendingQueuedInputs('session-interrupt')?.items ?? 0) === 1, 'the queued submission');

    const before = driver.readSession('session-interrupt');
    const aliveBefore = transport.isAlive();
    const pidBefore = transport.pid;
    const expectedHeadSubmissionId = transport.queue[0].id;
    const interrupted = await driver.interrupt(host, 'session-interrupt');
    assert.equal(interrupted, true, 'interrupt must report it stopped a turn');

    // The queue/start request is written synchronously inside the terminal
    // notification handler, so it is already in the log here; the fake is
    // holding its reply, which is what lets the queue be read between the two.
    const interruptIndex = transport.terminalIndex('interrupted');
    const queueStartIndex = transport.callIndex('thread/queue/start');
    const autoStartedAfterInterrupt = queueStartIndex !== -1
      && transport.turnStartedBetween(interruptIndex + 1, queueStartIndex) > 0;
    const queueStartCall = transport.calls.find((call) => call.method === 'thread/queue/start');
    const after = driver.readSession('session-interrupt');
    const reading: InterruptQueueReading = {
      interruptStatus: String(after.turnStatus),
      queuedAfterInterrupt: driver.pendingQueuedInputs('session-interrupt')?.items ?? -1,
      autoStartedAfterInterrupt,
      queueStartCalls: transport.calls.filter((call) => call.method === 'thread/queue/start').length,
      queueStartThreadId: typeof queueStartCall?.params.threadId === 'string' ? queueStartCall.params.threadId : null,
      queueStartSubmissionId: typeof queueStartCall?.params.queuedSubmissionId === 'string'
        ? queueStartCall.params.queuedSubmissionId
        : null,
      expectedHeadSubmissionId,
      threadIdBefore: before.threadId,
      threadIdAfter: after.threadId,
      pidBefore,
      pidAfter: transport.pid,
      aliveBefore,
      aliveAfter: transport.isAlive(),
    };
    console.log(
      `interruptStatus=${reading.interruptStatus} queuedAfterInterrupt=${reading.queuedAfterInterrupt} ` +
        `autoStartedAfterInterrupt=${reading.autoStartedAfterInterrupt} queueStartCalls=${reading.queueStartCalls} ` +
        `queueStartParams=${JSON.stringify(queueStartCall?.params ?? null)} pidBefore=${String(pidBefore)} ` +
        `pidAfter=${String(reading.pidAfter)} threadIdBefore=${String(reading.threadIdBefore)} ` +
        `threadIdAfter=${String(reading.threadIdAfter)}`,
    );
    assertExplicitQueueStartAfterInterrupt(reading);

    // Release the explicit start; the queued turn runs to completion.
    transport.autoComplete = true;
    transport.releaseQueueStart();
    await first.promise;
    await queued.promise;
    assert.equal(queued.rejected(), false, 'the explicitly started turn must complete');
    console.log(
      `explicitStartCompleted=${queued.settled()} turnStartedCount=${transport.turnStartedCount()} ` +
        `transportAlive=${transport.isAlive()}`,
    );
    assert.equal(transport.isAlive(), true, 'the process must still be alive after the interrupt and the pushed turn');
    assert.equal(transport.pid, pidBefore, 'the process pid must be stable across the interrupt');
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('the chat.send seam routes a busy send into queue/add (AC7)', async () => {
  const PROVIDER_ID = 'codex-queue-test';
  const SESSION_ID = 'codex-queue-seam-session';
  const transport = new FakeAppServerTransport();
  transport.autoComplete = false;
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
  });
  // A provider outside the LLMProvider union declares its modes through the
  // runtime registry. `codex` itself is `per-run` in the union table, so using
  // it here would make `residentEntryFor` read the static row and short-circuit
  // before the runtime declaration — the seam leg would read false for the wrong
  // reason.
  providerCapabilitiesService.declareRuntimeProviderCapabilities({
    provider: PROVIDER_ID,
    lifecycleModes: ['resident'],
    multiplexedHost: false,
  });
  const provider = { id: PROVIDER_ID, hostDriver: driver } as unknown as IProvider;
  const runtime = createProviderRuntimeService({
    resolveProvider: (id: string) => {
      if (id === PROVIDER_ID) {
        return provider;
      }
      throw new Error(`unexpected provider ${id}`);
    },
    resolveSessionLifecycleMode: () => 'resident',
  });

  let host: ProcessHost | null = null;
  try {
    host = await sessionHostManager.openHost({
      provider: PROVIDER_ID as LLMProvider,
      mode: 'resident',
      appSessionId: SESSION_ID,
      driver,
    });

    const acceptsBusyInput = runtime.acceptsBusyInput(PROVIDER_ID as LLMProvider, SESSION_ID);
    const first = track(runtime.run(
      PROVIDER_ID as LLMProvider,
      'first turn',
      { sessionId: SESSION_ID },
      createWriter().writer,
    ));
    await waitFor(
      () => driver.readSession(SESSION_ID).turnStatus === 'inProgress',
      'the runtime-dispatched first turn',
    );

    const busy = track(runtime.run(
      PROVIDER_ID as LLMProvider,
      'queued through the runtime',
      { sessionId: SESSION_ID },
      createWriter().writer,
    ));
    await waitFor(
      () => transport.calls.some((call) => call.method === 'thread/queue/add'),
      'the runtime busy send to reach queue/add',
    );
    await waitFor(
      () => (driver.pendingQueuedInputs(SESSION_ID)?.items ?? 0) === 1,
      'the runtime busy send to appear in the mirror',
    );
    const runRejected = busy.rejected();
    const runtimeQueueAddCalls = transport.calls.filter((call) => call.method === 'thread/queue/add').length;
    console.log(
      `acceptsBusyInput=${acceptsBusyInput} runRejected=${runRejected} runtimeQueueAddCalls=${runtimeQueueAddCalls} ` +
        `busyStillPending=${!busy.settled()}`,
    );
    assert.equal(acceptsBusyInput, true, 'a live resident host must read as accepting busy input');
    assert.equal(runRejected, false, 'the second runtime.run must not reject on a busy resident session');
    assert.equal(runtimeQueueAddCalls, 1, 'the busy runtime run must reach thread/queue/add');
    assert.equal(busy.settled(), false, 'the busy runtime run must still be pending while the first turn is in flight');

    transport.autoComplete = true;
    transport.finishActiveTurn('completed');
    await first.promise;
    await busy.promise;
    assert.equal(busy.rejected(), false);
    console.log(`runtimeBusyResolved=${busy.settled()} queueEmpty=${transport.queue.length === 0}`);
    assert.deepEqual(transport.queue, []);
  } finally {
    if (host) {
      sessionHostManager.closeHost(host.hostId, 'user');
      await new Promise((resolve) => setImmediate(resolve));
    }
    await driver.closeHost(host ?? createHost(), 'user');
  }
});

test('reverse controls reject a refusal and an auto-drain (AC8)', () => {
  const refusedRejected = (() => {
    try {
      assertBusyAccepted({
        queueAddCalls: 0,
        refusal: 'RUN_IN_PROGRESS',
        stillPending: false,
        rejected: true,
        queuedUuid: null,
        listUuid: null,
        queuedText: null,
        queueAddThreadId: null,
        queueAddClientUuid: null,
      });
      return false;
    } catch {
      return true;
    }
  })();
  const autoDrainRejected = (() => {
    try {
      assertExplicitQueueStartAfterInterrupt({
        interruptStatus: 'interrupted',
        queuedAfterInterrupt: 1,
        autoStartedAfterInterrupt: true,
        queueStartCalls: 0,
        queueStartThreadId: null,
        queueStartSubmissionId: null,
        expectedHeadSubmissionId: 'qs-1',
        threadIdBefore: 'thread-1',
        threadIdAfter: 'thread-1',
        pidBefore: 1,
        pidAfter: 1,
        aliveBefore: true,
        aliveAfter: true,
      });
      return false;
    } catch {
      return true;
    }
  })();
  console.log(`reverseRefusalRejected=${refusedRejected} reverseAutoDrainRejected=${autoDrainRejected}`);
  assert.equal(refusedRejected, true, 'the busy assertion accepted a refusal');
  assert.equal(autoDrainRejected, true, 'the interrupt assertion accepted an auto-drained queue');
});

test('driver conforms to IProviderHostDriver with multiplexedHost=false (AC9)', () => {
  const { driver } = createDriver(new FakeAppServerTransport());
  const conformance: IProviderHostDriver = driver;
  console.log(`multiplexedHost=${conformance.multiplexedHost}`);
  assert.equal(conformance.multiplexedHost, false);
  for (const verb of ['startHost', 'bind', 'submit', 'interrupt', 'reconfigure', 'unbind', 'closeHost'] as const) {
    assert.equal(typeof conformance[verb], 'function', `${verb} must be implemented`);
  }
  assert.equal(typeof driver.run, 'function', 'the resident turn entry must be present');
  assert.equal(typeof driver.queuedInputUuid, 'function', 'queuedInputUuid must be present');
  assert.equal(typeof driver.pendingQueuedInputs, 'function', 'pendingQueuedInputs must be present');
  assert.equal(typeof driver.cancelQueuedInput, 'function', 'cancelQueuedInput must be present');
});
