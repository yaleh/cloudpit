/**
 * The Cloudpit runtime-default criterion (AC-452's judgement file).
 *
 * GOAL-053 left the Cloudpit pipeline DARK: the resolver, the settings fallback, the dual asset
 * roots and the scope alias table existed, but every runtime default still pointed at the legacy
 * layout. This file drives the flip — default `~/.cloudpit`, one-time settings migration, uploads
 * to the new asset root, both observation URI spellings, the new MCP server name, the two scope
 * vocabularies and the two service-worker cache prefixes — against temp homes and fakes, so it
 * never reads or writes the developer's real `~`.
 *
 * v3.0 retired the runtime fallbacks: `defaultRoot: 'legacy'`, the failed-migration fallback to
 * `~/.cloudcli`, the legacy settings read fallback and the `CLOUDCLI_*` environment spellings are
 * all gone. The arms below assert the one-time migrations still work and that the retired paths
 * are ignored.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-runtime-flip.test.ts
 */
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

import {
  type AccessTokensService,
  normalizeAccessTokenScopes,
} from '@/modules/oauth/index.js';
import {
  buildAuthorizationServerMetadata,
  createMcpAuthMiddleware,
  readMcpPrincipal,
} from '@/modules/mcp-gateway/index.js';
import {
  LEGACY_MCP_SERVER_NAMES,
  MCP_SERVER_NAME,
  mcpServerNamesToRemove,
} from '@/modules/browser-use/index.js';
import { findStoredAttachmentAsset } from '@/modules/assets/index.js';
import {
  formatArchitectureUri,
  formatSessionUri,
  parseObservationUri,
} from '@/modules/observation/index.js';
import {
  loadServerSettings,
  readCockpitSessionStartBoot,
  resolveServerSettingsFileTarget,
} from '@/modules/settings/index.js';
import { createBrandEnvReader } from '@/shared/brand.js';
import { resolveDataRoots } from '@/shared/data-root.js';
import { getImageAssetsReadDirs, getImageAssetsWriteDir } from '@/shared/image-attachments.js';
import { ACCESS_TOKEN_SCOPES, CLOUDPIT_ACCESS_TOKEN_SCOPES } from '@/shared/mcp-contract/index.js';
import { defaultServerSettingsPath } from '@/shared/settings-file.js';

const APPLICATION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Reads one repository file for the static arms (protocol declarations, source shape). */
function readApplicationFile(relativePath: string): string {
  return readFileSync(path.join(APPLICATION_ROOT, relativePath), 'utf8');
}

