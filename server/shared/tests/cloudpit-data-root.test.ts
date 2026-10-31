/**
 * The Cloudpit data-root criterion (AC-449's judgement file).
 *
 * Every leg drives the real resolver against a temp home: the unchanged legacy
 * default, the full migration, the legacy root staying byte-identical, new
 * writes landing in the new root, re-entrancy through the completion marker,
 * the two safety arms, and the failure fallback.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-data-root.test.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { resolveDataRoots } from '../data-root.js';

type TestContext = { after(callback: () => void): void };

function temporaryRoot(t: TestContext, prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

type LegacyFixture = {
  homeDir: string;
  legacyRoot: string;
  legacyConfigDir: string;
  legacySettingsPath: string;
  newRoot: string;
  explicitSettingsPath: string;
};

/**
 * Build the legacy layout: an SQLite database with a readable row, a
 * `voice-data/` directory, the two JSON data files and the legacy settings.
 */
function seedLegacyFixture(root: string): LegacyFixture {
  const homeDir = path.join(root, 'home');
  const legacyRoot = path.join(homeDir, '.cloudcli');
  const legacyConfigDir = path.join(homeDir, '.config', 'claudecodeui');
  mkdirSync(path.join(legacyRoot, 'voice-data'), { recursive: true });
  mkdirSync(legacyConfigDir, { recursive: true });

  const database = new Database(path.join(legacyRoot, 'auth.db'));
  database.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL)');
  database.prepare('INSERT INTO probe (id, label) VALUES (?, ?)').run(1, 'legacy-row');
  database.close();

  writeFileSync(path.join(legacyRoot, 'voice-data', 'recording-1.wav'), Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02, 0x03]));
  writeFileSync(path.join(legacyRoot, 'voice-data', 'manifest.json'), '{"kept":1}\n');
  writeFileSync(path.join(legacyRoot, 'cockpit-card-feedback.json'), '{"cards":{"a":"kept"}}\n');
  writeFileSync(path.join(legacyRoot, 'reply-suggestions-usage.jsonl'), '{"id":"one"}\n{"id":"two"}\n');
  writeFileSync(
    path.join(legacyConfigDir, 'server.settings.json'),
    '{"counterVoice":{"enabled":true}}\n',
  );

  return {
    homeDir,
    legacyRoot,
    legacyConfigDir,
    legacySettingsPath: path.join(legacyConfigDir, 'server.settings.json'),
    newRoot: path.join(root, 'new-root'),
    explicitSettingsPath: path.join(homeDir, '.config', 'cloudpit', 'server.settings.json'),
  };
}

function sha256(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

/** Recursively map `relative path -> SHA256` for a whole tree. */
function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory)) {
      const fullPath = path.join(directory, entry);
      const relativePath = prefix === '' ? entry : `${prefix}/${entry}`;
      if (statSync(fullPath).isDirectory()) walk(fullPath, relativePath);
      else snapshot[relativePath] = sha256(fullPath);
    }
  };
  if (existsSync(root)) walk(root, '');
  return snapshot;
}

/** The legacy data root plus the legacy config root, keyed apart. */
function snapshotLegacyLayout(fixture: LegacyFixture): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(snapshotTree(fixture.legacyRoot))) {
    snapshot[`data/${key}`] = value;
  }
  for (const [key, value] of Object.entries(snapshotTree(fixture.legacyConfigDir))) {
    snapshot[`config/${key}`] = value;
  }
  return snapshot;
}

const MIGRATED_DATA_FILES = [
  'voice-data/recording-1.wav',
  'voice-data/manifest.json',
  'cockpit-card-feedback.json',
  'reply-suggestions-usage.jsonl',
] as const;

test('AC2: with no explicit root the legacy default is active and ~/.cloudpit stays absent', (t) => {
  const root = temporaryRoot(t, 'cloudpit-ac2-');
  const homeDir = path.join(root, 'home');
  mkdirSync(homeDir, { recursive: true });

  const plan = resolveDataRoots({ env: {}, homeDir });

  assert.notEqual(plan.activeRoot, path.join(homeDir, '.cloudpit'), 'the default must not move to ~/.cloudpit');
  assert.equal(plan.activeRoot, path.join(homeDir, '.cloudcli'));
  assert.equal(plan.reason, 'default-legacy');
  assert.equal(plan.migrated, false);
  assert.equal(existsSync(path.join(homeDir, '.cloudpit')), false);
  assert.equal(plan.settingsPath, path.join(homeDir, '.config', 'claudecodeui', 'server.settings.json'));
  assert.equal(plan.legacySettingsPath, plan.settingsPath);
  assert.equal(plan.authDatabasePath, path.join(plan.activeRoot, 'auth.db'));
  assert.equal(plan.voiceDataDir, path.join(plan.activeRoot, 'voice-data'));
});

