/**
 * The cockpit brief's composition seam: the one place that turns the server's existing gateway,
 * observation and database readings into the injected dependencies the leaf card module needs.
 *
 * WHY BESIDE THE COMPOSITION ROOT. `server/modules/cockpit` is a leaf for AC-394: it may import
 * `server/shared/**` and itself only. The brief service therefore takes its world as functions,
 * and this file is where the root binds them — the gateway reading is the reply-suggestions
 * settings file's (no second channel, no second key spelling), the ask/transcript reading is the
 * observation layer's, and the session lookup is the database's. Keeping the binding here rather
 * than inline in `server/index.ts` also keeps that already-oversize file from growing.
 *
 * Consumers: `server/index.ts` (passes the result to `createCockpitCardsModule`).
 */

import fs from 'node:fs';

import { sessionsDb } from './modules/database/index.js';
import { completeLlm, credentialFromKey } from './modules/llm-gateway/index.js';
import { readSessionAsk } from './modules/observation/index.js';
import { createReplySuggestionsSettingsSource } from './modules/reply-suggestions/index.js';
import type { CockpitBriefDeps } from './modules/cockpit/index.js';

/**
 * Builds the brief deps over the process's existing readers.
 *
 * `readGateway` returns null (a named fallback, not a throw) when the reply-suggestions settings
 * file has no usable gateway. The key is revealed once per call into the request; it is never
 * logged, and the brief result never carries it.
 */
export function createCockpitBriefDeps(): CockpitBriefDeps {
  const gatewaySettings = createReplySuggestionsSettingsSource();
  return {
    readGateway: () => {
      const reading = gatewaySettings.read();
      const apiKey = reading.upstream.credential.reveal();
      if (reading.upstream.baseUrl.trim() === '' || reading.upstream.model.trim() === '' || apiKey === '') {
        return null;
      }
      return {
        protocol: reading.upstream.protocol,
        baseUrl: reading.upstream.baseUrl,
        model: reading.upstream.model,
        authScheme: reading.upstream.authScheme,
        apiKey,
        disableThinking: reading.upstream.disableThinking,
        timeoutMs: reading.upstream.timeoutMs,
        temperature: reading.generation.temperature,
        maxOutputTokens: reading.generation.maxOutputTokens,
      };
    },
    readAsk: readSessionAsk,
    resolveSession: (sessionId) => {
      const row = sessionsDb.getSessionById(sessionId);
      return row === null ? null : { jsonlPath: row.jsonl_path ?? null };
    },
    readTranscript: (jsonlPath) => fs.readFileSync(jsonlPath, 'utf8'),
    complete: (request) =>
      completeLlm({
        config: {
          protocol: request.gateway.protocol,
          baseUrl: request.gateway.baseUrl,
          model: request.gateway.model,
          authScheme: request.gateway.authScheme,
          credential: credentialFromKey(request.gateway.apiKey),
          disableThinking: request.gateway.disableThinking,
          timeoutMs: request.gateway.timeoutMs,
        },
        system: request.system,
        user: request.user,
        temperature: request.gateway.temperature,
        maxOutputTokens: request.gateway.maxOutputTokens,
      }),
  };
}
