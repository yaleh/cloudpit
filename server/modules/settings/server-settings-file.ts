/**
 * The SERVER settings FILE as a read/write target, plus the boot reading that the cockpit's
 * settings surface reports as "currently in effect".
 *
 * WHY THIS LIVES BESIDE `server-settings.ts`. That module reads the file once at boot and never
 * writes it: it is the deployment's configuration, not a store. The Settings UI now edits two
 * fields of the same file (`cockpit.sessionStart.model` / `effort`), which needs three things
 * the boot reader deliberately does not own — a version an editor can compare against, an
 * atomic replace that preserves every other key verbatim, and the boot reading itself, so the
 * surface can show "currently in effect" beside "saved, takes effect after a restart".
 *
 * WHY THE BOOT READING IS RECORDED HERE. `loadServerSettings` is the ONE reader of this file,
 * called once by `server/index.ts`. It hands its result to {@link recordCockpitSessionStartBoot}
 * so the API and the card `session.start` executor (both fed by that same boot reading) cannot
 * disagree about what a running process is using. The file is still the ONLY persistent source;
 * a save reaches the next boot through the ordinary loader.
 *
 * WRITE CONTRACT. A write carries the exact `version` (the content hash) it was based on. A
 * different file on disk is a `409 VERSION_CONFLICT` and the file is left byte-identical.
 * Writes are serialised inside this process, applied to a parsed copy that keeps every other
 * top-level key and every other `cockpit`/`sessionStart` field, and committed by writing a
 * sibling temp file and renaming it over the target, so a reader never observes a half file.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

import {
  defaultServerSettingsPath as defaultServerSettingsPathForHome,
  legacyServerSettingsPath,
  migrateLegacyServerSettingsFile,
  writeSettingsFileAtomically,
} from '@/shared/settings-file.js';
import { AppError, errorMessage, isRecord } from '@/shared/utils.js';

/**
 * The environment variable naming the settings file. It is the single environment entry for
 * this file: it points at the file and nothing else.
 */
export const SERVER_SETTINGS_ENV = 'SERVER_SETTINGS_PATH';

/** Where a reading comes from: the shipped default location, or a path the operator named. */
export type ServerSettingsFileTarget = {
  /** The file this boot read and the settings API edit. */
  path: string;
  /** The file a save writes: always the Cloudpit default unless a path was named. */
  writePath: string;
  /** Whether `SERVER_SETTINGS_PATH` (or a caller's override) named it, like `loadServerSettings`. */
  explicit: boolean;
};

/** The path an operator's copy lives at when no other path is named. Resolved per call, per HOME. */
export function defaultServerSettingsPath(): string {
  // The one definition lives in the shared reader; this wrapper keeps the module's
  // no-argument public surface while still honouring the process HOME.
  return defaultServerSettingsPathForHome(homedir());
}

/**
 * Resolves the file the boot reader and the settings API share. Same order as
 * `loadServerSettings`: an explicit path > `SERVER_SETTINGS_PATH` > the shipped location.
 *
 * The shipped location is `<home>/.config/cloudpit/server.settings.json`. v3.0 deleted the
 * runtime read fallback to `<home>/.config/claudecodeui/server.settings.json`: on the first
 * resolution the legacy file is COPIED to the Cloudpit path once (never overwriting an existing
 * Cloudpit file), and every read afterwards uses only the Cloudpit file. `path` and `writePath`
 * are therefore always the same for the default target, and a save lands in the new tree.
 *
 * Consumers: `server-settings.ts` (the boot read) and `settings.module.ts` (the API's target).
 */
export function resolveServerSettingsFileTarget(options: {
  settingsPath?: string | undefined;
  env?: Record<string, string | undefined>;
  defaultPath?: string | undefined;
  homeDir?: string | undefined;
  exists?: ((filePath: string) => boolean) | undefined;
} = {}): ServerSettingsFileTarget {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? homedir();
  const exists = options.exists ?? existsSync;
  const named = options.settingsPath ?? env[SERVER_SETTINGS_ENV];
  const explicit = typeof named === 'string' && named.trim() !== '';
  if (explicit) {
    const namedPath = named.trim();
    return { path: namedPath, writePath: namedPath, explicit: true };
  }

  const defaultPath = options.defaultPath ?? defaultServerSettingsPathForHome(homeDir);
  // One-time upgrade aid: copy the pre-flip file into the Cloudpit tree when the latter is
  // absent. The legacy file is never read again after this and is left on disk.
  // An INJECTED defaultPath marks a hermetic caller (the criteria drive an arbitrary temp file);
  // it must not consult the process HOME behind its back, so migration runs only for the shipped
  // default derived from `homeDir`.
  if (options.defaultPath === undefined) {
    migrateLegacyServerSettingsFile({
      legacyPath: legacyServerSettingsPath(homeDir),
      targetPath: defaultPath,
      exists,
    });
  }
  return { path: defaultPath, writePath: defaultPath, explicit: false };
}

