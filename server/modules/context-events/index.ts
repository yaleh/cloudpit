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
