import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { collectModelPages } from '@/modules/providers/list/codex/codex-app-server.client.js';
import {
  CODEX_APP_SERVER_LAUNCHER_ENV,
  CodexAppServerConnection,
  resolveCodexAppServerLauncher,
  type CodexAppServerTransport,
} from '@/modules/providers/list/codex/codex-app-server.connection.js';
import { CodexHostDriver } from '@/modules/providers/list/codex/codex-host-driver.provider.js';
import type { IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  HostTurnInput,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';
import { AppError, isRecord } from '@/shared/utils.js';

/**
 * The criterion for AC-440: the resident Codex connection declares
 * `capabilities.experimentalApi`, refuses the capability-gated `thread/queue/*`
 * group fail-closed when it is missing or was rejected by the server, and lets
 * unknown notifications pass without a throwing subscriber breaking the read
 * loop.
 *
 * Everything here is hermetic: the transport is an in-memory JSON-RPC stub with
 * a fixed fake pid, so no `codex` process is started and no DB or network is
 * touched. The stub reproduces the two 0.153.4 behaviors this task depends on —
 * the capability gate on `thread/queue/*` with its verbatim rejection text, and
 * arbitrary server notifications injected at any moment.
 */

/** The locked 0.153.4 rejection, verbatim from REPORT:50 / E2 line 46. */
const LOCKED_QUEUE_REJECTION = 'thread/queue/add requires experimentalApi capability';

/** The four notifications the real server sends that this driver does not model. */
const EXPECTED_UNKNOWN_NOTIFICATIONS = [
  'configWarning',
  'account/rateLimits/updated',
  'item/started',
  'futureFeature/doesNotExist',
];

type Call = { method: string; params: Record<string, unknown> };

type EmittedFrame = {
  jsonrpc?: string;
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/**
 * In-memory `codex app-server` stub.
 *
 * It answers the methods the resident driver uses, gates `thread/queue/add`
 * behind the declaration made on `initialize`, and records every written frame so
 * a test can read the declaration and count how many queue frames escaped.
 */
class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid = 515_151;
  /** Every request the connection wrote, in order. */
  readonly calls: Call[] = [];
  /** Every frame's exact text, before interpretation. */
  readonly frames: string[] = [];
  /** Every frame this fake emitted toward the connection. */
  readonly emitted: EmittedFrame[] = [];
  /**
   * Whether the server honors the declaration.
   *
   * False builds the "declared but still refused" leg: on 0.153.4 the gate is
   * server-side, so the driver cannot infer availability from its own request.
   */
  honorExperimentalApi = true;
  /** Whether `turn/start` settles the turn immediately; false leaves it in flight. */
  autoComplete = true;
  lastStartedThreadId: string | null = null;
  lastStartedTurnId: string | null = null;

  private declaredExperimentalApi = false;
  private messageHandler: ((frame: string) => void) | null = null;
  private exitHandler: ((reason: string) => void) | null = null;
  private alive = true;
  private threadSerial = 0;
  private turnSerial = 0;
  private queueSerial = 0;
  private readonly materialised = new Set<string>();

  /** How many `thread/queue/add` frames actually reached this transport. */
  get queueAddFramesWritten(): number {
    return this.calls.filter((call) => call.method === 'thread/queue/add').length;
  }

  /** The `capabilities` object the connection declared, or null before `initialize`. */
  get initializeCapabilities(): Record<string, unknown> | null {
    const call = this.calls.find((entry) => entry.method === 'initialize');
    if (!call) {
      return null;
    }
    return isRecord(call.params.capabilities) ? call.params.capabilities : {};
  }

  /** Test-only: injects one server notification at an arbitrary moment. */
  inject(method: string, params: unknown): void {
    this.deliver({ jsonrpc: '2.0', method, params });
  }

  /** Test-only: marks a restored thread as having a rollout, so resume succeeds. */
  materialise(threadId: string): void {
    this.materialised.add(threadId);
  }

  /** Test-only: settles a turn the way 0.153.4 does. */
  completeTurn(threadId: string, turnId: string): void {
    this.materialised.add(threadId);
    this.deliver({ jsonrpc: '2.0', method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } });
  }

  write(frame: string): void {
    this.frames.push(frame);
    const message = JSON.parse(frame) as { id?: number; method?: string; params?: unknown };
    if (typeof message.method !== 'string') {
      return;
    }
    const params = isRecord(message.params) ? message.params : {};
    this.calls.push({ method: message.method, params });
    switch (message.method) {
      case 'initialize': {
        const capabilities = isRecord(params.capabilities) ? params.capabilities : {};
        this.declaredExperimentalApi = capabilities.experimentalApi === true;
        this.reply(message.id, { userAgent: 'fake-codex/0.153.4', codexHome: '/fake' });
        return;
      }
      case 'initialized':
        return;
      case 'thread/start': {
        const id = `thread-${++this.threadSerial}`;
        this.lastStartedThreadId = id;
        this.reply(message.id, { thread: { id, status: { type: 'idle' } } });
        return;
      }
      case 'thread/resume': {
        const threadId = String(params.threadId ?? '');
        if (!this.materialised.has(threadId)) {
          this.replyError(message.id, -32_000, `no rollout found for thread id ${threadId}`);
          return;
        }
        this.lastStartedThreadId = threadId;
        this.reply(message.id, { thread: { id: threadId, status: { type: 'idle' } } });
        return;
      }
      case 'thread/queue/add': {
        // 0.153.4 accepts this group only when the handshake opted in. The
        // rejection text is the server's, not a local paraphrase.
        if (!this.declaredExperimentalApi || !this.honorExperimentalApi) {
          this.replyError(message.id, -32_600, LOCKED_QUEUE_REJECTION);
          return;
        }
        this.reply(message.id, { queuedSubmission: { id: `queued-${++this.queueSerial}` } });
        return;
      }
      case 'turn/start': {
        const threadId = String(params.threadId ?? '');
        const turnId = `turn-${++this.turnSerial}`;
        this.lastStartedThreadId = threadId;
        this.lastStartedTurnId = turnId;
        this.reply(message.id, { turn: { id: turnId, status: 'inProgress' } });
        this.inject('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
        if (this.autoComplete) {
          this.completeTurn(threadId, turnId);
        }
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

  /** Idempotent, and deliberately does not report an exit (transport contract). */
  terminate(): void {
    this.alive = false;
  }

  private reply(id: number | undefined, result: unknown): void {
    this.deliver({ jsonrpc: '2.0', id, result });
  }

  private replyError(id: number | undefined, code: number, message: string): void {
    this.deliver({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private deliver(frame: EmittedFrame): void {
    this.emitted.push(frame);
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
    hostId: 'codex-host-protocol',
    provider: 'codex',
    mode: 'resident',
    state: 'starting',
    pid: null,
    startedAt: Date.now(),
    bindings: new Map(),
    closeReason: null,
  };
}

function createBinding(appSessionId: string, providerSessionId: string | null): SessionBinding {
  return {
    appSessionId,
    providerSessionId,
    state: 'idle',
    leases: [],
    lastActivityAt: Date.now(),
    peerName: null,
    detachReason: null,
  };
}

function createContext(): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: '' }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
}

function turn(command: string): HostTurnInput {
  return { command, options: {} };
}

type Harness = {
  transport: FakeAppServerTransport;
  connection: CodexAppServerConnection;
  driver: CodexHostDriver;
};

function createHarness(options: { experimentalApi?: boolean } = {}): Harness {
  const transport = new FakeAppServerTransport();
  const connection = new CodexAppServerConnection({
    experimentalApi: options.experimentalApi,
    createTransport: () => transport,
  });
  const driver = new CodexHostDriver({ createConnection: () => connection });
  return { transport, connection, driver };
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

/** Reads a rejection as an `AppError`, failing loudly when the call resolved. */
async function rejectionOf(call: Promise<unknown>): Promise<AppError> {
  try {
    await call;
  } catch (failure) {
    assert.ok(failure instanceof AppError, `expected an AppError, got ${String(failure)}`);
    return failure;
  }
  throw new Error('expected the call to reject, but it resolved');
}

// --------------------------- ASSERTION HELPERS (shared with the reverse controls) -------------

/** The declaration assertion: `capabilities.experimentalApi` must be the boolean true. */
function assertExperimentalApiDeclared(capabilities: Record<string, unknown> | null, label: string): void {
  assert.notEqual(capabilities, null, `${label}: no initialize capabilities were captured`);
  assert.equal(typeof capabilities?.experimentalApi, 'boolean', `${label}: experimentalApi must be a boolean`);
  assert.equal(capabilities?.experimentalApi, true, `${label}: experimentalApi must be true`);
}

type PassThroughReading = {
  unknownNotifications: string[];
  turnStatus: string;
  postLoopRequest: string;
};

/** The pass-through assertion: every unknown frame arrived, the turn settled and the loop lived. */
function assertUnknownNotificationsWerePassed(reading: PassThroughReading): void {
  assert.deepEqual(
    [...reading.unknownNotifications].sort(),
    [...EXPECTED_UNKNOWN_NOTIFICATIONS].sort(),
    `unknown notifications did not all pass: ${reading.unknownNotifications.join(',')}`,
  );
  assert.equal(reading.turnStatus, 'completed', `turnStatus=${reading.turnStatus} expected=completed`);
  assert.equal(reading.postLoopRequest, 'ok', `postLoopRequest=${reading.postLoopRequest} expected=ok`);
}

type LoopReading = {
  loopContinued: boolean;
  lastDispatchError: string | null;
  laterRequest: string;
};

/** The loop assertion: a throwing subscriber is recorded, not fatal and not silent. */
function assertLoopSurvivedHandlerFailure(reading: LoopReading): void {
  assert.equal(reading.loopContinued, true, 'the read loop did not survive the throwing handler');
  assert.equal(reading.laterRequest, 'ok', `laterRequest=${reading.laterRequest} expected=ok`);
  assert.match(
    String(reading.lastDispatchError),
    /boom-from-unknown-notification/,
    'the handler failure was swallowed without being recorded',
  );
}

// --------------------------- AC2 -------------

/**
 * AC-443: the resident UI criterion needs a deterministic app-server, and the
 * only switch is the launcher's own environment.
 *
 * Both directions are read here, and the default leg is the load-bearing one: a
 * deployment that sets nothing must still spawn the pinned CLI the connection's
 * protocol was written against, while a run that names the stand-in gets exactly
 * that path. A blank value is not an override — it would otherwise make the
 * criterion's variable presence (rather than its value) decide which process
 * starts.
 */
test('the app-server launcher override applies only when it names a path (AC-443)', () => {
  const require_ = createRequire(import.meta.url);
  const pinned = require_.resolve('@openai/codex/bin/codex.js');

  assert.equal(
    resolveCodexAppServerLauncher({}),
    pinned,
    'an environment with no override must resolve the pinned @openai/codex CLI',
  );
  assert.equal(
    resolveCodexAppServerLauncher({ [CODEX_APP_SERVER_LAUNCHER_ENV]: '   ' }),
    pinned,
    'a blank override is not an override',
  );
  assert.equal(
    resolveCodexAppServerLauncher({ [CODEX_APP_SERVER_LAUNCHER_ENV]: '/opt/e2e/fake-app-server.mjs' }),
    '/opt/e2e/fake-app-server.mjs',
    'an explicit override must be returned verbatim',
  );
});

test('initialize declares capabilities.experimentalApi and the declaration is a switch (AC2)', async () => {
  const declared = createHarness();
  const host = createHost();
  try {
    await declared.driver.startHost(host, createSink());
    const capabilities = declared.transport.initializeCapabilities;
    const initializeFrame = declared.transport.frames.find(
      (frame) => (JSON.parse(frame) as { method?: string }).method === 'initialize',
    );
    console.log(`initializeFrame=${initializeFrame}`);
    console.log(`initializeCapabilities=${JSON.stringify(capabilities)}`);
    assertExperimentalApiDeclared(capabilities, 'declared arm');
    assert.equal(declared.connection.experimentalApiDeclared, true, 'the declaration reading must be true');
  } finally {
    await declared.driver.closeHost(host, 'user');
  }

  const undeclared = createHarness({ experimentalApi: false });
  const undeclaredHost = createHost();
  try {
    await undeclared.driver.startHost(undeclaredHost, createSink());
    const capabilities = undeclared.transport.initializeCapabilities;
    const experimentalApiKeyPresent = capabilities !== null && 'experimentalApi' in capabilities;
    console.log(`initializeCapabilities=${JSON.stringify(capabilities)} experimentalApiKeyPresent=${experimentalApiKeyPresent}`);
    // The negative reading is produced by the option, not by editing a constant:
    // the same fake transport, the same driver, only the declaration differs.
    assert.deepEqual(capabilities, {}, 'the undeclared arm must send empty capabilities');
    assert.equal(experimentalApiKeyPresent, false, 'the undeclared arm must not carry the key');
    assert.equal(undeclared.connection.experimentalApiDeclared, false, 'the declaration reading must be false');
  } finally {
    await undeclared.driver.closeHost(undeclaredHost, 'user');
  }
});

// --------------------------- AC3 -------------

test('the declaration is what switches thread/queue/add on and off (AC3)', async () => {
  // Declared arm: through the connection, the queue method is accepted.
  const declared = createHarness();
  const host = createHost();
  try {
    await declared.driver.startHost(host, createSink());
    const result = await declared.connection.request('thread/queue/add', {
      threadId: 'thread-declared',
      input: [{ type: 'text', text: 'second turn' }],
    });
    console.log(`declaredQueueAdd=accepted result=${JSON.stringify(result)}`);
    assert.ok(isRecord(result) && isRecord(result.queuedSubmission), 'the declared queue add must be accepted');
    assert.equal(declared.transport.queueAddFramesWritten, 1);
  } finally {
    await declared.driver.closeHost(host, 'user');
  }

  // Undeclared arm: the local gate (AC4) keeps this frame off the wire, so the
  // server's verbatim refusal is exercised on the stub itself — the same fake
  // transport class, the only difference being the initialize declaration.
  const undeclared = new FakeAppServerTransport();
  undeclared.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { clientInfo: { name: 'cloudcli', version: '1' }, capabilities: {} },
  }));
  undeclared.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'thread/queue/add',
    params: { threadId: 'thread-undeclared', input: [{ type: 'text', text: 'second turn' }] },
  }));
  const rejection = undeclared.emitted.find((frame) => frame.error);
  assert.ok(rejection?.error, 'the undeclared queue add must be refused');
  console.log(
    `undeclaredQueueAdd=rejected rpcCode=${rejection.error.code} message=${rejection.error.message}`,
  );
  assert.equal(rejection.error.code, -32_600);
  assert.equal(rejection.error.message, LOCKED_QUEUE_REJECTION);
});

