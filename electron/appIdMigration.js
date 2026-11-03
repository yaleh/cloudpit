/**
 * One-time v3.0 desktop app-id switch (R13 of the Cloudpit retirement plan).
 *
 * The Electron app identity moves from the legacy `ai.cloudcli.desktop` to
 * `ai.cloudpit.desktop` in 3.0. Existing installations keep working: this
 * module migrates the install-level identity once at first launch, while
 * everything it touches has a rollback path.
 *
 * The core ({@link migrateAppId}) is a pure function: every host capability
 * (filesystem, paths, platform, Windows registry, macOS keychain) is injected,
 * so the criterion file can drive all three platforms with in-memory fakes and
 * never touches the host's real registry or keychain. {@link maybeMigrateDesktopAppId}
 * is the only host entry point; `electron/main.js` calls it from `bootstrap()`
 * before anything reads `app.getPath('userData')`.
 *
 * Invariants (do not relax):
 *   - the legacy install (registry key, start-menu/taskbar shortcut, keychain
 *     entry, `.desktop` file, userData directory) is NEVER deleted or
 *     overwritten, so a failed migration falls back to the old installation;
 *   - an existing target artifact always wins, so re-running is a no-op;
 *   - the cloud contract is untouched: `cloudcli://auth/callback` and
 *     `app_surface=cloudcli_desktop` are third-party values, not appId values.
 */
import { execFileSync as defaultExecFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LEGACY_DESKTOP_USER_DATA_DIRECTORY,
  maybeMigrateDesktopUserData,
} from './userDataMigration.js';

/** The v3.0 Electron app id (package.json `build.appId`). */
export const DESKTOP_APP_ID = 'ai.cloudpit.desktop';
/** The pre-3.0 app id, kept only so an upgrade can find the old installation. */
export const LEGACY_DESKTOP_APP_ID = 'ai.cloudcli.desktop';
export const DESKTOP_PRODUCT_NAME = 'Cloudpit';
export const LEGACY_PRODUCT_NAME = 'CloudCLI';

/** electron-builder derives the macOS CFBundleIdentifier from `build.appId`. */
export const MACOS_BUNDLE_IDENTIFIER = DESKTOP_APP_ID;
/** Keychain generic-password service names (the bundle id). */
export const MACOS_KEYCHAIN_SERVICE = DESKTOP_APP_ID;
export const LEGACY_MACOS_KEYCHAIN_SERVICE = LEGACY_DESKTOP_APP_ID;

/** NSIS uninstall registry keys written under HKCU. */
export const WINDOWS_UNINSTALL_KEY =
  `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${DESKTOP_APP_ID}`;
export const LEGACY_WINDOWS_UNINSTALL_KEY =
  `Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${LEGACY_DESKTOP_APP_ID}`;
export const WINDOWS_START_MENU_SHORTCUT = 'Cloudpit.lnk';
export const LEGACY_WINDOWS_START_MENU_SHORTCUT = 'CloudCLI.lnk';
export const WINDOWS_TASKBAR_SHORTCUT = 'Cloudpit.lnk';
export const LEGACY_WINDOWS_TASKBAR_SHORTCUT = 'CloudCLI.lnk';

/** Linux desktop-entry file names under `~/.local/share/applications`. */
export const LINUX_DESKTOP_FILE_NAME = 'cloudpit.desktop';
export const LEGACY_LINUX_DESKTOP_FILE_NAME = 'cloudcli.desktop';
/** Electron's WM_CLASS for the packaged app is the product name, not the app id. */
export const LINUX_DESKTOP_STARTUP_WM_CLASS = DESKTOP_PRODUCT_NAME;

const USER_DATA_ARTIFACT_PREFIX = 'user-data:';

/**
 * Builds the injectable migrator. The returned `run()` performs one migration
 * pass and never throws for a per-artifact failure; failures are reported in
 * `result.error` while every legacy artifact stays in place.
 *
 * @param {object} options
 * @param {'win32'|'darwin'|'linux'|string} [options.platform]
 * @param {object} [options.fs] node:fs-compatible sync subset
 * @param {object} [options.path] node:path-compatible module
 * @param {string} options.appDataDir the OS appData directory (userData parent)
 * @param {string} [options.homeDir]
 * @param {string} [options.appVersion]
 * @param {string} [options.execPath] Exec= target written to the Linux entry
 * @param {string} [options.installLocation] new Windows InstallLocation
 * @param {{ read(key): object|null, write(key, values): void }|null} [options.registry]
 * @param {{ read(entry): object|null, write(entry): void }|null} [options.keychain]
 * @param {boolean} [options.includeUserData]
 * @param {object} [options.paths] per-platform path overrides (tests)
 * @returns {{ run(): MigrationResult }}
 */
