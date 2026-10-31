/**
 * Resolve where the server's data lives, and migrate a legacy layout only when
 * an explicit root is requested.
 *
 * DEFAULT BEHAVIOUR IS UNCHANGED. With neither `CLOUDPIT_HOME` nor
 * `CLOUDCLI_HOME` set, the active data root stays `<home>/.cloudcli` and
 * nothing is copied or created. Only an explicitly requested root takes the
 * migration path, and even then a failed attempt falls back to the legacy root.
 *
 * This module is deliberately unwired: GOAL-054 points the CLI, database,
 * settings and Electron paths at `resolveDataRoots`. Until then the only
 * consumers are this file's sibling `data-root-migration.ts` and
 * `tests/cloudpit-data-root.test.ts`.
 */
import os from 'node:os';
import path from 'node:path';

import {
  migrateLegacyDataRoot,
  type BackupDatabase,
  type DataRootFs,
} from './data-root-migration.js';
import { expandHome } from './settings-file.js';

/** Why {@link resolveDataRoots} selected the root it returned. */
export type DataRootReason =
  /** No explicit root was requested; the legacy default is active. */
  | 'default-legacy'
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
const LEGACY_ROOT_DIRECTORY_NAME = '.cloudcli';
const CONFIG_DIRECTORY_NAME = '.config';
const LEGACY_CONFIG_DIRECTORY_NAME = 'claudecodeui';
const EXPLICIT_CONFIG_DIRECTORY_NAME = 'cloudpit';
const SETTINGS_FILE_NAME = 'server.settings.json';

/** The first non-empty explicit-root environment value, with `~` expanded. */
function readExplicitRoot(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): string | null {
  // SPEC §4.1: the Cloudpit spelling wins, the legacy spelling is the fallback.
  for (const variableName of ['CLOUDPIT_HOME', 'CLOUDCLI_HOME'] as const) {
    const rawValue = env[variableName];
    if (typeof rawValue === 'string' && rawValue.trim() !== '') {
      return expandHome(rawValue.trim(), homeDir);
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

/**
 * Resolve the active data root and, for an explicit root, migrate the legacy
 * layout into it when it is safe to do so.
 *
 * The settings location follows the mode, not the data root: the default and
 * fallback arms keep `<home>/.config/claudecodeui/server.settings.json`, while
 * every explicit-root arm uses `<home>/.config/cloudpit/server.settings.json`.
 */
export function resolveDataRoots(options: ResolveDataRootsOptions = {}): ResolvedDataRoots {
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
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
    return buildResolvedRoots(legacyRoot, legacySettingsPath, legacySettingsPath, 'default-legacy', false);
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
