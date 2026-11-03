/**
 * Per-run Codex SDK provider injection (AC-464).
 *
 * The runtime used to always construct `new Codex()` with no options, so a
 * model bound to a project upstream provider still dialled Codex's global
 * default. This criterion pins the three readings that make the binding real:
 *
 *   - POSITIVE: a model whose public config carries `codexProviderId` compiles
 *     `config.model_provider` + `config.model_providers.<id>` (base_url,
 *     env_key, wire_api) and passes the token-file secret in the child env
 *     under `env_key`. The REAL Codex SDK spawns the REAL bundled CLI, which
 *     POSTs to a local mock `/v1/responses`; the mock asserts the request's
 *     `Authorization` header is `Bearer <token-file secret>`.
 *   - ISOLATION: a host sentinel variable present in `process.env` is absent
 *     from the child env, while plumbing (PATH/HOME) survives.
 *   - NEGATIVE: a model with no `codexProviderId` still constructs `new Codex()`
 *     with neither `config` nor `env`; a model bound to an unknown provider is
 *     refused with a readable line and never falls back to the default endpoint.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { CodexOptions, Thread, ThreadOptions } from '@openai/codex-sdk';

import { codexRuntime } from '@/modules/providers/list/codex/codex-runtime.provider.js';
import {
  createCodexModelProvidersSource,
} from '@/modules/settings/index.js';
import {
  installCodexProviderRegistryPort,
} from '@/shared/ports/codex-provider-registry.port.js';
import type { ProviderRuntimeContext } from '@/shared/index.js';

const HOST_SENTINEL_KEY = 'CC_CODEX_HOST_SENTINEL';
const HOST_SENTINEL_VALUE = 'host-secret-that-must-not-reach-the-child';
const PROVIDER_ID = 'bob';
const ENV_KEY = 'BOB_API_KEY';
const TOKEN_SECRET = 'token-file-secret-4242';

/** One request the bundled CLI made to the mock endpoint. */
type SeenRequest = { url: string; authorization: string | undefined };

/**
 * A local Responses-API mock. A 400 is deliberate: Codex 0.166 treats it as a
 * terminal client error (no 5xx retry/backoff), so the criterion settles in
 * well under a second while still exercising the real HTTP path — including the
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
    response.end(JSON.stringify({ error: { message: 'mock: provider injection criterion' } }));
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
 * Writes the production settings document + token file, then installs the real
 * settings source in the shared registry port. Nothing about the resolution is
 * stubbed: the runtime reads the JSON and the 0600 token file through the same
 * `resolve()` the production composition root installs.
 */
async function withProviderRegistry(
  baseUrl: string,
  run: (home: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-perrun-injection-'));
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
    await rm(directory, { recursive: true, force: true });
  }
}

/** A context whose single model option carries (or omits) a provider binding. */
function contextForModel(
  modelId: string,
  codexProviderId?: string,
): ProviderRuntimeContext {
  return {
    resolveProviderSessionId: () => null,
    resolveResumeModel: async () => modelId,
    getProviderModels: async () => ({
      OPTIONS: [{
        value: modelId,
        label: modelId,
        isCustom: true,
        config: codexProviderId === undefined
          ? { env: [] }
          : { codexProviderId, env: [] },
      }],
      DEFAULT: modelId,
    }),
    normalizeMessage: () => [],
    isProviderInstalled: async () => true,
  };
}

/**
 * Captures the options the runtime handed the REAL SDK constructor while
 * letting the original `startThread` run, so the CLI still starts for real.
 */
function captureCodexOptions(t: TestContext): { options: () => CodexOptions } {
  let captured: CodexOptions | undefined;
  const originalStartThread = Codex.prototype.startThread;
  t.mock.method(Codex.prototype, 'startThread', function startThread(
    this: Codex,
    options?: ThreadOptions,
  ): Thread {
    captured = (this as unknown as { options: CodexOptions }).options;
    return originalStartThread.call(this, options);
  });
  return {
    options: () => {
      assert.ok(captured, 'the runtime must construct the SDK through startThread');
      return captured;
    },
  };
}

