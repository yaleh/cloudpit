import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  createSessionBindingService,
  getConnection,
  initializeDatabase,
  providerSessionBindingDb,
  sessionBindingService,
  sessionsDb,
} from '@/modules/database/index.js';
import {
  recoverCodexSessionBinding,
} from '@/modules/providers/list/codex/sessions/codex-session-binding.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/sessions/codex-session-synchronizer.provider.js';
import { createSessionHistoryCache } from '@/modules/providers/services/sessions/session-history-cache.service.js';
import { createNormalizedMessage } from '@/shared/utils.js';
import type { FetchHistoryResult } from '@/shared/types.js';

/**
 * A session's provider binding is one fact: the provider-native id and the
 * transcript that id names. Ordinary runs observe it; only an edit/restart
 * replaces it. These criteria pin both halves and the one defect they came
 * from: a late `session_created` from the pre-edit host restored the old id
 * while the row kept the fork's path, and the watcher then indexed the fork as
 * a second session.
 */

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'session-binding-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'auth.db');
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

/**
 * The invariant the whole task is about: the row's id is a live thread, and the
 * transcript it points at belongs to that same thread. Used both as the green
 * assertion and as the negative control's failing checker.
 */
function assertBindingIsConsistent(sessionId: string, provider = 'codex'): void {
  const row = sessionsDb.getSessionById(sessionId);
  assert.ok(row, `session ${sessionId} must exist`);
  assert.ok(row.provider_session_id, `session ${sessionId} must claim a provider thread`);
  assert.equal(
    sessionsDb.isProviderSessionSuperseded(row.provider_session_id, provider),
    false,
    `binding ${row.provider_session_id} must not be a retired thread`,
  );
  if (row.jsonl_path) {
    assert.ok(
      path.basename(row.jsonl_path).includes(row.provider_session_id),
      `transcript "${row.jsonl_path}" must belong to binding ${row.provider_session_id}`,
    );
  }
}

const oldPath = '/workspace/rollout-thread-old.jsonl';
const newPath = '/workspace/rollout-thread-new.jsonl';

test('a late session_created from the pre-edit host cannot undo the fork', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-edit', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-edit', 'thread-old');

    sessionBindingService.replaceBinding({
      sessionId: 'app-edit',
      providerSessionId: 'thread-new',
      jsonlPath: newPath,
    });
    assertBindingIsConsistent('app-edit');

    // The old run/host announces its own id after the edit already committed.
    const outcome = sessionBindingService.recordRunDiscoveredBinding({
      sessionId: 'app-edit',
      providerSessionId: 'thread-old',
      runStartedWithProviderSessionId: 'thread-old',
    });

    assert.deepEqual(outcome, {
      kind: 'rejected-superseded',
      supersededProviderSessionId: 'thread-old',
    });
    const row = sessionsDb.getSessionById('app-edit');
    assert.equal(row?.provider_session_id, 'thread-new');
    assert.equal(row?.jsonl_path, newPath);
    assertBindingIsConsistent('app-edit');
  });
});

test('a retired id cannot be re-bound after a first-prompt edit detached the row', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-detached', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-detached', 'thread-old');

    sessionBindingService.detachForEdit('app-detached');
    assert.equal(sessionsDb.getSessionById('app-detached')?.provider_session_id, null);
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), true);

    const outcome = sessionBindingService.recordRunDiscoveredBinding({
      sessionId: 'app-detached',
      providerSessionId: 'thread-old',
      runStartedWithProviderSessionId: null,
    });

    assert.equal(outcome.kind, 'rejected-superseded');
    assert.equal(sessionsDb.getSessionById('app-detached')?.provider_session_id, null);
  });
});

