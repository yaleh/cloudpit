import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, { type NextFunction, type Request, type Response } from 'express';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  providerModelsDb,
  sessionsDb,
} from '@/modules/database/index.js';
import providerRouter from '@/modules/providers/provider.routes.js';
import { providerModelsService } from '@/modules/providers/index.js';
import { sessionsService } from '@/modules/providers/services/sessions.service.js';
import { providerRegistry } from '@/modules/providers/provider.registry.js';
import {
  installCodexProviderRegistryPort,
  type CodexProviderRegistryReading,
} from '@/shared/ports/codex-provider-registry.port.js';
import type { IProviderFork } from '@/shared/interfaces.js';
import { AppError } from '@/shared/utils.js';

/**
 * A session records the upstream provider its model is bound to (AC-462).
 *
 * Legs:
 * 1. the sessions row gains `model_provider_id`, and the first send records the
 *    provider the selected model entry declares (`codexProviderId`);
 * 2. a model that declares no provider leaves the session unbound;
 * 3. moving a bound session to a selection that runs under a DIFFERENT provider
 *    is refused with the fork/new-session action, and nothing is written; the
 *    same provider with another model is an ordinary switch;
 * 4. a provider that was deleted or renamed is MARKED — the recorded model is
 *    still the one the conversation ran with, never the catalog default — and a
 *    fresh binding to it is refused;
 * 5. a row that recorded no binding (a session from before the column, or one
 *    that only ever ran unbound) can still establish one;
 * 6. the HTTP route answers the refusal with the same code and message;
 * 7. a fork inherits the binding, because its source thread started under it;
 * 8. the pre-admission send guard refuses the same switch before a run exists.
 *
 * WHY THESE READ THE SERVICE, NOT A COPY OF ITS LOGIC. `setSessionModel` is the
 * funnel every send passes through (`chat.send`, `chat.edit-send`, the
 * active-model route and the MCP reconfigure tool), so a green run over it is a
 * reading of the guard every entry point shares. The registry is a shared port
 * installed by the settings module in production; these legs install a fake
 * reading and mutate its ids to model a deleted or renamed provider.
 */

const BOUND_BOB = 'bound-bob-model';
const BOUND_BOB_SECOND = 'bound-bob-second-model';
const BOUND_ALICE = 'bound-alice-model';
const UNBOUND = 'plain-unbound-model';

type BindingWorkspace = {
  baseUrl: string;
  workspacePath: string;
  /** The project provider ids the fake registry currently defines. */
  providerIds: Set<string>;
};

const createRegistry = (): { providerIds: Set<string>; read: () => CodexProviderRegistryReading } => {
  const providerIds = new Set(['bob', 'alice']);
  const read = (): CodexProviderRegistryReading => ({
    providers: [...providerIds].map((id) => ({ id })),
    reservedIds: ['openai', 'ollama', 'lmstudio'],
  });
  return { providerIds, read };
};

async function withBindingWorkspace(run: (context: BindingWorkspace) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-session-provider-binding-'));
  const workspacePath = path.join(directory, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const { providerIds, read } = createRegistry();

  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await writeFile(process.env.DATABASE_PATH, '');
  await initializeDatabase();
  // Installed before the first write: the service reads this port lazily, so
  // every leg below is judged against the registry this test states.
  installCodexProviderRegistryPort({ read });

  const app = express().use(express.json()).use('/api/providers', providerRouter);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR' } });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const address = server.address() as AddressInfo;
    await run({ baseUrl: `http://127.0.0.1:${address.port}`, workspacePath, providerIds });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
}

/** Seeds one custom Codex model entry; `providerId` is its `codexProviderId`. */
function seedModel(modelId: string, providerId?: string): void {
  providerModelsDb.createCustomProviderModel('codex', {
    id: modelId,
    model: modelId,
    config: providerId === undefined ? { env: [] } : { env: [], codexProviderId: providerId },
  });
}

/** Seeds the app row a send would write to. */
function seedSession(sessionId: string, workspacePath: string, provider = 'codex'): void {
  sessionsDb.createAppSession(sessionId, provider, workspacePath, 'Binding session');
}

function sessionColumns(): string[] {
  return (getConnection().prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>)
    .map((column) => column.name);
}

/**
 * The refusal a provider switch must produce: 409, the recorded id, what the
 * requested selection would run under, and the way out.
 */
function providerSwitchRefusal(expectedTarget: RegExp): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.ok(error instanceof AppError, `expected an AppError, got ${String(error)}`);
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, 'SESSION_PROVIDER_MISMATCH');
    assert.match(error.message, /"bob"/);
    assert.match(error.message, expectedTarget);
    assert.match(error.message, /fork this session/i);
    assert.match(error.message, /start a new one/i);
    return true;
  };
}