export function createAppIdMigration(options = {}) {
  const {
    platform = process.platform,
    fs: fsImpl = fs,
    path: pathImpl = path,
    appDataDir,
    homeDir = os.homedir(),
    appVersion = '0.0.0',
    execPath = '',
    installLocation = '',
    registry = null,
    keychain = null,
    keychainAccount = DESKTOP_PRODUCT_NAME,
    includeUserData = true,
    paths = {},
  } = options;

  if (!appDataDir) {
    throw new Error('createAppIdMigration requires an appDataDir');
  }

  /** @typedef {{platform: string, migrated: boolean, copied: string[], skipped: string[], error: null|{artifact: string, code: string, message: string}, backupPath: string|null}} MigrationResult */

  function run() {
    /** @type {MigrationResult} */
    const result = {
      platform,
      migrated: false,
      copied: [],
      skipped: [],
      error: null,
      backupPath: null,
    };

    if (includeUserData) {
      runUserDataLeg(result, { fsImpl, pathImpl, appDataDir });
    }

    if (platform === 'win32') {
      runWindowsLeg(result, {
        fsImpl,
        pathImpl,
        appDataDir,
        appVersion,
        installLocation,
        registry,
        paths,
      });
    } else if (platform === 'darwin') {
      runMacLeg(result, { keychain, keychainAccount });
    } else if (platform === 'linux') {
      runLinuxLeg(result, { fsImpl, pathImpl, homeDir, execPath, paths });
    }

    return result;
  }

  return { run };
}

/** Convenience one-shot: {@link createAppIdMigration}(options).run(). */
export function migrateAppId(options = {}) {
  return createAppIdMigration(options).run();
}

/**
 * Host entry point used by `electron/main.js`. Builds the real OS adapters,
 * then delegates to {@link migrateAppId}. The adapters are best-effort: a
 * missing `reg.exe`/`security` CLI reads as "no legacy install", never as a
 * thrown error, so a failed lookup falls back to the old installation.
 */
export function maybeMigrateDesktopAppId(options = {}) {
  const platform = options.platform ?? process.platform;

  const registry =
    options.registry ??
    (platform === 'win32' ? createWindowsRegistryAdapter({ execFileSync: options.execFileSync }) : null);
  const keychain =
    options.keychain ??
    (platform === 'darwin' ? createMacKeychainAdapter({ execFileSync: options.execFileSync }) : null);

  return migrateAppId({
    ...options,
    platform,
    registry,
    keychain,
  });
}

function runUserDataLeg(result, { fsImpl, pathImpl, appDataDir }) {
  const legacyDir = pathImpl.join(appDataDir, LEGACY_DESKTOP_USER_DATA_DIRECTORY);

  // The legacy directory is the rollback path; report it even when there is
  // nothing left to copy.
  if (fsImpl.existsSync(legacyDir) && !result.backupPath) {
    result.backupPath = legacyDir;
  }

  try {
    const migration = maybeMigrateDesktopUserData({
      appName: DESKTOP_PRODUCT_NAME,
      appDataDir,
      fs: fsImpl,
    });
    if (migration.migrated) result.migrated = true;
    for (const fileName of migration.copied ?? []) {
      result.copied.push(`${USER_DATA_ARTIFACT_PREFIX}${fileName}`);
    }
    for (const fileName of migration.skipped ?? []) {
      result.skipped.push(`${USER_DATA_ARTIFACT_PREFIX}${fileName}`);
    }
  } catch (error) {
    recordError(result, 'user-data', error);
  }
}

