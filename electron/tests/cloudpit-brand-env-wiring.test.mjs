/**
 * Criterion file for `gap-cloudpit-brand-env-reader-wiring` (v3.0 update).
 *
 *   npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-brand-env-wiring.test.mjs
 *
 * Electron cannot import `server/shared/brand.ts` (it runs plain JavaScript from
 * source), so the production wiring reads through `electron/brandEnv.js`. This
 * file holds the two things that keep that second implementation honest:
 *
 *   1. a cross-runtime PARITY table: one environment table drives both
 *      `createBrandEnvReader` implementations and compares `{value, source,
 *      key}` so the semantics cannot drift;
 *   2. the WIRING arms: the Electron control-plane resolver, the local-server
 *      discovery keys and `ServerInstaller` resolve `CLOUDPIT_*` and keep their
 *      shipped defaults when no brand variable is set.
 *
 * v3.0 RETIREMENT: the legacy `CLOUDCLI_*` spelling is no longer read anywhere.
 * Every arm below that used to assert the fallback now asserts the ignored
 * spelling leaves the shipped default in force.
 *
 * The production wiring is driven through the same functions the modules use.
 * `electron/main.js` imports Electron and cannot be loaded by node, so the
 * control-plane arm drives `readBrandEnvValue` (the expression main.js binds)
 * and a static arm pins that main.js binds it, and that no Electron module
 * reads a legacy spelling directly.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createBrandEnvReader as createElectronBrandEnvReader,
  readBrandEnvValue,
} from '../brandEnv.js';
import {
  getExistingServerCandidateUrls,
  isInstalledServerRequested,
} from '../localServer.js';
import { DEFAULT_INSTALL_ROOT, ServerInstaller } from '../serverInstaller.js';
import { createBrandEnvReader as createServerBrandEnvReader } from '../../server/shared/brand.js';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TESTS_DIR, '..', '..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

/** Build a reader over `env`. */
function readWith(createReader, env) {
  return createReader({ env });
}

// ── parity: the two createBrandEnvReader implementations ───────────────────

/**
 * The shared table. `expectedReadings` is what both implementations must return
 * when the same key is read twice.
 */
const PARITY_ARMS = [
  {
    label: 'new only',
    env: { CLOUDPIT_X: 'new' },
    expectedReadings: [
      { value: 'new', source: 'new', key: 'CLOUDPIT_X' },
      { value: 'new', source: 'new', key: 'CLOUDPIT_X' },
    ],
  },
  {
    label: 'both set',
    env: { CLOUDPIT_X: 'new', CLOUDCLI_X: 'old' },
    expectedReadings: [
      { value: 'new', source: 'new', key: 'CLOUDPIT_X' },
      { value: 'new', source: 'new', key: 'CLOUDPIT_X' },
    ],
  },
  {
    label: 'legacy only',
    env: { CLOUDCLI_X: 'old' },
    expectedReadings: [
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
    ],
  },
  {
    label: 'both empty',
    env: { CLOUDPIT_X: '', CLOUDCLI_X: '' },
    expectedReadings: [
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
    ],
  },
  {
    label: 'new empty with legacy set',
    env: { CLOUDPIT_X: '', CLOUDCLI_X: 'old' },
    expectedReadings: [
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
    ],
  },
  {
    label: 'neither set',
    env: {},
    expectedReadings: [
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
    ],
  },
];

for (const arm of PARITY_ARMS) {
  test(`parity ${arm.label}: the Electron reader matches the server reader`, () => {
    const server = readWith(createServerBrandEnvReader, arm.env);
    const electron = readWith(createElectronBrandEnvReader, arm.env);

    const serverReadings = [server.read('X'), server.read('X')];
    const electronReadings = [electron.read('X'), electron.read('X')];

    assert.deepEqual(serverReadings, arm.expectedReadings, 'server implementation reads the arm');
    assert.deepEqual(electronReadings, arm.expectedReadings, 'Electron implementation reads the arm');
    assert.deepEqual(electronReadings, serverReadings, 'the two runtimes must return the same readings');
  });
}

// ── Electron main: the control-plane resolver ──────────────────────────────

const DEFAULT_CONTROL_PLANE_URL = 'https://cloudcli.ai';

/** Resolve the control-plane URL through the same expression main.js binds. */
function resolveControlPlaneUrl(env) {
  return readBrandEnvValue(readWith(createElectronBrandEnvReader, env), 'CONTROL_PLANE_URL', DEFAULT_CONTROL_PLANE_URL);
}

