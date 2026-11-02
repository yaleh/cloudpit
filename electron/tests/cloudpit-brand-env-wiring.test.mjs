/**
 * Criterion file for `gap-cloudpit-brand-env-reader-wiring`.
 *
 *   npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-brand-env-wiring.test.mjs
 *
 * Electron cannot import `server/shared/brand.ts` (it runs plain JavaScript from
 * source), so the production wiring reads through `electron/brandEnv.js`. This
 * file holds the two things that keep that second implementation honest:
 *
 *   1. a cross-runtime PARITY table: one environment table drives both
 *      `createBrandEnvReader` implementations and compares `{value, source,
 *      key}` plus the legacy-warning list, so the semantics cannot drift;
 *   2. the WIRING arms: the Electron control-plane resolver, the local-server
 *      discovery keys and `ServerInstaller` resolve `CLOUDPIT_*` first, keep
 *      `CLOUDCLI_*` readable with exactly one deprecation warning, and keep
 *      their shipped defaults when no brand variable is set.
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

/** Build a reader over `env` plus the warnings it emitted, in order. */
function readWith(createReader, env) {
  const warnings = [];
  const reader = createReader({ env, warn: (message) => warnings.push(message) });
  return { reader, warnings };
}

// ── parity: the two createBrandEnvReader implementations ───────────────────

/**
 * The shared three-arm table. `expectedReadings` is what both implementations
 * must return when the same key is read twice (the second read is what pins
 * warn-once), and `expectedWarnings` is the warning list both must emit.
 */
const PARITY_ARMS = [
  {
    label: 'legacy only',
    env: { CLOUDCLI_X: 'old' },
    expectedReadings: [
      { value: 'old', source: 'legacy', key: 'CLOUDCLI_X' },
      { value: 'old', source: 'legacy', key: 'CLOUDCLI_X' },
    ],
    expectedWarnings: ['CLOUDCLI_X is deprecated; set CLOUDPIT_X instead.'],
  },
  {
    label: 'new only',
    env: { CLOUDPIT_X: 'new' },
    expectedReadings: [
      { value: 'new', source: 'new', key: 'CLOUDPIT_X' },
      { value: 'new', source: 'new', key: 'CLOUDPIT_X' },
    ],
    expectedWarnings: [],
  },
  {
    label: 'both set',
    env: { CLOUDPIT_X: 'new', CLOUDCLI_X: 'old' },
    expectedReadings: [
      { value: 'new', source: 'new', key: 'CLOUDPIT_X' },
      { value: 'new', source: 'new', key: 'CLOUDPIT_X' },
    ],
    expectedWarnings: [],
  },
  {
    label: 'both empty',
    env: { CLOUDPIT_X: '', CLOUDCLI_X: '' },
    expectedReadings: [
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
    ],
    expectedWarnings: [],
  },
  {
    label: 'new empty with legacy set',
    env: { CLOUDPIT_X: '', CLOUDCLI_X: 'old' },
    expectedReadings: [
      { value: 'old', source: 'legacy', key: 'CLOUDCLI_X' },
      { value: 'old', source: 'legacy', key: 'CLOUDCLI_X' },
    ],
    expectedWarnings: ['CLOUDCLI_X is deprecated; set CLOUDPIT_X instead.'],
  },
  {
    label: 'neither set',
    env: {},
    expectedReadings: [
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
      { value: undefined, source: 'absent', key: 'CLOUDPIT_X' },
    ],
    expectedWarnings: [],
  },
];

for (const arm of PARITY_ARMS) {
  test(`parity ${arm.label}: the Electron reader matches the server reader`, () => {
    const server = readWith(createServerBrandEnvReader, arm.env);
    const electron = readWith(createElectronBrandEnvReader, arm.env);

    const serverReadings = [server.reader.read('X'), server.reader.read('X')];
    const electronReadings = [electron.reader.read('X'), electron.reader.read('X')];

    assert.deepEqual(serverReadings, arm.expectedReadings, 'server implementation reads the arm');
    assert.deepEqual(electronReadings, arm.expectedReadings, 'Electron implementation reads the arm');
    assert.deepEqual(electronReadings, serverReadings, 'the two runtimes must return the same readings');
    assert.deepEqual(electron.warnings, server.warnings, 'the two runtimes must warn identically');
    assert.deepEqual(server.warnings, arm.expectedWarnings);
  });
}

