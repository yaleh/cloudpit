/**
 * The Settings → Agents → Codex connection-test action.
 *
 * WHY A SIBLING FILE. `codex-model-providers.service.ts` is the registry's transport contract
 * and already close to the ~260-line implementation-file ratchet. Probing is a separate
 * concern: it validates the probe request, then asks the composition root to resolve the SAVED
 * provider (token-file secret included) and dial its `/responses` endpoint. Keeping it here
 * means the registry file does not grow another transport.
 *
 * THE BODY NAMES ONLY THE PROVIDER ID. The browser never holds a secret for this action; the
 * server resolves the entry. The answer is the probe's own reading, which repeats the billing
 * sentence because the request is a REAL `POST /responses`.
 *
 * Consumers: `codex-model-providers.service.ts`, which spreads this into the assembled service.
 */
import { AppError, isRecord } from '@/shared/utils.js';

import type { CodexConnectionProbe } from './codex-model-providers.settings.js';

/** The body keys a connection test may carry; everything else is refused rather than ignored. */
const CONNECTION_TEST_FIELDS: readonly string[] = ['id'];

/** The one seam this action needs: the composition root's saved-provider probe. */
export type CodexProviderConnectionPort = {
  testConnection?(providerId: string): Promise<CodexConnectionProbe>;
};

/**
 * Validates one probe request and runs it through the port.
 *
 * `port` is the same registry port the other operations receive; only `testConnection` is
 * read here. A port that does not implement it is a visible 500 rather than a silent no-op.
 */
export async function runCodexConnectionTest(
  port: CodexProviderConnectionPort,
  input: { body: unknown },
): Promise<CodexConnectionProbe> {
  const probe = port.testConnection;
  if (probe === undefined) {
    throw new AppError('Codex provider connection testing is not configured', {
      code: 'CODEX_PROVIDER_CONNECTION_TEST_UNAVAILABLE',
      statusCode: 500,
    });
  }
  if (!isRecord(input.body)) {
    throw new AppError('body must be a JSON object', {
      code: 'INVALID_BODY',
      statusCode: 400,
    });
  }
  const unknownFields = Object.keys(input.body)
    .filter((field) => !CONNECTION_TEST_FIELDS.includes(field));
  if (unknownFields.length > 0) {
    throw new AppError(`unknown field(s): ${unknownFields.join(', ')}`, {
      code: 'UNKNOWN_FIELD',
      statusCode: 400,
      details: { fields: unknownFields },
    });
  }
  if (typeof input.body.id !== 'string' || input.body.id.trim() === '') {
    throw new AppError('id must name the saved Codex provider to test', {
      code: 'CODEX_PROVIDER_ID_REQUIRED',
      statusCode: 400,
    });
  }
  return probe.call(port, input.body.id.trim());
}
