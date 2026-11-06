import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodexAppServerConnection,
  type CodexAppServerTransport,
} from '@/modules/providers/list/codex/app-server/codex-app-server.connection.js';
import {
  CodexHostDriver,
  type CodexSettingsCapabilities,
} from '@/modules/providers/list/codex/host/codex-host-driver.provider.js';
import type { IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type { HostReconfigurePatch, ProcessHost, SessionBinding } from '@/shared/types.js';
import type { HostReconfigureOutcome } from '@/modules/providers/services/provider-runtime.service.js';

/**
 * The criterion for AC-437: a resident Codex driver changes model/effort/
 * permission live with `thread/settings/update` — for an idle thread and for a
 * turn already in flight — and refuses `turn/settings/update` unless the
 * `step_model_switching` feature is enabled, fail-closed on every other reading.
 *
 * The transport is an in-memory JSON-RPC server stub with a fixed fake pid: no
 * Codex process is started, no DB and no network is touched. `thread/settings/
 * update` is answered with `{}` and never emits the confirmation by itself; the
 * tests release every `thread/settings/updated` explicitly, so a driver that
 * treats the RPC result as confirmation has nothing to resolve on.
 */

type Call = { method: string; params: Record<string, unknown> };
type SettingsNotification = { threadId: string; threadSettings: Record<string, unknown> };

class FakeAppServerTransport implements CodexAppServerTransport {
  readonly pid = 730_437;
  readonly calls: Call[] = [];
  /** Every `thread/settings/updated` the test released, in order. */
  readonly settingsNotifications: SettingsNotification[] = [];
  /** How `experimentalFeature/list` answers. */
  probeResult: unknown = { data: [], nextCursor: null };
  /** When set, `experimentalFeature/list` fails with this JSON-RPC message. */
  probeError: string | null = null;
  /** When set, `thread/settings/update` fails with this JSON-RPC message. */
  settingsUpdateError: string | null = null;
  /** Whether `turn/start` completes its turn by itself. */
  autoComplete = true;

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
      case 'thread/start':
        this.reply(message.id, { thread: { id: `thread-${++this.threadSerial}` } });
        return;
      case 'thread/resume':
        this.reply(message.id, { thread: { id: params.threadId } });
        return;
      case 'turn/start': {
        const threadId = String(params.threadId ?? '');
        const turnId = `turn-${++this.turnSerial}`;
        this.reply(message.id, { turn: { id: turnId, status: 'inProgress' } });
        this.emit('turn/started', { threadId, turn: { id: turnId, status: 'inProgress' } });
        if (this.autoComplete) {
          this.emit('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
        }
        return;
      }
      case 'turn/interrupt': {
        this.reply(message.id, {});
        this.emit('turn/completed', {
          threadId: params.threadId,
          turn: { id: params.turnId, status: 'interrupted' },
        });
        return;
      }
      case 'thread/settings/update': {
        if (this.settingsUpdateError) {
          this.fail(message.id, this.settingsUpdateError);
          return;
        }
        // `{}` and nothing else: the notification is the only confirmation.
        this.reply(message.id, {});
        return;
      }
      case 'turn/settings/update':
        this.reply(message.id, {});
        return;
      case 'experimentalFeature/list':
        if (this.probeError) {
          this.fail(message.id, this.probeError);
          return;
        }
        this.reply(message.id, this.probeResult);
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

  terminate(): void {
    this.alive = false;
  }

  /** Test-only: release one `thread/settings/updated` frame. */
  emitSettingsUpdated(threadId: string, threadSettings: Record<string, unknown>): void {
    this.settingsNotifications.push({ threadId, threadSettings });
    this.emit('thread/settings/updated', { threadId, threadSettings });
  }

  count(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  last(method: string): Call | undefined {
    return [...this.calls].reverse().find((call) => call.method === method);
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
    hostId: 'codex-host-settings',
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
    // Short ceilings: a criterion that never receives its frame must fail in a
    // heartbeat, not wait for production timeouts. The notification window is
    // wide enough that a loaded host cannot expire it between two `setImmediate`
    // turns of the stale-frame leg.
    settingsNotificationTimeoutMs: 1_000,
    capabilityProbeTimeoutMs: 200,
  });
  return { driver, transport };
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await tick();
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Whether one released notification carries every field the request named. */
function notificationMatches(
  notification: SettingsNotification,
  expected: Record<string, unknown>,
): boolean {
  const updated = notification.threadSettings;
  if (notification.threadId !== expected.threadId) {
    return false;
  }
  for (const key of ['model', 'effort', 'approvalPolicy'] as const) {
    if (key in expected && updated[key] !== expected[key]) {
      return false;
    }
  }
  const sandbox = expected.sandboxPolicy;
  if (isRecord(sandbox)) {
    const updatedSandbox = updated.sandboxPolicy;
    if (!isRecord(updatedSandbox) || updatedSandbox.type !== sandbox.type) {
      return false;
    }
    if ('networkAccess' in sandbox && updatedSandbox.networkAccess !== sandbox.networkAccess) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One "live settings" reading; shared by the positive and reverse-control legs. */
type LiveSettingsReading = {
  verdict: 'live' | 'next-turn';
  notifications: number;
  pidBefore: number | null;
  pidAfter: number | null;
};

/** Throws unless the change was confirmed live by exactly one notification, pid steady. */
function assertLiveSettings(reading: LiveSettingsReading): void {
  assert.equal(reading.verdict, 'live', `verdict=${reading.verdict} expected=live`);
  assert.equal(reading.notifications, 1, `notifications=${reading.notifications} expected=1`);
  assert.equal(
    reading.pidAfter,
    reading.pidBefore,
    `pid changed across live settings: beforePid=${reading.pidBefore} afterPid=${reading.pidAfter}`,
  );
}

/** One "turn settings are refused" reading; shared by AC5, AC6 and AC7. */
type TurnCapabilityReading = {
  threadSettings: boolean;
  turnSettings: boolean;
  turnVerdict: HostReconfigureOutcome;
  turnRpcCalls: number;
  probeCalls: number;
};

/** Throws unless the turn-level verb was refused without a single frame. */
function assertTurnUnsupported(reading: TurnCapabilityReading): void {
  assert.equal(reading.threadSettings, true, `threadSettings=${reading.threadSettings} expected=true`);
  assert.equal(reading.turnSettings, false, `turnSettings=${reading.turnSettings} expected=false`);
  assert.equal(reading.turnVerdict, 'unsupported', `turnVerdict=${reading.turnVerdict} expected=unsupported`);
  assert.equal(reading.turnRpcCalls, 0, `turnRpcCalls=${reading.turnRpcCalls} expected=0`);
  assert.equal(reading.probeCalls, 1, `probeCalls=${reading.probeCalls} expected=1`);
}

test('idle live settings apply on the notification, not the RPC result (AC2/AC4)', async () => {
  const { driver, transport } = createDriver();
  const host = createHost();
  const threadId = 'thread-idle';
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-idle', threadId));
    const pidBefore = host.pid;

    const patch: HostReconfigurePatch = {
      model: 'gpt-5.6-terra',
      effort: 'medium',
      permissionMode: 'default',
    };
    const pending = driver.reconfigure(host, 'session-idle', patch);
    let settled = false;
    const verdictPromise = pending.then((verdict) => {
      settled = true;
      return verdict;
    });

    await waitFor(() => transport.count('thread/settings/update') === 1, 'thread/settings/update');
    const request = transport.last('thread/settings/update');
    assert.ok(request, 'the settings request must be written');
    await tick();

    // The RPC answered `{}`; a driver that reads that as confirmation has
    // already settled here, which is the leg this print makes visible.
    const settledBeforeMatch = settled;
    // A stale frame (e.g. the effort `turn/start` reported) must not resolve it.
    transport.emitSettingsUpdated(threadId, {
      model: 'gpt-5.6-terra',
      effort: 'low',
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
    });
    await tick();
    await tick();
    const staleIgnored = settled === false;
    console.log(`settledBeforeMatch=${settledBeforeMatch}`);

    transport.emitSettingsUpdated(threadId, {
      model: 'gpt-5.6-terra',
      effort: 'medium',
      approvalPolicy: 'on-request',
      sandboxPolicy: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
    });
    const verdict = await verdictPromise;
    const matching = transport.settingsNotifications.filter((notification) =>
      notificationMatches(notification, request.params)).length;

    const sandbox = isRecord(request.params.sandboxPolicy) ? request.params.sandboxPolicy : {};
    console.log(
      `idleVerdict=${verdict} idleModel=${String(request.params.model)} idleEffort=${String(request.params.effort)} `
      + `idleApprovalPolicy=${String(request.params.approvalPolicy)} idleSandboxType=${String(sandbox.type)} `
      + `idleNotifications=${matching} idlePidBefore=${pidBefore} idlePidAfter=${host.pid}`,
    );
    console.log(`matchedNotification=${matching} staleIgnored=${staleIgnored}`);

    assert.equal(settledBeforeMatch, false, 'the RPC result must not settle reconfigure');
    assert.equal(staleIgnored, true, 'a stale thread/settings/updated must not resolve the waiter');
    assert.equal(host.pid, pidBefore, 'applying a setting must not restart the process');

    // The request carries the thread plus all four requested settings.
    assert.equal(request.params.threadId, threadId);
    assert.equal(request.params.model, 'gpt-5.6-terra');
    assert.equal(request.params.effort, 'medium');
    assert.equal(request.params.approvalPolicy, 'on-request');
    assert.equal(sandbox.type, 'workspaceWrite');
    assert.equal(sandbox.networkAccess, false);
    assertLiveSettings({ verdict, notifications: matching, pidBefore, pidAfter: host.pid });
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('active-turn live settings keep the turn and the process (AC3)', async () => {
  const { driver, transport } = createDriver();
  const host = createHost();
  transport.autoComplete = false;
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-active', null));
    const turnPromise = driver.submit(host, 'session-active', { command: 'a long turn', options: {} });
    await waitFor(() => driver.readSession('session-active').turnStatus === 'inProgress', 'turn in flight');

    const threadId = String(driver.readSession('session-active').threadId);
    const activeTurnIdBefore = driver.readSession('session-active').activeTurnId;
    const pidBefore = host.pid;

    const pending = driver.reconfigure(host, 'session-active', {
      model: 'gpt-5.6-sol',
      effort: 'high',
      permissionMode: 'acceptEdits',
    });
    await waitFor(() => transport.count('thread/settings/update') === 1, 'active thread/settings/update');
    const request = transport.last('thread/settings/update');
    assert.ok(request, 'the active settings request must be written');

    transport.emitSettingsUpdated(threadId, {
      model: 'gpt-5.6-sol',
      effort: 'high',
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'workspaceWrite', networkAccess: false, writableRoots: [] },
    });
    const verdict = await pending;
    const activeTurnIdAfter = driver.readSession('session-active').activeTurnId;
    const sandbox = isRecord(request.params.sandboxPolicy) ? request.params.sandboxPolicy : {};

    console.log(
      `activeVerdict=${verdict} activeApprovalPolicy=${String(request.params.approvalPolicy)} `
      + `activeSandboxType=${String(sandbox.type)} activeTurnIdBefore=${activeTurnIdBefore} `
      + `activeTurnIdAfter=${activeTurnIdAfter} activePidBefore=${pidBefore} activePidAfter=${host.pid}`,
    );
    assertLiveSettings({ verdict, notifications: 1, pidBefore, pidAfter: host.pid });
    assert.equal(request.params.approvalPolicy, 'never');
    assert.equal(sandbox.type, 'workspaceWrite');
    assert.equal(activeTurnIdAfter, activeTurnIdBefore, 'the in-flight turn id must not change');
    // An active patch must still use the thread-level verb — `turn/settings/update`
    // needs the experimental feature and is not the live path here.
    assert.equal(transport.count('turn/settings/update'), 0, 'active settings must use thread/settings/update');

    assert.equal(await driver.interrupt(host, 'session-active'), true);
    await turnPromise;
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('turn settings are refused and the capability probe is cached (AC5)', async () => {
  const { driver, transport } = createDriver();
  const host = createHost();
  transport.probeResult = {
    data: [{ name: 'step_model_switching', stage: 'underDevelopment', enabled: false }],
    nextCursor: null,
  };
  try {
    await driver.startHost(host, createSink());
    await driver.bind(host, createBinding('session-cap', 'thread-cap'));

    const caps: CodexSettingsCapabilities = await driver.settingsCapabilities(host, 'session-cap');
    const turnVerdict = await driver.reconfigureTurn(host, 'session-cap', {
      model: 'gpt-5.6-sol',
      effort: 'high',
    });
    const capsAgain = await driver.settingsCapabilities(host, 'session-cap');
    const turnVerdictAgain = await driver.reconfigureTurn(host, 'session-cap', { effort: 'high' });
    const reading: TurnCapabilityReading = {
      threadSettings: caps.threadSettings,
      turnSettings: caps.turnSettings,
      turnVerdict,
      turnRpcCalls: transport.count('turn/settings/update'),
      probeCalls: transport.count('experimentalFeature/list'),
    };
    void turnVerdictAgain;

    console.log(
      `caps={threadSettings:${caps.threadSettings},turnSettings:${caps.turnSettings}} `
      + `turnVerdict=${turnVerdict} turnRpcCalls=${reading.turnRpcCalls} probeCalls=${reading.probeCalls}`,
    );
    assert.deepEqual(caps, { threadSettings: true, turnSettings: false });
    assert.deepEqual(capsAgain, caps);
    assertTurnUnsupported(reading);
  } finally {
    await driver.closeHost(host, 'user');
  }
});

test('the turn-settings probe is fail-closed on every other reading (AC6)', async () => {
  const arms: Array<{ name: string; configure: (transport: FakeAppServerTransport) => void }> = [
    {
      name: 'probe-error',
      configure: (transport) => {
        transport.probeError = 'unknown method experimentalFeature/list';
      },
    },
    {
      name: 'missing-entry',
      configure: (transport) => {
        transport.probeResult = { data: [{ name: 'other_feature', enabled: true }], nextCursor: null };
      },
    },
    {
      name: 'enabled-not-true',
      configure: (transport) => {
        transport.probeResult = { data: [{ name: 'step_model_switching', enabled: 'true' }], nextCursor: null };
      },
    },
  ];

  for (const arm of arms) {
    const { driver, transport } = createDriver();
    const host = createHost();
    arm.configure(transport);
    try {
      await driver.startHost(host, createSink());
      await driver.bind(host, createBinding(`session-${arm.name}`, `thread-${arm.name}`));
      const caps = await driver.settingsCapabilities(host, `session-${arm.name}`);
      const turnVerdict = await driver.reconfigureTurn(host, `session-${arm.name}`, { model: 'gpt-5.6-sol' });
      const reading: TurnCapabilityReading = {
        threadSettings: caps.threadSettings,
        turnSettings: caps.turnSettings,
        turnVerdict,
        turnRpcCalls: transport.count('turn/settings/update'),
        probeCalls: transport.count('experimentalFeature/list'),
      };
      console.log(
        `arm=${arm.name} turnSettings=${caps.turnSettings} turnVerdict=${turnVerdict} `
        + `turnRpcCalls=${reading.turnRpcCalls}`,
      );
      assertTurnUnsupported(reading);
    } finally {
      await driver.closeHost(host, 'user');
    }
  }
});

test('reverse controls reject a false capability claim and a deferred live change (AC7)', () => {
  const falseCapabilityRejected = (() => {
    try {
      // A driver that claims turn settings work is what AC-437 must red on.
      assertTurnUnsupported({
        threadSettings: true,
        turnSettings: true,
        turnVerdict: 'live',
        turnRpcCalls: 1,
        probeCalls: 1,
      });
      return false;
    } catch {
      return true;
    }
  })();
  const deferredLiveRejected = (() => {
    try {
      assertLiveSettings({ verdict: 'next-turn', notifications: 0, pidBefore: 1, pidAfter: 1 });
      return false;
    } catch {
      return true;
    }
  })();

  console.log(
    `negativeControlThrew=${falseCapabilityRejected && deferredLiveRejected} `
    + `falseCapabilityRejected=${falseCapabilityRejected} deferredLiveRejected=${deferredLiveRejected}`,
  );
  assert.equal(falseCapabilityRejected, true, 'the turn-settings assertion accepted a live claim');
  assert.equal(deferredLiveRejected, true, 'the live-settings assertion accepted a deferred change');
});

test('driver conforms to IProviderHostDriver with multiplexedHost=false (AC10)', () => {
  const { driver } = createDriver();
  const conformance: IProviderHostDriver = driver;
  console.log(`multiplexedHost=${conformance.multiplexedHost}`);
  assert.equal(conformance.multiplexedHost, false);
  for (const verb of ['startHost', 'bind', 'submit', 'interrupt', 'reconfigure', 'unbind', 'closeHost'] as const) {
    assert.equal(typeof conformance[verb], 'function', `${verb} must be implemented`);
  }
  assert.equal(typeof driver.settingsCapabilities, 'function', 'the capability probe must be present');
  assert.equal(typeof driver.reconfigureTurn, 'function', 'the turn-level verb must be present');
});
