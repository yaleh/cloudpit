/**
 * The `turn/steer` protocol face of Codex resident mode.
 *
 * A steer rewrites the turn already in flight: the server answers with the id of
 * that same turn (a top-level `{ turnId }`, not the `{ turn: { id } }` shape a
 * `turn/start` replies with) and the process, its thread and its pid stay
 * exactly as they were. The driver keeps the orchestration and the session
 * state; this sibling keeps the params, the reading and the two assertions, so
 * `codex-host-driver.provider.ts` stays inside the architecture ratchet.
 *
 * Consumed by `CodexHostDriver.steer` and by the criterion in
 * `tests/codex-host-driver-steer.test.ts`.
 */
import type { CodexAppServerConnection } from '@/modules/providers/list/codex/app-server/codex-app-server.connection.js';
import {
  turnParams,
  type ResidentSession,
} from '@/modules/providers/list/codex/host/codex-host-driver.contract.js';
import type { HostTurnInput } from '@/shared/types.js';
import { AppError, isRecord } from '@/shared/utils.js';

/** What a successful `turn/steer` answers: the turn it rewrote. */
export type CodexSteerResult = { turnId: string };

/** `turn/steer` params: the `turn/start` shape plus the turn the call must hit. */
function steerParams(threadId: string, expectedTurnId: string, turn: HostTurnInput): Record<string, unknown> {
  return { ...turnParams(threadId, turn), expectedTurnId };
}

/**
 * Reads the top-level `{ turnId }` a `turn/steer` reply carries.
 *
 * Deliberately not `readTurnId`: that reads `{ turn: { id } }`, the shape of a
 * `turn/start` reply, and would read every steer reply as a missing turn.
 */
function readSteerTurnId(result: unknown): string {
  if (!isRecord(result) || typeof result.turnId !== 'string' || !result.turnId) {
    throw new AppError('Codex app-server returned a steer result without a turnId.', {
      code: 'CODEX_APP_SERVER_PROTOCOL',
      statusCode: 502,
    });
  }
  return result.turnId;
}

/**
 * Refuses a steer that landed on any turn but the one in flight.
 *
 * Fail-closed: a server reporting a different turn has not steered the turn the
 * caller meant, so the caller must not read the reply as a success.
 */
function assertSteerTurnId(returnedTurnId: string, activeTurnId: string): void {
  if (returnedTurnId !== activeTurnId) {
    throw new AppError(
      `Codex app-server steered a different turn: expected=${activeTurnId} actual=${returnedTurnId}`,
      { code: 'CODEX_STEER_TURN_MISMATCH', statusCode: 502 },
    );
  }
}

/**
 * Steers the turn in flight, refusing when there is none.
 *
 * Reads the session but never writes it: a successful steer keeps `pending`,
 * `activeTurnId`, `threadId`, the turn lease and the pid exactly as they were,
 * and the turn's own `turn/completed` settles it. Every connection error is
 * rethrown untouched — there is no fallback to `thread/queue/add` or
 * `turn/start`.
 */
export async function steerCurrentTurn(
  connection: CodexAppServerConnection,
  session: ResidentSession,
  turn: HostTurnInput,
): Promise<CodexSteerResult> {
  if (session.turnStatus !== 'inProgress' || !session.threadId || !session.activeTurnId) {
    throw new AppError(`No Codex turn is in flight for "${session.appSessionId}".`, {
      code: 'CODEX_STEER_NO_ACTIVE_TURN',
      statusCode: 409,
    });
  }
  const { threadId, activeTurnId } = session;
  const result = await connection.request('turn/steer', steerParams(threadId, activeTurnId, turn));
  const returnedTurnId = readSteerTurnId(result);
  assertSteerTurnId(returnedTurnId, activeTurnId);
  return { turnId: returnedTurnId };
}
