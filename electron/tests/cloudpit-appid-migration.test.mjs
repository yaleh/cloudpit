/**
 * Criterion file for the v3.0 desktop app-id switch (R13 of the Cloudpit
 * retirement plan).
 *
 *   npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-appid-migration.test.mjs
 *
 * Every platform arm injects an in-memory `fs`, a fake registry and a fake
 * keychain, so the criterion never reads or writes the host's real registry or
 * keychain. The three assertions each platform must carry are: the new target
 * values, the legacy installation/entry kept intact, and a readable fallback
 * when the write fails. The userData arm drives the same three-file copy that
 * `electron/userDataMigration.js` already owns.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DESKTOP_APP_ID,
  DESKTOP_PRODUCT_NAME,
  LEGACY_DESKTOP_APP_ID,
  LEGACY_MACOS_KEYCHAIN_SERVICE,
  LEGACY_WINDOWS_UNINSTALL_KEY,
  LINUX_DESKTOP_FILE_NAME,
  LEGACY_LINUX_DESKTOP_FILE_NAME,
  MACOS_BUNDLE_IDENTIFIER,
  MACOS_KEYCHAIN_SERVICE,
  WINDOWS_UNINSTALL_KEY,
  createAppIdMigration,
  migrateAppId,
  parseWindowsRegistryQuery,
  renderLinuxDesktopEntry,
} from '../appIdMigration.js';
import { DESKTOP_USER_DATA_FILES } from '../userDataMigration.js';

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ELECTRON_DIR, '..', '..');
const MAIN_SOURCE_PATH = path.join(ELECTRON_DIR, '..', 'main.js');
const PREPARE_DESKTOP_SOURCE_PATH = path.join(REPO_ROOT, 'scripts', 'release', 'prepare-desktop-app.js');
const CLOUD_SOURCE_PATH = path.join(ELECTRON_DIR, '..', 'cloud.js');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

const APP_DATA_DIR = '/home/fixture/AppData/Roaming';
const HOME_DIR = '/home/fixture';

function readPackageJson() {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}

/** In-memory node:fs sync subset; nothing touches the host filesystem. */
function createFakeFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  const dirs = new Set(['/']);

  for (const filePath of files.keys()) {
    let current = path.posix.dirname(filePath);
    while (current && current !== '/') {
      dirs.add(current);
      current = path.posix.dirname(current);
    }
  }

  const calls = { copyFileSync: [], mkdirSync: [], writeFileSync: [] };

  const fsImpl = {
    files,
    dirs,
    calls,
    existsSync(target) {
      return files.has(target) || dirs.has(target);
    },
    mkdirSync(target, options = {}) {
      calls.mkdirSync.push([target, options]);
      let current = target;
      while (current && current !== '/') {
        dirs.add(current);
        if (!options.recursive) break;
        current = path.posix.dirname(current);
      }
    },
    copyFileSync(from, to) {
      calls.copyFileSync.push([from, to]);
      if (!files.has(from)) {
        throw Object.assign(new Error(`ENOENT: no such file: ${from}`), { code: 'ENOENT' });
      }
      files.set(to, files.get(from));
    },
    writeFileSync(target, content) {
      calls.writeFileSync.push([target, content]);
      files.set(target, content);
    },
    readFileSync(target) {
      if (!files.has(target)) {
        throw Object.assign(new Error(`ENOENT: no such file: ${target}`), { code: 'ENOENT' });
      }
      return files.get(target);
    },
  };

  return fsImpl;
}

function createFakeRegistry(initialEntries = {}) {
  const entries = new Map(
    Object.entries(initialEntries).map(([key, values]) => [key, { ...values }]),
  );
  const api = {
    writes: [],
    get(key) {
      return entries.has(key) ? { ...entries.get(key) } : null;
    },
    read(key) {
      return api.get(key);
    },
    write(key, values) {
      api.writes.push({ key, values: { ...values } });
      entries.set(key, { ...values });
    },
  };
  return api;
}

