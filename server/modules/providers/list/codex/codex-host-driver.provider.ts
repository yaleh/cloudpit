import { CodexAppServerConnection } from '@/modules/providers/list/codex/codex-app-server.connection.js';
import type { CodexAppServerLaunch } from '@/modules/providers/list/codex/codex-app-server.connection.js';
import type { IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import type {
  HostCloseReason,
  HostReconfigurePatch,
  HostTurnInput,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';
import { AppError, errorMessage, isRecord } from '@/shared/utils.js';

/**
 * Codex's resident host driver: one long-lived `codex app-server` process per
 * app session, with thread identity, pid and an in-flight turn surviving across
 * turns.
 *
 * This file deliberately lands only the primitive this criterion covers —
 * persistent thread, resume after the first turn, zero-turn fallback and
 * interrupt-without-killing-the-process. It is not mounted on
 * `CodexProvider` and does not declare `resident` in the capability registry:
 * mounting and the resident declaration are AC-441/AC-442, and the existing
 * pins in `session-hosts/tests` require Codex to keep mounting no host driver
 * until then. Queue, live settings, approvals, background leases and restore
 * belong to AC-436…AC-443 and are absent here on purpose.
 *
 * Consumed by the criterion in `tests/codex-host-driver-persistent.test.ts`,
 * which injects an in-memory transport through `createConnection`.
 */

/** The terminal and in-flight states one resident turn can be in. */
export type CodexTurnStatus = 'inProgress' | 'completed' | 'failed' | 'interrupted';

/** What a caller can read about one session without touching its process. */
export type CodexResidentSessionReading = {
  threadId: string | null;
  activeTurnId: string | null;
  turnStatus: CodexTurnStatus | null;
  /** The last `thread/resume` failure, kept so the zero-turn fallback is observable. */
  lastResumeError: string | null;
};

/** The thread-level defaults `thread/start` is given. */
export type CodexThreadDefaults = {
  cwd?: string;
  model?: string;
  approvalPolicy?: string;
  sandbox?: string;
  developerInstructions?: string;
};

export type CodexHostDriverOptions = {
  /** Builds the connection; the criterion injects one over a fake transport. */
  createConnection?: (launch: CodexAppServerLaunch) => CodexAppServerConnection;
  /** Transport launch facts (working directory, environment). */
  launch?: CodexAppServerLaunch;
  /** Thread defaults sent to `thread/start`. */
  thread?: CodexThreadDefaults;
};

type PendingTurn = {
  threadId: string;
  turnId: string | null;
  promise: Promise<void>;
  resolve: () => void;
};

type ResidentSession = {
  appSessionId: string;
  threadId: string | null;
  activeTurnId: string | null;
  turnStatus: CodexTurnStatus | null;
  lastResumeError: string | null;
  pending: PendingTurn | null;
};

/** Reads `{ thread: { id } }` from a thread start/resume result. */
function readThreadId(result: unknown): string | null {
  if (!isRecord(result) || !isRecord(result.thread)) {
    return null;
  }
  return typeof result.thread.id === 'string' && result.thread.id ? result.thread.id : null;
}

/** Reads `{ turn: { id } }` from a turn start result. */
function readTurnId(result: unknown): string | null {
  if (!isRecord(result) || !isRecord(result.turn)) {
    return null;
  }
  return typeof result.turn.id === 'string' && result.turn.id ? result.turn.id : null;
}

/** Narrows a protocol status string to the states this driver tracks. */
function normalizeTurnStatus(raw: string): CodexTurnStatus {
  return raw === 'failed' || raw === 'interrupted' || raw === 'inProgress' ? raw : 'completed';
}

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
  private readonly sessions = new Map<string, ResidentSession>();
  private connection: CodexAppServerConnection | null = null;
  private host: ProcessHost | null = null;
  private sink: IProviderHostDriverSink | null = null;
  private closed = false;

  constructor(options: CodexHostDriverOptions = {}) {
    this.createConnection = options.createConnection
      ?? ((launch) => new CodexAppServerConnection({ launch }));
    this.launch = options.launch ?? {};
    this.threadDefaults = options.thread ?? {};
  }

  /** Starts the process and reports its pid on the host record. */
  async startHost(host: ProcessHost, sink: IProviderHostDriverSink): Promise<ProcessHost> {
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
    if (this.sessions.has(binding.appSessionId)) {
      return;
    }
    this.sessions.set(binding.appSessionId, {
      appSessionId: binding.appSessionId,
      // A restored binding carries the provider-native id. A thread that never
      // ran a turn has no rollout yet, which is what makes resume fail and the
      // zero-turn fallback reachable.
      threadId: binding.providerSessionId ?? null,
      activeTurnId: null,
      turnStatus: null,
      lastResumeError: null,
      pending: null,
    });
  }

  /** Delivers one turn and resolves only when that turn reaches a terminal state. */
  async submit(host: ProcessHost, appSessionId: string, turn: HostTurnInput): Promise<void> {
    void host;
    const connection = this.requireConnection();
    const session = this.requireSession(appSessionId);
    const threadId = await this.ensureThread(connection, session);
    const pending = this.beginTurn(session, threadId);
    try {
      const started = await connection.request('turn/start', this.turnParams(threadId, turn));
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

  /** No live-setting surface is implemented in this task; changes wait for the next turn. */
  async reconfigure(
    host: ProcessHost,
    appSessionId: string,
    patch: HostReconfigurePatch,
  ): Promise<'live' | 'next-turn'> {
    void host;
    void appSessionId;
    void patch;
    return 'next-turn';
  }

  /** Detaches the session without touching the process. */
  async unbind(host: ProcessHost, appSessionId: string, reason: HostCloseReason): Promise<void> {
    void host;
    void reason;
    const session = this.sessions.get(appSessionId);
    if (session?.pending) {
      this.settleTurn(session, 'failed');
    }
    this.sessions.delete(appSessionId);
  }

  /** Terminates the process. Idempotent; the only verb that kills it. */
  async closeHost(host: ProcessHost, reason: HostCloseReason): Promise<void> {
    void host;
    void reason;
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const session of this.sessions.values()) {
      if (session.pending) {
        this.settleTurn(session, 'failed');
      }
    }
    this.sessions.clear();
    const connection = this.connection;
    this.connection = null;
    connection?.close();
  }

  /**
   * The resident turn entry (`provider-runtime.service`'s `ResidentTurnEntry`).
   *
   * Runs one turn through the same submit path and forwards the app-server
   * frames belonging to this session's thread to the run's writer. Frame
   * normalization into app message shapes belongs to the integration task
   * (AC-440); this layer forwards the protocol frames it was given.
   */
  async run(
    appSessionId: string,
    turn: HostTurnInput,
    writer: ProviderRuntimeWriter,
    context: ProviderRuntimeContext,
  ): Promise<unknown> {
    void context;
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
    const started = await connection.request('thread/start', this.threadParams());
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

  /** The process went away on its own: settle in-flight turns and report the exit. */
  private handleExit(reason: string): void {
    void reason;
    for (const session of this.sessions.values()) {
      if (session.pending) {
        this.settleTurn(session, 'failed');
      }
    }
    const hostId = this.host?.hostId;
    if (hostId) {
      this.sink?.exited({ hostId, detail: 'error' });
    }
  }

  private threadParams(): Record<string, unknown> {
    const defaults = this.threadDefaults;
    return {
      ...(defaults.cwd ? { cwd: defaults.cwd } : {}),
      ...(defaults.model ? { model: defaults.model } : {}),
      ...(defaults.approvalPolicy ? { approvalPolicy: defaults.approvalPolicy } : {}),
      ...(defaults.sandbox ? { sandbox: defaults.sandbox } : {}),
      ...(defaults.developerInstructions ? { developerInstructions: defaults.developerInstructions } : {}),
    };
  }

  private turnParams(threadId: string, turn: HostTurnInput): Record<string, unknown> {
    const effort = turn.options.effort;
    return {
      threadId,
      input: [{ type: 'text', text: turn.command }],
      ...(typeof effort === 'string' ? { effort } : {}),
    };
  }
}
