/**
 * The cross-session delivery arm's orchestration: check the caller's locators
 * against the server-saved accepted-send record, confirm the resident delivery
 * ledger still holds the delivery for the same target, then re-read the target
 * transcript through {@link readDeliveredMessage}.
 *
 * THE CORRELATION IS A CHAIN, NOT A PARAMETER ECHO. A reading is `verified` only
 * when (a) the caller's `session` / `peerSession` / `correlationId` agree with
 * the saved record, (b) the resident delivery ledger holds the delivery for that
 * same target session, (c) the target transcript holds a message whose id IS the
 * delivery id, and (d) an assistant turn follows that message. Failure at any
 * step leaves the field `unknown` with a reason and `verified: false`; the newest
 * assistant message is never borrowed.
 *
 * Every service is injected, so this file imports only `server/shared/**` and
 * its own siblings — the new directory stays a leaf under AC-394's rule.
 */
import {
  knowledgeEvidence,
  knowledgeUnknown,
  type KnowledgeEvidence,
  type KnowledgePeerDeliveryCorrelation,
  type KnowledgePeerDeliveryRecord,
  type KnowledgeReadError,
  type KnowledgeUnknownField,
} from '@/shared/knowledge-facts.js';

import type { ISessionControlLedger } from './delivery-ledger.js';
import { readDeliveredMessage, type SessionControlTranscriptMessage } from './peer-transcript.js';
import { pushUnknownOnce } from './unknown-fields.js';

/** The `source` every accepted-send evidence carries. */
export const SESSION_CONTROL_DELIVERY_SOURCE = 'session-control.send';

/** Why a chain is unknown when no record was ever saved for the delivery id. */
export const KNOWLEDGE_NO_DELIVERY_RECORD_REASON =
  'no cross-session delivery record is saved for this deliveryId in this process (the send did not name a sourceSession and a correlationId, or this process did not accept it)';

/** Why a chain is unknown when the saved record exists but the resident ledger lost it. */
export const KNOWLEDGE_DELIVERY_NOT_IN_LEDGER_REASON =
  'the resident delivery ledger does not hold this delivery, so the send it names cannot be confirmed';

/** The action-permission sentence every delivery reading carries. */
export const KNOWLEDGE_ACTION_PERMISSION_REASON =
  'a peer reply proves the peer answered; it is not an authorization for any further action — the authorization scope remains the fleet human authorization reference';

/** The default tail page the target transcript read asks for. */
const DEFAULT_HISTORY_LIMIT = 200;

/** The slice of the resident delivery ledger this reader checks against. */
export type SessionControlDeliveryEntry = {
  deliveryId: string;
  /** The session whose resident ledger holds the delivery. */
  sessionId: string;
  state: string;
  enqueuedAt: number;
};

/** The services the delivery reader answers from; every one is injected. */
export type SessionControlPeerDeliveryDeps = {
  ledger: Pick<ISessionControlLedger, 'readDeliveryCorrelation'>;
  /** The resident ledger's by-id reading; a null is a delivery this process cannot confirm. */
  deliveries: { lookupById(deliveryId: string): SessionControlDeliveryEntry | null };
  sessions: {
    getSessionById(sessionId: string): { session_id: string } | null;
    fetchHistory(
      sessionId: string,
      options?: { limit?: number | null },
    ): Promise<{ messages: ReadonlyArray<SessionControlTranscriptMessage> }>;
  };
  /** How many tail messages the target transcript read asks for; defaults to 200. */
  historyLimit?: number;
};

/** The query a `peer_result` reading carries into the delivery arm. */
export type SessionPeerDeliveryInput = {
  /** The session that stated the ask (the query's `session`). */
  sourceSessionId: string;
  /** The caller's belief of the target, cross-checked against the saved record. */
  peerSession?: string;
  deliveryId?: string;
  correlationId?: string;
};

/** Builds the block every failed chain shares, so no field is left looking read. */
function unknownChain(
  reason: string,
  unknown: KnowledgeUnknownField[],
  readErrors: KnowledgeReadError[],
): KnowledgePeerDeliveryCorrelation {
  for (const field of ['delivery', 'delivery.originalMessage', 'delivery.reply'] as const) {
    pushUnknownOnce(unknown, field);
  }
  return {
    delivery: knowledgeUnknown(reason),
    originalMessage: knowledgeUnknown(reason),
    reply: knowledgeUnknown(reason),
    verified: false,
    actionPermission: { granted: false, reason: KNOWLEDGE_ACTION_PERMISSION_REASON },
    unknown,
    readErrors,
  };
}

