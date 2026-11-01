/**
 * Resolve where the server's data lives, and migrate a legacy layout when the
 * caller asks for the Cloudpit default (or names an explicit root).
 *
 * TWO DEFAULT MODES. `defaultRoot: 'legacy'` (the default when the option is
 * omitted) keeps the historical behaviour: with neither `CLOUDPIT_HOME` nor
 * `CLOUDCLI_HOME` set, the active root stays `<home>/.cloudcli` and nothing is
 * copied or created. `defaultRoot: 'cloudpit'` is what the server bootstrap now
 * asks for: with no explicit environment root it selects `<home>/.cloudpit`,
 * copies the legacy layout into it once, and falls back to the legacy root when
 * the copy fails. An explicitly requested root always takes the migration path.
 *
 * The legacy root is only ever read: a failed attempt is rolled back by
 * `data-root-migration.ts` and the fallback keeps the server running on the old
 * layout. Callers that must not migrate keep passing `'legacy'` (AC-449's
 * criterion does exactly that).
 */
import os from 'node:os';
import path from 'node:path';

import {
  migrateLegacyDataRoot,
  type BackupDatabase,
  type DataRootFs,
} from './data-root-migration.js';

/** Which default root the caller wants when no explicit environment root is set. */
export type DataRootMode = 'legacy' | 'cloudpit';

/** Why {@link resolveDataRoots} selected the root it returned. */
export type DataRootReason =
  /** No explicit root was requested and the caller asked for the legacy default. */
  | 'default-legacy'
  /** The Cloudpit default was selected and the legacy layout was copied into it. */
  | 'default-migrated'
  /** The Cloudpit default already carries a completion marker. */
  | 'default-already-migrated'
  /** The Cloudpit default already held user data; it was left untouched. */
  | 'default-user-root'
  /** The Cloudpit default was selected but there was no legacy layout to copy. */
  | 'default-cloudpit'
  /** The explicit root was populated from the legacy layout. */
  | 'explicit-migrated'
  /** The explicit root already carries a completion marker. */
  | 'explicit-already-migrated'
  /** The explicit root already held user data; it was left untouched. */
  | 'explicit-user-root'
  /** The explicit root was requested but there was no legacy layout to copy. */
  | 'explicit-no-legacy'
  /** A migration step failed; the legacy root is active and the new one is clean. */
  | 'fallback-after-failure';

/**
 * The resolved data locations. Every path is derived from `activeRoot` and the
 * home directory, so a caller never has to re-derive a filename.
 */
export type ResolvedDataRoots = {
  /** The data root the server should use. */
  activeRoot: string;
  /** `<activeRoot>/auth.db`. */
  authDatabasePath: string;
  /** `<activeRoot>/voice-data`. */
  voiceDataDir: string;
  /** `<activeRoot>/cockpit-card-feedback.json`. */
  cockpitCardFeedbackPath: string;
  /** `<activeRoot>/reply-suggestions-usage.jsonl`. */
  replySuggestionsUsagePath: string;
  /** The settings file for the active mode. */
  settingsPath: string;
  /** The legacy settings file, always named for a possible migration source. */
  legacySettingsPath: string;
  /** Which of the documented cases this resolution took. */
  reason: DataRootReason;
  /** True only when this call copied the legacy layout into the explicit root. */
  migrated: boolean;
};

/** Dependencies of {@link resolveDataRoots}; all injectable so it is testable. */
export type ResolveDataRootsOptions = {
  /** The environment to read; defaults to `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** The home `~` expands against; defaults to the process home. */
  homeDir?: string;
  /**
   * Which default root to use when no explicit environment root is set.
   * Defaults to `'legacy'`, so existing callers keep the historical layout.
   */
  defaultRoot?: DataRootMode;
  /** The filesystem seam; defaults to `node:fs`. */
  fs?: DataRootFs;
  /** The SQLite snapshot seam; defaults to a readonly `VACUUM INTO`. */
  backupDatabase?: BackupDatabase;
  /** Clock seam for the migration marker; defaults to the current time. */
  now?: () => Date;
  /** Recorded in the migration marker; defaults to `unknown`. */
  version?: string;
};

/** Directory/file names the layout is built from. */
export const LEGACY_ROOT_DIRECTORY_NAME = '.cloudcli';
export const CLOUDPIT_ROOT_DIRECTORY_NAME = '.cloudpit';
const AUTH_DATABASE_FILE_NAME = 'auth.db';
const CONFIG_DIRECTORY_NAME = '.config';
const LEGACY_CONFIG_DIRECTORY_NAME = 'claudecodeui';
const EXPLICIT_CONFIG_DIRECTORY_NAME = 'cloudpit';
const SETTINGS_FILE_NAME = 'server.settings.json';

/**
 * The Cloudpit default data root for a resolver with no environment seam (the
 * reply-suggestions usage log and the view-events log). The bootstrap derives
 * the same root through {@link resolveDataRoots}.
 */
export function defaultCloudpitDataRoot(homeDir: string = os.homedir()): string {
  return path.join(homeDir, CLOUDPIT_ROOT_DIRECTORY_NAME);
}

/**
 * The Cloudpit-mode database location for a resolver with no environment seam
 * (the voice log/capture helpers). The bootstrap derives the same path through
 * {@link resolveDataRoots}; this function only spares those call sites a second
 * `.cloudpit` literal.
 */
export function defaultAuthDatabasePath(homeDir: string = os.homedir()): string {
  return path.join(defaultCloudpitDataRoot(homeDir), AUTH_DATABASE_FILE_NAME);
}

