#!/usr/bin/env node
// sweep-criterion-residue.test.mjs — criteria for scripts/sweep-criterion-residue.mjs.
//
// The tool decides two things that must never be confused: "is this a mutant copy?" (name prefix) and
// "is the process that wrote it still alive?" (trailing `-<pid>`). A false positive deletes a copy a
// running criterion is still importing; a false negative leaves the untracked file the task exists to
// remove. The cases below therefore build all four shapes the tool must distinguish at once — dead
// pid, live pid, no pid, dead-pid directory — and assert BOTH the file effects and the exact report
// line for each. The bounds case pins the other direction: a prefix-less file with a dead pid must
// be left alone, and node_modules/ and dist/ are not scanned at all.
//
// The dead pid is a REAL exited process, not a magic number: spawnSync reports its pid, and the test
// proves process.kill(pid, 0) throws ESRCH before handing it to a fixture. A hardcoded pid could be
// occupied by an unrelated process on the host and silently turn the "dead" fixture into a live one.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'sweep-criterion-residue.mjs');
const PREFIX = '__criterion-falsify-';
const LINE_RE = /^residue: (.+) pid=(unknown|\d+) state=(dead|alive|unknown) action=(removed|kept)$/;

/**
 * @typedef {{ rel: string, pid: string, state: string, action: string }} ReportLine
 */

/**
 * A pid whose process has really exited. Re-tries if the kernel recycled the pid between exit and the
 * liveness probe (rare, but a recycled pid would make the dead fixture live and the case vacuous).
 * @returns {number}
 */
function deadPid() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const child = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    const pid = child.pid;
    if (typeof pid !== 'number' || pid <= 0) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ESRCH') return pid;
    }
  }
  throw new Error('could not obtain a dead pid: every exited child was recycled immediately');
}

/** @returns {string} */
function makeRoot() {
  return mkdtempSync(path.join(os.tmpdir(), 'criterion-residue-'));
}

/**
 * @param {string} root
 * @param {string} rel
 * @param {string} [contents]
 * @returns {string}
 */
function writeFixture(root, rel, contents = 'export {};\n') {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, contents, 'utf8');
  return full;
}

/**
 * @param {string} root
 * @param {string} rel
 * @returns {string}
 */
function makeFixtureDir(root, rel) {
  const full = path.join(root, rel);
  mkdirSync(full, { recursive: true });
  writeFileSync(path.join(full, 'inside.ts'), 'export {};\n', 'utf8');
  return full;
}

/**
 * @param {string} root
 * @param {string[]} args
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runSweep(root, args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * @param {string} stdout
 * @returns {Map<string, ReportLine>}
 */
function parseReport(stdout) {
  /** @type {Map<string, ReportLine>} */
  const byPath = new Map();
  for (const raw of stdout.split('\n')) {
    if (raw === '') continue;
    const match = LINE_RE.exec(raw);
    assert.ok(match !== null, `a residue line did not match the frozen shape: ${JSON.stringify(raw)}`);
    const line = /** @type {RegExpExecArray} */ (match);
    const [, rel, pid, state, action] = line;
    assert.ok(!byPath.has(rel), `the sweep reported ${rel} twice`);
    byPath.set(rel, { rel, pid, state, action });
  }
  return byPath;
}

/**
 * The four shapes, each with the report the tool must produce. `dead` is a real exited pid and
 * `process.pid` is this test runner — alive for the whole case.
 * @param {string} root
 * @param {number} dead
 */
function placeFourShapes(root, dead) {
  const fixtures = {
    deadFile: writeFixture(root, `server/${PREFIX}legacy-${dead}.ts`),
    aliveFile: writeFixture(root, `server/${PREFIX}live-${process.pid}.ts`),
    noPidFile: writeFixture(root, `server/${PREFIX}no-pid.ts`),
    deadDir: makeFixtureDir(root, `server/${PREFIX}directory-${dead}`),
  };
  return {
    /** @type {Record<keyof typeof fixtures, string>} */ paths: fixtures,
    expected: /** @type {Record<keyof typeof fixtures, string>} */ ({
      deadFile: `server/${PREFIX}legacy-${dead}.ts`,
      aliveFile: `server/${PREFIX}live-${process.pid}.ts`,
      noPidFile: `server/${PREFIX}no-pid.ts`,
      deadDir: `server/${PREFIX}directory-${dead}`,
    }),
  };
}