test('the first send records the upstream provider its model is bound to, and readers carry it', async () => {
  await withBindingWorkspace(async ({ workspacePath }) => {
    assert.ok(
      sessionColumns().includes('model_provider_id'),
      'the sessions table must carry the column this feature records into',
    );

    seedModel(BOUND_BOB, 'bob');
    seedSession('first-send', workspacePath);

    const stored = providerModelsService.setSessionModel('codex', 'first-send', BOUND_BOB);

    assert.equal(sessionsDb.getSessionById('first-send')?.model_provider_id, 'bob');
    assert.equal(stored?.modelProviderId, 'bob');
    assert.equal(stored?.modelProviderProblem, null);

    const resolved = await providerModelsService.resolveSessionModel('codex', { sessionId: 'first-send' });
    assert.equal(resolved.model, BOUND_BOB);
    assert.equal(resolved.modelProviderId, 'bob');
    assert.equal(resolved.modelProviderProblem, null);
    assert.equal(resolved.source, 'session');

    // Write-once: a later write cannot move the conversation behind the guard.
    assert.equal(sessionsDb.setSessionModelProviderId('first-send', 'alice'), false);
    assert.equal(sessionsDb.getSessionById('first-send')?.model_provider_id, 'bob');
  });
});

test('a model that declares no provider leaves the session unbound', async () => {
  await withBindingWorkspace(async ({ workspacePath }) => {
    seedModel(UNBOUND);
    seedSession('unbound-session', workspacePath);

    const stored = providerModelsService.setSessionModel('codex', 'unbound-session', UNBOUND);

    assert.equal(sessionsDb.getSessionById('unbound-session')?.model_provider_id, null);
    assert.equal(stored?.modelProviderId, null);
    assert.equal(stored?.modelProviderProblem, null);

    const resolved = await providerModelsService.resolveSessionModel('codex', { sessionId: 'unbound-session' });
    assert.equal(resolved.model, UNBOUND);
    assert.equal(resolved.modelProviderId, null);
    assert.equal(resolved.modelProviderProblem, null);
  });
});

test('moving a bound session to another provider is refused with the fork action; the same provider is not', async () => {
  await withBindingWorkspace(async ({ workspacePath }) => {
    seedModel(BOUND_BOB, 'bob');
    seedModel(BOUND_BOB_SECOND, 'bob');
    seedModel(BOUND_ALICE, 'alice');
    seedModel(UNBOUND);
    seedSession('bound-session', workspacePath);
    providerModelsService.setSessionModel('codex', 'bound-session', BOUND_BOB);

    // Another provider's model — including a model that would inherit the
    // process-global provider (NULL) — is a provider switch, not a model switch.
    assert.throws(
      () => providerModelsService.setSessionModel('codex', 'bound-session', BOUND_ALICE),
      providerSwitchRefusal(/"alice"/),
    );
    assert.throws(
      () => providerModelsService.setSessionModel('codex', 'bound-session', UNBOUND),
      providerSwitchRefusal(/inherits the provider default/),
    );

    // Nothing was written by either refusal.
    const unchanged = sessionsDb.getSessionById('bound-session');
    assert.equal(unchanged?.model, BOUND_BOB);
    assert.equal(unchanged?.model_provider_id, 'bob');

    // Another model on the SAME provider is an ordinary switch.
    providerModelsService.setSessionModel('codex', 'bound-session', BOUND_BOB_SECOND);
    const switched = sessionsDb.getSessionById('bound-session');
    assert.equal(switched?.model, BOUND_BOB_SECOND);
    assert.equal(switched?.model_provider_id, 'bob');
  });
});

test('a deleted or renamed provider is marked, and the session keeps the model it ran with', async () => {
  await withBindingWorkspace(async ({ workspacePath, providerIds }) => {
    seedModel(BOUND_BOB, 'bob');
    seedSession('orphaned-session', workspacePath);
    providerModelsService.setSessionModel('codex', 'orphaned-session', BOUND_BOB);

    const before = await providerModelsService.resolveSessionModel('codex', { sessionId: 'orphaned-session' });
    assert.equal(before.modelProviderProblem, null, 'a provider that still exists is not marked');

    // Renaming the provider is a full-file replacement of the registry: the old
    // id disappears, exactly as a delete would.
    providerIds.delete('bob');
    providerIds.add('robert');

    const after = await providerModelsService.resolveSessionModel('codex', { sessionId: 'orphaned-session' });
    // The model is the recorded one, NOT the catalog default: a provider that
    // disappeared must not make the session look like it never picked a model.
    assert.equal(after.model, BOUND_BOB);
    assert.equal(after.modelProviderId, 'bob');
    assert.ok(after.modelProviderProblem);
    assert.match(after.modelProviderProblem, /"bob"/);
    assert.match(after.modelProviderProblem, /no longer defined/);
    assert.match(after.modelProviderProblem, /fork this session/i);

    // The row itself is untouched by the read.
    const row = sessionsDb.getSessionById('orphaned-session');
    assert.equal(row?.model, BOUND_BOB);
    assert.equal(row?.model_provider_id, 'bob');

    // A fresh binding to the retired provider is refused, and writes nothing.
    seedSession('fresh-session', workspacePath);
    assert.throws(
      () => providerModelsService.setSessionModel('codex', 'fresh-session', BOUND_BOB),
      (error: unknown) => error instanceof AppError
        && error.statusCode === 409
        && error.code === 'SESSION_PROVIDER_UNKNOWN'
        && /"bob"/.test(error.message)
        && /no longer exists/.test(error.message),
    );
    const fresh = sessionsDb.getSessionById('fresh-session');
    assert.equal(fresh?.model_provider_id, null);
  });
});

