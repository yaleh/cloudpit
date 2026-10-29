/**
 * Criterion for AC-441: the Codex resident driver's contract with the
 * session-host layer.
 *
 * The manager already owns every generic rule — a resident host opens holding
 * `resident-policy`, a `turn` lease makes it `busy`, the quiet ceiling closes it
 * as `idle`, `unbindSession`/`closeHost` relay a reason, and an exit is reported
 * without asking the driver to kill anything. What this file proves is that the
 * Codex driver is really wired into each of them:
 *
 *   (a) a resident host opens `idle`, holding exactly `resident-policy`, with the
 *       process's pid on the record and `startHost` called once;
 *   (b) `submit` reports a `turn` lease, so the host is `busy` while the turn
 *       runs and back to `idle` when it settles — and a rejected `turn/start`
 *       releases the lease rather than leaving the host stuck `busy`;
 *   (c) the reason the manager records is the reason the driver received, for
 *       both `closeHost` and `unbind`, while a self-reported process exit closes
 *       the host as `exited` without calling the driver's `closeHost`;
 *   (d) the quiet ceiling closes the host as `idle` and the driver records the
 *       same reason;
 *   (e) the restore pass reaches `startResidentSession`, the host comes up
 *       holding `resident-policy`, the conversation resumes its own provider
 *       thread (not a fresh one), and a second start is idempotent;
 *   (f) the registry mounts the driver on `codex` with `multiplexedHost=false`.
 *
 * Hermetic: the transport is an in-memory JSON-RPC server over the app-server's
 * own connection object, the pid is a fixed number, and the clock and scheduler
 * are values the test owns. No Codex process is spawned, no database and no
 * network are touched, and the provider registry is imported only for the
 * mounting reading.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexAppServerConnection,
  CodexHostDriver,
  type CodexAppServerTransport,
  type CodexResidentHostPort,
} from '@/modules/providers/index.js';
import {
  createResidentRestoreService,
  createSessionHostManager,
} from '@/modules/session-hosts/index.js';
import type { HostScheduler, ProcessHost } from '@/modules/session-hosts/index.js';
import type { IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  HostResidentLaunch,
  ProviderModelsDefinition,
  ProviderRuntimeContext,
} from '@/shared/types.js';

// ---------------------------
//----------------- FAKE TRANSPORT ------------
type Call = { method: string; params: Record<string, unknown> };

/**
 * An in-memory `codex app-server` peer.
 *
 * It answers the methods AC-435's driver issues, records the method sequence,
 * and lets the test choose *when* a turn finishes: `autoCompleteTurn` is off by
 * default so the `busy` window is observable instead of being raced by a
 * synchronous completion. `failNextTurnStart` gives the rejected-`turn/start`
 * leg an exact JSON-RPC error. `terminateCalls` is the reading for "the
 * connection was closed exactly once" — the connection's own `close()` is the
 * only caller of `terminate()`.
 */