test('a failed replacement rolls back the retired mark and the row together', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-atomic', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-atomic', 'thread-old');

    // Fail the UPDATE after the replacement has already inserted the
    // superseded mark. Both statements are in one transaction, so a throw must
    // leave neither behind.
    getConnection().exec(
      `CREATE TRIGGER fail_binding_update BEFORE UPDATE ON sessions
       WHEN NEW.session_id = 'app-atomic'
       BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;`,
    );

    assert.throws(
      () => sessionBindingService.replaceBinding({
        sessionId: 'app-atomic',
        providerSessionId: 'thread-new',
        jsonlPath: newPath,
      }),
      /simulated write failure/,
    );

    const row = sessionsDb.getSessionById('app-atomic');
    assert.equal(row?.provider_session_id, 'thread-old');
    assert.equal(row?.jsonl_path, null);
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), false);
    assert.equal(sessionsDb.getAllSessions().length, 1);
  });
});

test('a first run binds a session that has no provider id yet', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-first', 'codex', '/workspace/demo');

    const outcome = sessionBindingService.recordRunDiscoveredBinding({
      sessionId: 'app-first',
      providerSessionId: 'thread-first',
      runStartedWithProviderSessionId: null,
    });

    assert.deepEqual(outcome, { kind: 'assigned', previousProviderSessionId: null });
    assert.equal(sessionsDb.getSessionById('app-first')?.provider_session_id, 'thread-first');
  });
});

test('the first edit retires the old thread and the next run binds the replacement', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-restart', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-restart', 'thread-old');
    sessionBindingService.detachForEdit('app-restart');

    const outcome = sessionBindingService.recordRunDiscoveredBinding({
      sessionId: 'app-restart',
      providerSessionId: 'thread-fresh',
      runStartedWithProviderSessionId: null,
    });

    assert.equal(outcome.kind, 'assigned');
    assertBindingIsConsistent('app-restart');
    assert.equal(sessionsDb.getSessionById('app-restart')?.provider_session_id, 'thread-fresh');
  });
});

test('a zero-turn resume may replace its unusable binding; a stale run may not', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-zero', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-zero', 'thread-zero-turn');

    // The run that owns the stored binding found no rollout to resume and
    // branched to a fresh thread. It is the one legitimate in-run replacement.
    const replaced = sessionBindingService.recordRunDiscoveredBinding({
      sessionId: 'app-zero',
      providerSessionId: 'thread-real',
      runStartedWithProviderSessionId: 'thread-zero-turn',
    });
    assert.deepEqual(replaced, {
      kind: 'replaced',
      previousProviderSessionId: 'thread-zero-turn',
      previousJsonlPath: null,
    });
    assert.equal(sessionsDb.getSessionById('app-zero')?.provider_session_id, 'thread-real');

    // A different run, started on a thread this row no longer claims, is stale.
    const stale = sessionBindingService.recordRunDiscoveredBinding({
      sessionId: 'app-zero',
      providerSessionId: 'thread-somewhere-else',
      runStartedWithProviderSessionId: 'thread-old-host',
    });
    assert.deepEqual(stale, {
      kind: 'rejected-stale',
      currentProviderSessionId: 'thread-real',
    });
    assert.equal(sessionsDb.getSessionById('app-zero')?.provider_session_id, 'thread-real');
  });
});

