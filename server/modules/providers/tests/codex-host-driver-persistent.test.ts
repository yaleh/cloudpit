import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexAppServerConnection,
  type CodexAppServerTransport,
} from '@/modules/providers/list/codex/codex-app-server.connection.js';
import {
  threadDefaultsFromLaunchOptions,
  threadParams,
  turnParams,
  type CodexResidentHostPort,
} from '@/modules/providers/list/codex/codex-host-driver.contract.js';
import { CodexHostDriver } from '@/modules/providers/list/codex/codex-host-driver.provider.js';
import type { IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  HostTurnInput,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';

/**
 * The criterion for AC-435: a resident Codex driver holds one app-server process
 * and one thread across turns, resumes after the first turn, falls back to
 * `thread/start` for a zero-turn thread, and interrupts a turn without killing
 * the process.
 *
 * The transport is an in-memory JSON-RPC server stub: it answers `initialize`,
 * `thread/start`, `thread/resume`, `turn/start` and `turn/interrupt` and records
 * the method sequence. A fixed fake pid is what the identity legs read, so no
 * Codex process is started here.
 */

type Call = { method: string; params: Record<string, unknown> };

class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid = 424_242;
  readonly calls: Call[] = [];
  /** Whether `turn/start` settles immediately; false is the interrupted-turn leg. */
  autoComplete = true;

  private readonly materialised = new Set<string>();
  private readonly activeTurns = new Map<string, string>();
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
        this.reply(message.id, { thread: { id, status: { type: 'idle' } } });
        return;
      }
      case 'thread/resume': {
        const threadId = String(params.threadId ?? '');
        if (!this.materialised.has(threadId)) {
          // The locked 0.153.4 reading (REPORT E1): a thread with no turn has
          // no rollout, so resume fails with this exact shape.
          this.fail(message.id, `no rollout found for thread id ${threadId}`);
          return;
        }
        this.reply(message.id, { thread: { id: threadId, status: { type: 'idle' } } });
        return;
      }
      case 'turn/start': {
        const threadId = String(params.threadId ?? '');
        const turnId = `turn-${++this.turnSerial}`;
        this.activeTurns.set(threadId, turnId);
        this.reply(message.id, { turn: { id: turnId, status: 'inProgress' } });
        this.emit('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
        if (this.autoComplete) {
          this.completeTurn(threadId, turnId, 'completed');
        }
        return;
      }
      case 'turn/interrupt': {
        const threadId = String(params.threadId ?? '');
        const turnId = String(params.turnId ?? this.activeTurns.get(threadId) ?? '');
        this.reply(message.id, {});
        this.completeTurn(threadId, turnId, 'interrupted');
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

  /** Test-only: what the fake would announce if the process died on its own. */
  die(reason: string): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.exitHandler?.(reason);
  }

  private completeTurn(threadId: string, turnId: string, status: 'completed' | 'interrupted'): void {
    this.materialised.add(threadId);
    this.activeTurns.delete(threadId);
    this.emit('turn/completed', { threadId, turn: { id: turnId, status } });
  }

  private reply(id: number | undefined, result: unknown): void {
    this.deliver({ jsonrpc: '2.0', id, result });
  }

  private fail(id: number | undefined, message: string): void {
    this.deliver({ jsonrpc: '2.0', id, error: { code: -32_000, message } });
  }

  private emit(method: string, params: unknown): void {
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

/** One round's identity reading; the criterion's positive and reverse controls share it. */
type IdentityReading = {
  turn: number;
  threadId: string | null;
  hostPid: number | null;
  transportPid: number | null;
};

/** Throws when any round drifted from the first, naming the field and the turn. */
function assertStableIdentity(readings: IdentityReading[]): void {
  assert.ok(readings.length > 0, 'no rounds were read');
  const first = readings[0];
  for (const reading of readings) {
    assert.equal(
      reading.threadId,
      first.threadId,
      `threadId drifted: turn=${reading.turn} threadId=${reading.threadId} firstTurn=${first.turn} firstThreadId=${first.threadId}`,
    );
    assert.equal(
      reading.hostPid,
      first.hostPid,
      `hostPid drifted: turn=${reading.turn} hostPid=${reading.hostPid} firstTurn=${first.turn} firstHostPid=${first.hostPid}`,
    );
    assert.equal(
      reading.transportPid,
      first.transportPid,
      `transportPid drifted: turn=${reading.turn} transportPid=${reading.transportPid} firstTurn=${first.turn} firstTransportPid=${first.transportPid}`,
    );
  }
}

/** One interrupt round's liveness reading; shared by the positive and reverse-control legs. */
type InterruptReading = {
  interruptTurnStatus: string;
  threadIdBefore: string | null;
  beforePid: number | null;
  afterPid: number | null;
  nextTurnPid: number | null;
  nextTurnThreadId: string | null;
  aliveBefore: boolean;
  aliveAfter: boolean;
};

/** Throws when interrupt killed or replaced the process, or moved the thread. */
function assertInterruptKeptProcess(reading: InterruptReading): void {
  // Liveness first: an interrupt that kills the process must be reported as
  // that, not as a downstream status or thread difference.
  assert.equal(reading.aliveBefore, true, 'transport reported the process gone before interrupt');
  assert.equal(reading.aliveAfter, true, 'transport reported the process gone after interrupt');
  assert.equal(
    reading.afterPid,
    reading.beforePid,
    `pid changed across interrupt: beforePid=${reading.beforePid} afterPid=${reading.afterPid}`,
  );
  assert.equal(
    reading.nextTurnPid,
    reading.beforePid,
    `pid changed across the next turn: beforePid=${reading.beforePid} nextTurnPid=${reading.nextTurnPid}`,
  );
  assert.equal(
    reading.nextTurnThreadId,
    reading.threadIdBefore,
    `threadId changed across interrupt: before=${reading.threadIdBefore} next=${reading.nextTurnThreadId}`,
  );
  assert.equal(
    reading.interruptTurnStatus,
    'interrupted',
    `interruptTurnStatus=${reading.interruptTurnStatus} expected=interrupted`,
  );
}

test('three resident rounds keep one thread id and one process (AC2/AC3)', async () => {
  const { driver, transport } = createDriver();
  const host = createHost();
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-1', null));

    const readings: IdentityReading[] = [];
    for (let round = 1; round <= 3; round += 1) {
      await driver.submit(host, 'session-1', turn(`round ${round}`));
      const session = driver.readSession('session-1');
      readings.push({
        turn: round,
        threadId: session.threadId,
        hostPid: host.pid,
        transportPid: transport.pid,
      });
    }

    for (const reading of readings) {
      console.log(
        `turn=${reading.turn} threadId=${reading.threadId} hostPid=${reading.hostPid} transportPid=${reading.transportPid}`,
      );
    }
    assertStableIdentity(readings);
    console.log(`identity=accepted turns=${readings.length}`);

    const sequence = transport.calls.map((call) => call.method);
    console.log(`methodSequence=${sequence.join(',')}`);
    const threadStarts = transport.calls.filter((call) => call.method === 'thread/start');
    const threadResumes = transport.calls.filter((call) => call.method === 'thread/resume');
    console.log(`threadStartCount=${threadStarts.length} threadResumeCount=${threadResumes.length}`);
    assert.equal(threadStarts.length, 1, 'first round must be the only thread/start');
    assert.equal(threadResumes.length, 2, 'the second and third rounds must each resume');
    for (const resume of threadResumes) {
      assert.equal(resume.params.threadId, readings[0].threadId, 'resume must name the first round thread');
    }
  } finally {
    await driver.closeHost(host, 'user');
  }
  assert.equal(transport.isAlive(), false, 'closeHost must terminate the connection');
});

test('a zero-turn thread falls back to thread/start (AC4)', async () => {
  const { driver, transport } = createDriver();
  const host = createHost();
  const zeroTurnThread = 'thread-zero-turn';
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-zero', zeroTurnThread));

    await driver.submit(host, 'session-zero', turn('first round after restore'));
    const reading = driver.readSession('session-zero');
    const turnStarts = transport.calls.filter((call) => call.method === 'turn/start');
    const turnThreadId = String(turnStarts[turnStarts.length - 1]?.params.threadId ?? '');
    console.log(
      `resumeError=${reading.lastResumeError} fallbackThreadId=${reading.threadId} turnThreadId=${turnThreadId}`,
    );

    assert.match(String(reading.lastResumeError), /no rollout found/, 'resume must fail with the locked error shape');
    assert.notEqual(reading.threadId, zeroTurnThread, 'fallback must replace the zero-turn id');
    assert.equal(turnThreadId, reading.threadId, 'the fallback thread must carry the turn');

    // The old id must not be written back: the next round resumes the new id.
    await driver.submit(host, 'session-zero', turn('second round'));
    const resumes = transport.calls.filter((call) => call.method === 'thread/resume');
    assert.equal(resumes[resumes.length - 1]?.params.threadId, reading.threadId, 'next resume must use the fallback id');
  } finally {
    await driver.closeHost(host, 'user');
  }
  assert.equal(transport.isAlive(), false);
});

