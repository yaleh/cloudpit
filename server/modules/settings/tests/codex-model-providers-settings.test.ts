/**
 * `/api/settings/codex/model-providers` criterion (AC-460).
 *
 * The project-owned Codex upstream provider registry is the one place a project states where its
 * Codex sessions should connect. What this criterion pins:
 *
 *   - a write is VALIDATED: Codex's built-in ids are reserved, `wire_api` must be `responses`,
 *     `baseUrl` must be absolute, and an unknown field (`api`) is a warning the caller can see
 *     instead of a field that silently did nothing;
 *   - the SECRET is write-only: a `token` accepted by PUT lands in its own 0600 file, GET reports
 *     only `tokenSet`, and the value appears in neither response;
 *   - the FILES are 0600, including when the settings file already existed wider;
 *   - a second editor is a conflict, not an overwrite: a stale `expectedVersion` is a readable
 *     409 and leaves the file byte-identical;
 *   - the SPAWN-TIME lookup (`resolve`) re-reads the file, returns the secret in memory, and
 *     never falls back to Codex's `openai` when a provider or its token file is missing.
 *
 * Everything is driven through the production router + the production service + the real file
 * layer over a temp directory; only the unrelated Settings dependencies are stubs.
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express, {
  type NextFunction,
  type Request as ExpressRequest,
  type Response as ExpressResponse,
} from 'express';

import type { CodexModelProvidersReading } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import {
  createCodexModelProvidersSource,
  type CodexModelProvidersSource,
} from '../codex-model-providers.settings.js';
import { createSettingsRouter } from '../settings.routes.js';
import { createSettingsService } from '../settings.service.js';

type Reply = {
  status: number;
  body: Record<string, unknown>;
  text: string;
  etag: string | null;
};

type Harness = {
  settingsPath: string;
  /** The token file the default (`tokenFile` omitted) layout would use. */
  defaultTokenPath: (providerId: string) => string;
  source: CodexModelProvidersSource;
  get(): Promise<Reply>;
  put(body: unknown, headers?: Record<string, string>): Promise<Reply>;
  writeDocument(document: unknown, mode?: number): void;
  fileText(): string;
  fileMode(): number;
};

function provider(overrides: Record<string, unknown> = {}, tokenFile: string): Record<string, unknown> {
  return {
    id: 'bob',
    name: 'Bob',
    baseUrl: 'http://127.0.0.1:9711/v1',
    envKey: 'BOB_API_KEY',
    tokenFile,
    ...overrides,
  };
}

function registry(
  reading: CodexModelProvidersReading,
  id: string,
): CodexModelProvidersReading['providers'][number] {
  const found = reading.providers.find((entry) => entry.id === id);
  assert.ok(found, `provider ${id} must be present in ${JSON.stringify(reading.providers)}`);
  return found;
}

