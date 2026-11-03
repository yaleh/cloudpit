/**
 * The schema of the project-owned Codex provider registry: one provider entry as the settings
 * file states it, its field aliases, and the two readings of it — a tolerant one for a file an
 * operator may have hand-edited, and a strict one for a write that must be refused rather than
 * silently repaired.
 *
 * WHAT IS REFUSED, AND WHY. Codex 0.166 refuses to load a provider that asks for Chat
 * Completions (`wire_api = "chat"`), and the ids `openai`/`ollama`/`lmstudio` are its built-ins:
 * writing one would shadow a provider this project does not own, so both are write-time errors.
 * An empty `baseUrl` is not a provider at all. A field this schema does not know (for example
 * Codex's own `api`) is not a reason to drop the whole provider — it is reported as a warning so
 * the operator sees that the field had no effect.
 *
 * TWO SPELLINGS. The project file uses camelCase, but Codex's own config spells the same fields
 * `base_url` / `env_key` / `token_file` / `wire_api`. Both are accepted, and naming both with
 * different values is refused, so a hand-copied Codex block cannot silently mean something
 * different from what it says.
 *
 * Consumers: `codex-model-providers.settings.ts` (read, resolve, write) and its criterion.
 */
import { AppError, isRecord } from '@/shared/utils.js';

/** Ids Codex reserves for its built-in providers; a project file may not replace them. */
export const RESERVED_CODEX_PROVIDER_IDS: readonly string[] = ['openai', 'ollama', 'lmstudio'];

/** The one wire dialect this project accepts; Chat Completions is a Codex 0.166 load error. */
export const CODEX_PROVIDER_WIRE_API = 'responses' as const;

/**
 * The optional connection settings a provider entry may declare.
 *
 * These are Codex's own `[model_providers.<id>]` fields (0.166 reads every one
 * of them from `-c` overrides), plus the two context-window keys Codex keeps at
 * the top level of its config. The project file spells them camelCase and the
 * schema accepts Codex's snake_case spelling too, exactly like the core fields.
 *
 * `modelContextWindow` / `modelAutoCompactTokenLimit` are TOP-LEVEL Codex keys,
 * not members of the provider table; the entry carries them because a project
 * gateway usually serves one fixed window, and the compiler lifts them out of
 * the table when it builds the spawn/config overrides. A selected model entry's
 * own limits win over them (see `codex-provider-injection.ts`).
 */
export type CodexProviderAdvancedSettings = {
  httpHeaders?: Record<string, string>;
  envHttpHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  requestMaxRetries?: number;
  streamMaxRetries?: number;
  streamIdleTimeoutMs?: number;
  modelCatalogUrl?: string;
  modelContextWindow?: number;
  modelAutoCompactTokenLimit?: number;
};

/** One provider entry after validation: the value the runtime is handed. */
export type CodexModelProviderEntry = {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  tokenFile: string;
  wireApi: typeof CODEX_PROVIDER_WIRE_API;
} & CodexProviderAdvancedSettings;

/** What one entry parse produced: a valid entry or null, its warnings, and a write-only secret. */
export type ParsedCodexProvider = {
  /** Null when the entry is invalid; `warnings` carries every reason. */
  entry: CodexModelProviderEntry | null;
  warnings: string[];
  /** Present only when a write carried a `token`; it is persisted to the token file, never JSON. */
  token?: string;
};

/** Where the parse happens: the project file's directory and home for token path resolution. */
export type CodexProviderParseContext = {
  settingsPath: string;
  homeDir: string;
  /** True on a write (reject), false on a read (warn and skip the bad entry). */
  strict: boolean;
};

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A plain array (not a module-scope Set) keeps this file free of the architecture ratchet's
// module-level mutable-state reading; the list is immutable configuration.
const KNOWN_FIELDS: readonly string[] = [
  'id',
  'name',
  'baseUrl',
  'base_url',
  'envKey',
  'env_key',
  'tokenFile',
  'token_file',
  'wireApi',
  'wire_api',
  'token',
  // Advanced connection settings; Codex's snake_case spelling is the canonical
  // one on the wire, the camelCase one is the project file's spelling.
  'httpHeaders',
  'http_headers',
  'envHttpHeaders',
  'env_http_headers',
  'queryParams',
  'query_params',
  'requestMaxRetries',
  'request_max_retries',
  'streamMaxRetries',
  'stream_max_retries',
  'streamIdleTimeoutMs',
  'stream_idle_timeout_ms',
  'modelCatalogUrl',
  'model_catalog_url',
  'modelContextWindow',
  'model_context_window',
  'modelAutoCompactTokenLimit',
  'model_auto_compact_token_limit',
];