function createFakeKeychain(initialEntries = {}) {
  const entries = new Map(
    Object.entries(initialEntries).map(([service, entry]) => [service, { ...entry }]),
  );
  const api = {
    writes: [],
    get(service) {
      return entries.has(service) ? { ...entries.get(service) } : null;
    },
    read({ service } = {}) {
      return api.get(service);
    },
    write(entry) {
      api.writes.push({ ...entry });
      entries.set(entry.service, { ...entry });
    },
  };
  return api;
}

function baseOptions(fsImpl, overrides = {}) {
  return {
    platform: 'linux',
    fs: fsImpl,
    path: path.posix,
    appDataDir: APP_DATA_DIR,
    homeDir: HOME_DIR,
    appVersion: '3.0.0',
    execPath: '/opt/cloudpit/cloudpit-desktop',
    installLocation: 'C:\\Program Files\\Cloudpit',
    includeUserData: false,
    ...overrides,
  };
}

// ── AC1: the appId switch and the prepare script ──────────────────────────

test('AC1: package.json/build.appId, main.js APP_USER_MODEL_ID and the migration constants agree', () => {
  const pkg = readPackageJson();
  assert.equal(pkg.build.appId, 'ai.cloudpit.desktop');
  assert.equal(DESKTOP_APP_ID, pkg.build.appId);
  assert.equal(MACOS_BUNDLE_IDENTIFIER, pkg.build.appId, 'the macOS bundle id follows appId');

  // electron-builder derives CFBundleIdentifier from build.appId; an override
  // would silently break the "follows appId" rule.
  assert.equal(pkg.build.mac.extendInfo?.CFBundleIdentifier, undefined);

  const mainSource = readFileSync(MAIN_SOURCE_PATH, 'utf8');
  assert.match(mainSource, /const APP_USER_MODEL_ID = 'ai\.cloudpit\.desktop';/);
  assert.match(mainSource, /app\.setAppUserModelId\(APP_USER_MODEL_ID\)/);
});

test('AC1: prepare-desktop-app.js reads build.appId from package.json without a hard-coded id', () => {
  const source = readFileSync(PREPARE_DESKTOP_SOURCE_PATH, 'utf8');
  assert.equal(/ai\.cloudcli\.desktop/.test(source), false, 'no legacy id literal');
  assert.equal(/ai\.cloudpit\.desktop/.test(source), false, 'no new id literal either');
  assert.match(source, /appId: packageJson\.build\.appId,/);
});

test('AC1: main.js runs the app-id migration inside bootstrap() before app.whenReady()', () => {
  const source = readFileSync(MAIN_SOURCE_PATH, 'utf8');
  assert.match(source, /import \{ maybeMigrateDesktopAppId \} from '\.\/appIdMigration\.js';/);

  const bootstrapStart = source.indexOf('async function bootstrap()');
  assert.ok(bootstrapStart >= 0);
  const bootstrapSource = source.slice(bootstrapStart, source.indexOf('\n}', bootstrapStart));
  const callIndex = bootstrapSource.indexOf('maybeMigrateDesktopAppId({');
  const readyIndex = bootstrapSource.indexOf('await app.whenReady()');
  assert.ok(callIndex >= 0, 'the migration is called');
  assert.ok(readyIndex > callIndex, 'the migration runs before the app is ready');
});

// ── AC2 / AC3: userData three-file copy ───────────────────────────────────

