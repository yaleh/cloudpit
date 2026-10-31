import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexAppServerConnection,
  type CodexAppServerTransport,
} from '@/modules/providers/list/codex/codex-app-server.connection.js';
import { CodexHostDriver } from '@/modules/providers/list/codex/codex-host-driver.provider.js';
import type { IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  HostTurnInput,
  ProcessHost,
  ProviderRuntimeContext,
  SessionBinding,
} from '@/shared/types.js';

/**
 * The criterion for gap-codex-resident-closehost-orphans-other-sessions.
 *
 * The resident driver is a singleton (`multiplexedHost = false`), but the
 * server mounts one driver for its lifetime while several resident Codex
 * sessions each own one host. `closeHost` used to clear `sessions` wholesale
 * and latch the whole driver `closed`, so closing one host orphaned every
 * other session — its follow-up found the host still in the manager snapshot,
 * skipped the rebind, and then threw `CODEX_SESSION_NOT_BOUND`.
 *
 * The transport is an in-memory JSON-RPC stub, one per host; no Codex process
 * is started and each host's `terminate()` is counted so "closed exactly once"
 * is a reading rather than an assumption.
 */

type Call = { method: string; params: Record<string, unknown> };

class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid: number;
  readonly calls: Call[] = [];
  terminateCalls = 0;
  private readonly materialised = new Set<string>();
  private messageHandler: ((frame: string) => void) | null = null;
  private exitHandler: ((reason: string) => void) | null = null;
  private alive = true;
  private threadSerial = 0;
  private turnSerial = 0;

  constructor(pid: number) {
    this.pid = pid;
  }

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
        const id = `thread-${this.pid}-${++this.threadSerial}`;
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
        const turnId = `turn-${this.pid}-${++this.turnSerial}`;
        this.materialised.add(threadId);
        this.reply(message.id, { turn: { id: turnId, status: 'inProgress' } });
        this.emit('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
        this.emit('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
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
    this.terminateCalls += 1;
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

function createHost(hostId: string, appSessionId: string): ProcessHost {
  return {
    hostId,
    provider: 'codex',
    mode: 'resident',
    state: 'starting',
    pid: null,
    startedAt: Date.now(),
    bindings: new Map([[appSessionId, createBinding(appSessionId)]]),
    closeReason: null,
  };
}

function createHarness(): { driver: CodexHostDriver; transports: FakeAppServerTransport[] } {
  const transports: FakeAppServerTransport[] = [];
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => {
        // One transport per host, in `startHost` order: A is index 0, B index 1.
        const transport = new FakeAppServerTransport(424_242 + transports.length);
        transports.push(transport);
        return transport;
      },
    }),
  });
  return { driver, transports };
}

function turn(command: string): HostTurnInput {
  return { command, options: {} };
}

function turnStarts(transport: FakeAppServerTransport): Call[] {
  return transport.calls.filter((call) => call.method === 'turn/start');
}

test('closing one host leaves the sibling host session bound (AC2)', async () => {
  const { driver, transports } = createHarness();
  const hostA = createHost('codex-host-a', 'session-a');
  const hostB = createHost('codex-host-b', 'session-b');
  const sink = createSink();
  try {
    await driver.startHost(hostA, sink);
    await driver.bind(hostA, createBinding('session-a'));
    await driver.startHost(hostB, sink);
    await driver.bind(hostB, createBinding('session-b'));

    await driver.closeHost(hostA, 'user');

    let sessionBSurvives = false;
    let readError = '';
    try {
      driver.readSession('session-b');
      sessionBSurvives = true;
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
    const closeCalls = [transports[0].terminateCalls, transports[1].terminateCalls];
    console.log(`sessionBSurvives=${sessionBSurvives} closeCalls=[${closeCalls.join(',')}] readError=${readError}`);

    assert.equal(sessionBSurvives, true, `sessionB must survive hostA's close: ${readError}`);
    assert.deepEqual(closeCalls, [1, 0], 'only hostA\'s connection may be closed');
  } finally {
    await driver.closeHost(hostB, 'user');
  }
});

test('the surviving session runs a follow-up turn on its own host (AC3)', async () => {
  const { driver, transports } = createHarness();
  const hostA = createHost('codex-host-a', 'session-a');
  const hostB = createHost('codex-host-b', 'session-b');
  const sink = createSink();
  const writer = { send: () => {} };
  const context = {} as ProviderRuntimeContext;
  try {
    await driver.startHost(hostA, sink);
    await driver.bind(hostA, createBinding('session-a'));
    await driver.startHost(hostB, sink);
    await driver.bind(hostB, createBinding('session-b'));

    await driver.run('session-b', turn('first round'), writer, context);
    const threadId = driver.readSession('session-b').threadId;
    const startsBefore = turnStarts(transports[1]).length;

    await driver.closeHost(hostA, 'user');

    let followupTurnStarted = false;
    let followupThreadId: string | null = null;
    let followupError = '';
    try {
      await driver.run('session-b', turn('after the sibling host closed'), writer, context);
      followupTurnStarted = true;
      const starts = turnStarts(transports[1]);
      followupThreadId = String(starts[starts.length - 1]?.params.threadId ?? '');
    } catch (error) {
      followupError = error instanceof Error ? error.message : String(error);
    }
    console.log(
      `followupTurnStarted=${followupTurnStarted} threadId=${threadId} followupThreadId=${followupThreadId} error=${followupError}`,
    );

    assert.equal(followupTurnStarted, true, `sessionB's follow-up must run: ${followupError}`);
    assert.equal(followupThreadId, threadId, 'the follow-up must reuse the same thread');
    assert.equal(turnStarts(transports[1]).length, startsBefore + 1, 'exactly one new turn/start');
  } finally {
    await driver.closeHost(hostB, 'user');
  }
});

test('closeHost is idempotent per host and only its own session leaves the map (AC2 reverse)', async () => {
  const { driver, transports } = createHarness();
  const hostA = createHost('codex-host-a', 'session-a');
  const hostB = createHost('codex-host-b', 'session-b');
  const sink = createSink();
  try {
    await driver.startHost(hostA, sink);
    await driver.bind(hostA, createBinding('session-a'));
    await driver.startHost(hostB, sink);
    await driver.bind(hostB, createBinding('session-b'));

    await driver.closeHost(hostA, 'user');
    await driver.closeHost(hostA, 'user');

    const closeCalls = [transports[0].terminateCalls, transports[1].terminateCalls];
    let closedSessionError = '';
    try {
      driver.readSession('session-a');
    } catch (error) {
      closedSessionError = error instanceof Error ? error.message : String(error);
    }
    let siblingReadable = false;
    try {
      driver.readSession('session-b');
      siblingReadable = true;
    } catch {
      siblingReadable = false;
    }
    console.log(
      `closeCalls=[${closeCalls.join(',')}] closedSessionError=${closedSessionError} siblingReadable=${siblingReadable}`,
    );

    assert.deepEqual(closeCalls, [1, 0], 'a repeated close must not terminate a connection twice');
    assert.match(closedSessionError, /No Codex resident session is bound/, 'the closed host session must be gone');
    assert.equal(siblingReadable, true, 'the sibling session must still be readable');
  } finally {
    await driver.closeHost(hostB, 'user');
  }
});
