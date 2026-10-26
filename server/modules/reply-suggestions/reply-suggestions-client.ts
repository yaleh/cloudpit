/**
 * Reply-suggestions' view of the shared direct-HTTP client.
 *
 * The client itself now lives in the leaf `server/modules/llm-gateway/`: this file
 * keeps the feature-local NAMES the rest of the module (and its criteria) already
 * import, so the extraction did not have to rewrite `reply-suggestions-chips.ts`,
 * `reply-suggestions-draw.ts` or their tests. Everything here delegates to the leaf;
 * there is no HTTP code left in this file.
 *
 * THE KEY IS REVEALED BY THE LEAF. The single production call to `reveal()` is the
 * gateway's auth-header builder in `llm-protocols.ts`; a failure carries its
 * category (and, for HTTP failures, the status code) and never the key.
 *
 * Consumers: `reply-suggestions.service.ts` (the default `complete` seam),
 * `reply-suggestions.module.ts` (the injected completion types),
 * `reply-suggestions-chips.ts` / `reply-suggestions-draw.ts` (the error class and
 * the request/answer types) and `tests/reply-suggestions-client.test.ts`.
 */
import { completeLlm, selectProtocol } from '@/modules/llm-gateway/index.js';
import type { LlmClientConfig, LlmCompletion, LlmCompletionRequest } from '@/modules/llm-gateway/index.js';

import type { ReplySuggestionsProtocol } from './reply-suggestions-settings.js';

/**
 * What the client needs to know about the gateway: exactly the settings'
 * `upstream` group.
 */
export type ReplySuggestionsClientConfig = LlmClientConfig;

/** One completion request: the resolved prompt and the decoding knobs. */
export type ReplySuggestionsCompletionRequest = LlmCompletionRequest;

/** The answer text plus whichever token counts the upstream chose to report. */
export type ReplySuggestionsCompletion = LlmCompletion;

/**
 * The categorised client failure. It is the gateway's error class under this
 * module's historical name, so every existing `instanceof` and `new` keeps working.
 */
export { LlmClientError as ReplySuggestionsClientError } from '@/modules/llm-gateway/index.js';

/**
 * The completion endpoint for one protocol, kept because the client criterion
 * reads it directly. The rule lives on the protocol strategy.
 */
export function replySuggestionsEndpoint(baseUrl: string, protocol: ReplySuggestionsProtocol): string {
  return selectProtocol(protocol).endpoint(baseUrl);
}

/** Run one completion against the configured gateway through the shared client. */
export function completeReplySuggestions(
  request: ReplySuggestionsCompletionRequest,
  dependencies: { fetchImpl?: typeof fetch } = {},
): Promise<ReplySuggestionsCompletion> {
  return completeLlm(request, dependencies);
}
