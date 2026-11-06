import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionBindingService, sessionsDb } from '@/modules/database/index.js';
import { codexAppServer } from '@/modules/providers/list/codex/app-server/codex-app-server.client.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/sessions/codex-sessions.provider.js';

/**
 * The CURRENT Codex CLI's real `thread/fork`, driven from a rollout written in
 * the CLI's own `paginated` history mode.
 *
 * WHY THIS FILE EXISTS. The cross-module criterion proves that an edited Codex
 * conversation keeps its history; this one proves the half only the real binary
 * can answer: what `thread/fork` actually writes for a paginated source. It is
 * two rows, not a copy — the CLI leaves the kept turns in the source rollout and
 * points at them with `forked_from_id` + `forked_from_ordinal_exclusive` (and a
 * `history_base` byte cut). The app's reader follows that pointer, so the
 * history a person sees after an edit is the conversation the CLI itself
 * resumes. A reader that opens only the fork file returns nothing, which is
 * exactly the "history disappeared" symptom.
 *
 * The assertions below are readings from that fork: the file's own row count,
 * the meta it carries, the rows the app's reader produces from it, and the
 * thread the CLI reports back through `thread/read`. No model call is made —
 * fork and read are local protocol operations — so this criterion is
 * deterministic and cheap while still being the shipped binary.
 *
 * Baseline (before `codex-fork-history.ts`): `fetchHistory` on a paginated fork
 * returned 0 messages because the file holds two metadata rows.
 */

const BASE_THREAD = '01a1e001-0001-7000-8000-000000000001';
const SESSION_ID = 'codex-real-cli-edit';

type RolloutRow = Record<string, unknown>;

function timestamp(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 9, 31, 0, 0, offsetSeconds)).toISOString();
}

/** A paginated-mode rollout: assistant answers are `response_item` rows. */
function paginatedRollout(threadId: string, turns: number): RolloutRow[] {
  const rows: RolloutRow[] = [
    {
      timestamp: timestamp(0),
      ordinal: 0,
      type: 'session_meta',
      payload: {
        creator_user_id: 'real-cli-test',
        creator_account_id: 'real-cli-test',
        session_id: threadId,
        id: threadId,
        timestamp: timestamp(0),
        cwd: '/tmp/codex-real-cli-workspace',
        runtime_workspace_roots: ['/tmp/codex-real-cli-workspace'],
        originator: 'cloudcli',
        cli_version: '0.166.0',
        source: 'vscode',
        model_provider: 'openai',
        base_instructions: { text: 'test instructions' },
        history_mode: 'paginated',
      },
    },
  ];
  let ordinal = 1;
  for (let turn = 1; turn <= turns; turn += 1) {
    const turnId = `turn-${turn}`;
    rows.push(
      { timestamp: timestamp(ordinal), ordinal: ordinal++, type: 'event_msg', payload: { type: 'task_started', turn_id: turnId } },
      { timestamp: timestamp(ordinal), ordinal: ordinal++, type: 'turn_context', payload: { turn_id: turnId, cwd: '/tmp/codex-real-cli-workspace' } },
      {
        timestamp: timestamp(ordinal),
        ordinal: ordinal++,
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          thread_id: threadId,
          turn_id: turnId,
          item: { type: 'UserMessage', id: `user-${turn}`, content: [{ type: 'text', text: `prompt-${turn}` }] },
        },
      },
      {
        timestamp: timestamp(ordinal),
        ordinal: ordinal++,
        type: 'response_item',
        payload: {
          type: 'message',
          status: 'completed',
          id: `answer-${turn}`,
          role: 'assistant',
          content: [{ type: 'output_text', text: `answer-${turn}`, annotations: [] }],
        },
      },
      { timestamp: timestamp(ordinal), ordinal: ordinal++, type: 'event_msg', payload: { type: 'task_complete', turn_id: turnId } },
    );
  }
  return rows;
}

