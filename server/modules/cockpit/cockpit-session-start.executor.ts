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
import type { LLMProvider } from '@/shared/types.js';
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
