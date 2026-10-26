/**
 * The one reader for the server's JSON settings files.
 *
 * WHY THIS FILE EXISTS. Four modules carried their own copy of the same "read one
 * block out of a JSON settings file" machinery — `~` expansion, the typed field
 * readers, the API-key file grammar and the mtime-cached source. The copies had
 * started to drift, so the mechanics live here once and each module keeps only
 * its block's schema (the `parse` callback) and its public types.
 *
 * ONE FILE AT A TIME. `createSettingsBlockSource` is deliberately parameterised by
 * the path instead of assuming `server.settings.json`: three modules read blocks
 * out of the deployment settings file (`cockpit.counterVoice`,
 * `observation.sessionDigest`, `architecture.refresh`) while reply-suggestions
 * reads its own flat settings file.
 *
 * THE READING IS NEVER FATAL. A missing default file is the ordinary "feature
 * off" state; a missing explicitly named file, a malformed document or a
 * malformed block field is named in `problems` and the caller's shipped defaults
 * are used. Nothing here throws, because a bad knob must never stop the server.
 *
 * Consumers: `modules/quay/counter-voice-settings.ts`,
 * `modules/observation/session-digest-llm-settings.ts`,
 * `modules/reply-suggestions/reply-suggestions-settings.ts` and
 * `modules/architecture/refresh-settings.ts`.
 */
import { readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { errorMessage, isRecord } from '@/shared/utils.js';

// ---------------------------- SHARED SHAPES ----------------------------

/** The list a reader appends human-readable fallback reasons to. */
export type ValidationSink = string[];

/** What one read observed, handed to the block's `parse` callback. */
export type SettingsBlockContext = {
  /** `default` when no usable file was read; `file` once a document was parsed. */
  source: 'default' | 'file';
  /** The file this reading came from, or null when no file was consulted. */
  path: string | null;
  /** Every value that fell back to its shipped default, oldest first. */
  problems: ValidationSink;
};

/** The filesystem operations the source needs; injectable so a criterion can fake them. */
export type SettingsFileFs = {
  statSync(filePath: string): { mtimeMs: number; size: number };
  readFileSync(filePath: string, encoding: 'utf8'): string;
};

/** A stateful reader over one settings file. */
export type SettingsBlockSource<T> = {
  read(): T;
};

/**
 * What `createSettingsBlockSource` needs.
 *
 * Consumers: the four settings readers, each passing its own block path and
 * `parse` callback.
 */
export type SettingsBlockSourceOptions<T> = {
  /** The file to read; `null` means "no file at all". A leading `~` is expanded. */
  settingsPath?: string | null;
  /** The home `~` expands against; defaults to the process home. */
  homeDir?: string;
  /**
   * Dotted path of the block inside the JSON document (`architecture.refresh`).
   * `null`/the empty string means the document itself is the block
   * (reply-suggestions' flat file).
   */
  block?: string | null;
  /** A missing EXPLICITLY named file is a problem; a missing default file is not. */
  explicit?: boolean;
  /** The filesystem seam; defaults to `node:fs`. */
  fsImpl?: SettingsFileFs;
  /**
   * Build one reading from the selected block. `block` is null when the file does
   * not carry it (or there is no file); `context.problems` is the sink the
   * callback appends to, and the callback must not throw.
   */
  parse: (block: Record<string, unknown> | null, context: SettingsBlockContext) => T;
};

// ---------------------------- SHARED HELPERS ----------------------------

/**
 * Expand a leading `~` against `homeDir`; any other path is returned unchanged.
 *
 * Consumers: the four settings readers and
 * `modules/architecture/refresh-settings.ts`'s CLI resolver.
 */
export function expandHome(filePath: string, homeDir: string): string {
  if (filePath === '~') return homeDir;
  if (filePath.startsWith('~/')) return path.join(homeDir, filePath.slice(2));
  return filePath;
}

/**
 * The default server settings location, resolved at call time so a process HOME
 * is honoured.
 *
 * Consumers: `counter-voice-settings.ts`, `session-digest-llm-settings.ts` and
 * `refresh-settings.ts` (reply-suggestions names its own file instead).
 */
export function defaultServerSettingsPath(homeDir: string): string {
  return path.join(homeDir, '.config', 'claudecodeui', 'server.settings.json');
}

/**
 * Resolve which file a reader should use: an explicit path, then the named
 * environment entry, then the shipped default.
 *
 * Consumers: the four settings readers; each passes its own environment variable
 * and default path.
 */
export function resolveSettingsPath(options: {
  /** `undefined` = env-or-default, `null` = no file at all, a string = explicitly named. */
  settingsPath?: string | null;
  env?: Record<string, string | undefined>;
  envVar: string;
  homeDir: string;
  defaultPath: (homeDir: string) => string;
}): { filePath: string | null; explicit: boolean } {
  const env = options.env ?? process.env;
  if (options.settingsPath === null) return { filePath: null, explicit: false };
  if (typeof options.settingsPath === 'string') {
    return { filePath: expandHome(options.settingsPath, options.homeDir), explicit: true };
  }
  const named = env[options.envVar];
  if (typeof named === 'string' && named.trim() !== '') {
    return { filePath: expandHome(named.trim(), options.homeDir), explicit: true };
  }
  return { filePath: options.defaultPath(options.homeDir), explicit: false };
}

/**
 * Read one boolean field, naming it in `problems` when it has the wrong type.
 *
 * Consumers: all four settings readers.
 */
export function readBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
  problems: ValidationSink,
): boolean {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') {
    problems.push(`\`${key}\` must be a boolean`);
    return fallback;
  }
  return value;
}