test('parity isolation: each reader instance keeps its own warned-key set', () => {
  const first = readWith(createElectronBrandEnvReader, { CLOUDCLI_X: 'old' });
  const second = readWith(createElectronBrandEnvReader, { CLOUDCLI_X: 'old' });

  first.reader.read('X');
  second.reader.read('X');

  assert.equal(first.warnings.length, 1);
  assert.equal(second.warnings.length, 1);
});

// ── Electron main: the control-plane resolver ──────────────────────────────

const DEFAULT_CONTROL_PLANE_URL = 'https://cloudcli.ai';

/** Resolve the control-plane URL through the same expression main.js binds. */
function resolveControlPlaneUrl(env) {
  const { reader } = readWith(createElectronBrandEnvReader, env);
  return readBrandEnvValue(reader, 'CONTROL_PLANE_URL', DEFAULT_CONTROL_PLANE_URL);
}

test('Electron AC3: only CLOUDPIT_CONTROL_PLANE_URL set reads the new value', () => {
  assert.equal(
    resolveControlPlaneUrl({ CLOUDPIT_CONTROL_PLANE_URL: 'https://cloudpit.example' }),
    'https://cloudpit.example',
  );
});

test('Electron AC3: only CLOUDCLI_CONTROL_PLANE_URL set reads the old value and warns once', () => {
  const { reader, warnings } = readWith(createElectronBrandEnvReader, {
    CLOUDCLI_CONTROL_PLANE_URL: 'https://legacy.example',
  });
  assert.equal(
    readBrandEnvValue(reader, 'CONTROL_PLANE_URL', DEFAULT_CONTROL_PLANE_URL),
    'https://legacy.example',
  );
  assert.deepEqual(warnings, ['CLOUDCLI_CONTROL_PLANE_URL is deprecated; set CLOUDPIT_CONTROL_PLANE_URL instead.']);
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
  const { reader, warnings } = readWith(createElectronBrandEnvReader, {
    CLOUDPIT_DESKTOP_LOCAL_SERVER_URL: 'http://127.0.0.1:4401',
  });

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.equal(urls[0], 'http://127.0.0.1:4401');
  assert.deepEqual(warnings, []);
});

test('localServer AC3: only CLOUDCLI_DESKTOP_LOCAL_SERVER_URL is discovered and warns once', async () => {
  const { reader, warnings } = readWith(createElectronBrandEnvReader, {
    CLOUDCLI_DESKTOP_LOCAL_SERVER_URL: 'http://127.0.0.1:4402',
  });

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.equal(urls[0], 'http://127.0.0.1:4402');
  assert.deepEqual(warnings, ['CLOUDCLI_DESKTOP_LOCAL_SERVER_URL is deprecated; set CLOUDPIT_DESKTOP_LOCAL_SERVER_URL instead.']);
});

test('localServer AC3: both spellings set means the new address is the only candidate', async () => {
  const { reader } = readWith(createElectronBrandEnvReader, {
    CLOUDPIT_DESKTOP_LOCAL_SERVER_URL: 'http://127.0.0.1:4401',
    CLOUDCLI_DESKTOP_LOCAL_SERVER_URL: 'http://127.0.0.1:4402',
  });

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.equal(urls[0], 'http://127.0.0.1:4401');
  assert.equal(urls.includes('http://127.0.0.1:4402'), false);
});

test('localServer AC3: CLOUDPIT_SERVER_PORT supplies the port candidate', async () => {
  const { reader } = readWith(createElectronBrandEnvReader, {
    CLOUDPIT_SERVER_PORT: '4403',
  });

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.equal(urls.includes('http://127.0.0.1:4403'), true);
});

test('localServer AC4: no discovery env means only the default URL', async () => {
  const { reader, warnings } = readWith(createElectronBrandEnvReader, {});

  const urls = await getExistingServerCandidateUrls(DEFAULT_LOCAL_SERVER_URL, { reader, ...NO_MARKERS });
  assert.deepEqual(urls, [DEFAULT_LOCAL_SERVER_URL]);
  assert.deepEqual(warnings, []);
});

