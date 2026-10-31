/**
 * Covers `scripts/repair-session-binding.mjs`.
 *
 * Two shapes are repaired:
 *   - `null-path-retired` — the row claims a real thread, `jsonl_path` is NULL,
 *     and that same thread is wrongly marked retired for the session;
 *   - `fork-rebind` — the legacy shape where the row points at a metadata-only
 *     fork while the binding claims the original thread.
 *
 * Every fixture is a temp SQLite database plus temp transcript files; the Codex
 * sessions walk is pointed at an empty temp root so a fixture can never be
 * answered by the host's real `~/.codex` tree.
 *
 * Run with: node --test scripts/repair-session-binding.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import Database from 'better-sqlite3';

import {
  applyRepair,
  inspectTranscript,
  readState,
  repairSession,
  toSqliteUtc,
} from './repair-session-binding.mjs';

const PROJECT = '/fixture/project';
const APP_SESSION = 'a0794390-8619-4c21-981b-faa702cf96f6';
const THREAD = '01a190a1-a148-7e90-8461-2937533839e9';
const FORK_THREAD = '01a190a2-b258-8fa1-9572-3048544940fa';
const LAST_ACTIVITY = '2026-10-31T11:11:26.845Z';
const OLD_UPDATED_AT = '2026-10-31 06:27:15';

const SESSIONS_ROOT = mkdtempSync(path.join(os.tmpdir(), 'repair-binding-sessions-'));
process.env.CODEX_SESSIONS_ROOT = SESSIONS_ROOT;

after(() => {
  rmSync(SESSIONS_ROOT, { recursive: true, force: true });
});

/** @returns {string} */
function withTempDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'repair-binding-'));
}

/**
 * @param {string} dir
 * @returns {import('better-sqlite3').Database}
 */
