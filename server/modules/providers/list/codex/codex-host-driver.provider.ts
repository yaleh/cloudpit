import { CodexAppServerConnection } from '@/modules/providers/list/codex/codex-app-server.connection.js';
import type { CodexAppServerLaunch } from '@/modules/providers/list/codex/codex-app-server.connection.js';
import {
  createCodexBackgroundLeaseLedger,
  type CodexBackgroundLease,
  type CodexBackgroundLeaseLedger,
} from '@/modules/providers/list/codex/codex-background-lease-ledger.js';
import {
  backgroundSpawnParams,
  normalizeTurnStatus,
  readThreadId,
  readTurnId,
  threadDefaultsFromLaunchOptions,
  threadParams,
  turnParams,
  type CodexBackgroundProcessSpec,
  type CodexHostDriverOptions,
  type CodexResidentHostPort,
  type CodexResidentSessionReading,
  type CodexThreadDefaults,
  type CodexTurnStatus,
  type PendingResidentLaunch,
  type PendingTurn,
  type ResidentSession,
} from '@/modules/providers/list/codex/codex-host-driver.contract.js';
import {
  createCodexLiveSettings,
  type CodexLiveSettings,
  type CodexSettingsCapabilities,
  type CodexTurnSettingsPatch,
  type HostReconfigureOutcome,
} from '@/modules/providers/list/codex/codex-live-settings.js';
import type { IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  HostCloseReason,
  HostReconfigurePatch,
  HostResidentLaunch,
  HostResidentStartResult,
  HostTurnInput,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';
import { AppError, errorMessage, isRecord } from '@/shared/utils.js';

/** How long `reconfigure` waits for its `thread/settings/updated` before deferring. */
const DEFAULT_SETTINGS_NOTIFICATION_TIMEOUT_MS = 5_000;

/** Ceiling for the one-shot `experimentalFeature/list` capability probe. */
const DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS = 5_000;

/**
 * Codex's resident host driver: one long-lived `codex app-server` process per
 * app session, with thread identity, pid and an in-flight turn surviving across
 * turns.
 *
 * This file lands the primitives AC-435 and AC-441 cover — persistent thread,
 * resume after the first turn, zero-turn fallback, interrupt-without-killing,
 * the `turn` lease the session-host layer derives `busy` from, the close/unbind
 * reasons it relays, the on-demand `startResidentSession` verb, and the cold
 * start that shares that verb's launch path. Mounting on `CodexProvider` is
 * AC-441; declaring `resident` in the capability registry is AC-442. Queue,
 * live settings, approvals, background leases and restore passes belong to
 * AC-436…AC-443 beyond what the driver-side verbs here expose.
 *
 * Consumed by the criterion in `tests/codex-host-driver-persistent.test.ts`,
 * which injects an in-memory transport through `createConnection`.
 */

export type {
  CodexBackgroundProcessSpec,
  CodexHostDriverOptions,
  CodexResidentHostPort,
  CodexResidentSessionReading,
  CodexThreadDefaults,
  CodexTurnStatus,
} from '@/modules/providers/list/codex/codex-host-driver.contract.js';
/** Re-exported so callers of the driver never reach into the helper module. */
export type { CodexSettingsCapabilities, CodexTurnSettingsPatch };

/**
 * Owns the process lifetime and per-session thread state of Codex resident mode.
 *
 * One connection per driver instance and `multiplexedHost = false`: the manager
 * may not place a second conversation on this process, which is the ruling that
 * one app session owns one app-server.
 */
export class CodexHostDriver implements IProviderHostDriver {
  readonly multiplexedHost = false;

  private readonly createConnection: (launch: CodexAppServerLaunch) => CodexAppServerConnection;
  private readonly launch: CodexAppServerLaunch;
  private readonly threadDefaults: CodexThreadDefaults;
  private readonly hostPort: CodexResidentHostPort | null;
  private readonly sessions = new Map<string, ResidentSession>();
  /** Launches carried from `startResidentSession` to the `bind` it causes. */
  private readonly pendingLaunches = new Map<string, PendingResidentLaunch>();
  /** `processHandle` holds, one map per app session (state owned by this driver). */
  private readonly backgroundLeases: CodexBackgroundLeaseLedger;
  /** Serial for a caller that leaves `processHandle` out; never reused by this instance. */
  private backgroundHandleSerial = 0;
  /** Serial for the `turn` lease's `runId`; unique per turn of this instance. */
  private turnSerial = 0;
  /** The last reason the manager relayed to `closeHost`, publicly read-only. */
  private lastCloseReasonValue: HostCloseReason | null = null;
  /** The last reason the manager relayed to `unbind`, publicly read-only. */
  private lastUnbindReasonValue: HostCloseReason | null = null;
  private readonly settingsNotificationTimeoutMs: number;
  private readonly capabilityProbeTimeoutMs: number;
  /** The live-setting verbs; the waiters and the probe cache live in the helper. */
  private readonly liveSettings: CodexLiveSettings;
  private connection: CodexAppServerConnection | null = null;
  private host: ProcessHost | null = null;
  private sink: IProviderHostDriverSink | null = null;
  private closed = false;

  constructor(options: CodexHostDriverOptions = {}) {
    this.createConnection = options.createConnection
      ?? ((launch) => new CodexAppServerConnection({ launch }));
    this.launch = options.launch ?? {};
    this.threadDefaults = options.thread ?? {};
    this.hostPort = options.host ?? null;
    this.settingsNotificationTimeoutMs = options.settingsNotificationTimeoutMs
      ?? DEFAULT_SETTINGS_NOTIFICATION_TIMEOUT_MS;
    this.capabilityProbeTimeoutMs = options.capabilityProbeTimeoutMs ?? DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS;
    this.liveSettings = createCodexLiveSettings({
      notificationTimeoutMs: this.settingsNotificationTimeoutMs,
      capabilityProbeTimeoutMs: this.capabilityProbeTimeoutMs,
    });
    this.backgroundLeases = createCodexBackgroundLeaseLedger({ now: options.now });
  }

  /**
   * The reason the manager last told this driver to close the host.
   *
   * The reading AC-441's criterion uses to prove the reason relayed into the
   * driver is the reason the manager recorded. Null means no `closeHost` was
   * ever relayed, which is exactly the reading a process that went away on its
   * own must keep (the manager records `exited` without asking the driver to
   * kill anything).
   */
  get lastCloseReason(): HostCloseReason | null {
    return this.lastCloseReasonValue;
  }

  /** The reason the manager last relayed to `unbind`; null when none was relayed. */
  get lastUnbindReason(): HostCloseReason | null {
    return this.lastUnbindReasonValue;
  }

  /** Starts the process and reports its pid on the host record. */
  async startHost(host: ProcessHost, sink: IProviderHostDriverSink): Promise<ProcessHost> {
    // `closeHost` is terminal for one process, not for this instance: the
    // provider mounts one driver for the life of the server, so the next host
    // it is handed starts a fresh process (the connection was dropped on close).
    this.closed = false;
    this.host = host;
    this.sink = sink;
    const connection = this.requireConnection();
    await connection.initialize();
    host.pid = connection.pid;
    return host;
  }

  /** Remembers the session's native thread id, when the session already has one. */
  async bind(host: ProcessHost, binding: SessionBinding): Promise<void> {
    void host;
    // Consume the launch `startResidentSession` carried in. The manager always
    // creates a binding with `providerSessionId: null`, so the provider-native
    // id a restore must adopt can only come from the launch context; the
    // binding's own value (a caller that already knew it) still wins.
    const launch = this.pendingLaunches.get(binding.appSessionId);
    if (launch) {
      this.pendingLaunches.delete(binding.appSessionId);
    }
    if (this.sessions.has(binding.appSessionId)) {
      return;
    }
    this.sessions.set(binding.appSessionId, {
      appSessionId: binding.appSessionId,
      // A restored binding carries the provider-native id. A thread that never
      // ran a turn has no rollout yet, which is what makes resume fail and the
      // zero-turn fallback reachable.
      threadId: binding.providerSessionId ?? launch?.providerSessionId ?? null,
      activeTurnId: null,
      turnStatus: null,
      lastResumeError: null,
      pending: null,
      threadDefaults: launch?.threadDefaults ?? {},
      turnLeaseRunId: null,
    });
  }

  /** Delivers one turn and resolves only when that turn reaches a terminal state. */
  async submit(host: ProcessHost, appSessionId: string, turn: HostTurnInput): Promise<void> {
    void host;
    const connection = this.requireConnection();
    const session = this.requireSession(appSessionId);
    const threadId = await this.ensureThread(connection, session);
    const pending = this.beginTurn(session, threadId);
    // Reported before `turn/start` so the manager derives `busy` from the same
    // frame that starts the work: a lease added after the write could miss the
    // moment the turn is already running, and the quiet ceiling would stay armed
    // across it.
    this.addTurnLease(session);
    try {
      const started = await connection.request('turn/start', turnParams(threadId, turn));
      const turnId = readTurnId(started);
      if (turnId) {
        pending.turnId = pending.turnId ?? turnId;
        if (session.turnStatus === null || session.turnStatus === 'inProgress') {
          session.turnStatus = 'inProgress';
          session.activeTurnId = turnId;
        }
      }
      this.sink?.activity(appSessionId);
      await pending.promise;
    } catch (error) {
      // A rejected `turn/start` never became a turn, so its lease must not
      // outlive the request: release it here, before rethrowing, or the host
      // would stay `busy` with nothing running.
      this.removeTurnLease(session);
      if (session.pending === pending) {
        session.pending = null;
      }
      throw error;
    }
  }

  /**
   * Stops the turn in flight with `turn/interrupt`.
   *
   * The turn is stopped at the protocol level: the process, its thread and its
   * pid are untouched, which is the whole difference from `closeHost`. Returns
   * false when no turn is in flight or its id is not known yet.
   */
  async interrupt(host: ProcessHost, appSessionId: string): Promise<boolean> {
    void host;
    const session = this.sessions.get(appSessionId);
    if (!session || session.turnStatus !== 'inProgress' || !session.threadId || !session.activeTurnId) {
      return false;
    }
    const connection = this.requireConnection();
    const pending = session.pending;
    const { threadId, activeTurnId } = session;
    await connection.request('turn/interrupt', { threadId, turnId: activeTurnId });
    if (pending) {
      await pending.promise;
    }
    return true;
  }

  /**
   * Applies model/effort/permission to the live thread with
   * `thread/settings/update`, for both an idle and an active turn.
   *
   * Only the matching `thread/settings/updated` notification confirms the change
   * (the RPC result is `{}`); a timeout, RPC error or closed connection defers to
   * the next turn. The process, its thread id and its in-flight turn are never
   * touched. The matching and the bounded wait live in `codex-live-settings.ts`.
   */
  async reconfigure(
    host: ProcessHost,
    appSessionId: string,
    patch: HostReconfigurePatch,
  ): Promise<'live' | 'next-turn'> {
    if (host.mode !== 'resident') {
      return 'next-turn';
    }
    const connection = this.liveConnection();
    const session = this.sessions.get(appSessionId);
    if (!connection || !session?.threadId) {
      return 'next-turn';
    }
    return this.liveSettings.reconfigure(connection, session.threadId, patch);
  }

  /**
   * What this connection can change live. `threadSettings` is always available
   * on a live connection; `turnSettings` needs the `step_model_switching`
   * feature, read once per connection and cached even when the probe fails.
   */
  async settingsCapabilities(host: ProcessHost, appSessionId: string): Promise<CodexSettingsCapabilities> {
    void appSessionId;
    if (host.mode !== 'resident') {
      return { threadSettings: false, turnSettings: false };
    }
    const connection = this.liveConnection();
    if (!connection) {
      return { threadSettings: false, turnSettings: false };
    }
    return this.liveSettings.capabilities(connection);
  }

  /**
   * Applies a model/effort change to the turn in flight, but only when the
   * capability probe says the feature is on.
   *
   * `step_model_switching` is disabled in the locked 0.153.4 build, so the
   * refusal is a real branch rather than a missing method: nothing is sent and
   * the caller reads `unsupported`. The true branch exists so the same verb can
   * run once the feature is enabled.
   */
  async reconfigureTurn(
    host: ProcessHost,
    appSessionId: string,
    patch: CodexTurnSettingsPatch,
  ): Promise<HostReconfigureOutcome> {
    const capabilities = await this.settingsCapabilities(host, appSessionId);
    if (!capabilities.threadSettings || !capabilities.turnSettings) {
      return 'unsupported';
    }
    const connection = this.liveConnection();
    const session = this.sessions.get(appSessionId);
    if (!connection || !session?.threadId || !session.activeTurnId) {
      return 'next-turn';
    }
    return this.liveSettings.reconfigureTurn(connection, session.threadId, session.activeTurnId, patch);
  }

  /** Detaches the session without touching the process. */
  async unbind(host: ProcessHost, appSessionId: string, reason: HostCloseReason): Promise<void> {
    void host;
    this.lastUnbindReasonValue = reason;
    const session = this.sessions.get(appSessionId);
    if (session?.pending) {
      this.settleTurn(session, 'failed');
    }
    // A detached binding has no reader for its holds, and the session is about to
    // leave `sessions`; drop them here so closeHost's sweep cannot miss them.
    this.releaseSessionLeases(appSessionId);
    this.sessions.delete(appSessionId);
  }

  /** Terminates the process. Idempotent; the only verb that kills it. */
  async closeHost(host: ProcessHost, reason: HostCloseReason): Promise<void> {
    void host;
    this.lastCloseReasonValue = reason;
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.liveSettings.settleAll();
    for (const session of this.sessions.values()) {
      if (session.pending) {
        this.settleTurn(session, 'failed');
      }
      this.releaseSessionLeases(session.appSessionId);
    }
    this.sessions.clear();
    this.pendingLaunches.clear();
    const connection = this.connection;
    this.connection = null;
    connection?.close();
  }

  /**
   * Opens *this session's own* resident process, with no turn behind it.
   *
   * The verb `provider-runtime.service.startResidentSession` and the restore
   * pass reach. Idempotent: a session that already has a live host answers with
   * that host rather than opening a second process, because "start" is a request
   * for a state. A cold launch carries the provider-native id the session must
   * adopt (from `launch.context`) into the binding `openHost` creates, so a
   * restored conversation resumes its own thread instead of starting a new one;
   * `launch.options` supplies the `thread/start` defaults for a session that has
   * no id to resume.
   */
  async startResidentSession(
    appSessionId: string,
    launch: HostResidentLaunch,
  ): Promise<HostResidentStartResult> {
    const existing = this.liveHostFor(appSessionId);
    if (existing) {
      return { hostId: existing.hostId, pid: existing.pid };
    }

    const hostPort = this.hostPort;
    if (!hostPort) {
      throw new AppError(
        'CodexHostDriver.startResidentSession needs the session-host manager (the `host` option).',
        { code: 'CODEX_HOST_PORT_MISSING', statusCode: 500 },
      );
    }

    this.pendingLaunches.set(appSessionId, {
      providerSessionId: launch.context.resolveProviderSessionId(appSessionId),
      threadDefaults: threadDefaultsFromLaunchOptions(launch.options),
    });
    try {
      const host = await hostPort.openHost({
        provider: 'codex',
        mode: 'resident',
        appSessionId,
        driver: this,
      });
      return { hostId: host.hostId, pid: host.pid };
    } catch (error) {
      this.pendingLaunches.delete(appSessionId);
      throw error;
    }
  }

  /**
   * The resident turn entry (`provider-runtime.service`'s `ResidentTurnEntry`).
   *
   * Runs one turn through the same submit path and forwards the app-server
   * frames belonging to this session's thread to the run's writer. AC-440
   * deliberately only lets unknown frames pass without breaking the read loop;
   * normalizing them into app message shapes is a later integration task, so
   * this layer forwards the protocol frames it was given.
   */
  async run(
    appSessionId: string,
    turn: HostTurnInput,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    // Cold dispatch: the first turn of a resident session reaches the driver
    // before any host exists. It opens the process through the same verb an
    // on-demand start uses, so both paths share one launch decision rather than
    // growing a second copy here.
    if (!this.host || this.closed || this.host.state === 'closed') {
      await this.startResidentSession(appSessionId, { options: turn.options ?? {}, context });
    }
    const host = this.host;
    if (!host) {
      throw new AppError('CodexHostDriver.run was called before a host was started.', {
        code: 'CODEX_HOST_NOT_STARTED',
        statusCode: 409,
      });
    }
    const session = this.requireSession(appSessionId);
    const unsubscribe = this.connection?.onNotification((method, params) => {
      if (isRecord(params) && params.threadId === session.threadId) {
        writer.send({ method, params });
      }
    });
    try {
      await this.submit(host, appSessionId, turn);
    } finally {
      unsubscribe?.();
    }
    return this.readSession(appSessionId);
  }

  /** The session reading the criterion prints; also useful to a manager-side caller. */
  readSession(appSessionId: string): CodexResidentSessionReading {
    const session = this.requireSession(appSessionId);
    return {
      threadId: session.threadId,
      activeTurnId: session.activeTurnId,
      turnStatus: session.turnStatus,
      lastResumeError: session.lastResumeError,
    };
  }

  /**
   * The fail-closed reading AC-436's busy-input path will gate on: whether this
   * session's connection can serve experimental (`thread/queue/*`) calls now.
   *
   * False for an unbound session, a connection that was never created or never
   * finished its handshake, a closed or dead connection, and a capability that
   * was not declared or has been refused by the server. Only a live, initialized
   * session whose handshake opted in and was not refused reads true. This task
   * provides and pins the reading; nothing here consumes it yet.
   */
  experimentalApiAvailable(appSessionId: string): boolean {
    if (this.closed || !this.sessions.has(appSessionId)) {
      return false;
    }
    const connection = this.connection;
    if (!connection || !connection.isInitialized || !connection.isAlive()) {
      return false;
    }
    return connection.isExperimentalApiAvailable();
  }

  /**
   * Starts one client-owned background process and holds a `background-task`
   * lease for it.
   *
   * The hold is recorded only after `process/spawn` succeeds: a rejected spawn
   * must not leave a lease the manager would keep the host alive for. The lease
   * carries the handle the caller chose (or this driver's `bg-<n>`), which is
   * exactly what `process/exited` names when the process ends.
   */
  async spawnBackgroundProcess(
    appSessionId: string,
    spec: CodexBackgroundProcessSpec,
  ): Promise<CodexBackgroundLease> {
    this.requireSession(appSessionId);
    const connection = this.requireConnection();
    const processHandle = spec.processHandle ?? `bg-${++this.backgroundHandleSerial}`;
    await connection.request('process/spawn', backgroundSpawnParams(processHandle, spec));
    const lease = this.backgroundLeases.add(appSessionId, processHandle);
    this.reportLeaseAdded(appSessionId, lease);
    return lease;
  }

  /**
   * Asks the server to kill one background process.
   *
   * The reply is not the end of the process: `process/spawn`'s contract reports
   * the end as a `process/exited` notification, and only that releases the hold.
   * A driver that dropped the lease here would read "kill sent" as "process
   * gone" while the process may still be alive.
   */
  async killBackgroundProcess(appSessionId: string, processHandle: string): Promise<void> {
    this.requireSession(appSessionId);
    const connection = this.requireConnection();
    await connection.request('process/kill', { processHandle });
  }

  /** The session's `background-task` holds, ordered by handle. */
  readBackgroundLeases(appSessionId: string): CodexBackgroundLease[] {
    return this.backgroundLeases.list(appSessionId);
  }

  /**
   * `thread/start` or `thread/resume` for this session's next turn.
   *
   * A known thread is resumed. The one recoverable failure is the zero-turn
   * thread: it has an id but no rollout, so the server answers `no rollout
   * found`; the driver starts a fresh thread and replaces the id. Any other
   * resume failure is propagated.
   */
  private async ensureThread(connection: CodexAppServerConnection, session: ResidentSession): Promise<string> {
    if (session.threadId) {
      try {
        const resumed = await connection.request('thread/resume', { threadId: session.threadId });
        const threadId = readThreadId(resumed) ?? session.threadId;
        session.threadId = threadId;
        session.lastResumeError = null;
        return threadId;
      } catch (error) {
        const message = errorMessage(error);
        session.lastResumeError = message;
        if (!message.includes('no rollout found')) {
          throw error;
        }
        // Fall through: a zero-turn thread has no rollout to resume.
      }
    }
    const started = await connection.request('thread/start', threadParams(this.threadDefaults, session.threadDefaults));
    const threadId = readThreadId(started);
    if (!threadId) {
      throw new AppError('Codex app-server returned a thread without an id.', {
        code: 'CODEX_APP_SERVER_PROTOCOL',
        statusCode: 502,
      });
    }
    session.threadId = threadId;
    return threadId;
  }

  /** Registers the waiter before `turn/start`, so an early notification cannot be missed. */
  private beginTurn(session: ResidentSession, threadId: string): PendingTurn {
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
      resolve = settle;
    });
    const pending: PendingTurn = { threadId, turnId: null, promise, resolve };
    session.pending = pending;
    return pending;
  }

  private handleNotification(method: string, params: unknown): void {
    // Process frames carry `processHandle`, never `threadId`, so this dispatch
    // has to run before the thread gate below or the exit would be dropped.
    if (method === 'process/exited') {
      this.handleProcessExited(params);
      return;
    }
    // The confirmation for a live settings change: it carries `threadId`, but it
    // is not a turn frame, so it must be matched before the turn dispatch below.
    if (method === 'thread/settings/updated') {
      this.liveSettings.handleNotification(params);
      return;
    }
    if (!isRecord(params) || typeof params.threadId !== 'string') {
      return;
    }
    const session = this.sessionForThread(params.threadId);
    if (!session) {
      return;
    }
    const turn = isRecord(params.turn) ? params.turn : {};
    const turnId = typeof turn.id === 'string' ? turn.id : null;
    if (method === 'turn/started') {
      session.turnStatus = 'inProgress';
      session.activeTurnId = turnId ?? session.activeTurnId;
      this.sink?.activity(session.appSessionId);
      return;
    }
    if (method === 'turn/completed' || method === 'turn/failed' || method === 'turn/interrupted') {
      const status = method === 'turn/failed'
        ? 'failed'
        : method === 'turn/interrupted'
          ? 'interrupted'
          : normalizeTurnStatus(typeof turn.status === 'string' ? turn.status : 'completed');
      this.settleTurn(session, status, turnId);
      this.sink?.activity(session.appSessionId);
    }
  }

  private settleTurn(session: ResidentSession, status: CodexTurnStatus, turnId?: string | null): void {
    session.turnStatus = status;
    if (turnId) {
      session.activeTurnId = turnId;
    }
    // The single settlement point, so the `turn` lease is released exactly once:
    // a rejected `turn/start`, a terminal notification, an interrupt, an unbind,
    // a close and a self-reported exit all arrive here.
    this.removeTurnLease(session);
    const pending = session.pending;
    if (!pending) {
      return;
    }
    if (!pending.turnId && turnId) {
      pending.turnId = turnId;
    }
    session.activeTurnId = pending.turnId ?? session.activeTurnId;
    session.pending = null;
    pending.resolve();
  }

  /**
   * Reports the `turn` lease for a session that is starting one.
   *
   * The run id is unique per turn of this instance, so a lease that somehow
   * survived an earlier settlement cannot make the manager's replacement rule
   * mistake this turn for that one. The removal of an unsettled lease first is
   * the same guard, stated where the lease is taken.
   */
  private addTurnLease(session: ResidentSession): void {
    this.removeTurnLease(session);
    const runId = `codex-turn-${++this.turnSerial}`;
    session.turnLeaseRunId = runId;
    this.sink?.leaseAdded(session.appSessionId, { kind: 'turn', runId });
  }

  /** Releases this session's `turn` lease, at most once. */
  private removeTurnLease(session: ResidentSession): void {
    if (!session.turnLeaseRunId) {
      return;
    }
    session.turnLeaseRunId = null;
    this.sink?.leaseRemoved(session.appSessionId, 'turn');
  }

  /**
   * The live host serving this session, as this driver can see it.
   *
   * `this.host` is the record the manager handed to `startHost` and mutates; the
   * snapshot is the fallback for a host this driver did not open itself. A closed
   * host is never live, and this instance's own closed latch counts too: after
   * `closeHost` the process is gone even if the record is still readable.
   */
  private liveHostFor(appSessionId: string): ProcessHost | null {
    const own = this.host;
    if (own && !this.closed && own.state !== 'closed' && own.bindings.has(appSessionId)) {
      return own;
    }
    for (const host of this.hostPort?.snapshot() ?? []) {
      if (host.state !== 'closed' && host.bindings.has(appSessionId)) {
        return host;
      }
    }
    return null;
  }

  private sessionForThread(threadId: string): ResidentSession | null {
    for (const session of this.sessions.values()) {
      if (session.threadId === threadId) {
        return session;
      }
    }
    return null;
  }

  private requireSession(appSessionId: string): ResidentSession {
    const session = this.sessions.get(appSessionId);
    if (!session) {
      throw new AppError(`No Codex resident session is bound for "${appSessionId}".`, {
        code: 'CODEX_SESSION_NOT_BOUND',
        statusCode: 409,
      });
    }
    return session;
  }

  private requireConnection(): CodexAppServerConnection {
    if (this.closed) {
      throw new AppError('Codex resident host is closed.', {
        code: 'CODEX_APP_SERVER_UNAVAILABLE',
        statusCode: 409,
      });
    }
    if (!this.connection) {
      this.connection = this.createConnection(this.launch);
      this.connection.onNotification((method, params) => this.handleNotification(method, params));
      this.connection.onExit((reason) => this.handleExit(reason));
    }
    return this.connection;
  }

  /** The connection when it can still carry a frame; null before start or after close. */
  private liveConnection(): CodexAppServerConnection | null {
    const connection = this.connection;
    if (this.closed || !connection || !connection.isAlive()) {
      return null;
    }
    return connection;
  }

  /** The process went away on its own: settle in-flight turns and report the exit. */
  private handleExit(reason: string): void {
    void reason;
    this.liveSettings.settleAll();
    for (const session of this.sessions.values()) {
      if (session.pending) {
        this.settleTurn(session, 'failed');
      }
      // The process is gone, so every hold it represented is over. Report the
      // removal but never re-add a survivor: there are none.
      this.releaseSessionLeases(session.appSessionId);
    }
    const hostId = this.host?.hostId;
    if (hostId) {
      this.sink?.exited({ hostId, detail: 'error' });
    }
  }

  /**
   * One `process/exited`: drop exactly that handle, then re-report the session's
   * remaining holds.
   *
   * The manager drops a lease *by kind* (`removeLease(appSessionId, kind)`), so
   * the only way to remove one handle without losing its siblings is: remove the
   * kind, then re-add every survivor with its original `since`. Both steps run
   * in this synchronous turn — an await between them would let the idle-close
   * window observe a session that looks unheld.
   */
  private handleProcessExited(params: unknown): void {
    if (!isRecord(params) || typeof params.processHandle !== 'string') {
      return;
    }
    const appSessionId = this.sessionForProcess(params.processHandle);
    if (!appSessionId) {
      return;
    }
    const { released, remaining } = this.backgroundLeases.release(appSessionId, params.processHandle);
    if (!released) {
      // An exit for a handle this session never held: say nothing, because
      // `leaseRemoved` would clear a sibling process's live lease.
      return;
    }
    this.sink?.leaseRemoved(appSessionId, 'background-task');
    for (const lease of remaining) {
      this.reportLeaseAdded(appSessionId, lease);
    }
  }

  /** Reports one `background-task` hold, carrying the ledger's `since` verbatim. */
  private reportLeaseAdded(appSessionId: string, lease: CodexBackgroundLease): void {
    this.sink?.leaseAdded(appSessionId, {
      kind: 'background-task',
      id: lease.processHandle,
      since: lease.since,
    });
  }

  /** Drops one session's holds, reporting the kind once when anything was held. */
  private releaseSessionLeases(appSessionId: string): void {
    const released = this.backgroundLeases.releaseAll(appSessionId);
    if (released.length > 0) {
      this.sink?.leaseRemoved(appSessionId, 'background-task');
    }
  }

  /** Which bound session holds this process handle, if any. */
  private sessionForProcess(processHandle: string): string | null {
    for (const appSessionId of this.sessions.keys()) {
      const held = this.backgroundLeases
        .list(appSessionId)
        .some((lease) => lease.processHandle === processHandle);
      if (held) {
        return appSessionId;
      }
    }
    return null;
  }
}