async function writeRollout(
  sessionsRoot: string,
  threadId: string,
  rows: RolloutRow[],
): Promise<string> {
  const dayDirectory = path.join(sessionsRoot, '2026', '10', '31');
  await mkdir(dayDirectory, { recursive: true });
  const filePath = path.join(dayDirectory, `rollout-2026-10-31T00-00-00-${threadId}.jsonl`);
  await writeFile(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return filePath;
}

async function withTempEnvironment(
  runTest: (context: {
    home: string;
    sessionsRoot: string;
    provider: CodexSessionsProvider;
    projectPath: string;
  }) => Promise<void>,
): Promise<void> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-real-cli-'));
  const sessionsRoot = path.join(home, '.codex', 'sessions');
  const projectPath = path.join(home, 'workspace');
  await mkdir(projectPath, { recursive: true });

  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.DATABASE_PATH = path.join(home, 'auth.db');
  process.env.CODEX_HOME = path.join(home, '.codex');
  closeConnection();
  await initializeDatabase();

  try {
    await runTest({ home, sessionsRoot, provider: new CodexSessionsProvider(), projectPath });
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await rm(home, { recursive: true, force: true });
  }
}

function rowTypes(text: string): string[] {
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const entry = JSON.parse(line) as RolloutRow;
      return String(entry.type);
    });
}

