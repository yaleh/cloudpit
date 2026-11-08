/**
 * Resolve where the server's data lives, and migrate a legacy layout when the
 * Cloudpit default (or an explicit root) is selected.
 *
 * v3.0 RETIREMENT. Up to 2.x the resolver had two default modes: `defaultRoot:
 * 'legacy'` kept the historical `~/.cloudcli` layout, and any migration failure
 * fell back to that layout so the server always kept running. Both runtime
 * compatibilities are gone:
 *
 *  - there is ONE default root, `<home>/.cloudpit`, selected when neither
 *    `CLOUDPIT_HOME` nor an explicit caller root is set;
 *  - the one-time migration still runs when a legacy `~/.cloudcli` layout exists
 *    (a machine upgrading straight from 1.x is copied into `~/.cloudpit`), but a
 *    failed migration is REPORTED, never silently swallowed by reverting to the
 *    old root. `resolveDataRoots` returns `reason: 'migration-failed'` and a
 *    `migrationError` message; the caller logs it and keeps the Cloudpit root.
 *
 * The legacy root is only ever READ: `data-root-migration.ts` rolls back every
 * file it created, so a failed attempt leaves `~/.cloudcli` byte-identical and
 * never deletes it. An explicitly requested root always takes the migration path.
 */
import os from 'node:os';
import path from 'node:path';

import {
  migrateLegacyDataRoot,
  type BackupDatabase,
  type DataRootFs,
} from './data-root-migration.js';

/** Why {@link resolveDataRoots} selected the root it returned. */
export type DataRootReason =
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
  /** The migration threw; the Cloudpit root stays active and the error is reported. */
  | 'migration-failed';

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
  /** The legacy settings file, kept as the one-time migration source. */
  legacySettingsPath: string;
  /** Which of the documented cases this resolution took. */
  reason: DataRootReason;
  /** True only when this call copied the legacy layout into the active root. */
  migrated: boolean;
  /**
   * The migration failure message when `reason` is `'migration-failed'`, else
   * `null`. The caller must surface it (the boot logs it) — v3.0 does not fall
   * back to the legacy root.
   */
  migrationError: string | null;
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

/**
 * Format a migration failure without importing `shared/utils.ts`: that module
 * reads environment defaults during evaluation, before `load-env.ts` has loaded
 * `.env`, which is exactly the ordering this bootstrap module must not disturb.
 */
function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * The explicit-root environment value, with `~` expanded.
 *
 * v3.0: only `CLOUDPIT_HOME` is consulted. The legacy `CLOUDCLI_HOME` spelling no
 * longer selects a root, so a process exporting only that name migrates into the
 * default `~/.cloudpit` instead of writing to the old location.
 */
function readExplicitRoot(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): string | null {
  const rawValue = env.CLOUDPIT_HOME;
  if (typeof rawValue === 'string' && rawValue.trim() !== '') {
    return expandTildePrefix(rawValue.trim(), homeDir);
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
  migrationError: string | null = null,
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
    migrationError,
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
 * Resolve the active data root and migrate the legacy layout into it when it is
 * safe to do so.
 *
 * The active root is `CLOUDPIT_HOME` when it names one, else `<home>/.cloudpit`.
 * The settings location is always `<home>/.config/cloudpit/server.settings.json`
 * (the legacy settings file is only a migration source).
 *
 * A failed migration does not change the active root: the resolver returns
 * `reason: 'migration-failed'` with the thrown message in `migrationError`. The
 * legacy root is left byte-identical by the migration module's rollback.
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
  const explicit = requestedRoot !== null;
  const activeRoot = requestedRoot ?? path.join(homeDir, CLOUDPIT_ROOT_DIRECTORY_NAME);
  const reasonOf = explicit ? explicitReason : defaultReason;

  try {
    const outcome = migrateLegacyDataRoot({
      legacyRoot,
      newRoot: activeRoot,
      legacySettingsPath,
      newSettingsPath: explicitSettingsPath,
      version: options.version ?? 'unknown',
      fs: options.fs,
      backupDatabase: options.backupDatabase,
      now: options.now,
    });
    return buildResolvedRoots(
      activeRoot,
      explicitSettingsPath,
      legacySettingsPath,
      reasonOf(outcome),
      outcome.migrated,
    );
  } catch (failure) {
    // v3.0: no fallback to the legacy root. The migration module rolled back every
    // file it created, so the Cloudpit root is clean; the caller sees the failure.
    return buildResolvedRoots(
      activeRoot,
      explicitSettingsPath,
      legacySettingsPath,
      'migration-failed',
      false,
      describeFailure(failure),
    );
  }
}
