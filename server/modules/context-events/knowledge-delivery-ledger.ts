/**
 * The accepted-send ledger: the server-side record `session_send` writes when
 * the control service accepts a RELAYED ask (a send that names both the asking
 * session and a correlation label).
 *
 * WHY IT IS WRITTEN AT SEND TIME. `peer_result` already projects
 * `session.asking` / `session.answered`, which describe a question a session
 * stated in its own stream. Those rows do not say who the ask was handed to,
 * which delivery carried it, or which message the peer produced. The one
 * instant at which this process knows all of that together is the accepted
 * send, so that is where the record is written:
 *
 *   deliveryId + correlationId + sourceSessionId + targetSessionId + bootId + recordedAt
 *
 * The record is PROCESS-SCOPED, exactly like the resident delivery ledger it is
 * checked against (SPEC §8.1). A later process cannot inherit it, and the
 * reader says so with an explicit `unknown` instead of reconstructing a chain
 * from a transcript: a transcript row proves a message exists, not who sent it
 * as what delivery or under which correlation.
 *
 * The map lives inside the factory closure, not at module scope, so a criterion
 * can build a private ledger and the process owns exactly one instance (the
 * composition root creates it and hands the same object to `session_send` and
 * to `knowledge_facts`).
 */

/** How many accepted sends one process remembers before the oldest record falls out. */
export const SESSION_CONTROL_LEDGER_LIMIT = 1024;

/** One accepted send's saved correlation record. */
export type SessionDeliveryCorrelation = {
  deliveryId: string;
  correlationId: string;
  sourceSessionId: string;
  targetSessionId: string;
  bootId: string;
  recordedAt: string;
};

/** What `session_send` states when it records an accepted send. */
export type SessionDeliveryCorrelationInput = {
  deliveryId: string;
  correlationId: string;
  sourceSessionId: string;
  targetSessionId: string;
};

/** The write/read ledger one process holds for accepted cross-session sends. */
export interface ISessionControlLedger {
  recordDeliveryCorrelation(input: SessionDeliveryCorrelationInput): SessionDeliveryCorrelation;
  readDeliveryCorrelation(deliveryId: string): SessionDeliveryCorrelation | null;
  /** How many records this process currently holds; a reading, not persistence. */
  size(): number;
}

/** What the send adapter reads: the one write it performs. */
export type SessionControlSendLedger = Pick<ISessionControlLedger, 'recordDeliveryCorrelation'>;

/** Builds the process's ledger. */
export function createSessionControlLedger(deps: {
  bootId: string;
  now?: () => number;
  limit?: number;
}): ISessionControlLedger {
  const now = deps.now ?? Date.now;
  const limit = Math.max(1, deps.limit ?? SESSION_CONTROL_LEDGER_LIMIT);
  const records = new Map<string, SessionDeliveryCorrelation>();

  return {
    recordDeliveryCorrelation(input: SessionDeliveryCorrelationInput): SessionDeliveryCorrelation {
      const record: SessionDeliveryCorrelation = {
        deliveryId: input.deliveryId,
        correlationId: input.correlationId,
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.targetSessionId,
        bootId: deps.bootId,
        recordedAt: new Date(now()).toISOString(),
      };
      // Re-recording the same id replaces the old value and moves it to the end,
      // so the bound always drops the least recently accepted delivery.
      records.delete(record.deliveryId);
      records.set(record.deliveryId, record);
      while (records.size > limit) {
        const oldest = records.keys().next();
        if (oldest.done === true) break;
        records.delete(oldest.value);
      }
      return record;
    },

    readDeliveryCorrelation(deliveryId: string): SessionDeliveryCorrelation | null {
      return records.get(deliveryId) ?? null;
    },

    size(): number {
      return records.size;
    },
  };
}
