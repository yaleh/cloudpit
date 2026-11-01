/**
 * `session-control` — the server-side delivery ledger and its knowledge-facts
 * read port, split by concern:
 *
 *   delivery-ledger.ts    the accepted-send record a RELAYED `session_send` writes
 *                         (deliveryId + correlationId + source/target + boot)
 *   peer-transcript.ts    target transcript -> delivered row -> first following
 *                         assistant turn (two structural identities, no borrowing)
 *   peer-delivery-read.ts the chain: locators -> saved record -> resident ledger
 *                         -> transcript; every failure an explicit unknown
 *   peer-delivery.ts      the capability + read port `knowledge_facts` composes
 *   unknown-fields.ts     list helpers shared by the two readers above
 *
 * This directory is a LEAF under AC-394: every file imports only
 * `server/shared/**` or its own siblings. The composition root creates one
 * ledger and one port and hands the same ledger to `session_send` (write) and to
 * `knowledge_facts` (read) — no process-wide singleton lives here.
 */
export {
  SESSION_CONTROL_LEDGER_LIMIT,
  createSessionControlLedger,
  type ISessionControlLedger,
  type SessionControlSendLedger,
  type SessionDeliveryCorrelation,
  type SessionDeliveryCorrelationInput,
} from './delivery-ledger.js';
export {
  KNOWLEDGE_REPLY_NOT_AFTER_DELIVERY_REASON,
  KNOWLEDGE_TARGET_TRANSCRIPT_UNREADABLE_REASON,
  readDeliveredMessage,
  type DeliveredMessageReading,
  type SessionControlTranscriptMessage,
} from './peer-transcript.js';
export {
  KNOWLEDGE_ACTION_PERMISSION_REASON,
  KNOWLEDGE_DELIVERY_NOT_IN_LEDGER_REASON,
  KNOWLEDGE_NO_DELIVERY_RECORD_REASON,
  SESSION_CONTROL_DELIVERY_SOURCE,
  readPeerDeliveryCorrelation,
  type SessionControlDeliveryEntry,
  type SessionControlPeerDeliveryDeps,
  type SessionPeerDeliveryInput,
} from './peer-delivery-read.js';
export {
  createSessionControlPeerDelivery,
  type ISessionControlPeerDelivery,
} from './peer-delivery.js';
