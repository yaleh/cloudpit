/**
 * The project-owned Codex provider registry: what `codex.settings.json` says, what the
 * settings API returns, and what a spawn-time lookup resolves.
 *
 * WHY A PROJECT FILE. A Codex process today reads only the operator's `~/.codex/config.toml`,
 * so changing an upstream endpoint means editing a file every instance shares. This module
 * makes the registry a first-class project setting: the file is the only write target, a
 * version hash guards concurrent editors, and the runtime reads it AT SPAWN TIME (not once at
 * boot) so an edit reaches the next launch.
 *
 * THE SECRET IS NEVER IN THE DOCUMENT. A provider names a `tokenFile`; the file is read when a
 * provider is resolved and its value is handed to the caller in memory. `read()` reports only
 * `tokenSet`, and the file's contents never reach a response, a log line or argv.
 *
 * WHAT A CALLER GETS. `read()` is the wire reading (`CodexModelProvidersReading`); `resolve(id)`
 * is the spawn-time lookup, which either yields the resolved entry plus its secret or a
 * readable problem. Resolution NEVER falls back to Codex's `openai` provider: a missing or
 * unusable project provider is an error the caller must report, because silently dialling the
 * default endpoint is the exact failure this registry exists to prevent.
 *
 * Consumers: `settings.module.ts` (the production source), `settings.service.ts` (through the
 * port), and the resident/per-run Codex injection tasks (spawn-time `resolve`).
 *
 * USER PROFILE IMPORT. {@link readCodexUserProviderImports} performs the one other read this
 * module owns: it lists the `[model_providers.*]` blocks of the operator's own
 * `~/.codex` TOML files so the settings page can offer them as bindings. That read is
 * deliberately one-way — it never reads an `env_key` VALUE or a token, and it never writes to
 * the user's files. The project settings file stays the only write target.
 */
import { readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import type { CodexModelProvider, CodexModelProvidersReading } from '@/shared/types.js';
import { AppError, errorMessage, isRecord } from '@/shared/utils.js';

import {
  CODEX_PROVIDER_WIRE_API,
  parseCodexProviderEntry,
  type CodexModelProviderEntry,
} from './codex-model-providers.schema.js';
import {
  readCodexSettingsDocument,
  readCodexTokenSecret,
  resolveCodexSettingsFileTarget,
  resolveCodexTokenFilePath,
  tokenFileModeWarning,
  writeCodexSettingsDocument,
  writeCodexTokenSecret,
} from './codex-model-providers.store.js';

/** One provider resolved for a launch: the entry plus the secret read from its token file. */
export type ResolvedCodexModelProvider = CodexModelProviderEntry & { secret: string };

/** The outcome of a spawn-time lookup; a false `ok` always carries a reportable line. */
export type CodexModelProviderResolution =
  | { ok: true; provider: ResolvedCodexModelProvider }
  | { ok: false; problem: string };

/** One write: the full replacement registry and the version the caller edited. */
export type CodexModelProvidersWriteInput = {
  providers: unknown;
  expectedVersion: string;
};

/** The source a composition root and a criterion both drive. */
export type CodexModelProvidersSource = {
  read(): CodexModelProvidersReading;
  resolve(id: string): CodexModelProviderResolution;
  write(input: CodexModelProvidersWriteInput): Promise<CodexModelProvidersReading>;
};

/** Turns validated entries into the wire reading, reading each token file only for `tokenSet`. */
function projectProviders(
  filePath: string,
  homeDir: string,
  entries: Array<{ entry: CodexModelProviderEntry; warnings: string[] }>,
): CodexModelProvider[] {
  return entries
    .map(({ entry, warnings }) => {
      const tokenFile = resolveCodexTokenFilePath(filePath, entry.id, entry.tokenFile, homeDir);
      const secret = readCodexTokenSecret(tokenFile);
      const providerWarnings = [...warnings];
      if (secret.ok) {
        const modeWarning = tokenFileModeWarning(tokenFile);
        if (modeWarning !== null) providerWarnings.push(modeWarning);
      } else {
        providerWarnings.push(secret.problem);
      }
      return {
        id: entry.id,
        name: entry.name,
        baseUrl: entry.baseUrl,
        envKey: entry.envKey,
        tokenFile,
        wireApi: entry.wireApi,
        tokenSet: secret.ok,
        warnings: providerWarnings,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Reads the `modelProviders` block tolerantly: one bad entry is skipped and reported. */
function readProviderRegistry(
  document: Record<string, unknown>,
  filePath: string,
  homeDir: string,
): { providers: CodexModelProvider[]; warnings: string[] } {
  const block = document.modelProviders;
  if (block === undefined) {
    return { providers: [], warnings: [] };
  }
  if (!isRecord(block)) {
    throw new AppError('`modelProviders` must be a JSON object; refusing to read it as a registry', {
      code: 'CODEX_SETTINGS_INVALID_SHAPE',
      statusCode: 500,
    });
  }
  const warnings: string[] = [];
  const entries: Array<{ entry: CodexModelProviderEntry; warnings: string[] }> = [];
  for (const [key, raw] of Object.entries(block)) {
    const parsed = parseCodexProviderEntry(raw, key, { settingsPath: filePath, homeDir, strict: false });
    if (parsed.entry === null) {
      // A skipped entry's reasons belong at the document level: there is no provider row left
      // to carry them.
      warnings.push(...parsed.warnings);
    } else {
      entries.push({ entry: parsed.entry, warnings: parsed.warnings });
    }
  }
  return { providers: projectProviders(filePath, homeDir, entries), warnings };
}

/** The environment entry Codex itself honours for the directory holding `config.toml`. */
export const CODEX_HOME_ENV = 'CODEX_HOME';

/** One `[model_providers.<id>]` block read from the user's own Codex TOML files. */
export type CodexUserProviderImport = {
  id: string;
  name: string;
  baseUrl: string;
  envKey: string;
  /**
   * The declared dialect, or `responses` when the block omits it. This project only ever writes
   * `responses`, so a block that declares another dialect is listed but not bindable.
   */
  wireApi: string;
  /** The user file the block came from; the import view names it so the origin is never lost. */
  source: string;
  /** True when the block can be selected as a model entry's `codexProviderId` unchanged. */
  bindable: boolean;
  /** Unknown fields (Codex's own `api`), and every reason the block cannot be bound. */
  warnings: string[];
};

/**
 * The user-profile import view: the Codex home inspected, the files actually read, every
 * provider block, and file-level problems (an unreadable or malformed file) that belong to no
 * single provider.
 */
export type CodexUserProviderImportReading = {
  directory: string;
  files: string[];
  providers: CodexUserProviderImport[];
  warnings: string[];
};

/** The user TOML files the import reads, in a stable order: `config.toml` first, then profiles. */
function userCodexConfigFiles(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (failure) {
    const code = (failure as NodeJS.ErrnoException | null)?.code;
    // A machine without ~/.codex is the ordinary "nothing to import" state.
    if (code === 'ENOENT') return [];
    throw new AppError(`could not list ${directory}: ${errorMessage(failure)}`, {
      code: 'CODEX_USER_CONFIG_READ_FAILED',
      statusCode: 500,
    });
  }
  const names = entries
    .filter((entry) => entry === 'config.toml' || entry.endsWith('.config.toml'))
    .sort((left, right) => {
      if (left === 'config.toml') return -1;
      if (right === 'config.toml') return 1;
      return left.localeCompare(right);
    });
  return names.map((name) => path.join(directory, name));
}

/** Reads a TOML string field for the import VIEW; a non-string value is left to the parser's warning. */
function displayField(block: Record<string, unknown>, key: string): string {
  const value = block[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** Turns one user block into an import row, reusing the project schema for every verdict. */
function readUserProviderImport(
  id: string,
  raw: unknown,
  source: string,
  homeDir: string,
): CodexUserProviderImport {
  if (!isRecord(raw)) {
    return {
      id,
      name: id,
      baseUrl: '',
      envKey: '',
      wireApi: CODEX_PROVIDER_WIRE_API,
      source,
      bindable: false,
      warnings: [`provider "${id}" in ${source} is not a TOML table; it cannot be imported`],
    };
  }

  // The project parser owns the verdict: reserved ids, an absolute http(s) base_url, a valid
  // env_key, a supported wire_api, and the unknown-field warning (Codex's own `api`). A
  // tolerant parse keeps a bad block visible instead of dropping it from the import view.
  const parsed = parseCodexProviderEntry(raw, id, { settingsPath: source, homeDir, strict: false });
  const warnings = [...parsed.warnings];
  const declaredEnvKey = displayField(raw, 'env_key');
  if (declaredEnvKey === '' && parsed.entry !== null) {
    warnings.push(
      `provider "${id}" in ${source} declares no env_key; importing it would use ${parsed.entry.envKey}`,
    );
  }

  return {
    id,
    name: displayField(raw, 'name') || id,
    baseUrl: displayField(raw, 'base_url'),
    envKey: declaredEnvKey || parsed.entry?.envKey || '',
    wireApi: displayField(raw, 'wire_api') || parsed.entry?.wireApi || CODEX_PROVIDER_WIRE_API,
    source,
    bindable: parsed.entry !== null,
    warnings,
  };
}

/**
 * Lists the `[model_providers.*]` blocks of the operator's own Codex TOML files
 * (`$CODEX_HOME`, else `<home>/.codex`; `config.toml` plus every `<name>.config.toml`).
 *
 * READ-ONLY BY CONSTRUCTION. This function only opens the TOML files for reading. It never
 * reads an `env_key`'s value, a token file, or `auth.json`, and it has no write path at all:
 * binding an imported provider goes into the PROJECT settings file, never back into `~/.codex`.
 *
 * Consumers: the settings import endpoint and its criterion. Kept as a free function over
 * injectable `homeDir`/`env` so a criterion can own a temp Codex home instead of the host's.
 */
export function readCodexUserProviderImports(
  options: {
    homeDir?: string | undefined;
    env?: Record<string, string | undefined>;
  } = {},
): CodexUserProviderImportReading {
  const homeDir = options.homeDir ?? os.homedir();
  const env = options.env ?? process.env;
  const configured = env[CODEX_HOME_ENV];
  const directory = configured !== undefined && configured.trim() !== ''
    ? configured.trim()
    : path.join(homeDir, '.codex');

  const files: string[] = [];
  const providers: CodexUserProviderImport[] = [];
  const warnings: string[] = [];

  for (const file of userCodexConfigFiles(directory)) {
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (failure) {
      // A file that vanished between the listing and the read is simply not imported; any
      // other failure is a visible warning, never a silently empty import view.
      if ((failure as NodeJS.ErrnoException | null)?.code !== 'ENOENT') {
        warnings.push(`could not read ${file}: ${errorMessage(failure)}`);
      }
      continue;
    }
    files.push(file);

    let parsed: unknown;
    try {
      parsed = TOML.parse(text);
    } catch (failure) {
      warnings.push(`${file} is not valid TOML: ${errorMessage(failure)}`);
      continue;
    }
    if (!isRecord(parsed)) {
      warnings.push(`${file} did not parse to a TOML table`);
      continue;
    }
    const block = parsed.model_providers;
    if (block === undefined) continue;
    if (!isRecord(block)) {
      warnings.push(`${file}: model_providers must be a TOML table`);
      continue;
    }
    for (const [id, raw] of Object.entries(block)) {
      providers.push(readUserProviderImport(id, raw, file, homeDir));
    }
  }

  return { directory, files, providers, warnings };
}

/**
 * Creates the registry source over the project file. Reads are uncached and re-read the file,
 * because a spawn-time lookup must see an edit the settings API just wrote; writes are
 * serialised in this instance's closure so a read-check-replace cannot interleave.
 *
 * Options exist for criteria (a temp file) and for the composition root (HOME and env), never
 * for a caller to bypass the file.
 */
export function createCodexModelProvidersSource(
  options: {
    settingsPath?: string | null;
    env?: Record<string, string | undefined>;
    homeDir?: string | undefined;
  } = {},
): CodexModelProvidersSource {
  const homeDir = options.homeDir ?? os.homedir();
  const target = resolveCodexSettingsFileTarget({
    settingsPath: options.settingsPath,
    env: options.env ?? process.env,
    homeDir,
  });
  const filePath = target.path;

  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation, operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  };

  const read = (): CodexModelProvidersReading => {
    const raw = readCodexSettingsDocument(filePath);
    const registry = readProviderRegistry(raw.document, filePath, homeDir);
    return { path: filePath, version: raw.version, ...registry };
  };

  return {
    read,
    resolve(id: string): CodexModelProviderResolution {
      try {
        const raw = readCodexSettingsDocument(filePath);
        const block = raw.document.modelProviders;
        const rawEntry = isRecord(block) ? block[id] : undefined;
        if (rawEntry === undefined) {
          return { ok: false, problem: `Codex provider "${id}" is not configured in ${filePath}` };
        }
        const parsed = parseCodexProviderEntry(rawEntry, id, {
          settingsPath: filePath,
          homeDir,
          strict: true,
        });
        if (parsed.entry === null) {
          return { ok: false, problem: `Codex provider "${id}" is invalid: ${parsed.warnings.join('; ')}` };
        }
        const tokenFile = resolveCodexTokenFilePath(
          filePath,
          parsed.entry.id,
          parsed.entry.tokenFile,
          homeDir,
        );
        const secret = readCodexTokenSecret(tokenFile);
        if (!secret.ok) {
          return {
            ok: false,
            problem: `Codex provider "${id}" has no usable secret: ${secret.problem}`,
          };
        }
        return { ok: true, provider: { ...parsed.entry, secret: secret.secret } };
      } catch (failure) {
        return { ok: false, problem: errorMessage(failure) };
      }
    },
    write(input: CodexModelProvidersWriteInput): Promise<CodexModelProvidersReading> {
      return serial(async () => {
        if (!Array.isArray(input.providers)) {
          throw new AppError('providers must be an array', {
            code: 'CODEX_PROVIDER_LIST_INVALID',
            statusCode: 400,
          });
        }
        const byId: Record<string, Record<string, unknown>> = {};
        const writeWarnings = new Map<string, string[]>();
        const secrets = new Map<string, { tokenFile: string; secret: string }>();
        for (const raw of input.providers) {
          const parsed = parseCodexProviderEntry(raw, null, {
            settingsPath: filePath,
            homeDir,
            strict: true,
          });
          if (parsed.entry === null) continue;
          if (parsed.warnings.length > 0) writeWarnings.set(parsed.entry.id, parsed.warnings);
          if (byId[parsed.entry.id] !== undefined) {
            throw new AppError(`provider id "${parsed.entry.id}" appears more than once`, {
              code: 'CODEX_PROVIDER_ID_DUPLICATE',
              statusCode: 400,
            });
          }
          byId[parsed.entry.id] = {
            name: parsed.entry.name,
            baseUrl: parsed.entry.baseUrl,
            envKey: parsed.entry.envKey,
            tokenFile: parsed.entry.tokenFile,
            wireApi: parsed.entry.wireApi,
          };
          if (parsed.token !== undefined) {
            secrets.set(parsed.entry.id, {
              tokenFile: resolveCodexTokenFilePath(
                filePath,
                parsed.entry.id,
                parsed.entry.tokenFile,
                homeDir,
              ),
              secret: parsed.token,
            });
          }
        }

        // Read once for the value-preserving merge and to fail a stale editor BEFORE any
        // token file is rewritten; the writer below re-checks while it replaces the document.
        const current = readCodexSettingsDocument(filePath);
        if (
          current.document.modelProviders !== undefined
          && !isRecord(current.document.modelProviders)
        ) {
          throw new AppError('`modelProviders` is not a JSON object; refusing to overwrite it.', {
            code: 'CODEX_SETTINGS_INVALID_SHAPE',
            statusCode: 500,
          });
        }
        if (current.version !== input.expectedVersion) {
          throw new AppError('The Codex provider settings changed since they were read; reload and save again.', {
            code: 'VERSION_CONFLICT',
            statusCode: 409,
            details: { expectedVersion: input.expectedVersion, currentVersion: current.version },
          });
        }

        for (const { tokenFile, secret } of secrets.values()) {
          writeCodexTokenSecret(tokenFile, secret);
        }
        writeCodexSettingsDocument(filePath, { ...current.document, modelProviders: byId }, {
          expectedVersion: input.expectedVersion,
          versionPath: filePath,
        });
        const reading = read();
        // The unknown-field warning belongs to THIS write: the field is intentionally not
        // persisted, so a re-read alone could not report it.
        return {
          ...reading,
          providers: reading.providers.map((provider) => {
            const wrote = writeWarnings.get(provider.id);
            return wrote === undefined
              ? provider
              : { ...provider, warnings: [...new Set([...provider.warnings, ...wrote])] };
          }),
        };
      });
    },
  };
}
