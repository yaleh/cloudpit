/**
 * Criterion file for GOAL-054 B3: the Cloudpit desktop identity migration
 * (AC-453).
 *
 *   npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-desktop-identity.test.mjs
 *
 * Covers the flipped display identity (`APP_NAME` / `productName`), the
 * one-time userData copy (now owned by `appIdMigration.js`), the movable
 * local-server cache, the new-then-legacy marker lookup, dual deep-link scheme
 * registration, the v3.0 `appId` switch, and the pinned cloud-contract
 * invariants (`cloudcli://auth/callback`, `app_surface=cloudcli_desktop`).
 * File operations use real temp directories; only the failing-rename arm
 * injects an `fs` whose `rename` rejects.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SERVER_MARKER_PATHS, readServerMarkerUrl } from '../localServer.js';
import {
  DEFAULT_INSTALL_ROOT,
  LEGACY_INSTALL_ROOT,
  migrateLegacyVersionDir,
} from '../serverInstaller.js';
import { DESKTOP_USER_DATA_FILES, maybeMigrateDesktopUserData } from '../userDataMigration.js';

const ELECTRON_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(ELECTRON_DIR, '..', '..');
const MAIN_SOURCE_PATH = path.join(ELECTRON_DIR, '..', 'main.js');
const CLOUD_SOURCE_PATH = path.join(ELECTRON_DIR, '..', 'cloud.js');
const LOCAL_SERVER_SOURCE_PATH = path.join(ELECTRON_DIR, '..', 'localServer.js');
const SERVER_INDEX_PATH = path.join(REPO_ROOT, 'server', 'index.ts');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

function readPackageJson() {
  return JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
}

function makeTempDir(t, prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeServerInstallFixture(t) {
  const root = makeTempDir(t, 'cloudpit-server-install-');
  const version = '9.9.9';
  const legacyVersionDir = path.join(root, '.cloudcli', 'server', version);
  const versionDir = path.join(root, '.cloudpit', 'server', version);

  mkdirSync(path.join(legacyVersionDir, 'dist-server', 'server'), { recursive: true });
  writeFileSync(path.join(legacyVersionDir, 'dist-server', 'server', 'index.js'), '// local server entry\n');
  writeFileSync(
    path.join(legacyVersionDir, '.installed.json'),
    JSON.stringify({ version, installedAt: '2026-01-01T00:00:00.000Z' }),
  );

  return { legacyVersionDir, versionDir };
}

test('AC2/AC7: main.js names the app Cloudpit while pinning the cloud identity', () => {
  const source = readFileSync(MAIN_SOURCE_PATH, 'utf8');

  assert.match(source, /const APP_NAME = 'Cloudpit';/, 'APP_NAME is Cloudpit');
  assert.match(
    source,
    /const APP_USER_MODEL_ID = 'ai\.cloudpit\.desktop';/,
    'the Windows app user model id follows the v3.0 app id',
  );
  assert.match(source, /const CALLBACK_PROTOCOL = 'cloudcli';/, 'the cloud callback scheme is unchanged');
  assert.ok(
    source.includes('const CALLBACK_URL = `${CALLBACK_PROTOCOL}://auth/callback`;'),
    'the cloud callback URL is unchanged',
  );
  assert.equal(
    source.includes('cloudpit://auth/callback'),
    false,
    'the cloud callback must not move to the cloudpit scheme',
  );
});

test('AC3: bootstrap wires the app-id migration (and its userData copy) before app.whenReady()', () => {
  const source = readFileSync(MAIN_SOURCE_PATH, 'utf8');

  assert.match(
    source,
    /import \{ maybeMigrateDesktopAppId \} from '\.\/appIdMigration\.js';/,
    'the v3.0 app-id migration entry point is imported',
  );

  const bootstrapStart = source.indexOf('async function bootstrap()');
  assert.ok(bootstrapStart >= 0, 'bootstrap() exists');
  const bootstrapSource = source.slice(bootstrapStart, source.indexOf('\n}', bootstrapStart));

  const titleIndex = bootstrapSource.indexOf('process.title = APP_NAME');
  const callIndex = bootstrapSource.indexOf('maybeMigrateDesktopAppId({');
  const readyIndex = bootstrapSource.indexOf('await app.whenReady()');
  assert.ok(titleIndex >= 0, 'the app name is assigned first');
  assert.ok(callIndex > titleIndex, 'migration runs after the app name is assigned');
  assert.ok(readyIndex > callIndex, 'migration runs before app.whenReady()');

  const callSource = bootstrapSource.slice(callIndex, readyIndex);
  assert.match(callSource, /appDataDir: app\.getPath\('appData'\)/, 'the call targets appData');

  // appIdMigration owns the three-file userData copy and still goes through the
  // shared, app-name-guarded helper.
  const migrationSource = readFileSync(path.join(ELECTRON_DIR, '..', 'appIdMigration.js'), 'utf8');
  assert.match(
    migrationSource,
    /import \{[^}]*maybeMigrateDesktopUserData[^}]*\} from '\.\/userDataMigration\.js';/,
    'the app-id migration reuses the userData helper',
  );
  assert.match(migrationSource, /appName: DESKTOP_PRODUCT_NAME,/, 'the helper runs under the Cloudpit name');
});

test('AC2: package.json names the app Cloudpit', () => {
  const pkg = readPackageJson();

  assert.equal(pkg.productName, 'Cloudpit');
  assert.equal(pkg.build.productName, 'Cloudpit');
});

test('AC3: first launch copies exactly the three JSON files and never overwrites edits', (t) => {
  const appDataDir = makeTempDir(t, 'cloudpit-identity-userdata-');
  const oldUserDataDir = path.join(appDataDir, 'CloudCLI');
  const newUserDataDir = path.join(appDataDir, 'Cloudpit');

  mkdirSync(oldUserDataDir, { recursive: true });
  for (const fileName of DESKTOP_USER_DATA_FILES) {
    writeFileSync(path.join(oldUserDataDir, fileName), JSON.stringify({ file: fileName }));
  }
  writeFileSync(path.join(oldUserDataDir, 'cache.bin'), 'not-a-user-data-file');

  const first = maybeMigrateDesktopUserData({ appName: 'Cloudpit', appDataDir });
  assert.equal(first.migrated, true);
  assert.deepEqual(first.copied, DESKTOP_USER_DATA_FILES);
  assert.deepEqual(first.skipped, []);
  assert.deepEqual(readdirSync(newUserDataDir).sort(), [...DESKTOP_USER_DATA_FILES].sort());
  assert.equal(existsSync(path.join(newUserDataDir, 'cache.bin')), false, 'cache.bin is never copied');

  const editedFile = path.join(newUserDataDir, 'cloud-account.json');
  writeFileSync(editedFile, '{"edited":true}');
  const second = maybeMigrateDesktopUserData({ appName: 'Cloudpit', appDataDir });
  assert.equal(second.migrated, false);
  assert.deepEqual(second.copied, [], 'a second launch copies nothing');
  assert.deepEqual(second.skipped, DESKTOP_USER_DATA_FILES);
  assert.equal(readFileSync(editedFile, 'utf8'), '{"edited":true}', 'the edited target is not overwritten');
});

test('AC4: the server cache moves from ~/.cloudcli/server to ~/.cloudpit/server', async (t) => {
  assert.ok(DEFAULT_INSTALL_ROOT.endsWith(path.join('.cloudpit', 'server')));
  assert.ok(LEGACY_INSTALL_ROOT.endsWith(path.join('.cloudcli', 'server')));

  const { legacyVersionDir, versionDir } = makeServerInstallFixture(t);
  const result = await migrateLegacyVersionDir({ legacyVersionDir, versionDir });

  assert.deepEqual(result, { migrated: true, reason: 'moved' });
  assert.equal(existsSync(path.join(versionDir, 'dist-server', 'server', 'index.js')), true);
  assert.equal(existsSync(legacyVersionDir), false, 'the legacy version directory is gone');
});

test('AC4: a failed rename leaves no target so ensureInstalled() can download again', async (t) => {
  const { legacyVersionDir, versionDir } = makeServerInstallFixture(t);

  const failingFs = {
    access: (...args) => fsPromises.access(...args),
    mkdir: (...args) => fsPromises.mkdir(...args),
    rename: async () => {
      throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
    },
    rm: (...args) => fsPromises.rm(...args),
  };

  const result = await migrateLegacyVersionDir({ legacyVersionDir, versionDir, fs: failingFs });

  assert.deepEqual(result, { migrated: false, reason: 'rename-failed' });
  assert.equal(existsSync(versionDir), false, 'no partial target is left behind');
  assert.equal(existsSync(legacyVersionDir), true, 'the legacy directory is untouched');
});

test('AC5: the marker reader prefers the new path and falls back to the legacy path', async (t) => {
  assert.ok(SERVER_MARKER_PATHS[0].endsWith(path.join('.cloudpit', 'local-server.json')));
  assert.ok(SERVER_MARKER_PATHS[1].endsWith(path.join('.cloudcli', 'local-server.json')));

  const root = makeTempDir(t, 'cloudpit-marker-');
  const newMarker = path.join(root, '.cloudpit', 'local-server.json');
  const oldMarker = path.join(root, '.cloudcli', 'local-server.json');
  mkdirSync(path.dirname(newMarker), { recursive: true });
  mkdirSync(path.dirname(oldMarker), { recursive: true });

  writeFileSync(oldMarker, JSON.stringify({ url: 'http://127.0.0.1:4001' }));
  assert.equal(
    await readServerMarkerUrl({ markerPaths: [newMarker, oldMarker] }),
    'http://127.0.0.1:4001',
    'a marker written by the previous build is still discovered',
  );

  writeFileSync(newMarker, JSON.stringify({ url: 'http://127.0.0.1:4002' }));
  assert.equal(
    await readServerMarkerUrl({ markerPaths: [newMarker, oldMarker] }),
    'http://127.0.0.1:4002',
    'the new path wins when both markers exist',
  );

  assert.equal(
    await readServerMarkerUrl({
      markerPaths: [path.join(root, 'missing-new.json'), path.join(root, 'missing-old.json')],
    }),
    null,
  );
});

test('AC5: readServerMarkerUrl defaults to the ordered SERVER_MARKER_PATHS list', () => {
  const source = readFileSync(LOCAL_SERVER_SOURCE_PATH, 'utf8');

  assert.match(
    source,
    /markerPaths = SERVER_MARKER_PATHS/,
    'the default lookup keeps the whole new-then-legacy list',
  );
});

test('AC5: server/index.ts writes the marker under .cloudpit', () => {
  const source = readFileSync(SERVER_INDEX_PATH, 'utf8');

  assert.match(
    source,
    /const LOCAL_SERVER_MARKER_PATH = path\.join\(os\.homedir\(\), '\.cloudpit', 'local-server\.json'\);/,
  );
});

test('AC6: the packaged app metadata still claims both schemes (cloudcli stays for the auth callback)', () => {
  const pkg = readPackageJson();

  // R5 retires the cloudcli DEEP LINK (main.js registers only cloudpit), but the
  // third-party login callback `cloudcli://auth/callback` must still reach the
  // app, so the OS-level declaration keeps the legacy scheme.
  const protocolSchemes = pkg.build.protocols.flatMap((protocol) => protocol.schemes);
  assert.ok(protocolSchemes.includes('cloudcli'), 'build.protocols keeps cloudcli for cloudcli://auth/callback');
  assert.ok(protocolSchemes.includes('cloudpit'), 'build.protocols declares cloudpit');

  const macSchemes = pkg.build.mac.extendInfo.CFBundleURLTypes.flatMap((type) => type.CFBundleURLSchemes);
  assert.ok(macSchemes.includes('cloudcli'), 'mac CFBundleURLSchemes keeps cloudcli for the auth callback');
  assert.ok(macSchemes.includes('cloudpit'), 'mac CFBundleURLSchemes declares cloudpit');
});

test('AC6: main.js registers only the cloudpit deep link and still parses the cloudcli callback', () => {
  const source = readFileSync(MAIN_SOURCE_PATH, 'utf8');

  assert.match(source, /const DEEP_LINK_SCHEMES = \['cloudpit'\];/);
  assert.match(source, /const CALLBACK_PROTOCOL = 'cloudcli';/);
  assert.match(source, /const CALLBACK_URL = `\$\{CALLBACK_PROTOCOL\}:\/\/auth\/callback`;/);

  const start = source.indexOf('function registerProtocolHandler()');
  assert.ok(start >= 0, 'registerProtocolHandler() exists');
  const registerSource = source.slice(start, source.indexOf('\n}', start));

  assert.match(registerSource, /for \(const scheme of DEEP_LINK_SCHEMES\)/);
  assert.match(
    registerSource,
    /app\.setAsDefaultProtocolClient\(scheme, process\.execPath, \[appEntry\]\)/,
    'the dev branch registers every scheme',
  );
  assert.match(
    registerSource,
    /app\.setAsDefaultProtocolClient\(scheme\);/,
    'the packaged branch registers every scheme',
  );

  // The cloudcli callback is still PARSED even though it is no longer registered
  // as a deep link here; the OS association comes from build.protocols above.
  const handleStart = source.indexOf('async function handleDeepLink(');
  assert.ok(handleStart >= 0, 'handleDeepLink() exists');
  const handleSource = source.slice(handleStart, source.indexOf('\n}', handleStart));
  assert.match(handleSource, /parsed\.protocol !== `\$\{CALLBACK_PROTOCOL\}:`/);
  assert.match(handleSource, /parsed\.hostname !== 'auth'/);
});

test('AC7: appId follows the v3.0 identity while the cloudcli_desktop surface is unchanged', () => {
  const pkg = readPackageJson();
  assert.equal(pkg.build.appId, 'ai.cloudpit.desktop');

  const cloudSource = readFileSync(CLOUD_SOURCE_PATH, 'utf8');
  assert.match(cloudSource, /app_surface', 'cloudcli_desktop'\)/);
  assert.equal(cloudSource.includes('cloudpit://auth/callback'), false);

  const mainSource = readFileSync(MAIN_SOURCE_PATH, 'utf8');
  assert.equal(mainSource.includes('cloudpit://auth/callback'), false);
});