test('Electron AC3: only CLOUDPIT_CONTROL_PLANE_URL set reads the new value', () => {
  assert.equal(
    resolveControlPlaneUrl({ CLOUDPIT_CONTROL_PLANE_URL: 'https://cloudpit.example' }),
    'https://cloudpit.example',
  );
});

test('Electron AC3 (v3.0): only CLOUDCLI_CONTROL_PLANE_URL set keeps the shipped default', () => {
  assert.equal(
    resolveControlPlaneUrl({ CLOUDCLI_CONTROL_PLANE_URL: 'https://legacy.example' }),
    DEFAULT_CONTROL_PLANE_URL,
    'the retired legacy spelling must not supply the control-plane address',
  );
});

test('Electron AC3: both set means the new value wins', () => {
  assert.equal(
    resolveControlPlaneUrl({
      CLOUDPIT_CONTROL_PLANE_URL: 'https://new.example',
      CLOUDCLI_CONTROL_PLANE_URL: 'https://old.example',
    }),
    'https://new.example',
  );
});

test('Electron AC4: no control-plane env keeps https://cloudcli.ai', () => {
  assert.equal(resolveControlPlaneUrl({}), DEFAULT_CONTROL_PLANE_URL);
});

test('Electron wiring: main.js binds the reader and keeps the third-party default', () => {
  const source = readRepoFile('electron/main.js');

  assert.match(
    source,
    /readBrandEnvValue\(brandEnv, 'CONTROL_PLANE_URL', 'https:\/\/cloudcli\.ai'\)/,
    'main.js must resolve the control plane through the brand reader',
  );
  assert.ok(
    source.includes("'https://cloudcli.ai'"),
    'the default control-plane address is a third-party contract and must stay',
  );
  assert.doesNotMatch(source, /process\.env\.CLOUDCLI_/, 'main.js must not read a legacy spelling directly');
});

// ── Electron localServer discovery ─────────────────────────────────────────

const DEFAULT_LOCAL_SERVER_URL = 'http://127.0.0.1:3001';
const NO_MARKERS = { markerPaths: [] };

test('localServer AC3: only CLOUDPIT_DESKTOP_LOCAL_SERVER_URL is discovered first', async () => {
  const reader = readWith(createElectronBrandEnvReader, {
    CLOUDPIT_DESKTOP_LOCAL_SERVER_URL: 'http://127.0.0.1:4401',
  });

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.equal(urls[0], 'http://127.0.0.1:4401');
});

test('localServer AC3 (v3.0): a legacy-only discovery variable is ignored', async () => {
  const reader = readWith(createElectronBrandEnvReader, {
    CLOUDCLI_DESKTOP_LOCAL_SERVER_URL: 'http://127.0.0.1:4402',
  });

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.deepEqual(urls, [DEFAULT_LOCAL_SERVER_URL], 'the retired spelling must not add a candidate');
});

test('localServer AC3: both spellings set means the new address is the only candidate', async () => {
  const reader = readWith(createElectronBrandEnvReader, {
    CLOUDPIT_DESKTOP_LOCAL_SERVER_URL: 'http://127.0.0.1:4401',
    CLOUDCLI_DESKTOP_LOCAL_SERVER_URL: 'http://127.0.0.1:4402',
  });

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.equal(urls[0], 'http://127.0.0.1:4401');
  assert.equal(urls.includes('http://127.0.0.1:4402'), false);
});

test('localServer AC3: CLOUDPIT_SERVER_PORT supplies the port candidate', async () => {
  const reader = readWith(createElectronBrandEnvReader, {
    CLOUDPIT_SERVER_PORT: '4403',
  });

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.equal(urls.includes('http://127.0.0.1:4403'), true);
});

test('localServer AC4: no discovery env means only the default URL', async () => {
  const reader = readWith(createElectronBrandEnvReader, {});

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.deepEqual(urls, [DEFAULT_LOCAL_SERVER_URL]);
});