test('interrupt stops the turn without killing the process (AC5)', async () => {
  const { driver, transport } = createDriver();
  const host = createHost();
  transport.autoComplete = false;
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-interrupt', null));

    const submitPromise = driver.submit(host, 'session-interrupt', turn('a turn to interrupt'));
    await waitFor(() => driver.readSession('session-interrupt').turnStatus === 'inProgress', 'turn in flight');

    const before = driver.readSession('session-interrupt');
    const reading: InterruptReading = {
      interruptTurnStatus: '',
      threadIdBefore: before.threadId,
      beforePid: transport.pid,
      afterPid: null,
      nextTurnPid: null,
      nextTurnThreadId: null,
      aliveBefore: transport.isAlive(),
      aliveAfter: false,
    };
    assert.equal(await driver.interrupt(host, 'session-interrupt'), true, 'interrupt must report it stopped a turn');
    // A driver that killed the process may not even answer for the session any
    // more; keep the reading incomplete and let the shared assertion name it.
    let interrupted: ReturnType<CodexHostDriver['readSession']> | null = null;
    try {
      interrupted = driver.readSession('session-interrupt');
    } catch (error) {
      console.log(`sessionAfterInterruptError=${error instanceof Error ? error.message : String(error)}`);
    }
    reading.interruptTurnStatus = String(interrupted?.turnStatus ?? 'missing');
    reading.afterPid = transport.pid;
    reading.aliveAfter = transport.isAlive();
    await submitPromise;

    transport.autoComplete = true;
    try {
      await driver.submit(host, 'session-interrupt', turn('a turn after interrupt'));
      reading.nextTurnPid = transport.pid;
      reading.nextTurnThreadId = driver.readSession('session-interrupt').threadId;
    } catch (error) {
      // A driver that killed the process has no next turn; keep the reading
      // incomplete and let the shared assertion name what is missing.
      console.log(`nextTurnError=${error instanceof Error ? error.message : String(error)}`);
    }

    console.log(
      `interruptTurnStatus=${reading.interruptTurnStatus} beforePid=${reading.beforePid} afterPid=${reading.afterPid} nextTurnPid=${reading.nextTurnPid} nextTurnThreadId=${reading.nextTurnThreadId}`,
    );
    console.log(`transportAliveBefore=${reading.aliveBefore} transportAliveAfter=${reading.aliveAfter}`);
    assertInterruptKeptProcess(reading);
  } finally {
    await driver.closeHost(host, 'user');
  }
  assert.equal(transport.isAlive(), false);
});