test('the indexer neither resurrects the retired thread nor duplicates the live one', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'session-binding-watch-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const originalHomeDir = os.homedir;
  (os as { homedir: () => string }).homedir = () => tempRoot;

  try {
    await mkdir(workspacePath, { recursive: true });
    const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '10', '31');
    await mkdir(sessionsDir, { recursive: true });
    const writeRollout = async (threadId: string, prompt: string): Promise<string> => {
      const filePath = path.join(sessionsDir, `rollout-${threadId}.jsonl`);
      await writeFile(
        filePath,
        [
          JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd: workspacePath } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: prompt } }),
          JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: `answer to ${prompt}` } }),
        ].join('\n') + '\n',
        'utf8',
      );
      return filePath;
    };

    await writeRollout('thread-old', 'original prompt');
    const forkPath = await writeRollout('thread-new', 'edited prompt');

    await withIsolatedDatabase(async () => {
      await new CodexSessionSynchronizer().synchronize();
      assert.equal(sessionsDb.getAllSessions().length, 2);

      sessionBindingService.replaceBinding({
        sessionId: 'thread-old',
        providerSessionId: 'thread-new',
        jsonlPath: forkPath,
      });
      assert.equal(sessionsDb.getAllSessions().length, 1);
      assert.equal(sessionsDb.getSessionById('thread-old')?.provider_session_id, 'thread-new');

      await new CodexSessionSynchronizer().synchronize();

      const rows = sessionsDb.getAllSessions();
      assert.equal(rows.length, 1, 'the retired thread must not reappear and the fork must not duplicate');
      assert.equal(rows[0]?.session_id, 'thread-old');
      assert.equal(rows[0]?.provider_session_id, 'thread-new');
      assert.equal(rows[0]?.jsonl_path, forkPath);
    });
  } finally {
    (os as { homedir: () => string }).homedir = originalHomeDir;
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('history cached for the old transcript is not served after a rebind', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'session-binding-cache-'));
  try {
    const oldFile = path.join(tempRoot, 'rollout-thread-old.jsonl');
    const newFile = path.join(tempRoot, 'rollout-thread-new.jsonl');
    await writeFile(oldFile, '{"content":"old turns"}\n', 'utf8');
    await writeFile(newFile, '{"content":"new branch"}\n', 'utf8');

    const cache = createSessionHistoryCache();
    const answer = (text: string): FetchHistoryResult => ({
      messages: [
        createNormalizedMessage({
          id: text,
          sessionId: 'app-cache',
          timestamp: '2026-10-31T00:00:00.000Z',
          provider: 'codex',
          kind: 'text',
          role: 'user',
          content: text,
        }),
      ],
      total: 1,
      hasMore: false,
      offset: 0,
      limit: null,
    });

    const first = await cache.getFullHistory({
      sessionId: 'app-cache',
      transcriptPath: oldFile,
      loadFull: async () => answer('old turns'),
    });
    assert.equal(first?.messages[0]?.content, 'old turns');

    // The row now points at the fork's file. The cache's identity is
    // (sessionId, path, mtime, size), so the old parse is a miss, not a hit.
    const second = await cache.getFullHistory({
      sessionId: 'app-cache',
      transcriptPath: newFile,
      loadFull: async () => answer('new branch'),
    });
    assert.equal(second?.messages[0]?.content, 'new branch');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('negative control: the old blind restore is red against the same invariant', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-blind', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-blind', 'thread-old');
    sessionBindingService.replaceBinding({
      sessionId: 'app-blind',
      providerSessionId: 'thread-new',
      jsonlPath: newPath,
    });
    assertBindingIsConsistent('app-blind');

    // The pre-fix behaviour: write the old identity straight into the row,
    // bypassing the binding service. This arm must fail the invariant, proving
    // the guard — not the fixture — is what keeps the green arms green.
    getConnection().prepare(
      'UPDATE sessions SET provider_session_id = ?, jsonl_path = ? WHERE session_id = ?'
    ).run('thread-old', oldPath, 'app-blind');

    assert.throws(
      () => assertBindingIsConsistent('app-blind'),
      /must not be a retired thread/,
    );
  });
});

