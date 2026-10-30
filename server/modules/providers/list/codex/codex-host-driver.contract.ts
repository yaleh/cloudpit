/**
 * The contract of Codex's resident host driver: the shapes a caller constructs
 * or reads, the per-session state the driver keeps, and the small readers and
 * request builders that turn app-server protocol results into those shapes and
 * those shapes into `thread/*` / `turn/*` / `process/*` params.
 *
 * Split out of `codex-host-driver.provider.ts` so that file stays under the
 * architecture ratchet's 800-line ceiling for a non-test file. None of these
 * declarations depend on the class that implements them, so the seam is by
 * concern (what the driver promises vs. how it keeps the promise), not an
 * arbitrary line range. The provider re-exports this public type surface, so
 * consumers keep importing it from the driver.
 */
import type {
  CodexAppServerConnection,
  CodexAppServerLaunch,
} from '@/modules/providers/list/codex/codex-app-server.connection.js';
import type { CodexResidentQueue } from '@/modules/providers/list/codex/codex-resident-queue.js';
import type { SessionHostManager } from '@/modules/session-hosts/index.js';
import type { AnyRecord, HostTurnInput } from '@/shared/types.js';
import { AppError, errorMessage, isRecord } from '@/shared/utils.js';

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

/**
 * The manager face this driver needs to open a session's own process.
 *
 * Narrowed to the two verbs it uses — `openHost` to bring the process up,
 * `snapshot` to answer "is there already a live host for this session?" — for
 * the same reason `ClaudeResidentHostPort` is: a driver that imported the whole
 * manager surface could reach into the state machine instead of reporting
 * through the sink. Type-only, so evaluating this leaf does not pull the
 * session-host module in.
 */
export type CodexResidentHostPort = Pick<SessionHostManager, 'openHost' | 'snapshot'>;

export type CodexHostDriverOptions = {
  /** Builds the connection; the criterion injects one over a fake transport. */
  createConnection?: (launch: CodexAppServerLaunch) => CodexAppServerConnection;
  /** Transport launch facts (working directory, environment). */
  launch?: CodexAppServerLaunch;
  /** Thread defaults sent to `thread/start`. */
  thread?: CodexThreadDefaults;
  /** Clock for a background hold's `since`; the criterion injects a deterministic one. */
  now?: () => number;
  /** How long `reconfigure` waits for `thread/settings/updated`; the criterion injects a short one. */
  settingsNotificationTimeoutMs?: number;
  /** Ceiling for the one-shot `experimentalFeature/list` probe. */
  capabilityProbeTimeoutMs?: number;
  /**
   * The session-host manager, when this driver owns resident hosts.
   *
   * Absent is the shape AC-435's criterion uses: it drives `startHost` directly
   * and never asks for an on-demand process. Present is the production mount,
   * where `startResidentSession` is how a cold session gets a process. Never
   * read at module evaluation — the connection is still created lazily.
   */
  host?: CodexResidentHostPort;
};

/**
 * One `process/spawn` request.
 *
 * `processHandle` is the client's handle and is echoed on `process/exited`; the
 * driver allocates `bg-<n>` when the caller leaves it out. The optional fields
 * are written to the request only when the caller actually supplied them.
 */
export type CodexBackgroundProcessSpec = {
  processHandle?: string;
  command: string[];
  cwd?: string;
  streamStdoutStderr?: boolean;
  streamStdin?: boolean;
  outputBytesCap?: number;
  timeoutMs?: number;
};

export type PendingTurn = {
  threadId: string;
  turnId: string | null;
  promise: Promise<void>;
  resolve: () => void;
};

export type ResidentSession = {
  appSessionId: string;
  /** The host id this session is bound to; the queue resolves its connection through it. */
  hostId: string;
  threadId: string | null;
  activeTurnId: string | null;
  turnStatus: CodexTurnStatus | null;
  lastResumeError: string | null;
  pending: PendingTurn | null;
  /** `thread/start` defaults for this session, taken from its resident launch. */
  threadDefaults: CodexThreadDefaults;
  /** The `turn` lease this session currently holds, or null when no turn is in flight. */
  turnLeaseRunId: string | null;
  /** Submissions accepted by `thread/queue/add`, the `thread/queue/list` mirror and the refresh loop. */
  queue: CodexResidentQueue;
};

/** The launch-scoped facts `bind` has to carry from the on-demand start. */
export type PendingResidentLaunch = {
  providerSessionId: string | null;
  threadDefaults: CodexThreadDefaults;
};

/** Reads `{ thread: { id } }` from a thread start/resume result. */
export function readThreadId(result: unknown): string | null {
  if (!isRecord(result) || !isRecord(result.thread)) {
    return null;
  }
  return typeof result.thread.id === 'string' && result.thread.id ? result.thread.id : null;
}

/** Reads `{ turn: { id } }` from a turn start result. */
export function readTurnId(result: unknown): string | null {
  if (!isRecord(result) || !isRecord(result.turn)) {
    return null;
  }
  return typeof result.turn.id === 'string' && result.turn.id ? result.turn.id : null;
}

