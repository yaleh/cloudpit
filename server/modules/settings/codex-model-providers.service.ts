/**
 * The Settings → Agents → Codex provider registry endpoints, as service operations.
 *
 * WHY A SIBLING FILE. `settings.service.ts` is the assembled application service and already
 * carries every Settings workflow; this registry's transport contract (a full replacement, a
 * version proof, a write-only secret) is a distinct concern with its own criterion, so it lives
 * here and is composed into the assembled service. The file port stays behind
 * {@link CodexModelProvidersPort}, so the service never imports the filesystem itself.
 *
 * WHAT THE SERVICE OWNS. Transport validation only: the body must be an object, `providers`
 * must be an array, and the version the editor based its save on must be present (body or
 * `If-Match`). Provider-entry validation is the file schema's job, because the same rules must
 * hold when the file is read at spawn time.
 */
import { readExpectedVersion } from '@/shared/settings-file.js';
import type { CodexModelProvidersReading } from '@/shared/types.js';
import { AppError, isRecord } from '@/shared/utils.js';

/** The file seam behind the registry endpoints; supplied by `settings.module.ts`. */
export type CodexModelProvidersPort = {
  read(): CodexModelProvidersReading;
  write(input: { providers: unknown; expectedVersion: string }): Promise<CodexModelProvidersReading>;
};

/** The body keys a save may carry; everything else is refused rather than ignored. */
const WRITE_FIELDS: readonly string[] = ['expectedVersion', 'providers'];

/**
 * Creates the registry operations over one port. A missing port is a visible 500, never an
 * empty registry: an unconfigured settings module must not look like "no providers".
 *
 * Consumers: `settings.service.ts`, which spreads these methods into the assembled service.
 */
export function createCodexModelProvidersOperations(port: CodexModelProvidersPort | undefined) {
  const requirePort = (): CodexModelProvidersPort => {
    if (!port) {
      throw new AppError('Codex model provider settings are not configured', {
        code: 'CODEX_MODEL_PROVIDERS_UNAVAILABLE',
        statusCode: 500,
      });
    }
    return port;
  };

  return {
    /** The saved registry plus every provider's `tokenSet` and warnings; never a secret. */
    getCodexModelProviders(): CodexModelProvidersReading {
      return requirePort().read();
    },
    /**
     * Replaces the registry. `expectedVersion` (or `If-Match`) proves the editor read the file
     * it is replacing; a stale value is the port's readable 409, not an overwrite.
     */
    async updateCodexModelProviders(input: {
      body: unknown;
      headerVersion?: string | undefined;
    }): Promise<CodexModelProvidersReading> {
      const registry = requirePort();
      if (!isRecord(input.body)) {
        throw new AppError('body must be a JSON object', {
          code: 'INVALID_BODY',
          statusCode: 400,
        });
      }
      const unknownFields = Object.keys(input.body).filter((field) => !WRITE_FIELDS.includes(field));
      if (unknownFields.length > 0) {
        throw new AppError(`unknown field(s): ${unknownFields.join(', ')}`, {
          code: 'UNKNOWN_FIELD',
          statusCode: 400,
          details: { fields: unknownFields },
        });
      }
      const expectedVersion = readExpectedVersion(input.body, input.headerVersion);
      if (input.body.providers === undefined) {
        throw new AppError('providers is required', {
          code: 'PROVIDERS_REQUIRED',
          statusCode: 400,
        });
      }
      if (!Array.isArray(input.body.providers)) {
        throw new AppError('providers must be an array', {
          code: 'PROVIDERS_INVALID',
          statusCode: 400,
        });
      }
      return registry.write({ providers: input.body.providers, expectedVersion });
    },
  };
}