/** Serves the production settings router over a temp Codex settings file. */
async function withHarness(run: (harness: Harness) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'codex-providers-'));
  const settingsPath = path.join(directory, 'codex.settings.json');
  const source = createCodexModelProvidersSource({ settingsPath, env: {}, homeDir: directory });

  const service = createSettingsService({
    credentials: { list: () => [], create: () => ({}), remove: () => false, toggle: () => false },
    notifications: {
      getPreferences: () => undefined,
      updatePreferences: () => ({}),
      createEnabledEvent: () => ({}),
      notifyUser: () => undefined,
    },
    pushSubscriptions: { save: () => undefined, remove: () => undefined },
    getVapidPublicKey: () => null,
    accessTokens: {
      list: () => [],
      findById: () => undefined,
      issue: () => ({ ok: false, reason: 'unused' }),
      revoke: () => false,
    },
    codexModelProviders: {
      read: () => source.read(),
      write: (input) => source.write(input),
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/settings', createSettingsRouter(service));
  app.use((error: unknown, _req: ExpressRequest, res: ExpressResponse, _next: NextFunction) => {
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const request = async (
    method: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> => {
    const response = await fetch(`${baseUrl}/api/settings/codex/model-providers`, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { parsed = {}; }
    return { status: response.status, body: parsed, text, etag: response.headers.get('etag') };
  };

  const harness: Harness = {
    settingsPath,
    defaultTokenPath: (providerId) => path.join(directory, 'codex.secrets', `${providerId}.token`),
    source,
    get: () => request('GET'),
    put: (body, headers) => request('PUT', body, headers),
    writeDocument: (document, mode = 0o600) => {
      writeFileSync(settingsPath, `${JSON.stringify(document, null, 2)}\n`, { mode });
    },
    fileText: () => readFileSync(settingsPath, 'utf8'),
    fileMode: () => statSync(settingsPath).mode & 0o777,
  };

  try {
    await run(harness);
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(directory, { recursive: true, force: true });
  }
}

const errorBody = (reply: Reply): { code?: string; message?: string } =>
  (reply.body.error ?? {}) as { code?: string; message?: string };

test('AC-460 GET on a missing file is the empty registry, not an error', async () => {
  await withHarness(async (harness) => {
    const reply = await harness.get();
    assert.equal(reply.status, 200);
    assert.equal(reply.body.version, 'missing');
    assert.equal(reply.body.path, harness.settingsPath);
    assert.deepEqual(reply.body.providers, []);
    assert.deepEqual(reply.body.warnings, []);
  });
});

test('AC-460 PUT writes the registry as 0600, preserves other keys, and reports only tokenSet', async () => {
  await withHarness(async (harness) => {
    // Pre-existing file, deliberately wider than 600 and with an unrelated key.
    harness.writeDocument({ _comment: 'keep me' }, 0o644);
    const before = await harness.get();
    const tokenFile = path.join(path.dirname(harness.settingsPath), 'bob.token');

    const reply = await harness.put({
      expectedVersion: before.body.version,
      providers: [provider({}, tokenFile)],
    });
    assert.equal(reply.status, 200, reply.text);
    assert.equal(reply.etag, `"${reply.body.version}"`);

    const reading = reply.body as unknown as CodexModelProvidersReading;
    const bob = registry(reading, 'bob');
    assert.equal(bob.baseUrl, 'http://127.0.0.1:9711/v1');
    assert.equal(bob.wireApi, 'responses');
    assert.equal(bob.tokenSet, false);
    assert.ok(bob.warnings.some((warning) => warning.includes('is missing')), JSON.stringify(bob.warnings));
    assert.ok(!('token' in bob), 'the reading must never carry a token field');

    // The project file is 0600, keeps the unrelated key, and never stores the secret field.
    assert.equal(harness.fileMode(), 0o600);
    const document = JSON.parse(harness.fileText()) as Record<string, unknown>;
    assert.equal(document._comment, 'keep me');
    assert.ok(document.modelProviders, 'the registry must be persisted');
    assert.ok(!harness.fileText().includes('"token"'), 'the secret field must not be persisted');

    // A later GET reports the same value and tokenSet.
    const reread = (await harness.get()).body as unknown as CodexModelProvidersReading;
    assert.equal(reread.version, reading.version);
    assert.equal(registry(reread, 'bob').tokenSet, false);
  });
});

test('AC-460 PUT refuses reserved ids, Chat Completions, and an empty baseUrl', async () => {
  await withHarness(async (harness) => {
    const version = (await harness.get()).body.version;

    const cases: Array<{ providers: unknown[]; code: string }> = [
      { providers: [provider({ id: 'openai' }, '/tmp/x.token')], code: 'CODEX_PROVIDER_ID_RESERVED' },
      { providers: [provider({ id: 'OLLAMA' }, '/tmp/x.token')], code: 'CODEX_PROVIDER_ID_RESERVED' },
      { providers: [provider({ id: 'lmstudio' }, '/tmp/x.token')], code: 'CODEX_PROVIDER_ID_RESERVED' },
      { providers: [provider({ wire_api: 'chat' }, '/tmp/x.token')], code: 'CODEX_PROVIDER_WIRE_API_UNSUPPORTED' },
      { providers: [provider({ baseUrl: '' }, '/tmp/x.token')], code: 'CODEX_PROVIDER_BASE_URL_REQUIRED' },
      { providers: [provider({ baseUrl: 'not-a-url' }, '/tmp/x.token')], code: 'CODEX_PROVIDER_BASE_URL_INVALID' },
    ];
    for (const { providers, code } of cases) {
      const reply = await harness.put({ expectedVersion: version, providers });
      assert.equal(reply.status, 400, `${code}: ${reply.text}`);
      assert.equal(errorBody(reply).code, code);
      assert.match(errorBody(reply).message ?? '', /provider/);
    }

    // The refused writes left no file and no version behind.
    assert.equal((await harness.get()).body.version, 'missing');
  });
});

test('AC-460 an unknown field is a visible warning, on write and on a hand-edited file', async () => {
  await withHarness(async (harness) => {
    const tokenFile = path.join(path.dirname(harness.settingsPath), 'bob.token');
    const version = (await harness.get()).body.version;
    const written = await harness.put({
      expectedVersion: version,
      providers: [provider({ api: 'chat' }, tokenFile)],
    });
    assert.equal(written.status, 200, written.text);
    const bob = registry(written.body as unknown as CodexModelProvidersReading, 'bob');
    assert.ok(bob.warnings.some((warning) => warning.includes('`api`')), JSON.stringify(bob.warnings));
    assert.ok(!harness.fileText().includes('"api"'), 'the unknown field must not be persisted');

    // The same field written by hand is reported by the READ path too.
    harness.writeDocument({
      modelProviders: {
        bob: {
          baseUrl: 'http://127.0.0.1:9711/v1',
          envKey: 'BOB_API_KEY',
          tokenFile,
          api: 'chat',
        },
      },
    });
    const read = (await harness.get()).body as unknown as CodexModelProvidersReading;
    assert.ok(
      registry(read, 'bob').warnings.some((warning) => warning.includes('`api`')),
      JSON.stringify(registry(read, 'bob').warnings),
    );
  });
});

test('AC-460 a stale expectedVersion is a readable conflict and leaves the file untouched', async () => {
  await withHarness(async (harness) => {
    const tokenFile = path.join(path.dirname(harness.settingsPath), 'bob.token');
    const first = await harness.put({
      expectedVersion: (await harness.get()).body.version,
      providers: [provider({}, tokenFile)],
    });
    assert.equal(first.status, 200, first.text);
    const staleVersion = first.body.version as string;
    const afterFirst = harness.fileText();

    const second = await harness.put({
      expectedVersion: staleVersion,
      providers: [provider({ name: 'Bob Two' }, tokenFile)],
    });
    assert.equal(second.status, 200, second.text);
    const afterSecond = harness.fileText();

    const conflict = await harness.put({
      expectedVersion: staleVersion,
      providers: [provider({ name: 'Bob Three' }, tokenFile)],
    });
    assert.equal(conflict.status, 409, conflict.text);
    assert.equal(errorBody(conflict).code, 'VERSION_CONFLICT');
    assert.match(errorBody(conflict).message ?? '', /reload/);
    assert.equal(harness.fileText(), afterSecond, 'a conflict must not overwrite the file');
    assert.notEqual(afterSecond, afterFirst);
  });
});

test('AC-460 a save without a usable expectedVersion is refused before it touches the file', async () => {
  await withHarness(async (harness) => {
    const tokenFile = path.join(path.dirname(harness.settingsPath), 'bob.token');
    const providers = [provider({}, tokenFile)];

    const missing = await harness.put({ providers });
    assert.equal(missing.status, 400, missing.text);
    assert.equal(errorBody(missing).code, 'VERSION_REQUIRED');

    const nonString = await harness.put({ expectedVersion: 42, providers });
    assert.equal(nonString.status, 400, nonString.text);
    assert.equal(errorBody(nonString).code, 'INVALID_VERSION');

    // Neither refusal wrote a registry: the same version proof is still required.
    assert.equal((await harness.get()).body.version, 'missing');
  });
});

test('AC-460 If-Match is accepted as the version a save was based on', async () => {
  await withHarness(async (harness) => {
    const version = (await harness.get()).body.version as string;
    const tokenFile = path.join(path.dirname(harness.settingsPath), 'bob.token');
    const reply = await harness.put(
      { providers: [provider({}, tokenFile)] },
      { 'if-match': `W/"${version}"` },
    );
    assert.equal(reply.status, 200, reply.text);
    assert.equal(harness.fileMode(), 0o600);
  });
});

test('AC-460 a write-only token lands in a 0600 file and is never echoed', async () => {
  await withHarness(async (harness) => {
    const tokenFile = path.join(path.dirname(harness.settingsPath), 'bob.token');
    const secret = 'sk-super-secret-value';
    const reply = await harness.put({
      expectedVersion: (await harness.get()).body.version,
      providers: [provider({ token: secret }, tokenFile)],
    });
    assert.equal(reply.status, 200, reply.text);
    assert.ok(!reply.text.includes(secret), 'the PUT response must not echo the secret');
    assert.ok(!harness.fileText().includes(secret), 'the project file must not hold the secret');
    assert.ok(!harness.fileText().includes('"token"'), 'the project file must not hold a token field');
    assert.equal(readFileSync(tokenFile, 'utf8'), secret);
    assert.equal(statSync(tokenFile).mode & 0o777, 0o600);

    const bob = registry(reply.body as unknown as CodexModelProvidersReading, 'bob');
    assert.equal(bob.tokenSet, true);
    assert.ok(!JSON.stringify(bob).includes(secret));

    const read = await harness.get();
    assert.ok(!read.text.includes(secret), 'GET must not echo the secret');
    assert.equal(registry(read.body as unknown as CodexModelProvidersReading, 'bob').tokenSet, true);
  });
});

test('AC-460 spawn-time resolve reads the secret and never falls back', async () => {
  await withHarness(async (harness) => {
    const tokenFile = path.join(path.dirname(harness.settingsPath), 'bob.token');
    const put = await harness.put({
      expectedVersion: (await harness.get()).body.version,
      providers: [provider({}, tokenFile)],
    });
    assert.equal(put.status, 200, put.text);

    // Missing secret: a readable problem, not an openai fallback.
    const missing = harness.source.resolve('bob');
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.match(missing.problem, /no usable secret/);
      assert.match(missing.problem, /is missing/);
    }
    // Unknown id: names the id and the file.
    const unknown = harness.source.resolve('nobody');
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.match(unknown.problem, /"nobody" is not configured/);

    writeFileSync(tokenFile, 'sk-live-secret\n', { mode: 0o600 });
    const resolved = harness.source.resolve('bob');
    assert.equal(resolved.ok, true);
    if (resolved.ok) {
      assert.equal(resolved.provider.id, 'bob');
      assert.equal(resolved.provider.baseUrl, 'http://127.0.0.1:9711/v1');
      assert.equal(resolved.provider.envKey, 'BOB_API_KEY');
      assert.equal(resolved.provider.secret, 'sk-live-secret');
    }
  });
});

test('AC-460 a reserved or malformed entry in the file is skipped with a document warning', async () => {
  await withHarness(async (harness) => {
    const tokenFile = path.join(path.dirname(harness.settingsPath), 'bob.token');
    harness.writeDocument({
      modelProviders: {
        openai: { baseUrl: 'http://127.0.0.1:9711/v1', tokenFile },
        bob: { baseUrl: 'http://127.0.0.1:9711/v1', tokenFile },
      },
    });

    const read = (await harness.get()).body as unknown as CodexModelProvidersReading;
    assert.deepEqual(read.providers.map((entry) => entry.id), ['bob']);
    assert.ok(
      read.warnings.some((warning) => warning.includes('reserved')),
      JSON.stringify(read.warnings),
    );
  });
});