/** Narrows a protocol status string to the states this driver tracks. */
export function normalizeTurnStatus(raw: string): CodexTurnStatus {
  return raw === 'failed' || raw === 'interrupted' || raw === 'inProgress' ? raw : 'completed';
}

/**
 * The `thread/start` defaults a resident launch asks for.
 *
 * `HostResidentLaunch.options` is the bag the session's next turn would have
 * launched under, assembled by the providers layer (see
 * `defaultResidentLaunchOptions`): `cwd`/`projectPath` off the session row and
 * the stored model. Only a non-empty string is carried, so a launch with no
 * project directory or no chosen model keeps the constructor's defaults rather
 * than overwriting them with `undefined`.
 */
export function threadDefaultsFromLaunchOptions(options: AnyRecord): CodexThreadDefaults {
  const defaults: CodexThreadDefaults = {};
  if (typeof options.cwd === 'string' && options.cwd) {
    defaults.cwd = options.cwd;
  }
  if (typeof options.model === 'string' && options.model) {
    defaults.model = options.model;
  }
  return defaults;
}

/** `process/spawn` params: the handle, the command, and only what the caller supplied. */
export function backgroundSpawnParams(
  processHandle: string,
  spec: CodexBackgroundProcessSpec,
): Record<string, unknown> {
  return {
    processHandle,
    command: spec.command,
    ...(spec.cwd !== undefined ? { cwd: spec.cwd } : {}),
    ...(spec.streamStdoutStderr !== undefined ? { streamStdoutStderr: spec.streamStdoutStderr } : {}),
    ...(spec.streamStdin !== undefined ? { streamStdin: spec.streamStdin } : {}),
    ...(spec.outputBytesCap !== undefined ? { outputBytesCap: spec.outputBytesCap } : {}),
    ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
  };
}

/**
 * `thread/start` params, with the session's launch defaults over the driver's.
 *
 * The constructor's `thread` option is the driver-wide default; a session
 * opened by `startResidentSession` carries the launch bag's `cwd`/`model`
 * instead, because those describe the session's own project and model rather
 * than the process's. Only keys with a value are written.
 */
export function threadParams(
  driverDefaults: CodexThreadDefaults,
  sessionDefaults: CodexThreadDefaults,
): Record<string, unknown> {
  const defaults: CodexThreadDefaults = { ...driverDefaults, ...sessionDefaults };
  return {
    ...(defaults.cwd ? { cwd: defaults.cwd } : {}),
    ...(defaults.model ? { model: defaults.model } : {}),
    ...(defaults.approvalPolicy ? { approvalPolicy: defaults.approvalPolicy } : {}),
    ...(defaults.sandbox ? { sandbox: defaults.sandbox } : {}),
    ...(defaults.developerInstructions ? { developerInstructions: defaults.developerInstructions } : {}),
  };
}

/**
 * The reasoning-effort values `turn/start` accepts on the locked 0.153.4
 * app-server, copied from its own refusal: "Supported values are: 'none',
 * 'minimal', 'low', 'medium', 'high', 'xhigh', and 'max'."
 *
 * CloudCLI's vocabulary is wider than this: `default` is its "use the model's
 * default" sentinel (`DEFAULT_EFFORT_VALUE` in `src/shared/constants.ts`) and
 * `ultracode` is a Claude-only pseudo-level. Neither is a codex effort, and the
 * server rejects the whole `turn/start` with a 400 for one unknown value, so a
 * value outside this set is dropped rather than forwarded.
 */
const CODEX_EFFORT_VALUES: Readonly<Record<string, true>> = {
  none: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
};

/** The codex `effort` for one CloudCLI effort, or undefined to leave the field off. */
function codexTurnEffort(effort: unknown): string | undefined {
  return typeof effort === 'string' && CODEX_EFFORT_VALUES[effort] === true ? effort : undefined;
}

/**
 * `turn/start` params: the thread, one text input, and `effort` when the value
 * is one the app-server accepts (see {@link CODEX_EFFORT_VALUES}).
 */
export function turnParams(threadId: string, turn: HostTurnInput): Record<string, unknown> {
  const effort = codexTurnEffort(turn.options.effort);
  return {
    threadId,
    input: [{ type: 'text', text: turn.command }],
    ...(effort ? { effort } : {}),
  };
}

/**
 * `thread/resume` for a known thread, or `thread/start` for a new one.
 *
 * The one recoverable resume failure is the zero-turn thread: it has an id but
 * no rollout, so the server answers `no rollout found`; the driver then starts
 * a fresh thread and replaces the id. Any other failure is propagated.
 */
export async function ensureThread(
  connection: CodexAppServerConnection,
  session: ResidentSession,
  driverDefaults: CodexThreadDefaults,
): Promise<string> {
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
  const started = await connection.request('thread/start', threadParams(driverDefaults, session.threadDefaults));
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