/**
 * The cockpit session-start reading the Settings surface consumes.
 *
 * Mirrored by hand in `src/shared/types.ts` and compared field-for-field by
 * `src/shared/tests/wireContractTypeSync.test.ts`, because the server tree is not part of the
 * browser bundle. `model`/`effort` are the SAVED file values (what the next boot applies);
 * `effective*` are the values the RUNNING process booted with. `version` is the content hash an
 * editor sends back to prove it edited what it read.
 */
export type CockpitSessionStartSettingsReading = {
  model: string;
  effort: string;
  effectiveModel: string;
  effectiveEffort: string;
  version: string;
  restartRequired: boolean;
};

/** One raw reading of the file's two fields; `null` means "not written", not "empty string". */
export type CockpitSessionStartFileReading = {
  path: string;
  model: string | null;
  effort: string | null;
  version: string;
};

/** The boot reading the API reports as "currently in effect". */
export type CockpitSessionStartBootSnapshot = {
  path: string;
  /** Where a save lands. It differs from `path` only after a legacy-file read fallback. */
  writePath: string;
  model: string;
  effort: string;
};

/** One write: only the fields present are changed; everything else is preserved verbatim. */
export type CockpitSessionStartWriteRequest = {
  model?: string | undefined;
  effort?: string | undefined;
  expectedVersion: string;
};

/** The version reported for a file that does not exist yet (a save creates it). */
const MISSING_FILE_VERSION = 'missing';

/**
 * Owns the boot reading in its closure. A module-level `let` would be mutable state at module
 * scope; the factory keeps one write path and lets `loadServerSettings` and the API share it.
 */
export type CockpitSessionStartBootRegistry = {
  record(
    filePath: string,
    sessionStart: { model: string; effort?: string | undefined },
    writePath?: string,
  ): void;
  read(): CockpitSessionStartBootSnapshot | null;
};

/** Creates the boot-reading owner. `server-settings.ts` records; the settings API reads. */
export function createCockpitSessionStartBootRegistry(): CockpitSessionStartBootRegistry {
  let snapshot: CockpitSessionStartBootSnapshot | null = null;
  return {
    record(filePath, sessionStart, writePath) {
      snapshot = {
        path: filePath,
        writePath: writePath ?? filePath,
        model: sessionStart.model,
        effort: (sessionStart.effort ?? '').trim(),
      };
    },
    read() {
      return snapshot;
    },
  };
}

const cockpitSessionStartBoot = createCockpitSessionStartBootRegistry();

/**
 * Records what THIS boot read, so the API can report the running process's effective values.
 * Consumed by `loadServerSettings` — the one boot reader.
 */
export function recordCockpitSessionStartBoot(
  filePath: string,
  sessionStart: { model: string; effort?: string | undefined },
  writePath?: string,
): void {
  cockpitSessionStartBoot.record(filePath, sessionStart, writePath);
}

/** The boot reading, or `null` before `loadServerSettings` has run (e.g. a bare route test). */
export function readCockpitSessionStartBoot(): CockpitSessionStartBootSnapshot | null {
  return cockpitSessionStartBoot.read();
}

/** A content hash, so a stale editor can be told the file moved under it. */
function versionOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Reads the file's bytes, distinguishing "absent" (a normal state) from a real read failure. */
function readRawSettingsFile(filePath: string): { text: string | null; version: string } {
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return { text: null, version: MISSING_FILE_VERSION };
    }
    throw new AppError(`could not read ${filePath}: ${errorMessage(failure)}`, {
      code: 'SERVER_SETTINGS_READ_FAILED',
      statusCode: 500,
    });
  }
  return { text, version: versionOf(text) };
}

/** Parses a JSON document that must be an object; every failure is visible, never a fallback. */
function parseSettingsDocument(filePath: string, text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (failure) {
    throw new AppError(`${filePath} is not valid JSON: ${errorMessage(failure)}`, {
      code: 'SERVER_SETTINGS_INVALID_JSON',
      statusCode: 500,
    });
  }
  if (!isRecord(parsed)) {
    throw new AppError(`${filePath} must contain a JSON object`, {
      code: 'SERVER_SETTINGS_INVALID_JSON',
      statusCode: 500,
    });
  }
  return parsed;
}

/**
 * The two saved fields as the BOOT loader would read them: a non-empty string is used as
 * written (trimmed), and anything absent/blank/malformed reads as "not written" so the caller
 * falls back to the shipped default, exactly like `readSessionStart` does.
 */