/**
 * Read one string field, naming it in `problems` when it has the wrong type.
 *
 * Consumers: all four settings readers.
 */
export function readString(
  record: Record<string, unknown>,
  key: string,
  fallback: string,
  problems: ValidationSink,
): string {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string') {
    problems.push(`\`${key}\` must be a string`);
    return fallback;
  }
  return value;
}

/**
 * Read one finite number field inside `bounds`, naming it in `problems` when it
 * is malformed or out of range. `integer` rejects fractional values.
 *
 * Consumers: `reply-suggestions-settings.ts` (its fractional temperatures and
 * integer caps) and, through it, the reply-suggestions service criterion.
 */
export function readNumber(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  bounds: { minimum: number; maximum: number; integer: boolean },
  problems: ValidationSink,
): number {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push(`\`${key}\` must be a finite number`);
    return fallback;
  }
  if (bounds.integer && !Number.isInteger(value)) {
    problems.push(`\`${key}\` must be an integer`);
    return fallback;
  }
  if (value < bounds.minimum || value > bounds.maximum) {
    problems.push(`\`${key}\` must be between ${bounds.minimum} and ${bounds.maximum}`);
    return fallback;
  }
  return value;
}

/**
 * Read one integer field inside `bounds`, naming it in `problems` when it is
 * malformed or out of range.
 *
 * Consumers: `counter-voice-settings.ts` and `session-digest-llm-settings.ts`.
 */
export function readInteger(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  bounds: { minimum: number; maximum: number },
  problems: ValidationSink,
): number {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    problems.push(`\`${key}\` must be an integer`);
    return fallback;
  }
  if (value < bounds.minimum || value > bounds.maximum) {
    problems.push(`\`${key}\` must be between ${bounds.minimum} and ${bounds.maximum}`);
    return fallback;
  }
  return value;
}

/**
 * Read one enum field from a fixed vocabulary, naming the allowed values in
 * `problems` when the value is outside it.
 *
 * Consumers: `reply-suggestions-settings.ts` (protocol, auth scheme, expansion).
 */
export function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  vocabulary: readonly T[],
  fallback: T,
  problems: ValidationSink,
): T {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !(vocabulary as readonly string[]).includes(value)) {
    problems.push(`\`${key}\` must be one of ${vocabulary.map((entry) => `"${entry}"`).join(', ')}`);
    return fallback;
  }
  return value as T;
}

/** Strip one matching pair of surrounding single or double quotes. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

const KEY_ASSIGNMENT = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

/**
 * Resolve the API key named by an `apiKeyFile`.
 *
 * The file is either a bare key line or a shell-style `NAME=value` table (an
 * `export` prefix and one pair of quotes are accepted). With `apiKeyVar`, that
 * variable's assignment is selected. Without it, a file holding exactly one
 * assignment contributes that assignment; otherwise the first non-empty,
 * non-comment line wins. `warnOnWideMode` adds the reply-suggestions contract's
 * mode-600 problem (it is a warning, never fatal).
 *
 * Every failure is a `problems` entry; the key value itself is NEVER placed in
 * one, and an unreadable key file is not fatal by itself (the effective switch
 * turns off because the credential is empty).
 *
 * Consumers: the four settings readers (`counter-voice` and `session-digest`
 * use the bare-key form; `reply-suggestions` also selects `apiKeyVar` and warns
 * on a wide mode).
 */
