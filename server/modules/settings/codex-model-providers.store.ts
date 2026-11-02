/**
 * Filesystem I/O for the project-owned Codex provider settings file and its per-provider
 * secret files.
 *
 * WHY A FILE OF ITS OWN. `codex.settings.json` is the project's one writable surface for
 * upstream Codex providers. The schema and validation live in
 * `codex-model-providers.settings.ts`; this sibling owns only the bytes: resolving the
 * path, hashing the content version a concurrent editor must send back, the atomic replace,
 * and the `600` token files. Splitting the concern keeps both files under the module
 * standard's line ceiling and lets a criterion drive the file layer without a route.
 *
 * THE PROJECT FILE IS THE ONLY WRITE TARGET. A user `~/.codex/config.toml` is never written:
 * it is read-only compatibility, and an import binds into this project file instead.
 *
 * SECRETS NEVER ENTER THE JSON. `tokenFile` is a path. `readTokenSecret` is the only reader
 * and its value is handed to a caller in memory; `writeTokenSecret` exists so the settings
 * API can accept a secret without persisting it in the document. Every write here creates the
 * file (or replaces it) with mode `600`.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  expandHome,
  resolveSettingsPath,
  writeSettingsFileAtomically,
} from '@/shared/settings-file.js';
import { AppError, errorMessage, isRecord } from '@/shared/utils.js';

/** The only environment entry: it names the project Codex settings file. */
export const CODEX_SETTINGS_PATH_ENV = 'CODEX_SETTINGS_PATH';

/** The deployment's default location; a development checkout points the env entry at `config/`. */
export function defaultCodexSettingsPath(homeDir: string): string {
  return path.join(homeDir, '.config', 'cloudpit', 'codex.settings.json');
}

/** The file this process reads and writes. `explicit` is true when an operator named it. */
export type CodexSettingsFileTarget = {
  path: string;
  explicit: boolean;
};

/**
 * Resolves the Codex settings file: an explicit path, then `CODEX_SETTINGS_PATH`, then the
 * shipped location. Consumers: the settings module (the production source) and the criterion.
 */
export function resolveCodexSettingsFileTarget(
  options: {
    settingsPath?: string | null;
    env?: Record<string, string | undefined>;
    homeDir?: string | undefined;
  } = {},
): CodexSettingsFileTarget {
  const homeDir = options.homeDir ?? os.homedir();
  const { filePath, explicit } = resolveSettingsPath({
    settingsPath: options.settingsPath,
    env: options.env ?? process.env,
    envVar: CODEX_SETTINGS_PATH_ENV,
    homeDir,
    defaultPath: defaultCodexSettingsPath,
  });
  return { path: filePath ?? defaultCodexSettingsPath(homeDir), explicit };
}

/** The version reported for a file that does not exist yet (a first write creates it). */
export const MISSING_CODEX_SETTINGS_VERSION = 'missing';

/** One raw read: the parsed document, its content hash, and whether the file was present. */
export type CodexSettingsDocumentReading = {
  document: Record<string, unknown>;
  version: string;
  exists: boolean;
};

/** A content hash, so a stale editor can be told the file moved under it. */
function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Reads the project file. A missing file is the ordinary "no providers yet" state; an
 * unreadable or malformed one is a visible error, never silently treated as empty.
 *
 * Consumers: `codex-model-providers.settings.ts` (read, resolve and the version check).
 */
