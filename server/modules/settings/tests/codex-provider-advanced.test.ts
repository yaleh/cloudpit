/**
 * Codex provider advanced capabilities (AC-467).
 *
 * Three capabilities that were deliberately deferred out of the first provider
 * slice, all pinned here against the production code:
 *
 *   1. CONNECTION TEST. `probeCodexProviderConnection` sends one minimal REAL
 *      `POST /responses` to the provider's `base_url` and tells apart the four
 *      ways an endpoint fails: DNS resolution, 401/403, 404, and a reachable
 *      URL that does not answer like a Responses endpoint. It also sends the
 *      provider's own `http_headers` / `env_http_headers` / `query_params`, and
 *      every reading carries the explicit billing note (a real request may be
 *      billed).
 *   2. ADVANCED FIELD PASSTHROUGH. `http_headers`, `env_http_headers`,
 *      `query_params`, `request_max_retries`, `stream_max_retries`,
 *      `stream_idle_timeout_ms` and `model_catalog_url` are parsed from the
 *      project settings entry, compiled into the resident `-c` overrides and
 *      the per-run SDK config, and — driven through the REAL bundled
 *      `@openai/codex` 0.166.0 against a local mock — actually reach the wire
 *      as a request header and a query parameter.
 *   3. EFFORT + CONTEXT WINDOW. A Codex catalog entry's effort metadata and its
 *      `model_context_window` / `model_auto_compact_token_limit` are parsed onto
 *      the picker option, and the selected option is the fact source the
 *      runtime compiles into the Codex config (the tier a Claude launch
 *      profile occupies), overriding the provider entry's own default.
 *
 * Everything runs over temp directories and a loopback mock; no operator
 * `~/.codex` file is read and no real upstream endpoint is dialled.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { CodexOptions, Thread, ThreadOptions } from '@openai/codex-sdk';

import {
  CodexProviderModels,
  codexOptionsForProvider,
  codexProviderSpawnArgs,
  codexRuntime,
} from '@/modules/providers/index.js';
import { installCodexProviderRegistryPort } from '@/shared/ports/codex-provider-registry.port.js';
import type { ProviderRuntimeContext } from '@/shared/index.js';

import {
  CODEX_CONNECTION_BILLING_NOTE,
  createCodexModelProvidersSource,
  probeCodexProviderConnection,
  type CodexConnectionProbe,
  type CodexModelProvidersSource,
  type ResolvedCodexModelProvider,
} from '../codex-model-providers.settings.js';
import { runCodexConnectionTest } from '../codex-model-providers.connection.js';

const PROVIDER_ID = 'bob';
const ENV_KEY = 'BOB_API_KEY';
const TOKEN_SECRET = 'token-file-secret-4242';

/** One HTTP request the mock or the real CLI made. */
type SeenRequest = {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

/** A loopback HTTP endpoint that records every request and answers by path. */
async function startMock(options: {
  answer?: (request: SeenRequest) => { status: number; body: string } | null;
} = {}): Promise<{
  requests: SeenRequest[];
  baseUrl: string;
  close(): Promise<void>;
}> {
  const requests: SeenRequest[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const seen: SeenRequest = {
        method: request.method ?? '',
        url: request.url ?? '',
        headers: { ...request.headers },
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(seen);
      const answer = options.answer?.(seen) ?? {
        status: 400,
        body: JSON.stringify({ error: { message: 'mock: advanced capability criterion' } }),
      };
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(answer.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    requests,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

/** Writes a project settings document + its token file and builds the real source. */
async function withSource(
  document: unknown,
  run: (source: CodexModelProvidersSource, directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codex-advanced-'));
  const settingsPath = path.join(directory, 'codex.settings.json');
  const tokenFile = path.join(directory, 'bob.token');
  await writeFile(tokenFile, TOKEN_SECRET, { encoding: 'utf8', mode: 0o600 });
  await writeFile(settingsPath, JSON.stringify(document), 'utf8');
  const source = createCodexModelProvidersSource({ settingsPath, env: {}, homeDir: directory });
  try {
    await run(source, directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

/** The advanced entry every criterion shares, in Codex's snake_case spelling. */
function advancedProviderDocument(baseUrl: string): Record<string, unknown> {
  return {
    modelProviders: {
      [PROVIDER_ID]: {
        name: 'Bob Upstream',
        baseUrl,
        envKey: ENV_KEY,
        tokenFile: 'bob.token',
        http_headers: { 'X-Advanced': 'yes' },
        env_http_headers: { 'X-Tenant': 'TENANT_ENV' },
        query_params: { 'api-version': '2026-01-01', tenant: 'acme' },
        request_max_retries: 1,
        stream_max_retries: 2,
        stream_idle_timeout_ms: 3000,
        model_catalog_url: 'https://catalog.example.test/models.json',
        model_context_window: 123_456,
        model_auto_compact_token_limit: 100_000,
      },
    },
  };
}

/** Resolves the fixture provider or fails the criterion with the readable line. */
function resolvedProvider(source: CodexModelProvidersSource): ResolvedCodexModelProvider {
  const resolution = source.resolve(PROVIDER_ID);
  assert.equal(resolution.ok, true, resolution.ok ? '' : resolution.problem);
  return resolution.provider as ResolvedCodexModelProvider;
}

test('AC-467: the settings schema persists, re-reads and resolves every advanced field', async () => {
  await withSource(advancedProviderDocument('http://127.0.0.1:1/v1'), async (source, directory) => {
    const written = await source.write({
      expectedVersion: source.read().version,
      providers: [
        {
          id: PROVIDER_ID,
          name: 'Bob Upstream',
          baseUrl: 'http://127.0.0.1:1/v1',
          envKey: ENV_KEY,
          tokenFile: path.join(directory, 'bob.token'),
          http_headers: { 'X-Advanced': 'yes' },
          env_http_headers: { 'X-Tenant': 'TENANT_ENV' },
          query_params: { 'api-version': '2026-01-01', tenant: 'acme' },
          request_max_retries: 1,
          stream_max_retries: 2,
          stream_idle_timeout_ms: 3000,
          model_catalog_url: 'https://catalog.example.test/models.json',
          model_context_window: 123_456,
          model_auto_compact_token_limit: 100_000,
        },
      ],
    });

    const provider = written.providers.find((entry) => entry.id === PROVIDER_ID);
    assert.ok(provider, 'the written provider must be read back');
    assert.deepEqual(provider.httpHeaders, { 'X-Advanced': 'yes' });
    assert.deepEqual(provider.envHttpHeaders, { 'X-Tenant': 'TENANT_ENV' });
    assert.deepEqual(provider.queryParams, { 'api-version': '2026-01-01', tenant: 'acme' });
    assert.equal(provider.requestMaxRetries, 1);
    assert.equal(provider.streamMaxRetries, 2);
    assert.equal(provider.streamIdleTimeoutMs, 3000);
    assert.equal(provider.modelCatalogUrl, 'https://catalog.example.test/models.json');
    assert.equal(provider.modelContextWindow, 123_456);
    assert.equal(provider.modelAutoCompactTokenLimit, 100_000);

    // The project file is the write target and keeps the camelCase spelling.
    const document = JSON.parse(
      await readFile(path.join(directory, 'codex.settings.json'), 'utf8'),
    ) as Record<string, unknown>;
    const stored = (document.modelProviders as Record<string, Record<string, unknown>>)[PROVIDER_ID];
    assert.deepEqual(stored.httpHeaders, { 'X-Advanced': 'yes' });
    assert.deepEqual(stored.queryParams, { 'api-version': '2026-01-01', tenant: 'acme' });
    assert.equal(stored.requestMaxRetries, 1);
    assert.equal(stored.modelCatalogUrl, 'https://catalog.example.test/models.json');

    // The spawn-time resolution carries the same fields (and only the secret in memory).
    const resolved = resolvedProvider(source);
    assert.deepEqual(resolved.httpHeaders, { 'X-Advanced': 'yes' });
    assert.deepEqual(resolved.queryParams, { 'api-version': '2026-01-01', tenant: 'acme' });
    assert.equal(resolved.requestMaxRetries, 1);
    assert.equal(resolved.streamIdleTimeoutMs, 3000);
    assert.equal(resolved.modelCatalogUrl, 'https://catalog.example.test/models.json');
    assert.equal(resolved.secret, TOKEN_SECRET);
  });
});

test('AC-467: a bad advanced field is refused on write and warned about on a hand-edited file', async () => {
  await withSource({}, async (source, directory) => {
    const tokenFile = path.join(directory, 'bob.token');
    const base = {
      id: PROVIDER_ID,
      name: 'Bob Upstream',
      baseUrl: 'http://127.0.0.1:1/v1',
      envKey: ENV_KEY,
      tokenFile,
    };
    const cases: Array<{ patch: Record<string, unknown>; message: RegExp }> = [
      { patch: { http_headers: { 'X-Advanced': 42 } }, message: /httpHeaders\.X-Advanced must be a string/ },
      { patch: { env_http_headers: { 'X-Tenant': 'not a variable' } }, message: /must name an environment variable/ },
      { patch: { query_params: [] }, message: /queryParams must be a JSON object/ },
      { patch: { request_max_retries: -1 }, message: /requestMaxRetries must be an integer >= 0/ },
      { patch: { stream_idle_timeout_ms: 0 }, message: /streamIdleTimeoutMs must be an integer >= 1/ },
      { patch: { model_catalog_url: 'not-a-url' }, message: /modelCatalogUrl "not-a-url" is not an absolute URL/ },
      { patch: { model_context_window: 0 }, message: /modelContextWindow must be an integer >= 1/ },
      {
        patch: { httpHeaders: { 'X-A': 'one' }, http_headers: { 'X-A': 'two' } },
        message: /httpHeaders.*http_headers.*disagree/,
      },
    ];
    for (const { patch, message } of cases) {
      await assert.rejects(
        source.write({ expectedVersion: source.read().version, providers: [{ ...base, ...patch }] }),
        message,
      );
      assert.equal(source.read().providers.length, 0, 'a refused write must not persist a provider');
    }

    // A hand-edited file keeps the provider visible; the bad optional field is
    // dropped with a warning instead of hiding a usable endpoint.
    await writeFile(
      path.join(directory, 'codex.settings.json'),
      JSON.stringify({
        modelProviders: {
          [PROVIDER_ID]: {
            baseUrl: 'http://127.0.0.1:1/v1',
            envKey: ENV_KEY,
            tokenFile,
            request_max_retries: -3,
            http_headers: { 'X-Advanced': 'yes' },
          },
        },
      }),
      'utf8',
    );
    const read = source.read();
    const provider = read.providers.find((entry) => entry.id === PROVIDER_ID);
    assert.ok(provider, 'a usable provider must survive one bad optional field');
    assert.equal(provider.requestMaxRetries, undefined);
    assert.deepEqual(provider.httpHeaders, { 'X-Advanced': 'yes' });
    assert.ok(
      provider.warnings.some((warning) => warning.includes('requestMaxRetries')),
      JSON.stringify(provider.warnings),
    );
  });
});

test('AC-467: the connection test tells DNS, 401, 404, non-Responses and a usable endpoint apart', async () => {
  const mock = await startMock({
    answer: (request) => {
      if (request.url.startsWith('/ok/responses')) {
        return { status: 200, body: JSON.stringify({ id: 'resp_mock', object: 'response', output: [] }) };
      }
      if (request.url.startsWith('/unauthorized/responses')) {
        return { status: 401, body: JSON.stringify({ error: { message: 'no key' } }) };
      }
      if (request.url.startsWith('/missing/responses')) {
        return { status: 404, body: JSON.stringify({ error: { message: 'no route' } }) };
      }
      if (request.url.startsWith('/chat/responses')) {
        return { status: 200, body: JSON.stringify({ object: 'chat.completion', choices: [] }) };
      }
      return { status: 500, body: JSON.stringify({ error: { message: 'boom' } }) };
    },
  });

  const providerAt = (suffix: string): ResolvedCodexModelProvider => ({
    id: PROVIDER_ID,
    name: 'Bob Upstream',
    baseUrl: `${mock.baseUrl}${suffix}`,
    envKey: ENV_KEY,
    tokenFile: '/unused/token',
    wireApi: 'responses',
    secret: TOKEN_SECRET,
    httpHeaders: { 'X-Probe': 'on' },
    envHttpHeaders: { 'X-Tenant': 'TENANT_ENV' },
    queryParams: { 'api-version': '2026-01-01' },
  });
  const env = { TENANT_ENV: 'tenant-from-env' };

  try {
    const ok = await probeCodexProviderConnection(providerAt('/ok'), { env });
    assert.equal(ok.outcome, 'ok', ok.detail);
    assert.equal(ok.ok, true);
    assert.equal(ok.status, 200);
    assert.equal(ok.billable, true);
    assert.equal(ok.billingNote, CODEX_CONNECTION_BILLING_NOTE);
    assert.match(ok.billingNote, /may bill/);

    // The probe carries the provider's own advanced connection settings.
    const seen = mock.requests.at(-1);
    assert.ok(seen, 'the mock must have received the probe');
    assert.match(seen.url, /^\/ok\/responses\?api-version=2026-01-01$/);
    assert.equal(seen.headers['x-probe'], 'on');
    assert.equal(seen.headers['x-tenant'], 'tenant-from-env');
    assert.equal(seen.headers.authorization, `Bearer ${TOKEN_SECRET}`);
    assert.match(seen.body, /"max_output_tokens":1/);

    const unauthorized = await probeCodexProviderConnection(providerAt('/unauthorized'), { env });
    assert.equal(unauthorized.outcome, 'unauthorized');
    assert.equal(unauthorized.ok, false);
    assert.equal(unauthorized.status, 401);
    assert.match(unauthorized.detail, /401/);

    const notFound = await probeCodexProviderConnection(providerAt('/missing'), { env });
    assert.equal(notFound.outcome, 'not-found');
    assert.equal(notFound.ok, false);
    assert.equal(notFound.status, 404);
    assert.match(notFound.detail, /base_url/);

    const chat = await probeCodexProviderConnection(providerAt('/chat'), { env });
    assert.equal(chat.outcome, 'not-responses');
    assert.equal(chat.ok, false);
    assert.equal(chat.status, 200);
    assert.match(chat.detail, /Responses-API body/);

    const serverError = await probeCodexProviderConnection(providerAt('/boom'), { env });
    assert.equal(serverError.outcome, 'server-error');
    assert.equal(serverError.ok, false);

    // A name that cannot resolve is DNS, not an unreachable endpoint.
    const dns = await probeCodexProviderConnection(
      { ...providerAt('/v1'), baseUrl: 'http://codex-advanced.invalid/v1' },
      { env, timeoutMs: 5000 },
    );
    assert.equal(dns.outcome, 'dns', dns.detail);
    assert.equal(dns.ok, false);
    assert.match(dns.detail, /could not resolve/);
    assert.equal(dns.billable, true);
  } finally {
    await mock.close();
  }
});

test('AC-467: advanced fields compile into -c and reach the real bundled CLI on the wire', async () => {
  let mock: Awaited<ReturnType<typeof startMock>> | undefined;
  const previousHome = process.env.HOME;
  const previousCodexHome = process.env.CODEX_HOME;
  try {
    const mockHandle = await startMock();
    mock = mockHandle;
    await withSource(advancedProviderDocument(`${mockHandle.baseUrl}/v1`), async (source, directory) => {
      const provider = resolvedProvider(source);

      // ── resident path: the `-c` overrides carry every advanced field ──
      const args = codexProviderSpawnArgs(provider);
      const joined = args.join(' ');
      assert.ok(joined.includes('model_provider="bob"'), joined);
      assert.ok(joined.includes('http_headers = { "X-Advanced" = "yes" }'), joined);
      assert.ok(joined.includes('env_http_headers = { "X-Tenant" = "TENANT_ENV" }'), joined);
      assert.ok(joined.includes('query_params = { "api-version" = "2026-01-01", "tenant" = "acme" }'), joined);
      assert.ok(joined.includes('request_max_retries = 1'), joined);
      assert.ok(joined.includes('stream_max_retries = 2'), joined);
      assert.ok(joined.includes('stream_idle_timeout_ms = 3000'), joined);
      assert.ok(joined.includes('model_catalog_url = "https://catalog.example.test/models.json"'), joined);
      // The two window keys are top-level Codex config, not provider-table members.
      assert.ok(args.includes('model_context_window=123456'), joined);
      assert.ok(args.includes('model_auto_compact_token_limit=100000'), joined);
      assert.ok(!joined.includes(TOKEN_SECRET), 'the secret must never be an argv value');

      // ── per-run path: the same fields in the SDK config ──
      const options = codexOptionsForProvider(provider);
      assert.ok(options.config, 'a bound provider must carry config');
      assert.equal(options.config.model_context_window, 123_456);
      assert.equal(options.config.model_auto_compact_token_limit, 100_000);
      const table = (options.config.model_providers as Record<string, Record<string, unknown>>)[PROVIDER_ID];
      assert.deepEqual(table.http_headers, { 'X-Advanced': 'yes' });
      assert.deepEqual(table.env_http_headers, { 'X-Tenant': 'TENANT_ENV' });
      assert.deepEqual(table.query_params, { 'api-version': '2026-01-01', tenant: 'acme' });
      assert.equal(table.request_max_retries, 1);
      assert.equal(table.stream_max_retries, 2);
      assert.equal(table.stream_idle_timeout_ms, 3000);
      assert.equal(table.model_catalog_url, 'https://catalog.example.test/models.json');

      // ── the real bundled CLI: header and query parameter on the wire ──
      // Keep the CLI's own config/session writes in this criterion's temp home.
      process.env.HOME = directory;
      process.env.CODEX_HOME = directory;
      const codex = new Codex(options);
      const thread = codex.startThread({
        workingDirectory: directory,
        skipGitRepoCheck: true,
        model: 'custom-model',
        sandboxMode: 'read-only',
        approvalPolicy: 'never',
      });
      try {
        const { events } = await thread.runStreamed('ping');
        for await (const _event of events) {
          // Drain until the mock's terminal 400 closes the stream.
        }
      } catch {
        // A 400 is the mock's deliberate terminal answer; the request is the reading.
      }

      assert.ok(mockHandle.requests.length >= 1, 'the real CLI must have called the mock');
      const wire = mockHandle.requests[0];
      assert.equal(wire.url.split('?')[0], '/v1/responses', wire.url);
      assert.match(wire.url, /[?&]api-version=2026-01-01(&|$)/, wire.url);
      assert.match(wire.url, /[?&]tenant=acme(&|$)/, wire.url);
      assert.equal(wire.headers['x-advanced'], 'yes');
      assert.equal(wire.headers.authorization, `Bearer ${TOKEN_SECRET}`);
    });
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousCodexHome;
    if (mock) await mock.close();
  }
});

test('AC-467: a catalog entry effort metadata and windows are the launch fact source', async (t) => {
  const descriptors = [{
    id: 'custom-codex',
    displayName: 'Custom Codex',
    description: 'A custom catalog entry.',
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast responses' },
      { reasoningEffort: 'high', description: 'Deeper reasoning' },
    ],
    modelContextWindow: 258_400,
    modelAutoCompactTokenLimit: 200_000,
  }];
  const adapter = new CodexProviderModels({ listModels: async () => descriptors, now: () => 0 });
  const catalog = await adapter.getSupportedModels();
  const option = catalog.OPTIONS[0];
  assert.equal(catalog.DEFAULT, 'custom-codex');
  assert.equal(option.effort?.default, 'high');
  assert.deepEqual(option.effort?.values, [
    { value: 'low', description: 'Fast responses' },
    { value: 'high', description: 'Deeper reasoning' },
  ]);
  assert.equal(option.contextWindow, 258_400);
  assert.equal(option.autoCompactTokenLimit, 200_000);

  let mock: Awaited<ReturnType<typeof startMock>> | undefined;
  try {
    const mockHandle = await startMock();
    mock = mockHandle;
    await withSource(
      {
        modelProviders: {
          [PROVIDER_ID]: {
            name: 'Bob Upstream',
            baseUrl: `${mockHandle.baseUrl}/v1`,
            envKey: ENV_KEY,
            tokenFile: 'bob.token',
            // The provider entry's default must LOSE to the selected entry.
            model_context_window: 100_000,
            model_auto_compact_token_limit: 50_000,
          },
        },
      },
      async (source) => {
        installCodexProviderRegistryPort({
          read: () => ({
            providers: source.read().providers.map((entry) => ({ id: entry.id })),
            reservedIds: [],
          }),
          resolve: (id) => source.resolve(id),
        });

        let capturedOptions: CodexOptions | undefined;
        let capturedThread: ThreadOptions | undefined;
        const fakeThread = {
          id: 'thread-advanced',
          async runStreamed() {
            return { events: (async function* () {})() };
          },
        } as unknown as Thread;
        t.mock.method(Codex.prototype, 'startThread', function startThread(
          this: Codex,
          options?: ThreadOptions,
        ): Thread {
          capturedOptions = (this as unknown as { options: CodexOptions }).options;
          capturedThread = options;
          return fakeThread;
        });

        const context: ProviderRuntimeContext = {
          resolveProviderSessionId: () => null,
          resolveResumeModel: async () => 'custom-codex',
          getProviderModels: async () => ({
            OPTIONS: [{ ...option, config: { codexProviderId: PROVIDER_ID, env: [] } }],
            DEFAULT: 'custom-codex',
          }),
          normalizeMessage: () => [],
          isProviderInstalled: async () => true,
        };

        await codexRuntime.run('hello advanced', {
          model: 'custom-codex',
          effort: 'high',
          cwd: os.tmpdir(),
          permissionMode: 'read-only',
        }, { isWebSocketWriter: true, send: () => {} }, context);

        assert.ok(capturedOptions, 'the runtime must construct the SDK through startThread');
        // The catalog entry's window wins over the provider entry's default.
        assert.equal(capturedOptions.config?.model_context_window, 258_400);
        assert.equal(capturedOptions.config?.model_auto_compact_token_limit, 200_000);
        // Effort metadata parsed from the entry is what validates the request.
        assert.equal(capturedThread?.modelReasoningEffort, 'high');
        assert.equal(mockHandle.requests.length, 0, 'a captured (fake) thread must not dial the endpoint');
      },
    );
  } finally {
    if (mock) await mock.close();
  }
});

test('the probe action forwards only the saved id and refuses a stray field before any request', async () => {
  const probe: CodexConnectionProbe = {
    outcome: 'ok',
    ok: true,
    url: 'https://bob.example/v1/responses',
    status: 200,
    billable: true,
    billingNote: CODEX_CONNECTION_BILLING_NOTE,
    detail: 'Responses-shaped reply received',
  };
  const seen: string[] = [];
  const port = {
    testConnection: async (id: string): Promise<CodexConnectionProbe> => {
      seen.push(id);
      return probe;
    },
  };

  // The browser sends the id only; the answer is the probe's own reading.
  assert.deepEqual(await runCodexConnectionTest(port, { body: { id: ' bob ' } }), probe);
  assert.deepEqual(seen, ['bob']);

  // A stray field (a browser trying to smuggle a secret) is refused, never forwarded.
  await assert.rejects(
    () => runCodexConnectionTest(port, { body: { id: 'bob', token: 'sk-leak' } }),
    /unknown field/,
  );
  await assert.rejects(
    () => runCodexConnectionTest(port, { body: { id: '   ' } }),
    /id must name the saved Codex provider/,
  );
  await assert.rejects(
    () => runCodexConnectionTest({}, { body: { id: 'bob' } }),
    /not configured/,
  );
  assert.deepEqual(seen, ['bob'], 'a refused request never reaches the probe seam');
});