test('the injected service applies the same rules without a database', { concurrency: false }, () => {  const calls: unknown[] = [];
  const service = createSessionBindingService({
    confirmRunDiscoveredProviderSession: (input) => {
      calls.push(input);
      return { kind: 'confirmed' };
    },
    replaceProviderSessionBinding: (input) => {
      calls.push(input);
      return { previousProviderSessionId: 'thread-old', previousJsonlPath: oldPath };
    },
    detachProviderSessionForEdit: (sessionId) => {
      calls.push(sessionId);
      return { previousProviderSessionId: 'thread-old', previousJsonlPath: oldPath };
    },
    recoverProviderSessionBinding: (input) => {
      calls.push(input);
      return {
        kind: 'recovered',
        previousProviderSessionId: 'thread-old',
        previousJsonlPath: oldPath,
        clearedRetiredMark: true,
      };
    },
  });

  assert.equal(
    service.recordRunDiscoveredBinding({
      sessionId: 'app',
      providerSessionId: 'thread',
      runStartedWithProviderSessionId: 'thread',
    }).kind,
    'confirmed',
  );
  service.replaceBinding({ sessionId: 'app', providerSessionId: 'thread-2', jsonlPath: newPath });
  service.detachForEdit('app');
  service.recoverBinding({ sessionId: 'app', providerSessionId: 'thread-1', jsonlPath: oldPath });

  assert.deepEqual(calls, [
    { sessionId: 'app', providerSessionId: 'thread', runStartedWithProviderSessionId: 'thread' },
    { sessionId: 'app', providerSessionId: 'thread-2', jsonlPath: newPath },
    'app',
    { sessionId: 'app', providerSessionId: 'thread-1', jsonlPath: oldPath },
  ]);
});

// ---------------------------------------------------------------------------
// gap-session-binding-active-retired-invariant
//
// The invariant the remaining write paths must preserve: a row's current
// binding never coexists with a retirement record for the same thread. The
// legacy blind helpers are gone; every production write now either refuses the
// combination or is the explicit recovery that clears it atomically.
// ---------------------------------------------------------------------------

test('an ordinary replacement cannot claim a retired thread; recovery must clear it', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-guard', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-guard', 'thread-old');
    sessionBindingService.detachForEdit('app-guard');
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), true);

    // An edit fork that somehow targeted the thread the previous edit retired
    // would recreate the exact damaged shape. It must be refused, not written.
    assert.throws(
      () => sessionBindingService.replaceBinding({
        sessionId: 'app-guard',
        providerSessionId: 'thread-old',
        jsonlPath: oldPath,
      }),
      /retired.*explicit recovery is required/i,
    );

    // No half write: the row is still detached and the mark is still there.
    const row = sessionsDb.getSessionById('app-guard');
    assert.equal(row?.provider_session_id, null);
    assert.equal(row?.jsonl_path, null);
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), true);
    assert.equal(sessionsDb.getAllSessions().length, 1);
  });
});

test('explicit recovery clears the mark, retires the displaced binding, and is idempotent', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-recover', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-recover', 'thread-old');
    sessionBindingService.replaceBinding({
      sessionId: 'app-recover',
      providerSessionId: 'thread-new',
      jsonlPath: newPath,
    });
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), true);
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-new', 'codex'), false);

    const recovered = sessionBindingService.recoverBinding({
      sessionId: 'app-recover',
      providerSessionId: 'thread-old',
      jsonlPath: oldPath,
    });

    assert.deepEqual(recovered, {
      kind: 'recovered',
      previousProviderSessionId: 'thread-new',
      previousJsonlPath: newPath,
      clearedRetiredMark: true,
    });
    // The restored thread is the live binding, not a retirement record...
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), false);
    // ...and the binding the recovery displaced took its place in the ledger.
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-new', 'codex'), true);
    assertBindingIsConsistent('app-recover');
    assert.equal(sessionsDb.getSessionById('app-recover')?.jsonl_path, oldPath);

    // A second run reports the same consistent state and writes nothing.
    const again = sessionBindingService.recoverBinding({
      sessionId: 'app-recover',
      providerSessionId: 'thread-old',
      jsonlPath: oldPath,
    });
    assert.equal(again.kind, 'already-consistent');
    assert.equal(again.clearedRetiredMark, false);
    assertBindingIsConsistent('app-recover');
    assert.equal(sessionsDb.getAllSessions().length, 1);
  });
});

