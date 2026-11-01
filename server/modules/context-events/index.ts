/**
 * Context-events module — barrel.
 *
 * The one public surface of the host-level context ledger. `server/index.ts`
 * records through the process instance; `server/modules/quay/quay.module.ts`
 * reads its status for the fleet-summary response; the criteria compose a stream
 * with `createContextEvents`. Nothing else may deep-import this directory.
 */
// consumer: server/index.ts (records utterances/chips/cockpit events), quay.module.ts (status reading)
export {
  CHIP_SOURCE_WINDOW_MS,
  contextEvents,
  createContextEvents,
  readContextEventStatus,
} from './context-events.module.js';
export type {
  ContextEventRecord,
  ContextEvents,
  ContextEventsOptions,
  ReplySuggestionsUsageRecord,
} from './context-events.module.js';
// consumer: the shadow-prediction report and the wiring's producer table
export {
  CLOUDCLI_CONTEXT_EVENT_KINDS,
  CONTEXT_EVENT_MAX_LINE_BYTES,
  createContextEventWriter,
  createSessionAskEventWriter,
  FLEET_TOLERATED_AHEAD_KINDS,
  SESSION_ASK_RETRACTED_DATA_FIELDS,
  SESSION_ASK_RETRACTED_KIND,
} from './context-event-writer.js';
export type {
  AppendContextEventResult,
  CloudCliContextEventKind,
  ContextEventDraft,
  ContextEventWriter,
  ContextEventWriterStatus,
  SessionAnsweredEventData,
  SessionAskingEventData,
  SessionAskingRetractedEventData,
  SessionAskContextEventDraft,
  SessionAskEventRecord,
  SessionAskEventWriter,
  SessionAskEventWriterStatus,
} from './context-event-writer.js';
// consumer: the observation layer's startup sweep, which rebuilds its open-ask ledger from the
// rows this host stated (a digest write is not the only record of an ask)
export {
  DEFAULT_SESSION_ASK_LOOKBACK_DAYS,
  readOpenSessionAsks,
  readRetractedSessionAskMessageIds,
} from './session-ask-stream-reader.js';
export type { OpenSessionAsk, ReadOpenSessionAsksOptions } from './session-ask-stream-reader.js';
// consumer: the knowledge-application fact wiring — the raw ask rows, with the file they came from,
// so the fact contract reports a source pointer for the activity it correlates
export type { CloudCliSessionAskRow } from './session-ask-stream-reader.js';
// consumer: server/knowledge-facts-wiring.ts (the `peer_result` reading and its transcript re-read)
export {
  DEFAULT_KNOWLEDGE_ACTIVITY_LOOKBACK_DAYS,
  deriveKnowledgeOperationId,
  KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON,
  KNOWLEDGE_TARGET_UNKNOWN_REASON,
  readKnowledgeActivities,
  readKnowledgeActivity,
  readKnowledgeActivityReply,
} from './knowledge-activity-events.js';
export type {
  KnowledgeActivity,
  KnowledgeActivityRead,
  KnowledgeActivityReRead,
  KnowledgeReplyReRead,
  KnowledgeTranscriptMessage,
  ReadKnowledgeActivitiesOptions,
} from './knowledge-activity-events.js';
// consumer: shadow-prediction-report.mjs (through a JSON dump), and the classifier criterion
export { classifyUtterance, LADDER_BASELINE, UTTERANCE_CLASSES } from './utterance-classifier.js';
export type { LadderLevel, UtteranceClass } from './utterance-classifier.js';
// consumer: the composition root installs the adapter on the session-run port; the run registry
// and the session-host manager state the two lifecycle events through it
export {
  createSessionRunEventWriter,
  sessionClosed,
  sessionRunEnded,
  sessionRunOutcome,
  toSessionRunEventDraft,
} from './session-run-events.js';
export type {
  SessionRunEventRecord,
  SessionRunEventWriter,
  SessionRunEventWriterStatus,
} from './session-run-events.js';
// consumer: the composition root installs the adapter on the blocked-session port; the Codex
// approval broker and host driver state `session.blocked` / `session.blocked.resolved` through it
export {
  createSessionBlockedEventWriter,
  toSessionBlockedEventDraft,
} from './session-blocked-events.js';
export type {
  SessionBlockedEventAppend,
  SessionBlockedEventWriter,
  SessionBlockedEventWriterStatus,
} from './session-blocked-events.js';
// consumer: the report's transition backfill, and the predictor criterion
export { createShadowPredictor, SHADOW_PREDICTION_METHOD } from './shadow-predictor.js';
export type {
  ShadowFlow,
  ShadowPrediction,
  ShadowPredictionOutcome,
  ShadowPredictor,
  TransitionTable,
} from './shadow-predictor.js';
// consumer: server/index.ts (the ONE accepted-send ledger, handed to `session_send` and
// `knowledge_facts`), the knowledge-facts criterion, and the peer-delivery port below
export {
  SESSION_CONTROL_LEDGER_LIMIT,
  createSessionControlLedger,
} from './knowledge-delivery-ledger.js';
export type {
  ISessionControlLedger,
  SessionControlSendLedger,
  SessionDeliveryCorrelation,
  SessionDeliveryCorrelationInput,
} from './knowledge-delivery-ledger.js';
// consumer: the peer-delivery chain below and the knowledge-facts criterion
export {
  KNOWLEDGE_REPLY_NOT_AFTER_DELIVERY_REASON,
  KNOWLEDGE_TARGET_TRANSCRIPT_UNREADABLE_REASON,
  readDeliveredMessage,
} from './knowledge-peer-transcript.js';
export type {
  DeliveredMessageReading,
  SessionControlTranscriptMessage,
} from './knowledge-peer-transcript.js';
// consumer: the peer-delivery port below and the knowledge-facts criterion
export {
  KNOWLEDGE_ACTION_PERMISSION_REASON,
  KNOWLEDGE_DELIVERY_NOT_IN_LEDGER_REASON,
  KNOWLEDGE_NO_DELIVERY_RECORD_REASON,
  SESSION_CONTROL_DELIVERY_SOURCE,
  readPeerDeliveryCorrelation,
} from './knowledge-peer-delivery-read.js';
export type {
  SessionControlDeliveryEntry,
  SessionControlPeerDeliveryDeps,
  SessionPeerDeliveryInput,
} from './knowledge-peer-delivery-read.js';
// consumer: server/index.ts (the composition root creates the port), server/knowledge-facts-wiring.ts
// (its `peer_result` reading composes it), and the knowledge-facts criterion
export { createSessionControlPeerDelivery } from './knowledge-peer-delivery.js';
export type { ISessionControlPeerDelivery } from './knowledge-peer-delivery.js';
