/**
 * The shared settings-file reader criterion.
 *
 * Every leg drives the real reader against a temp file: the mtime+size cache,
 * missing and malformed files, `~` expansion, the typed field readers and the
 * `apiKeyFile` grammar. These are the behaviours the four module readers
 * (`counter-voice-settings.ts`, `session-digest-llm-settings.ts`,
 * `reply-suggestions-settings.ts`, `refresh-settings.ts`) inherited when their
 * copies were replaced.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs \
 *     --test server/shared/tests/settings-file.test.ts
 */
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createSettingsBlockSource,
  defaultServerSettingsPath,
  readBoolean,
  readInteger,
  readString,
  resolveApiKey,
} from '../settings-file.js';

type Reading = {
  value: string;
  source: 'default' | 'file';
  path: string | null;
  problems: string[];
};

function temporaryDirectory(t: { after(callback: () => void): void }, prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Build one source over `demo.block` and count how many times it re-parsed. */
function blockSource(settingsPath: string | null, homeDir: string, explicit = true): {
  read(): Reading;
  parses(): number;
} {
  let parses = 0;
  const source = createSettingsBlockSource<Reading>({
    settingsPath,
    homeDir,
    block: 'demo.block',
    explicit,
    parse: (block, context) => {
      parses += 1;
      return {
        value: block === null ? 'default' : readString(block, 'value', 'default', context.problems),
        source: context.source,
        path: context.path,
        problems: context.problems,
      };
    },
  });
  return { read: () => source.read(), parses: () => parses };
}

function writeBlock(filePath: string, value: string): void {
  writeFileSync(filePath, JSON.stringify({ demo: { block: { value } } }), { mode: 0o600 });
}

test('an unchanged mtime and size keep the cached reading', (t) => {
  const directory = temporaryDirectory(t, 'settings-shared-cache-');
  const file = path.join(directory, 'settings.json');
  const mtime = 1_780_000_000;
  writeBlock(file, 'one');
  utimesSync(file, mtime, mtime);

  const source = blockSource(file, directory);
  assert.equal(source.read().value, 'one');
  assert.equal(source.parses(), 1);

  assert.equal(source.read().value, 'one');
  assert.equal(source.parses(), 1, 'a second read of an unchanged file must not re-parse');

  // Same LENGTH so the size part of the cache key does not force a re-read; the
  // documented rule is modification-time driven.
  writeBlock(file, 'two');
  utimesSync(file, mtime, mtime);
  assert.equal(source.read().value, 'one', 'an unchanged mtime must not re-read');
  assert.equal(source.parses(), 1);
});

test('a changed mtime re-reads the file', (t) => {
  const directory = temporaryDirectory(t, 'settings-shared-change-');
  const file = path.join(directory, 'settings.json');
  const first = 1_780_000_000;
  writeBlock(file, 'one');
  utimesSync(file, first, first);
  const source = blockSource(file, directory);
  assert.equal(source.read().value, 'one');

  writeBlock(file, 'second');
  utimesSync(file, first + 5, first + 5);
  assert.equal(source.read().value, 'second');
  assert.equal(source.parses(), 2);
});

test('a missing default file is the silent defaults state; an explicit one reports it', (t) => {
  const directory = temporaryDirectory(t, 'settings-shared-missing-');
  const missing = path.join(directory, 'does-not-exist.json');

  const defaults = blockSource(missing, directory, false).read();
  assert.equal(defaults.value, 'default');
  assert.equal(defaults.source, 'default');
  assert.equal(defaults.path, missing);
  assert.deepEqual(defaults.problems, []);

  const explicit = blockSource(missing, directory).read();
  assert.equal(explicit.value, 'default');
  assert.equal(explicit.problems.length, 1);
  assert.match(explicit.problems[0]!, /could not read/);
  assert.ok(explicit.problems[0]!.includes(missing));
});

test('malformed JSON and a non-object document fall back with a problem', (t) => {
  const directory = temporaryDirectory(t, 'settings-shared-bad-');

  const broken = path.join(directory, 'broken.json');
  writeFileSync(broken, '{ not json', { mode: 0o600 });
  const brokenReading = blockSource(broken, directory).read();
  assert.equal(brokenReading.value, 'default');
  assert.equal(brokenReading.source, 'file');
  assert.match(brokenReading.problems[0]!, /could not read/);

  const scalar = path.join(directory, 'scalar.json');
  writeFileSync(scalar, '[]', { mode: 0o600 });
  const scalarReading = blockSource(scalar, directory).read();
  assert.equal(scalarReading.value, 'default');
  assert.ok(scalarReading.problems.some((problem) => problem.includes('must contain a JSON object')));
});

test('a malformed block level names the dotted path', (t) => {
  const directory = temporaryDirectory(t, 'settings-shared-block-');
  const file = path.join(directory, 'settings.json');
  writeFileSync(file, JSON.stringify({ demo: { block: 'not-an-object' } }), { mode: 0o600 });
  const reading = blockSource(file, directory).read();
  assert.equal(reading.value, 'default');
  assert.ok(reading.problems.some((problem) => problem === '`demo.block` must be an object'));
});

test('`~` expands against the supplied home, not the process home', (t) => {
  const directory = temporaryDirectory(t, 'settings-shared-home-');
  writeBlock(path.join(directory, 'settings.json'), 'from-home');
  const reading = blockSource('~/settings.json', directory).read();
  assert.equal(reading.value, 'from-home');
  assert.equal(reading.path, path.join(directory, 'settings.json'));
});

test('the typed field readers fall back field by field and name the key', () => {
  const problems: string[] = [];
  const record = { yes: 'true', name: 7, count: 1.5, low: 0 };
  assert.equal(readBoolean(record, 'yes', false, problems), false);
  assert.equal(readString(record, 'name', 'fallback', problems), 'fallback');
  assert.equal(readInteger(record, 'count', 3, { minimum: 1, maximum: 10 }, problems), 3);
  assert.equal(readInteger(record, 'low', 3, { minimum: 1, maximum: 10 }, problems), 3);
  assert.deepEqual(problems, [
    '`yes` must be a boolean',
    '`name` must be a string',
    '`count` must be an integer',
    '`low` must be between 1 and 10',
  ]);
});

test('resolveApiKey reads bare, NAME=value, export, quotes, apiKeyVar and ~', (t) => {
  const directory = temporaryDirectory(t, 'settings-shared-key-');

  const bare = path.join(directory, 'bare.key');
  writeFileSync(bare, '  sk-bare  \n', { mode: 0o600 });
  assert.equal(resolveApiKey(bare, directory, []), 'sk-bare');

  const assignment = path.join(directory, 'assignment.key');
  writeFileSync(assignment, 'export DEMO_KEY="sk-quoted"\n', { mode: 0o600 });
  assert.equal(resolveApiKey(assignment, directory, []), 'sk-quoted');

  const multiple = path.join(directory, 'multiple.key');
  writeFileSync(multiple, 'OTHER=sk-other\nDEMO_KEY=sk-selected\n', { mode: 0o600 });
  assert.equal(resolveApiKey(multiple, directory, [], { apiKeyVar: 'DEMO_KEY' }), 'sk-selected');

  writeFileSync(path.join(directory, 'home.key'), 'sk-home\n', { mode: 0o600 });
  assert.equal(resolveApiKey('~/home.key', directory, []), 'sk-home');
});

test('resolveApiKey reports every failure without echoing the key', (t) => {
  const directory = temporaryDirectory(t, 'settings-shared-key-fail-');
  const secret = 'sk-never-echoed';

  const missingProblems: string[] = [];
  assert.equal(resolveApiKey(path.join(directory, 'missing.key'), directory, missingProblems), '');
  assert.match(missingProblems[0]!, /could not read the API key file/);

  const empty = path.join(directory, 'empty.key');
  writeFileSync(empty, '\n# only a comment\n', { mode: 0o600 });
  const emptyProblems: string[] = [];
  assert.equal(resolveApiKey(empty, directory, emptyProblems), '');
  assert.ok(emptyProblems.some((problem) => problem.includes('is empty')));

  const wrongVariable = path.join(directory, 'wrong.key');
  writeFileSync(wrongVariable, 'OTHER=sk-other\n', { mode: 0o600 });
  const wrongProblems: string[] = [];
  assert.equal(resolveApiKey(wrongVariable, directory, wrongProblems, { apiKeyVar: 'DEMO_KEY' }), '');
  assert.ok(wrongProblems.some((problem) => problem.includes('does not assign')));

  const wide = path.join(directory, 'wide.key');
  writeFileSync(wide, `${secret}\n`);
  chmodSync(wide, 0o644);
  const wideProblems: string[] = [];
  assert.equal(resolveApiKey(wide, directory, wideProblems, { warnOnWideMode: true }), secret);
  assert.ok(wideProblems.some((problem) => problem.includes('600')));
  assert.ok(!wideProblems.join('\n').includes(secret), 'problems must not echo the key');
});

test('the default server settings path honours the supplied home', () => {
  assert.equal(
    defaultServerSettingsPath('/tmp/example-home'),
    path.join('/tmp/example-home', '.config', 'claudecodeui', 'server.settings.json'),
  );
});