/**
 * Expand a leading `~` against `homeDir`. Deliberately local: importing
 * `settings-file.ts` here would pull `shared/utils.ts` into the bootstrap before
 * the `.env` file is read, which is the ordering constraint `load-env.ts`
 * documents.
 */
function expandTildePrefix(value: string, homeDir: string): string {
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return path.join(homeDir, value.slice(2));
  return value;
}

/** The first non-empty explicit-root environment value, with `~` expanded. */
function readExplicitRoot(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): string | null {
  // SPEC §4.1: the Cloudpit spelling wins, the legacy spelling is the fallback.
  for (const variableName of ['CLOUDPIT_HOME', 'CLOUDCLI_HOME'] as const) {
    const rawValue = env[variableName];
    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
      return expandTildePrefix(rawValue.trim(), homeDir);
    }
  }
  return null;
}

/** Build the full path set for one active root and settings file. */
function buildResolvedRoots(
  activeRoot: string,
  settingsPath: string,
  legacySettingsPath: string,
  reason: DataRootReason,
  migrated: boolean,
): ResolvedDataRoots {
  return {
    activeRoot,
    authDatabasePath: path.join(activeRoot, 'auth.db'),
    voiceDataDir: path.join(activeRoot, 'voice-data'),
    cockpitCardFeedbackPath: path.join(activeRoot, 'cockpit-card-feedback.json'),
    replySuggestionsUsagePath: path.join(activeRoot, 'reply-suggestions-usage.jsonl'),
    settingsPath,
    legacySettingsPath,
    reason,
    migrated,
  };
}

/** Map the migration module's outcome onto this module's public reasons. */
function explicitReason(outcome: ReturnType<typeof migrateLegacyDataRoot>): DataRootReason {
  switch (outcome.reason) {
    case 'migrated':
      return 'explicit-migrated';
    case 'already-migrated':
      return 'explicit-already-migrated';
    case 'user-root':
      return 'explicit-user-root';
    case 'no-legacy':
      return 'explicit-no-legacy';
  }
}

/** The same outcome mapping for the Cloudpit default, whose reasons name that mode. */
function defaultReason(outcome: ReturnType<typeof migrateLegacyDataRoot>): DataRootReason {
  switch (outcome.reason) {
    case 'migrated':
      return 'default-migrated';
    case 'already-migrated':
      return 'default-already-migrated';
    case 'user-root':
      return 'default-user-root';
    case 'no-legacy':
      return 'default-cloudpit';
  }
}

/**
 * Resolve the active data root and, for an explicit root or the Cloudpit
 * default, migrate the legacy layout into it when it is safe to do so.
 *
 * The settings location follows the mode, not the data root: the legacy default
 * and every fallback arm keep `<home>/.config/claudecodeui/server.settings.json`,
 * while explicit-root and Cloudpit-default arms use
 * `<home>/.config/cloudpit/server.settings.json`.
 */
export function resolveDataRoots(options: ResolveDataRootsOptions = {}): ResolvedDataRoots {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const mode: DataRootMode = options.defaultRoot ?? 'legacy';
  const legacyRoot = path.join(homeDir, LEGACY_ROOT_DIRECTORY_NAME);
  const legacySettingsPath = path.join(
    homeDir,
    CONFIG_DIRECTORY_NAME,
    LEGACY_CONFIG_DIRECTORY_NAME,
    SETTINGS_FILE_NAME,
  );
  const explicitSettingsPath = path.join(
    homeDir,
    CONFIG_DIRECTORY_NAME,
    EXPLICIT_CONFIG_DIRECTORY_NAME,
    SETTINGS_FILE_NAME,
  );

  const requestedRoot = readExplicitRoot(env, homeDir);
  if (requestedRoot === null) {
    if (mode === 'legacy') {
      return buildResolvedRoots(legacyRoot, legacySettingsPath, legacySettingsPath, 'default-legacy', false);
    }

    // The Cloudpit default: migrate into `<home>/.cloudpit` exactly as an
    // explicitly requested root would, with reasons that name this mode.
    const cloudpitRoot = path.join(homeDir, CLOUDPIT_ROOT_DIRECTORY_NAME);
    try {
      const outcome = migrateLegacyDataRoot({
        legacyRoot,
        newRoot: cloudpitRoot,
        legacySettingsPath,
        newSettingsPath: explicitSettingsPath,
        version: options.version ?? 'unknown',
        fs: options.fs,
        backupDatabase: options.backupDatabase,
        now: options.now,
      });
      return buildResolvedRoots(
        cloudpitRoot,
        explicitSettingsPath,
        legacySettingsPath,
        defaultReason(outcome),
        outcome.migrated,
      );
    } catch {
      // The migration module rolled back everything it created; the legacy root
      // was only ever read, so keeping it active is the safe outcome.
      return buildResolvedRoots(legacyRoot, legacySettingsPath, legacySettingsPath, 'fallback-after-failure', false);
    }
  }

  try {
    const outcome = migrateLegacyDataRoot({
      legacyRoot,
      newRoot: requestedRoot,
      legacySettingsPath,
      newSettingsPath: explicitSettingsPath,
      version: options.version ?? 'unknown',
      fs: options.fs,
      backupDatabase: options.backupDatabase,
      now: options.now,
    });
    return buildResolvedRoots(
      requestedRoot,
      explicitSettingsPath,
      legacySettingsPath,
      explicitReason(outcome),
      outcome.migrated,
    );
  } catch {
    // The migration module has already rolled back everything it created; the
    // legacy root was only ever read, so it is safe to keep using.
    return buildResolvedRoots(legacyRoot, legacySettingsPath, legacySettingsPath, 'fallback-after-failure', false);
  }
}