test('AC3: an explicit root receives the whole legacy layout', (t) => {
  const root = temporaryRoot(t, 'cloudpit-ac3-');
  const fixture = seedLegacyFixture(root);

  const plan = resolveDataRoots({ env: { CLOUDPIT_HOME: fixture.newRoot }, homeDir: fixture.homeDir });

  assert.equal(plan.activeRoot, fixture.newRoot);
  assert.equal(plan.reason, 'explicit-migrated');
  assert.equal(plan.migrated, true);

  const migratedDatabase = new Database(path.join(fixture.newRoot, 'auth.db'), { readonly: true });
  try {
    assert.deepEqual(migratedDatabase.prepare('SELECT id, label FROM probe').all(), [
      { id: 1, label: 'legacy-row' },
    ]);
  } finally {
    migratedDatabase.close();
  }

  for (const relativePath of MIGRATED_DATA_FILES) {
    assert.deepEqual(
      readFileSync(path.join(fixture.newRoot, relativePath)),
      readFileSync(path.join(fixture.legacyRoot, relativePath)),
      `${relativePath} must be byte-identical to the legacy copy`,
    );
  }

  assert.equal(
    readFileSync(fixture.explicitSettingsPath, 'utf8'),
    readFileSync(fixture.legacySettingsPath, 'utf8'),
    'the legacy settings must move to the explicit config root',
  );

  const marker = JSON.parse(
    readFileSync(path.join(fixture.newRoot, '.migrated-from-cloudcli'), 'utf8'),
  ) as { source: string; at: string; version: string };
  assert.equal(marker.source, fixture.legacyRoot);
  assert.match(marker.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof marker.version, 'string');
});

test('AC3: CLOUDCLI_HOME is the fallback spelling for the explicit root', (t) => {
  const root = temporaryRoot(t, 'cloudpit-ac3-legacy-env-');
  const fixture = seedLegacyFixture(root);

  const plan = resolveDataRoots({ env: { CLOUDCLI_HOME: fixture.newRoot }, homeDir: fixture.homeDir });

  assert.equal(plan.activeRoot, fixture.newRoot);
  assert.equal(plan.reason, 'explicit-migrated');
  assert.equal(plan.migrated, true);
});

test('AC4: the legacy root is byte-for-byte unchanged after migrating', (t) => {
  const root = temporaryRoot(t, 'cloudpit-ac4-');
  const fixture = seedLegacyFixture(root);
  const before = snapshotLegacyLayout(fixture);
  assert.ok(Object.keys(before).length > 0, 'the fixture must produce a non-empty snapshot');

  const plan = resolveDataRoots({ env: { CLOUDPIT_HOME: fixture.newRoot }, homeDir: fixture.homeDir });
  assert.equal(plan.migrated, true);

  assert.deepEqual(snapshotLegacyLayout(fixture), before);
});

test('AC5: new writes land in the new root and never touch the legacy copy', (t) => {
  const root = temporaryRoot(t, 'cloudpit-ac5-');
  const fixture = seedLegacyFixture(root);
  const plan = resolveDataRoots({ env: { CLOUDPIT_HOME: fixture.newRoot }, homeDir: fixture.homeDir });

  assert.equal(plan.reason, 'explicit-migrated');
  assert.equal(plan.voiceDataDir, path.join(plan.activeRoot, 'voice-data'));
  assert.equal(plan.authDatabasePath, path.join(plan.activeRoot, 'auth.db'));

  const legacyUsagePath = path.join(fixture.legacyRoot, 'reply-suggestions-usage.jsonl');
  const legacyBytes = readFileSync(legacyUsagePath);
  const newBytesBefore = readFileSync(plan.replySuggestionsUsagePath);

  writeFileSync(plan.replySuggestionsUsagePath, Buffer.concat([newBytesBefore, Buffer.from('{"id":"three"}\n')]));

  assert.ok(statSync(plan.replySuggestionsUsagePath).size > newBytesBefore.length);
  assert.deepEqual(readFileSync(legacyUsagePath), legacyBytes, 'the legacy usage log must not grow');
});

