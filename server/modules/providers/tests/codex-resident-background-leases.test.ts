import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  CodexAppServerConnection,
  type CodexAppServerTransport,
} from '@/modules/providers/list/codex/codex-app-server.connection.js';
import { CodexHostDriver } from '@/modules/providers/list/codex/codex-host-driver.provider.js';
import type { IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type { HostLease, ProcessHost, SessionBinding } from '@/shared/types.js';

/**
 * The criterion for AC-439: a background `process/spawn` is a client-owned
 * process, so its hold is a `processHandle` ledger maintained by the driver and
 * released by `process/exited` — never `thread/backgroundTerminals/list`, which
 * the locked 0.153.4 reading (REPORT E5) shows stays `{data:[]}` while a
 * client-spawned process runs.
 *
 * Hermetic: an in-memory JSON-RPC transport (fixed pid, no real codex, no DB, no
 * network) plus a sink that replays `session-host-manager`'s lease semantics
 * (`(kind,id)` replacement, removal by kind, the lease's own `since` wins), so
 * the assertions compare the set the driver reports to the manager rather than
 * only a call count.
 */

type Call = { method: string; params: Record<string, unknown> };

const PROCESS_LIST = 'thread/backgroundTerminals/list';

class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid = 4_242_424;
  readonly calls: Call[] = [];
  /** When set, `process/spawn` answers with this JSON-RPC error message. */
  spawnError: string | null = null;
  /** The `data` array the agent-owned terminal list answers with. */
  backgroundTerminals: unknown[] = [];

  private readonly materialised = new Set<string>();
  private messageHandler: ((frame: string) => void) | null = null;
  private exitHandler: ((reason: string) => void) | null = null;
  private alive = true;
  private threadSerial = 0;

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
          this.fail(message.id, `no rollout found for thread id ${threadId}`);
          return;
        }
        this.reply(message.id, { thread: { id: threadId, status: { type: 'idle' } } });
        return;
      }
      case 'process/spawn':
        if (this.spawnError !== null) {
          this.fail(message.id, this.spawnError);
          return;
        }
        // E5: a successful spawn answers `{}`; the end arrives as a separate frame.
        this.reply(message.id, {});
        return;
      case 'process/kill':
        // E5: kill answers `{}` and the process's own `process/exited` follows.
        // The fake deliberately does not emit it here — that is AC6's reading.
        this.reply(message.id, {});
        return;
      case PROCESS_LIST:
        this.reply(message.id, { data: this.backgroundTerminals });
        return;
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
    this.alive = false;
  }

  /** Test-only: one server notification standing in for the real frame. */
  emitProcessExited(processHandle: string, exitCode: number): void {
    this.emit('process/exited', { processHandle, exitCode, stdout: '', stderr: '' });
  }

  /** Test-only: a streamed frame the driver must not turn into a lease. */
  emitOutputDelta(processHandle: string, text: string): void {
    this.emit('process/outputDelta', {
      processHandle,
      stream: 'stdout',
      deltaBase64: Buffer.from(text).toString('base64'),
      capReached: false,
    });
  }

  /** Test-only: what the fake announces when the process dies on its own. */
  die(reason: string): void {
    if (!this.alive) {
      return;
    }
    this.alive = false;
    this.exitHandler?.(reason);
  }

  /** How many times one method was written; AC5 reads this for the list. */
  callCount(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
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

type LeaseEvent =
  | { type: 'added'; appSessionId: string; lease: HostLease }
  | { type: 'removed'; appSessionId: string; kind: HostLease['kind'] };

type RecordingSink = {
  sink: IProviderHostDriverSink;
  events: LeaseEvent[];
  /** Handles the manager-view dropped, in order — AC7 reads it. */
  removedHandles: string[];
  /** What `session-host-manager` would hold for this session after those calls. */
  managerView(appSessionId: string): HostLease[];
  addedCount(appSessionId?: string): number;
};

/** The manager's replacement key: one lease per (kind, id). */
function leaseKey(lease: HostLease): string {
  switch (lease.kind) {
    case 'turn':
      return `turn:${lease.runId}`;
    case 'cron':
      return `cron:${lease.id}`;
    case 'resident-policy':
      return 'resident-policy';
    default:
      return `${lease.kind}:${lease.id}`;
  }
}

/**
 * A sink that keeps the same reading the manager would.
 *
 * `addLease` replaces by `(kind,id)` and prefers a `since` the driver supplied
 * over its own clock; `removeLease` clears every lease of one kind. Replaying
 * exactly that is what makes AC4's "survivor keeps since=2000" a statement about
 * the manager's view, not just about the driver's internal map.
 */
function createRecordingSink(clock: () => number): RecordingSink {
  const events: LeaseEvent[] = [];
  const removedHandles: string[] = [];
  const views = new Map<string, HostLease[]>();

  function view(appSessionId: string): HostLease[] {
    return views.get(appSessionId) ?? [];
  }

  const sink: IProviderHostDriverSink = {
    leaseAdded(appSessionId, lease) {
      events.push({ type: 'added', appSessionId, lease });
      const key = leaseKey(lease);
      const previous = view(appSessionId).find((existing) => leaseKey(existing) === key);
      const timed = lease.kind === 'background-task' || lease.kind === 'monitor';
      const carried =
        !timed
          ? undefined
          : typeof lease.since === 'number'
            ? lease.since
            : previous && (previous.kind === 'background-task' || previous.kind === 'monitor')
              ? previous.since
              : clock();
      const stored: HostLease = timed ? { ...lease, since: carried } : lease;
      views.set(appSessionId, [
        ...view(appSessionId).filter((existing) => leaseKey(existing) !== key),
        stored,
      ]);
    },
    leaseRemoved(appSessionId, kind) {
      events.push({ type: 'removed', appSessionId, kind });
      for (const lease of view(appSessionId)) {
        if (lease.kind === kind && 'id' in lease) {
          removedHandles.push(lease.id);
        }
      }
      views.set(appSessionId, view(appSessionId).filter((lease) => lease.kind !== kind));
    },
    activity() {},
    identity() {},
    exited() {},
  };

  return {
    sink,
    events,
    removedHandles,
    managerView(appSessionId) {
      return [...view(appSessionId)].sort((left, right) =>
        leaseKey(left) < leaseKey(right) ? -1 : leaseKey(left) > leaseKey(right) ? 1 : 0,
      );
    },
    addedCount(appSessionId) {
      return events.filter(
        (event) => event.type === 'added' && (appSessionId === undefined || event.appSessionId === appSessionId),
      ).length;
    },
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

type Harness = {
  driver: CodexHostDriver;
  transport: FakeAppServerTransport;
  sink: IProviderHostDriverSink;
  events: LeaseEvent[];
  removedHandles: string[];
  managerView(appSessionId: string): HostLease[];
  addedCount(appSessionId?: string): number;
};

function createHarness(clock: () => number = () => 1000): Harness {
  const transport = new FakeAppServerTransport();
  const driver = new CodexHostDriver({
    now: clock,
    createConnection: (launch) => new CodexAppServerConnection({
      launch,
      createTransport: () => transport,
    }),
  });
  const recording = createRecordingSink(clock);
  return { driver, transport, ...recording };
}

async function startResident(
  driver: CodexHostDriver,
  host: ProcessHost,
  sink: IProviderHostDriverSink,
  appSessionId = 'session-1',
): Promise<void> {
  await driver.startHost(host, sink);
  await driver.bind(host, createBinding(appSessionId));
}

/** `[bg-1 since=1000, bg-2 since=2000]`, the shape the criterion prints. */
function formatLeases(leases: readonly { processHandle: string; since: number }[]): string {
  return `[${leases.map((lease) => `${lease.processHandle} since=${lease.since}`).join(', ')}]`;
}

/** The same shape for the manager's `background-task` entries. */
function formatManagerView(leases: readonly HostLease[]): string {
  const parts = leases.map((lease) => {
    if (lease.kind === 'background-task' || lease.kind === 'monitor') {
      return `${lease.id} since=${String(lease.since)}`;
    }
    if (lease.kind === 'turn') {
      return `turn:${lease.runId}`;
    }
    if (lease.kind === 'cron') {
      return `cron:${lease.id}`;
    }
    return 'resident-policy';
  });
  return `[${parts.join(', ')}]`;
}

/** One reading of "which handles does this session hold". */
function assertLeaseHeld(handles: readonly string[], processHandle: string): void {
  assert.ok(
    handles.includes(processHandle),
    `expected handle=${processHandle} to be held, reading=[${handles.join(',')}]`,
  );
}

function isRejected(handles: readonly string[], processHandle: string): boolean {
  try {
    assertLeaseHeld(handles, processHandle);
    return false;
  } catch {
    return true;
  }
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

/** The false reading AC8 rules out: treat the agent-owned list rows as the ledger. */
function listBasedHandles(rows: readonly unknown[]): string[] {
  const handles: string[] = [];
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) {
      continue;
    }
    const handle = typeof record.processHandle === 'string'
      ? record.processHandle
      : typeof record.id === 'string'
        ? record.id
        : null;
    if (handle) {
      handles.push(handle);
    }
  }
  return handles.sort();
}

/**
 * A reference reading that calls `thread/backgroundTerminals/list` its ledger.
 *
 * Client processes never appear in it (E5), so a `process/exited` frame leaves
 * the reading unchanged — this is the shape the criterion must reject.
 */
function createListBasedReference(rows: readonly unknown[] = []): {
  feedProcessExited(processHandle: string): void;
  handles(): string[];
} {
  return {
    feedProcessExited(processHandle) {
      void processHandle;
    },
    handles() {
      return listBasedHandles(rows);
    },
  };
}

test('process/spawn records one lease with the caller handle and the injected since (AC2)', async () => {
  const { driver, transport, sink, events, managerView } = createHarness(() => 1000);
  const host = createHost();
  try {
    await startResident(driver, host, sink);
    const spec = {
      processHandle: 'bg-1',
      command: ['bash', '-lc', 'sleep 6; echo BG_DONE'],
      cwd: '/fake/workspace',
      streamStdoutStderr: true,
    };
    const lease = await driver.spawnBackgroundProcess('session-1', spec);
    const spawn = transport.calls.find((call) => call.method === 'process/spawn');
    const ledger = driver.readBackgroundLeases('session-1');
    const added = events.filter((event) => event.type === 'added');
    console.log(
      `handle=${lease.processHandle} spawnParams=${JSON.stringify(spawn?.params)} ledger=${formatLeases(ledger)} leaseAdded=${added.length} payload=${JSON.stringify(added.map((event) => (event as { lease: HostLease }).lease))}`,
    );

    assert.equal(spawn?.params.processHandle, 'bg-1');
    assert.deepEqual(spawn?.params.command, spec.command);
    // Only what the caller supplied: no streamStdin/outputBytesCap/timeoutMs keys.
    assert.deepEqual(spawn?.params, {
      processHandle: 'bg-1',
      command: spec.command,
      cwd: '/fake/workspace',
      streamStdoutStderr: true,
    });
    assert.deepEqual(ledger, [{ processHandle: 'bg-1', since: 1000 }]);
    assert.equal(added.length, 1, 'one successful spawn must report exactly one leaseAdded');
    assert.deepEqual((added[0] as { lease: HostLease }).lease, {
      kind: 'background-task',
      id: 'bg-1',
      since: 1000,
    });
    assert.deepEqual(managerView('session-1'), [{ kind: 'background-task', id: 'bg-1', since: 1000 }]);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('a rejected process/spawn leaves no lease and reports nothing (AC3)', async () => {
  const { driver, transport, sink, addedCount } = createHarness();
  const host = createHost();
  try {
    await startResident(driver, host, sink);
    transport.spawnError = 'spawn refused: command not allowed';
    let spawnError = '';
    try {
      await driver.spawnBackgroundProcess('session-1', {
        processHandle: 'bg-1',
        command: ['bash', '-lc', 'exit 1'],
      });
    } catch (error) {
      spawnError = error instanceof Error ? error.message : String(error);
    }
    const ledger = driver.readBackgroundLeases('session-1');
    console.log(`spawnError=${spawnError} ledger=${formatLeases(ledger)} leaseAdded=${addedCount('session-1')}`);

    assert.match(spawnError, /spawn refused/, 'a rejected spawn must reject the caller');
    assert.deepEqual(ledger, [], 'a rejected spawn must not leave a ghost lease');
    assert.equal(addedCount('session-1'), 0, 'a rejected spawn must not report a lease');
    assert.equal(transport.callCount('process/spawn'), 1);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('process/exited releases only its own handle and re-adds the survivor with its original since (AC4)', async () => {
  let tick = 1000;
  const { driver, transport, sink, managerView } = createHarness(() => tick);
  const host = createHost();
  try {
    await startResident(driver, host, sink);
    await driver.spawnBackgroundProcess('session-1', { processHandle: 'bg-1', command: ['bash', '-lc', 'sleep 30'] });
    tick = 2000;
    await driver.spawnBackgroundProcess('session-1', { processHandle: 'bg-2', command: ['bash', '-lc', 'sleep 60'] });

    // A later clock reading must never restamp the survivor: the re-add carries
    // the ledger's own `since`, not `now()`.
    tick = 9999;
    transport.emitProcessExited('bg-1', 0);

    const ledger = driver.readBackgroundLeases('session-1');
    const view = managerView('session-1');
    console.log(`ledger=${formatLeases(ledger)} managerView=${formatManagerView(view)}`);

    assert.deepEqual(ledger, [{ processHandle: 'bg-2', since: 2000 }]);
    assert.deepEqual(view, [{ kind: 'background-task', id: 'bg-2', since: 2000 }]);
    assert.ok(
      ledger.every((lease) => lease.processHandle !== 'bg-1') && view.every((lease) => lease.kind !== 'background-task' || lease.id !== 'bg-1'),
      'the exited handle must be gone from both readings',
    );
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('the agent-owned terminal list is never read as the client ledger (AC5)', async () => {
  const { driver, transport, sink } = createHarness();
  const host = createHost();
  try {
    await startResident(driver, host, sink);
    transport.backgroundTerminals = [];
    await driver.spawnBackgroundProcess('session-1', { processHandle: 'bg-1', command: ['bash', '-lc', 'sleep 30'] });
    // Streamed output belongs to AC-440's frame normalization; it must not move the ledger.
    transport.emitOutputDelta('bg-1', 'still running\n');
    const ledger = driver.readBackgroundLeases('session-1');
    const listCalls = transport.callCount(PROCESS_LIST);
    console.log(`listCalls=${listCalls} listData=${JSON.stringify(transport.backgroundTerminals)} ledger=${formatLeases(ledger)}`);

    assert.equal(listCalls, 0, 'the driver must not query thread/backgroundTerminals/list');
    assert.deepEqual(ledger, [{ processHandle: 'bg-1', since: 1000 }]);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('process/kill does not release the lease; process/exited does (AC6)', async () => {
  const { driver, transport, sink, managerView } = createHarness();
  const host = createHost();
  try {
    await startResident(driver, host, sink);
    await driver.spawnBackgroundProcess('session-1', { processHandle: 'bg-1', command: ['bash', '-lc', 'sleep 30'] });

    await driver.killBackgroundProcess('session-1', 'bg-1');
    const afterKill = driver.readBackgroundLeases('session-1');
    console.log(`afterKill=${formatLeases(afterKill)}`);
    assert.deepEqual(afterKill, [{ processHandle: 'bg-1', since: 1000 }], 'a kill reply is not a process exit');
    assert.deepEqual(managerView('session-1'), [{ kind: 'background-task', id: 'bg-1', since: 1000 }]);

    transport.emitProcessExited('bg-1', 137);
    const afterExited = driver.readBackgroundLeases('session-1');
    console.log(`afterExited=${formatLeases(afterExited)}`);
    assert.deepEqual(afterExited, []);
    assert.deepEqual(managerView('session-1'), []);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('a process that exits on its own releases every handle exactly once and adds nothing after (AC7)', async () => {
  const { driver, transport, sink, managerView, addedCount, events, removedHandles } = createHarness();
  const host = createHost();
  try {
    await startResident(driver, host, sink);
    await driver.spawnBackgroundProcess('session-1', { processHandle: 'bg-1', command: ['bash', '-lc', 'sleep 30'] });
    await driver.spawnBackgroundProcess('session-1', { processHandle: 'bg-2', command: ['bash', '-lc', 'sleep 60'] });
    const released = driver.readBackgroundLeases('session-1').map((lease) => lease.processHandle);
    const addedBeforeExit = addedCount('session-1');

    transport.die('signal');

    const ledgerAfterExit = driver.readBackgroundLeases('session-1');
    const leaseAddedAfterExit = addedCount('session-1') - addedBeforeExit;
    console.log(
      `released=[${released.join(',')}] ledgerAfterExit=${formatLeases(ledgerAfterExit)} leaseAddedAfterExit=${leaseAddedAfterExit}`,
    );

    assert.deepEqual(released, ['bg-1', 'bg-2']);
    assert.deepEqual(ledgerAfterExit, [], 'a dead process must leave no handle behind');
    assert.deepEqual(managerView('session-1'), []);
    assert.deepEqual([...removedHandles].sort(), ['bg-1', 'bg-2'], 'each handle must be released exactly once');
    assert.equal(leaseAddedAfterExit, 0, 'no lease may be re-added after the process is gone');
    assert.equal(
      events.filter((event) => event.type === 'removed' && event.appSessionId === 'session-1').length,
      1,
      'all of one session\'s holds are removed in a single kind-level report',
    );
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('the same lease assertion rejects a list-based reading (AC8)', async () => {
  const { driver, transport, sink } = createHarness();
  const host = createHost();
  try {
    await startResident(driver, host, sink);
    transport.backgroundTerminals = [];
    await driver.spawnBackgroundProcess('session-1', { processHandle: 'bg-1', command: ['bash', '-lc', 'sleep 30'] });

    const handleBased = driver.readBackgroundLeases('session-1').map((lease) => lease.processHandle);
    const emptyListReference = createListBasedReference(transport.backgroundTerminals);
    emptyListReference.feedProcessExited('bg-1');
    const listBased = emptyListReference.handles();
    const rejected = isRejected(listBased, 'bg-1');

    // A non-empty list must still not answer for a client process: the row that
    // lives there is agent-owned, with its own id.
    const agentOwnedReference = createListBasedReference([
      { id: 'agent-terminal-1', title: 'sleep 30' },
    ]);
    const agentOwned = agentOwnedReference.handles();
    const agentRowRejected = isRejected(agentOwned, 'bg-1');

    console.log(
      `listBased=${listBased.length} handleBased=${handleBased.length} rejected=${rejected} agentOwned=${agentOwned.join(',')} agentRowRejected=${agentRowRejected}`,
    );

    assert.equal(listBased.length, 0, 'the list holds no client process');
    assert.equal(handleBased.length, 1, 'the handle ledger holds the spawned process');
    assertLeaseHeld(handleBased, 'bg-1');
    assert.equal(rejected, true, 'assertLeaseHeld must reject a list-based reading');
    assert.equal(agentRowRejected, true, 'an agent-owned row must not satisfy a client handle assertion');
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('the driver conforms to IProviderHostDriver and the ledger keeps state inside its factory (AC12)', () => {
  const { driver } = createHarness();
  const conformance: IProviderHostDriver = driver;
  console.log(`multiplexedHost=${String(conformance.multiplexedHost)}`);
  assert.equal(conformance.multiplexedHost, false);
  for (const verb of ['startHost', 'bind', 'submit', 'interrupt', 'reconfigure', 'unbind', 'closeHost'] as const) {
    assert.equal(typeof conformance[verb], 'function', `${verb} must be implemented`);
  }
  assert.equal(typeof driver.spawnBackgroundProcess, 'function');
  assert.equal(typeof driver.readBackgroundLeases, 'function');

  const source = readFileSync(
    new URL('../list/codex/codex-background-lease-ledger.ts', import.meta.url),
    'utf8',
  );
  const moduleState = source.split('\n').filter((line) =>
    /^(?:let|var)\s/.test(line)
    || /^const\s+[A-Za-z_$][\w$]*\s*=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\b/.test(line));
  console.log(`moduleMutableState=${moduleState.length}`);
  assert.deepEqual(moduleState, [], `ledger must own its state in the factory closure: ${moduleState.join(' | ')}`);
});