class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid = 424_242;
  readonly calls: Call[] = [];
  /** `connection.close()` → `terminate()`, counted. */
  terminateCalls = 0;
  /** Whether `turn/start` finishes the turn immediately. */
  autoCompleteTurn = false;
  /** When set, the next `turn/start` answers with this JSON-RPC error message. */
  failNextTurnStart: string | null = null;

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
        // A resume of any named thread succeeds here: the zero-turn fallback is
        // AC-435's subject, and this criterion needs the plain adopt path.
        const threadId = String(params.threadId ?? '');
        this.reply(message.id, { thread: { id: threadId, status: { type: 'idle' } } });
        return;
      }
      case 'turn/start': {
        if (this.failNextTurnStart !== null) {
          const reason = this.failNextTurnStart;
          this.failNextTurnStart = null;
          this.fail(message.id, reason);
          return;
        }
        const threadId = String(params.threadId ?? '');
        const turnId = `turn-${++this.turnSerial}`;
        this.activeTurns.set(threadId, turnId);
        this.reply(message.id, { turn: { id: turnId, status: 'inProgress' } });
        this.emit('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
        if (this.autoCompleteTurn) {
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

  /** Idempotent, and deliberately does not report an exit (the transport contract). */
  terminate(): void {
    this.terminateCalls += 1;
    this.alive = false;
  }

  /** Test-only: what the fake announces when the process dies on its own. */
  die(reason: string): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.exitHandler?.(reason);
  }

  /** Finishes the most recently started turn. */
  completeLastTurn(status: 'completed' | 'interrupted' = 'completed'): void {
    const entries = [...this.activeTurns.entries()];
    const last = entries[entries.length - 1];
    if (!last) {
      throw new Error('the fake transport has no turn in flight');
    }
    this.completeTurn(last[0], last[1], status);
  }

  private completeTurn(threadId: string, turnId: string, status: 'completed' | 'interrupted'): void {
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

// ---------------------------
//----------------- HARNESS ------------
type DriverStats = {
  startHostCalls: number;
  closeHostCalls: number;
  leaseAdded: number;
  leaseRemoved: number;
};

/**
 * One driver over one fake transport, with the sink and the close verb observed.
 *
 * The manager hands the sink to `startHost`; wrapping that parameter is the only
 * place the lease reports can be counted without the driver exposing its sink.
 * Wrapping `closeHost` is what separates "the manager relayed a close" from "the
 * process exited and the manager closed the record without asking the driver".
 */
function createHarness(hostPort?: CodexResidentHostPort): {
  driver: CodexHostDriver;
  transport: FakeAppServerTransport;
  stats: DriverStats;
} {
  const transport = new FakeAppServerTransport();
  const driver = new CodexHostDriver({
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
    host: hostPort,
  });
  const stats: DriverStats = {
    startHostCalls: 0,
    closeHostCalls: 0,
    leaseAdded: 0,
    leaseRemoved: 0,
  };

  const originalStartHost = driver.startHost.bind(driver);
  driver.startHost = async (host, sink) => {
    stats.startHostCalls += 1;
    const observed: IProviderHostDriverSink = {
      ...sink,
      leaseAdded: (appSessionId, lease) => {
        stats.leaseAdded += 1;
        sink.leaseAdded(appSessionId, lease);
      },
      leaseRemoved: (appSessionId, kind) => {
        stats.leaseRemoved += 1;
        sink.leaseRemoved(appSessionId, kind);
      },
    };
    return originalStartHost(host, observed);
  };

  const originalCloseHost = driver.closeHost.bind(driver);
  driver.closeHost = async (host, reason) => {
    stats.closeHostCalls += 1;
    return originalCloseHost(host, reason);
  };

  return { driver, transport, stats };
}

/** One entry from the manager's own read port, refusing a missing id. */
function readHost(
  manager: ReturnType<typeof createSessionHostManager>,
  hostId: string,
): ProcessHost {
  const host = manager.snapshot().find((candidate) => candidate.hostId === hostId);
  assert.ok(host, `host ${hostId} is missing from snapshot()`);
  return host;
}

/** The lease kinds one binding holds, in the manager's order. */
function leaseKinds(host: ProcessHost, appSessionId: string): string[] {
  const binding = host.bindings.get(appSessionId);
  assert.ok(binding, `host ${host.hostId} has no binding for ${appSessionId}`);
  return binding.leases.map((lease) => lease.kind);
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

/** Lets one settled manager→driver promise run before a reading is taken. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** The provider-scoped lookups `startResidentSession` reads more than an id from. */
function createContext(providerSessionId: string | null): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => providerSessionId,
    resolveResumeModel: async () => undefined,
    getProviderModels: async () => ({ models: [] }) as unknown as ProviderModelsDefinition,
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
}

// ---------------------------
//----------------- FAKE CLOCK ------------
/**
 * A scheduler whose deadlines are queue entries and whose clock is a number.
 *
 * Copied from `session-host-lifecycle.test.ts`'s fixture: `advance` moves the
 * clock first and then drains everything that came due in deadline order, so a
 * 24-hour-style ceiling is reached without any wall-clock wait.
 */
type FakeClock = HostScheduler & {
  now(): number;
  advance(ms: number): void;
  pending(): number;
};

type ClockEntry = { at: number; run: () => void; spent: boolean };

function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let current = start;
  const entries: ClockEntry[] = [];

  return {
    now: () => current,
    schedule(at, run) {
      const entry: ClockEntry = { at, run, spent: false };
      entries.push(entry);
      return () => {
        entry.spent = true;
      };
    },
    advance(ms) {
      current += ms;
      for (;;) {
        const due = entries
          .filter((entry) => !entry.spent && entry.at <= current)
          .sort((left, right) => left.at - right.at)[0];
        if (!due) {
          return;
        }
        due.spent = true;
        due.run();
      }
    },
    pending: () => entries.filter((entry) => !entry.spent).length,
  };
}

function createManager(clock: FakeClock, quietCeilingMs?: number) {
  return createSessionHostManager({
    now: () => clock.now(),
    scheduler: clock,
    ...(quietCeilingMs === undefined ? {} : { residentPolicy: { quietCeilingMs } }),
  });
}

// ---------------------------
//----------------- (a) RESIDENT-POLICY LEASE ------------
test('AC2: a resident host opens idle, holding only resident-policy, with the process pid', async () => {
  const manager = createSessionHostManager();
  const { driver, transport, stats } = createHarness();
  const opened = await manager.openHost({
    provider: 'codex',
    mode: 'resident',
    appSessionId: 'session-open',
    driver,
  });
  try {
    const host = readHost(manager, opened.hostId);
    const leases = leaseKinds(host, 'session-open');
    console.log(`open state=${host.state} leases=${leases.join('+')} pid=${host.pid}`);

    assert.equal(host.state, 'idle', 'a resident host with only the policy lease is idle');
    assert.deepEqual(leases, ['resident-policy'], 'the policy lease is the mode opening it');
    assert.equal(host.pid, transport.pid, 'the pid on the record is the process the transport reports');
    assert.equal(stats.startHostCalls, 1, 'startHost is called exactly once');
  } finally {
    manager.closeHost(opened.hostId, 'user');
  }
});

// ---------------------------
//----------------- (b) TURN BUSY / IDLE ------------
test('AC3: a turn reports a turn lease (busy) and settles back to idle', async () => {
  const manager = createSessionHostManager();
  const { driver, transport, stats } = createHarness();
  const opened = await manager.openHost({
    provider: 'codex',
    mode: 'resident',
    appSessionId: 'session-turn',
    driver,
  });
  try {
    const turnPromise = driver.submit(readHost(manager, opened.hostId), 'session-turn', {
      command: 'hi',
      options: {},
    });
    await waitFor(
      () => transport.calls.some((call) => call.method === 'turn/start'),
      'turn/start',
    );

    const during = readHost(manager, opened.hostId);
    const duringLeases = leaseKinds(during, 'session-turn');
    console.log(`during state=${during.state} leases=${duringLeases.join('+')}`);
    assert.equal(during.state, 'busy', 'a turn in flight makes the host busy');
    assert.ok(duringLeases.includes('turn'), 'the turn lease is reported');
    assert.ok(duringLeases.includes('resident-policy'), 'the policy lease survives the turn');

    transport.completeLastTurn();
    await turnPromise;

    const after = readHost(manager, opened.hostId);
    const afterLeases = leaseKinds(after, 'session-turn');
    console.log(`after state=${after.state} leases=${afterLeases.join('+')}`);
    assert.equal(after.state, 'idle', 'a settled turn returns the resident host to idle');
    assert.deepEqual(afterLeases, ['resident-policy'], 'only the policy lease is left');

    console.log(`leaseAdded=${stats.leaseAdded} leaseRemoved=${stats.leaseRemoved}`);
    assert.equal(stats.leaseAdded, 1, 'one turn lease is reported');
    assert.equal(stats.leaseRemoved, 1, 'one turn lease is released');
  } finally {
    manager.closeHost(opened.hostId, 'user');
  }
});

test('AC3: a rejected turn/start releases its lease instead of leaving the host busy', async () => {
  const manager = createSessionHostManager();
  const { driver, transport, stats } = createHarness();
  const opened = await manager.openHost({
    provider: 'codex',
    mode: 'resident',
    appSessionId: 'session-rejected',
    driver,
  });
  try {
    transport.failNextTurnStart = 'turn/start refused by the fake server';
    await assert.rejects(
      () => driver.submit(readHost(manager, opened.hostId), 'session-rejected', {
        command: 'boom',
        options: {},
      }),
      /turn\/start refused/,
    );

    const after = readHost(manager, opened.hostId);
    const leases = leaseKinds(after, 'session-rejected');
    console.log(`rejected state=${after.state} leases=${leases.join('+')}`);
    assert.equal(after.state, 'idle', 'a turn that never started leaves the host idle');
    assert.deepEqual(leases, ['resident-policy'], 'the rejected turn does not leave a lease behind');
    assert.equal(stats.leaseAdded, 1, 'the lease was reported before the write');
    assert.equal(stats.leaseRemoved, 1, 'the rejection released it');
  } finally {
    manager.closeHost(opened.hostId, 'user');
  }
});

// ---------------------------
//----------------- (c) CLOSE / UNBIND / EXIT REASONS ------------
test('AC4: a close relays its reason to the driver and closes the connection once', async () => {
  const manager = createSessionHostManager();
  const { driver, transport, stats } = createHarness();
  const opened = await manager.openHost({
    provider: 'codex',
    mode: 'resident',
    appSessionId: 'session-close',
    driver,
  });

  manager.closeHost(opened.hostId, 'user');
  await settle();

  const host = readHost(manager, opened.hostId);
  console.log(`close reason=${host.closeReason} driverReason=${driver.lastCloseReason} closeCalls=${stats.closeHostCalls}`);
  assert.equal(host.closeReason, 'user', 'the manager records the reason it was given');
  assert.equal(driver.lastCloseReason, 'user', 'the driver receives the same reason');
  assert.equal(stats.closeHostCalls, 1, 'the driver is asked to close exactly once');
  assert.equal(transport.terminateCalls, 1, 'the connection is closed exactly once');
});

test('AC4: unbinding the last binding relays its reason to both the driver and the host', async () => {
  const manager = createSessionHostManager();
  const { driver } = createHarness();
  const opened = await manager.openHost({
    provider: 'codex',
    mode: 'resident',
    appSessionId: 'session-unbind',
    driver,
  });

  const detached = await manager.unbindSession('session-unbind', 'user');
  assert.equal(detached, true, 'a live binding is detached');

  const host = readHost(manager, opened.hostId);
  console.log(
    `unbind reason=user driverReason=${driver.lastUnbindReason} hostReason=${host.closeReason}`,
  );
  assert.equal(driver.lastUnbindReason, 'user', 'the driver receives the detach reason');
  assert.equal(host.closeReason, 'user', 'the last binding leaving closes the host under that reason');
});

test('AC4: a process exit closes the host as exited without calling the driver close verb', async () => {
  const manager = createSessionHostManager();
  const { driver, transport, stats } = createHarness();
  const opened = await manager.openHost({
    provider: 'codex',
    mode: 'resident',
    appSessionId: 'session-exit',
    driver,
  });

  transport.die('process crashed');
  await settle();

  const host = readHost(manager, opened.hostId);
  console.log(`exit hostReason=${host.closeReason} driverCloseCalled=${stats.closeHostCalls > 0}`);
  assert.equal(host.closeReason, 'exited', 'a self-reported exit is recorded as exited');
  assert.equal(stats.closeHostCalls, 0, 'an exit must not ask the driver to kill anything');
  assert.equal(driver.lastCloseReason, null, 'the driver never received a close reason');
});

// ---------------------------
//----------------- (d) IDLE TIMEOUT ------------
test('AC5: the quiet ceiling closes the resident host as idle and the driver records it', async () => {
  const ceiling = 5_000;
  const clock = createFakeClock();
  const manager = createManager(clock, ceiling);
  const { driver } = createHarness(manager);
  const opened = await manager.openHost({
    provider: 'codex',
    mode: 'resident',
    appSessionId: 'session-idle',
    driver,
  });

  const open = readHost(manager, opened.hostId);
  const windowStart = open.quietWindowStartAt ?? null;
  const deadline = open.quietDeadlineAt ?? null;
  console.log(
    `ceiling=${ceiling} windowStart=${windowStart} deadline=${deadline} ` +
      `closeReason=pending driverReason=pending`,
  );
  assert.ok(windowStart !== null && deadline !== null, 'the quiet window is armed while idle');
  assert.equal(deadline - windowStart, ceiling, 'the window is the resident ceiling');

  clock.advance(ceiling);
  await settle();

  const closed = readHost(manager, opened.hostId);
  const leases = leaseKinds(closed, 'session-idle');
  console.log(
    `ceiling=${ceiling} windowStart=${windowStart} deadline=${deadline} ` +
      `closeReason=${closed.closeReason} driverReason=${driver.lastCloseReason}`,
  );
  assert.equal(closed.state, 'closed', 'the deadline closes the host');
  assert.equal(closed.closeReason, 'idle', 'a resident host that went quiet is closed as idle');
  assert.equal(driver.lastCloseReason, 'idle', 'the driver records the same reason');
  assert.ok(!leases.includes('turn'), 'no turn lease was held when the ceiling closed it');
});

// ---------------------------
//----------------- (e) RESTORE ADOPTS THE PROVIDER THREAD ------------
test('AC6: restore starts through startResidentSession and resumes the provider thread', async () => {
  const clock = createFakeClock();
  const manager = createManager(clock);
  const { driver, transport, stats } = createHarness(manager);

  const launch: HostResidentLaunch = {
    options: { cwd: '/repo/project', model: 'gpt-5.2-codex' },
    context: createContext('thread-existing'),
  };
  const candidate = {
    appSessionId: 'session-restore',
    provider: 'codex' as const,
    providerSessionId: 'thread-existing',
    lastActiveAt: clock.now(),
  };

  let verbCalls = 0;
  const restore = createResidentRestoreService({
    listRestorableResidentSessions: () => [candidate],
    resolveHostDriver: (provider) => (provider === 'codex' ? driver : null),
    startResidentSession: (_provider, appSessionId) => {
      verbCalls += 1;
      return driver.startResidentSession(appSessionId, launch);
    },
    now: () => clock.now(),
    log: () => {},
  });

  const outcome = await restore.restore();
  const live = manager
    .snapshot()
    .find((host) => host.state !== 'closed' && host.bindings.has('session-restore'));
  assert.ok(live, 'the restore pass opened a host for the candidate');
  assert.equal(outcome.started.some((entry) => entry.appSessionId === 'session-restore'), true);
  assert.equal(outcome.skipped.some((entry) => entry.reason === 'no-resident-driver'), false);
  assert.equal(verbCalls, 1, 'the driver verb is called exactly once');
  assert.deepEqual(leaseKinds(live, 'session-restore'), ['resident-policy']);

  // A turn after the restore must resume the stored thread rather than start one.
  transport.autoCompleteTurn = true;
  await driver.submit(readHost(manager, live.hostId), 'session-restore', {
    command: 'continue',
    options: {},
  });
  const resumes = transport.calls.filter((call) => call.method === 'thread/resume');
  const resumeThreadId = String(resumes[resumes.length - 1]?.params.threadId ?? '');
  const threadStarts = transport.calls.filter((call) => call.method === 'thread/start').length;

  // The second start is a request for a state that already holds.
  const again = await driver.startResidentSession('session-restore', launch);
  const started = outcome.started[0];
  assert.equal(again.hostId, started.hostId, 'the same host answers a repeated start');
  assert.equal(again.pid, started.pid, 'a repeated start does not change the pid');
  assert.equal(stats.startHostCalls, 1, 'no second process was opened');

  console.log(
    `restore started=${outcome.started.map((entry) => entry.appSessionId).join(',')} ` +
      `skipped=${outcome.skipped.map((entry) => entry.reason).join(',') || 'none'} ` +
      `calls=${verbCalls} hostLeases=${leaseKinds(live, 'session-restore').join('+')} ` +
      `resumeThreadId=${resumeThreadId}`,
  );
  assert.equal(resumeThreadId, 'thread-existing', 'restore adopts the stored provider thread');
  assert.equal(threadStarts, 0, 'restore must not start a fresh thread');
});

// ---------------------------
//----------------- (f) MOUNTING ------------
test('AC7: the registry mounts the Codex host driver and it does not multiplex', async () => {
  // Imported here rather than at module scope: the mounting reading is the only
  // thing this file needs from the providers module, and keeping it local leaves
  // the rest of the criterion over the manager and driver alone.
  const { providerRegistry } = await import('@/modules/providers/index.js');
  const provider = providerRegistry.resolveProvider('codex');

  console.log(
    `provider=codex hostDriver=${provider.hostDriver?.constructor.name} ` +
      `multiplexedHost=${provider.hostDriver?.multiplexedHost}`,
  );
  assert.ok(provider.hostDriver instanceof CodexHostDriver, 'codex mounts a CodexHostDriver');
  assert.equal(provider.hostDriver.multiplexedHost, false, 'one process serves one conversation');
  assert.equal(
    typeof provider.hostDriver.startResidentSession,
    'function',
    'the on-demand start verb is reachable from the registry',
  );
});
