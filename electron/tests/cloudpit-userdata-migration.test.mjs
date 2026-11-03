/**
 * Criterion file for the desktop userData migration helper (GOAL-053 A3).
 *
 *   npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-userdata-migration.test.mjs
 *
 * Covers: copying exactly the three JSON files and nothing else, re-entrancy
 * (second call copies nothing and overwrites nothing), the CloudCLI app-name
 * guard leaving the filesystem untouched, and the source scan proving
 * `electron/main.js` imports and calls the helper and declares
 * `APP_NAME = 'Cloudpit'`.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DESKTOP_USER_DATA_FILES,
  maybeMigrateDesktopUserData,
  migrateDesktopUserData,
} from '../userDataMigration.js';

const MAIN_SOURCE_PATH = fileURLToPath(new URL('../main.js', import.meta.url));

function makeFixture(t) {
  const appDataDir = mkdtempSync(path.join(os.tmpdir(), 'cloudpit-userdata-'));
  t.after(() => rmSync(appDataDir, { recursive: true, force: true }));

  const oldUserDataDir = path.join(appDataDir, 'CloudCLI');
  const newUserDataDir = path.join(appDataDir, 'Cloudpit');
  mkdirSync(oldUserDataDir, { recursive: true });
  for (const fileName of DESKTOP_USER_DATA_FILES) {
    writeFileSync(path.join(oldUserDataDir, fileName), JSON.stringify({ file: fileName }));
  }
  writeFileSync(path.join(oldUserDataDir, 'cache.bin'), 'not-a-user-data-file');

  return { appDataDir, oldUserDataDir, newUserDataDir };
}

test('AC6: migration copies exactly the three JSON files, never the cache, and is idempotent', (t) => {
  const { appDataDir, newUserDataDir } = makeFixture(t);

  const first = migrateDesktopUserData({ appDataDir });
  assert.equal(first.migrated, true, 'the missing target directory is created');
  assert.deepEqual(first.copied, DESKTOP_USER_DATA_FILES, 'only the three declared files are copied');
  assert.deepEqual(first.skipped, []);

  assert.deepEqual(
    readdirSync(newUserDataDir).sort(),
    [...DESKTOP_USER_DATA_FILES].sort(),
    'the target holds exactly the three JSON files',
  );
  assert.equal(existsSync(path.join(newUserDataDir, 'cache.bin')), false, 'cache.bin must not be copied');

  // A user edit in the target must survive a second run.
  const editedFile = path.join(newUserDataDir, 'cloud-account.json');
  writeFileSync(editedFile, '{"edited":true}');
  const second = migrateDesktopUserData({ appDataDir });
  assert.equal(second.migrated, false, 'a second run creates nothing');
  assert.deepEqual(second.copied, [], 'a second run copies nothing');
  assert.deepEqual(second.skipped, DESKTOP_USER_DATA_FILES, 'existing targets are skipped');
  assert.equal(readFileSync(editedFile, 'utf8'), '{"edited":true}', 'the edited target is not overwritten');
});

test('AC6: a missing source directory does nothing at all', (t) => {
  const appDataDir = mkdtempSync(path.join(os.tmpdir(), 'cloudpit-userdata-missing-'));
  t.after(() => rmSync(appDataDir, { recursive: true, force: true }));

  const result = migrateDesktopUserData({ appDataDir });
  assert.deepEqual(result, { migrated: false, copied: [], skipped: [] });
  assert.equal(existsSync(path.join(appDataDir, 'Cloudpit')), false);
});

test('AC7: the CloudCLI app-name guard never touches the filesystem', (t) => {
  const { appDataDir, newUserDataDir } = makeFixture(t);

  const guarded = maybeMigrateDesktopUserData({ appName: 'CloudCLI', appDataDir });
  assert.deepEqual(
    guarded,
    { migrated: false, reason: 'app-name-not-flipped' },
    'the guard reports the unflipped app name',
  );
  assert.equal(existsSync(newUserDataDir), false, 'the guard creates no target directory');

  const flipped = maybeMigrateDesktopUserData({ appName: 'Cloudpit', appDataDir });
  assert.equal(flipped.migrated, true, 'a flipped app name runs the copy');
  assert.deepEqual(flipped.copied, DESKTOP_USER_DATA_FILES);
  assert.equal(existsSync(path.join(newUserDataDir, 'cache.bin')), false);
});

test('AC7: main.js runs the app-id migration, which reuses the guarded helper under Cloudpit', () => {
  const source = readFileSync(MAIN_SOURCE_PATH, 'utf8');

  assert.match(
    source,
    /import \{ maybeMigrateDesktopAppId \} from '\.\/appIdMigration\.js';/,
    'the v3.0 app-id migration entry point is imported',
  );
  assert.match(source, /maybeMigrateDesktopAppId\(\{/, 'the migration is called from bootstrap()');
  assert.match(source, /const APP_NAME = 'Cloudpit';/, 'APP_NAME is flipped to Cloudpit');

  // The three-file copy moved into the app-id migration in v3.0 but still goes
  // through the shared helper (and therefore through its app-name guard).
  const migrationSource = readFileSync(
    fileURLToPath(new URL('../appIdMigration.js', import.meta.url)),
    'utf8',
  );
  assert.match(
    migrationSource,
    /import \{[^}]*maybeMigrateDesktopUserData[^}]*\} from '\.\/userDataMigration\.js';/,
    'appIdMigration imports the helper',
  );
  assert.match(migrationSource, /maybeMigrateDesktopUserData\(\{/, 'appIdMigration calls the helper');
  assert.match(migrationSource, /appName: DESKTOP_PRODUCT_NAME,/, 'the helper runs under Cloudpit');
});
