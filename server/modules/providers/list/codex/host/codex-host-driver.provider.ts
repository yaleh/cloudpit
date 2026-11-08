import { CodexAppServerConnection } from '@/modules/providers/list/codex/app-server/codex-app-server.connection.js';
import type { CodexAppServerLaunch } from '@/modules/providers/list/codex/app-server/codex-app-server.connection.js';
import type { CodexBackgroundLease } from '@/modules/providers/list/codex/host/codex-background-lease-ledger.js';
import { CodexBackgroundProcesses } from '@/modules/providers/list/codex/host/codex-background-processes.js';
import {
  createCodexApprovalBroker,
  type CodexApprovalBroker,
  type CodexApprovalDriverOptions,
  type CodexResidentSessionReading,
} from '@/modules/providers/list/codex/host/codex-approval-broker.js';
import {
  ensureThread,
  normalizeTurnStatus,
  readTurnId,
  residentThreadDefaults,
  turnParams,
  type CodexBackgroundProcessSpec,
  type CodexHostDriverOptions,
  type CodexResidentHostPort,
  type CodexThreadDefaults,
  type CodexTurnStatus,
  type PendingResidentLaunch,
  type PendingTurn,
  type ResidentSession,
} from '@/modules/providers/list/codex/host/codex-host-driver.contract.js';
import { pendingLaunchForHost, residentLaunchForOptions } from '@/modules/providers/list/codex/host/codex-resident-provider-launch.js';
import {
  createCodexLiveSettings,
  type CodexLiveSettings,
  type CodexSettingsCapabilities,
  type CodexTurnSettingsPatch,
  type HostReconfigureOutcome,
} from '@/modules/providers/list/codex/host/codex-live-settings.js';
import { createCodexResidentFrameRelay, type CodexResidentFrameRelay } from '@/modules/providers/list/codex/host/codex-resident-normalize.js';
import { CodexResidentBlockedTurns, readTurnErrorMessage } from '@/modules/providers/list/codex/host/codex-resident-blocked-events.js';
import { CodexResidentQueue } from '@/modules/providers/list/codex/host/codex-resident-queue.js';
import { codexResidentInput, codexResidentPrompt } from '@/modules/providers/list/codex/host/codex-resident-input.js';
import {
  steerCurrentTurn,
  type CodexSteerResult,
} from '@/modules/providers/list/codex/host/codex-resident-steer.js';
import type { IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  HostCloseReason,
  HostPendingQueuedInputs,
  HostQueuedInputCancelResult,
  HostReconfigurePatch,
  HostResidentLaunch,
  HostResidentStartResult,
  HostTurnInput,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';
import { AppError, isRecord } from '@/shared/utils.js';

/** How long `reconfigure` waits for its `thread/settings/updated` before deferring. */
const DEFAULT_SETTINGS_NOTIFICATION_TIMEOUT_MS = 5_000;

/** Ceiling for the one-shot `experimentalFeature/list` capability probe. */
const DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS = 5_000;

/**
 * Codex's resident host driver: one long-lived `codex app-server` process per
 * app session, with thread identity, pid and an in-flight turn surviving across
 * turns. Process lifetime, turn state, the busy-input queue and background
 * leases are owned here; live settings, approvals, the queue and the
 * `process/*` verbs live in their sibling modules. Consumed by the criteria in
 * `tests/`, which inject an in-memory transport through `createConnection`.
 */

export type {
  CodexBackgroundProcessSpec,
  CodexHostDriverOptions,
  CodexResidentHostPort,
  CodexThreadDefaults,
  CodexTurnStatus,
} from '@/modules/providers/list/codex/host/codex-host-driver.contract.js';
/** The reading AC-438 widens with `threadStatus`/`activeFlags`/pending approvals. */
export type { CodexResidentSessionReading, CodexApprovalDriverOptions };
/** Re-exported so callers of the driver never reach into the helper module. */
export type { CodexSettingsCapabilities, CodexTurnSettingsPatch, CodexSteerResult };

/**
 * One app session owns one app-server: `multiplexedHost = false` keeps the
 * manager from placing a second conversation on this process.
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
  /** The per-session launch each host was spawned with; absent = the driver-wide launch. */
  private readonly hostLaunches = new Map<string, CodexAppServerLaunch>();
  /** The `process/*` verbs and the `background-task` leases they report. */
  private readonly background: CodexBackgroundProcesses;
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
  /** Owns the approval writers, pending requests, notifications and thread status. */
  private readonly approvals: CodexApprovalBroker;
  /** Which failed/interrupted turn left a blocked-session card open, per session. */
  private readonly blockedTurns = new CodexResidentBlockedTurns();
  private connection: CodexAppServerConnection | null = null;
  /** One connection per host: the driver is a singleton, so two resident hosts must not share a connection. */
  private readonly connections = new Map<string, CodexAppServerConnection>();
  private host: ProcessHost | null = null;
  private sink: IProviderHostDriverSink | null = null;
  /** The hosts this driver has closed. The driver is a singleton, so "closed" is per host. */
  private readonly closedHostIds = new Set<string>();

  constructor(options: CodexHostDriverOptions & CodexApprovalDriverOptions = {}) {
    this.createConnection = options.createConnection
      ?? ((launch) => new CodexAppServerConnection({ launch }));
    this.launch = options.launch ?? {};
    this.threadDefaults = options.thread ?? {};
    this.hostPort = options.host ?? null;
    this.settingsNotificationTimeoutMs = options.settingsNotificationTimeoutMs
      ?? DEFAULT_SETTINGS_NOTIFICATION_TIMEOUT_MS;
    this.capabilityProbeTimeoutMs = options.capabilityProbeTimeoutMs ?? DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS;
    this.approvals = createCodexApprovalBroker({
      sessionForThread: (threadId) => this.sessionForThread(threadId)?.appSessionId ?? null,
      // 0 connected clients (the default) makes every approval unattended.
      connectedClientCount: options.connectedClientCount ?? (() => 0),
      approvalTimeoutMs: options.approvalTimeoutMs,
    });
    this.liveSettings = createCodexLiveSettings({
      notificationTimeoutMs: this.settingsNotificationTimeoutMs,
      capabilityProbeTimeoutMs: this.capabilityProbeTimeoutMs,
    });
    this.background = new CodexBackgroundProcesses({
      connection: () => this.requireConnection(),
      requireSession: (appSessionId) => {
        this.requireSession(appSessionId);
      },
      boundSessions: () => this.sessions.keys(),
      sink: () => this.sink,
      now: options.now,
    });
  }

  /**
   * The reason the manager last told this driver to close the host.
   *
   * Null means no `closeHost` was ever relayed, which is the reading a process
   * that went away on its own must keep.
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
    // `closeHost` is terminal for one host, not for this instance.
    this.closedHostIds.delete(host.hostId);
    this.host = host;
    this.sink = sink;
    // The connection (and so the process) is created before `bind` runs, so the
    // pending per-session launch has to move onto the host id first.
    const pendingLaunch = pendingLaunchForHost(host, this.pendingLaunches);
    if (pendingLaunch) {
      this.hostLaunches.set(host.hostId, pendingLaunch);
    }
    const connection = this.connectionFor(host.hostId);
    await connection.initialize();
    host.pid = connection.pid;
    return host;
  }

  /** Remembers the session's native thread id, when the session already has one. */
  async bind(host: ProcessHost, binding: SessionBinding): Promise<void> {
    // Consume the launch `startResidentSession` carried in: the provider-native
    // id a restore must adopt can only come from the launch context, and the
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
      hostId: host.hostId,
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
      queue: new CodexResidentQueue({
        connection: () => this.connectionFor(host.hostId),
        threadId: () => this.sessions.get(binding.appSessionId)?.threadId ?? null,
        closed: () => this.closedHostIds.has(host.hostId),
        activity: () => this.sink?.activity(binding.appSessionId),
      }),
    });
  }

  /** Delivers one turn and resolves only when that turn reaches a terminal state. */
  async submit(
    host: ProcessHost,
    appSessionId: string,
    turn: HostTurnInput,
    writer?: ProviderRuntimeWriter,
    frames?: CodexResidentFrameRelay,
  ): Promise<void> {
    const connection = this.connectionFor(host.hostId);
    const session = this.requireSession(appSessionId);
    const threadId = await ensureThread(connection, session, this.threadDefaults);
    // The per-run runtime announces the provider-native id through `session_created`;
    // the resident driver must do the same, or the session row never records its
    // thread id and the transcript reader finds no messages on reopen. Idempotent
    // on the writer's side (same id is captured once).
    if (writer && threadId) {
      writer.send({ kind: 'session_created', newSessionId: threadId, sessionId: threadId, provider: 'codex' });
    }
    const pending = this.beginTurn(session, threadId);
    // Reported before `turn/start` so the manager derives `busy` from the same
    // frame that starts the work; a lease added later could miss that moment.
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
      if (pending.turnId) frames?.bindTurn(pending.turnId); // frames of other turns are dropped by the relay
      await pending.promise;
      // Approvals still parked on this turn must be answered before the caller
      // reads the session, or they would outlive the turn that asked for them.
      await this.approvals.settleSession(appSessionId);
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
   * pid are untouched, which is the difference from `closeHost`.
   */
  async interrupt(host: ProcessHost, appSessionId: string): Promise<boolean> {
    void host;
    const session = this.sessions.get(appSessionId);
    if (!session || session.turnStatus !== 'inProgress' || !session.threadId || !session.activeTurnId) {
      return false;
    }
    const connection = this.connectionFor(host.hostId);
    const pending = session.pending;
    const { threadId, activeTurnId } = session;
    // Settle parked approvals first, while the socket is still open: an
    // unanswered request would trade a stopped turn for a parked server.
    await this.approvals.settleSession(appSessionId);
    await connection.request('turn/interrupt', { threadId, turnId: activeTurnId });
    if (pending) {
      await pending.promise;
    }
    return true;
  }

  /** Rewrites the turn in flight with `turn/steer`; the protocol face lives in `codex-resident-steer.ts`. */
  async steer(host: ProcessHost, appSessionId: string, turn: HostTurnInput): Promise<CodexSteerResult> {
    return steerCurrentTurn(this.connectionFor(host.hostId), this.requireSession(appSessionId), turn);
  }

  /**
   * Applies model/effort/permission to the live thread with
   * `thread/settings/update`, for both an idle and an active turn.
   *
   * Only the matching `thread/settings/updated` notification confirms the change
   * (the RPC result is `{}`); a timeout, RPC error or closed connection defers to
   * the next turn. The matching and the bounded wait live in `codex-live-settings.ts`.
   */
  async reconfigure(
    host: ProcessHost,
    appSessionId: string,
    patch: HostReconfigurePatch,
  ): Promise<'live' | 'next-turn'> {
    if (host.mode !== 'resident') {
      return 'next-turn';
    }
    const connection = this.liveConnectionFor(host.hostId);
    const session = this.sessions.get(appSessionId);
    if (!connection || !session?.threadId) {
      return 'next-turn';
    }
    return this.liveSettings.reconfigure(connection, session.threadId, patch);
  }

  /**
   * What this connection can change live: `threadSettings` always, `turnSettings`
   * only with the `step_model_switching` feature (probed once per connection).
   */
  async settingsCapabilities(host: ProcessHost, appSessionId: string): Promise<CodexSettingsCapabilities> {
    void appSessionId;
    if (host.mode !== 'resident') {
      return { threadSettings: false, turnSettings: false };
    }
    const connection = this.liveConnectionFor(host.hostId);
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
   * refusal is a real branch: nothing is sent and the caller reads `unsupported`.
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
    const connection = this.liveConnectionFor(host.hostId);
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
    if (session) {
      if (session.pending) {
        this.settleTurn(session, 'failed');
      }
      // A queued run has no reader once the binding is gone; end it here rather
      // than leave a promise nobody can observe settling.
      session.queue.settleAll();
    }
    // A detached binding has no reader for its holds; drop them before the
    // session leaves `sessions` so closeHost's sweep cannot miss them.
    this.background.releaseSession(appSessionId);
    // Requests parked on this binding are answered before its writer and thread
    // mapping are dropped, or `settleSession` could no longer name them.
    await this.approvals.detachSession(appSessionId);
    this.blockedTurns.clearSession(appSessionId);
    this.sessions.delete(appSessionId);
  }

  /** Terminates one host's process; only the sessions it served are forgotten. Idempotent. */
  async closeHost(host: ProcessHost, reason: HostCloseReason): Promise<void> {
    this.lastCloseReasonValue = reason;
    const sessions = [...this.sessions.values()].filter((session) => session.hostId === host.hostId);
    const connection = this.connections.get(host.hostId);
    if (this.closedHostIds.has(host.hostId) && sessions.length === 0 && !connection) {
      return;
    }
    this.closedHostIds.add(host.hostId);
    this.liveSettings.settleAll();
    // Answer while this socket is still open; after `close()` the answer is
    // dropped by design. Only this host's sessions are detached: another host's
    // writer, thread mapping, queue and holds must survive its sibling closing.
    for (const session of sessions) {
      if (session.pending) {
        this.settleTurn(session, 'failed');
      }
      session.queue.settleAll();
      this.background.releaseSession(session.appSessionId);
      await this.approvals.detachSession(session.appSessionId);
      this.blockedTurns.clearSession(session.appSessionId);
      this.sessions.delete(session.appSessionId);
      this.pendingLaunches.delete(session.appSessionId);
    }
    this.connections.delete(host.hostId);
    this.hostLaunches.delete(host.hostId);
    if (this.connection === connection) {
      this.connection = null;
    }
    connection?.close();
  }

  /**
   * Opens *this session's own* resident process, with no turn behind it.
   *
   * Idempotent: a session that already has a live host answers with that host
   * rather than opening a second process. A cold launch carries the
   * provider-native id the session must adopt (from `launch.context`) into the
   * binding `openHost` creates, so a restored conversation resumes its own
   * thread; `launch.options` supplies the `thread/start` defaults otherwise.
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
      threadDefaults: residentThreadDefaults(launch.options),
      // Compile BEFORE opening the host: a session bound to a provider the
      // registry no longer defines must fail readably here (no process, no
      // silent fall-back to Codex's `openai`), not on the first turn.
      launch: residentLaunchForOptions(launch.options, this.launch),
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
   * frames belonging to this session's thread, normalized into app message
   * shapes by `codex-resident-normalize.ts`.
   */
  async run(
    appSessionId: string,
    turn: HostTurnInput,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    // Cold dispatch is per-session: the driver is a singleton (multiplexedHost=false),
    // so `this.host` may hold another session's host. A host is opened only when
    // THIS session has none of its own.
    let host = this.liveHostFor(appSessionId);
    if (!host) {
      await this.startResidentSession(appSessionId, { options: turn.options ?? {}, context });
      host = this.liveHostFor(appSessionId);
    }
    if (!host) {
      throw new AppError('CodexHostDriver.run was called before a host was started.', {
        code: 'CODEX_HOST_NOT_STARTED',
        statusCode: 409,
      });
    }
    const session = this.requireSession(appSessionId);
    const connection = this.connectionFor(host.hostId);
    this.approvals.recordWriter(appSessionId, writer);
    const prompt = codexResidentPrompt(turn);
    const frames = createCodexResidentFrameRelay(writer, { transcript: { appSessionId, prompt } });
    const unsubscribe = connection.onNotification((method, params) => {
      if (isRecord(params) && params.threadId === session.threadId) {
        frames.forward(method, params);
      }
    });
    try {
      // Busy input is queued, never refused: the run stays pending until the
      // submission it wrote reaches a terminal turn (or is withdrawn).
      if (session.pending !== null || session.turnStatus === 'inProgress') {
        frames.queue();
        await session.queue.enqueueAndWait(connection, prompt, writer, (turnId) => frames.bindTurn(turnId), codexResidentInput(turn));
        return this.readSession(appSessionId);
      }
      await this.submit(host, appSessionId, turn, writer, frames);
    } finally {
      unsubscribe();
    }
    return this.readSession(appSessionId);
  }

  /** The session reading the criterion prints; also useful to a manager-side caller. */
  readSession(appSessionId: string): CodexResidentSessionReading {
    return this.approvals.readingFor(this.requireSession(appSessionId), appSessionId);
  }

  /** The app uuid of the most recent submission still in the server's queue, read off the mirror. */
  queuedInputUuid(appSessionId: string): string | null {
    return this.sessions.get(appSessionId)?.queue.latestInputUuid() ?? null;
  }

  /** How much the app-server's own queue still holds, from the `thread/queue/list` mirror. */
  pendingQueuedInputs(appSessionId: string): HostPendingQueuedInputs | null {
    return this.sessions.get(appSessionId)?.queue.pending() ?? null;
  }

  /**
   * Withdraws one queued submission by the app uuid it was queued with. The
   * verdict (`withdrawn` / `already-started` / `unknown`) is computed from the
   * `thread/queue/list` truth, never from a local counter.
   */
  async cancelQueuedInput(
    appSessionId: string,
    messageUuid: string,
  ): Promise<HostQueuedInputCancelResult> {
    const session = this.sessions.get(appSessionId);
    return session ? session.queue.cancel(messageUuid) : 'unknown';
  }

  /** The `action_required` events this driver emitted for the session, in order. */
  readApprovalNotifications(appSessionId: string): AnyRecord[] {
    return this.approvals.notificationsFor(appSessionId);
  }

  /**
   * The fail-closed reading AC-436's busy-input path will gate on: whether this
   * session's connection can serve experimental (`thread/queue/*`) calls now.
   *
   * False for an unbound session, a connection that is not live and initialized,
   * and a capability that was not declared or has been refused. This task
   * provides and pins the reading; nothing here consumes it yet.
   */
  experimentalApiAvailable(appSessionId: string): boolean {
    const session = this.sessions.get(appSessionId);
    if (!session || this.closedHostIds.has(session.hostId)) {
      return false;
    }
    const connection = this.connections.get(session.hostId);
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
   * must not leave a lease. The lease carries the handle the caller chose (or
   * this driver's `bg-<n>`), which `process/exited` names when it ends.
   */
  async spawnBackgroundProcess(
    appSessionId: string,
    spec: CodexBackgroundProcessSpec,
  ): Promise<CodexBackgroundLease> {
    return this.background.spawn(appSessionId, spec);
  }

  /**
   * Asks the server to kill one background process.
   *
   * The reply is not the end of the process: only the `process/exited`
   * notification releases the hold, so the lease is kept here.
   */
  async killBackgroundProcess(appSessionId: string, processHandle: string): Promise<void> {
    return this.background.kill(appSessionId, processHandle);
  }

  /** The session's `background-task` holds, ordered by handle. */
  readBackgroundLeases(appSessionId: string): CodexBackgroundLease[] {
    return this.background.list(appSessionId);
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
      this.background.handleExited(params);
      return;
    }
    // The live-settings confirmation carries `threadId` but is not a turn frame.
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
    // The queue is the process's; this notification is its own account of a
    // change, so refresh the mirror (bursts coalesce into one serialized read).
    if (method === 'thread/queue/changed') {
      void session.queue.requestRefresh();
      return;
    }
    if (this.approvals.observeNotification(session.appSessionId, method, params)) {
      return;
    }
    const turn = isRecord(params.turn) ? params.turn : {};
    const turnId = typeof turn.id === 'string' ? turn.id : null;
    if (method === 'turn/started') {
      session.turnStatus = 'inProgress';
      session.activeTurnId = turnId ?? session.activeTurnId;
      if (!session.pending && turnId) {
        // A turn nobody dispatched directly: after a normal completion the
        // app-server drains the queue by itself (E2), and after an interrupt it
        // answers our explicit `thread/queue/start` (E3). Either way the FIFO
        // head is what it is running.
        this.bindQueuedTurn(session, turnId);
      } else if (session.pending && !session.pending.turnId && turnId) {
        // A direct `turn/start` whose reply has not landed yet: bind the id.
        session.pending.turnId = turnId;
      }
      this.sink?.activity(session.appSessionId);
      return;
    }
    if (method === 'turn/completed' || method === 'turn/failed' || method === 'turn/interrupted') {
      const status = method === 'turn/failed'
        ? 'failed'
        : method === 'turn/interrupted'
          ? 'interrupted'
          : normalizeTurnStatus(typeof turn.status === 'string' ? turn.status : 'completed');
      this.settleTurn(session, status, turnId, readTurnErrorMessage(turn));
      this.sink?.activity(session.appSessionId);
      // A normal completion drains the queue by itself; an interrupt does not
      // (E2 vs E3 on 0.153.4), so only the interrupted path pushes the next one.
      if (status === 'interrupted') {
        session.queue.startNextAfterInterrupt();
      }
      // A terminal turn can arrive while an approval is parked (the server
      // failed or interrupted the turn itself); those requests must not
      // outlive it.
      void this.approvals.settleSession(session.appSessionId);
    }
  }

  /** Binds the queue's FIFO head to a `turn/started` nobody dispatched. */
  private bindQueuedTurn(session: ResidentSession, turnId: string): void {
    const entry = session.queue.takeForTurnStarted();
    if (!entry) {
      return;
    }
    entry.onBound?.(turnId);
    session.pending = {
      threadId: session.threadId ?? '',
      turnId,
      promise: entry.promise,
      resolve: entry.resolve,
    };
  }

  private settleTurn(session: ResidentSession, status: CodexTurnStatus, turnId?: string | null, errorMessage?: string): void {
    session.turnStatus = status;
    this.blockedTurns.noteTurnSettled(session.appSessionId, status, turnId ?? null, errorMessage);
    if (turnId) {
      session.activeTurnId = turnId;
    }
    // The single settlement point, so the `turn` lease is released exactly once:
    // a terminal notification, an interrupt, an unbind, a close and a
    // self-reported exit all arrive here.
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
    // The bound entry leaves the queue only once its turn is terminal.
    session.queue.settleBoundTurn();
    pending.resolve();
  }

  /**
   * Reports the `turn` lease for a session that is starting one.
   *
   * The run id is unique per turn of this instance, so a lease that survived an
   * earlier settlement cannot make the manager's replacement rule mistake this
   * turn for that one.
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
   * `this.host` is the record the manager handed to `startHost`; the snapshot is
   * the fallback for a host this driver did not open itself. A host this driver
   * closed is never live, while the driver's other hosts stay usable.
   *
   * A session is served by the host it was `bind`ed to: the manager also mirrors
   * that binding into `host.bindings`, but a driver handed a host directly (the
   * criteria do this, with no `hostPort` to open one) records it only on its own
   * session row. Reading either keeps `run` on the host it actually started
   * instead of demanding a manager it does not have.
   */
  private liveHostFor(appSessionId: string): ProcessHost | null {
    const own = this.host;
    const ownServesSession = own !== null
      && (own.bindings.has(appSessionId) || this.sessions.get(appSessionId)?.hostId === own.hostId);
    if (own && !this.closedHostIds.has(own.hostId) && own.state !== 'closed' && ownServesSession) {
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
    const connection = this.connection?.isAlive()
      ? this.connection : [...this.connections.values()].find((candidate) => candidate.isAlive()) ?? null;
    if (!connection) {
      throw new AppError('Codex resident host is closed.', {
        code: 'CODEX_APP_SERVER_UNAVAILABLE',
        statusCode: 409,
      });
    }
    return connection;
  }

  /** The connection serving one host, creating it on first use; each host owns its own app-server process. */
  private connectionFor(hostId: string): CodexAppServerConnection {
    if (this.closedHostIds.has(hostId)) {
      throw new AppError('Codex resident host is closed.', {
        code: 'CODEX_APP_SERVER_UNAVAILABLE',
        statusCode: 409,
      });
    }
    const existing = this.connections.get(hostId);
    if (existing) {
      return existing;
    }
    const connection = this.createConnection(this.hostLaunches.get(hostId) ?? this.launch);
    this.connections.set(hostId, connection);
    this.connection = connection;
    connection.onNotification((method, params) => this.handleNotification(method, params));
    // Every server request (the five approvals and the auxiliary questions) is
    // answered from here, so none can park the process on a client.
    this.approvals.attach(connection);
    connection.onExit((reason) => this.handleExit(reason));
    return connection;
  }

  /** The connection for one host when it can still carry a frame; null before start or after close. */
  private liveConnectionFor(hostId: string): CodexAppServerConnection | null {
    const connection = this.connections.get(hostId);
    if (this.closedHostIds.has(hostId) || !connection || !connection.isAlive()) {
      return null;
    }
    return connection;
  }

  /** The process went away on its own: settle in-flight turns and report the exit. */
  private handleExit(reason: string): void {
    void reason;
    this.liveSettings.settleAll();
    // The process is gone, so its requests can never be answered: settle the
    // waits (the writes are dropped) and forget the writers.
    this.approvals.discardAll();
    for (const session of this.sessions.values()) {
      if (session.pending) {
        this.settleTurn(session, 'failed');
      }
      session.queue.settleAll();
      // The process is gone, so every hold it represented is over. Report the
      // removal but never re-add a survivor: there are none.
      this.background.releaseSession(session.appSessionId);
    }
    const hostId = this.host?.hostId;
    if (hostId) {
      this.sink?.exited({ hostId, detail: 'error' });
    }
  }
}