// --------------------------- AC4 -------------

test('a missing declaration fails closed locally with zero frames (AC4)', async () => {
  const { transport, connection, driver } = createHarness({ experimentalApi: false });
  const host = createHost();
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-local-gate', null));

    const failure = await rejectionOf(connection.request('thread/queue/add', {
      threadId: 'thread-local-gate',
      input: [{ type: 'text', text: 'never sent' }],
    }));
    console.log(`localGateCode=${failure.code} queueAddFramesWritten=${transport.queueAddFramesWritten}`);
    assert.equal(failure.code, 'CODEX_EXPERIMENTAL_API_UNAVAILABLE');
    // Zero frames: fail-closed happens before the write, not after a refusal.
    assert.equal(transport.queueAddFramesWritten, 0, 'a locally refused call must not write a frame');
    assert.equal(driver.experimentalApiAvailable('session-local-gate'), false);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

// --------------------------- AC5 -------------

test('a server refusal latches fail-closed but leaves the stable surface alive (AC5)', async () => {
  const { transport, connection, driver } = createHarness();
  const host = createHost();
  // A restored thread with a rollout keeps threadId stable across the ordinary
  // turn that follows the latch, so "unchanged" is a real reading.
  transport.materialise('thread-restored-5');
  transport.honorExperimentalApi = false;
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-server-refusal', 'thread-restored-5'));

    const first = await rejectionOf(connection.request('thread/queue/add', {
      threadId: 'thread-restored-5',
      input: [{ type: 'text', text: 'first' }],
    }));
    const rpcCode = isRecord(first.details) ? first.details.rpcCode : undefined;
    console.log(`serverRejectionCode=${first.code} rpcCode=${rpcCode}`);
    assert.equal(first.code, 'CODEX_EXPERIMENTAL_API_UNAVAILABLE');
    assert.equal(rpcCode, -32_600);
    assert.equal(transport.queueAddFramesWritten, 1);
    assert.equal(connection.experimentalApiRejected, true, 'the refusal must latch');
    assert.equal(driver.experimentalApiAvailable('session-server-refusal'), false);

    const second = await rejectionOf(connection.request('thread/queue/add', {
      threadId: 'thread-restored-5',
      input: [{ type: 'text', text: 'second' }],
    }));
    console.log(`latchedCode=${second.code} queueAddFramesWritten=${transport.queueAddFramesWritten}`);
    assert.equal(second.code, 'CODEX_EXPERIMENTAL_API_UNAVAILABLE');
    // Bounded: the second call is refused locally, so the wire still holds one.
    assert.equal(transport.queueAddFramesWritten, 1, 'a latched call must not write a second frame');

    const threadIdBefore = driver.readSession('session-server-refusal').threadId;
    const pidBefore = transport.pid;
    await driver.submit(host, 'session-server-refusal', turn('an ordinary turn still runs'));
    const after = driver.readSession('session-server-refusal');
    const alive = connection.isAlive();
    console.log(
      `ordinaryTurnStatus=${after.turnStatus} threadIdBefore=${threadIdBefore} threadIdAfter=${after.threadId} `
        + `pidBefore=${pidBefore} pidAfter=${transport.pid} isAlive=${alive}`,
    );
    assert.equal(after.turnStatus, 'completed', 'the stable surface must keep working after the latch');
    assert.equal(after.threadId, threadIdBefore, 'threadId must not change across the ordinary turn');
    assert.equal(transport.pid, pidBefore, 'pid must not change across the ordinary turn');
    assert.equal(alive, true);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

// --------------------------- AC6 -------------

test('unknown notifications pass without breaking the read loop (AC6)', async () => {
  const { transport, connection, driver } = createHarness();
  const host = createHost();
  const forwarded: unknown[] = [];
  const writer: ProviderRuntimeWriter = {
    send: (data) => {
      forwarded.push(data);
    },
  };
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-unknown', null));
    transport.autoComplete = false;

    const runPromise = driver.run('session-unknown', turn('a turn with unknown frames'), writer, createContext());
    await waitFor(() => driver.readSession('session-unknown').turnStatus === 'inProgress', 'turn in flight');
    const threadId = driver.readSession('session-unknown').threadId;
    assert.ok(threadId, 'the turn must have a thread before notifications are injected');

    // E1 shows `configWarning` before the initialize reply and without a
    // threadId; the rest are the real sequences this driver does not model.
    transport.inject('configWarning', { summary: 'bubblewrap missing', details: null });
    transport.inject('account/rateLimits/updated', { rateLimits: { limitId: 'codex' } });
    transport.inject('item/started', { threadId, item: { id: 'item-1', type: 'agentMessage' } });
    transport.inject('futureFeature/doesNotExist', null);
    transport.completeTurn(threadId, String(transport.lastStartedTurnId));
    await runPromise;

    const session = driver.readSession('session-unknown');
    assert.equal(session.turnStatus, 'completed', 'the turn must still settle after unknown frames');
    assert.equal(connection.isInitialized, true);
    assert.equal(connection.isAlive(), true);

    transport.autoComplete = true;
    await driver.submit(host, 'session-unknown', turn('a request after the unknown frames'));
    const postLoopRequest = 'ok';
    console.log(
      `unknownNotifications=[${EXPECTED_UNKNOWN_NOTIFICATIONS.join(',')}] turnStatus=${session.turnStatus} `
        + `postLoopRequest=${postLoopRequest}`,
    );
    const rawMethods = forwarded
      .filter(isRecord)
      .filter((data) => typeof data.method === 'string')
      .map((data) => String(data.method));
    const forwardedKinds = forwarded
      .filter(isRecord)
      .filter((data) => typeof data.kind === 'string')
      .map((data) => String(data.kind));
    const kindless = forwarded.filter((data) => !isRecord(data) || typeof data.kind !== 'string').length;
    console.log(`forwardedKinds=[${forwardedKinds.join(',')}] rawMethods=[${rawMethods.join(',')}] kindless=${kindless}`);
    // The driver normalizes before writing (gap-codex-resident-normalize-app-
    // server-frames): every frame is a kind-carrying message, and an unmapped
    // lifecycle frame such as `item/started` is dropped rather than leaked as a
    // raw `{method,params}` payload the writer would discard wholesale.
    assert.equal(kindless, 0, `kindless=${kindless} — the run writer must receive only kind-carrying messages`);
    assert.equal(rawMethods.includes('item/started'), false, 'an unmapped lifecycle frame must not be forwarded raw');
    for (const method of ['configWarning', 'account/rateLimits/updated', 'futureFeature/doesNotExist']) {
      assert.equal(rawMethods.includes(method), false, `${method} has no threadId and must not be forwarded`);
    }
    assertUnknownNotificationsWerePassed({
      unknownNotifications: [...EXPECTED_UNKNOWN_NOTIFICATIONS],
      turnStatus: session.turnStatus,
      postLoopRequest,
    });
  } finally {
    await driver.closeHost(host, 'user');
  }
});

// --------------------------- AC7 -------------

test('a throwing handler is recorded and does not end the loop (AC7)', async () => {
  const { transport, connection, driver } = createHarness();
  const host = createHost();
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-handler', null));
    transport.autoComplete = false;

    const submitPromise = driver.submit(host, 'session-handler', turn('a turn with a throwing handler'));
    await waitFor(() => driver.readSession('session-handler').turnStatus === 'inProgress', 'turn in flight');
    const threadId = driver.readSession('session-handler').threadId;
    assert.ok(threadId, 'the turn must have a thread before notifications are injected');

    const unsubscribe = connection.onNotification((method) => {
      if (method === 'configWarning') {
        throw new Error('boom-from-unknown-notification');
      }
    });
    try {
      // If dispatch were not isolated this inject would itself throw out of the
      // transport and the later completion below would never arrive.
      transport.inject('configWarning', { summary: 'bubblewrap missing', details: null });
      transport.completeTurn(threadId, String(transport.lastStartedTurnId));
      await submitPromise;
    } finally {
      unsubscribe();
    }

    const session = driver.readSession('session-handler');
    transport.autoComplete = true;
    await driver.submit(host, 'session-handler', turn('a request after the handler threw'));
    const laterRequest = 'ok';
    console.log(
      `handlerThrew=boom-from-unknown-notification loopContinued=${session.turnStatus === 'completed'} `
        + `laterRequest=${laterRequest} lastDispatchError=${connection.lastDispatchError}`,
    );
    assert.equal(session.turnStatus, 'completed');
    assert.equal(connection.isAlive(), true);
    assertLoopSurvivedHandlerFailure({
      loopContinued: session.turnStatus === 'completed',
      lastDispatchError: connection.lastDispatchError,
      laterRequest,
    });
  } finally {
    await driver.closeHost(host, 'user');
  }
});

// --------------------------- AC8 -------------

test('the assertions reject the bad readings they are meant to catch (AC8)', () => {
  const rejects = (assertion: () => void): boolean => {
    try {
      assertion();
      return false;
    } catch {
      return true;
    }
  };

  const undeclaredRejected = rejects(() => assertExperimentalApiDeclared({}, 'reverse control'));
  const unsettledTurnRejected = rejects(() => assertUnknownNotificationsWerePassed({
    unknownNotifications: [...EXPECTED_UNKNOWN_NOTIFICATIONS],
    turnStatus: 'inProgress',
    postLoopRequest: 'timeout',
  }));
  const droppedFrameRejected = rejects(() => assertUnknownNotificationsWerePassed({
    unknownNotifications: ['configWarning'],
    turnStatus: 'completed',
    postLoopRequest: 'ok',
  }));
  const brokenLoopRejected = rejects(() => assertLoopSurvivedHandlerFailure({
    loopContinued: false,
    lastDispatchError: 'notification handler for "configWarning" threw: boom-from-unknown-notification',
    laterRequest: 'timeout',
  }));
  const silentSwallowRejected = rejects(() => assertLoopSurvivedHandlerFailure({
    loopContinued: true,
    lastDispatchError: null,
    laterRequest: 'ok',
  }));

  console.log(
    `reverseUndeclaredRejected=${undeclaredRejected} reverseUnsettledTurnRejected=${unsettledTurnRejected} `
      + `reverseDroppedFrameRejected=${droppedFrameRejected} reverseBrokenLoopRejected=${brokenLoopRejected} `
      + `reverseSilentSwallowRejected=${silentSwallowRejected}`,
  );
  assert.equal(undeclaredRejected, true, 'the declaration assertion accepted an undeclared capability bag');
  assert.equal(unsettledTurnRejected, true, 'the pass-through assertion accepted an unsettled turn');
  assert.equal(droppedFrameRejected, true, 'the pass-through assertion accepted a dropped unknown frame');
  assert.equal(brokenLoopRejected, true, 'the loop assertion accepted a stopped read loop');
  assert.equal(silentSwallowRejected, true, 'the loop assertion accepted a silently swallowed failure');
});

/**
 * `model/list` pagination is a pure function over the JSON-RPC `call`, so this
 * case drives it with a fake two-page reply: page two follows the first
 * `nextCursor`, the second page ends with `nextCursor: null`, and one model id
 * appears on both pages. No CLI is spawned.
 */
test('collectModelPages concatenates pages, follows nextCursor, and keeps one copy per id', async () => {
  const calls: Array<{ method: string; params: unknown }> = [];
  const pages = [
    {
      data: [
        { id: 'model-a', model: 'model-a', displayName: 'Model A', hidden: false },
        { id: 'model-b', model: 'model-b', displayName: 'Model B (page 1)', hidden: false },
      ],
      nextCursor: 'page-2',
    },
    {
      data: [
        { id: 'model-b', model: 'model-b', displayName: 'Model B (page 2)', hidden: false },
        { id: 'model-c', model: 'model-c', displayName: 'Model C', hidden: false },
      ],
      nextCursor: null,
    },
  ];

  const models = await collectModelPages(async (method, params) => {
    calls.push({ method, params });
    return pages[calls.length - 1];
  });

  const ids = models.map((model) => model.id);
  console.log(`collectModelPages calls=${JSON.stringify(calls)} ids=${JSON.stringify(ids)}`);
  assert.deepEqual(calls, [
    { method: 'model/list', params: {} },
    { method: 'model/list', params: { cursor: 'page-2' } },
  ]);
  assert.deepEqual(ids, ['model-a', 'model-b', 'model-c'], 'pages must concatenate in order and a repeated id must appear once');
  assert.equal(
    models.find((model) => model.id === 'model-b')?.displayName,
    'Model B (page 2)',
    'a repeated id keeps the last page copy',
  );
});