test('AC3: the three JSON files move from CloudCLI to Cloudpit; edits win; the old directory survives', () => {
  const legacyDir = path.posix.join(APP_DATA_DIR, 'CloudCLI');
  const targetDir = path.posix.join(APP_DATA_DIR, 'Cloudpit');
  const fsImpl = createFakeFs({
    [`${legacyDir}/cloud-account.json`]: '{"email":"old@example.com"}',
    [`${legacyDir}/desktop-settings.json`]: '{"theme":"dark"}',
    [`${legacyDir}/desktop-notifications-settings.json`]: '{"enabled":true}',
    [`${legacyDir}/cache.bin`]: 'never-copied',
  });

  const first = migrateAppId(baseOptions(fsImpl, { includeUserData: true }));
  assert.equal(first.migrated, true);
  assert.deepEqual(
    first.copied,
    DESKTOP_USER_DATA_FILES.map((fileName) => `user-data:${fileName}`),
  );
  assert.deepEqual(
    first.skipped,
    ['linux-desktop-entry:no-legacy-entry'],
    'the Linux leg has no legacy entry in this fixture',
  );
  assert.equal(first.error, null);
  assert.equal(first.backupPath, legacyDir, 'the legacy directory is the rollback path');

  for (const fileName of DESKTOP_USER_DATA_FILES) {
    assert.equal(fsImpl.files.has(`${targetDir}/${fileName}`), true, `${fileName} was copied`);
    assert.equal(fsImpl.files.has(`${legacyDir}/${fileName}`), true, `${fileName} stays in the legacy directory`);
  }
  assert.equal(fsImpl.files.has(`${targetDir}/cache.bin`), false, 'cache.bin is never copied');

  // A user edit in the target must survive the next launch.
  fsImpl.files.set(`${targetDir}/cloud-account.json`, '{"email":"new@example.com"}');
  const second = migrateAppId(baseOptions(fsImpl, { includeUserData: true }));
  assert.equal(second.migrated, false);
  assert.deepEqual(second.copied, []);
  assert.deepEqual(
    second.skipped,
    [
      ...DESKTOP_USER_DATA_FILES.map((fileName) => `user-data:${fileName}`),
      'linux-desktop-entry:no-legacy-entry',
    ],
  );
  assert.equal(fsImpl.files.get(`${targetDir}/cloud-account.json`), '{"email":"new@example.com"}');
});

test('AC2: a failed userData copy reports a fallback reading and leaves the legacy files usable', () => {
  const legacyDir = path.posix.join(APP_DATA_DIR, 'CloudCLI');
  const fsImpl = createFakeFs({
    [`${legacyDir}/cloud-account.json`]: '{"email":"old@example.com"}',
    [`${legacyDir}/desktop-settings.json`]: '{"theme":"dark"}',
    [`${legacyDir}/desktop-notifications-settings.json`]: '{"enabled":true}',
  });
  fsImpl.copyFileSync = () => {
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  };

  const result = migrateAppId(baseOptions(fsImpl, { includeUserData: true }));
  assert.equal(result.migrated, false);
  assert.deepEqual(result.error, {
    artifact: 'user-data',
    code: 'EACCES',
    message: 'EACCES: permission denied',
  });
  assert.equal(result.backupPath, legacyDir);
  for (const fileName of DESKTOP_USER_DATA_FILES) {
    assert.equal(fsImpl.files.has(`${legacyDir}/${fileName}`), true, `${fileName} is untouched`);
  }
});

// ── AC4: Windows registry + start menu + taskbar ──────────────────────────