export function readCodexSettingsDocument(filePath: string): CodexSettingsDocumentReading {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return { document: {}, version: MISSING_CODEX_SETTINGS_VERSION, exists: false };
    }
    throw new AppError(`could not read ${filePath}: ${errorMessage(failure)}`, {
      code: 'CODEX_SETTINGS_READ_FAILED',
      statusCode: 500,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (failure) {
    throw new AppError(`${filePath} is not valid JSON: ${errorMessage(failure)}`, {
      code: 'CODEX_SETTINGS_INVALID_JSON',
      statusCode: 500,
    });
  }
  if (!isRecord(parsed)) {
    throw new AppError(`${filePath} must contain a JSON object`, {
      code: 'CODEX_SETTINGS_INVALID_JSON',
      statusCode: 500,
    });
  }
  return { document: parsed, version: versionOf(text), exists: true };
}

/**
 * Replaces the project file with `document` after proving the caller edited the version it
 * read. The replace is atomic and always mode `600`, even when the previous file was wider,
 * because this document describes credentials (paths and env names) and the task's contract
 * is a 0600 project file.
 *
 * Consumers: `codex-model-providers.settings.ts`'s write path.
 */
export function writeCodexSettingsDocument(
  filePath: string,
  document: Record<string, unknown>,
  options: { expectedVersion: string; versionPath?: string | undefined },
): { version: string } {
  const sourcePath = options.versionPath ?? filePath;
  const current = readCodexSettingsDocument(sourcePath);
  if (current.version !== options.expectedVersion) {
    throw new AppError('The Codex provider settings changed since they were read; reload and save again.', {
      code: 'VERSION_CONFLICT',
      statusCode: 409,
      details: { expectedVersion: options.expectedVersion, currentVersion: current.version },
    });
  }

  const serialized = `${JSON.stringify(document, null, 2)}\n`;
  try {
    writeSettingsFileAtomically(filePath, serialized, { mode: 0o600 });
  } catch (failure) {
    throw new AppError(`could not write ${filePath}: ${errorMessage(failure)}`, {
      code: 'CODEX_SETTINGS_WRITE_FAILED',
      statusCode: 500,
    });
  }
  return { version: versionOf(serialized) };
}

/**
 * Resolves a provider's secret path. An operator-written `tokenFile` wins (a leading `~` is
 * expanded and a relative path is resolved against the settings file's directory); otherwise
 * every provider gets its own file under `<settings dir>/codex.secrets/<id>.token`.
 *
 * Consumers: `codex-model-providers.settings.ts`'s read/resolve/write paths.
 */
export function resolveCodexTokenFilePath(
  settingsPath: string,
  providerId: string,
  rawTokenFile: string,
  homeDir: string,
): string {
  const trimmed = rawTokenFile.trim();
  if (trimmed !== '') {
    const expanded = expandHome(trimmed, homeDir);
    return path.isAbsolute(expanded)
      ? expanded
      : path.resolve(path.dirname(settingsPath), expanded);
  }
  return path.join(path.dirname(settingsPath), 'codex.secrets', `${providerId}.token`);
}

/** What one secret-file read observed: the value, or a line naming why it is unusable. */
export type CodexTokenSecretReading =
  | { ok: true; secret: string }
  | { ok: false; problem: string };

/**
 * Reads one `600` token file. A missing or empty file is a readable "no secret" answer, not a
 * throw: the runtime must be able to say why a provider cannot launch. The value never
 * appears in the returned text.
 *
 * Consumers: `codex-model-providers.settings.ts`'s `read`/`resolve`.
 */
export function readCodexTokenSecret(tokenFile: string): CodexTokenSecretReading {
  let secret: string;
  try {
    secret = readFileSync(tokenFile, 'utf8').trim();
  } catch (failure) {
    const code = (failure as NodeJS.ErrnoException | null)?.code;
    return {
      ok: false,
      problem: code === 'ENOENT'
        ? `token file ${tokenFile} is missing`
        : `could not read token file ${tokenFile}: ${errorMessage(failure)}`,
    };
  }
  if (secret === '') {
    return { ok: false, problem: `token file ${tokenFile} is empty` };
  }
  return { ok: true, secret };
}

/**
 * Writes a secret into its token file, atomically and mode `600`. Used only when the settings
 * API is handed a write-only `token`; the value is never placed in the project document.
 *
 * Consumers: `codex-model-providers.settings.ts`'s write path.
 */
export function writeCodexTokenSecret(tokenFile: string, secret: string): void {
  try {
    writeSettingsFileAtomically(tokenFile, secret, { mode: 0o600 });
  } catch (failure) {
    throw new AppError(`could not write token file ${tokenFile}: ${errorMessage(failure)}`, {
      code: 'CODEX_TOKEN_WRITE_FAILED',
      statusCode: 500,
    });
  }
}

/**
 * Reports (never throws) whether a token file is wider than `600`. The runtime tolerates a
 * wide file — refusing it would turn a permissions typo into a dead provider — but the reading
 * names the problem so an operator can fix it.
 *
 * Consumers: `codex-model-providers.settings.ts` (per-provider warnings).
 */
export function tokenFileModeWarning(tokenFile: string): string | null {
  try {
    const mode = statSync(tokenFile).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      return `token file ${tokenFile} has mode ${mode.toString(8)}; 600 is expected because it holds a secret`;
    }
  } catch {
    // The read path already reports a missing file with its own, more useful message.
  }
  return null;
}