export function resolveApiKey(
  apiKeyFile: string,
  homeDir: string,
  problems: ValidationSink,
  options: { apiKeyVar?: string; warnOnWideMode?: boolean } = {},
): string {
  if (apiKeyFile.trim() === '') {
    return '';
  }
  const resolvedPath = expandHome(apiKeyFile, homeDir);
  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf8');
  } catch (failure) {
    problems.push(`could not read the API key file ${resolvedPath}: ${errorMessage(failure)}`);
    return '';
  }

  if (options.warnOnWideMode === true) {
    try {
      const mode = statSync(resolvedPath).mode & 0o777;
      if ((mode & 0o077) !== 0) {
        problems.push(
          `the API key file ${resolvedPath} has mode ${mode.toString(8)}; 600 is expected because the file holds a secret`,
        );
      }
    } catch {
      // A stat failure after a successful read is not worth a second problem;
      // the read above already decided whether the file is usable.
    }
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  if (lines.length === 0) {
    problems.push(`the API key file ${resolvedPath} is empty`);
    return '';
  }

  const assignments: Array<{ name: string; value: string }> = [];
  for (const line of lines) {
    const match = KEY_ASSIGNMENT.exec(line);
    if (match) assignments.push({ name: match[1]!, value: unquote(match[2] ?? '') });
  }

  const apiKeyVar = (options.apiKeyVar ?? '').trim();
  if (apiKeyVar !== '') {
    const selected = assignments.find((assignment) => assignment.name === apiKeyVar);
    if (!selected) {
      problems.push(`the API key file ${resolvedPath} does not assign \`${apiKeyVar}\``);
      return '';
    }
    return selected.value.trim();
  }

  if (assignments.length === 1) {
    return assignments[0]!.value.trim();
  }

  const firstLine = lines[0]!;
  const firstMatch = KEY_ASSIGNMENT.exec(firstLine);
  return (firstMatch ? unquote(firstMatch[2] ?? '') : unquote(firstLine)).trim();
}

/**
 * Build a stateful reader over one JSON settings file.
 *
 * Each `read()` re-stats the file and re-parses ONLY when its modification time
 * or size changed; a missing default file reads as the caller's defaults with no
 * problems, while a missing explicitly named file reports the problem. A
 * malformed document or block is reported and the defaults are used, never a
 * thrown error.
 *
 * Consumers: the four settings readers (`counter-voice-settings.ts`,
 * `session-digest-llm-settings.ts`, `reply-suggestions-settings.ts`,
 * `refresh-settings.ts`), each supplying only its block path and `parse`.
 */
export function createSettingsBlockSource<T>(
  options: SettingsBlockSourceOptions<T>,
): SettingsBlockSource<T> {
  const homeDir = options.homeDir ?? os.homedir();
  const fsImpl: SettingsFileFs = options.fsImpl ?? { statSync, readFileSync };
  const blockPath = options.block === undefined || options.block === '' ? null : options.block;
  const filePath = options.settingsPath === undefined || options.settingsPath === null
    ? null
    : expandHome(options.settingsPath, homeDir);
  const explicit = options.explicit ?? false;

  let cached: { mtimeMs: number; size: number; reading: T } | null = null;

  /** Walk the dotted block path, naming each malformed level it meets. */
  function selectBlock(
    parsed: unknown,
    pathForMessage: string,
    problems: ValidationSink,
  ): Record<string, unknown> | null {
    if (!isRecord(parsed)) {
      problems.push(`${pathForMessage} must contain a JSON object`);
      return null;
    }
    if (blockPath === null) return parsed;
    let current: Record<string, unknown> = parsed;
    const segments = blockPath.split('.');
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index]!;
      const value = current[name];
      if (value === undefined) return null;
      if (!isRecord(value)) {
        problems.push(`\`${segments.slice(0, index + 1).join('.')}\` must be an object`);
        return null;
      }
      current = value;
    }
    return current;
  }

  return {
    read(): T {
      if (filePath === null) {
        return options.parse(null, { source: 'default', path: null, problems: [] });
      }

      let stats: { mtimeMs: number; size: number };
      try {
        stats = fsImpl.statSync(filePath);
      } catch (failure) {
        cached = null;
        const problems: ValidationSink = explicit
          ? [`could not read ${filePath}: ${errorMessage(failure)}`]
          : [];
        return options.parse(null, { source: 'default', path: filePath, problems });
      }

      if (cached !== null && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
        return cached.reading;
      }

      const problems: ValidationSink = [];
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
      } catch (failure) {
        problems.push(`could not read ${filePath}: ${errorMessage(failure)}`);
      }
      const reading = options.parse(selectBlock(parsed, filePath, problems), {
        source: 'file',
        path: filePath,
        problems,
      });
      cached = { mtimeMs: stats.mtimeMs, size: stats.size, reading };
      return reading;
    },
  };
}