test('reverse controls reject drifted identity and a killed process (AC6)', () => {
  const identityRejected = (() => {
    try {
      assertStableIdentity([
        { turn: 1, threadId: 'thread-a', hostPid: 1, transportPid: 1 },
        { turn: 2, threadId: 'thread-b', hostPid: 1, transportPid: 1 },
      ]);
      return false;
    } catch {
      return true;
    }
  })();
  const pidChangeRejected = (() => {
    try {
      assertInterruptKeptProcess({
        interruptTurnStatus: 'interrupted',
        threadIdBefore: 'thread-a',
        beforePid: 1,
        afterPid: 2,
        nextTurnPid: 2,
        nextTurnThreadId: 'thread-a',
        aliveBefore: true,
        aliveAfter: true,
      });
      return false;
    } catch {
      return true;
    }
  })();
  const processGoneRejected = (() => {
    try {
      assertInterruptKeptProcess({
        interruptTurnStatus: 'interrupted',
        threadIdBefore: 'thread-a',
        beforePid: 1,
        afterPid: 1,
        nextTurnPid: 1,
        nextTurnThreadId: 'thread-a',
        aliveBefore: true,
        aliveAfter: false,
      });
      return false;
    } catch {
      return true;
    }
  })();

  console.log(
    `reverseIdentityRejected=${identityRejected} reversePidChangeRejected=${pidChangeRejected} reverseProcessGoneRejected=${processGoneRejected}`,
  );
  assert.equal(identityRejected, true, 'identity assertion accepted a per-round thread change');
  assert.equal(pidChangeRejected, true, 'liveness assertion accepted a pid change');
  assert.equal(processGoneRejected, true, 'liveness assertion accepted a dead process');
});