test('localServer: CLOUDPIT_USE_INSTALLED_SERVER wins over the legacy spelling', () => {
  const newOnly = readWith(createElectronBrandEnvReader, { CLOUDPIT_USE_INSTALLED_SERVER: '1' });
  assert.equal(isInstalledServerRequested(newOnly.reader), true);
  assert.deepEqual(newOnly.warnings, []);

  const legacyOnly = readWith(createElectronBrandEnvReader, { CLOUDCLI_USE_INSTALLED_SERVER: '1' });
  assert.equal(isInstalledServerRequested(legacyOnly.reader), true);
  assert.equal(legacyOnly.warnings.length, 1);

  const both = readWith(createElectronBrandEnvReader, {
    CLOUDPIT_USE_INSTALLED_SERVER: '0',
    CLOUDCLI_USE_INSTALLED_SERVER: '1',
  });
  assert.equal(isInstalledServerRequested(both.reader), false, 'the new value wins');
  assert.deepEqual(both.warnings, []);
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
  const warnings = [];
  const installer = new ServerInstaller({
    version: '2.0.0',
    platform: 'linux',
    arch: 'x64',
    env,
    warn: (message) => warnings.push(message),
  });
  return { installer, warnings };
}

test('serverInstaller AC4: no brand env keeps the shipped bundle defaults', () => {
  const { installer, warnings } = installerWith({});

  assert.equal(installer.bundleBaseUrl, 'https://github.com/yaleh/cloudpit/releases/download');
  assert.equal(installer.bundleReleaseTag, 'v2.0.0');
  assert.equal(installer.installRoot, DEFAULT_INSTALL_ROOT);
  assert.equal(installer.migrateLegacyInstall, true);
  assert.deepEqual(warnings, []);
});

test('serverInstaller AC3: only CLOUDPIT_* set reads the new values', () => {
  const { installer, warnings } = installerWith({
    CLOUDPIT_SERVER_BUNDLE_URL: 'https://bundles.example/new',
    CLOUDPIT_SERVER_BUNDLE_RELEASE_TAG: 'v9',
    CLOUDPIT_SERVER_DIR: '/opt/cloudpit-new',
  });

  assert.equal(installer.bundleBaseUrl, 'https://bundles.example/new');
  assert.equal(installer.bundleReleaseTag, 'v9');
  assert.equal(installer.installRoot, '/opt/cloudpit-new');
  assert.equal(installer.migrateLegacyInstall, false);
  assert.deepEqual(warnings, []);
});

test('serverInstaller AC3: only CLOUDCLI_* set reads the old values and warns once per key', () => {
  const { installer, warnings } = installerWith({
    CLOUDCLI_SERVER_BUNDLE_URL: 'https://bundles.example/old',
    CLOUDCLI_SERVER_BUNDLE_RELEASE_TAG: 'v8',
    CLOUDCLI_SERVER_DIR: '/opt/cloudcli-old',
  });

  assert.equal(installer.bundleBaseUrl, 'https://bundles.example/old');
  assert.equal(installer.bundleReleaseTag, 'v8');
  assert.equal(installer.installRoot, '/opt/cloudcli-old');
  assert.equal(warnings.length, 3, 'one warning per legacy key');
  assert.deepEqual(
    warnings.map((warning) => warning.slice(0, warning.indexOf(' is deprecated'))).sort(),
    [
      'CLOUDCLI_SERVER_BUNDLE_RELEASE_TAG',
      'CLOUDCLI_SERVER_BUNDLE_URL',
      'CLOUDCLI_SERVER_DIR',
    ],
  );
});

test('serverInstaller AC3: both spellings set means the new values win', () => {
  const { installer, warnings } = installerWith({
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
  assert.deepEqual(warnings, []);
});

test('Electron wiring: serverInstaller.js reads bundle names through the brand reader', () => {
  const source = readRepoFile('electron/serverInstaller.js');

  assert.ok(source.includes('const brandEnv = createBrandEnvReader({ env, warn })'));
  assert.doesNotMatch(source, /process\.env\.CLOUDCLI_/);
});
