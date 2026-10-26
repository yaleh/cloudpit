/**
 * The direct-HTTP LLM gateway leaf — barrel.
 *
 * WHY A LEAF. This directory owns the generic capability (one completion over the
 * operator's OpenAI- or Anthropic-compatible gateway), not any feature. Its out-edges
 * are `node:*` builtins and itself only; the inbound edges from `reply-suggestions`,
 * `quay`, `observation` and `voice-realtime` are the AC-394 (c) leaf shape, which is
 * why the directory is registered in the import-cycle budget's manifest and pin.
 *
 * Consumers: `server/modules/reply-suggestions/reply-suggestions-client.ts` (its
 * default completion seam, error class and request/answer types),
 * `server/modules/quay/counter-voice.ts` and
 * `server/modules/observation/session-digest-llm.ts` (the same completion call and
 * the opaque credential factory), `server/modules/quay/counter-voice-settings.ts`
 * and `server/modules/observation/session-digest-llm-settings.ts` (the protocol and
 * auth-scheme names their flat readings carry), and
 * `server/modules/voice-realtime/voice-realtime-summary.ts` (the OpenAI strategy and
 * the client; it no longer carries an HTTP client of its own).
 */
// consumer: reply-suggestions-client.ts, counter-voice.ts, session-digest-llm.ts,
// voice-realtime-summary.ts — the one completion path.
export { completeLlm, LlmClientError } from './llm-client.js';
export type { LlmClientErrorCategory } from './llm-client.js';
// consumers: the same four call sites — the request/answer vocabulary.
export type {
  LlmAuthScheme,
  LlmClientConfig,
  LlmCompletion,
  LlmCompletionRequest,
  LlmProtocol,
  LlmProtocolName,
  LlmWireOptions,
} from './llm-protocols.js';
// consumer: voice-realtime-summary.ts composes its default endpoint through the
// OpenAI strategy; reply-suggestions-client.ts reads an endpoint for its criterion.
export { anthropicProtocol, openaiProtocol, selectProtocol } from './llm-protocols.js';
// consumers: reply-suggestions-settings.ts re-exports the class for its settings
// type; counter-voice.ts and session-digest-llm.ts build one through the factory so
// a raw key resolved by their own settings readers stays opaque on the way in.
export { ApiCredential, credentialFromKey } from './llm-credential.js';
