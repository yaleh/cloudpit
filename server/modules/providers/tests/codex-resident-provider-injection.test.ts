/**
 * Resident Codex provider injection (AC-463).
 *
 * The resident path spawned `codex app-server` with the driver-wide launch, so a
 * session whose model was bound to a project upstream provider still ran under
 * Codex's process-global `openai` provider. Codex 0.166 does not accept the
 * binding at `thread/start` — it starts the thread and then refuses the first
 * `turn/start` with `modelProviderMismatch` — so the provider has to be compiled
 * into the app-server's spawn arguments.
 *
 * WHAT THIS FILE PINS, all against the REAL bundled `@openai/codex` 0.166.0
 * app-server and a local mock Responses API (no injected transport):
 *
 *   - POSITIVE: a session whose launch bag names `modelProviderId` spawns the
 *     app-server with `-c model_provider` + `-c model_providers.<id>={...}`; the
 *     turn reaches the mock's `/v1/responses` with `Authorization: Bearer
 *     <token-file secret>`.
 *   - ISOLATION: a host sentinel in `process.env` is absent from the child
 *     environment, and the secret appears in neither the child's argv nor any
 *     process table — it travels only under the provider's `env_key`.
 *   - NEGATIVE CONTROL: the same custom provider named ONLY on `thread/start`
 *     (the shape the old code could have been tempted into) makes the turn fail
 *     with the server's own "uses bob, but your current provider is openai"
 *     refusal and never reaches the mock.
 *   - RESUME: a restarted host re-injects the same provider id and resumes the
 *     SAME thread id under it. Without the recorded id the resume surfaces the
 *     server's `modelProviderNotConfigured` sentence instead of falling back.
 *   - RESTORE WIRING: the production `defaultResidentLaunchOptions` reads the
 *     session row's `model_provider_id` into the launch bag the restore pass
 *     hands `startResidentSession`.
 */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexAppServerConnection } from '@/modules/providers/list/codex/app-server/codex-app-server.connection.js';
import {
  CodexHostDriver,
  type CodexResidentHostPort,
} from '@/modules/providers/list/codex/host/codex-host-driver.provider.js';
import { providerRuntimeService } from '@/modules/providers/services/provider-runtime.service.js';
import { createCodexModelProvidersSource } from '@/modules/settings/index.js';
import type { IProvider, IProviderHostDriver, IProviderHostDriverSink } from '@/shared/interfaces.js';
import { installCodexProviderRegistryPort } from '@/shared/ports/codex-provider-registry.port.js';
import { installProviderRegistryPort } from '@/shared/ports/provider-registry.port.js';
import type {
  HostResidentLaunch,
  HostTurnInput,
  LLMProvider,
  ProcessHost,
  ProviderRuntimeContext,
  ProviderRuntimeWriter,
  SessionBinding,
} from '@/shared/types.js';

const HOST_SENTINEL_KEY = 'CC_CODEX_HOST_SENTINEL';
const HOST_SENTINEL_VALUE = 'host-secret-that-must-not-reach-the-child';
const PROVIDER_ID = 'bob';
const ENV_KEY = 'BOB_API_KEY';
const TOKEN_SECRET = 'token-file-secret-4242';
const APP_SESSION = 'codex-resident-injection';
const MODEL = 'custom-model';

/**
 * An isolated database for the whole file.
 *
 * The resident turn relay links streamed frames to a session row, so a real
 * app-server run reads `sessionsDb` even though these criteria never ask it to.
 * Pointing the process at a private database keeps that read off the operator's
 * `~/.cloudcli/auth.db` (and off a sibling criterion's fixture).
 */