test('driver conforms to IProviderHostDriver with multiplexedHost=false (AC8)', () => {
  const { driver } = createDriver();
  const conformance: IProviderHostDriver = driver;
  console.log(`multiplexedHost=${conformance.multiplexedHost}`);
  assert.equal(conformance.multiplexedHost, false);
  for (const verb of ['startHost', 'bind', 'submit', 'interrupt', 'reconfigure', 'unbind', 'closeHost'] as const) {
    assert.equal(typeof conformance[verb], 'function', `${verb} must be implemented`);
  }
  assert.equal(typeof driver.run, 'function', 'the resident turn entry must be present');
});

/**
 * The failure this criterion pins: CloudCLI's `default` effort sentinel is not
 * a codex effort, and the locked 0.153.4 app-server refuses the whole turn with
 * `Invalid value: 'default'` rather than ignoring the field.
 */
test("turn/start omits CloudCLI's 'default' effort and forwards a codex value (AC1)", () => {
  const withDefault = turnParams('thread-effort', { command: 'hi', options: { effort: 'default' } });
  const withHigh = turnParams('thread-effort', { command: 'hi', options: { effort: 'high' } });
  const withUltracode = turnParams('thread-effort', { command: 'hi', options: { effort: 'ultracode' } });
  console.log(
    `defaultHasEffort=${'effort' in withDefault} highEffort=${String(withHigh.effort)} ` +
      `ultracodeHasEffort=${'effort' in withUltracode}`,
  );
  assert.deepEqual(
    withDefault,
    { threadId: 'thread-effort', input: [{ type: 'text', text: 'hi' }] },
    "the 'default' sentinel must leave the effort field out of turn/start",
  );
  assert.equal(withHigh.effort, 'high', "a codex-supported effort ('high') must be forwarded verbatim");
  assert.equal('effort' in withUltracode, false, 'a non-codex effort must be dropped rather than forwarded');
});

/**
 * The failure this criterion pins: the resident launch carries the session's
 * `permissionMode`, but the first `thread/start` used to drop it and ran on the
 * app-server's own sandbox/approval defaults — neither GOAL-051's
 * workspace-write + never nor the Claude resident's trusted bypass.
 */
test('the first thread/start carries the launch permission mode (AC1)', async () => {
  const bypass = threadParams({}, threadDefaultsFromLaunchOptions({
    cwd: '/work/project',
    permissionMode: 'bypassPermissions',
  }));
  const defaultMode = threadParams({}, threadDefaultsFromLaunchOptions({
    cwd: '/work/project',
    permissionMode: 'default',
  }));
  const noMode = threadParams({}, threadDefaultsFromLaunchOptions({ cwd: '/work/project' }));
  console.log(
    `bypassApproval=${String(bypass.approvalPolicy)} bypassSandbox=${String(bypass.sandbox)} ` +
      `defaultApproval=${String(defaultMode.approvalPolicy)} defaultSandbox=${String(defaultMode.sandbox)} ` +
      `noModeHasApproval=${'approvalPolicy' in noMode} noModeHasSandbox=${'sandbox' in noMode}`,
  );

  assert.deepEqual(
    { approvalPolicy: bypass.approvalPolicy, sandbox: bypass.sandbox },
    { approvalPolicy: 'never', sandbox: 'danger-full-access' },
    'bypassPermissions must reach thread/start as the trusted app-server equivalent',
  );
  assert.deepEqual(
    { approvalPolicy: defaultMode.approvalPolicy, sandbox: defaultMode.sandbox },
    { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
    "an ordinary mode must keep GOAL-051's workspace-write sandbox",
  );
  assert.equal('approvalPolicy' in noMode, false, 'a launch without a permission mode must not write approvalPolicy');
  assert.equal('sandbox' in noMode, false, 'a launch without a permission mode must not write sandbox');

  // End to end over the same cold-start path production uses: a resident
  // session's first turn opens its host from the turn options, and the first
  // thread/start frame is what app-server actually receives.
  const transport = new FakeAppServerTransport();
  const hostPort = createFakeHostPort();
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
    host: hostPort,
  });
  const writer = { send: () => {} } as unknown as ProviderRuntimeWriter;
  const context = { resolveProviderSessionId: () => null } as unknown as ProviderRuntimeContext;
  try {
    await driver.run(
      'session-permission',
      { command: 'first', options: { permissionMode: 'bypassPermissions' } },
      writer,
      context,
    );
    const starts = transport.calls.filter((call) => call.method === 'thread/start');
    const first = starts[0]?.params ?? {};
    console.log(`wireThreadStart=${JSON.stringify(first)}`);
    assert.equal(starts.length, 1, 'the first resident turn must send exactly one thread/start');
    assert.equal(first.approvalPolicy, 'never', 'the wire thread/start must carry approvalPolicy=never');
    assert.equal(first.sandbox, 'danger-full-access', 'the wire thread/start must carry the full-access sandbox');
  } finally {
    for (const host of hostPort.hosts) {
      await driver.closeHost(host, 'user');
    }
  }
});

