import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  sessionsDb,
} from '@/modules/database/index.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import {
  isCodexActivityRecord,
  readCodexTranscriptLastActivity,
} from '@/modules/providers/list/codex/codex-transcript-activity.js';

/**
 * These criteria pin the two halves of the restart-sync defect, and they are
 * deliberately written so that reverting either fix turns them red:
 *
 *  - the startup scan must notice an OLD rollout file that grew while the
 *    server was down (`birthtime` never moves for it), so
 *    `findFilesRecursivelyCreatedAfter` must filter on mtime as well;
 *  - last activity must come from the rollout's OWN conversation/turn rows, so
 *    a touch/copy that changes no content cannot move it.
 */

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-activity-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

/** Waits until the wall clock is clearly past `after`, so a write stamps a later mtime. */
async function waitPast(after: Date): Promise<void> {
  const deadline = after.getTime() + 20;
  while (Date.now() <= deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

type RolloutRow = Record<string, unknown>;

const sessionMeta = (id: string, cwd: string): RolloutRow => ({
  type: 'session_meta',
  payload: { id, cwd },
});

const userMessage = (timestamp: string, message = 'hello'): RolloutRow => ({
  timestamp,
  type: 'event_msg',
  payload: { type: 'user_message', message },
});

const assistantMessage = (timestamp: string, text = 'an answer'): RolloutRow => ({
  timestamp,
  type: 'response_item',
  payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
});

const tokenCount = (timestamp: string): RolloutRow => ({
  timestamp,
  type: 'event_msg',
  payload: { type: 'token_count', info: {} },
});

const tokenUsage = (timestamp: string): RolloutRow => ({
  timestamp,
  type: 'token_usage_record',
  payload: { total_token_usage: {} },
});

const turnContext = (timestamp: string): RolloutRow => ({
  timestamp,
  type: 'turn_context',
  payload: { model: 'gpt-5' },
});

const worldState = (timestamp: string): RolloutRow => ({
  timestamp,
  type: 'world_state',
  payload: { state: {} },
});

const asLines = (rows: RolloutRow[]): string => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;

/** Writes one rollout under `<home>/.codex/sessions/<date>/rollout-<id>.jsonl`. */
async function writeRollout(
  homeDir: string,
  sessionId: string,
  workspacePath: string,
  rows: RolloutRow[],
): Promise<string> {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '10', '31');
  await mkdir(sessionsDir, { recursive: true });
  const filePath = path.join(sessionsDir, `rollout-${sessionId}.jsonl`);
  await writeFile(filePath, asLines(rows), 'utf8');
  return filePath;
}

const rowFor = (sessionId: string) => sessionsDb.getSessionById(sessionId);

const codexRowCount = (): number => {
  const row = getConnection()
    .prepare("SELECT COUNT(*) AS count FROM sessions WHERE provider = 'codex'")
    .get() as { count: number };
  return row.count;
};

const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-01T11:00:00.000Z';
const T3 = '2026-10-01T12:00:00.000Z';

test('scene 3: a rollout appended while the server was down is re-read after restart, without a duplicate', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-restart-sync-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const rolloutPath = await writeRollout(tempRoot, 'thread-restart', workspacePath, [
      sessionMeta('thread-restart', workspacePath),
      userMessage(T1),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      assert.equal(await synchronizer.synchronize(undefined), 1);
      assert.equal(rowFor('thread-restart')?.updated_at, T1);

      // The scan cursor advances past the file's creation time. Everything the
      // file already had is now "old"; only a later mtime can make it visible.
      const cursor = new Date();
      assert.ok(
        (await stat(rolloutPath)).birthtime < cursor,
        'the fixture must be old by birthtime, or birthtime alone would explain the pickup',
      );
      await waitPast(cursor);

      // Downtime: the user's next turn was appended to the EXISTING rollout.
      await appendFile(rolloutPath, asLines([userMessage(T2)]), 'utf8');
      const { birthtime, mtime } = await stat(rolloutPath);
      assert.ok(mtime > cursor, 'the append must move mtime past the cursor');
      assert.ok(birthtime < cursor, 'the append must not move birthtime');

      const processed = await synchronizer.synchronize(cursor);
      assert.equal(
        processed,
        1,
        'the restart scan must re-read a file modified after the cursor (birthtime-only filtering would return 0)',
      );
      assert.equal(rowFor('thread-restart')?.updated_at, T2);
      assert.equal(codexRowCount(), 1, 're-reading an existing rollout must not mint a second session row');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('a touch/copy that changes no content never moves last activity; a real event does', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-activity-touch-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const rolloutPath = await writeRollout(tempRoot, 'thread-touch', workspacePath, [
      sessionMeta('thread-touch', workspacePath),
      userMessage(T1),
      assistantMessage('2026-10-01T10:05:00.000Z'),
    ]);

    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      assert.equal(await synchronizer.synchronize(undefined), 1);
      const createdAt = rowFor('thread-touch')?.created_at;
      assert.equal(rowFor('thread-touch')?.updated_at, '2026-10-01T10:05:00.000Z');

      const cursor = new Date();
      await waitPast(cursor);

      // A filesystem touch — an external rewrite, a copy, a restore — moves
      // mtime but leaves every row byte-identical.
      await utimes(rolloutPath, new Date(), new Date());
      assert.equal(await synchronizer.synchronize(cursor), 1, 'the touched file is noticed by mtime');
      assert.equal(
        rowFor('thread-touch')?.updated_at,
        '2026-10-01T10:05:00.000Z',
        'a touch that changes no content must not move last activity (mtime-as-activity would move it)',
      );

      // A record that DOES report activity moves it, and moves it to that
      // record's own timestamp.
      await appendFile(rolloutPath, asLines([userMessage(T2)]), 'utf8');
      assert.equal(await synchronizer.synchronize(cursor), 1);
      assert.equal(rowFor('thread-touch')?.updated_at, T2);

      // Creation time is a property of the file, not of activity.
      assert.equal(rowFor('thread-touch')?.created_at, createdAt);
      const { mtime } = await stat(rolloutPath);
      assert.ok(mtime.toISOString() > T2, 'the mtime is the uninformative reading at this point');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('activity boundaries: maintenance rows are skipped, no-activity and unparseable tails fall through', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-activity-boundary-'));
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const dir = path.join(tempRoot, 'fixtures');
    await mkdir(dir, { recursive: true });
    const writeFixture = async (name: string, rows: RolloutRow[]): Promise<string> => {
      const filePath = path.join(dir, name);
      await writeFile(filePath, asLines(rows), 'utf8');
      return filePath;
    };

    // (a) A tail of maintenance rows behind a real turn reports the turn.
    const maintenanceTail = await writeFixture('maintenance.jsonl', [
      sessionMeta('activity-maintenance', '/tmp/work'),
      userMessage(T1),
      tokenCount(T2),
      tokenUsage(T3),
      turnContext(T3),
      worldState(T3),
    ]);
    assert.equal(await readCodexTranscriptLastActivity(maintenanceTail), T1);

    // (b) No conversation/turn row at all: no content reading exists.
    const noActivity = await writeFixture('no-activity.jsonl', [
      sessionMeta('activity-none', '/tmp/work'),
      tokenCount(T2),
      tokenUsage(T3),
    ]);
    assert.equal(await readCodexTranscriptLastActivity(noActivity), null);

    // (c) An unparseable timestamp on an activity row is not a reading; an
    // older parseable one is.
    const unparseable = await writeFixture('unparseable.jsonl', [
      sessionMeta('activity-unparseable', '/tmp/work'),
      userMessage(T1),
      userMessage('not-a-date'),
    ]);
    assert.equal(await readCodexTranscriptLastActivity(unparseable), T1);

    // (d) A half-written trailing line is skipped rather than thrown on.
    const halfWritten = `${asLines([
      sessionMeta('activity-half', '/tmp/work'),
      userMessage(T1),
    ])}{"timestamp":"${T2}"`;
    const halfWrittenPath = path.join(dir, 'half-written.jsonl');
    await writeFile(halfWrittenPath, halfWritten, 'utf8');
    assert.equal(await readCodexTranscriptLastActivity(halfWrittenPath), T1);

    // The classification itself is the boundary — pin each record shape.
    assert.equal(isCodexActivityRecord(sessionMeta('x', '/w')), false);
    assert.equal(isCodexActivityRecord(turnContext(T2)), false);
    assert.equal(isCodexActivityRecord(tokenUsage(T2)), false);
    assert.equal(isCodexActivityRecord(worldState(T2)), false);
    assert.equal(isCodexActivityRecord(tokenCount(T2)), false);
    assert.equal(isCodexActivityRecord(userMessage(T2)), true);
    assert.equal(isCodexActivityRecord(assistantMessage(T2)), true);
    assert.equal(isCodexActivityRecord({ timestamp: T2, type: 'response_item', payload: { type: 'reasoning' } }), true);
    assert.equal(
      isCodexActivityRecord({ timestamp: T2, type: 'event_msg', payload: { type: 'task_complete' } }),
      true,
    );

    // A rollout with no activity row still gets a time on index: the mtime
    // fallback, so a just-created thread is not missing from the sidebar.
    await withIsolatedDatabase(async () => {
      const homeRoot = path.join(tempRoot, 'home-no-activity');
      const workspacePath = path.join(homeRoot, 'workspace');
      await mkdir(workspacePath, { recursive: true });
      const rolloutPath = await writeRollout(homeRoot, 'thread-no-activity', workspacePath, [
        sessionMeta('thread-no-activity', workspacePath),
        tokenCount(T2),
      ]);
      const restore = patchHomeDir(homeRoot);
      try {
        const synchronizer = new CodexSessionSynchronizer();
        assert.equal(await synchronizer.synchronize(undefined), 1);
        const { mtime } = await stat(rolloutPath);
        assert.equal(rowFor('thread-no-activity')?.updated_at, mtime.toISOString());
      } finally {
        restore();
      }
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('scene 4: a stale row is re-derived on the first start after the fix, and a second start is idempotent', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-activity-recover-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const rolloutPath = await writeRollout(tempRoot, 'thread-stale', workspacePath, [
      sessionMeta('thread-stale', workspacePath),
      userMessage(T1),
    ]);
    const staleMtime = '2026-10-20T09:00:00.000Z';
    await utimes(rolloutPath, new Date(staleMtime), new Date(staleMtime));

    await withIsolatedDatabase(async () => {
      // The row a previous build left behind: its updated_at is the file's
      // mtime, which is a week later than any row in the transcript.
      sessionsDb.createSession(
        'thread-stale',
        'codex',
        workspacePath,
        'Recovered thread',
        '2026-09-30T00:00:00.000Z',
        staleMtime,
        rolloutPath,
      );
      assert.equal(rowFor('thread-stale')?.updated_at, staleMtime);

      const synchronizer = new CodexSessionSynchronizer();
      // First start after the fix: the one-time pass re-derives from content.
      await synchronizer.synchronize(undefined);
      assert.equal(
        rowFor('thread-stale')?.updated_at,
        T1,
        'restart must fill an old row from the rollout content, not keep the stale mtime',
      );

      // Second start: cursor is past the untouched file, so the scan is a no-op
      // and the repaired reading stays.
      const cursor = new Date(Date.now() + 60_000);
      const processed = await synchronizer.synchronize(cursor);
      assert.equal(processed, 0, 'an untouched rollout past the cursor is not re-read');
      assert.equal(rowFor('thread-stale')?.updated_at, T1, 'a second start is idempotent');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('a retired thread is not re-indexed, and a row that still claims one is reported rather than written', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-activity-retired-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // Case A: the ledger retires a thread no row claims. A rollout for it
    // appears afterwards; the scan must not mint a row for it.
    await writeRollout(tempRoot, 'thread-retired', workspacePath, [
      sessionMeta('thread-retired', workspacePath),
      userMessage(T1),
    ]);

    await withIsolatedDatabase(async () => {
      getConnection()
        .prepare(
          `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path)
           VALUES (?, ?, ?, ?)`
        )
        .run('thread-retired', 'codex', 'app-retired', null);

      const synchronizer = new CodexSessionSynchronizer();
      assert.equal(await synchronizer.synchronize(undefined), 0);
      assert.equal(rowFor('thread-retired'), null, 'a retired thread must not come back to the list');
      assert.equal(sessionsDb.isProviderSessionSuperseded('thread-retired', 'codex'), true);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }

  // Case B: the historical damaged shape — a row still claims the thread while
  // the ledger records it as retired. The scan reports it and writes nothing.
  const damagedRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-activity-damaged-'));
  const damagedWorkspace = path.join(damagedRoot, 'workspace');
  await mkdir(damagedWorkspace, { recursive: true });
  const restoreDamagedHome = patchHomeDir(damagedRoot);

  try {
    const rolloutPath = await writeRollout(damagedRoot, 'thread-damaged', damagedWorkspace, [
      sessionMeta('thread-damaged', damagedWorkspace),
      userMessage(T1),
    ]);
    await utimes(rolloutPath, new Date(T1), new Date(T1));

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-damaged', 'codex', damagedWorkspace);
      sessionsDb.assignProviderSessionId('app-damaged', 'thread-damaged');
      const before = rowFor('app-damaged');
      // Raw SQL because no current write path can create this shape (its
      // retirement entry would be refused while the row claims the thread).
      getConnection()
        .prepare(
          `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path)
           VALUES (?, ?, ?, ?)`
        )
        .run('thread-damaged', 'codex', 'app-damaged', rolloutPath);

      const warnings: unknown[][] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };

      try {
        const synchronizer = new CodexSessionSynchronizer();
        assert.equal(await synchronizer.synchronize(undefined), 0);
      } finally {
        console.warn = originalWarn;
      }

      const after = rowFor('app-damaged');
      assert.equal(after?.updated_at, before?.updated_at, 'the conflicted row must not be rewritten');
      assert.equal(after?.jsonl_path, before?.jsonl_path, 'the scanner must not invent a recovery');
      assert.equal(sessionsDb.isProviderSessionSuperseded('thread-damaged', 'codex'), true);
      assert.ok(
        warnings.some((args) => String(args[0]).includes('still claims a thread the ledger records as retired')),
        'the conflict must be reported through a diagnosable channel, not silently skipped',
      );
    });
  } finally {
    restoreDamagedHome();
    await rm(damagedRoot, { recursive: true, force: true });
  }
});

test('the content reader walks past a machine-row tail inside the bounded window', { concurrency: false }, async () => {
  // A rollout's last line is bookkeeping (`token_count`), which is exactly the
  // shape the reader must walk past. The padding keeps the newest activity
  // beyond the first 64 KiB window, so answering it requires widening — and
  // every padded line carries a timestamp that must NOT win.
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-activity-bounded-'));
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const dir = path.join(tempRoot, 'fixtures');
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'large.jsonl');
    const padding = `${JSON.stringify(tokenCount(T3))}\n`;
    const prefix = asLines([sessionMeta('activity-large', '/tmp/work'), userMessage(T1)]);
    const filler = padding.repeat(Math.ceil((300 * 1024) / padding.length));
    await writeFile(filePath, `${prefix}${filler}`, 'utf8');
    assert.ok((await stat(filePath)).size > 256 * 1024, 'the file must need more than the initial window');
    assert.equal(await readCodexTranscriptLastActivity(filePath), T1);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