/** A fresh HOME under the OS temp directory, so no arm can touch the real `~`. */
function temporaryHome(prefix: string): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('AC2/AC11 (v3.0): the Cloudpit default root migrates a legacy layout; no legacy mode is selectable', () => {
  const homeDir = temporaryHome('cloudpit-runtime-root-');
  try {
    const legacyRoot = path.join(homeDir, '.cloudcli');
    mkdirSync(path.join(legacyRoot, 'voice-data'), { recursive: true });
    writeFileSync(path.join(legacyRoot, 'auth.db'), 'legacy-database');
    writeFileSync(path.join(legacyRoot, 'cockpit-card-feedback.json'), '{"kept":true}\n');

    const plan = resolveDataRoots({
      env: {},
      homeDir,
      version: 'criterion',
      // The smallest real snapshot seam: the criterion does not need SQLite to prove the
      // destination and the marker order.
      backupDatabase: (sourcePath, targetPath) => copyFileSync(sourcePath, targetPath),
    });

    assert.equal(plan.activeRoot, path.join(homeDir, '.cloudpit'));
    assert.equal(plan.reason, 'default-migrated');
    assert.equal(plan.migrated, true);
    assert.equal(plan.authDatabasePath, path.join(homeDir, '.cloudpit', 'auth.db'));
    assert.equal(plan.settingsPath, path.join(homeDir, '.config', 'cloudpit', 'server.settings.json'));
    assert.equal(existsSync(plan.authDatabasePath), true, 'the migrated database must exist');
    assert.equal(
      existsSync(path.join(homeDir, '.cloudpit', 'cockpit-card-feedback.json')),
      true,
      'a migrated data entry must exist',
    );
    assert.equal(
      existsSync(path.join(homeDir, '.cloudpit', '.migrated-from-cloudcli')),
      true,
      'the marker is written after every copy succeeded',
    );
    // The legacy root is only ever READ.
    assert.equal(readFileSync(path.join(legacyRoot, 'auth.db'), 'utf8'), 'legacy-database');

    // AC11's negative control: the retired `defaultRoot: 'legacy'` option no longer moves the
    // default back to the old root — it is not part of the resolver's public shape, so a caller
    // that still passes it keeps the Cloudpit root.
    const ignoredMode = resolveDataRoots({
      defaultRoot: 'legacy',
      env: {},
      homeDir,
    } as unknown as Parameters<typeof resolveDataRoots>[0]);
    assert.equal(ignoredMode.activeRoot, path.join(homeDir, '.cloudpit'));
    assert.equal(ignoredMode.reason, 'default-already-migrated');
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }

  const failingHome = temporaryHome('cloudpit-runtime-root-failure-');
  try {
    const failingLegacyRoot = path.join(failingHome, '.cloudcli');
    mkdirSync(failingLegacyRoot, { recursive: true });
    writeFileSync(path.join(failingLegacyRoot, 'auth.db'), 'legacy-database');

    const failure = resolveDataRoots({
      env: {},
      homeDir: failingHome,
      backupDatabase: () => {
        throw new Error('SQLITE_BUSY');
      },
    });

    assert.equal(failure.activeRoot, path.join(failingHome, '.cloudpit'), 'no fallback to ~/.cloudcli');
    assert.equal(failure.reason, 'migration-failed');
    assert.equal(failure.migrated, false);
    assert.match(failure.migrationError ?? '', /SQLITE_BUSY/);
    assert.equal(
      existsSync(path.join(failingHome, '.cloudpit')),
      false,
      'a failed migration must leave no half-created Cloudpit root behind',
    );
  } finally {
    rmSync(failingHome, { recursive: true, force: true });
  }
});

test('AC3: the bootstrap and the CLI derive the default database from the resolver', () => {
  const loadEnvSource = readApplicationFile('server/load-env.ts');
  const cliModuleSource = readApplicationFile('server/modules/cli/cli.module.ts');
  const indexSource = readApplicationFile('server/index.ts');

  assert.ok(
    loadEnvSource.includes('resolveDataRoots()'),
    'load-env.ts must resolve the one Cloudpit default',
  );
  assert.ok(
    loadEnvSource.includes('process.env.DATABASE_PATH = DATA_ROOTS.authDatabasePath'),
    'load-env.ts must install the resolved database path',
  );
  assert.ok(
    !loadEnvSource.includes("'.cloudcli', 'auth.db'"),
    'load-env.ts must not carry the legacy database default',
  );

  assert.ok(
    cliModuleSource.includes('resolveDataRoots({ homeDir: homeDirectory })'),
    'cli.module.ts must derive its default database path from the resolver',
  );
  assert.ok(
    !cliModuleSource.includes("'.cloudcli', 'auth.db'"),
    'cli.module.ts must not carry the legacy database default',
  );

  const firstImport = indexSource.split('\n').find((line) => line.startsWith('import ')) ?? '';
  assert.match(
    firstImport,
    /from '\.\/load-env\.js';$/,
    `server/index.ts must evaluate the bootstrap first: ${firstImport}`,
  );
  assert.ok(
    indexSource.includes('DATA_ROOTS.cockpitCardFeedbackPath'),
    'server/index.ts must reuse the boot resolution for the cockpit feedback file',
  );
  assert.ok(
    !indexSource.includes("path.join(os.homedir(), '.cloudcli', 'cockpit-card-feedback.json')"),
    'server/index.ts must not carry the legacy cockpit feedback default',
  );
});

