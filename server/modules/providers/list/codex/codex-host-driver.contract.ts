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
import type { McpGatewayClientTarget } from '@/shared/ports/mcp-gateway-client.port.js';
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
  /**
   * The process launch this session's host must be spawned with, or null for
   * the driver-wide launch. Compiled by `codex-resident-provider-launch.ts`:
   * Codex 0.166 checks the process-global provider on every turn and again on
   * resume, so a bound session needs `-c model_provider` at spawn time.
   */
  launch: CodexAppServerLaunch | null;
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
 * The permission mode a resident Codex session always runs under.
 *
 * The Claude resident pins its sessions to `bypassPermissions`
 * (`RESIDENT_PERMISSION_MODE` in `claude-host-driver.provider.ts`): nobody is
 * attached to answer an approval prompt, so a resident turn must never be
 * gated by one. A codex resident takes the same stand — `startResidentSession`
 * overrides the stored mode with this value before mapping it, so a session
 * whose row has no stored permission mode (or the `default` sentinel) still
 * gets the trusted `never` + `danger-full-access` pair on its first
 * `thread/start` instead of the app-server's `on-request` default.
 */
export const CODEX_RESIDENT_PERMISSION_MODE = 'bypassPermissions';

/**
 * The `thread/start` defaults a *resident* session launches with.
 *
 * Nobody is attached to answer an approval prompt, so a resident always runs on
 * the trusted permission mode the Claude resident pins — whatever the session
 * row stored (or nothing at all) is overridden here before the launch-option
 * mapping, rather than left to the app-server's `on-request` default.
 */
export function residentThreadDefaults(options: AnyRecord): CodexThreadDefaults {
  return threadDefaultsFromLaunchOptions({
    ...options,
    permissionMode: CODEX_RESIDENT_PERMISSION_MODE,
  });
}

/**
 * The `thread/start` fields a Cloudpit permission mode asks for.
 *
 * `thread/start` takes a `sandbox` *string* (`workspace-write`,
 * `danger-full-access`), while live settings take an object `sandboxPolicy`
 * ({@link ./codex-live-settings.ts}) — do not copy that shape here. The values
 * are the same ones the per-run SDK launch uses (`mapPermissionModeToCodexOptions`
 * in `codex-runtime.provider.ts`), restated here rather than imported because a
 * leaf contract must not reach into a provider module.
 *
 * `bypassPermissions` is the mode a resident session runs under (the Claude
 * resident's `RESIDENT_PERMISSION_MODE`), so its mapping must be the trusted
 * equivalent: never ask, full access. Every other mode keeps GOAL-051's
 * `workspace-write` sandbox and only relaxes the approval prompt, exactly as the
 * per-run launch does.
 */
function threadPermissionDefaults(permissionMode: string): {
  approvalPolicy: string;
  sandbox: string;
} {
  if (permissionMode === 'bypassPermissions') {
    return { approvalPolicy: 'never', sandbox: 'danger-full-access' };
  }
  return {
    approvalPolicy: permissionMode === 'acceptEdits' ? 'never' : 'on-request',
    sandbox: 'workspace-write',
  };
}

/**
 * The `thread/start` defaults a resident launch asks for.
 *
 * `HostResidentLaunch.options` is the bag the session's next turn would have
 * launched under, assembled by the providers layer (see
 * `defaultResidentLaunchOptions`): `cwd`/`projectPath` off the session row and
 * the stored model, effort and permission mode. Only a non-empty string is
 * carried, so a launch with no project directory or no chosen model keeps the
 * constructor's defaults rather than overwriting them with `undefined`.
 *
 * `permissionMode` becomes the thread's `approvalPolicy`/`sandbox` pair — the
 * first `thread/start` otherwise runs on the app-server's own defaults, which is
 * neither GOAL-051's workspace-write + never nor the Claude resident's trusted
 * bypass. A launch with no permission mode writes neither field, keeping the
 * app-server's defaults as the old behaviour did.
 */
