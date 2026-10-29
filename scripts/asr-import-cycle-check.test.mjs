#!/usr/bin/env node
/**
 * The file-level SCC reader, pinned in both directions: the shipping `shared/asr` has no value
 * cycle, and a synthetic cycle is actually reported (so a green shipping reading cannot be a
 * reader that never finds anything).
 *
 * The synthetic cases also pin the distinction the split rests on: `import type` is erased and
 * must not close a value cycle, while `export * from` is a runtime edge and must.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const CHECKER = path.join(SCRIPT_DIR, 'asr-import-cycle-check.mjs');

/**
 * @param {string} root
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function run(root) {
  const result = spawnSync(process.execPath, [CHECKER, '--root', root], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * A throwaway tree with the given `shared/asr` modules.
 *
 * @param {import('node:test').TestContext} t
 * @param {Record<string, string>} modules file name -> source
 * @returns {string}
 */
function fixture(t, modules) {
  const root = mkdtempSync(path.join(tmpdir(), 'asr-import-cycle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'shared', 'asr'), { recursive: true });
  for (const [name, source] of Object.entries(modules)) {
    writeFileSync(path.join(root, 'shared', 'asr', name), source, 'utf8');
  }
  return root;
}

describe('asr-import-cycle-check', () => {
  it('reports the shipping tree as value-cycle-free', () => {
    const result = run(REPO_ROOT);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /^asr-import-cycle .*value-sccs=0 maxScc=0 verdict=PASS$/m);
  });

  it('reports a two-file VALUE cycle as a cycle (the negative control)', (t) => {
    const root = fixture(t, {
      'a.ts': "import { b } from './b.js';\nexport const a = b;\n",
      'b.ts': "import { a } from './a.js';\nexport const b = a;\n",
    });
    const result = run(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^cycle size=2 files=shared\/asr\/a\.ts,shared\/asr\/b\.ts$/m);
    assert.match(result.stdout, /value-sccs=1 maxScc=2 verdict=FAIL/m);
  });

  it('does not count a TYPE-only cycle, which is erased before a run', (t) => {
    const root = fixture(t, {
      'a.ts': "import type { B } from './b.js';\nexport type A = B;\n",
      'b.ts': "import type { A } from './a.js';\nexport type B = A;\n",
    });
    const result = run(root);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /value-edges=0 type-edges=2 value-sccs=0 maxScc=0 verdict=PASS/m);
  });

  it('counts a re-export as a runtime edge', (t) => {
    const root = fixture(t, {
      'a.ts': "export * from './b.js';\n",
      'b.ts': "import { a } from './a.js';\nexport const b = a;\n",
    });
    const result = run(root);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /value-sccs=1 maxScc=2 verdict=FAIL/m);
  });

  it('treats a mixed `{ type X, y }` import as a runtime edge and an all-type one as erased', (t) => {
    const erased = fixture(t, {
      'a.ts': "import { type B } from './b.js';\nexport const a = 1;\n",
      'b.ts': 'export type B = string;\n',
    });
    const mixed = fixture(t, {
      'a.ts': "import { type B, b } from './b.js';\nexport const a = b;\n",
      'b.ts': 'export type B = string;\nexport const b = 1;\n',
    });
    assert.match(run(erased).stdout, /value-edges=0 type-edges=1/m);
    assert.match(run(mixed).stdout, /value-edges=1 type-edges=0/m);
  });

  it('refuses an unreadable scope rather than calling it zero cycles', (t) => {
    const root = mkdtempSync(path.join(tmpdir(), 'asr-import-cycle-empty-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const result = run(root);
    assert.equal(result.status, 3, result.stdout + result.stderr);
    assert.match(result.stdout, /verdict=NOT-EVALUATED/);
  });
});