/** Reads a field that may be spelled camelCase or snake_case, refusing a disagreeing pair. */
function readAlias(record: Record<string, unknown>, camel: string, snake: string): unknown {
  const camelValue = record[camel];
  const snakeValue = record[snake];
  if (camelValue !== undefined && snakeValue !== undefined && camelValue !== snakeValue) {
    throw new AppError(`provider fields \`${camel}\` and \`${snake}\` disagree`, {
      code: 'CODEX_PROVIDER_ALIAS_CONFLICT',
      statusCode: 400,
    });
  }
  return camelValue !== undefined ? camelValue : snakeValue;
}

function readStringField(value: unknown, fieldName: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new AppError(`${fieldName} must be a string`, {
      code: 'CODEX_PROVIDER_INVALID_FIELD',
      statusCode: 400,
    });
  }
  return value.trim();
}

/** A default env var name so a provider never launches without a place to put its secret. */
function defaultEnvKey(providerId: string): string {
  return `CODEX_${providerId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}_API_KEY`;
}

/** Reads an alias pair whose values may be objects: a disagreement is still refused. */
function readAliasDeep(record: Record<string, unknown>, camel: string, snake: string): unknown {
  const camelValue = record[camel];
  const snakeValue = record[snake];
  if (
    camelValue !== undefined
    && snakeValue !== undefined
    && JSON.stringify(camelValue) !== JSON.stringify(snakeValue)
  ) {
    throw new AppError(`provider fields \`${camel}\` and \`${snake}\` disagree`, {
      code: 'CODEX_PROVIDER_ALIAS_CONFLICT',
      statusCode: 400,
    });
  }
  return camelValue !== undefined ? camelValue : snakeValue;
}

/**
 * Reads an optional string→string map (`http_headers`, `query_params`, ...).
 *
 * Every key must be non-empty and every value a string: Codex deserialises
 * these as `HashMap<String, …>`, so a non-string value would fail the whole
 * provider load rather than that one header. `envNames` additionally requires
 * each VALUE to be a usable environment-variable name, because
 * `env_http_headers` maps a header to the variable that carries its value.
 */
function readStringMap(
  value: unknown,
  fieldName: string,
  options: { envNames?: boolean } = {},
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    throw new AppError(`${fieldName} must be a JSON object of string values`, {
      code: 'CODEX_PROVIDER_INVALID_FIELD',
      statusCode: 400,
    });
  }
  const entries: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key.trim() === '') {
      throw new AppError(`${fieldName} must not carry an empty key`, {
        code: 'CODEX_PROVIDER_INVALID_FIELD',
        statusCode: 400,
      });
    }
    if (typeof raw !== 'string') {
      throw new AppError(`${fieldName}.${key} must be a string`, {
        code: 'CODEX_PROVIDER_INVALID_FIELD',
        statusCode: 400,
      });
    }
    if (options.envNames === true) {
      if (!ENV_KEY_PATTERN.test(raw.trim())) {
        throw new AppError(`${fieldName}.${key} must name an environment variable`, {
          code: 'CODEX_PROVIDER_INVALID_FIELD',
          statusCode: 400,
        });
      }
      entries[key] = raw.trim();
      continue;
    }
    entries[key] = raw;
  }
  return entries;
}

/** Reads an optional integer with a lower bound (retries may be 0, windows may not). */
function readInteger(value: unknown, fieldName: string, minimum: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new AppError(`${fieldName} must be an integer >= ${minimum}`, {
      code: 'CODEX_PROVIDER_INVALID_FIELD',
      statusCode: 400,
    });
  }
  return value;
}