function savedFieldsOf(document: Record<string, unknown>): {
  model: string | null;
  effort: string | null;
} {
  if (!isRecord(document.cockpit) || !isRecord(document.cockpit.sessionStart)) {
    return { model: null, effort: null };
  }
  const sessionStart = document.cockpit.sessionStart;
  const model = typeof sessionStart.model === 'string' && sessionStart.model.trim() !== ''
    ? sessionStart.model.trim()
    : null;
  const effort = typeof sessionStart.effort === 'string' && sessionStart.effort.trim() !== ''
    ? sessionStart.effort.trim()
    : null;
  return { model, effort };
}

/**
 * Reads the saved `cockpit.sessionStart.model` / `effort` from the file the boot reader uses.
 *
 * A missing file is the normal "nothing saved" state; an unreadable or malformed one is an
 * error the API must report rather than disguise as the defaults. Consumers:
 * `settings.module.ts` (the API's read seam) and the settings routes criterion.
 */
export function readCockpitSessionStart(filePath: string): CockpitSessionStartFileReading {
  const raw = readRawSettingsFile(filePath);
  if (raw.text === null) {
    return { path: filePath, model: null, effort: null, version: raw.version };
  }
  const document = parseSettingsDocument(filePath, raw.text);
  return { path: filePath, ...savedFieldsOf(document), version: raw.version };
}

/** An in-process serial queue: the version check and the replace must not interleave. */
function createSerialQueue(): { run<T>(operation: () => T): Promise<T> } {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(operation: () => T): Promise<T> {
      const result = tail.then(operation, operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

const cockpitSessionStartWrites = createSerialQueue();

/**
 * Writes the document through the shared atomic replace, wrapping a filesystem failure in this
 * module's own error code. An existing file keeps its mode; a new one is created `0600`.
 */
function writeAtomically(filePath: string, contents: string): void {
  try {
    writeSettingsFileAtomically(filePath, contents);
  } catch (failure) {
    throw new AppError(`could not write ${filePath}: ${errorMessage(failure)}`, {
      code: 'SERVER_SETTINGS_WRITE_FAILED',
      statusCode: 500,
    });
  }
}

/**
 * Applies one whitelist edit to the file, preserving every other key verbatim.
 *
 * Unknown top-level keys, other `cockpit` fields, and `sessionStart.lifecycleMode` /
 * `permissionMode` are carried through untouched because the write mutates the parsed document
 * instead of rebuilding it. A document whose `cockpit` or `sessionStart` is present but not an
 * object is REFUSED: replacing it would destroy configuration this endpoint may not edit.
 * Consumers: `settings.module.ts` and the settings routes criterion.
 */
export function writeCockpitSessionStart(
  filePath: string,
  request: CockpitSessionStartWriteRequest,
  options: {
    /**
     * The file the caller's `expectedVersion` was read from. After a legacy-settings read
     * fallback the API reports the legacy file's version, so the save must compare against that
     * file and carry its other keys into the Cloudpit target instead of inventing `{}`.
     * Defaults to `filePath`.
     */
    versionPath?: string | undefined;
  } = {},
): Promise<CockpitSessionStartFileReading> {
  return cockpitSessionStartWrites.run(() => {
    const sourcePath = options.versionPath ?? filePath;
    const raw = readRawSettingsFile(sourcePath);
    if (raw.version !== request.expectedVersion) {
      throw new AppError('The settings file changed since it was read; reload and save again.', {
        code: 'VERSION_CONFLICT',
        statusCode: 409,
        details: { expectedVersion: request.expectedVersion, currentVersion: raw.version },
      });
    }

    const document = raw.text === null ? {} : parseSettingsDocument(sourcePath, raw.text);
    if (document.cockpit !== undefined && !isRecord(document.cockpit)) {
      throw new AppError('`cockpit` is not a JSON object; refusing to overwrite it.', {
        code: 'SERVER_SETTINGS_INVALID_SHAPE',
        statusCode: 500,
      });
    }
    const cockpit = isRecord(document.cockpit) ? document.cockpit : {};
    if (cockpit.sessionStart !== undefined && !isRecord(cockpit.sessionStart)) {
      throw new AppError('`cockpit.sessionStart` is not a JSON object; refusing to overwrite it.', {
        code: 'SERVER_SETTINGS_INVALID_SHAPE',
        statusCode: 500,
      });
    }
    const sessionStart = isRecord(cockpit.sessionStart) ? cockpit.sessionStart : {};

    // Only the two whitelist fields are touched: a field the caller omitted keeps its saved
    // value, so a PATCH is a partial edit and a PUT's policy is applied by the service.
    if (request.model !== undefined) sessionStart.model = request.model;
    if (request.effort !== undefined) sessionStart.effort = request.effort;
    cockpit.sessionStart = sessionStart;
    document.cockpit = cockpit;

    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    writeAtomically(filePath, serialized);
    return { path: filePath, ...savedFieldsOf(document), version: versionOf(serialized) };
  });
}