/**
 * A minimal in-memory stand-in for the session-host manager's `openHost`/`snapshot`
 * verbs, so the cold-start path inside `run` (which calls `startResidentSession` ->
 * `openHost`) can be exercised with two sessions sharing one driver.
 */
function createFakeHostPort(): CodexResidentHostPort & { hosts: ProcessHost[] } {
  const hosts: ProcessHost[] = [];
  const port = {
    hosts,
    async openHost(input: { provider: string; mode: string; appSessionId: string; driver: IProviderHostDriver }) {
      const host = createHost();
      host.hostId = `codex-host-${hosts.length + 1}`;
      const binding = createBinding(input.appSessionId, null);
      host.bindings = new Map([[input.appSessionId, binding]]);
      hosts.push(host);
      await input.driver.startHost(host, createSink());
      await input.driver.bind(host, binding);
      return host;
    },
    snapshot: () => [...hosts],
  };
  return port as CodexResidentHostPort & { hosts: ProcessHost[] };
}

test('a second resident session opens its own host and thread instead of reusing the first (cold-start regression)', async () => {
  const transport = new FakeAppServerTransport();
  const hostPort = createFakeHostPort();
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
    host: hostPort,
  });
  const writer = { send: () => {} } as unknown as ProviderRuntimeWriter;
  const context = { resolveProviderSessionId: () => null } as unknown as ProviderRuntimeContext;
  try {
    await driver.run('session-1', turn('first'), writer, context);
    await driver.run('session-2', turn('second'), writer, context);
    const first = driver.readSession('session-1');
    const second = driver.readSession('session-2');
    console.log(
      `session1.threadId=${first.threadId} session2.threadId=${second.threadId} hosts=${hostPort.hosts.length}`,
    );
    assert.ok(first.threadId, 'session-1 must have its own thread');
    assert.ok(second.threadId, 'session-2 must have its own thread');
    assert.notEqual(second.threadId, first.threadId, 'the second session must not reuse the first session thread');
    assert.equal(hostPort.hosts.length, 2, 'the second session must open its own host');
  } finally {
    for (const host of hostPort.hosts) {
      await driver.closeHost(host, 'user');
    }
  }
});

test('the resident turn announces session_created with the thread id (transcript link)', async () => {
  const transport = new FakeAppServerTransport();
  const hostPort = createFakeHostPort();
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
    host: hostPort,
  });
  const sent: unknown[] = [];
  const writer = { send: (data: unknown) => { sent.push(data); } } as unknown as ProviderRuntimeWriter;
  const context = { resolveProviderSessionId: () => null } as unknown as ProviderRuntimeContext;
  try {
    await driver.run('session-1', turn('first'), writer, context);
    const created = sent.filter((m) => (m as { kind?: string }).kind === 'session_created');
    console.log(`sessionCreated=${JSON.stringify(created)}`);
    assert.equal(created.length, 1, 'the first resident turn must announce one session_created');
    const message = created[0] as { newSessionId?: string };
    assert.equal(
      message.newSessionId,
      driver.readSession('session-1').threadId,
      'session_created must name the thread id so the transcript reader can find the rollout',
    );
  } finally {
    for (const host of hostPort.hosts) {
      await driver.closeHost(host, 'user');
    }
  }
});