test('AC1 --apply removes exactly the dead-pid copy and the dead-pid directory', () => {
  const root = makeRoot();
  try {
    const dead = deadPid();
    const { paths, expected } = placeFourShapes(root, dead);
    const run = runSweep(root, ['--apply']);

    assert.equal(run.status, 0, `the sweep must always exit 0; stderr was: ${run.stderr}`);
    const report = parseReport(run.stdout);
    assert.equal(report.size, 4, `expected one report line per fixture, got:\n${run.stdout}`);

    assert.deepEqual(report.get(expected.deadFile), {
      rel: expected.deadFile,
      pid: String(dead),
      state: 'dead',
      action: 'removed',
    });
    assert.deepEqual(report.get(expected.deadDir), {
      rel: expected.deadDir,
      pid: String(dead),
      state: 'dead',
      action: 'removed',
    });
    assert.deepEqual(report.get(expected.aliveFile), {
      rel: expected.aliveFile,
      pid: String(process.pid),
      state: 'alive',
      action: 'kept',
    });
    assert.deepEqual(report.get(expected.noPidFile), {
      rel: expected.noPidFile,
      pid: 'unknown',
      state: 'unknown',
      action: 'kept',
    });

    assert.ok(!existsSync(paths.deadFile), 'the dead-pid copy was reported removed but still exists');
    assert.ok(!existsSync(paths.deadDir), 'the dead-pid directory was reported removed but still exists');
    assert.ok(existsSync(paths.aliveFile), 'the live-pid copy was deleted: it may belong to a running criterion');
    assert.ok(existsSync(paths.noPidFile), 'the pid-less copy was deleted: its liveness is unknowable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AC1 without --apply the sweep is a dry run: all four shapes stay on disk', () => {
  const root = makeRoot();
  try {
    const dead = deadPid();
    const { paths, expected } = placeFourShapes(root, dead);
    const run = runSweep(root, []);

    assert.equal(run.status, 0, `the sweep must always exit 0; stderr was: ${run.stderr}`);
    const report = parseReport(run.stdout);
    assert.equal(report.size, 4, `expected one report line per fixture, got:\n${run.stdout}`);

    for (const rel of Object.values(expected)) {
      assert.equal(report.get(rel)?.action, 'kept', `${rel} was not reported as kept`);
    }
    assert.equal(report.get(expected.aliveFile)?.state, 'alive');
    assert.equal(report.get(expected.noPidFile)?.state, 'unknown');
    assert.equal(report.get(expected.deadFile)?.state, 'dead');
    assert.equal(report.get(expected.deadDir)?.state, 'dead');

    assert.ok(existsSync(paths.deadFile), 'a dry run deleted the dead-pid copy');
    assert.ok(existsSync(paths.deadDir), 'a dry run deleted the dead-pid directory');
    assert.ok(existsSync(paths.aliveFile), 'a dry run deleted the live-pid copy');
    assert.ok(existsSync(paths.noPidFile), 'a dry run deleted the pid-less copy');
    assert.equal(
      readFileSync(path.join(paths.deadDir, 'inside.ts'), 'utf8'),
      'export {};\n',
      'a dry run changed the dead-pid directory contents',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AC2 bounds: node_modules/, dist/, and non-prefixed names are never listed or removed', () => {
  const root = makeRoot();
  try {
    const dead = deadPid();
    const inNodeModules = writeFixture(root, `server/node_modules/${PREFIX}dependency-${dead}.ts`);
    const inDist = writeFixture(root, `src/dist/${PREFIX}build-${dead}.ts`);
    const wrongPrefix = writeFixture(root, `server/ordinary-${dead}.ts`);

    const run = runSweep(root, ['--apply']);

    assert.equal(run.status, 0, `the sweep must always exit 0; stderr was: ${run.stderr}`);
    assert.equal(
      run.stdout,
      '',
      `nothing outside the scanned prefix/roots may be reported, but got:\n${run.stdout}`,
    );
    assert.ok(existsSync(inNodeModules), 'a file under node_modules/ was removed');
    assert.ok(existsSync(inDist), 'a file under dist/ was removed');
    assert.ok(existsSync(wrongPrefix), 'a file without the __criterion-falsify- prefix was removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
