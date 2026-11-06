import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexAppServerConnection,
  type CodexAppServerTransport,
} from '@/modules/providers/list/codex/app-server/codex-app-server.connection.js';
import { CodexHostDriver } from '@/modules/providers/list/codex/host/codex-host-driver.provider.js';
import type { IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  HostTurnInput,
  NormalizedMessage,
  ProcessHost,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

/**
 * The criterion for AC-444: with a turn in flight, `driver.steer` rewrites that
 * turn (`turn/steer`) instead of queueing the input or opening a new turn, and a
 * stale `expectedTurnId` is refused fail-closed.
 *
 * The transport is an in-memory JSON-RPC server stub: it answers `initialize`,
 * `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, `turn/steer`
 * and the `thread/queue/*` group, keeps the thread id / the active turn id / the
 * queue depth itself, and records every inbound method together with every
 * frame it emits. A fixed fake pid is what the identity legs read, so no Codex
 * process is started and no database or network is touched.
 */

type Call = { method: string; params: Record<string, unknown> };

const STEERED_TEXT = 'STEERED';
const PRE_STEER_TEXT = 'NOT-STEERED';

class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid = 515_151;
  /** Every inbound method, in order, with its params. */
  readonly calls: Call[] = [];
  /** Every notification the fake emits, in order (the criterion reads the steered turn off these). */
  readonly frames: Call[] = [];
  /** The app-server's own queue; a steer must never add to it. */
  readonly queue: string[] = [];
  /** false keeps `turn/start` in flight, which is the window a steer is legal in. */
  autoComplete = false;
  /** The turn the server itself considers current — the target `expectedTurnId` is compared with it. */
  activeTurnId: string | null = null;
  /** The assistant text the terminal `turn/completed` reports (the reverse control flips this). */
  finalText = STEERED_TEXT;

  private readonly materialised = new Set<string>();
  private messageHandler: ((frame: string) => void) | null = null;
  private exitHandler: ((reason: string) => void) | null = null;
  private alive = true;
  private threadSerial = 0;
  private turnSerial = 0;

  write(frame: string): void {
    const message = JSON.parse(frame) as { id?: number; method?: string; params?: unknown };
    if (typeof message.method !== 'string') {
      return;
    }
    const params = (message.params ?? {}) as Record<string, unknown>;
    this.calls.push({ method: message.method, params });
    switch (message.method) {
      case 'initialize':
        this.reply(message.id, { userAgent: 'fake-codex/0.153.4', codexHome: '/fake' });
        return;
      case 'initialized':
        return;
      case 'thread/start': {
        const id = `thread-${++this.threadSerial}`;
        this.materialised.add(id);
        this.reply(message.id, { thread: { id, status: { type: 'idle' } } });
        return;
      }
      case 'thread/resume': {
        const threadId = String(params.threadId ?? '');
        if (!this.materialised.has(threadId)) {
          this.fail(message.id, `no rollout found for thread id ${threadId}`);
          return;
        }
        this.reply(message.id, { thread: { id: threadId, status: { type: 'idle' } } });
        return;
      }
      case 'turn/start': {
        const threadId = String(params.threadId ?? '');
        const turnId = `turn-${++this.turnSerial}`;
        this.activeTurnId = turnId;
        this.reply(message.id, { turn: { id: turnId, status: 'inProgress' } });
        this.emit('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
        if (this.autoComplete) {
          this.completeTurn(threadId, turnId);
        }
        return;
      }
      case 'turn/interrupt': {
        const threadId = String(params.threadId ?? '');
        const turnId = String(params.turnId ?? this.activeTurnId ?? '');
        this.reply(message.id, {});
        this.completeTurn(threadId, turnId, 'interrupted');
        return;
      }
      case 'turn/steer': {
        const threadId = String(params.threadId ?? '');
        const expectedTurnId = String(params.expectedTurnId ?? '');
        // Stale expectedTurnId: the server refuses with its verbatim -32000 and
        // emits no turn frame at all (REPORT E8, the fail-closed leg).
        if (expectedTurnId !== this.activeTurnId) {
          this.fail(
            message.id,
            `expectedTurnId ${expectedTurnId} does not match current turn ${String(this.activeTurnId)}`,
          );
          return;
        }
        const turnId = this.activeTurnId;
        this.reply(message.id, { turnId });
        const steerText = readInputText(params.input);
        this.emit('item/completed', { threadId, turnId, item: { type: 'userMessage', text: steerText } });
        this.emit('item/completed', { threadId, turnId, item: { type: 'agentMessage', text: this.finalText } });
        this.completeTurn(threadId, turnId);
        return;
      }
      case 'thread/queue/add': {
        this.queue.push(String(params.input ?? ''));
        this.reply(message.id, { queued: true });
        return;
      }
      case 'thread/queue/list': {
        this.reply(message.id, { items: [] });
        return;
      }
      case 'thread/queue/delete': {
        this.reply(message.id, {});
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

  /** Idempotent, and deliberately does not report an exit (see the transport contract). */
  terminate(): void {
    this.alive = false;
  }

  /** Test-only: completes the turn named, exactly as the app-server's last frame would. */
  completeTurn(threadId: string, turnId: string, status: 'completed' | 'interrupted' = 'completed'): void {
    if (this.activeTurnId === turnId) {
      this.activeTurnId = null;
    }
    const items = status === 'completed'
      ? [{ type: 'agentMessage', text: this.finalText }]
      : [];
    this.emit('turn/completed', { threadId, turn: { id: turnId, status, items } });
  }

  private reply(id: number | undefined, result: unknown): void {
    this.deliver({ jsonrpc: '2.0', id, result });
  }

  private fail(id: number | undefined, message: string): void {
    this.deliver({ jsonrpc: '2.0', id, error: { code: -32_000, message } });
  }

  private emit(method: string, params: unknown): void {
    this.frames.push({ method, params: params as Record<string, unknown> });
    this.deliver({ jsonrpc: '2.0', method, params });
  }

  private deliver(frame: unknown): void {
    if (this.alive) {
      this.messageHandler?.(JSON.stringify(frame));
    }
  }
}

function readInputText(input: unknown): string {
  if (!Array.isArray(input)) {
    return '';
  }
  const first = input.find((part) => isRecord(part) && part.type === 'text');
  return isRecord(first) && typeof first.text === 'string' ? first.text : '';
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
    hostId: 'codex-host-1',
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

/**
 * Captures what the run writer actually receives.
 *
 * The resident driver now normalizes app-server notifications before sending
 * them (gap-codex-resident-normalize-app-server-frames), so the writer's
 * surface is kind-carrying messages, not raw `{method,params}` frames. The
 * process's own emitted frames stay on `transport.frames`, which is where the
 * steered turn's identity is read.
 */
function createWriter(): { writer: ProviderRuntimeWriter; frames: NormalizedMessage[] } {
  const frames: NormalizedMessage[] = [];
  return {
    frames,
    writer: {
      send(data: unknown) {
        if (isRecord(data) && typeof data.kind === 'string') {
          frames.push(data as unknown as NormalizedMessage);
        }
      },
    },
  };
}

function createDriver(): { driver: CodexHostDriver; transport: FakeAppServerTransport } {
  const transport = new FakeAppServerTransport();
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
  });
  return { driver, transport };
}

function turn(command: string): HostTurnInput {
  return { command, options: {} };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for ${label}`);
}

function track(promise: Promise<unknown>): {
  promise: Promise<unknown>;
  settled: () => boolean;
  rejected: () => boolean;
  reason: () => unknown;
} {
  let settled = false;
  let rejected = false;
  let reason: unknown = null;
  const tracked = promise.then(
    (value) => {
      settled = true;
      return value;
    },
    (error) => {
      settled = true;
      rejected = true;
      reason = error;
      throw error;
    },
  );
  return {
    promise: tracked,
    settled: () => settled,
    rejected: () => rejected,
    reason: () => reason,
  };
}

function callCount(transport: FakeAppServerTransport, method: string): number {
  return transport.calls.filter((call) => call.method === method).length;
}

function frameCount(transport: FakeAppServerTransport, method: string): number {
  return transport.frames.filter((frame) => frame.method === method).length;
}

function turnIdOf(frame: Call): string | null {
  const turn = isRecord(frame.params.turn) ? frame.params.turn : {};
  return typeof turn.id === 'string' ? turn.id : null;
}

function itemsOf(frame: Call | undefined): Array<Record<string, unknown>> {
  if (!frame || !isRecord(frame.params.turn)) {
    return [];
  }
  const items = frame.params.turn.items;
  return Array.isArray(items) ? items.filter(isRecord) : [];
}

// ---------------------------
//----------------- NAMED ASSERTIONS (shared by the real legs and the reverse controls) ------------

/** One steer's turn-identity reading; the positive leg and the mismatch reverse control share it. */
type SteerHitReading = {
  activeTurnId: string | null;
  steerTurnId: string;
  turnStartCallsBefore: number;
  turnStartCallsAfter: number;
  turnStartedFramesBefore: number;
  turnStartedFramesAfter: number;
  foreignTurnStartedTurnIds: string[];
};

/** Throws when the steer opened a new turn instead of rewriting the active one. */
function assertSteerHitActiveTurn(reading: SteerHitReading): void {
  assert.equal(
    reading.steerTurnId,
    reading.activeTurnId,
    `steerTurnId=${reading.steerTurnId} activeTurnId=${String(reading.activeTurnId)} — turn/steer must return the current turn`,
  );
  assert.equal(
    reading.turnStartCallsAfter,
    reading.turnStartCallsBefore,
    `turn/start calls grew across steer: before=${reading.turnStartCallsBefore} after=${reading.turnStartCallsAfter}`,
  );
  assert.equal(
    reading.turnStartedFramesAfter,
    reading.turnStartedFramesBefore,
    `turn/started frames grew across steer: before=${reading.turnStartedFramesBefore} after=${reading.turnStartedFramesAfter}`,
  );
  assert.deepEqual(
    reading.foreignTurnStartedTurnIds,
    [],
    `steer announced another turn: ${reading.foreignTurnStartedTurnIds.join(',')}`,
  );
}

/** One steered turn's terminal reading; the positive leg and the NOT-STEERED control share it. */
type SteeredTerminalReading = {
  finalAgentText: string;
  terminalItemCount: number;
  terminalStatus: string;
  terminalTurnId: string | null;
  activeTurnId: string | null;
  submitResolved: boolean;
};

/** Throws unless the terminal turn is the steered one and carries only `STEERED`. */
function assertSteeredTerminal(reading: SteeredTerminalReading): void {
  assert.equal(reading.submitResolved, true, 'the run must resolve after the steered turn completes');
  assert.equal(reading.terminalStatus, 'completed', `terminalStatus=${reading.terminalStatus} expected=completed`);
  assert.equal(
    reading.terminalTurnId,
    reading.activeTurnId,
    `turn/completed must name the steered turn: turnId=${String(reading.terminalTurnId)} activeTurnId=${String(reading.activeTurnId)}`,
  );
  assert.equal(reading.terminalItemCount, 1, `terminal items must be the final message only (count=${reading.terminalItemCount})`);
  assert.equal(
    reading.finalAgentText,
    STEERED_TEXT,
    `finalAgentText=${reading.finalAgentText} expected=${STEERED_TEXT}`,
  );
}

/** One steer's queue reading; the positive leg and the queue-fallback reverse control share it. */
type SteerQueueReading = {
  queueDepthBefore: number;
  queueDepthAfter: number;
  queueAddCalls: number;
  queueListDelta: number;
  steerWindowMethods: string[];
};

/** Throws when the steer fell back to the queue instead of staying on `turn/steer`. */
function assertSteerLeftQueueAlone(reading: SteerQueueReading): void {
  assert.equal(
    reading.queueAddCalls,
    0,
    `steer must not queue the input (thread/queue/add calls=${reading.queueAddCalls})`,
  );
  assert.equal(
    reading.queueDepthAfter,
    reading.queueDepthBefore,
    `queue depth changed across steer: before=${reading.queueDepthBefore} after=${reading.queueDepthAfter}`,
  );
  assert.equal(reading.queueListDelta, 0, `steer must not read the queue (thread/queue/list delta=${reading.queueListDelta})`);
  assert.deepEqual(
    reading.steerWindowMethods,
    ['turn/steer'],
    `steer window methods=${JSON.stringify(reading.steerWindowMethods)} expected=["turn/steer"]`,
  );
}

// ---------------------------
//----------------- THE LEGS ------------

test('steer rewrites the active turn: same turn id, same pid/thread, queue untouched (AC2-AC5)', async () => {
  const { driver, transport } = createDriver();
  const host = createHost();
  const firstWriter = createWriter();
  let first: ReturnType<typeof track> | null = null;
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-1'));
    const steered = track(driver.run('session-1', turn('original turn'), firstWriter.writer, {} as never));
    first = steered;
    await waitFor(() => driver.readSession('session-1').turnStatus === 'inProgress', 'the original turn to be in flight');

    const before = driver.readSession('session-1');
    const threadIdBefore = before.threadId;
    const queueDepthBefore = transport.queue.length;
    const callMark = transport.calls.length;
    const frameMark = transport.frames.length;
    const turnStartCallsBefore = callCount(transport, 'turn/start');
    const turnStartedFramesBefore = frameCount(transport, 'turn/started');

    const steerResult = await driver.steer(host, 'session-1', turn('STEERED now'));

    const steerWindowMethods = transport.calls.slice(callMark).map((call) => call.method);
    const foreignTurnStartedTurnIds = transport.frames
      .slice(frameMark)
      .filter((frame) => frame.method === 'turn/started')
      .map(turnIdOf)
      .filter((turnId): turnId is string => turnId !== null && turnId !== before.activeTurnId);
    const hit: SteerHitReading = {
      activeTurnId: before.activeTurnId,
      steerTurnId: steerResult.turnId,
      turnStartCallsBefore,
      turnStartCallsAfter: callCount(transport, 'turn/start'),
      turnStartedFramesBefore,
      turnStartedFramesAfter: frameCount(transport, 'turn/started'),
      foreignTurnStartedTurnIds,
    };
    console.log(
      `activeTurnId=${String(hit.activeTurnId)} steerTurnId=${hit.steerTurnId} turnStartCalls=${hit.turnStartCallsAfter} turnStartedFrames=${hit.turnStartedFramesAfter}`,
    );
    assertSteerHitActiveTurn(hit);

    const queueAfterSteer = transport.queue.length;
    const queueListDelta = transport.calls.slice(callMark).filter((call) => call.method === 'thread/queue/list').length;
    const queue: SteerQueueReading = {
      queueDepthBefore,
      queueDepthAfter: queueAfterSteer,
      queueAddCalls: callCount(transport, 'thread/queue/add'),
      queueListDelta,
      steerWindowMethods,
    };
    console.log(
      `queueDepthBefore=${queue.queueDepthBefore} queueDepthAfter=${queue.queueDepthAfter} queueAddCalls=${queue.queueAddCalls} queueListDelta=${queue.queueListDelta} steerWindowMethods=${JSON.stringify(queue.steerWindowMethods)}`,
    );
    assertSteerLeftQueueAlone(queue);

    await waitFor(() => steered.settled(), 'the steered run to settle');
    assert.equal(steered.rejected(), false, `the steered run rejected: ${String(steered.reason())}`);

    // The process's terminal frame names the steered turn; the writer's
    // normalized frames carry the answer and the run's terminal complete.
    const completedFrames = transport.frames.filter((frame) => frame.method === 'turn/completed');
    const terminalFrame = completedFrames[completedFrames.length - 1];
    const items = itemsOf(terminalFrame);
    const finalAnswers = firstWriter.frames.filter(
      (message) => message.kind === 'text' && message.role === 'assistant',
    );
    const completions = firstWriter.frames.filter((message) => message.kind === 'complete');
    const terminal: SteeredTerminalReading = {
      finalAgentText: finalAnswers.length === 1 ? String(finalAnswers[0].content ?? '') : '',
      terminalItemCount: items.length,
      terminalStatus: terminalFrame && isRecord(terminalFrame.params.turn)
        ? String(terminalFrame.params.turn.status ?? '')
        : '',
      terminalTurnId: terminalFrame ? turnIdOf(terminalFrame) : null,
      activeTurnId: before.activeTurnId,
      submitResolved: steered.settled() && !steered.rejected(),
    };
    console.log(
      `finalAgentText=${terminal.finalAgentText} terminalStatus=${terminal.terminalStatus} submitResolved=${terminal.submitResolved}`,
    );
    console.log(
      `terminalItems=${JSON.stringify(items)} terminalTurnId=${String(terminal.terminalTurnId)} activeTurnId=${String(terminal.activeTurnId)}`,
    );
    assertSteeredTerminal(terminal);
    assert.equal(completions.length, 1, `the run writer must see exactly one terminal complete (got ${completions.length})`);
    assert.equal(completions[0].exitCode, 0, 'a completed turn must reach the writer as a successful complete');

    // AC4: the process and the thread survive the steer, and the next round
    // reuses both.
    const afterSteer = driver.readSession('session-1');
    const pidAfterSteer = transport.pid;
    transport.autoComplete = true;
    await driver.run('session-1', turn('next round'), createWriter().writer, {} as never);
    const next = driver.readSession('session-1');
    const turnStarts = transport.calls.filter((call) => call.method === 'turn/start');
    const nextTurnThreadId = String(turnStarts[turnStarts.length - 1]?.params.threadId ?? '');
    console.log(`before threadId=${String(threadIdBefore)} hostPid=${String(host.pid)} transportPid=${transport.pid}`);
    console.log(
      `afterSteer threadId=${String(afterSteer.threadId)} hostPid=${String(host.pid)} transportPid=${pidAfterSteer}`,
    );
    console.log(
      `next threadId=${String(next.threadId)} hostPid=${String(host.pid)} transportPid=${transport.pid} nextTurnThreadId=${nextTurnThreadId}`,
    );
    assert.equal(afterSteer.threadId, threadIdBefore, 'threadId drifted across steer');
    assert.equal(next.threadId, threadIdBefore, 'threadId drifted across the next round');
    assert.equal(pidAfterSteer, transport.pid, 'pid drifted across steer');
    assert.equal(host.pid, transport.pid, 'host pid and transport pid must be one process');
    assert.equal(nextTurnThreadId, threadIdBefore, 'the next turn must run on the original thread');
  } finally {
    if (first && !first.settled()) {
      // A driver that never completed the turn must not hang the criterion; the
      // assertions above already failed, this only ends the run.
      const stuck = driver.readSession('session-1');
      transport.completeTurn(String(stuck.threadId), String(stuck.activeTurnId));
      await first.promise.catch(() => {});
    }
    await driver.closeHost(host, 'user');
  }
});

test('a stale expectedTurnId is refused fail-closed and the turn still completes (AC6)', async () => {
  const { driver, transport } = createDriver();
  const host = createHost();
  const writer = createWriter();
  let run: ReturnType<typeof track> | null = null;
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-stale'));
    const original = track(driver.run('session-stale', turn('original turn'), writer.writer, {} as never));
    run = original;
    await waitFor(() => driver.readSession('session-stale').turnStatus === 'inProgress', 'the original turn to be in flight');

    const before = driver.readSession('session-stale');
    const staleServerTurnId = 'turn-server-moved-on';
    transport.activeTurnId = staleServerTurnId;

    let failure: unknown = null;
    try {
      await driver.steer(host, 'session-stale', turn('STEERED too late'));
    } catch (error) {
      failure = error;
    }

    const after = driver.readSession('session-stale');
    const errorCode = isRecord(failure) && typeof failure.code === 'string' ? failure.code : 'none';
    const details = isRecord(failure) && isRecord(failure.details) ? failure.details : {};
    const rpcCode = typeof details.rpcCode === 'number' ? details.rpcCode : null;
    const message = failure instanceof Error ? failure.message : String(failure);
    const queueAddCalls = callCount(transport, 'thread/queue/add');
    const turnStartCalls = callCount(transport, 'turn/start');
    const expectedStaleText = `expectedTurnId ${String(before.activeTurnId)} does not match current turn ${staleServerTurnId}`;
    console.log(
      `steerErrorCode=${errorCode} rpcCode=${String(rpcCode)} message=${message}`,
    );
    console.log(
      `queueAddCalls=${queueAddCalls} turnStartCalls=${turnStartCalls} fallback=none activeTurnIdAfter=${String(after.activeTurnId)} turnStatusAfter=${String(after.turnStatus)}`,
    );

    assert.notEqual(failure, null, 'a stale expectedTurnId must reject the steer');
    assert.equal(errorCode, 'CODEX_APP_SERVER_ERROR', `steerErrorCode=${errorCode}`);
    assert.equal(rpcCode, -32_000, `rpcCode=${String(rpcCode)} expected=-32000`);
    assert.equal(message, expectedStaleText, `message=${message}`);
    assert.equal(queueAddCalls, 0, `steer must not fall back to thread/queue/add (calls=${queueAddCalls})`);
    assert.equal(turnStartCalls, 1, `steer must not fall back to turn/start (calls=${turnStartCalls})`);
    assert.equal(after.activeTurnId, before.activeTurnId, 'a refused steer must not move the active turn');
    assert.equal(after.turnStatus, 'inProgress', `turnStatusAfter=${String(after.turnStatus)} expected=inProgress`);

    // The original turn is still the driver's turn: its completion resolves the run.
    transport.completeTurn(String(before.threadId), String(before.activeTurnId));
    await waitFor(() => original.settled(), 'the original run to settle after the refused steer');
    assert.equal(original.rejected(), false, `the original run rejected: ${String(original.reason())}`);
    console.log(
      `runAfterRefusal resolved=${original.settled() && !original.rejected()} turnStatusAfterCompletion=${String(driver.readSession('session-stale').turnStatus)}`,
    );
  } finally {
    if (run && !run.settled()) {
      const stuck = driver.readSession('session-stale');
      transport.completeTurn(String(stuck.threadId), String(stuck.activeTurnId));
      await run.promise.catch(() => {});
    }
    await driver.closeHost(host, 'user');
  }
});

test('steer refuses a session with no active turn and sends nothing (AC7)', async () => {
  const { driver, transport } = createDriver();
  const host = createHost();
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-idle'));
    const steerCallsBefore = callCount(transport, 'turn/steer');
    const turnStartCallsBefore = callCount(transport, 'turn/start');
    const queueAddCallsBefore = callCount(transport, 'thread/queue/add');

    let failure: unknown = null;
    try {
      await driver.steer(host, 'session-idle', turn('steer an idle session'));
    } catch (error) {
      failure = error;
    }

    const errorCode = isRecord(failure) && typeof failure.code === 'string' ? failure.code : 'none';
    const steerCallsAfter = callCount(transport, 'turn/steer');
    const turnStartCallsAfter = callCount(transport, 'turn/start');
    const queueAddCallsAfter = callCount(transport, 'thread/queue/add');
    console.log(
      `idleSteerErrorCode=${errorCode} turnSteerCalls=${steerCallsAfter - steerCallsBefore} turnStartCalls=${turnStartCallsAfter - turnStartCallsBefore} queueAddCalls=${queueAddCallsAfter - queueAddCallsBefore}`,
    );
    assert.equal(errorCode, 'CODEX_STEER_NO_ACTIVE_TURN', `idleSteerErrorCode=${errorCode}`);
    assert.equal(steerCallsAfter, steerCallsBefore, 'an idle steer must not reach turn/steer');
    assert.equal(turnStartCallsAfter, turnStartCallsBefore, 'an idle steer must not start a turn');
    assert.equal(queueAddCallsAfter, queueAddCallsBefore, 'an idle steer must not queue the input');
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('reverse controls reject a queue fallback, a new turn, a drifted product and an idle acceptance (AC3/AC8/AC9/AC10)', () => {
  const notSteeredRejected = (() => {
    try {
      assertSteeredTerminal({
        finalAgentText: PRE_STEER_TEXT,
        terminalItemCount: 1,
        terminalStatus: 'completed',
        terminalTurnId: 'turn-1',
        activeTurnId: 'turn-1',
        submitResolved: true,
      });
      return false;
    } catch {
      return true;
    }
  })();
  const newTurnRejected = (() => {
    try {
      assertSteerHitActiveTurn({
        activeTurnId: 'turn-1',
        steerTurnId: 'turn-2',
        turnStartCallsBefore: 1,
        turnStartCallsAfter: 2,
        turnStartedFramesBefore: 1,
        turnStartedFramesAfter: 2,
        foreignTurnStartedTurnIds: ['turn-2'],
      });
      return false;
    } catch {
      return true;
    }
  })();
  const queueFallbackRejected = (() => {
    try {
      assertSteerLeftQueueAlone({
        queueDepthBefore: 0,
        queueDepthAfter: 1,
        queueAddCalls: 1,
        queueListDelta: 1,
        steerWindowMethods: ['thread/queue/add'],
      });
      return false;
    } catch {
      return true;
    }
  })();

  console.log(
    `reverseNotSteeredRejected=${notSteeredRejected} reverseNewTurnRejected=${newTurnRejected} reverseQueueFallbackRejected=${queueFallbackRejected}`,
  );
  assert.equal(notSteeredRejected, true, 'the terminal assertion accepted the pre-steer text');
  assert.equal(newTurnRejected, true, 'the steer assertion accepted a new turn');
  assert.equal(queueFallbackRejected, true, 'the queue assertion accepted a queue fallback');
});
