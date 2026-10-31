import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import { createSessionHistoryCache } from '@/modules/providers/services/session-history-cache.service.js';
import {
  createSessionBindingService,
  sessionBindingService,
} from '@/modules/providers/services/session-binding.service.js';
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
    sessionsDb.repointSessionToProviderSession('app-blind', {
      providerSessionId: 'thread-old',
      jsonlPath: oldPath,
    });

    assert.throws(
      () => assertBindingIsConsistent('app-blind'),
      /must not be a retired thread/,
    );
  });
});

test('the injected service applies the same rules without a database', { concurrency: false }, () => {
  const calls: unknown[] = [];
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

  assert.deepEqual(calls, [
    { sessionId: 'app', providerSessionId: 'thread', runStartedWithProviderSessionId: 'thread' },
    { sessionId: 'app', providerSessionId: 'thread-2', jsonlPath: newPath },
    'app',
  ]);
});
