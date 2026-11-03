/**
 * Session digest subpackage — barrel.
 *
 * The two halves of the terminal-run digest producer: the deterministic write
 * (`createSessionDigestProducer`, which states `session.asking` / `session.answered` and drives
 * the ask ledger) and the bounded LLM tier layered on top of it (`createSessionDigestLlmTier`).
 *
 * Consumers: `modules/observation`'s root barrel and the observation tests. The explicitly
 * listed exports are required because both files declare a `sessionDigestProducer` value: the
 * barrel exposes the COMPOSED (LLM tier) one, exactly as the root barrel did before the split.
 */
export {
  buildSessionAskingData,
  createSessionDigestProducer,
  sessionAskQuestionText,
  SESSION_DIGEST_PRODUCER,
  sessionAskSweeper,
} from './session-digest.producer.js';
export type {
  SessionAskSweepableProducer,
  SessionDigestProducer,
  SessionDigestProducerDeps,
  SessionTurnEndEvent,
} from './session-digest.producer.js';
// Re-exported from the `session-ask` subpackage for readers that only hold a digest producer.
export { readSessionAskEventLedger, SESSION_ASK_EVENTS_DIGEST_KEY } from './session-digest.producer.js';
export type { SessionAskEventLedger } from './session-digest.producer.js';
export type { SessionAskSweepSummary } from './session-digest.producer.js';
export {
  createSessionDigestLlmTier,
  parseLlmDigestAnswer,
  SESSION_DIGEST_LLM_ADVISORY,
  SESSION_DIGEST_LLM_LIMIT_REASON,
  SESSION_DIGEST_LLM_MAX_OPTIONS,
  SESSION_DIGEST_LLM_PRODUCER,
  sessionDigestProducer,
} from './session-digest-llm.js';
export type {
  SessionDigestLlmReading,
  SessionDigestLlmTier,
  SessionDigestLlmTierDeps,
} from './session-digest-llm.js';
