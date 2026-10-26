/**
 * The one direct-HTTP completion path: build through the protocol strategy, send,
 * classify the failure, parse the answer.
 *
 * WHY THIS MODULE EXISTS. `reply-suggestions` owned both the feature and the
 * generic client, so `modules/quay` and `modules/observation` reached into a feature
 * barrel to borrow it, and `voice-realtime` wrote a third copy. This leaf owns the
 * capability itself: every direct upstream call now enters here.
 *
 * NO PROTOCOL BRANCH. Everything that differs between Anthropic's Messages API and
 * OpenAI's Chat Completions is on the strategy objects in `llm-protocols.ts`, and
 * this file selects one by name and otherwise treats it uniformly. That is why the
 * criterion pins `grep -cE "protocol === '(anthropic|openai)'"` at zero here.
 *
 * THE KEY IS REVEALED HERE, ONCE, THROUGH THE STRATEGY. `authHeaders` in
 * `llm-protocols.ts` is the single production call to `reveal()`. No error text
 * built by this file ever carries the key: a failure carries its category and, for
 * HTTP failures, the status code — never the request or response body.
 *
 * Consumers: `reply-suggestions-client.ts` (the feature's default seam),
 * `modules/quay/counter-voice.ts`, `modules/observation/session-digest-llm.ts`,
 * `modules/voice-realtime/voice-realtime-summary.ts` and the client criterion in
 * `tests/llm-client.test.ts`.
 */
import { LlmShapeError, selectProtocol } from './llm-protocols.js';
import type { LlmCompletion, LlmCompletionRequest } from './llm-protocols.js';

export { ApiCredential, credentialFromKey } from './llm-credential.js';
export {
  anthropicProtocol,
  openaiProtocol,
  selectProtocol,
} from './llm-protocols.js';
export type {
  LlmAuthScheme,
  LlmClientConfig,
  LlmCompletion,
  LlmCompletionRequest,
  LlmProtocol,
  LlmProtocolName,
  LlmWireOptions,
} from './llm-protocols.js';

/**
 * Why a completion failed. The consumers map every category to the same response,
 * but the categories stay distinct so a log line (and a criterion) can say whether
 * the gateway answered badly, timed out, or was unreachable.
 */
export type LlmClientErrorCategory = 'timeout' | 'http' | 'network' | 'parse' | 'shape';

/**
 * A categorised client failure. `message` never carries the key or a payload.
 *
 * Consumers: `reply-suggestions-chips.ts` / `reply-suggestions-draw.ts` (through
 * the feature's compatibility alias), `counter-voice.ts` (the failure reason) and
 * both criteria that fake an upstream.
 */
export class LlmClientError extends Error {
  readonly category: LlmClientErrorCategory;
  readonly httpStatus: number | null;

  constructor(category: LlmClientErrorCategory, message: string, httpStatus: number | null = null) {
    super(message);
    this.name = 'LlmClientError';
    this.category = category;
    this.httpStatus = httpStatus;
  }
}

/**
 * Run one completion against the configured gateway.
 *
 * `fetchImpl` is injectable so a criterion can drive the real request/response path
 * without a network; production leaves it undefined and uses the global `fetch`.
 * The timeout aborts the request and reports `category: 'timeout'`.
 */
export async function completeLlm(
  request: LlmCompletionRequest,
  dependencies: { fetchImpl?: typeof fetch } = {},
): Promise<LlmCompletion> {
  const protocol = selectProtocol(request.config.protocol);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const endpoint = protocol.endpoint(request.config.baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...protocol.authHeaders(request.config.credential, request.config.authScheme),
    ...protocol.headers(),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.config.timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(protocol.buildRequest(request)),
      signal: controller.signal,
    });
  } catch (failure) {
    if (controller.signal.aborted) {
      throw new LlmClientError('timeout', `upstream request timed out after ${request.config.timeoutMs} ms`);
    }
    const reason = failure instanceof Error ? failure.message : String(failure);
    throw new LlmClientError('network', `upstream request failed: ${reason}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new LlmClientError('http', `upstream returned HTTP ${response.status}`, response.status);
  }

  let raw: string;
  try {
    raw = await response.text();
  } catch (failure) {
    if (controller.signal.aborted) {
      throw new LlmClientError('timeout', `upstream request timed out after ${request.config.timeoutMs} ms`);
    }
    const reason = failure instanceof Error ? failure.message : String(failure);
    throw new LlmClientError('network', `could not read the upstream response: ${reason}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new LlmClientError('parse', 'upstream response was not JSON');
  }

  try {
    return protocol.parseResponse(payload);
  } catch (failure) {
    if (failure instanceof LlmShapeError) throw new LlmClientError('shape', failure.message);
    throw failure;
  }
}
