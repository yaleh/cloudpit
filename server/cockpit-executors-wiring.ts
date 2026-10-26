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
import { AppError } from '@/shared/utils.js';
import type { LLMProvider } from '@/shared/types.js';

import { userDb } from './modules/database/index.js';
import {
  CockpitSessionSendExecutor,
  CockpitSessionStartExecutor,
  resolveSessionProject,
  type CockpitProjectLookup,
  type CockpitSessionSendResult,
} from './modules/cockpit/index.js';
import { sessionsService } from './modules/providers/index.js';
import { quayFleetProjectIds } from './modules/quay/index.js';
import type { createChatControlService } from './modules/websocket/index.js';

/** The one shared control service, as this wiring reads it. */
type CockpitChatControl = Pick<ReturnType<typeof createChatControlService>, 'send'>;

/** The fleet registry join, as this wiring reads it (fleet id → registered root, or null). */
export type CockpitFleetProjectLookup = CockpitProjectLookup;

/** Everything the composition root supplies / a criterion overrides. */
export type CockpitExecutorsWiring = {
  /** The process-wide chat control service (the one `server/index.ts` built). */
  control: CockpitChatControl;
  /** The session-row writer the MCP `session_create` path also uses. */
  sessions?: Pick<typeof sessionsService, 'createAppSession'>;
  /** The acting user's id; defaults to the deployment's first user. */
  resolveUserId?: () => string | number | null;
  /** Fleet registry id → registered root; defaults to the real quay-fleet join. */
  resolveFleetProject?: CockpitFleetProjectLookup;
  /** Whole-path override; defaults to the fleet-first rule below. */
  resolveProjectPath?: (project: string) => Promise<string>;
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

  const start = async (request: {
    project: string;
    initialMessage: string;
    provider: LLMProvider;
  }): Promise<{ sessionId: string; projectPath: string }> => {
    const projectPath = await resolveProject(request.project);

    // Same two steps the MCP `session_create` path walks: the row first, then the opening
    // message through the ONE shared control service. A create that never sends would leave
    // a row whose name quotes the reply but whose transcript never received it.
    const created = sessions.createAppSession(
      request.provider,
      projectPath,
      request.initialMessage,
    );
    const sent = await wiring.control.send(
      { userId: resolveUserId(), via: 'websocket' },
      { sessionId: created.sessionId, content: request.initialMessage },
    );
    if (!sent.ok) {
      throw new AppError(sent.message, {
        code: sent.code,
        statusCode: refusalStatus(sent.code),
      });
    }

    return { sessionId: created.sessionId, projectPath };
  };

  return [
    new CockpitSessionSendExecutor({ send }),
    new CockpitSessionStartExecutor({ start }),
  ];
}