const DATABASE_DIRECTORY = path.join(
  os.tmpdir(),
  `codex-resident-injection-db-${process.pid}-${Date.now()}`,
);
before(async () => {
  process.env.DATABASE_PATH = path.join(DATABASE_DIRECTORY, 'auth.db');
  await initializeDatabase();
});
after(async () => {
  closeConnection();
  await rm(DATABASE_DIRECTORY, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** One request the bundled CLI made to the mock endpoint. */
type SeenRequest = { url: string; authorization: string | undefined };

/**
 * A local Responses-API mock. The 400 is deliberate: Codex 0.166 treats it as a
 * terminal client error (no 5xx backoff), so a turn settles in well under a
 * second while still exercising the real HTTP path — including the
 * `Authorization` header the provider's `env_key` produces.
 */
async function startMockResponsesApi(): Promise<{
  requests: SeenRequest[];
  baseUrl: string;
  close(): Promise<void>;
}> {
  const requests: SeenRequest[] = [];
  const server = http.createServer((request, response) => {
    requests.push({
      url: request.url ?? '',
      authorization: typeof request.headers.authorization === 'string'
        ? request.headers.authorization
        : undefined,
    });
    request.resume();
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'mock: resident provider injection criterion' } }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

/**
 * Writes the production settings document + its 0600 token file and installs the
 * real settings source in the shared registry port. Nothing about resolution is
 * stubbed: the driver reads the JSON and the token file through the same
 * `resolve()` the production composition root installs.
 */
async function withProviderRegistry(
  baseUrl: string,
  run: (home: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-resident-injection-'));
  const settingsPath = path.join(directory, 'codex.settings.json');
  const tokenFile = path.join(directory, 'bob.token');
  await writeFile(tokenFile, TOKEN_SECRET, { encoding: 'utf8', mode: 0o600 });
  await writeFile(
    settingsPath,
    JSON.stringify({
      modelProviders: {
        [PROVIDER_ID]: {
          name: 'Bob Upstream',
          baseUrl,
          envKey: ENV_KEY,
          tokenFile,
        },
      },
    }),
    'utf8',
  );

  const source = createCodexModelProvidersSource({ settingsPath, env: {}, homeDir: directory });
  installCodexProviderRegistryPort({
    read: () => ({
      providers: source.read().providers.map((provider) => ({ id: provider.id })),
      reservedIds: [],
    }),
    resolve: (id) => source.resolve(id),
  });

  try {
    await run(directory);
  } finally {
    // The app-server writes its rollout lazily; let the killed child finish
    // before the directory walk, and retry the race-prone removal.
    await pause(150);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

const SINK: IProviderHostDriverSink = {
  leaseAdded: () => {},
  leaseRemoved: () => {},
  activity: () => {},
  identity: () => {},
  exited: () => {},
};

/** The binding the manager writes before asking a driver to start a host. */
function bindingFor(appSessionId: string): SessionBinding {
  return {
    appSessionId,
    providerSessionId: null,
    state: 'idle',
    leases: [],
    lastActivityAt: Date.now(),
    peerName: null,
    detachReason: null,
  };
}

/**
 * A stand-in for the process-wide session-host manager, narrowed to the two
 * verbs `CodexResidentHostPort` declares.
 *
 * It reproduces the ORDER the real `openHost` uses — register the record, call
 * `startHost`, then `bind` — because that order is load-bearing here: the
 * connection (and therefore the spawn args) is created in `startHost`, before
 * `bind` could hand the per-session launch over.
 */
function createHostPort(): CodexResidentHostPort & { hosts: ProcessHost[]; openCalls: string[] } {
  const hosts: ProcessHost[] = [];
  const openCalls: string[] = [];
  return {
    hosts,
    openCalls,
    async openHost(input): Promise<ProcessHost> {
      openCalls.push(input.appSessionId);
      const binding = bindingFor(input.appSessionId);
      const host: ProcessHost = {
        hostId: `host-${hosts.length + 1}`,
        provider: input.provider,
        mode: input.mode,
        state: 'idle',
        pid: null,
        startedAt: Date.now(),
        bindings: new Map([[input.appSessionId, binding]]),
        closeReason: null,
        closeDetail: null,
        quietDeadlineAt: null,
        quietWindowStartAt: null,
      };
      hosts.push(host);
      await input.driver.startHost(host, SINK);
      await input.driver.bind(host, binding);
      return host;
    },
    snapshot: () => hosts,
  };
}

function contextFor(providerSessionId: string | null): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => providerSessionId,
    resolveResumeModel: async () => MODEL,
    getProviderModels: async () => ({ OPTIONS: [], DEFAULT: MODEL }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
}

function writerInto(messages: unknown[]): ProviderRuntimeWriter {
  return { isWebSocketWriter: true, send: (message) => messages.push(message) };
}

const TURN: HostTurnInput = { command: 'hello provider', options: {} };

/** The launch bag the restore pass assembles for a provider-bound session. */
function launchOptionsFor(cwd: string, modelProviderId?: string): Record<string, unknown> {
  return {
    model: MODEL,
    cwd,
    permissionMode: 'bypassPermissions',
    ...(modelProviderId === undefined ? {} : { modelProviderId }),
  };
}

/** The child's argv, NUL-separated, as `/proc` reports it. */
async function childArgv(pid: number): Promise<string> {
  return readFile(`/proc/${pid}/cmdline`, 'utf8');
}

/** The child's initial environment, NUL-separated. */
async function childEnviron(pid: number): Promise<string> {
  return readFile(`/proc/${pid}/environ`, 'utf8');
}

/**
 * Whether the secret is visible in ANY process table entry on this host.
 *
 * This is the "not on a command line" reading at the strength the AC asks for:
 * the child's own argv is checked separately, and this sweep catches a leak into
 * a wrapper process. Unreadable entries (another user's process) are skipped —
 * they cannot be the child this criterion spawned.
 */
async function secretInAnyProcessTable(secret: string): Promise<string | null> {
  for (const entry of await readdir('/proc')) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    try {
      const cmdline = await childArgv(Number(entry));
      if (cmdline.includes(secret)) {
        return entry;
      }
    } catch {
      // Gone between readdir and read, or not ours to read.
    }
  }
  return null;
}

/** Lets the killed app-server flush its rollout before the restart resumes it. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('AC-463: a provider-bound resident session spawns under its provider and the token file supplies Authorization', async () => {
  const mock = await startMockResponsesApi();
  const previousHome = process.env.HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  process.env[HOST_SENTINEL_KEY] = HOST_SENTINEL_VALUE;

  try {
    await withProviderRegistry(mock.baseUrl, async (home) => {
      // Keep the real CLI's session/config writes inside the criterion's temp
      // directory instead of the operator's ~/.codex.
      process.env.HOME = home;
      process.env.CODEX_HOME = home;

      const launched: Array<{ args?: string[]; env?: NodeJS.ProcessEnv }> = [];
      const port = createHostPort();
      const driver = new CodexHostDriver({
        host: port,
        createConnection: (launch) => {
          launched.push(launch);
          return new CodexAppServerConnection({ launch });
        },
      });

      const started = await driver.startResidentSession(APP_SESSION, {
        options: launchOptionsFor(home, PROVIDER_ID),
        context: contextFor(null),
      });
      assert.ok(started.pid !== null, 'the real app-server process must report a pid');

      // ── the compiled launch: args carry the provider, env carries the secret ──
      assert.equal(launched.length, 1, 'one app-server was spawned for the session');
      const launch = launched[0];
      const args = launch.args ?? [];
      assert.ok(args.includes(`model_provider="${PROVIDER_ID}"`), `spawn args must select the provider: ${JSON.stringify(args)}`);
      assert.ok(
        args.some((arg) => arg.startsWith(`model_providers.${PROVIDER_ID}={`) && arg.includes(`env_key = "${ENV_KEY}"`)),
        `spawn args must define the provider endpoint: ${JSON.stringify(args)}`,
      );
      assert.equal(launch.env?.[ENV_KEY], TOKEN_SECRET, 'the token-file secret travels under env_key');
      assert.equal(launch.env?.[HOST_SENTINEL_KEY], undefined, 'a host sentinel must not reach the child');
      assert.ok(!JSON.stringify(args).includes(TOKEN_SECRET), 'the secret must never be an argv value');

      // ── the real process table: secret in env, never on the command line ──
      const argv = await childArgv(started.pid);
      assert.ok(!argv.includes(TOKEN_SECRET), 'the secret must not be visible in the child argv');
      assert.ok(argv.includes(`model_provider="${PROVIDER_ID}"`), 'the child really was spawned with the provider override');
      const environ = await childEnviron(started.pid);
      assert.ok(environ.includes(`${ENV_KEY}=${TOKEN_SECRET}`), 'the secret is in the child environment under env_key');
      assert.ok(!environ.includes(HOST_SENTINEL_KEY), 'the host sentinel is absent from the child environment');
      assert.equal(await secretInAnyProcessTable(TOKEN_SECRET), null, 'the secret is in no process table entry');

      // ── the turn reaches the mock with the env_key credential ──
      const messages: unknown[] = [];
      await driver.run(APP_SESSION, TURN, writerInto(messages), contextFor(null));
      assert.ok(mock.requests.length >= 1, `the real app-server must call the mock; frames=${JSON.stringify(messages)}`);
      assert.equal(mock.requests[0].url, '/v1/responses');
      assert.equal(mock.requests[0].authorization, `Bearer ${TOKEN_SECRET}`);

      // ── restart + resume: the SAME provider id and the SAME thread ──
      const threadId = driver.readSession(APP_SESSION).threadId;
      assert.ok(threadId, 'the first turn must have established a thread');
      const firstHost = port.hosts[0];
      await driver.closeHost(firstHost, 'user');
      await pause(200);

      const resumePort = createHostPort();
      const resumedLaunches: Array<{ args?: string[]; env?: NodeJS.ProcessEnv }> = [];
      const resumedDriver = new CodexHostDriver({
        host: resumePort,
        createConnection: (resumedLaunch) => {
          resumedLaunches.push(resumedLaunch);
          return new CodexAppServerConnection({ launch: resumedLaunch });
        },
      });
      await resumedDriver.startResidentSession(APP_SESSION, {
        options: launchOptionsFor(home, PROVIDER_ID),
        context: contextFor(threadId),
      });
      await resumedDriver.run(APP_SESSION, { command: 'again', options: {} }, writerInto(messages), contextFor(threadId));

      assert.ok(
        (resumedLaunches[0].args ?? []).includes(`model_provider="${PROVIDER_ID}"`),
        'the restarted host re-injects the recorded provider',
      );
      assert.equal(
        resumedDriver.readSession(APP_SESSION).threadId,
        threadId,
        'the resumed turn re-used the original thread (a no-rollout fallback would have replaced the id)',
      );
      assert.equal(mock.requests.length, 2, 'the resumed turn also reached the mock');
      assert.equal(mock.requests[1].authorization, `Bearer ${TOKEN_SECRET}`);

      // ── missing provider config on resume is a readable refusal, not openai ──
      await resumedDriver.closeHost(resumePort.hosts[0], 'user');
      const requestsBefore = mock.requests.length;
      const barePort = createHostPort();
      const bareDriver = new CodexHostDriver({
        host: barePort,
        createConnection: (bareLaunch) => new CodexAppServerConnection({ launch: bareLaunch }),
      });
      await bareDriver.startResidentSession(APP_SESSION, {
        options: launchOptionsFor(home),
        context: contextFor(threadId),
      });
      await assert.rejects(
        bareDriver.run(APP_SESSION, TURN, writerInto(messages), contextFor(threadId)),
        (error: unknown) => /bob/.test(String((error as Error).message)) && /no longer configured/i.test(String((error as Error).message)),
        'resume without the recorded provider must surface modelProviderNotConfigured',
      );
      assert.equal(mock.requests.length, requestsBefore, 'a refused resume must not dial any endpoint');
      await bareDriver.closeHost(barePort.hosts[0], 'user');
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    delete process.env[HOST_SENTINEL_KEY];
    await mock.close();
  }
});

test('AC-463: naming the provider only on thread/start is refused by the real app-server', async () => {
  const mock = await startMockResponsesApi();
  const previousHome = process.env.HOME;
  const previousCodexHome = process.env.CODEX_HOME;

  try {
    await withProviderRegistry(mock.baseUrl, async (home) => {
      process.env.HOME = home;
      process.env.CODEX_HOME = home;

      // No `-c` provider overrides: this is exactly the shape an implementation
      // that only passed `modelProvider` to `thread/start` would produce.
      const connection = new CodexAppServerConnection({
        launch: {
          cwd: home,
          env: { ...process.env },
        },
      });
      try {
        await connection.initialize();
        const started = await connection.request('thread/start', {
          model: MODEL,
          cwd: home,
          approvalPolicy: 'never',
          sandbox: 'danger-full-access',
          modelProvider: PROVIDER_ID,
          config: {
            model_providers: {
              [PROVIDER_ID]: {
                name: 'Bob Upstream',
                base_url: mock.baseUrl,
                env_key: ENV_KEY,
                wire_api: 'responses',
              },
            },
          },
        });
        const thread = (started as { thread?: { id?: string } }).thread;
        assert.ok(thread?.id, 'the thread starts; the mismatch only shows on the first turn');

        await assert.rejects(
          connection.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'hello' }] }),
          (error: unknown) => /provider/i.test(String((error as Error).message)),
          'a thread-level provider alone must be refused by the process-global check',
        );
        assert.equal(mock.requests.length, 0, 'the refused turn never reaches the custom endpoint');
      } finally {
        connection.close();
      }
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    await mock.close();
  }
});

test('AC-463: an unknown recorded provider is refused readably before any process is spawned', async () => {
  const mock = await startMockResponsesApi();
  try {
    await withProviderRegistry(mock.baseUrl, async () => {
      const port = createHostPort();
      const driver = new CodexHostDriver({ host: port });

      await assert.rejects(
        driver.startResidentSession(APP_SESSION, {
          options: launchOptionsFor(os.tmpdir(), 'nobody'),
          context: contextFor(null),
        }),
        (error: unknown) => {
          const message = String((error as Error).message);
          return message.includes('nobody') && /not configured/i.test(message);
        },
        'an unresolvable provider must be named and reported as not configured',
      );
      assert.deepEqual(port.openCalls, [], 'no host was opened for a provider that cannot be resolved');
      assert.equal(mock.requests.length, 0, 'nothing dialled any endpoint');
    });
  } finally {
    await mock.close();
  }
});

test('AC-463: the restore launch options carry the session row provider id', async () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-resident-restore-db-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(directory, 'auth.db');
  await initializeDatabase();

  try {
    sessionsDb.createSession(APP_SESSION, 'codex', directory);
    sessionsDb.setSessionModel(APP_SESSION, MODEL);
    sessionsDb.setSessionModelProviderId(APP_SESSION, PROVIDER_ID);

    let captured: HostResidentLaunch | null = null;
    const fakeDriver = {
      async startResidentSession(_appSessionId: string, launch: HostResidentLaunch) {
        captured = launch;
        return { hostId: 'host-restore', pid: null };
      },
    } as unknown as IProviderHostDriver;
    const fakeProvider = {
      id: 'codex',
      hostDriver: fakeDriver,
      sessions: { normalizeMessage: () => [] },
      auth: { getStatus: async () => ({ installed: true }) },
    } as unknown as IProvider;

    installProviderRegistryPort({
      listProviders: () => [fakeProvider],
      resolveProvider: (id) => {
        if (id === 'codex') {
          return fakeProvider;
        }
        throw new Error(`unexpected provider ${id}`);
      },
    });

    const result = await providerRuntimeService.startResidentSession('codex' as LLMProvider, APP_SESSION);
    assert.deepEqual(result, { hostId: 'host-restore', pid: null });
    assert.ok(captured, 'the production restore seam must reach the driver');
    const options = (captured as HostResidentLaunch).options;
    assert.equal(options.modelProviderId, PROVIDER_ID, 'the row provider id reaches the resident launch bag');
    assert.equal(options.model, MODEL, 'the row model still reaches it too');
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