test('recovery refuses a thread that is not retired rather than acting as a blind rebind', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-not-retired', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-not-retired', 'thread-old');

    assert.throws(
      () => sessionBindingService.recoverBinding({
        sessionId: 'app-not-retired',
        providerSessionId: 'thread-other',
        jsonlPath: newPath,
      }),
      /not retired.*only restores a thread/i,
    );

    const row = sessionsDb.getSessionById('app-not-retired');
    assert.equal(row?.provider_session_id, 'thread-old');
    assert.equal(row?.jsonl_path, null);
    assert.equal(sessionsDb.getAllSessions().length, 1);
  });
});

test('the legacy assign path is ordinary discovery: a retired id or an existing binding is rejected', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-legacy', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-legacy', 'thread-old');
    sessionBindingService.detachForEdit('app-legacy');

    const retired = sessionsDb.assignProviderSessionId('app-legacy', 'thread-old');
    assert.equal(retired.kind, 'rejected-superseded');
    assert.equal(sessionsDb.getSessionById('app-legacy')?.provider_session_id, null);
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), true);

    sessionsDb.createAppSession('app-legacy-bound', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-legacy-bound', 'thread-current');
    const stale = sessionsDb.assignProviderSessionId('app-legacy-bound', 'thread-other');
    assert.equal(stale.kind, 'rejected-stale');
    assert.equal(sessionsDb.getSessionById('app-legacy-bound')?.provider_session_id, 'thread-current');
  });
});

test('retiring the binding a row still claims is refused; other threads may still be retired', { concurrency: false }, async () => {
  await withIsolatedDatabase(() => {
    sessionsDb.createAppSession('app-mark', 'codex', '/workspace/demo');
    sessionsDb.assignProviderSessionId('app-mark', 'thread-old');

    assert.throws(
      () => sessionsDb.markProviderSessionSuperseded({
        providerSessionId: 'thread-old',
        provider: 'codex',
        sessionId: 'app-mark',
        jsonlPath: oldPath,
      }),
      /still claims it/i,
    );
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), false);

    // A thread the row does not claim is still retireable through this path.
    sessionsDb.markProviderSessionSuperseded({
      providerSessionId: 'thread-unclaimed',
      provider: 'codex',
      sessionId: 'app-mark',
      jsonlPath: '/workspace/rollout-thread-unclaimed.jsonl',
    });
    assert.equal(sessionsDb.isProviderSessionSuperseded('thread-unclaimed', 'codex'), true);
  });
});

