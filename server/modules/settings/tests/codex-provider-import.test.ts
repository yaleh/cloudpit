/**
 * Read-only import of the operator's own Codex providers (AC-466).
 *
 * The project settings file is the one writable surface for Codex upstream providers. The
 * operator's `~/.codex` TOML files are compatibility input only: this criterion pins that the
 * import (a) LISTS every `[model_providers.<id>]` block with `name` / `base_url` / `env_key` /
 * `wire_api`, (b) never reads a secret — no `env_key` VALUE, no token file, no `auth.json` —
 * (c) never writes back to the user's files or creates a project settings file as a side
 * effect, and (d) reports unknown fields (Codex's own `api`) as warnings on the import view.
 *
 * Every fixture lives in a temp Codex home injected through `homeDir`/`env`, so this criterion
 * never reads the host's real `~/.codex` (the task's DoD run against the real profile is a
 * separate, read-only command whose output is recorded on the task, not an assertion here).
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  readCodexUserProviderImports,
  type CodexUserProviderImportReading,
} from '../codex-model-providers.settings.js';
import { createSettingsRouter } from '../settings.routes.js';
import { createSettingsService } from '../settings.service.js';

const BOB_CONFIG = `
model = "gpt-5.6-sol"

[model_providers.bob]
name = "BOB API"
base_url = "https://bob-api.com/v1"
env_key = "BOB_API_KEY"
api = "openai-responses"
`;

type TempHome = {
  home: string;
  codexDir: string;
  write(name: string, text: string): void;
  /** Every file under the temp home, name -> bytes, used for the no-write-back check. */
  snapshot(): Record<string, string>;
};

