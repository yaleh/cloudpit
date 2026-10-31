/**
 * The turn arm of the Codex resident "blocked / needs a person" context events: a turn that
 * settles `failed` or `interrupted` leaves a `session.blocked` row open, and the next completed
 * turn (or the session going away) withdraws it with a `session.blocked.resolved` carrying the
 * same `blockId`.
 *
 * WHY A SIBLING FILE. `codex-host-driver.provider.ts` is already at the architecture ratchet's
 * line ceiling, and the approval arm of the same feature lives in `codex-approval-broker.ts`.
 * The rule this file owns is per session — which failed/interrupted turn left a card open — and
 * it belongs to the driver instance that settles turns, not to a module-wide singleton: one
 * process can hold several resident drivers (the criteria do), and a shared map would let one
 * instance withdraw another's card.
 *
 * FAILURE NEVER REACHES THE TURN. The port's real adapter counts a refused append instead of
 * throwing; an uninstalled port (a focused criterion, a display-only mount) simply writes nothing.
 *
 * Consumed by `codex-host-driver.provider.ts` (turn settlement and session teardown) and the
 * criterion `tests/codex-resident-approvals.test.ts`.
 */
import type { CodexTurnStatus } from '@/modules/providers/list/codex/codex-host-driver.contract.js';
import { readSessionBlockedEventWriterPort } from '@/shared/ports/session-blocked-events.port.js';
import { isRecord } from '@/shared/utils.js';

/** The resolution key a blocked turn and its resolution share. */
function blockedTurnBlockId(appSessionId: string, turnId: string): string {
  return `${appSessionId}:${turnId}`;
}

/**
 * The message a failed turn carries, when the protocol states one.
 *
 * The app-server's `turn` object has been observed with `error` as an object carrying `message`;
 * a bare string is accepted too so a protocol revision that flattens it keeps the row honest.
 * Nothing is synthesized: a turn with no stated error omits `errorMessage`.
 */
export function readTurnErrorMessage(turn: unknown): string | undefined {
  if (!isRecord(turn)) return undefined;
  const error = turn.error;
  if (typeof error === 'string' && error.trim() !== '') return error;
  if (isRecord(error) && typeof error.message === 'string' && error.message.trim() !== '') {
    return error.message;
  }
  return undefined;
}

/**
 * Which turn left a `session.blocked` row open, per app session, for one driver instance.
 *
 * `blockId` is `<sessionId>:<turnId>`, the key a `session.blocked.resolved` names. A completed
 * turn clears the open block (that is the "turn recovered" arm); a later failed/interrupted turn
 * replaces it, stating the old resolution before the new block so a card never points at a debt
 * the session already settled.
 */
export class CodexResidentBlockedTurns {
  private readonly openBlocks = new Map<string, string>();

  /**
   * Records one turn settlement.
   *
   * `turnId` must be the id the settled turn actually had: the teardown paths (`unbind`,
   * `closeHost`) pass none, so they never mint a block for a turn they are killing — they call
   * {@link clearSession} instead.
   */
  noteTurnSettled(
    appSessionId: string,
    status: CodexTurnStatus,
    turnId: string | null,
    errorMessage?: string,
  ): void {
    if (status === 'inProgress') return;
    const port = readSessionBlockedEventWriterPort();
    const open = this.openBlocks.get(appSessionId);

    if (status === 'completed') {
      if (open === undefined) return;
      this.openBlocks.delete(appSessionId);
      port?.write({ kind: 'session.blocked.resolved', session: appSessionId, blockId: open });
      return;
    }

    // A terminal turn with no id has no identity to dedup or resolve on.
    if (turnId === null || port === null) return;
    if (open !== undefined) {
      port.write({ kind: 'session.blocked.resolved', session: appSessionId, blockId: open });
    }
    const blockId = blockedTurnBlockId(appSessionId, turnId);
    this.openBlocks.set(appSessionId, blockId);
    port.write({
      kind: 'session.blocked',
      session: appSessionId,
      reason: status === 'failed' ? 'failed' : 'interrupted',
      blockId,
      turnId,
      ...(status === 'failed' && errorMessage !== undefined ? { errorMessage } : {}),
    });
  }

  /** The session is going away: withdraw whatever card it left open. */
  clearSession(appSessionId: string): void {
    const open = this.openBlocks.get(appSessionId);
    if (open === undefined) return;
    this.openBlocks.delete(appSessionId);
    readSessionBlockedEventWriterPort()?.write({
      kind: 'session.blocked.resolved',
      session: appSessionId,
      blockId: open,
    });
  }
}
