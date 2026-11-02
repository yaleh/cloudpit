/**
 * `cloudpit migrate-assets` criterion file.
 *
 * Five arms drive the real command service against temp-home fixtures:
 * dry-run writes nothing, rewrite is idempotent, conflicts are never
 * overwritten, a failed path write rolls back to the pre-run bytes, and
 * provider transcript references are reported as unrewritable.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test server/modules/cli/tests/asset-migration.service.test.ts
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

import {
  createNodeAssetMigrationFileSystem,
} from '../asset-migration-files.js';
import {
  createAssetMigrationService,
} from '../asset-migration.service.js';
import type { AssetMigrationReport } from '../asset-migration-report.js';
import {
  createAppAssetPathStore,
  type AssetPathStore,
} from '../asset-migration-store.js';

type TestContext = { after(callback: () => void): void };

type Fixture = {
  root: string;
  homeDir: string;
  legacyRoot: string;
  newRoot: string;
  databasePath: string;
  settingsPath: string;
};

function createFixture(t: TestContext): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cloudpit-migrate-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const homeDir = path.join(root, 'home');
  const legacyRoot = path.join(homeDir, '.cloudcli', 'assets');
  const newRoot = path.join(homeDir, '.cloudpit', 'assets');
  mkdirSync(legacyRoot, { recursive: true });
  return {
    root,
    homeDir,
    legacyRoot,
    newRoot,
    databasePath: path.join(homeDir, '.cloudpit', 'auth.db'),
    settingsPath: path.join(homeDir, '.config', 'cloudpit', 'server.settings.json'),
  };
}

function writeFileWithDirectories(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

/** Every path under `root` with directories marked and files hashed. */
function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (directoryPath: string): void => {
    if (!existsSync(directoryPath)) return;
    for (const entryName of readdirSync(directoryPath)) {
      const entryPath = path.join(directoryPath, entryName);
      const relativePath = path.relative(root, entryPath).split(path.sep).join('/');
      if (statSync(entryPath).isDirectory()) {
        snapshot[`${relativePath}/`] = 'directory';
        walk(entryPath);
      } else {
        snapshot[relativePath] = createHash('sha256')
          .update(readFileSync(entryPath))
          .digest('hex');
      }
    }
  };
  walk(root);
  return snapshot;
}

function createOutput(): {
  output: { log(message?: string): void; error(message?: string): void };
  logMessages: string[];
  errorMessages: string[];
} {
  const logMessages: string[] = [];
  const errorMessages: string[] = [];
  return {
    output: {
      log: (message = '') => logMessages.push(message),
      error: (message = '') => errorMessages.push(message),
    },
    logMessages,
    errorMessages,
  };
}

function readJsonReport(logMessages: string[]): AssetMigrationReport {
  const rawReport = logMessages.find((message) => message.trimStart().startsWith('{'));
  assert.ok(rawReport, `no JSON report in output: ${logMessages.join('\n')}`);
  return JSON.parse(rawReport) as AssetMigrationReport;
}

function createStore(fixture: Fixture): AssetPathStore {
  return createAppAssetPathStore({
    databasePath: fixture.databasePath,
    jsonFilePaths: [fixture.settingsPath],
    now: () => new Date(2026, 10, 3, 12, 0, 0),
  });
}

function createService(
  fixture: Fixture,
  pathStore: AssetPathStore,
  capture = createOutput(),
) {
  return {
    capture,
    service: createAssetMigrationService({
      environment: {},
      homeDirectory: fixture.homeDir,
      fileSystem: createNodeAssetMigrationFileSystem(),
      pathStore,
      output: capture.output,
    }),
  };
}