function withCodexHome(
  files: Record<string, string>,
  run: (fixture: TempHome) => void,
): void {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-user-import-'));
  const codexDir = path.join(home, '.codex');
  mkdirSync(codexDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(codexDir, name), text);
  }
  const fixture: TempHome = {
    home,
    codexDir,
    write: (name, text) => writeFileSync(path.join(codexDir, name), text),
    snapshot: () => {
      const result: Record<string, string> = {};
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else result[path.relative(home, full)] = readFileSync(full, 'utf8');
        }
      };
      walk(home);
      return result;
    },
  };
  try {
    run(fixture);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function provider(reading: CodexUserProviderImportReading, id: string) {
  const found = reading.providers.find((entry) => entry.id === id);
  assert.ok(found, `provider ${id} must be in the import view: ${JSON.stringify(reading.providers)}`);
  return found;
}

test('AC-466 a user config.toml provider is listed with name/base_url/env_key/wire_api', () => {
  withCodexHome({ 'config.toml': BOB_CONFIG }, ({ home, codexDir }) => {
    const reading = readCodexUserProviderImports({ homeDir: home, env: {} });

    assert.equal(reading.directory, codexDir);
    assert.deepEqual(reading.files, [path.join(codexDir, 'config.toml')]);
    assert.deepEqual(reading.warnings, []);

    const bob = provider(reading, 'bob');
    assert.equal(bob.name, 'BOB API');
    assert.equal(bob.baseUrl, 'https://bob-api.com/v1');
    assert.equal(bob.envKey, 'BOB_API_KEY');
    // The block omits wire_api; this project imports with its one supported dialect.
    assert.equal(bob.wireApi, 'responses');
    assert.equal(bob.source, path.join(codexDir, 'config.toml'));
    assert.equal(bob.bindable, true);

    // The id is directly usable as a model entry's codexProviderId.
    assert.deepEqual(
      reading.providers.filter((entry) => entry.bindable).map((entry) => entry.id),
      ['bob'],
    );
  });
});

test('AC-466 <name>.config.toml is scanned too, and its source is named', () => {
  withCodexHome(
    {
      'config.toml': BOB_CONFIG,
      'work.config.toml': `
model = "gpt-5.6-sol"

[model_providers.alice]
name = "Alice"
base_url = "https://alice.example/v1"
env_key = "ALICE_API_KEY"
wire_api = "responses"
`,
    },
    ({ home, codexDir }) => {
      const reading = readCodexUserProviderImports({ homeDir: home, env: {} });
      assert.equal(reading.files.length, 2);
      assert.deepEqual(provider(reading, 'alice').source, path.join(codexDir, 'work.config.toml'));
      assert.equal(provider(reading, 'alice').bindable, true);
    },
  );
});

test('AC-466 the env_key VALUE is never read into the import view', () => {
  withCodexHome(
    {
      'config.toml': BOB_CONFIG,
      // A credential file that sits beside config.toml: the import must not open it.
      'auth.json': JSON.stringify({ api_key: 'sk-codex-auth-sentinel' }),
    },
    ({ home, codexDir }) => {
      const sentinel = 'sk-env-key-sentinel-must-not-leak';
      const reading = readCodexUserProviderImports({
        homeDir: home,
        env: { CODEX_HOME: codexDir, BOB_API_KEY: sentinel },
      });

      // Only the variable NAME is surfaced; the value appears in no field of the view.
      assert.equal(provider(reading, 'bob').envKey, 'BOB_API_KEY');
      const serialized = JSON.stringify(reading);
      assert.ok(!serialized.includes(sentinel), 'the env_key value must never enter the reading');
      assert.ok(!serialized.includes('sk-codex-auth-sentinel'), 'auth.json must never be read');
      assert.ok(!('token' in provider(reading, 'bob')), 'the import row carries no token field');
      // auth.json is not a TOML config file, so it is not even opened as one.
      assert.deepEqual(reading.files, [path.join(codexDir, 'config.toml')]);
    },
  );
});

test('AC-466 importing never writes to the user files and creates no project file', () => {
  withCodexHome({ 'config.toml': BOB_CONFIG }, ({ home, snapshot }) => {
    const before = snapshot();
    readCodexUserProviderImports({ homeDir: home, env: {} });
    assert.deepEqual(snapshot(), before, 'the import must leave every user file byte-identical');
    // The project settings file is the only write target elsewhere; this read must not create one.
    assert.ok(!readdirSync(home).includes('.config'), 'no project settings directory is created');
  });
});

test('AC-466 an unknown field (api) is a visible import warning, not a silent drop', () => {
  withCodexHome({ 'config.toml': BOB_CONFIG }, ({ home }) => {
    const reading = readCodexUserProviderImports({ homeDir: home, env: {} });
    const bob = provider(reading, 'bob');
    assert.ok(
      bob.warnings.some((warning) => warning.includes('`api`')),
      `the unknown field must be reported: ${JSON.stringify(bob.warnings)}`,
    );
    // An unknown field does not make the provider unbindable: this project simply ignores it.
    assert.equal(bob.bindable, true);
  });
});

test('AC-466 a provider without unknown fields carries no unknown-field warning', () => {
  withCodexHome(
    {
      'config.toml': `
[model_providers.clean]
name = "Clean"
base_url = "https://clean.example/v1"
env_key = "CLEAN_API_KEY"
wire_api = "responses"
`,
    },
    ({ home }) => {
      const reading = readCodexUserProviderImports({ homeDir: home, env: {} });
      assert.deepEqual(provider(reading, 'clean').warnings, []);
    },
  );
});

test('AC-466 a declared non-responses wire_api is listed but not bindable', () => {
  withCodexHome(
    {
      'config.toml': `
[model_providers.chatty]
name = "Chatty"
base_url = "https://chatty.example/v1"
env_key = "CHATTY_API_KEY"
wire_api = "chat"
`,
    },
    ({ home }) => {
      const reading = readCodexUserProviderImports({ homeDir: home, env: {} });
      const chatty = provider(reading, 'chatty');
      assert.equal(chatty.bindable, false);
      assert.ok(
        chatty.warnings.some((warning) => warning.includes('responses')),
        JSON.stringify(chatty.warnings),
      );
    },
  );
});

test('AC-466 a reserved id is listed but cannot be imported over Codex built-ins', () => {
  withCodexHome(
    {
      'config.toml': `
[model_providers.openai]
name = "Shadow"
base_url = "https://shadow.example/v1"
env_key = "SHADOW_API_KEY"
`,
    },
    ({ home }) => {
      const reading = readCodexUserProviderImports({ homeDir: home, env: {} });
      const openai = provider(reading, 'openai');
      assert.equal(openai.bindable, false);
      assert.ok(
        openai.warnings.some((warning) => warning.includes('reserved')),
        JSON.stringify(openai.warnings),
      );
    },
  );
});

test('AC-466 a missing ~/.codex is an empty import view, not an error', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-user-import-empty-'));
  try {
    const reading = readCodexUserProviderImports({ homeDir: home, env: {} });
    assert.deepEqual(reading.providers, []);
    assert.deepEqual(reading.files, []);
    assert.deepEqual(reading.warnings, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('AC-466 a malformed profile file is warned about while the valid file still imports', () => {
  withCodexHome(
    {
      'config.toml': BOB_CONFIG,
      'broken.config.toml': '[model_providers\nname = "unterminated"',
    },
    ({ home }) => {
      const reading = readCodexUserProviderImports({ homeDir: home, env: {} });
      assert.equal(provider(reading, 'bob').bindable, true);
      assert.ok(
        reading.warnings.some((warning) => warning.includes('broken.config.toml') && warning.includes('TOML')),
        JSON.stringify(reading.warnings),
      );
    },
  );
});

// ---------------------------------------------------------------------------------------------
// The PRODUCT half of AC-466: the import surface is reachable over HTTP, a bind writes the
// PROJECT settings file (never the user's `~/.codex`), and an unbindable row is refused whole.
//
// The harness is the production router + production service + the real file layer, served on a
// loopback port. Only the unrelated Settings dependencies are stubs. The user profile is a temp
// HOME with a real `.codex/`, so the "no write-back" assertion compares real bytes.
// ---------------------------------------------------------------------------------------------

type Reply = {
  status: number;
  body: Record<string, unknown>;
  text: string;
};

type ImportHarness = {
  home: string;
  codexDir: string;
  settingsPath: string;
  settingsDir: string;
  getImport(): Promise<Reply>;
  getRegistry(): Promise<Reply>;
  postImport(body: unknown, headers?: Record<string, string>): Promise<Reply>;
  /** The project settings file's exact bytes, or null while it does not exist. */
  fileText(): string | null;
  /** Every file under the temp user home, name -> bytes. */
  snapshot(): Record<string, string>;
};

/** Walks the user home so a post-import comparison is byte-for-byte, not "same file names". */
function snapshotHome(home: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else result[path.relative(home, full)] = readFileSync(full, 'utf8');
    }
  };
  walk(home);
  return result;
}

/**
 * Serves the production settings router over a temp project file and a temp user Codex home.
 *
 * `options.env` is handed to the import reader as the environment an import could consult; the
 * sentinel case uses it to prove an `env_key` VALUE never enters the reading.
 */
async function withImportHarness(
  files: Record<string, string>,
  run: (harness: ImportHarness) => Promise<void>,
  options: {
    settings?: unknown;
    env?: Record<string, string>;
    projectToken?: string;
  } = {},
): Promise<void> {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-import-http-'));
  const codexDir = path.join(home, '.codex');
  mkdirSync(codexDir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(path.join(codexDir, name), text);
  }

  const settingsDir = mkdtempSync(path.join(os.tmpdir(), 'codex-import-project-'));
  const settingsPath = path.join(settingsDir, 'codex.settings.json');
  if (options.settings !== undefined) {
    writeFileSync(settingsPath, `${JSON.stringify(options.settings, null, 2)}\n`, { mode: 0o600 });
  }
  if (options.projectToken !== undefined) {
    mkdirSync(path.join(settingsDir, 'codex.secrets'), { recursive: true });
    writeFileSync(path.join(settingsDir, 'codex.secrets', 'bob.token'), options.projectToken, { mode: 0o600 });
  }

  const source = createCodexModelProvidersSource({ settingsPath, env: {}, homeDir: settingsDir });
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
      readUserImports: () => readCodexUserProviderImports({ homeDir: home, env: options.env ?? {} }),
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
    route: string,
    method: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> => {
    const response = await fetch(`${baseUrl}/api/settings${route}`, {
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
    return { status: response.status, body: parsed, text };
  };

  const harness: ImportHarness = {
    home,
    codexDir,
    settingsPath,
    settingsDir,
    getImport: () => request('/codex/model-providers/import', 'GET'),
    getRegistry: () => request('/codex/model-providers', 'GET'),
    postImport: (body, headers) => request('/codex/model-providers/import', 'POST', body, headers),
    fileText: () => {
      try { return readFileSync(settingsPath, 'utf8'); } catch { return null; }
    },
    snapshot: () => snapshotHome(home),
  };

  try {
    await run(harness);
  } finally {
    server.close();
    await once(server, 'close');
    rmSync(home, { recursive: true, force: true });
    rmSync(settingsDir, { recursive: true, force: true });
  }
}

/** A two-provider user profile: `bob` (no wire_api) and a profile-file provider. */
const TWO_PROVIDER_PROFILE = {
  'config.toml': BOB_CONFIG,
  'bob-gpt.config.toml': `
[model_providers.bob-gpt]
name = "Bob GPT"
base_url = "https://bob-gpt.example/v1"
env_key = "BOB_GPT_API_KEY"
wire_api = "responses"
`,
};

/** A profile holding rows this project must list but refuse to bind. */
const UNBINDABLE_PROFILE = {
  'config.toml': `
[model_providers.openai]
name = "Shadow"
base_url = "https://shadow.example/v1"
env_key = "SHADOW_API_KEY"

[model_providers.chatty]
name = "Chatty"
base_url = "https://chatty.example/v1"
env_key = "CHATTY_API_KEY"
wire_api = "chat"
`,
};

const importReading = (reply: Reply): CodexUserProviderImportReading =>
  reply.body as unknown as CodexUserProviderImportReading;

const registryReading = (reply: Reply): CodexModelProvidersReading =>
  reply.body as unknown as CodexModelProvidersReading;

test('AC-466 GET /codex/model-providers/import is the reachable read-only reading', async () => {
  await withImportHarness(TWO_PROVIDER_PROFILE, async (harness) => {
    const reply = await harness.getImport();
    assert.equal(reply.status, 200, reply.text);

    const reading = importReading(reply);
    assert.equal(reading.directory, harness.codexDir);
    assert.deepEqual(reading.files, [
      path.join(harness.codexDir, 'config.toml'),
      path.join(harness.codexDir, 'bob-gpt.config.toml'),
    ]);
    assert.deepEqual(reading.providers.map((entry) => entry.id), ['bob', 'bob-gpt']);

    const bob = reading.providers[0]!;
    // Every field the panel draws, including the dialect default for a block that omits it.
    assert.equal(bob.name, 'BOB API');
    assert.equal(bob.baseUrl, 'https://bob-api.com/v1');
    assert.equal(bob.envKey, 'BOB_API_KEY');
    assert.equal(bob.wireApi, 'responses');
    assert.equal(bob.source, path.join(harness.codexDir, 'config.toml'));
    assert.equal(bob.bindable, true);
    assert.ok(Array.isArray(bob.warnings));

    const bobGpt = reading.providers[1]!;
    assert.equal(bobGpt.name, 'Bob GPT');
    assert.equal(bobGpt.baseUrl, 'https://bob-gpt.example/v1');
    assert.equal(bobGpt.envKey, 'BOB_GPT_API_KEY');
    assert.equal(bobGpt.wireApi, 'responses');
    assert.equal(bobGpt.source, path.join(harness.codexDir, 'bob-gpt.config.toml'));
    assert.equal(bobGpt.bindable, true);
  });
});

test('AC-466 POST /import writes the project file and leaves every user file byte-identical', async () => {
  await withImportHarness(TWO_PROVIDER_PROFILE, async (harness) => {
    const before = harness.snapshot();
    assert.equal(harness.fileText(), null, 'the project file starts absent');

    const reply = await harness.postImport({ ids: ['bob'], expectedVersion: 'missing' });
    assert.equal(reply.status, 200, reply.text);

    // (a) the PROJECT file is the write target and carries the imported row.
    const document = JSON.parse(harness.fileText() ?? '{}') as {
      modelProviders?: Record<string, { name?: string; baseUrl?: string; envKey?: string }>;
    };
    assert.equal(document.modelProviders?.bob?.name, 'BOB API');
    assert.equal(document.modelProviders?.bob?.baseUrl, 'https://bob-api.com/v1');
    assert.equal(document.modelProviders?.bob?.envKey, 'BOB_API_KEY');

    // (b) the operator's own Codex home did not move a byte.
    assert.deepEqual(harness.snapshot(), before, 'the import must never write back to ~/.codex');

    // The answer is the project registry, not the user reading; the secret is never carried.
    const reading = registryReading(reply);
    assert.equal(reading.path, harness.settingsPath);
    assert.deepEqual(reading.providers.map((entry) => entry.id), ['bob']);
    assert.equal(reading.providers[0]!.tokenSet, false);
    assert.ok(!('token' in reading.providers[0]!));
  });
});

test('AC-466 a reserved id or a Chat Completions row is refused by name without a partial write', async () => {
  const settings = {
    modelProviders: {
      keep: {
        name: 'Keep',
        baseUrl: 'https://keep.example/v1',
        envKey: 'KEEP_API_KEY',
      },
    },
  };
  await withImportHarness(UNBINDABLE_PROFILE, async (harness) => {
    const version = (await harness.getRegistry()).body.version;
    assert.equal(typeof version, 'string');

    const importReadingReply = await harness.getImport();
    assert.equal(importReadingReply.status, 200, importReadingReply.text);
    assert.deepEqual(
      importReading(importReadingReply).providers.map((entry) => [entry.id, entry.bindable]),
      [['openai', false], ['chatty', false]],
      'both rows are visible, and both declare themselves unbindable',
    );

    const before = harness.fileText();
    assert.ok(before !== null);
    const reserved = await harness.postImport({ ids: ['openai'], expectedVersion: version });
    assert.equal(reserved.status, 400, reserved.text);
    assert.equal((reserved.body.error as { code?: string })?.code, 'CODEX_IMPORT_PROVIDER_NOT_BINDABLE');
    assert.match(String((reserved.body.error as { message?: string })?.message), /openai/);
    assert.match(String((reserved.body.error as { message?: string })?.message), /reserved/);
    assert.equal(harness.fileText(), before, 'a refused import must not write anything');

    const chatty = await harness.postImport({ ids: ['chatty'], expectedVersion: version });
    assert.equal(chatty.status, 400, chatty.text);
    assert.match(String((chatty.body.error as { message?: string })?.message), /chatty/);
    assert.match(String((chatty.body.error as { message?: string })?.message), /responses/);
    assert.equal(harness.fileText(), before, 'a refused import must not write anything');
  }, { settings });
});

test('AC-466 env_key VALUES and token sentinels never reach the import response or project file', async () => {
  const envSentinel = 'sk-env-value-sentinel-must-not-leak';
  const authSentinel = 'sk-auth-json-sentinel-must-not-leak';
  const tokenSentinel = 'sk-project-token-sentinel-must-not-leak';
  await withImportHarness(
    {
      'config.toml': BOB_CONFIG,
      'auth.json': JSON.stringify({ api_key: authSentinel }),
    },
    async (harness) => {
      const importReply = await harness.getImport();
      assert.equal(importReply.status, 200, importReply.text);
      for (const sentinel of [envSentinel, authSentinel, tokenSentinel]) {
        assert.ok(!importReply.text.includes(sentinel), `the import reading leaked ${sentinel}`);
      }

      const reply = await harness.postImport({ ids: ['bob'], expectedVersion: 'missing' });
      assert.equal(reply.status, 200, reply.text);
      for (const sentinel of [envSentinel, authSentinel, tokenSentinel]) {
        assert.ok(!reply.text.includes(sentinel), `the bind response leaked ${sentinel}`);
      }

      const project = harness.fileText() ?? '';
      for (const sentinel of [envSentinel, authSentinel, tokenSentinel]) {
        assert.ok(!project.includes(sentinel), `the project settings file leaked ${sentinel}`);
      }
      // A pre-existing project token file is reported as "stored", never as its value.
      assert.equal(registryReading(reply).providers[0]!.tokenSet, true);
      assert.ok(!('token' in registryReading(reply).providers[0]!));
    },
    { env: { BOB_API_KEY: envSentinel }, projectToken: tokenSentinel },
  );
});
