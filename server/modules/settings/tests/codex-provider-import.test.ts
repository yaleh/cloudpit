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
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  readCodexUserProviderImports,
  type CodexUserProviderImportReading,
} from '../codex-model-providers.settings.js';

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
