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

import type { CodexUserProviderImportReading } from './codex-model-providers.settings.js';

/** The file seam behind the registry endpoints; supplied by `settings.module.ts`. */
export type CodexModelProvidersPort = {
  read(): CodexModelProvidersReading;
  write(input: { providers: unknown; expectedVersion: string }): Promise<CodexModelProvidersReading>;
  /**
   * The operator's own `~/.codex` providers, read-only. The composition root decides which
   * HOME/environment the reader inspects; this service only transports its answer.
   *
   * Optional so a criterion that drives only the registry endpoints need not declare it. A
   * caller that actually needs the import surface gets the explicit 500 below, never an empty
   * profile that would read as "nothing to import".
   */
  readUserImports?(): CodexUserProviderImportReading;
};

/** The body keys a save may carry; everything else is refused rather than ignored. */
const WRITE_FIELDS: readonly string[] = ['expectedVersion', 'providers'];

/** The body keys an import may carry; everything else is refused rather than ignored. */
const IMPORT_FIELDS: readonly string[] = ['expectedVersion', 'ids'];

/**
 * Reads the import request's `ids`: a non-empty array of non-empty strings, de-duplicated in
 * request order. A malformed list is refused before any profile row is looked up, so a bad
 * request can never look like a partial import.
 */
function readImportIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new AppError('ids must be an array of provider ids', {
      code: 'IMPORT_IDS_INVALID',
      statusCode: 400,
    });
  }
  const ids: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new AppError('ids must contain non-empty provider id strings', {
        code: 'IMPORT_IDS_INVALID',
        statusCode: 400,
      });
    }
    const id = value.trim();
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) {
    throw new AppError('ids must name at least one provider to import', {
      code: 'IMPORT_IDS_REQUIRED',
      statusCode: 400,
    });
  }
  return ids;
}

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

  /** The user-profile reader, or a visible 500 — never an empty import view. */
  const requireUserImports = (): (() => CodexUserProviderImportReading) => {
    const registry = requirePort();
    const reader = registry.readUserImports;
    if (reader === undefined) {
      throw new AppError('Codex user-profile import is not configured', {
        code: 'CODEX_MODEL_PROVIDER_IMPORT_UNAVAILABLE',
        statusCode: 500,
      });
    }
    return () => reader.call(registry);
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
    /** The operator's own Codex providers, read-only; secret VALUES are never part of it. */
    getCodexUserProviderImports(): CodexUserProviderImportReading {
      return requireUserImports()();
    },
    /**
     * Binds named user-profile providers into the PROJECT registry.
     *
     * EVERY row is validated before anything is written: an unknown id or a row the import view
     * marked `bindable=false` (a Codex built-in, a non-`responses` dialect) refuses the whole
     * request with a 400 that names the id and the reason, so a mixed request never half-lands.
     *
     * The merge starts from the current project reading — existing rows (and their `tokenFile`)
     * are preserved — then appends the imported rows; a same-id existing row is replaced. Only
     * the import's declared fields are copied: no secret is read, `tokenFile` stays empty (the
     * store resolves the default path), and the user's `~/.codex` is never a write target.
     *
     * Consumers: `settings.routes.ts`'s `POST .../import` and the AC-466 criterion.
     */
    async importCodexUserProviders(input: {
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
      const unknownFields = Object.keys(input.body).filter((field) => !IMPORT_FIELDS.includes(field));
      if (unknownFields.length > 0) {
        throw new AppError(`unknown field(s): ${unknownFields.join(', ')}`, {
          code: 'UNKNOWN_FIELD',
          statusCode: 400,
          details: { fields: unknownFields },
        });
      }
      const expectedVersion = readExpectedVersion(input.body, input.headerVersion);
      const ids = readImportIds(input.body.ids);
      const imports = requireUserImports()();

      const selected = ids.map((id) => {
        const row = imports.providers.find((candidate) => candidate.id === id);
        if (row === undefined) {
          throw new AppError(
            `No Codex provider "${id}" was found in ${imports.directory}; nothing was imported`,
            { code: 'CODEX_IMPORT_PROVIDER_UNKNOWN', statusCode: 400, details: { id } },
          );
        }
        if (!row.bindable) {
          throw new AppError(
            `Codex provider "${id}" cannot be imported: ${row.warnings.join('; ') || 'it is not bindable'}`,
            {
              code: 'CODEX_IMPORT_PROVIDER_NOT_BINDABLE',
              statusCode: 400,
              details: { id, warnings: row.warnings },
            },
          );
        }
        return row;
      });

      const importedIds = new Set(selected.map((row) => row.id));
      const current = registry.read();
      const merged = [
        ...current.providers
          .filter((provider) => !importedIds.has(provider.id))
          .map((provider) => ({
            id: provider.id,
            name: provider.name,
            baseUrl: provider.baseUrl,
            envKey: provider.envKey,
            tokenFile: provider.tokenFile,
            wireApi: provider.wireApi,
          })),
        ...selected.map((row) => ({
          id: row.id,
          name: row.name,
          baseUrl: row.baseUrl,
          envKey: row.envKey,
          // Empty means "the store's default path"; an import never names a secret file.
          tokenFile: '',
          wireApi: row.wireApi,
        })),
      ];
      return registry.write({ providers: merged, expectedVersion });
    },
  };
}
