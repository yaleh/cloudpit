/**
 * The cockpit card executors' composition seam: the one place that binds the leaf card
 * module's two built-in executors to the server's real send and session-creation paths.
 *
 * WHY BESIDE THE COMPOSITION ROOT. `server/modules/cockpit` is a leaf for AC-394: it may
 * import `server/shared/**` and itself only. Its executors therefore take their world as
 * injected functions, and this file is where the root binds them — the send is the SAME
 * `ChatControlService` instance the composer, the MCP gateway and the cockpit hub use (so a
 * card confirmation opens no second send path), and the create path is the same
 * `sessionsService.createAppSession` + shared-send pair the MCP `session_create` tool walks.
 * Keeping the binding here rather than inline in `server/index.ts` also keeps that
 * already-oversize file from growing by more than the one constructor call.
 *
 * CONSUMERS: `server/index.ts`, which passes the returned executors to
 * `createCockpitCardsModule`.
 *
 * WHO THE SENDER IS. The card route is authenticated, but the action channel's executor
 * interface carries declared params only — no request identity. The cockpit's own contract
 * treats cards as belonging to ONE human (design draft §7: 「多人类 / 多机器时卡片归谁
 * (ownerSession)：v0 按单一人类处理」), so the acting user is the deployment's first user, the
 * same account the platform-mode auth middleware resolves for every request. `resolveUserId`
 * is injectable so a criterion can name the sender without a database.
 */
import { userDb } from './modules/database/index.js';
import {
  CockpitSessionSendExecutor,
  CockpitSessionStartExecutor,
  createCockpitSessionStarter,
  resolveSessionProject,
  type CockpitProjectLookup,
  type CockpitSessionSendResult,
} from './modules/cockpit/index.js';
import {
  providerCapabilitiesService,
  providerModelsService,
  sessionsService,
} from './modules/providers/index.js';
import { quayFleetProjectIds } from './modules/quay/index.js';
import type { CockpitSessionStartSettings } from './modules/settings/index.js';
import type { createChatControlService } from './modules/websocket/index.js';

/** The one shared control service, as this wiring reads it (exported for its criterion). */
export type CockpitChatControl = Pick<ReturnType<typeof createChatControlService>, 'send'>;

/** The fleet registry join, as this wiring reads it (fleet id → registered root, or null). */
export type CockpitFleetProjectLookup = CockpitProjectLookup;

/** Everything the composition root supplies / a criterion overrides. */
export type CockpitExecutorsWiring = {
  /** The process-wide chat control service (the one `server/index.ts` built). */
  control: CockpitChatControl;
  /**
   * How a card-started conversation is opened: `serverSettings.cockpit.sessionStart`.
   *
   * REQUIRED rather than defaulted here: the one reading of the settings file lives in
   * `server/index.ts`, and a second set of shipped defaults in this seam could disagree with
   * the file the operator edits.
   */
  sessionStart: CockpitSessionStartSettings;
  /**
   * The session-row writer the MCP `session_create` path also uses. The lifecycle preference
   * is stored through the same service, which refuses a mode the provider does not declare.
   */
  sessions?: Pick<typeof sessionsService, 'createAppSession' | 'switchSessionLifecycleMode'>;
  /** The permission-mode writer and the catalog reader, exactly as `session_create` reads them. */
  models?: Pick<typeof providerModelsService, 'setSessionPermissionMode'>;
  /** The provider capability matrix; a permission mode is refused before any row is created. */
  capabilities?: Pick<typeof providerCapabilitiesService, 'getProviderCapabilities'>;
  /** The acting user's id; defaults to the deployment's first user. */
  resolveUserId?: () => string | number | null;
  /** Fleet registry id → registered root; defaults to the real quay-fleet join. */
  resolveFleetProject?: CockpitFleetProjectLookup;
  /** Whole-path override; defaults to the fleet-first rule below. */
  resolveProjectPath?: (project: string) => Promise<string>;
};

/**
 * Resolves a card's `subject.project` to an absolute project path, fleet-first.
 *
 * Delegates to the leaf module's own rule (`resolveSessionProject`) so a criterion can prove
 * both spellings without a fleet CLI; this seam only supplies the real registry join.
 */
function defaultProjectPath(fleet: CockpitFleetProjectLookup) {
  return (project: string) => resolveSessionProject(project, fleet);
}

/**
 * Builds the two built-in executors over the process's real services.
 *
 * Consumers: `server/index.ts` and, for the DoD, an isolated instance's boot (which uses the
 * same composition root).
 */
export function createCockpitCardExecutors(
  wiring: CockpitExecutorsWiring,
): [CockpitSessionSendExecutor, CockpitSessionStartExecutor] {
  const sessions = wiring.sessions ?? sessionsService;
  const models = wiring.models ?? providerModelsService;
  const capabilities = wiring.capabilities ?? providerCapabilitiesService;
  const { sessionStart } = wiring;
  const resolveUserId =
    wiring.resolveUserId ?? (() => userDb.getFirstUser()?.id ?? null);
  const fleet: CockpitFleetProjectLookup =
    wiring.resolveFleetProject ??
    ((projectSegment) => quayFleetProjectIds.resolveFleetProject(projectSegment));
  const resolveProject = wiring.resolveProjectPath ?? defaultProjectPath(fleet);

  const send = async (request: {
    sessionId: string;
    text: string;
  }): Promise<CockpitSessionSendResult> => {
    const result = await wiring.control.send(
      { userId: resolveUserId(), via: 'websocket' },
      { sessionId: request.sessionId, content: request.text },
    );
    return result.ok
      ? { ok: true, deliveryId: result.deliveryId, runId: result.runId }
      : { ok: false, code: result.code, message: result.message };
  };

  // The start body lives with the executor (the leaf module), which is why this seam is only
  // the binding: the preference order, the capability refusal and the settings read are rules
  // the cockpit owns, not composition-root knowledge. The real services are passed through.
  const start = createCockpitSessionStarter({
    sessions,
    models,
    capabilities,
    control: wiring.control,
    preferences: sessionStart,
    resolveUserId,
    resolveProjectPath: resolveProject,
  });

  return [
    new CockpitSessionSendExecutor({ send }),
    new CockpitSessionStartExecutor({ start }),
  ];
}