function runWindowsLeg(result, { fsImpl, pathImpl, appDataDir, appVersion, installLocation, registry, paths }) {
  const startMenuDir =
    paths.startMenuDir ??
    pathImpl.join(appDataDir, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const taskbarDir =
    paths.taskbarPinnedDir ??
    pathImpl.join(appDataDir, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');

  const legacyStartMenuPath = pathImpl.join(startMenuDir, LEGACY_WINDOWS_START_MENU_SHORTCUT);
  const legacyTaskbarPath = pathImpl.join(taskbarDir, LEGACY_WINDOWS_TASKBAR_SHORTCUT);
  const legacyShortcutExists = fsImpl.existsSync(legacyStartMenuPath) || fsImpl.existsSync(legacyTaskbarPath);

  if (!registry) {
    result.skipped.push('windows-registry:no-adapter');
    return;
  }

  const legacyEntry = readRegistry(registry, LEGACY_WINDOWS_UNINSTALL_KEY);
  if (!legacyEntry && !legacyShortcutExists) {
    result.skipped.push('windows:no-legacy-install');
    return;
  }

  const startMenuPath = pathImpl.join(startMenuDir, WINDOWS_START_MENU_SHORTCUT);
  const taskbarPath = pathImpl.join(taskbarDir, WINDOWS_TASKBAR_SHORTCUT);

  migrateShortcut(result, {
    artifact: 'windows-start-menu',
    sourcePath: legacyStartMenuPath,
    targetPath: startMenuPath,
    fsImpl,
    pathImpl,
  });
  migrateShortcut(result, {
    artifact: 'windows-taskbar',
    sourcePath: legacyTaskbarPath,
    targetPath: taskbarPath,
    fsImpl,
    pathImpl,
  });

  const existingEntry = readRegistry(registry, WINDOWS_UNINSTALL_KEY);
  if (existingEntry && existingEntry.AppUserModelId === DESKTOP_APP_ID) {
    result.skipped.push('windows-registry:already-migrated');
    return;
  }

  const values = {
    DisplayName: DESKTOP_PRODUCT_NAME,
    DisplayVersion: String(appVersion),
    InstallLocation: installLocation || existingEntry?.InstallLocation || legacyEntry?.InstallLocation || '',
    AppUserModelId: DESKTOP_APP_ID,
    StartMenuShortcut: startMenuPath,
    TaskbarPinnedShortcut: taskbarPath,
    // Keep a readable pointer at the legacy uninstaller so support can roll
    // back; the legacy registry key itself is never removed.
    LegacyAppUserModelId: legacyEntry?.AppUserModelId || LEGACY_DESKTOP_APP_ID,
  };

  try {
    registry.write(WINDOWS_UNINSTALL_KEY, values);
    result.copied.push('windows-registry');
    result.migrated = true;
  } catch (error) {
    recordError(result, 'windows-registry', error);
  }
}

function runMacLeg(result, { keychain, keychainAccount }) {
  if (!keychain) {
    result.skipped.push('macos-keychain:no-adapter');
    return;
  }

  const existingEntry = readKeychain(keychain, { service: MACOS_KEYCHAIN_SERVICE });
  if (existingEntry) {
    result.skipped.push('macos-keychain:already-migrated');
    return;
  }

  const legacyEntry = readKeychain(keychain, { service: LEGACY_MACOS_KEYCHAIN_SERVICE });
  if (!legacyEntry) {
    result.skipped.push('macos-keychain:no-legacy-entry');
    return;
  }

  try {
    keychain.write({
      service: MACOS_KEYCHAIN_SERVICE,
      account: legacyEntry.account || keychainAccount,
      password: legacyEntry.password,
    });
    result.copied.push('macos-keychain');
    result.migrated = true;
  } catch (error) {
    // The legacy keychain entry is still there, so the old bundle id keeps
    // working: this is the documented rollback path.
    recordError(result, 'macos-keychain', error);
  }
}

function runLinuxLeg(result, { fsImpl, pathImpl, homeDir, execPath, paths }) {
  const applicationsDir =
    paths.applicationsDir ?? pathImpl.join(homeDir, '.local', 'share', 'applications');
  const legacyPath = pathImpl.join(applicationsDir, LEGACY_LINUX_DESKTOP_FILE_NAME);
  const targetPath = pathImpl.join(applicationsDir, LINUX_DESKTOP_FILE_NAME);

  if (fsImpl.existsSync(targetPath)) {
    result.skipped.push('linux-desktop-entry:already-migrated');
    return;
  }
  if (!fsImpl.existsSync(legacyPath)) {
    result.skipped.push('linux-desktop-entry:no-legacy-entry');
    return;
  }

  try {
    fsImpl.mkdirSync(applicationsDir, { recursive: true });
    fsImpl.writeFileSync(targetPath, renderLinuxDesktopEntry({ execPath }));
    result.copied.push('linux-desktop-entry');
    result.migrated = true;
  } catch (error) {
    // The legacy `.desktop` file is untouched, so the old launcher still works.
    recordError(result, 'linux-desktop-entry', error);
  }
}

/**
 * Renders the v3.0 Linux desktop entry. `StartupWMClass` carries the Electron
 * WM_CLASS (the product name); the app id is exposed as `X-Cloudpit-AppId` so
 * the identity is greppable without breaking window grouping.
 */
export function renderLinuxDesktopEntry({ execPath = 'cloudpit-desktop' } = {}) {
  const execTarget = /\s/.test(execPath) ? `"${execPath}"` : execPath;
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${DESKTOP_PRODUCT_NAME}`,
    `Comment=${DESKTOP_PRODUCT_NAME} desktop`,
    `Exec=${execTarget} %U`,
    'Terminal=false',
    'Categories=Development;',
    `StartupWMClass=${LINUX_DESKTOP_STARTUP_WM_CLASS}`,
    `X-Cloudpit-AppId=${DESKTOP_APP_ID}`,
    '',
  ].join('\n');
}

function migrateShortcut(result, { artifact, sourcePath, targetPath, fsImpl, pathImpl }) {
  if (fsImpl.existsSync(targetPath)) {
    result.skipped.push(`${artifact}:already-migrated`);
    return;
  }
  if (!fsImpl.existsSync(sourcePath)) {
    result.skipped.push(`${artifact}:no-legacy-entry`);
    return;
  }
  try {
    fsImpl.mkdirSync(pathImpl.dirname(targetPath), { recursive: true });
    fsImpl.copyFileSync(sourcePath, targetPath);
    result.copied.push(artifact);
    result.migrated = true;
  } catch (error) {
    recordError(result, artifact, error);
  }
}

function readRegistry(registry, key) {
  try {
    return registry.read(key) ?? null;
  } catch {
    return null;
  }
}

function readKeychain(keychain, entry) {
  try {
    return keychain.read(entry) ?? null;
  } catch {
    return null;
  }
}

function recordError(result, artifact, error) {
  if (result.error) return;
  result.error = {
    artifact,
    code: typeof error?.code === 'string' ? error.code : 'migration-failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Windows registry adapter backed by `reg.exe`. Reads are best-effort (`null`
 * when the key is absent or the CLI is unavailable); writes throw so the
 * caller can record the fallback reading.
 */
export function createWindowsRegistryAdapter({ execFileSync: exec = defaultExecFileSync, hive = 'HKCU' } = {}) {
  return {
    read(key) {
      try {
        const output = exec('reg', ['query', `${hive}\\${key}`, '/s'], {
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        return parseWindowsRegistryQuery(output);
      } catch {
        return null;
      }
    },
    write(key, values) {
      for (const [name, value] of Object.entries(values)) {
        exec(
          'reg',
          ['add', `${hive}\\${key}`, '/v', name, '/t', 'REG_SZ', '/d', String(value), '/f'],
          { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
        );
      }
    },
  };
}

/** Parses `reg query <key> /s` output into a value map (null when empty). */
export function parseWindowsRegistryQuery(output) {
  const values = {};
  for (const line of String(output ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s{2,}(\S(?:.*?\S)?)\s+(REG_[A-Z_]+)\s+(.*)$/);
    if (!match) continue;
    const [, name, , value] = match;
    if (name === '(Default)') continue;
    values[name] = value;
  }
  return Object.keys(values).length > 0 ? values : null;
}

/**
 * macOS keychain adapter backed by the `security` CLI. The legacy item is
 * read with `-w` and copied under the new service; the legacy item is never
 * deleted.
 */
export function createMacKeychainAdapter({ execFileSync: exec = defaultExecFileSync } = {}) {
  function run(args) {
    return exec('security', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  }

  return {
    read({ service, account } = {}) {
      try {
        const args = ['find-generic-password', '-s', service];
        if (account) args.push('-a', account);
        args.push('-w');
        const password = run(args);
        return password ? { service, account: account ?? '', password } : null;
      } catch {
        return null;
      }
    },
    write({ service, account, password }) {
      run(['add-generic-password', '-U', '-s', service, '-a', account || DESKTOP_PRODUCT_NAME, '-w', password]);
    },
  };
}