function windowsFixture() {
  const startMenuDir = path.posix.join(APP_DATA_DIR, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const taskbarDir = path.posix.join(
    APP_DATA_DIR,
    'Microsoft',
    'Internet Explorer',
    'Quick Launch',
    'User Pinned',
    'TaskBar',
  );
  const legacyEntry = {
    DisplayName: 'CloudCLI',
    AppUserModelId: LEGACY_DESKTOP_APP_ID,
    InstallLocation: 'C:\\Program Files\\CloudCLI',
    UninstallString: '"C:\\Program Files\\CloudCLI\\Uninstall CloudCLI.exe"',
  };
  const fsImpl = createFakeFs({
    [`${startMenuDir}/CloudCLI.lnk`]: 'legacy-start-menu-shortcut',
    [`${taskbarDir}/CloudCLI.lnk`]: 'legacy-taskbar-shortcut',
  });
  const registry = createFakeRegistry({ [LEGACY_WINDOWS_UNINSTALL_KEY]: legacyEntry });
  const options = baseOptions(fsImpl, {
    platform: 'win32',
    registry,
    paths: { startMenuDir, taskbarPinnedDir: taskbarDir },
  });
  return { fsImpl, registry, options, startMenuDir, taskbarDir, legacyEntry };
}

test('AC4/Windows: the new appId key and shortcuts are written; the legacy install is preserved', () => {
  const { fsImpl, registry, options, startMenuDir, taskbarDir, legacyEntry } = windowsFixture();

  const first = migrateAppId(options);
  assert.equal(first.migrated, true);
  assert.deepEqual(first.copied, ['windows-start-menu', 'windows-taskbar', 'windows-registry']);
  assert.equal(first.error, null);

  const newEntry = registry.get(WINDOWS_UNINSTALL_KEY);
  assert.equal(newEntry.DisplayName, DESKTOP_PRODUCT_NAME);
  assert.equal(newEntry.AppUserModelId, DESKTOP_APP_ID);
  assert.equal(newEntry.DisplayVersion, '3.0.0');
  assert.equal(newEntry.InstallLocation, 'C:\\Program Files\\Cloudpit');
  assert.equal(newEntry.StartMenuShortcut, `${startMenuDir}/Cloudpit.lnk`);
  assert.equal(newEntry.TaskbarPinnedShortcut, `${taskbarDir}/Cloudpit.lnk`);

  assert.deepEqual(registry.get(LEGACY_WINDOWS_UNINSTALL_KEY), legacyEntry, 'the legacy uninstall key is untouched');
  assert.equal(fsImpl.files.get(`${startMenuDir}/CloudCLI.lnk`), 'legacy-start-menu-shortcut');
  assert.equal(fsImpl.files.get(`${taskbarDir}/CloudCLI.lnk`), 'legacy-taskbar-shortcut');
  assert.equal(fsImpl.files.get(`${startMenuDir}/Cloudpit.lnk`), 'legacy-start-menu-shortcut');
  assert.equal(fsImpl.files.get(`${taskbarDir}/Cloudpit.lnk`), 'legacy-taskbar-shortcut');

  const writesBefore = registry.writes.length;
  const second = migrateAppId(options);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.copied, []);
  assert.deepEqual(second.skipped, [
    'windows-start-menu:already-migrated',
    'windows-taskbar:already-migrated',
    'windows-registry:already-migrated',
  ]);
  assert.equal(registry.writes.length, writesBefore, 'a second run writes nothing');
});

test('AC4/Windows: a registry write failure falls back to the legacy install', () => {
  const { registry, options, legacyEntry } = windowsFixture();
  registry.write = () => {
    throw Object.assign(new Error('registry write denied'), { code: 'EACCES' });
  };

  const result = migrateAppId(options);
  assert.equal(result.migrated, true, 'the shortcut copies still succeeded');
  assert.deepEqual(result.error, {
    artifact: 'windows-registry',
    code: 'EACCES',
    message: 'registry write denied',
  });
  assert.equal(registry.get(WINDOWS_UNINSTALL_KEY), null, 'no partial new key is left behind');
  assert.deepEqual(registry.get(LEGACY_WINDOWS_UNINSTALL_KEY), legacyEntry);
});