/** Writes one Codex rollout whose session_meta names `threadId` in `cwd`. */
async function writeIdentityRollout(
  directory: string,
  threadId: string,
  cwd: string,
): Promise<string> {
  const filePath = path.join(directory, `rollout-${threadId}.jsonl`);
  await writeFile(
    filePath,
    [
      JSON.stringify({ type: 'session_meta', payload: { id: threadId, cwd } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'prompt' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-1' } }),
    ].join('\n') + '\n',
    'utf8',
  );
  return filePath;
}

test('scene 2: only the explicit recovery entry restores a wrongly retired thread', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'session-binding-recover-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '10', '31');
  await mkdir(sessionsDir, { recursive: true });
  const rolloutPath = await writeIdentityRollout(sessionsDir, 'thread-old', workspacePath);

  try {
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-scene2', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-scene2', 'thread-old');

      // The historical damaged shape: the row still claims the thread, the
      // ledger also records it as retired, and the path is NULL. Seeded with
      // raw SQL precisely because no current write path can produce it.
      getConnection()
        .prepare('UPDATE sessions SET jsonl_path = NULL WHERE session_id = ?')
        .run('app-scene2');
      getConnection()
        .prepare(
          `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path)
           VALUES (?, ?, ?, ?)`
        )
        .run('thread-old', 'codex', 'app-scene2', rolloutPath);

      // Ordinary run discovery cannot heal it: the retired guard rejects the
      // same id the row already claims.
      const discovered = sessionBindingService.recordRunDiscoveredBinding({
        sessionId: 'app-scene2',
        providerSessionId: 'thread-old',
        runStartedWithProviderSessionId: 'thread-old',
      });
      assert.equal(discovered.kind, 'rejected-superseded');
      assert.equal(sessionsDb.getSessionById('app-scene2')?.jsonl_path, null);
      assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), true);

      const recovered = await recoverCodexSessionBinding('app-scene2');
      assert.equal(recovered.kind, 'recovered');
      assertBindingIsConsistent('app-scene2');
      assert.equal(sessionsDb.getSessionById('app-scene2')?.jsonl_path, rolloutPath);
      assert.equal(providerSessionBindingDb.getRetiredProviderSession('thread-old', 'codex'), null);

      const again = await recoverCodexSessionBinding('app-scene2');
      assert.equal(again.kind, 'already-consistent');
      assertBindingIsConsistent('app-scene2');
      assert.equal(sessionsDb.getAllSessions().length, 1);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('scene 2: recovery refuses a rollout whose session_meta names another thread', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'session-binding-refuse-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '10', '31');
  await mkdir(sessionsDir, { recursive: true });
  // The ledger names thread-old but the rollout on disk belongs to a different
  // thread: restoring it would bind the row to the wrong conversation.
  const rolloutPath = await writeIdentityRollout(sessionsDir, 'thread-impostor', workspacePath);

  try {
    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-impostor', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-impostor', 'thread-old');
      getConnection()
        .prepare('UPDATE sessions SET jsonl_path = NULL WHERE session_id = ?')
        .run('app-impostor');
      getConnection()
        .prepare(
          `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path)
           VALUES (?, ?, ?, ?)`
        )
        .run('thread-old', 'codex', 'app-impostor', rolloutPath);

      const refused = await recoverCodexSessionBinding('app-impostor');
      assert.equal(refused.kind, 'refused');
      if (refused.kind === 'refused') {
        assert.equal(refused.reason, 'identity-mismatch');
      }

      // Nothing was written: the damaged shape is preserved for a human.
      assert.equal(sessionsDb.getSessionById('app-impostor')?.provider_session_id, 'thread-old');
      assert.equal(sessionsDb.getSessionById('app-impostor')?.jsonl_path, null);
      assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), true);
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('the indexer diagnoses the damaged shape without clearing the mark itself', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'session-binding-sync-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const originalHomeDir = os.homedir;
  (os as { homedir: () => string }).homedir = () => tempRoot;

  try {
    const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '10', '31');
    await mkdir(sessionsDir, { recursive: true });
    const rolloutPath = await writeIdentityRollout(sessionsDir, 'thread-old', workspacePath);

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-diagnose', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-diagnose', 'thread-old');
      getConnection()
        .prepare('UPDATE sessions SET jsonl_path = NULL WHERE session_id = ?')
        .run('app-diagnose');
      getConnection()
        .prepare(
          `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path)
           VALUES (?, ?, ?, ?)`
        )
        .run('thread-old', 'codex', 'app-diagnose', rolloutPath);

      // The indexer sees the retired thread. It must not silently "fix" the
      // row: no mark cleared, no path written, no duplicate row.
      await new CodexSessionSynchronizer().synchronize();

      assert.equal(sessionsDb.getAllSessions().length, 1);
      assert.equal(sessionsDb.getSessionById('app-diagnose')?.provider_session_id, 'thread-old');
      assert.equal(sessionsDb.getSessionById('app-diagnose')?.jsonl_path, null);
      assert.equal(sessionsDb.isProviderSessionSuperseded('thread-old', 'codex'), true);
    });
  } finally {
    (os as { homedir: () => string }).homedir = originalHomeDir;
    await rm(tempRoot, { recursive: true, force: true });
  }
});