test('AC4/AC11 (v3.0): the legacy settings file is copied once, then only the Cloudpit file is read', () => {
  const homeDir = temporaryHome('cloudpit-runtime-settings-');
  try {
    const newDefault = path.join(homeDir, '.config', 'cloudpit', 'server.settings.json');
    const legacyDefault = path.join(homeDir, '.config', 'claudecodeui', 'server.settings.json');
    assert.equal(defaultServerSettingsPath(homeDir), newDefault);

    mkdirSync(path.dirname(legacyDefault), { recursive: true });
    writeFileSync(
      legacyDefault,
      `${JSON.stringify({ cockpit: { sessionStart: { model: 'legacy-model', effort: 'high' } } }, null, 2)}\n`,
    );
    assert.equal(existsSync(newDefault), false, 'the Cloudpit file does not exist before the first boot');

    // The first boot copies the legacy file to the Cloudpit path and reads the new one.
    const settings = loadServerSettings({ homeDir, env: {} });
    assert.equal(settings.cockpit.sessionStart.model, 'legacy-model');
    assert.equal(settings.cockpit.sessionStart.effort, 'high');
    assert.deepEqual(settings.problems, []);
    assert.equal(existsSync(newDefault), true, 'the first boot must create the Cloudpit settings file');
    assert.deepEqual(
      readFileSync(newDefault),
      readFileSync(legacyDefault),
      'the one-time migration copies the legacy document verbatim',
    );

    const boot = readCockpitSessionStartBoot();
    assert.ok(boot, 'the boot loader must record its reading');
    assert.equal(boot.path, newDefault, 'the effective values come from the Cloudpit file');
    assert.equal(boot.writePath, newDefault, 'a save lands in the same Cloudpit file');

    const target = resolveServerSettingsFileTarget({ homeDir, env: {} });
    assert.deepEqual(target, { path: newDefault, writePath: newDefault, explicit: false });

    // Editing the legacy file afterwards has no effect: only the Cloudpit file is read.
    writeFileSync(
      legacyDefault,
      `${JSON.stringify({ cockpit: { sessionStart: { model: 'edited-legacy', effort: 'low' } } })}\n`,
    );
    assert.equal(loadServerSettings({ homeDir, env: {} }).cockpit.sessionStart.model, 'legacy-model');

    // A save made after the copy is never clobbered by a later resolution (idempotent migration).
    const savedDocument = `${JSON.stringify({ cockpit: { sessionStart: { model: 'saved-cloudpit' } } }, null, 2)}\n`;
    writeFileSync(newDefault, savedDocument);
    resolveServerSettingsFileTarget({ homeDir, env: {} });
    assert.equal(readFileSync(newDefault, 'utf8'), savedDocument, 'the second run must not overwrite the user file');

    // Explicit overrides are unchanged: the named file is both read and written.
    const explicitPath = path.join(homeDir, 'operator', 'custom.settings.json');
    const byArgument = resolveServerSettingsFileTarget({ settingsPath: explicitPath, homeDir, env: {} });
    assert.deepEqual(byArgument, { path: explicitPath, writePath: explicitPath, explicit: true });
    const byEnvironment = resolveServerSettingsFileTarget({
      homeDir,
      env: { SERVER_SETTINGS_PATH: explicitPath },
    });
    assert.deepEqual(byEnvironment, { path: explicitPath, writePath: explicitPath, explicit: true });
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('AC5/AC11: uploads write the Cloudpit root, the legacy root stays readable', async () => {
  const homeDir = temporaryHome('cloudpit-runtime-assets-');
  try {
    const legacyRoot = path.join(homeDir, '.cloudcli', 'assets');
    const newRoot = path.join(homeDir, '.cloudpit', 'assets');

    assert.equal(getImageAssetsWriteDir({ homeDir, env: {} }), newRoot);
    assert.deepEqual(getImageAssetsReadDirs({ homeDir, env: {} }), [newRoot, legacyRoot]);

    mkdirSync(legacyRoot, { recursive: true });
    const legacyAsset = path.join(legacyRoot, 'old-shot.png');
    writeFileSync(legacyAsset, 'legacy-bytes');

    const found = await findStoredAttachmentAsset('old-shot.png', {
      roots: getImageAssetsReadDirs({ homeDir, env: {} }),
    });
    assert.equal(found, legacyAsset, 'an attachment uploaded before the flip stays readable');

    // Negative control: remove the legacy file and the same lookup must fail, proving the
    // positive arm really read the legacy root.
    rmSync(legacyAsset);
    assert.equal(
      await findStoredAttachmentAsset('old-shot.png', {
        roots: getImageAssetsReadDirs({ homeDir, env: {} }),
      }),
      null,
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('AC6: both protocols are declared/registered and both observation URI spellings parse', () => {
  const packageJson = JSON.parse(readApplicationFile('package.json')) as {
    build: {
      protocols: Array<{ name: string; schemes: string[] }>;
      mac: { extendInfo: { CFBundleURLTypes: Array<{ CFBundleURLSchemes: string[] }> } };
    };
  };
  const protocolSchemes = packageJson.build.protocols.flatMap((entry) => entry.schemes);
  assert.ok(protocolSchemes.includes('cloudcli'), 'the CloudCLI scheme must stay declared');
  assert.ok(protocolSchemes.includes('cloudpit'), 'the Cloudpit scheme must be declared');
  const macSchemes = packageJson.build.mac.extendInfo.CFBundleURLTypes.flatMap(
    (entry) => entry.CFBundleURLSchemes,
  );
  assert.ok(macSchemes.includes('cloudcli') && macSchemes.includes('cloudpit'));

  const electronSource = readApplicationFile('electron/main.js');
  // Both schemes must live in the single registered-scheme list, and the loop must push every
  // entry through setAsDefaultProtocolClient (packaged and dev branches alike).
  assert.match(electronSource, /const DEEP_LINK_SCHEMES = \['cloudcli', 'cloudpit'\];/);
  const registerSource = electronSource.slice(
    electronSource.indexOf('function registerProtocolHandler'),
  );
  assert.ok(registerSource.includes('for (const scheme of DEEP_LINK_SCHEMES)'));
  assert.ok(
    registerSource.includes('app.setAsDefaultProtocolClient(scheme'),
    'both schemes must reach setAsDefaultProtocolClient',
  );

  // 2.1 flips the WRITE spelling: the formatters mint `cloudpit://` and either accepted read
  // spelling normalizes onto that canonical address. The legacy spelling stays readable.
  const legacyParsed = parseObservationUri('cloudcli://session/x');
  const cloudpitParsed = parseObservationUri('cloudpit://session/x');
  assert.ok(legacyParsed && cloudpitParsed);
  assert.deepEqual(cloudpitParsed, legacyParsed, 'both accepted spellings are one canonical reading');
  assert.equal(cloudpitParsed.uri, 'cloudpit://session/x', 'the canonical spelling is the 2.1 write');
  assert.equal(cloudpitParsed.scheme, 'cloudpit');
  assert.equal(formatSessionUri('x'), 'cloudpit://session/x', 'the formatter writes the new spelling');
  assert.equal(formatArchitectureUri('project-1'), 'cloudpit://architecture/project-1');
  assert.equal(parseObservationUri('cloudcli://architecture/project-1')?.uri, 'cloudpit://architecture/project-1');
  assert.equal(legacyParsed?.uri, formatSessionUri('x'), 'the legacy spelling still reads the same object');

  // The two compilers carry separate copies of the grammar; the accepted-scheme line must be
  // textually identical so a later edit cannot widen one side only.
  const regexLineOf = (source: string): string => {
    const line = source.split('\n').find((entry) => entry.includes('const CLOUDCLI_URI = new RegExp('));
    assert.ok(line, 'the URI grammar line must exist');
    return line.trim();
  };
  assert.equal(
    regexLineOf(readApplicationFile('server/modules/observation/observation-uri.ts')),
    regexLineOf(readApplicationFile('src/modules/cockpit-contract/observationUri.ts')),
  );

  const storeSource = readApplicationFile('server/modules/observation/observation-store.ts');
  assert.ok(storeSource.includes('cloudpit://session/<id>'), 'the INVALID_URI message names both spellings');
});

test('AC7/AC11: MCP registers the Cloudpit name and still cleans both legacy names', () => {
  assert.equal(MCP_SERVER_NAME, 'cloudpit-browser');
  assert.deepEqual([...LEGACY_MCP_SERVER_NAMES], ['cloudcli-browser', 'cloudcli-browser-use']);
  assert.deepEqual(mcpServerNamesToRemove(), [
    'cloudpit-browser',
    'cloudcli-browser',
    'cloudcli-browser-use',
  ]);

  // Negative control: a name outside the current + legacy set is never a cleanup target.
  assert.equal(mcpServerNamesToRemove().includes('experimental-browser'), false);
  assert.equal(LEGACY_MCP_SERVER_NAMES.includes('experimental-browser'), false);

  const entrySource = readApplicationFile('server/modules/cli/browser-use-mcp.ts');
  assert.match(
    entrySource,
    /serverInfo:\s*\{\s*name:\s*'cloudpit-browser'/,
    'the MCP initialize reply must identify as cloudpit-browser',
  );
});

/** Builds the fake token service `/mcp` consumes, with one fixed scope list. */
function fakeTokensService(scopes: string[]): AccessTokensService {
  return {
    issueToken: () => ({ ok: false, reason: 'invalid_scope' }),
    verifyToken: () => ({
      ok: true,
      userId: 1,
      tokenId: 2,
      scopes,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    revokeToken: () => true,
  };
}

/** Drives one `ccp_` request through the real middleware and returns the principal it attached. */
function principalForScopes(scopes: string[]) {
  const middleware = createMcpAuthMiddleware(fakeTokensService(scopes));
  const response = { locals: {} } as unknown as Parameters<typeof readMcpPrincipal>[0];
  const request = {
    headers: { authorization: 'Bearer ccp_criterion' },
  } as unknown as Parameters<typeof middleware>[0];
  let nextCalled = false;
  middleware(request, response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true, 'a valid token must reach the transport');
  return readMcpPrincipal(response);
}

test('AC8/AC11: both scope vocabularies are issued and judged; unknown scopes stay refused', () => {
  const metadata = buildAuthorizationServerMetadata({
    baseUrl: 'https://cloudpit.example.test',
    dcrMode: 'off',
  });
  assert.equal(CLOUDPIT_ACCESS_TOKEN_SCOPES.length, 8);
  assert.equal(ACCESS_TOKEN_SCOPES.length, 8);
  for (const scope of ACCESS_TOKEN_SCOPES) {
    assert.ok(metadata.scopes_supported.includes(scope), `AS metadata must advertise ${scope}`);
  }
  for (const scope of CLOUDPIT_ACCESS_TOKEN_SCOPES) {
    assert.ok(metadata.scopes_supported.includes(scope), `AS metadata must advertise ${scope}`);
  }
  assert.equal(metadata.scopes_supported.length, 16);

  // Dedupe on the canonical name, store the spelling the caller asked for.
  assert.deepEqual(normalizeAccessTokenScopes(['cloudcli:read', 'cloudpit:read']), {
    ok: true,
    scopes: ['cloudcli:read'],
  });
  assert.deepEqual(normalizeAccessTokenScopes(['cloudpit:read', 'cloudcli:read']), {
    ok: true,
    scopes: ['cloudpit:read'],
  });
  assert.deepEqual(normalizeAccessTokenScopes(['cloudpit:read', 'cloudpit:session:send']), {
    ok: true,
    scopes: ['cloudpit:read', 'cloudpit:session:send'],
  });
  assert.deepEqual(normalizeAccessTokenScopes(['cloudcli:admin']), { ok: false });
  assert.deepEqual(normalizeAccessTokenScopes(['cloudpit:unknown']), { ok: false });

  // AC11's old-token arm: the legacy spelling is still accepted and still satisfies the legacy
  // required scope. The principal is built from the minted scope list, so dropping the old
  // spelling from the accepted table would refuse the mint here.
  const legacyMinted = normalizeAccessTokenScopes(['cloudcli:read']);
  assert.deepEqual(legacyMinted, { ok: true, scopes: ['cloudcli:read'] });
  const legacyPrincipal = principalForScopes(legacyMinted.ok ? legacyMinted.scopes : []);
  assert.ok(legacyPrincipal);
  assert.ok(legacyPrincipal.scopes.includes('cloudcli:read'));

  // A token minted with the Cloudpit spelling is judged by the same old literal.
  const cloudpitMinted = normalizeAccessTokenScopes(['cloudpit:read', 'cloudpit:session:send']);
  assert.deepEqual(cloudpitMinted, { ok: true, scopes: ['cloudpit:read', 'cloudpit:session:send'] });
  const cloudpitPrincipal = principalForScopes(cloudpitMinted.ok ? cloudpitMinted.scopes : []);
  assert.ok(cloudpitPrincipal);
  assert.deepEqual(cloudpitPrincipal.scopes, ['cloudcli:read', 'cloudcli:session:send']);
  assert.ok(cloudpitPrincipal.scopes.includes('cloudcli:read'));
});

test('AC9: activation deletes both cache families and keeps unrelated caches', async () => {
  const cacheNames = [
    'cloudpit-v1',
    'cloudpit-old',
    'claude-ui-v3',
    'claude-ui-legacy',
    'voice-client-asr-model-v1',
    'other',
  ];
  const deleted: string[] = [];
  const listeners = new Map<string, (event: { waitUntil(promise: Promise<unknown>): void }) => void>();
  let claimed = false;

  const context = createContext({
    caches: {
      keys: () => Promise.resolve([...cacheNames]),
      delete: (name: string) => {
        deleted.push(name);
        return Promise.resolve(true);
      },
    },
    self: {
      addEventListener: (
        type: string,
        listener: (event: { waitUntil(promise: Promise<unknown>): void }) => void,
      ) => {
        listeners.set(type, listener);
      },
      clients: {
        claim: () => {
          claimed = true;
          return Promise.resolve();
        },
      },
    },
    console,
  });
  runInContext(readApplicationFile('public/sw.js'), context, { filename: 'public/sw.js' });

  const activate = listeners.get('activate');
  assert.ok(activate, 'the worker must register an activate listener');
  let pending: Promise<unknown> = Promise.resolve();
  activate({ waitUntil: (promise) => { pending = promise; } });
  await pending;

  assert.deepEqual([...deleted].sort(), ['claude-ui-legacy', 'claude-ui-v3', 'cloudpit-old']);
  assert.equal(deleted.includes('cloudpit-v1'), false);
  assert.equal(deleted.includes('voice-client-asr-model-v1'), false);
  assert.equal(deleted.includes('other'), false);
  assert.equal(claimed, true);
});

test('AC10/AC11 (v3.0): CLOUDPIT_* is the only environment spelling read', () => {
  // New name only: the reading names the canonical key.
  const newOnly = createBrandEnvReader({
    env: { CLOUDPIT_HOME: '/new/home' },
  }).read('HOME');
  assert.deepEqual(newOnly, { value: '/new/home', source: 'new', key: 'CLOUDPIT_HOME' });

  // Both set: the Cloudpit spelling wins and the legacy one is not read.
  const both = createBrandEnvReader({
    env: { CLOUDPIT_HOME: '/new/home', CLOUDCLI_HOME: '/legacy/home' },
  }).read('HOME');
  assert.deepEqual(both, { value: '/new/home', source: 'new', key: 'CLOUDPIT_HOME' });

  // Legacy name only: no fallback any more — the read is absent (the shipped default applies).
  assert.deepEqual(
    createBrandEnvReader({ env: { CLOUDCLI_HOME: '/legacy/home' } }).read('HOME'),
    { value: undefined, source: 'absent', key: 'CLOUDPIT_HOME' },
  );

  // Absent: the reading still names the canonical key the operator should set.
  assert.deepEqual(createBrandEnvReader({ env: {} }).read('HOME'), {
    value: undefined,
    source: 'absent',
    key: 'CLOUDPIT_HOME',
  });

  // The production resolver reads the same one spelling: CLOUDPIT_HOME wins, and a
  // CLOUDCLI_HOME-only environment selects the default `~/.cloudpit` root instead.
  const homeDir = temporaryHome('cloudpit-runtime-env-');
  try {
    const newRoot = path.join(homeDir, 'explicit-new');
    const legacyRoot = path.join(homeDir, 'explicit-legacy');
    assert.equal(
      resolveDataRoots({
        env: { CLOUDPIT_HOME: newRoot, CLOUDCLI_HOME: legacyRoot },
        homeDir,
      }).activeRoot,
      newRoot,
      'CLOUDPIT_HOME must win over CLOUDCLI_HOME',
    );
    assert.equal(
      resolveDataRoots({ env: { CLOUDCLI_HOME: legacyRoot }, homeDir }).activeRoot,
      path.join(homeDir, '.cloudpit'),
      'CLOUDCLI_HOME must no longer select a root',
    );
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('AC10/AC11: IPC, contextBridge, BroadcastChannel and the semantic surface carry the Cloudpit names', () => {
  const mainSource = readApplicationFile('electron/main.js');
  const preloadSource = readApplicationFile('electron/preload.cjs');
  const windowSource = readApplicationFile('electron/desktopWindow.js');
  const launcherSource = readApplicationFile('electron/launcher/launcher.js');

  // Negative arm first: no live channel may still use the legacy prefix.
  for (const [file, source] of [
    ['electron/main.js', mainSource],
    ['electron/preload.cjs', preloadSource],
    ['electron/desktopWindow.js', windowSource],
  ] as const) {
    assert.equal(
      source.includes('cloudcli-desktop:'),
      false,
      `${file} must not carry the legacy IPC channel prefix`,
    );
  }

  // Positive arm: every registered, sent and invoked channel is a Cloudpit channel.
  const registeredChannels = [...mainSource.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((match) => match[1]);
  assert.ok(registeredChannels.length >= 20, `expected the IPC surface to be present, got ${registeredChannels.length}`);
  for (const channel of registeredChannels) {
    assert.match(channel, /^cloudpit-desktop:/, `registered channel ${channel} must use the new prefix`);
  }
  const sentChannels = [...windowSource.matchAll(/\.send\('([^']+)'/g)].map((match) => match[1]);
  assert.ok(sentChannels.length > 0, 'desktopWindow.js must push state to the renderer');
  for (const channel of sentChannels) {
    assert.match(channel, /^cloudpit-desktop:/, `pushed channel ${channel} must use the new prefix`);
  }
  const invokedChannels = [...preloadSource.matchAll(/invoke\('([^']+)'/g)].map((match) => match[1]);
  assert.ok(invokedChannels.length >= 20, `expected the preload bridge to be present, got ${invokedChannels.length}`);
  for (const channel of invokedChannels) {
    assert.ok(registeredChannels.includes(channel), `preload invoke ${channel} must have a registered handler`);
    assert.match(channel, /^cloudpit-desktop:/);
  }

  // contextBridge exposure names and every live consumer.
  assert.match(preloadSource, /exposeInMainWorld\('cloudpitDesktopNotifications'/);
  assert.match(preloadSource, /exposeInMainWorld\('cloudpitDesktop'/);
  assert.equal(preloadSource.includes('cloudcliDesktop'), false, 'the preload must not expose the legacy bridge names');
  assert.ok(launcherSource.includes('window.cloudpitDesktop'), 'the launcher must read the new bridge name');
  for (const file of ['src/modules/settings/Settings.tsx', 'src/modules/settings/hooks/useWebPush.ts']) {
    const source = readApplicationFile(file);
    assert.ok(source.includes('cloudpitDesktopNotifications'), `${file} must read the new bridge name`);
    assert.equal(source.includes('cloudcliDesktop'), false, `${file} must not read the legacy bridge name`);
  }

  // The architecture BroadcastChannel.
  const bridgeSource = readApplicationFile('src/modules/architecture/architectureChatBridge.ts');
  assert.match(bridgeSource, /ARCHITECTURE_CHAT_CHANNEL = 'cloudpit-architecture'/);
  assert.equal(bridgeSource.includes('cloudcli-architecture'), false, 'the channel name must not stay legacy');

  // The dev-only semantic surface, and every live reader/writer of it.
  const surfaceSource = readApplicationFile('src/modules/ui-scenario/scenarioSurface.ts');
  assert.ok(surfaceSource.includes('__cloudpitScenario'), 'scenarioSurface.ts must install the new surface name');
  assert.equal(surfaceSource.includes('__cloudcliScenario'), false);
  for (const file of ['src/main.tsx', 'src/modules/ui-scenario/index.ts', 'scripts/ui-scenario.mjs']) {
    const source = readApplicationFile(file);
    assert.ok(source.includes('__cloudpitScenario'), `${file} must reference the new semantic surface`);
    assert.equal(source.includes('__cloudcliScenario'), false, `${file} must not reference the legacy surface`);
  }
});