test('AC4/Windows: a machine with no legacy install is left alone', () => {
  const startMenuDir = path.posix.join(APP_DATA_DIR, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const taskbarDir = path.posix.join(APP_DATA_DIR, 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar');
  const fsImpl = createFakeFs();
  const registry = createFakeRegistry();

  const result = migrateAppId(
    baseOptions(fsImpl, { platform: 'win32', registry, paths: { startMenuDir, taskbarPinnedDir: taskbarDir } }),
  );
  assert.equal(result.migrated, false);
  assert.deepEqual(result.copied, []);
  assert.deepEqual(result.skipped, ['windows:no-legacy-install']);
  assert.equal(registry.writes.length, 0);
});

test('parseWindowsRegistryQuery: reg query rows become a value map', () => {
  const output = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\ai.cloudpit.desktop',
    '    DisplayName    REG_SZ    Cloudpit',
    '    AppUserModelId    REG_SZ    ai.cloudpit.desktop',
    '',
  ].join('\r\n');
  assert.deepEqual(parseWindowsRegistryQuery(output), {
    DisplayName: 'Cloudpit',
    AppUserModelId: 'ai.cloudpit.desktop',
  });
  assert.equal(parseWindowsRegistryQuery(''), null);
});

// ── AC4: macOS bundle id + keychain ──────────────────────────────────────

test('AC4/macOS: the keychain entry is copied to the new service and the legacy entry stays', () => {
  const keychain = createFakeKeychain({
    [LEGACY_MACOS_KEYCHAIN_SERVICE]: { account: 'yale@example.com', password: 'legacy-secret' },
  });
  const options = baseOptions(createFakeFs(), { platform: 'darwin', keychain });

  const first = migrateAppId(options);
  assert.equal(first.migrated, true);
  assert.deepEqual(first.copied, ['macos-keychain']);
  assert.deepEqual(keychain.get(MACOS_KEYCHAIN_SERVICE), {
    service: MACOS_KEYCHAIN_SERVICE,
    account: 'yale@example.com',
    password: 'legacy-secret',
  });
  assert.deepEqual(
    keychain.get(LEGACY_MACOS_KEYCHAIN_SERVICE),
    { account: 'yale@example.com', password: 'legacy-secret' },
    'the legacy keychain entry is never deleted',
  );

  const writesBefore = keychain.writes.length;
  const second = migrateAppId(options);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.copied, []);
  assert.deepEqual(second.skipped, ['macos-keychain:already-migrated']);
  assert.equal(keychain.writes.length, writesBefore);
});

test('AC4/macOS: a keychain write failure keeps the legacy entry usable', () => {
  const keychain = createFakeKeychain({
    [LEGACY_MACOS_KEYCHAIN_SERVICE]: { account: 'yale@example.com', password: 'legacy-secret' },
  });
  keychain.write = () => {
    throw Object.assign(new Error('keychain write denied'), { code: 'EACCES' });
  };

  const result = migrateAppId(baseOptions(createFakeFs(), { platform: 'darwin', keychain }));
  assert.equal(result.migrated, false);
  assert.deepEqual(result.error, {
    artifact: 'macos-keychain',
    code: 'EACCES',
    message: 'keychain write denied',
  });
  assert.equal(keychain.get(MACOS_KEYCHAIN_SERVICE), null);
  assert.deepEqual(keychain.get(LEGACY_MACOS_KEYCHAIN_SERVICE), {
    account: 'yale@example.com',
    password: 'legacy-secret',
  });
});

// ── AC4: Linux `.desktop` ────────────────────────────────────────────────

