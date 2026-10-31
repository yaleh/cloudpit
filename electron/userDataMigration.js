/**
 * Desktop userData migration helper.
 *
 * `electron/main.js` calls this from `bootstrap()` once the app name is
 * `Cloudpit`, before anything reads `app.getPath('userData')`; the legacy
 * `CloudCLI` folder is copied into the new `Cloudpit` folder. The guard arm in
 * `maybeMigrateDesktopUserData` keeps the helper inert if the app name is not
 * flipped, so the migration cannot run under the old identity.
 *
 * Only the three JSON files listed below may be copied. Caches, logs, and any
 * other userData entry are never touched, and an existing target file always
 * wins so the helper is safe to re-run.
 */
import fs from 'node:fs';
import path from 'node:path';

/** The only userData entries the migration may copy. */
export const DESKTOP_USER_DATA_FILES = [
  'cloud-account.json',
  'desktop-settings.json',
  'desktop-notifications-settings.json',
];

const LEGACY_APP_DATA_DIRECTORY_NAME = 'CloudCLI';
const CLOUDPIT_APP_DATA_DIRECTORY_NAME = 'Cloudpit';

/**
 * Copies the three desktop userData files from the CloudCLI folder into the
 * Cloudpit folder.
 *
 * - The target folder is created only when it does not exist and the source
 *   folder does exist.
 * - Each file is copied only when the source exists and the target does not.
 * - Re-entrant: a second call copies nothing and overwrites nothing.
 *
 * `fs` is injectable for tests; the default is `node:fs`'s sync API subset used
 * here (`existsSync`, `mkdirSync`, `copyFileSync`).
 *
 * @returns {{ migrated: boolean, copied: string[], skipped: string[] }}
 */
export function migrateDesktopUserData({
  appDataDir,
  oldUserDataDir,
  newUserDataDir,
  fs: fsImpl = fs,
} = {}) {
  const sourceDir = oldUserDataDir ?? path.join(appDataDir, LEGACY_APP_DATA_DIRECTORY_NAME);
  const targetDir = newUserDataDir ?? path.join(appDataDir, CLOUDPIT_APP_DATA_DIRECTORY_NAME);

  const copied = [];
  const skipped = [];

  if (!fsImpl.existsSync(sourceDir)) {
    return { migrated: false, copied, skipped };
  }

  let migrated = false;
  if (!fsImpl.existsSync(targetDir)) {
    fsImpl.mkdirSync(targetDir, { recursive: true });
    migrated = true;
  }

  for (const fileName of DESKTOP_USER_DATA_FILES) {
    const sourcePath = path.join(sourceDir, fileName);
    const targetPath = path.join(targetDir, fileName);
    if (!fsImpl.existsSync(sourcePath) || fsImpl.existsSync(targetPath)) {
      skipped.push(fileName);
      continue;
    }
    fsImpl.copyFileSync(sourcePath, targetPath);
    copied.push(fileName);
  }

  return { migrated, copied, skipped };
}

/**
 * Migration gate for the app-name flip (GOAL-054). While the app is still
 * called `CloudCLI` this returns a guard result without touching the
 * filesystem; any other name delegates to {@link migrateDesktopUserData}.
 *
 * @returns {{ migrated: boolean, reason: string } | { migrated: boolean, copied: string[], skipped: string[] }}
 */
export function maybeMigrateDesktopUserData({ appName, ...options } = {}) {
  if (appName === 'CloudCLI') {
    return { migrated: false, reason: 'app-name-not-flipped' };
  }
  return migrateDesktopUserData(options);
}