function createDatabase(dir) {
  const db = new Database(path.join(dir, 'auth.db'));
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_session_id TEXT,
      custom_name TEXT,
      project_path TEXT NOT NULL,
      jsonl_path TEXT,
      model TEXT,
      effort TEXT,
      forked_from_session_id TEXT,
      isArchived BOOLEAN DEFAULT 0,
      created_at DATETIME,
      updated_at DATETIME,
      permission_mode TEXT,
      name_source TEXT,
      transcript_name TEXT,
      transcript_name_source TEXT,
      lifecycle_mode TEXT
    );
    CREATE TABLE superseded_provider_sessions (
      provider_session_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      session_id TEXT NOT NULL,
      jsonl_path TEXT,
      created_at DATETIME,
      PRIMARY KEY (provider_session_id, provider)
    );
  `);
  return db;
}

/**
 * Writes a rollout whose first row is `session_meta` and whose remaining rows
 * are one `event_msg`/`task_complete` per timestamp. A single-element
 * `timestamps` array is therefore a metadata-only file (zero completed turns).
 *
 * @param {string} dir
 * @param {string} name
 * @param {{ id: string, cwd?: string, timestamps: string[], forkedFromId?: string | null }} input
 * @returns {string}
 */
function writeTranscript(dir, name, input) {
  const filePath = path.join(dir, name);
  const [metaTimestamp, ...activityTimestamps] = input.timestamps;
  const rows = [
    {
      timestamp: metaTimestamp,
      type: 'session_meta',
      payload: {
        id: input.id,
        cwd: input.cwd ?? PROJECT,
        ...(input.forkedFromId ? { forked_from_id: input.forkedFromId } : {}),
      },
    },
    ...activityTimestamps.map((timestamp) => ({
      timestamp,
      type: 'event_msg',
      payload: { type: 'task_complete' },
    })),
  ];
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return filePath;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {Partial<Record<string, unknown>>} overrides
 */
function insertSession(db, overrides = {}) {
  const row = {
    session_id: APP_SESSION,
    provider: 'codex',
    provider_session_id: THREAD,
    custom_name: null,
    project_path: PROJECT,
    jsonl_path: null,
    model: 'gpt-6.1-sol',
    effort: 'default',
    forked_from_session_id: null,
    isArchived: 0,
    created_at: '2026-10-31 06:24:33',
    updated_at: OLD_UPDATED_AT,
    permission_mode: 'default',
    name_source: 'derived',
    transcript_name: '会话 header 里的 in-flight',
    transcript_name_source: 'derived',
    lifecycle_mode: 'resident',
    ...overrides,
  };
  db.prepare(
    `INSERT INTO sessions (
       session_id, provider, provider_session_id, custom_name, project_path, jsonl_path,
       model, effort, forked_from_session_id, isArchived, created_at, updated_at,
       permission_mode, name_source, transcript_name, transcript_name_source, lifecycle_mode
     ) VALUES (
       @session_id, @provider, @provider_session_id, @custom_name, @project_path, @jsonl_path,
       @model, @effort, @forked_from_session_id, @isArchived, @created_at, @updated_at,
       @permission_mode, @name_source, @transcript_name, @transcript_name_source, @lifecycle_mode
     )`,
  ).run(row);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ providerSessionId?: string, sessionId?: string, jsonlPath: string | null }} input
 */
function insertSuperseded(db, input) {
  db.prepare(
    `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path, created_at)
     VALUES (?, 'codex', ?, ?, '2026-10-31 06:25:00')`,
  ).run(input.providerSessionId ?? THREAD, input.sessionId ?? APP_SESSION, input.jsonlPath);
}

/**
 * Builds the `null-path-retired` fixture: the row claims the real thread with a
 * NULL path, and the same thread is marked retired with that thread's rollout.
 *
 * @returns {{ dir: string, db: import('better-sqlite3').Database, dbPath: string,
 *             targetPath: string, transcriptBytes: Buffer }}
 */
function nullPathFixture() {
  const dir = withTempDir();
  const db = createDatabase(dir);
  const targetPath = writeTranscript(dir, `rollout-target-${THREAD}.jsonl`, {
    id: THREAD,
    timestamps: ['2026-10-31T06:24:34.192Z', '2026-10-31T06:25:00.000Z', LAST_ACTIVITY],
  });
  insertSession(db);
  insertSuperseded(db, { jsonlPath: targetPath });
  return { dir, db, dbPath: path.join(dir, 'auth.db'), targetPath, transcriptBytes: readFileSync(targetPath) };
}

/** @param {import('better-sqlite3').Database} db */
function readSessionRow(db) {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(APP_SESSION);
}

/** @param {import('better-sqlite3').Database} db */
function readSupersededRows(db) {
  return db.prepare('SELECT * FROM superseded_provider_sessions WHERE session_id = ? ORDER BY provider_session_id').all(APP_SESSION);
}

test('null-path-retired: dry run writes no business rows, then apply restores path and activity', () => {
  const fixture = nullPathFixture();
  try {
    const dryEvidence = path.join(fixture.dir, 'evidence-dry.json');
    const dry = repairSession({
      sessionId: APP_SESSION,
      databasePath: fixture.dbPath,
      apply: false,
      evidencePath: dryEvidence,
    });

    assert.equal(dry.code, 0);
    assert.equal(dry.result.result, 'dry-run-ready');
    assert.equal(dry.result.shape, 'null-path-retired');
    assert.equal(dry.result.would.updatedAt, '2026-10-31 11:11:26');
    assert.equal(dry.result.would.transcript, fixture.targetPath);

    // Dry run must not touch the business tables.
    let row = readSessionRow(fixture.db);
    assert.equal(row.jsonl_path, null);
    assert.equal(row.updated_at, OLD_UPDATED_AT);
    assert.equal(readSupersededRows(fixture.db).length, 1);

    const evidence = JSON.parse(readFileSync(dryEvidence, 'utf8'));
    assert.equal(evidence.restoreUpdatedAt, '2026-10-31 11:11:26');
    assert.ok(!evidence.after, 'a dry run leaves the after snapshot empty');

    const applyEvidence = path.join(fixture.dir, 'evidence-apply.json');
    const applied = repairSession({
      sessionId: APP_SESSION,
      databasePath: fixture.dbPath,
      apply: true,
      evidencePath: applyEvidence,
    });

    assert.equal(applied.code, 0);
    assert.equal(applied.result.result, 'repaired');
    assert.equal(applied.result.providerSessionId, THREAD);
    assert.equal(applied.result.jsonlPath, fixture.targetPath);
    assert.equal(applied.result.updatedAt, '2026-10-31 11:11:26');

    row = readSessionRow(fixture.db);
    assert.equal(row.provider_session_id, THREAD);
    assert.equal(row.jsonl_path, fixture.targetPath);
    assert.equal(row.updated_at, '2026-10-31 11:11:26');
    assert.notEqual(row.updated_at, row.created_at);
    assert.deepEqual(readSupersededRows(fixture.db), []);

    // The transcript is evidence, not an input to mutate.
    assert.deepEqual(readFileSync(fixture.targetPath), fixture.transcriptBytes);
    assert.equal(statSync(fixture.targetPath).size, fixture.transcriptBytes.length);

    // A second run is a no-op that reports the same consistent state.
    const rerun = repairSession({
      sessionId: APP_SESSION,
      databasePath: fixture.dbPath,
      apply: true,
      evidencePath: path.join(fixture.dir, 'evidence-rerun.json'),
    });
    assert.equal(rerun.code, 0);
    assert.equal(rerun.result.result, 'already-consistent');
    row = readSessionRow(fixture.db);
    assert.equal(row.updated_at, '2026-10-31 11:11:26');
    assert.deepEqual(readSupersededRows(fixture.db), []);
  } finally {
    fixture.db.close();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('null-path-retired: refuses when thread identity, cwd, ledger or activity do not match', () => {
  /** @type {Array<{ name: string, arrange: (db: import('better-sqlite3').Database, dir: string, targetPath: string) => void, expected: RegExp }>} */
  const cases = [
    {
      name: 'no superseded mark',
      arrange: (db) => {
        db.prepare('DELETE FROM superseded_provider_sessions').run();
      },
      expected: /not marked superseded/,
    },
    {
      name: 'session_meta id differs from the binding',
      arrange: () => {},
      expected: /session_meta id does not match/,
    },
    {
      name: 'session_meta cwd differs from the session project path',
      arrange: () => {},
      expected: /cwd does not match/,
    },
    {
      name: 'the named transcript does not exist',
      arrange: (db) => {
        db.prepare('DELETE FROM superseded_provider_sessions').run();
        db.prepare(
          `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path, created_at)
           VALUES (?, 'codex', ?, ?, '2026-10-31 06:25:00')`,
        ).run(THREAD, APP_SESSION, path.join(SESSIONS_ROOT, 'missing.jsonl'));
      },
      expected: /not readable|could not be found/,
    },
    {
      name: 'the transcript records no activity timestamp',
      arrange: (_db, _dir, targetPath) => {
        writeFileSync(
          targetPath,
          `${JSON.stringify({ type: 'session_meta', payload: { id: THREAD, cwd: PROJECT } })}\n`,
          'utf8',
        );
      },
      expected: /no activity timestamp to restore/,
    },
  ];

  for (const scenario of cases) {
    const dir = withTempDir();
    const db = createDatabase(dir);
    const targetPath = writeTranscript(dir, `rollout-target-${THREAD}.jsonl`, {
      id: scenario.name === 'session_meta id differs from the binding' ? FORK_THREAD : THREAD,
      cwd: scenario.name === 'session_meta cwd differs from the session project path' ? '/somewhere/else' : PROJECT,
      timestamps: scenario.name === 'the transcript records no activity timestamp'
        ? ['2026-10-31T06:24:34.192Z']
        : ['2026-10-31T06:24:34.192Z', LAST_ACTIVITY],
    });
    insertSession(db);
    insertSuperseded(db, { jsonlPath: targetPath });
    scenario.arrange(db, dir, targetPath);

    try {
      const outcome = repairSession({
        sessionId: APP_SESSION,
        databasePath: path.join(dir, 'auth.db'),
        apply: true,
        evidencePath: path.join(dir, 'evidence.json'),
      });
      assert.equal(outcome.code, 2, scenario.name);
      assert.equal(outcome.result.result, 'refused', scenario.name);
      assert.match(outcome.result.reasons.join('; '), scenario.expected, scenario.name);
      const row = readSessionRow(db);
      assert.equal(row.jsonl_path, null, `${scenario.name}: refusal must not write`);
      assert.equal(row.updated_at, OLD_UPDATED_AT, `${scenario.name}: refusal must not write`);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('applyRepair refuses a concurrent rebind and leaves the ledger untouched', () => {
  const fixture = nullPathFixture();
  try {
    const state = readState(fixture.db, APP_SESSION);
    assert.ok(state);

    // Another writer rebinds the row between the read and the transaction.
    fixture.db.prepare('UPDATE sessions SET provider_session_id = ? WHERE session_id = ?')
      .run(FORK_THREAD, APP_SESSION);

    assert.throws(
      () => applyRepair(fixture.db, state),
      /the row changed while the repair was running/,
    );

    const row = readSessionRow(fixture.db);
    assert.equal(row.provider_session_id, FORK_THREAD, 'the concurrent write is not reverted by this process');
    assert.equal(row.jsonl_path, null);
    assert.equal(readSupersededRows(fixture.db).length, 1, 'the ledger delete must not run');
  } finally {
    fixture.db.close();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('applyRepair rolls the row write back when the ledger delete fails', () => {
  const fixture = nullPathFixture();
  try {
    fixture.db.exec(`
      CREATE TRIGGER refuse_ledger_delete
      BEFORE DELETE ON superseded_provider_sessions
      BEGIN
        SELECT RAISE(ABORT, 'ledger locked for test');
      END;
    `);
    const state = readState(fixture.db, APP_SESSION);
    assert.ok(state);

    assert.throws(() => applyRepair(fixture.db, state), /ledger locked for test/);

    const row = readSessionRow(fixture.db);
    assert.equal(row.jsonl_path, null, 'the earlier UPDATE must be rolled back');
    assert.equal(row.updated_at, OLD_UPDATED_AT);
    assert.equal(readSupersededRows(fixture.db).length, 1);
  } finally {
    fixture.db.close();
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('fork-rebind: the legacy edit-fork shape still repairs, supersedes the fork and is idempotent', () => {
  const dir = withTempDir();
  const db = createDatabase(dir);
  const targetPath = writeTranscript(dir, `rollout-target-${THREAD}.jsonl`, {
    id: THREAD,
    timestamps: ['2026-10-31T06:24:34.192Z', '2026-10-31T06:25:00.000Z', '2026-10-31T06:26:00.000Z'],
  });
  const forkPath = writeTranscript(dir, `rollout-fork-${FORK_THREAD}.jsonl`, {
    id: FORK_THREAD,
    timestamps: ['2026-10-31T06:40:00.000Z'],
    forkedFromId: THREAD,
  });
  const forkBytes = readFileSync(forkPath);

  insertSession(db, { provider_session_id: THREAD, jsonl_path: forkPath });
  insertSuperseded(db, { jsonlPath: targetPath });
  // The watcher indexed the metadata-only fork under its own id before the
  // binding was reported; the repair merges that row away.
  insertSession(db, { session_id: FORK_THREAD, provider_session_id: FORK_THREAD, jsonl_path: forkPath });

  try {
    const state = readState(db, APP_SESSION);
    assert.ok(state);
    const outcome = repairSession({
      sessionId: APP_SESSION,
      databasePath: path.join(dir, 'auth.db'),
      apply: true,
      evidencePath: path.join(dir, 'evidence.json'),
    });
    assert.equal(outcome.code, 0);
    assert.equal(outcome.result.result, 'repaired');
    assert.equal(outcome.result.shape, 'fork-rebind');
    assert.equal(outcome.result.jsonlPath, targetPath);
    assert.equal(outcome.result.updatedAt, '2026-10-31 06:26:00');

    const row = readSessionRow(db);
    assert.equal(row.provider_session_id, THREAD);
    assert.equal(row.jsonl_path, targetPath);
    assert.equal(row.updated_at, '2026-10-31 06:26:00');

    const superseded = db.prepare('SELECT * FROM superseded_provider_sessions ORDER BY provider_session_id').all();
    assert.deepEqual(superseded, [
      {
        provider_session_id: FORK_THREAD,
        provider: 'codex',
        session_id: APP_SESSION,
        jsonl_path: forkPath,
        created_at: superseded[0].created_at,
      },
    ]);

    // The watcher-created duplicate row for the fork is merged away.
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE session_id = ?').get(FORK_THREAD).count, 0);
    assert.deepEqual(readFileSync(forkPath), forkBytes, 'the abandoned fork file is never rewritten');

    const rerun = repairSession({
      sessionId: APP_SESSION,
      databasePath: path.join(dir, 'auth.db'),
      apply: true,
      evidencePath: path.join(dir, 'evidence-rerun.json'),
    });
    assert.equal(rerun.result.result, 'already-consistent');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inspectTranscript reads the last valid timestamp and toSqliteUtc keeps it in UTC', () => {
  const dir = withTempDir();
  try {
    const filePath = path.join(dir, 'rollout.jsonl');
    writeFileSync(filePath, [
      JSON.stringify({ timestamp: '2026-10-31T06:24:34.192Z', type: 'session_meta', payload: { id: THREAD, cwd: PROJECT } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'last-prompt' } }),
      JSON.stringify({ timestamp: '2026-10-31T11:11:26.845Z', type: 'event_msg', payload: { type: 'task_complete' } }),
      JSON.stringify({ timestamp: 'not-a-date', type: 'event_msg', payload: { type: 'task_complete' } }),
    ].join('\n'));
    const reading = inspectTranscript(filePath);
    assert.equal(reading.lastActivity, '2026-10-31T11:11:26.845Z');
    assert.equal(toSqliteUtc(reading.lastActivity), '2026-10-31 11:11:26');
    assert.equal(toSqliteUtc('not-a-date'), null);
    assert.equal(toSqliteUtc(null), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