test('the current CLI forks a paginated thread into a pointer, and the app reads the kept prefix', async () => {
  await withTempEnvironment(async ({ sessionsRoot, provider, projectPath }) => {
    const basePath = await writeRollout(sessionsRoot, BASE_THREAD, paginatedRollout(BASE_THREAD, 4));
    sessionsDb.createAppSession(SESSION_ID, 'codex', projectPath, 'Real CLI edit');
    sessionBindingService.replaceBinding({
      sessionId: SESSION_ID,
      providerSessionId: BASE_THREAD,
      jsonlPath: basePath,
    });

    // The user edits the third prompt. Codex's cut is the turn before it.
    const anchor = await provider.resolveEditAnchor(SESSION_ID, 'turn-3');
    assert.deepEqual(anchor, { found: true, resumeThroughId: 'turn-2' });

    await provider.rewindSession(SESSION_ID, anchor.resumeThroughId);

    const binding = sessionsDb.getSessionById(SESSION_ID);
    assert.ok(binding, 'the session row must still exist after the edit');
    assert.notEqual(binding?.provider_session_id, BASE_THREAD, 'the binding moved to the fork');
    assert.ok(binding?.jsonl_path && binding.jsonl_path !== basePath, 'the path moved to the fork transcript');
    const forkPath = binding?.jsonl_path as string;
    await stat(forkPath);

    const forkRows = rowTypes(await readFile(forkPath, 'utf8'));
    console.log(`real-cli.fork.rows=${forkRows.length}`);
    console.log(`real-cli.fork.thread_id=${binding?.provider_session_id}`);
    console.log(`real-cli.fork.path=${forkPath}`);
    // The CLI does not copy a paginated thread. This is the shape the reader
    // has to understand; a reader that opens only this file sees no turns.
    assert.equal(forkRows.length, 2, 'a paginated fork is metadata only');

    const meta = JSON.parse((await readFile(forkPath, 'utf8')).trim().split('\n')[0]) as {
      payload?: Record<string, unknown>;
    };
    assert.equal(meta.payload?.forked_from_id, BASE_THREAD);
    assert.equal(typeof meta.payload?.forked_from_ordinal_exclusive, 'number');
    assert.equal(
      (meta.payload?.history_base as Record<string, unknown> | undefined)?.thread_id,
      BASE_THREAD,
    );
    console.log(`real-cli.forked_from_ordinal_exclusive=${String(meta.payload?.forked_from_ordinal_exclusive)}`);

    // The CLI's own reading of the same fork. It resolves the pointer on its
    // side, so the turns below are the context the next model turn would run
    // with — not the app's interpretation of the file.
    const cliReading = await codexAppServer.readThread({ threadId: binding?.provider_session_id as string });
    const cliText = cliReading.texts.join('\n');
    console.log(`real-cli.thread.read.turns=${cliReading.turns}`);
    console.log(`real-cli.thread.read.texts=${JSON.stringify(cliReading.texts)}`);
    assert.equal(cliReading.turns, 2, 'the fork keeps the two turns before the edited one');
    // `thread/read` reports the user items of each kept turn; the assistant
    // answers are in the same turns but are not returned as item texts by this
    // CLI build. The count plus the two prompts is the CLI's own account of the
    // context the fork resumes with.
    assert.ok(cliText.includes('prompt-1'));
    assert.ok(cliText.includes('prompt-2'));
    assert.equal(cliText.includes('prompt-3'), false, 'the edited turn is not part of the fork');

    // The reader follows the pointer: the kept turns (`prompt-1..2`), and only
    // those. The edited turn and everything after it are gone.
    const history = await provider.fetchHistory(SESSION_ID, { limit: null, offset: 0 });
    const contents = history.messages.map((message) => `${String(message.type)}:${String(message.role ?? '')}:${String(message.content ?? '')}`);
    console.log(`real-cli.history.messages=${contents.length}`);
    console.log(`real-cli.history=${JSON.stringify(contents)}`);
    assert.deepEqual(contents, [
      'undefined:user:prompt-1',
      'undefined:assistant:answer-1',
      'undefined:user:prompt-2',
      'undefined:assistant:answer-2',
    ]);

    // Negative control: the fork file itself contains none of those turns. The
    // assertions above can only hold because the reader followed the pointer.
    const forkText = await readFile(forkPath, 'utf8');
    assert.equal(forkText.includes('prompt-1'), false);
    assert.equal(forkText.includes('answer-2'), false);

    // The replacement run appends its turn to the fork's own file. The prefix
    // must still be there, and the abandoned turn must not return.
    const replacementStart = 16;
    const replacementRows: RolloutRow[] = [
      { timestamp: timestamp(replacementStart), ordinal: replacementStart, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-replacement' } },
      {
        timestamp: timestamp(replacementStart + 1),
        ordinal: replacementStart + 1,
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          thread_id: binding?.provider_session_id,
          turn_id: 'turn-replacement',
          item: { type: 'UserMessage', id: 'user-replacement', content: [{ type: 'text', text: 'prompt-replacement' }] },
        },
      },
      {
        timestamp: timestamp(replacementStart + 2),
        ordinal: replacementStart + 2,
        type: 'response_item',
        payload: {
          type: 'message',
          status: 'completed',
          id: 'answer-replacement',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'answer-replacement', annotations: [] }],
        },
      },
      { timestamp: timestamp(replacementStart + 3), ordinal: replacementStart + 3, type: 'event_msg', payload: { type: 'task_complete', turn_id: 'turn-replacement' } },
    ];
    await appendFile(forkPath, `${replacementRows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

    const refreshed = await provider.fetchHistory(SESSION_ID, { limit: null, offset: 0 });
    const refreshedContents = refreshed.messages.map(
      (message) => `${String(message.role ?? '')}:${String(message.content ?? '')}`,
    );
    console.log(`real-cli.refreshed=${JSON.stringify(refreshedContents)}`);
    assert.deepEqual(refreshedContents, [
      'user:prompt-1',
      'assistant:answer-1',
      'user:prompt-2',
      'assistant:answer-2',
      'user:prompt-replacement',
      'assistant:answer-replacement',
    ]);
    assert.equal(refreshedContents.filter((row) => row === 'user:prompt-3').length, 0);
  });
});

test('editing the first prompt detaches the binding and the next thread starts empty', async () => {
  await withTempEnvironment(async ({ sessionsRoot, provider, projectPath }) => {
    const basePath = await writeRollout(sessionsRoot, BASE_THREAD, paginatedRollout(BASE_THREAD, 3));
    sessionsDb.createAppSession(SESSION_ID, 'codex', projectPath, 'Real CLI first edit');
    sessionBindingService.replaceBinding({
      sessionId: SESSION_ID,
      providerSessionId: BASE_THREAD,
      jsonlPath: basePath,
    });

    const anchor = await provider.resolveEditAnchor(SESSION_ID, 'turn-1');
    assert.deepEqual(anchor, { found: true, resumeThroughId: null });

    await provider.rewindSession(SESSION_ID, null);

    const detached = sessionsDb.getSessionById(SESSION_ID);
    assert.equal(detached?.provider_session_id, null);
    assert.equal(detached?.jsonl_path, null);
    assert.equal(detached?.provider, 'codex');
    console.log('real-cli.first-edit.binding=detached');

    // The next run opens a brand-new thread. Its transcript contains only the
    // replacement turn; nothing from the abandoned conversation comes along.
    const newThread = '01a1e002-0002-7000-8000-000000000002';
    const newPath = await writeRollout(sessionsRoot, newThread, paginatedRollout(newThread, 1));
    sessionBindingService.replaceBinding({
      sessionId: SESSION_ID,
      providerSessionId: newThread,
      jsonlPath: newPath,
    });

    const history = await provider.fetchHistory(SESSION_ID, { limit: null, offset: 0 });
    const contents = history.messages.map((message) => `${String(message.role ?? '')}:${String(message.content ?? '')}`);
    console.log(`real-cli.first-edit.history=${JSON.stringify(contents)}`);
    assert.deepEqual(contents, ['user:prompt-1', 'assistant:answer-1']);
  });
});
