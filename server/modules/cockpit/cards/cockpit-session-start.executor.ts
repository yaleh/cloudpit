/**
 * `session.start`: the cockpit's built-in executor for opening a NEW conversation
 * about a card and making the person's reply its first message.
 *
 * Same leaf rule as `session.send` (AC-394): the real work — resolving a quay-fleet
 * registry id to a project path, minting the row through
 * `sessionsService.createAppSession`, and opening its first run through the shared
 * chat control service — lives in a sibling module, so this executor takes ONE
 * injected function. `server/cockpit-executors-wiring.ts` is the binding.
 *
 * The reply's two spellings are the same as `session.send`: an option declares
 * `{ project, initialMessage, provider? }`, while the person's own reply joins the
 * typed text under `reply`. Either one is the new conversation's first message.
 */
import type { ICockpitActionExecutor } from '@/shared/interfaces.js';
import type {
  LLMProvider,
  ProviderModelsDefinition,
  SessionLaunchSelection,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

/** The executor id a card's action / `ownReply` names. */
export const COCKPIT_SESSION_START_EXECUTOR_ID = 'session.start';

/** The providers a new conversation may run on; anything else is the caller's mistake. */
export const COCKPIT_SESSION_PROVIDERS: readonly LLMProvider[] = [
  'claude',
  'codex',
  'cursor',
  'opencode',
];

/** The provider a card-started conversation runs on when the action names none. */
export const DEFAULT_COCKPIT_SESSION_PROVIDER: LLMProvider = 'claude';

/** The fleet registry join the start path consults: registry id → registered root. */
export type CockpitProjectLookup = (
  projectSegment: string,
) => Promise<{ root: string } | null>;

/**
 * Resolves a card's `subject.project` to the path a new conversation runs in.
 *
 * THE FLEET IS TRIED FIRST because the cockpit's addresses speak the fleet's project ids
 * (`quay://<fleetProjectId>/…`). A value the fleet does not register is used as written —
 * the card may name a path directly, and the row writer is the one that states whether it
 * is usable. This rule lives with the executor (not the composition root) so it is provable
 * with an injected lookup and no fleet CLI.
 */
export async function resolveSessionProject(
  project: string,
  fleet: CockpitProjectLookup,
): Promise<string> {
  const trimmed = project.trim();
  if (trimmed === '') {
    throw new AppError('session.start requires a non-empty project', {
      code: 'INVALID_REQUEST',
      statusCode: 400,
    });
  }
  const match = await fleet(trimmed);
  return match === null ? trimmed : match.root;
}

/** What the injected start is asked to create; `provider` is already validated. */
export type CockpitSessionStartRequest = {
  project: string;
  initialMessage: string;
  provider: LLMProvider;
};

/** The new conversation the injected start created. */
export type CockpitSessionStartResult = {
  sessionId: string;
  projectPath: string;
};

/** The outside world this executor needs: one create-and-open function. */
export type CockpitSessionStartDeps = {
  start(request: CockpitSessionStartRequest): Promise<CockpitSessionStartResult>;
};

/**
 * The session-row writer, as this module reads it.
 *
 * STRUCTURAL, not an imported service type: this module is a leaf (AC-394) and may name no
 * sibling module. The composition root passes the real `sessionsService`; a criterion passes a
 * recorder. Both satisfy the three calls the start path makes.
 */
export type CockpitSessionStartSessions = {
  createAppSession(
    provider: LLMProvider,
    projectPath: string,
    initialMessage: string,
    selection?: SessionLaunchSelection,
  ): { sessionId: string };
  switchSessionLifecycleMode(
    provider: LLMProvider,
    sessionId: string,
    mode: 'per-run' | 'resident',
  ): unknown;
};

/**
 * The provider services the start path validates a configured launch selection with.
 *
 * `setSessionPermissionMode` is the existing writer. `getProviderModels` is the
 * SAME catalog the picker lists and the launch compiler resolves against
 * (predefined options merged with the custom model library), which is what makes
 * a configured model/effort a check rather than a guess.
 */
export type CockpitSessionStartModels = {
  setSessionPermissionMode(
    provider: LLMProvider,
    sessionId: string,
    permissionMode: string,
  ): unknown;
  getProviderModels(provider: LLMProvider): Promise<ProviderModelsDefinition>;
};

/** The provider capability matrix, as the start path reads it. */
export type CockpitSessionStartCapabilities = {
  getProviderCapabilities(
    provider: LLMProvider,
  ): {
    permissionModes: string[];
    lifecycleModes: Array<'per-run' | 'resident'>;
    /** Whether the provider runtime accepts a model-level reasoning effort at all. */
    supportsEffort: boolean;
  } | undefined;
};

/** The shared chat control service's one verb. */
export type CockpitSessionStartControl = {
  send(
    caller: { userId: string | number | null; via: 'websocket' },
    input: {
      sessionId: string;
      content: string;
      options?: { permissionMode: string; model?: string; effort?: string };
    },
  ): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
};

/** How a card-started conversation is opened (`cockpit.sessionStart` in the settings file). */
export type CockpitSessionStartPreferences = {
  lifecycleMode: string;
  permissionMode: string;
  /** The model the new conversation launches with (`'default'` is the shipped sentinel). */
  model: string;
  /** Optional reasoning effort; absent leaves the launch's own inference untouched. */
  effort?: string;
};

/** Everything the starter binds; the composition root supplies the real world. */
export type CockpitSessionStarterDeps = {
  sessions: CockpitSessionStartSessions;
  models: CockpitSessionStartModels;
  capabilities: CockpitSessionStartCapabilities;
  control: CockpitSessionStartControl;
  preferences: CockpitSessionStartPreferences;
  resolveUserId: () => string | number | null;
  resolveProjectPath: (project: string) => Promise<string>;
};

/** The refusal status a control-service code maps to; the code itself is preserved. */
function refusalStatus(code: string): number {
  switch (code) {
    case 'SESSION_NOT_FOUND':
      return 404;
    case 'RUN_IN_PROGRESS':
      return 409;
    case 'FORBIDDEN':
      return 403;
    case 'UNSUPPORTED_PROVIDER':
      return 400;
    default:
      return 502;
  }
}

/**
 * The model value that means "whatever the provider launches by default".
 *
 * It is the Claude catalog's own option, and the shipped `cockpit.sessionStart.model`. A
 * provider whose catalog does not list it keeps its own default instead of being refused:
 * the sentinel is the operator saying "do not choose", not a model name.
 */
const PROVIDER_DEFAULT_MODEL_SENTINEL = 'default';

/**
 * Validates the configured model/effort against the provider's catalog and capability matrix,
 * and answers the `SessionLaunchSelection` the row is minted with.
 *
 * BOTH READINGS ARE THE PRODUCTION ONES. `getProviderModels` is the same merged catalog the
 * picker lists and the launch compiler resolves (so a custom model-library id is selectable,
 * and a deleted or mistyped id is not), and `supportsEffort` is the capability matrix the
 * composer's effort picker is rendered from. The row writer records exactly what this returns;
 * the first run then resolves its model from that row, so the selection cannot be a value the
 * page showed and the launch ignored.
 *
 * An unknown/deleted model and an effort the provider or model does not offer are REFUSED with
 * a readable AppError before any row exists — never silently downgraded to the provider default,
 * which is the incident this rule exists to prevent. `'default'` on a provider that has no such
 * catalog option is the one exception, and it means "unstated" (the provider's own default).
 */
async function resolveLaunchSelection(
  deps: CockpitSessionStarterDeps,
  provider: LLMProvider,
): Promise<SessionLaunchSelection> {
  const configuredModel = deps.preferences.model.trim();
  const configuredEffort = (deps.preferences.effort ?? '').trim();
  const catalog = await deps.models.getProviderModels(provider);
  const knownOption = catalog.OPTIONS.find((option) => option.value === configuredModel);
  const providerDefaultOption = catalog.OPTIONS.find((option) => option.value === catalog.DEFAULT);

  // The shipped sentinel on a catalog that has no such entry means "unstated": the provider
  // keeps its own launch default, exactly as it did before this preference existed.
  const model = configuredModel === PROVIDER_DEFAULT_MODEL_SENTINEL && !knownOption
    ? ''
    : configuredModel;

  if (model !== '' && !knownOption) {
    const supported = catalog.OPTIONS.map((option) => option.value);
    throw new AppError(
      `Unknown ${provider} model "${model}". Supported models: ${supported.join(', ') || 'none'}.`,
      { code: 'MODEL_UNKNOWN', statusCode: 400, details: { supported } },
    );
  }

  if (configuredEffort !== '') {
    const supportsEffort =
      deps.capabilities.getProviderCapabilities(provider)?.supportsEffort === true;
    if (!supportsEffort) {
      throw new AppError(
        `Provider "${provider}" does not support a reasoning effort; remove \`cockpit.sessionStart.effort\`.`,
        { code: 'EFFORT_NOT_SUPPORTED', statusCode: 400 },
      );
    }
    // When the catalog states which efforts the selected model offers, the configured value
    // must be one of them: the runtime silently DROPS an unknown effort, so accepting it here
    // would report a choice the launch never made. A catalog entry with no effort table (a
    // custom model row) leaves the value to the provider's own capability answer above.
    const effortOption = knownOption ?? providerDefaultOption;
    const allowedEfforts = effortOption?.effort?.values?.map((value) => value.value) ?? [];
    if (allowedEfforts.length > 0 && !allowedEfforts.includes(configuredEffort)) {
      throw new AppError(
        `Model "${model || catalog.DEFAULT}" does not offer reasoning effort "${configuredEffort}"; supported: ${allowedEfforts.join(', ')}.`,
        { code: 'EFFORT_NOT_SUPPORTED', statusCode: 400, details: { supported: allowedEfforts } },
      );
    }
  }

  return {
    ...(model === '' ? {} : { model }),
    ...(configuredEffort === '' ? {} : { effort: configuredEffort }),
  };
}

/**
 * Builds the real `session.start` body: open a NEW conversation in the BACKGROUND, resident and
 * with the configured permission mode, and make the card's reply its first message.
 *
 * THE ORDER IS MCP `session_create`'s ORDER, deliberately: refuse an unsupported permission mode
 * (and an unknown model / unsupported effort) BEFORE a row exists (a card that cannot open the
 * session it promised must not leave a half-configured one behind), then create the row, then
 * write both lifecycle/permission preferences, then send. The preferences are written before the
 * send because the backend reads them at DISPATCH time — a resident session whose preference
 * landed after the first turn would run that turn per-run, and a `bypassPermissions` preference
 * would arrive too late for the first Bash call to avoid the prompt this whole path exists to
 * remove.
 *
 * THE LAUNCH SELECTION IS PART OF THE ROW, not a later step: `createAppSession` records the
 * configured model/effort in the same insert, and the opening send also states them so a per-run
 * runtime (which reads its effort from the send's options) launches the FIRST turn under the
 * same selection. The first turn is therefore never a compose-default turn followed by a
 * correction on the second.
 *
 * The lifecycle default is provider-scoped, exactly like MCP: the shipped `resident` is stored
 * only where the provider's own matrix declares it, and every other provider keeps the row's
 * `per-run` DB default with no call. A NON-default mode the provider does not declare is refused
 * rather than silently downgraded.
 *
 * Consumers: `server/cockpit-executors-wiring.ts` (the composition root) and the cockpit
 * executors criterion.
 */
export function createCockpitSessionStarter(
  deps: CockpitSessionStarterDeps,
): CockpitSessionStartDeps['start'] {
  return async (request) => {
    const projectPath = await deps.resolveProjectPath(request.project);
    const permissionMode = deps.preferences.permissionMode;
    const supportedPermissions =
      deps.capabilities.getProviderCapabilities(request.provider)?.permissionModes ?? [];
    if (!supportedPermissions.includes(permissionMode)) {
      throw new AppError(
        `Provider "${request.provider}" does not support permission mode "${permissionMode}"; supported: ${
          supportedPermissions.join(', ') || 'none'
        }.`,
        { code: 'UNSUPPORTED_PERMISSION_MODE', statusCode: 400 },
      );
    }

    // Validated BEFORE the row exists, exactly like the permission mode above: a model the
    // catalog does not know (a typo, or a library entry that has since been deleted) and an
    // effort the provider/model does not offer are readable refusals, never a silent fall back
    // to the provider default and never an orphan row.
    const selection = await resolveLaunchSelection(deps, request.provider);

    const created = deps.sessions.createAppSession(
      request.provider,
      projectPath,
      request.initialMessage,
      selection,
    );

    // The same writer MCP uses. A null/undefined result means the row refused the write
    // (unknown session, or a mode the writer's own matrix rejects); the check above rules out
    // the mode, so report the row rather than send a turn under a preference it does not carry.
    const recorded = deps.models.setSessionPermissionMode(
      request.provider,
      created.sessionId,
      permissionMode,
    );
    if (!recorded) {
      throw new AppError(
        `Session "${created.sessionId}" did not record permission mode "${permissionMode}".`,
        { code: 'SESSION_PREFERENCE_NOT_RECORDED', statusCode: 502 },
      );
    }

    const lifecycleMode = deps.preferences.lifecycleMode as 'per-run' | 'resident';
    const declaredLifecycles =
      deps.capabilities.getProviderCapabilities(request.provider)?.lifecycleModes ?? [];
    if (declaredLifecycles.includes(lifecycleMode)) {
      deps.sessions.switchSessionLifecycleMode(
        request.provider,
        created.sessionId,
        lifecycleMode,
      );
    } else if (lifecycleMode !== 'resident') {
      throw new AppError(
        `Provider "${request.provider}" does not implement "${lifecycleMode}" lifecycle mode.`,
        { code: 'LIFECYCLE_MODE_NOT_SUPPORTED', statusCode: 400 },
      );
    }

    const sent = await deps.control.send(
      { userId: deps.resolveUserId(), via: 'websocket' },
      {
        sessionId: created.sessionId,
        content: request.initialMessage,
        options: {
          permissionMode,
          // The row already carries them, so a resident driver resolves the model from there;
          // the options are what a PER-RUN runtime reads its effort from, and stating both on
          // the opening send is what makes the FIRST turn the configured one rather than only
          // the second onward. Absent values stay absent (the launch's own inference).
          ...(selection.model === undefined ? {} : { model: selection.model }),
          ...(selection.effort === undefined ? {} : { effort: selection.effort }),
        },
      },
    );
    if (!sent.ok) {
      throw new AppError(sent.message, {
        code: sent.code,
        statusCode: refusalStatus(sent.code),
      });
    }

    return { sessionId: created.sessionId, projectPath };
  };
}

/** Reads a non-empty string parameter, or states why it cannot. */
function requiredString(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(`session.start requires a non-empty \`${field}\``, {
      code: 'INVALID_REQUEST',
      statusCode: 400,
    });
  }
  return value;
}