test('a row that recorded no binding can still establish one', async () => {
  await withBindingWorkspace(async ({ workspacePath }) => {
    seedModel(UNBOUND);
    seedModel(BOUND_BOB, 'bob');
    seedSession('legacy-session', workspacePath);

    // A session from before the column: it has a model, but no provider id.
    sessionsDb.setSessionModel('legacy-session', UNBOUND);
    assert.equal(sessionsDb.getSessionById('legacy-session')?.model_provider_id, null);

    const stored = providerModelsService.setSessionModel('codex', 'legacy-session', BOUND_BOB);

    assert.equal(stored?.modelProviderId, 'bob');
    assert.equal(sessionsDb.getSessionById('legacy-session')?.model_provider_id, 'bob');
  });
});

test('the active-model route answers the refusal with the same readable code', async () => {
  await withBindingWorkspace(async ({ baseUrl, workspacePath }) => {
    seedModel(BOUND_BOB, 'bob');
    seedModel(BOUND_ALICE, 'alice');
    seedSession('route-session', workspacePath);
    providerModelsService.setSessionModel('codex', 'route-session', BOUND_BOB);

    const refused = await fetch(`${baseUrl}/api/providers/codex/sessions/route-session/active-model`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: BOUND_ALICE }),
    });
    const refusedBody = await refused.json() as { error?: { code?: string; message?: string } };

    assert.equal(refused.status, 409);
    assert.equal(refusedBody.error?.code, 'SESSION_PROVIDER_MISMATCH');
    assert.match(String(refusedBody.error?.message), /fork this session/i);
    assert.equal(sessionsDb.getSessionById('route-session')?.model, BOUND_BOB);

    const reading = await fetch(`${baseUrl}/api/providers/codex/sessions/route-session/active-model`);
    const readingBody = await reading.json() as {
      data: { model: string; modelProviderId: string | null; modelProviderProblem: string | null };
    };
    assert.equal(readingBody.data.model, BOUND_BOB);
    assert.equal(readingBody.data.modelProviderId, 'bob');
    assert.equal(readingBody.data.modelProviderProblem, null);
  });
});

test('a fork inherits the upstream provider binding of the conversation it branched from', async () => {
  await withBindingWorkspace(async ({ workspacePath }) => {
    const sourcePath = path.join(workspacePath, 'native-source.jsonl');
    const forkedPath = path.join(workspacePath, 'native-fork.jsonl');
    await writeFile(sourcePath, '{}\n', 'utf8');
    await writeFile(forkedPath, '{}\n', 'utf8');

    seedSession('fork-source', workspacePath, 'claude');
    sessionsDb.assignProviderSessionId('fork-source', 'native-source');
    getConnection()
      .prepare('UPDATE sessions SET jsonl_path = ? WHERE session_id = ?')
      .run(sourcePath, 'fork-source');
    sessionsDb.setSessionModelProviderId('fork-source', 'bob');

    const claude = providerRegistry.resolveProvider('claude') as { fork?: IProviderFork };
    const realFork = claude.fork;
    Object.defineProperty(claude, 'fork', {
      configurable: true,
      writable: true,
      value: {
        forkSession: async () => ({ providerSessionId: 'native-fork', jsonlPath: forkedPath }),
      } as IProviderFork,
    });

    try {
      const result = await sessionsService.forkSessionById('fork-source');
      // The branch resumes a thread the provider started under `bob`; dropping
      // the binding would make that resume the mismatch this column prevents.
      assert.equal(sessionsDb.getSessionById(result.sessionId)?.model_provider_id, 'bob');
    } finally {
      Object.defineProperty(claude, 'fork', { configurable: true, writable: true, value: realFork });
    }
  });
});

test('the pre-admission send guard refuses the switch and passes the first send', async () => {
  await withBindingWorkspace(async ({ workspacePath }) => {
    seedModel(BOUND_BOB, 'bob');
    seedModel(BOUND_ALICE, 'alice');
    seedSession('guard-session', workspacePath);

    // A session with no recorded binding: the first send is exactly where one
    // is allowed to be established, so the guard passes.
    assert.doesNotThrow(() => {
      providerModelsService.assertSessionProviderSwitch('codex', 'guard-session', BOUND_BOB);
    });

    providerModelsService.setSessionModel('codex', 'guard-session', BOUND_BOB);

    assert.throws(
      () => providerModelsService.assertSessionProviderSwitch('codex', 'guard-session', BOUND_ALICE),
      providerSwitchRefusal(/"alice"/),
    );
    // Same provider, another model: nothing for the guard to refuse.
    assert.doesNotThrow(() => {
      providerModelsService.assertSessionProviderSwitch('codex', 'guard-session', BOUND_BOB);
    });
  });
});