test('localServer (v3.0): CLOUDPIT_USE_INSTALLED_SERVER is read, the legacy spelling is ignored', () => {
  const newOnly = readWith(createElectronBrandEnvReader, { CLOUDPIT_USE_INSTALLED_SERVER: '1' });
  assert.equal(isInstalledServerRequested(newOnly), true);

  const legacyOnly = readWith(createElectronBrandEnvReader, { CLOUDCLI_USE_INSTALLED_SERVER: '1' });
  assert.equal(isInstalledServerRequested(legacyOnly), false, 'the retired spelling must not opt in');

  const both = readWith(createElectronBrandEnvReader, {
    CLOUDPIT_USE_INSTALLED_SERVER: '0',
    CLOUDCLI_USE_INSTALLED_SERVER: '1',
  });
  assert.equal(isInstalledServerRequested(both), false, 'the new value wins');
});

test('Electron wiring: localServer.js reads discovery names through the brand reader', () => {
  const source = readRepoFile('electron/localServer.js');

  assert.ok(
    source.includes("readBrandEnvValue(reader, name, undefined)"),
    'discovery names must go through the brand reader',
  );
  assert.ok(
    source.includes("readBrandEnvValue(reader, 'USE_INSTALLED_SERVER', '')"),
    'the installed-server switch must go through the brand reader',
  );
  assert.doesNotMatch(source, /process\.env\.CLOUDCLI_/);
});

// ── serverInstaller ────────────────────────────────────────────────────────

function installerWith(env) {
  return new ServerInstaller({
    version: '2.0.0',
    platform: 'linux',
    arch: 'x64',
    env,
  });
}

test('serverInstaller AC4: no brand env keeps the shipped bundle defaults', () => {
  const installer = installerWith({});

  assert.equal(installer.bundleBaseUrl, 'https://github.com/yaleh/cloudpit/releases/download');
  assert.equal(installer.bundleReleaseTag, 'v2.0.0');
  assert.equal(installer.installRoot, DEFAULT_INSTALL_ROOT);
  assert.equal(installer.migrateLegacyInstall, true);
});

test('serverInstaller AC3: only CLOUDPIT_* set reads the new values', () => {
  const installer = installerWith({
    CLOUDPIT_SERVER_BUNDLE_URL: 'https://bundles.example/new',
    CLOUDPIT_SERVER_BUNDLE_RELEASE_TAG: 'v9',
    CLOUDPIT_SERVER_DIR: '/opt/cloudpit-new',
  });

  assert.equal(installer.bundleBaseUrl, 'https://bundles.example/new');
  assert.equal(installer.bundleReleaseTag, 'v9');
  assert.equal(installer.installRoot, '/opt/cloudpit-new');
  assert.equal(installer.migrateLegacyInstall, false);
});

test('serverInstaller AC3 (v3.0): only CLOUDCLI_* set keeps the shipped values', () => {
  const installer = installerWith({
    CLOUDCLI_SERVER_BUNDLE_URL: 'https://bundles.example/old',
    CLOUDCLI_SERVER_BUNDLE_RELEASE_TAG: 'v8',
    CLOUDCLI_SERVER_DIR: '/opt/cloudcli-old',
  });

  assert.equal(installer.bundleBaseUrl, 'https://github.com/yaleh/cloudpit/releases/download');
  assert.equal(installer.bundleReleaseTag, 'v2.0.0');
  assert.equal(installer.installRoot, DEFAULT_INSTALL_ROOT);
  assert.equal(installer.migrateLegacyInstall, true);
});

test('serverInstaller AC3: both spellings set means the new values win', () => {
  const installer = installerWith({
    CLOUDPIT_SERVER_BUNDLE_URL: 'https://bundles.example/new',
    CLOUDCLI_SERVER_BUNDLE_URL: 'https://bundles.example/old',
    CLOUDPIT_SERVER_BUNDLE_RELEASE_TAG: 'v9',
    CLOUDCLI_SERVER_BUNDLE_RELEASE_TAG: 'v8',
    CLOUDPIT_SERVER_DIR: '/opt/cloudpit-new',
    CLOUDCLI_SERVER_DIR: '/opt/cloudcli-old',
  });

  assert.equal(installer.bundleBaseUrl, 'https://bundles.example/new');
  assert.equal(installer.bundleReleaseTag, 'v9');
  assert.equal(installer.installRoot, '/opt/cloudpit-new');
});

test('Electron wiring: serverInstaller.js reads bundle names through the brand reader', () => {
  const source = readRepoFile('electron/serverInstaller.js');

  assert.ok(source.includes('const brandEnv = createBrandEnvReader({ env })'));
  assert.doesNotMatch(source, /process\.env\.CLOUDCLI_/);
});