/** The `session.start` executor. */
export class CockpitSessionStartExecutor implements ICockpitActionExecutor {
  readonly id = COCKPIT_SESSION_START_EXECUTOR_ID;
  private readonly deps: CockpitSessionStartDeps;

  constructor(deps: CockpitSessionStartDeps) {
    this.deps = deps;
  }

  async execute(params: Record<string, unknown>): Promise<unknown> {
    const project = requiredString(params, 'project');
    const initialMessage =
      typeof params.reply === 'string'
        ? requiredString(params, 'reply')
        : requiredString(params, 'initialMessage');
    const provider =
      typeof params.provider === 'string' && params.provider.trim() !== ''
        ? params.provider.trim()
        : DEFAULT_COCKPIT_SESSION_PROVIDER;
    if (!COCKPIT_SESSION_PROVIDERS.includes(provider as LLMProvider)) {
      throw new AppError(`session.start does not know the provider "${provider}"`, {
        code: 'INVALID_REQUEST',
        statusCode: 400,
      });
    }

    const started = await this.deps.start({
      project,
      initialMessage,
      provider: provider as LLMProvider,
    });

    if (typeof started.sessionId !== 'string' || started.sessionId.trim() === '') {
      throw new AppError('session.start answered without a session id', {
        code: 'SESSION_START_FAILED',
        statusCode: 502,
      });
    }

    return { sessionId: started.sessionId, projectPath: started.projectPath };
  }
}
