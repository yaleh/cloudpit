/**
 * `session.send`: the cockpit's built-in executor for putting a message into an
 * existing conversation.
 *
 * WHY IT IS INJECTED, NOT IMPORTED. `modules/cockpit` is a leaf under AC-394: it may
 * import `server/shared/**` and itself only. The real send is the process-wide
 * `ChatControlService` — the SAME one the composer, the MCP gateway and the cockpit
 * hub use, so a confirmation opens no second send path — but that service lives in a
 * sibling module. This executor therefore takes the send as a function; the
 * composition root binds it in `server/cockpit-executors-wiring.ts`.
 *
 * TWO PARAMETER SPELLINGS, ONE MEANING. An option's declared action says
 * `{ sessionId, text }`; the person's own reply has no declared text, so the action
 * channel joins the typed text under `reply` (that is the one field the channel
 * adds). Both spellings reach the same send, with `reply` winning when both are
 * present because it is the text the person just typed.
 *
 * A REFUSED SEND IS NOT A SUCCESS. `ChatControlService.send` answers a structured
 * refusal (`ok: false`) when the session is gone, the provider has no runtime, a run
 * is already in flight, or the caller may not write. This executor turns that into an
 * `AppError` carrying the service's own code, so the confirmation route answers
 * non-2xx and the card list shows a failure instead of the success echo.
 */
import type { ICockpitActionExecutor } from '@/shared/interfaces.js';
import { AppError } from '@/shared/utils.js';

/** The executor id a card's action / `ownReply` names. */
export const COCKPIT_SESSION_SEND_EXECUTOR_ID = 'session.send';

/** What the injected send is asked to deliver. */
export type CockpitSessionSendRequest = {
  sessionId: string;
  text: string;
};

/** The injected send's verdict: the control service's own success/refusal shape. */
export type CockpitSessionSendResult =
  | { ok: true; deliveryId?: string | null; runId?: string | null }
  | { ok: false; code: string; message: string };

/** The outside world this executor needs: one send function. */
export type CockpitSessionSendDeps = {
  send(request: CockpitSessionSendRequest): Promise<CockpitSessionSendResult>;
};

/** Reads a non-empty string parameter, or states why it cannot. */
function requiredString(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError(`session.send requires a non-empty \`${field}\``, {
      code: 'INVALID_REQUEST',
      statusCode: 400,
    });
  }
  return value;
}

/**
 * The HTTP status a control-service refusal maps to. The code is preserved verbatim;
 * only the status is chosen here, so a caller reads one stable vocabulary either way.
 */
function statusForRefusal(code: string): number {
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

/** The `session.send` executor. */
export class CockpitSessionSendExecutor implements ICockpitActionExecutor {
  readonly id = COCKPIT_SESSION_SEND_EXECUTOR_ID;
  private readonly deps: CockpitSessionSendDeps;

  constructor(deps: CockpitSessionSendDeps) {
    this.deps = deps;
  }

  async execute(params: Record<string, unknown>): Promise<unknown> {
    const sessionId = requiredString(params, 'sessionId');
    // `reply` is the field the action channel adds for an own reply; `text` is what a
    // provider's option declares. A reply wins because it is the person's own words.
    const text =
      typeof params.reply === 'string'
        ? requiredString(params, 'reply')
        : requiredString(params, 'text');

    const result = await this.deps.send({ sessionId, text });
    if (!result.ok) {
      throw new AppError(result.message, {
        code: result.code,
        statusCode: statusForRefusal(result.code),
      });
    }

    return {
      sent: true,
      sessionId,
      deliveryId: result.deliveryId ?? null,
      runId: result.runId ?? null,
    };
  }
}