export function threadDefaultsFromLaunchOptions(options: AnyRecord): CodexThreadDefaults {
  const defaults: CodexThreadDefaults = {};
  if (typeof options.cwd === 'string' && options.cwd) {
    defaults.cwd = options.cwd;
  }
  if (typeof options.model === 'string' && options.model) {
    defaults.model = options.model;
  }
  if (typeof options.permissionMode === 'string' && options.permissionMode) {
    const permission = threadPermissionDefaults(options.permissionMode);
    defaults.approvalPolicy = permission.approvalPolicy;
    defaults.sandbox = permission.sandbox;
  }
  return defaults;
}

/**
 * The MCP server name this server's gateway is injected under.
 *
 * `cloudpit` is the name the settings page tells a Claude user to connect
 * (`claude mcp add --transport http cloudpit …`), so a Codex session and a Claude
 * session name the same backend the same way; nothing in the driver reads it.
 * An existing `claude mcp add … cloudcli` entry keeps working: the server name is
 * a client-local key and authentication comes from the URL plus the PAT.
 */
export const CODEX_MCP_GATEWAY_SERVER_NAME = 'cloudpit';

/**
 * The child environment variable that carries the gateway credential.
 *
 * Codex is told to read the bearer token from this name
 * (`bearer_token_env_var`), so the value travels in the child's environment and
 * never appears in the process arguments — an argv token is visible to every
 * `ps` on the machine and to the app-server's own logs.
 */
export const CODEX_MCP_GATEWAY_TOKEN_ENV = 'CLOUDPIT_MCP_GATEWAY_TOKEN';

/** One `-c key=value` config override, with the value written as a TOML basic string. */
function codexConfigArg(key: string, value: string): string[] {
  return ['-c', `${key}=${tomlBasicString(value)}`];
}

/** A TOML basic string: the two characters a path or URL can carry are escaped. */
function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * The launch a resident Codex child is spawned with, gateway injected or not.
 *
 * When `target` is null this returns the launch UNCHANGED — the shipped
 * behaviour, and the negative arm of the criterion: no `-c`, no extra env, so
 * the child's tool list is whatever `~/.codex/config.toml` provides.
 *
 * When a target is present the child is told about one extra HTTP MCP server:
 *
 *   -c mcp_servers.cloudpit.url="http://127.0.0.1:<port>/mcp"
 *   -c mcp_servers.cloudpit.bearer_token_env_var="CLOUDPIT_MCP_GATEWAY_TOKEN"
 *
 * and the token is placed in the child's environment. That is the same config
 * shape `codex.mcp` writes to `config.toml` (`url` + `bearer_token_env_var`), so
 * a Codex user's own `[mcp_servers.*]` entries are unaffected and the injected
 * one is an ordinary server from the app-server's point of view. Authorization
 * is NOT short-circuited: the child presents a `ccp_` personal access token to
 * the ordinary `/mcp` route, which verifies it through `AccessTokensService`,
 * applies the tool's required scopes and writes the audit row.
 */
export function codexMcpGatewayLaunch(
  launch: CodexAppServerLaunch,
  target: McpGatewayClientTarget | null,
): CodexAppServerLaunch {
  if (target === null) {
    return launch;
  }
  return {
    ...launch,
    args: [
      ...(launch.args ?? []),
      ...codexConfigArg(`mcp_servers.${CODEX_MCP_GATEWAY_SERVER_NAME}.url`, target.url),
      ...codexConfigArg(
        `mcp_servers.${CODEX_MCP_GATEWAY_SERVER_NAME}.bearer_token_env_var`,
        CODEX_MCP_GATEWAY_TOKEN_ENV,
      ),
    ],
    env: { ...(launch.env ?? process.env), [CODEX_MCP_GATEWAY_TOKEN_ENV]: target.token },
  };
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
 * Cloudpit's vocabulary is wider than this: `default` is its "use the model's
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

/** The codex `effort` for one Cloudpit effort, or undefined to leave the field off. */
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