test('AC4/Linux: the new desktop entry carries the v3.0 identity and the legacy file survives', () => {
  const applicationsDir = path.posix.join(HOME_DIR, '.local', 'share', 'applications');
  const legacyPath = path.posix.join(applicationsDir, LEGACY_LINUX_DESKTOP_FILE_NAME);
  const targetPath = path.posix.join(applicationsDir, LINUX_DESKTOP_FILE_NAME);
  const legacyContent = '[Desktop Entry]\nName=CloudCLI\nStartupWMClass=CloudCLI\n';
  const fsImpl = createFakeFs({ [legacyPath]: legacyContent });
  const options = baseOptions(fsImpl, { paths: { applicationsDir } });

  const first = migrateAppId(options);
  assert.equal(first.migrated, true);
  assert.deepEqual(first.copied, ['linux-desktop-entry']);
  assert.equal(first.error, null);
  assert.equal(fsImpl.files.get(legacyPath), legacyContent, 'the legacy .desktop file is untouched');

  const target = fsImpl.files.get(targetPath);
  assert.ok(target, 'the new .desktop file exists');
  assert.match(target, /^Name=Cloudpit$/m);
  assert.match(target, /^StartupWMClass=Cloudpit$/m);
  assert.match(target, /^X-Cloudpit-AppId=ai\.cloudpit\.desktop$/m);
  assert.match(target, /^Exec=\/opt\/cloudpit\/cloudpit-desktop %U$/m);

  // A second run never overwrites an existing entry (the user may have edited it).
  fsImpl.files.set(targetPath, 'user-edited');
  const second = migrateAppId(options);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.copied, []);
  assert.deepEqual(second.skipped, ['linux-desktop-entry:already-migrated']);
  assert.equal(fsImpl.files.get(targetPath), 'user-edited');
});

test('AC4/Linux: a write failure keeps the legacy launcher working', () => {
  const applicationsDir = path.posix.join(HOME_DIR, '.local', 'share', 'applications');
  const legacyPath = path.posix.join(applicationsDir, LEGACY_LINUX_DESKTOP_FILE_NAME);
  const legacyContent = '[Desktop Entry]\nName=CloudCLI\n';
  const fsImpl = createFakeFs({ [legacyPath]: legacyContent });
  fsImpl.writeFileSync = () => {
    throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  };

  const result = migrateAppId(baseOptions(fsImpl, { paths: { applicationsDir } }));
  assert.equal(result.migrated, false);
  assert.deepEqual(result.error, {
    artifact: 'linux-desktop-entry',
    code: 'EACCES',
    message: 'EACCES: permission denied',
  });
  assert.equal(fsImpl.files.get(legacyPath), legacyContent);
  assert.equal(fsImpl.files.has(path.posix.join(applicationsDir, LINUX_DESKTOP_FILE_NAME)), false);
});

test('renderLinuxDesktopEntry quotes an Exec path that contains spaces', () => {
  const entry = renderLinuxDesktopEntry({ execPath: '/opt/cloud pit/cloudpit-desktop' });
  assert.match(entry, /^Exec="\/opt\/cloud pit\/cloudpit-desktop" %U$/m);
});

// ── AC5: the cloud contract is not collateral damage ─────────────────────

test('AC5: cloudcli://auth/callback and app_surface=cloudcli_desktop are still present', () => {
  const mainSource = readFileSync(MAIN_SOURCE_PATH, 'utf8');
  const cloudSource = readFileSync(CLOUD_SOURCE_PATH, 'utf8');

  assert.match(mainSource, /const CALLBACK_PROTOCOL = 'cloudcli';/);
  assert.ok(mainSource.includes('const CALLBACK_URL = `${CALLBACK_PROTOCOL}://auth/callback`;'));
  assert.match(cloudSource, /app_surface', 'cloudcli_desktop'\)/);
  assert.equal(mainSource.includes('cloudpit://auth/callback'), false);
  assert.equal(cloudSource.includes('cloudpit://auth/callback'), false);
});

// ── AC2: the injectable factory contract ────────────────────────────────

test('AC2: the factory requires an appDataDir and exposes one idempotent run()', () => {
  assert.throws(() => createAppIdMigration({}), /appDataDir/);

  const fsImpl = createFakeFs({ [`${APP_DATA_DIR}/CloudCLI/cloud-account.json`]: '{}' });
  const migration = createAppIdMigration(baseOptions(fsImpl, { includeUserData: true }));
  const first = migration.run();
  const second = migration.run();
  assert.equal(first.migrated, true);
  assert.equal(second.migrated, false);
  assert.deepEqual(second.copied, []);
  assert.equal(second.error, null);
});