/** Seeds one SQLite row and one JSON document that both embed `legacyRoot`. */
function seedPersistedPaths(fixture: Fixture): { imagePath: string } {
  const imagePath = path.join(fixture.legacyRoot, 'photo.png');
  mkdirSync(path.dirname(fixture.databasePath), { recursive: true });
  const database = new Database(fixture.databasePath);
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_messages (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        content TEXT NOT NULL,
        options TEXT NOT NULL DEFAULT '{}'
      )
    `);
    database
      .prepare('INSERT INTO scheduled_messages (id, user_id, session_id, content, options) VALUES (?, ?, ?, ?, ?)')
      .run('scheduled-1', 1, 'session-1', 'hello', JSON.stringify({
        attachments: [{ path: imagePath }],
      }));
  } finally {
    database.close();
  }
  writeFileWithDirectories(
    fixture.settingsPath,
    `${JSON.stringify({ avatarPath: imagePath }, null, 2)}\n`,
  );
  return { imagePath };
}

function readScheduledOptions(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = database
      .prepare('SELECT options FROM scheduled_messages WHERE id = ?')
      .get('scheduled-1') as { options: string };
    return row.options;
  } finally {
    database.close();
  }
}

test('dry-run scans the legacy tree and persisted documents without writing anything', async (t) => {
  const fixture = createFixture(t);
  writeFileWithDirectories(path.join(fixture.legacyRoot, 'one.png'), 'one');
  writeFileWithDirectories(path.join(fixture.legacyRoot, 'nested', 'two.pdf'), 'two');
  const { imagePath } = seedPersistedPaths(fixture);
  const before = snapshotTree(fixture.homeDir);
  const { service, capture } = createService(fixture, createStore(fixture));

  const exitCode = await service.execute(['--dry-run', '--json']);

  assert.equal(exitCode, 0);
  assert.deepEqual(snapshotTree(fixture.homeDir), before, 'a dry run must not create or modify a file');
  const report = readJsonReport(capture.logMessages);
  assert.equal(report.copied, 2);
  assert.equal(report.skipped, 0);
  assert.equal(report.rewritten, 2);
  assert.deepEqual(report.conflicts, []);
  assert.deepEqual(report.backupPaths, []);
  assert.deepEqual(report.errors, []);
  assert.equal(existsSync(path.join(fixture.newRoot, 'one.png')), false);
  assert.match(readFileSync(fixture.settingsPath, 'utf8'), new RegExp(`"avatarPath": ${JSON.stringify(imagePath)}`));
});

test('--help and the bare command both print usage', async (t) => {
  const fixture = createFixture(t);
  const { service, capture } = createService(fixture, createStore(fixture));

  assert.equal(await service.execute(['--help']), 0);
  assert.match(capture.logMessages.join('\n'), /migrate-assets --dry-run/);
  assert.match(capture.logMessages.join('\n'), /migrate-assets --rewrite/);

  capture.logMessages.length = 0;
  assert.equal(await service.execute([]), 1);
  assert.match(capture.logMessages.join('\n'), /Usage:/);
});

test('--rewrite copies into the new root, keeps the legacy files, and is idempotent', async (t) => {
  const fixture = createFixture(t);
  writeFileWithDirectories(path.join(fixture.legacyRoot, 'one.png'), 'one');
  writeFileWithDirectories(path.join(fixture.legacyRoot, 'two.pdf'), 'two');
  const { service, capture } = createService(fixture, createStore(fixture));

  assert.equal(await service.execute(['--rewrite', '--json']), 0);
  const firstReport = readJsonReport(capture.logMessages);
  assert.equal(firstReport.copied, 2);
  assert.equal(firstReport.skipped, 0);
  assert.equal(readFileSync(path.join(fixture.newRoot, 'one.png'), 'utf8'), 'one');
  assert.equal(readFileSync(path.join(fixture.newRoot, 'two.pdf'), 'utf8'), 'two');
  assert.equal(readFileSync(path.join(fixture.legacyRoot, 'one.png'), 'utf8'), 'one');
  assert.equal(readFileSync(path.join(fixture.legacyRoot, 'two.pdf'), 'utf8'), 'two');

  capture.logMessages.length = 0;
  assert.equal(await service.execute(['--rewrite', '--json']), 0);
  const secondReport = readJsonReport(capture.logMessages);
  assert.equal(secondReport.copied, 0);
  assert.equal(secondReport.skipped, 2, 'every file is skipped on the second run');
  assert.deepEqual(secondReport.conflicts, []);
});

test('a conflicting target is never overwritten and is reported', async (t) => {
  const fixture = createFixture(t);
  writeFileWithDirectories(path.join(fixture.legacyRoot, 'photo.png'), 'legacy bytes');
  writeFileWithDirectories(path.join(fixture.newRoot, 'photo.png'), 'newer bytes');
  const { service, capture } = createService(fixture, createStore(fixture));

  const exitCode = await service.execute(['--rewrite', '--json']);

  assert.equal(exitCode, 0);
  const report = readJsonReport(capture.logMessages);
  assert.equal(report.copied, 0);
  assert.deepEqual(report.conflicts, ['photo.png']);
  assert.equal(readFileSync(path.join(fixture.newRoot, 'photo.png'), 'utf8'), 'newer bytes');
  assert.equal(readFileSync(path.join(fixture.legacyRoot, 'photo.png'), 'utf8'), 'legacy bytes');
});

test('--rewrite rewrites app DB and JSON paths after taking a backup', async (t) => {
  const fixture = createFixture(t);
  const { imagePath } = seedPersistedPaths(fixture);
  const beforeSettings = readFileSync(fixture.settingsPath, 'utf8');
  const { service, capture } = createService(fixture, createStore(fixture));

  const exitCode = await service.execute(['--rewrite', '--json']);

  assert.equal(exitCode, 0);
  const report = readJsonReport(capture.logMessages);
  assert.equal(report.rewritten, 2);
  assert.equal(report.backupPaths.length, 2, 'the database and the JSON state are both backed up');
  for (const backupPath of report.backupPaths) {
    assert.equal(existsSync(backupPath), true, `missing backup ${backupPath}`);
  }

  const expectedNewPath = path.join(fixture.newRoot, 'photo.png');
  assert.equal(readFileSync(fixture.settingsPath, 'utf8'), beforeSettings.replace(imagePath, expectedNewPath));
  assert.match(readScheduledOptions(fixture.databasePath), new RegExp(expectedNewPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const settingsBackup = report.backupPaths.find((backupPath) => backupPath.includes('server.settings.json'));
  assert.ok(settingsBackup);
  assert.equal(readFileSync(settingsBackup, 'utf8'), beforeSettings, 'the backup keeps the pre-rewrite bytes');

  capture.logMessages.length = 0;
  assert.equal(await service.execute(['--rewrite', '--json']), 0);
  assert.equal(readJsonReport(capture.logMessages).rewritten, 0, 'a second run has nothing left to rewrite');
});

test('an injected write failure keeps the original files and creates no half-rewritten state', async (t) => {
  const fixture = createFixture(t);
  const { imagePath } = seedPersistedPaths(fixture);
  const beforeSettings = readFileSync(fixture.settingsPath, 'utf8');
  const beforeOptions = readScheduledOptions(fixture.databasePath);
  const backingStore = createStore(fixture);
  const failingStore: AssetPathStore = {
    readDocuments: () => backingStore.readDocuments(),
    backup: () => backingStore.backup(),
    restore: (backupPaths) => backingStore.restore(backupPaths),
    writeDocuments: () => {
      throw new Error('injected write failure');
    },
  };
  const { service, capture } = createService(fixture, failingStore);

  const exitCode = await service.execute(['--rewrite', '--json']);

  assert.equal(exitCode, 1);
  const report = readJsonReport(capture.logMessages);
  assert.equal(report.rewritten, 0);
  assert.match(report.errors.join('\n'), /injected write failure/);
  assert.ok(report.backupPaths.length > 0, 'backups are taken before the failing write');
  assert.equal(readFileSync(fixture.settingsPath, 'utf8'), beforeSettings);
  assert.equal(readScheduledOptions(fixture.databasePath), beforeOptions);
  assert.match(capture.errorMessages.join('\n'), /injected write failure/);
  assert.match(beforeSettings, new RegExp(imagePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('provider transcript references are listed as unrewritable and the command warns', async (t) => {
  const fixture = createFixture(t);
  writeFileWithDirectories(path.join(fixture.legacyRoot, 'one.png'), 'one');
  const transcriptPath = path.join(fixture.homeDir, '.claude', 'projects', 'project-a', 'session.jsonl');
  const legacyReference = path.join(fixture.legacyRoot, 'one.png');
  writeFileWithDirectories(
    transcriptPath,
    [
      JSON.stringify({ type: 'user', text: 'unrelated' }),
      JSON.stringify({ type: 'user', text: `look at ${legacyReference}` }),
    ].join('\n'),
  );
  const beforeTranscript = readFileSync(transcriptPath, 'utf8');
  const { service, capture } = createService(fixture, createStore(fixture));

  const exitCode = await service.execute(['--rewrite', '--json']);

  assert.equal(exitCode, 3, 'unrewritable references must not look like success');
  const report = readJsonReport(capture.logMessages);
  assert.deepEqual(report.unrewritable, [`${transcriptPath}:2`]);
  assert.match(capture.errorMessages.join('\n'), /unrewritable|not rewritten/);
  assert.equal(readFileSync(transcriptPath, 'utf8'), beforeTranscript, 'transcripts are never rewritten');
  assert.equal(existsSync(path.join(fixture.newRoot, 'one.png')), true, 'the copy half still runs');
});