test('AC6: a second resolution sees the marker, keeps the new data, and does not re-copy', (t) => {
  const root = temporaryRoot(t, 'cloudpit-ac6-');
  const fixture = seedLegacyFixture(root);
  const firstPlan = resolveDataRoots({ env: { CLOUDPIT_HOME: fixture.newRoot }, homeDir: fixture.homeDir });
  assert.equal(firstPlan.reason, 'explicit-migrated');

  const sentinel = '{"id":"written-after-migration"}\n';
  writeFileSync(firstPlan.replySuggestionsUsagePath, sentinel);

  const secondPlan = resolveDataRoots({ env: { CLOUDPIT_HOME: fixture.newRoot }, homeDir: fixture.homeDir });
  assert.equal(secondPlan.migrated, false);
  assert.equal(secondPlan.reason, 'explicit-already-migrated');
  assert.equal(readFileSync(secondPlan.replySuggestionsUsagePath, 'utf8'), sentinel, 'the sentinel must not be overwritten');

  const marker = JSON.parse(
    readFileSync(path.join(fixture.newRoot, '.migrated-from-cloudcli'), 'utf8'),
  ) as { source: string };
  assert.equal(marker.source, fixture.legacyRoot);
});

test('AC7: an existing non-empty user root is left untouched', (t) => {
  const root = temporaryRoot(t, 'cloudpit-ac7-user-');
  const fixture = seedLegacyFixture(root);
  mkdirSync(fixture.newRoot, { recursive: true });
  const userFile = path.join(fixture.newRoot, 'user-owned.txt');
  writeFileSync(userFile, 'do not touch\n');

  const plan = resolveDataRoots({ env: { CLOUDPIT_HOME: fixture.newRoot }, homeDir: fixture.homeDir });

  assert.equal(plan.reason, 'explicit-user-root');
  assert.equal(plan.migrated, false);
  assert.equal(plan.activeRoot, fixture.newRoot);
  assert.equal(readFileSync(userFile, 'utf8'), 'do not touch\n');
  assert.equal(existsSync(path.join(fixture.newRoot, 'auth.db')), false);
  assert.equal(existsSync(path.join(fixture.newRoot, '.migrated-from-cloudcli')), false);
});

test('AC7: an explicit root with no legacy layout is active but not marked', (t) => {
  const root = temporaryRoot(t, 'cloudpit-ac7-no-legacy-');
  const homeDir = path.join(root, 'home');
  mkdirSync(homeDir, { recursive: true });
  const newRoot = path.join(root, 'new-root');

  const plan = resolveDataRoots({ env: { CLOUDPIT_HOME: newRoot }, homeDir });

  assert.equal(plan.reason, 'explicit-no-legacy');
  assert.equal(plan.migrated, false);
  assert.equal(plan.activeRoot, newRoot);
  assert.equal(existsSync(path.join(newRoot, '.migrated-from-cloudcli')), false);
});

test('AC8: a SQLITE_BUSY backup falls back to the legacy root and rolls the new root back', (t) => {
  const root = temporaryRoot(t, 'cloudpit-ac8-');
  const fixture = seedLegacyFixture(root);
  const before = snapshotLegacyLayout(fixture);

  const busyError = new Error('SQLITE_BUSY: database is locked');
  (busyError as NodeJS.ErrnoException).code = 'SQLITE_BUSY';

  const plan = resolveDataRoots({
    env: { CLOUDPIT_HOME: fixture.newRoot },
    homeDir: fixture.homeDir,
    backupDatabase: () => {
      throw busyError;
    },
  });

  assert.equal(plan.activeRoot, path.join(fixture.homeDir, '.cloudcli'));
  assert.equal(plan.reason, 'fallback-after-failure');
  assert.equal(plan.migrated, false);
  assert.equal(plan.settingsPath, path.join(fixture.homeDir, '.config', 'claudecodeui', 'server.settings.json'));
  assert.equal(existsSync(fixture.newRoot), false, 'the newly created root must be removed');
  assert.equal(existsSync(fixture.explicitSettingsPath), false, 'the new settings file must not be left behind');
  assert.equal(existsSync(path.join(fixture.newRoot, '.migrated-from-cloudcli')), false);
  assert.deepEqual(snapshotLegacyLayout(fixture), before, 'the legacy root must survive the failed attempt');
});