/**
 * Reads one delivery chain. Every branch that cannot establish a link returns
 * the same all-unknown shape with the reason that failed, so a consumer never
 * has to infer "no delivery" from an absent field.
 */
export async function readPeerDeliveryCorrelation(
  input: SessionPeerDeliveryInput,
  deps: SessionControlPeerDeliveryDeps,
): Promise<KnowledgePeerDeliveryCorrelation> {
  const unknown: KnowledgeUnknownField[] = [];
  const readErrors: KnowledgeReadError[] = [];

  if (input.deliveryId === undefined) {
    return unknownChain(
      'the query names no deliveryId, so there is no delivery to correlate; a correlationId alone is a cross-check, not an address',
      unknown,
      readErrors,
    );
  }

  const record = deps.ledger.readDeliveryCorrelation(input.deliveryId);
  if (record === null) {
    return unknownChain(KNOWLEDGE_NO_DELIVERY_RECORD_REASON, unknown, readErrors);
  }

  if (record.sourceSessionId !== input.sourceSessionId) {
    return unknownChain(
      `the saved delivery was stated by session "${record.sourceSessionId}", not the queried session "${input.sourceSessionId}"`,
      unknown,
      readErrors,
    );
  }
  if (input.peerSession !== undefined && record.targetSessionId !== input.peerSession) {
    return unknownChain(
      `the saved delivery targets session "${record.targetSessionId}", not the named peer "${input.peerSession}"`,
      unknown,
      readErrors,
    );
  }
  if (input.correlationId !== undefined && record.correlationId !== input.correlationId) {
    return unknownChain(
      `the saved delivery carries correlation "${record.correlationId}", not the named "${input.correlationId}"`,
      unknown,
      readErrors,
    );
  }

  if (deps.sessions.getSessionById(record.sourceSessionId) === null) {
    readErrors.push({
      source: 'sessions.db',
      message: `the saved source session "${record.sourceSessionId}" is not in the session store`,
    });
    return unknownChain('the saved source session is not in the session store', unknown, readErrors);
  }
  if (deps.sessions.getSessionById(record.targetSessionId) === null) {
    readErrors.push({
      source: 'sessions.db',
      message: `the saved target session "${record.targetSessionId}" is not in the session store`,
    });
    return unknownChain('the saved target session is not in the session store', unknown, readErrors);
  }

  const entry = deps.deliveries.lookupById(record.deliveryId);
  if (entry === null) {
    return unknownChain(KNOWLEDGE_DELIVERY_NOT_IN_LEDGER_REASON, unknown, readErrors);
  }
  if (entry.sessionId !== record.targetSessionId) {
    return unknownChain(
      `the resident delivery ledger holds this delivery for session "${entry.sessionId}", not the recorded target "${record.targetSessionId}"`,
      unknown,
      readErrors,
    );
  }

  const delivery: KnowledgeEvidence<KnowledgePeerDeliveryRecord> = knowledgeEvidence(
    {
      deliveryId: record.deliveryId,
      correlationId: record.correlationId,
      sourceSessionId: record.sourceSessionId,
      targetSessionId: record.targetSessionId,
      bootId: record.bootId,
      recordedAt: record.recordedAt,
    },
    SESSION_CONTROL_DELIVERY_SOURCE,
    `delivery:${record.deliveryId}`,
    record.recordedAt,
  );

  const transcript = await readDeliveredMessage({
    deliveryId: record.deliveryId,
    targetSessionId: record.targetSessionId,
    recordedAt: record.recordedAt,
    limit: deps.historyLimit ?? DEFAULT_HISTORY_LIMIT,
    readHistory: (sessionId, options) => deps.sessions.fetchHistory(sessionId, options),
  });
  for (const field of transcript.unknown) pushUnknownOnce(unknown, field);
  readErrors.push(...transcript.readErrors);

  return {
    delivery,
    originalMessage: transcript.originalMessage,
    reply: transcript.reply,
    verified: transcript.verified,
    actionPermission: { granted: false, reason: KNOWLEDGE_ACTION_PERMISSION_REASON },
    unknown,
    readErrors,
  };
}