test('AC-464: a bound model launches the real SDK under its provider and the token file supplies Authorization', async (t) => {
  const mock = await startMockResponsesApi();
  const previousHome = process.env.HOME;
  process.env[HOST_SENTINEL_KEY] = HOST_SENTINEL_VALUE;

  try {
    await withProviderRegistry(mock.baseUrl, async (home) => {
      // Keep the real CLI's session/config writes inside the criterion's temp
      // directory instead of the operator's ~/.codex.
      process.env.HOME = home;
      const capture = captureCodexOptions(t);

      const messages: any[] = [];
      await codexRuntime.run('hello provider', {
        sessionId: 'codex-perrun-injection',
        model: 'bound-model',
        cwd: home,
        permissionMode: 'bypassPermissions',
      }, { isWebSocketWriter: true, send: (message) => messages.push(message) }, contextForModel('bound-model', PROVIDER_ID));

      const options = capture.options();
      assert.deepEqual(options.config, {
        model_provider: PROVIDER_ID,
        model_providers: {
          [PROVIDER_ID]: {
            name: 'Bob Upstream',
            base_url: mock.baseUrl,
            env_key: ENV_KEY,
            wire_api: 'responses',
          },
        },
      });
      assert.equal(options.env?.[ENV_KEY], TOKEN_SECRET);
      assert.equal(options.env?.[HOST_SENTINEL_KEY], undefined, 'a host sentinel must not reach the child');

      // The real bundled CLI actually spoke to the mock: the secret arrived as
      // the bearer token, which is the end-to-end reading the config alone
      // cannot prove.
      assert.ok(mock.requests.length >= 1, `the real CLI must call the mock; messages=${JSON.stringify(messages)}`);
      assert.equal(mock.requests[0].url, '/v1/responses');
      assert.equal(mock.requests[0].authorization, `Bearer ${TOKEN_SECRET}`);
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    delete process.env[HOST_SENTINEL_KEY];
    await mock.close();
  }
});

test('AC-464: an unbound model keeps the previous no-options construction', async (t) => {
  let captured: CodexOptions | undefined;
  const fakeThread = {
    id: 'native-thread',
    async runStreamed() {
      return { events: (async function* () {})() };
    },
  } as unknown as Thread;
  // No CLI is needed for the negative reading: the question is what the runtime
  // handed the constructor, and the SDK stores it on the instance.
  t.mock.method(Codex.prototype, 'startThread', function startThread(this: Codex) {
    captured = (this as unknown as { options: CodexOptions }).options;
    return fakeThread;
  });

  await codexRuntime.run('hello default', {
    model: 'unbound-model',
    cwd: os.tmpdir(),
  }, { isWebSocketWriter: true, send: () => {} }, contextForModel('unbound-model'));

  assert.ok(captured, 'the runtime must construct the SDK through startThread');
  assert.equal(captured.config, undefined);
  assert.equal(captured.env, undefined);
});

test('AC-464: a model bound to an unknown provider fails readably and never dials the default', async (t) => {
  const mock = await startMockResponsesApi();
  try {
    await withProviderRegistry(mock.baseUrl, async (home) => {
      const messages: any[] = [];
      await codexRuntime.run('hello nobody', {
        model: 'dangling-model',
        cwd: home,
      }, { isWebSocketWriter: true, send: (message) => messages.push(message) }, contextForModel('dangling-model', 'nobody'));

      const error = messages.find((message) => message.kind === 'error');
      assert.ok(error, `an unresolvable provider must surface an error; messages=${JSON.stringify(messages)}`);
      assert.match(String(error.content), /nobody/);
      assert.match(String(error.content), /not configured/);
      assert.equal(mock.requests.length, 0, 'a refusal must not spawn the CLI against any endpoint');
    });
  } finally {
    await mock.close();
  }
});