/** Reads an optional absolute http(s) URL (`model_catalog_url`). */
function readHttpUrl(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new AppError(`${fieldName} must be a string`, {
      code: 'CODEX_PROVIDER_INVALID_FIELD',
      statusCode: 400,
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new AppError(`${fieldName} "${value}" is not an absolute URL`, {
      code: 'CODEX_PROVIDER_INVALID_FIELD',
      statusCode: 400,
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError(`${fieldName} must use http or https; got "${parsed.protocol}"`, {
      code: 'CODEX_PROVIDER_INVALID_FIELD',
      statusCode: 400,
    });
  }
  return value.trim();
}

/**
 * Parses one registry entry. In strict mode every defect is an `AppError`; in tolerant mode a
 * defect is a warning and `null`, so one hand-edited provider cannot hide the rest.
 *
 * `fallbackId` is the registry key (file shape) or null (the write path carries `id`).
 *
 * Consumers: `codex-model-providers.settings.ts`.
 */
export function parseCodexProviderEntry(
  raw: unknown,
  fallbackId: string | null,
  context: CodexProviderParseContext,
): ParsedCodexProvider {
  const warnings: string[] = [];
  const reject = (code: string, message: string): ParsedCodexProvider => {
    if (context.strict) {
      throw new AppError(message, { code, statusCode: 400 });
    }
    warnings.push(message);
    return { entry: null, warnings };
  };

  if (!isRecord(raw)) {
    return reject('CODEX_PROVIDER_INVALID_ENTRY', 'a provider entry must be a JSON object');
  }

  let id: string;
  try {
    const rawId = readStringField(raw.id, 'id') ?? '';
    if (fallbackId !== null && rawId !== '' && rawId !== fallbackId) {
      return reject(
        'CODEX_PROVIDER_ID_MISMATCH',
        `provider key "${fallbackId}" and its \`id\` "${rawId}" disagree`,
      );
    }
    id = fallbackId ?? rawId;
  } catch (failure) {
    if (context.strict) throw failure;
    warnings.push((failure as Error).message);
    return { entry: null, warnings };
  }

  if (!PROVIDER_ID_PATTERN.test(id)) {
    return reject(
      'CODEX_PROVIDER_ID_INVALID',
      `provider id ${id === '' ? '(empty)' : `"${id}"`} must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`,
    );
  }
  if (RESERVED_CODEX_PROVIDER_IDS.includes(id.toLowerCase())) {
    return reject(
      'CODEX_PROVIDER_ID_RESERVED',
      `provider id "${id}" is reserved by Codex (${RESERVED_CODEX_PROVIDER_IDS.join(', ')}); choose another id`,
    );
  }

  for (const field of Object.keys(raw)) {
    if (!KNOWN_FIELDS.includes(field)) {
      warnings.push(`provider "${id}" has unknown field \`${field}\`; it is ignored`);
    }
  }
  if (context.strict && raw.token !== undefined && typeof raw.token !== 'string') {
    return reject('CODEX_PROVIDER_TOKEN_INVALID', `provider "${id}" token must be a string`);
  }
  if (!context.strict && raw.token !== undefined) {
    // A secret written into the project document would defeat the tokenFile contract; the value
    // is never read from here, and the warning keeps the leak visible.
    warnings.push(
      `provider "${id}" stores a \`token\` field; secrets belong in its tokenFile, so this value is ignored`,
    );
  }

  let baseUrl: string;
  let envKey: string;
  let tokenFile: string;
  let wireApi: unknown;
  let name: string;
  try {
    baseUrl = readStringField(readAlias(raw, 'baseUrl', 'base_url'), 'baseUrl') ?? '';
    envKey = readStringField(readAlias(raw, 'envKey', 'env_key'), 'envKey') ?? defaultEnvKey(id);
    tokenFile = readStringField(readAlias(raw, 'tokenFile', 'token_file'), 'tokenFile') ?? '';
    wireApi = readAlias(raw, 'wireApi', 'wire_api');
    name = readStringField(raw.name, 'name') ?? id;
  } catch (failure) {
    if (context.strict) throw failure;
    warnings.push((failure as Error).message);
    return { entry: null, warnings };
  }

  if (baseUrl === '') {
    return reject('CODEX_PROVIDER_BASE_URL_REQUIRED', `provider "${id}" baseUrl is required`);
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    return reject(
      'CODEX_PROVIDER_BASE_URL_INVALID',
      `provider "${id}" baseUrl "${baseUrl}" is not an absolute URL`,
    );
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return reject(
      'CODEX_PROVIDER_BASE_URL_INVALID',
      `provider "${id}" baseUrl must use http or https; got "${parsedUrl.protocol}"`,
    );
  }
  if (!ENV_KEY_PATTERN.test(envKey)) {
    return reject(
      'CODEX_PROVIDER_ENV_KEY_INVALID',
      `provider "${id}" envKey "${envKey}" is not a valid environment variable name`,
    );
  }
  if (wireApi !== undefined && wireApi !== CODEX_PROVIDER_WIRE_API) {
    return reject(
      'CODEX_PROVIDER_WIRE_API_UNSUPPORTED',
      `provider "${id}" wire_api must be "${CODEX_PROVIDER_WIRE_API}" (Chat Completions is not supported); got ${JSON.stringify(wireApi)}`,
    );
  }

  // Advanced settings are optional and independent of the core fields, so in
  // tolerant mode one bad optional value is a warning that drops that field
  // instead of hiding a provider whose endpoint is perfectly usable.
  const advanced: CodexProviderAdvancedSettings = {};
  const readAdvanced = (name: string, read: () => void): void => {
    try {
      read();
    } catch (failure) {
      if (context.strict) throw failure;
      warnings.push((failure as Error).message);
    }
  };
  readAdvanced('http_headers', () => {
    const parsed = readStringMap(readAliasDeep(raw, 'httpHeaders', 'http_headers'), `provider "${id}" httpHeaders`);
    if (parsed !== undefined) advanced.httpHeaders = parsed;
  });
  readAdvanced('env_http_headers', () => {
    const parsed = readStringMap(
      readAliasDeep(raw, 'envHttpHeaders', 'env_http_headers'),
      `provider "${id}" envHttpHeaders`,
      { envNames: true },
    );
    if (parsed !== undefined) advanced.envHttpHeaders = parsed;
  });
  readAdvanced('query_params', () => {
    const parsed = readStringMap(readAliasDeep(raw, 'queryParams', 'query_params'), `provider "${id}" queryParams`);
    if (parsed !== undefined) advanced.queryParams = parsed;
  });
  readAdvanced('request_max_retries', () => {
    const parsed = readInteger(
      readAliasDeep(raw, 'requestMaxRetries', 'request_max_retries'),
      `provider "${id}" requestMaxRetries`,
      0,
    );
    if (parsed !== undefined) advanced.requestMaxRetries = parsed;
  });
  readAdvanced('stream_max_retries', () => {
    const parsed = readInteger(
      readAliasDeep(raw, 'streamMaxRetries', 'stream_max_retries'),
      `provider "${id}" streamMaxRetries`,
      0,
    );
    if (parsed !== undefined) advanced.streamMaxRetries = parsed;
  });
  readAdvanced('stream_idle_timeout_ms', () => {
    const parsed = readInteger(
      readAliasDeep(raw, 'streamIdleTimeoutMs', 'stream_idle_timeout_ms'),
      `provider "${id}" streamIdleTimeoutMs`,
      1,
    );
    if (parsed !== undefined) advanced.streamIdleTimeoutMs = parsed;
  });
  readAdvanced('model_catalog_url', () => {
    const parsed = readHttpUrl(
      readAliasDeep(raw, 'modelCatalogUrl', 'model_catalog_url'),
      `provider "${id}" modelCatalogUrl`,
    );
    if (parsed !== undefined) advanced.modelCatalogUrl = parsed;
  });
  readAdvanced('model_context_window', () => {
    const parsed = readInteger(
      readAliasDeep(raw, 'modelContextWindow', 'model_context_window'),
      `provider "${id}" modelContextWindow`,
      1,
    );
    if (parsed !== undefined) advanced.modelContextWindow = parsed;
  });
  readAdvanced('model_auto_compact_token_limit', () => {
    const parsed = readInteger(
      readAliasDeep(raw, 'modelAutoCompactTokenLimit', 'model_auto_compact_token_limit'),
      `provider "${id}" modelAutoCompactTokenLimit`,
      1,
    );
    if (parsed !== undefined) advanced.modelAutoCompactTokenLimit = parsed;
  });

  if (context.strict && raw.token !== undefined && raw.token === '') {
    warnings.push(`provider "${id}" sent an empty token; the existing secret is left unchanged`);
  }

  const token = typeof raw.token === 'string' && raw.token !== '' ? raw.token : undefined;
  return {
    entry: { id, name, baseUrl, envKey, tokenFile, wireApi: CODEX_PROVIDER_WIRE_API, ...advanced },
    warnings,
    ...(token === undefined ? {} : { token }),
  };
}
