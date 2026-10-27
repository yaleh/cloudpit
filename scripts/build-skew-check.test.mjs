import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { compareBuildFingerprints, describeSkew } from './build-skew-check.mjs';

/**
 * The two restart entrypoints must refuse to stop the server when the browser bundle and the
 * server build on disk name different commits (the 2026-10-27 incident: `npm run build:client`
 * alone, then a deferred restart, then `/api/cockpit/cards` answered by the SPA fallback).
 *
 * The first block drives `scripts/build-skew-check.mjs` itself over temp build-info trees: same,
 * skew, each side missing, and a corrupt record. The second block drives the REAL
 * `scripts/restart-server-detached.sh` through a temp app root (scripts symlinked in, so `ROOT`
 * resolves to the fixture) with PATH stubs for systemctl/systemd-run/curl/ss, which is what makes
 * the "refusal touches no systemctl" assertion meaningful rather than vacuous.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'build-skew-check.mjs');
const CLIENT_SHA = 'c'.repeat(40);
const SERVER_SHA = 'd'.repeat(40);

/**
 * Runs `run` over a fresh temp directory and removes it afterwards.
 *
 * @template T
 * @param {(dir: string) => T} run
 * @returns {T}
 */
function withTempDir(run) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'build-skew-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Writes one build-info record the way the two build scripts do. `content` overrides the JSON
 * document for the corrupt-record case.
 *
 * @param {string} root
 * @param {string} relativePath
 * @param {string | null} sha
 * @param {string} [content]
 */
function writeBuildInfo(root, relativePath, sha, content) {
  const file = path.join(root, relativePath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    content ?? JSON.stringify({ gitSha: sha, builtAt: '2026-10-27T00:00:00.000Z' }),
  );
}

/**
 * Runs the checker and parses its `--json` document (when it produced one).
 *
 * @param {string} root
 * @param {string[]} [args]
 */
function runCheck(root, args = ['--json']) {
  const result = spawnSync(process.execPath, [CHECK_SCRIPT, '--root', root, ...args], {
    encoding: 'utf8',
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

test('AC: same client/server shas read as same and exit 0', () => {
  withTempDir((/** @type {string} */ root) => {
    writeBuildInfo(root, 'dist/build-info.json', CLIENT_SHA);
    writeBuildInfo(root, 'dist-server/build-info.json', CLIENT_SHA);

    const { status, json } = runCheck(root);
    assert.equal(status, 0);
    assert.deepEqual(json, {
      verdict: 'same',
      clientSha: CLIENT_SHA,
      serverSha: CLIENT_SHA,
      clientBuiltAt: '2026-10-27T00:00:00.000Z',
      serverBuiltAt: '2026-10-27T00:00:00.000Z',
    });
  });
});

test('AC: different client/server shas read as skew, exit 1, and name both shas in text mode', () => {
  withTempDir((/** @type {string} */ root) => {
    writeBuildInfo(root, 'dist/build-info.json', CLIENT_SHA);
    writeBuildInfo(root, 'dist-server/build-info.json', SERVER_SHA);

    const jsonRun = runCheck(root);
    assert.equal(jsonRun.status, 1);
    assert.equal(jsonRun.json?.verdict, 'skew');
    assert.equal(jsonRun.json?.clientSha, CLIENT_SHA);
    assert.equal(jsonRun.json?.serverSha, SERVER_SHA);

    const textRun = runCheck(root, []);
    assert.equal(textRun.status, 1);
    assert.match(textRun.stdout, new RegExp(CLIENT_SHA));
    assert.match(textRun.stdout, new RegExp(SERVER_SHA));
    assert.match(textRun.stdout, /npm run build/);
  });
});

test('AC: a missing client record reads as missing and exits 2', () => {
  withTempDir((/** @type {string} */ root) => {
    writeBuildInfo(root, 'dist-server/build-info.json', SERVER_SHA);

    const { status, json, stdout } = runCheck(root);
    assert.equal(status, 2);
    assert.equal(json?.verdict, 'missing');
    assert.equal(json?.clientSha, null);
    assert.equal(json?.serverSha, SERVER_SHA);
    assert.match(stdout, /MISSING|"verdict":"missing"/);
  });
});

test('AC: a missing server record reads as missing and exits 2', () => {
  withTempDir((/** @type {string} */ root) => {
    writeBuildInfo(root, 'dist/build-info.json', CLIENT_SHA);

    const { status, json } = runCheck(root);
    assert.equal(status, 2);
    assert.equal(json?.verdict, 'missing');
    assert.equal(json?.clientSha, CLIENT_SHA);
    assert.equal(json?.serverSha, null);
  });
});

test('AC: a corrupt build-info record reads as missing and exits 2', () => {
  withTempDir((/** @type {string} */ root) => {
    writeBuildInfo(root, 'dist/build-info.json', null, '{ this is not json');
    writeBuildInfo(root, 'dist-server/build-info.json', SERVER_SHA);

    const { status, json } = runCheck(root);
    assert.equal(status, 2);
    assert.equal(json?.verdict, 'missing');
    assert.equal(json?.clientSha, null);
    assert.equal(json?.serverSha, SERVER_SHA);
  });
});

test('the comparison rule and its human line are the production decisions', () => {
  const reading = compareBuildFingerprints(
    { gitSha: CLIENT_SHA, builtAt: 'c-at' },
    { gitSha: SERVER_SHA, builtAt: 's-at' },
  );
  assert.deepEqual(reading, {
    verdict: 'skew',
    clientSha: CLIENT_SHA,
    serverSha: SERVER_SHA,
    clientBuiltAt: 'c-at',
    serverBuiltAt: 's-at',
  });
  assert.equal(describeSkew(reading, '/app').includes(CLIENT_SHA), true);
  assert.equal(describeSkew(reading, '/app').includes(SERVER_SHA), true);
});

// --------------------------- the restart preflight refuses skew ---------------------------

const UNIT = 'build-skew-fixture';

/**
 * Builds a temp app root that the real restart script treats as its checkout: the scripts are
 * symlinked in (so `ROOT` is the fixture), and a PATH stub for systemctl records every call, which
 * is what lets the skew arm prove the refusal never reaches systemd. Returns the spawn env and the
 * call log the stubs append to.
 *
 * @param {string} root
 * @returns {{ env: NodeJS.ProcessEnv, callLog: string }}
 */
function createRestartFixture(root) {
  const scriptsDir = path.join(root, 'scripts');
  mkdirSync(path.join(scriptsDir, 'systemd'), { recursive: true });
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  mkdirSync(path.join(root, 'dist-server', 'server'), { recursive: true });
  // The preflight's "there is a server build to run" check.
  writeFileSync(path.join(root, 'dist-server', 'server', 'index.js'), '');
  for (const script of [
    'restart-server-detached.sh',
    'install-server-unit.sh',
    'serve-scoped.sh',
    'build-skew-check.mjs',
  ]) {
    symlinkSync(path.join(REPO_ROOT, 'scripts', script), path.join(scriptsDir, script));
  }
  symlinkSync(
    path.join(REPO_ROOT, 'scripts', 'systemd', 'claudecodeui-server.service'),
    path.join(scriptsDir, 'systemd', 'claudecodeui-server.service'),
  );

  const unitDir = path.join(root, 'units');
  mkdirSync(unitDir, { recursive: true });
  writeFileSync(
    path.join(unitDir, `${UNIT}.service`),
    '[Service]\nRestart=on-failure\n',
  );

  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  const callLog = path.join(root, 'systemctl-calls.log');
  const nodeDir = path.dirname(realpathSync(process.execPath));

  // The user manager's PATH: the real node (not /usr/bin/node), $HOME/.local/bin (the installer
  // requires it), and the stub dir carrying claude.
  const managerPath = [bin, nodeDir, path.join(os.homedir(), '.local', 'bin'), '/usr/local/bin', '/usr/bin', '/bin'].join(':');

  const stub = (/** @type {string} */ name, /** @type {string} */ body) => {
    const file = path.join(bin, name);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    spawnSync('chmod', ['+x', file]);
  };
  stub('systemd-run', 'printf \'systemd-run %s\\n\' "$*" >>"$CALL_LOG"\nexit 0');
  stub(
    'systemctl',
    'printf \'systemctl %s\\n\' "$*" >>"$CALL_LOG"\n'
      + 'case "$*" in\n'
      + '  *show-environment*) printf \'PATH=%s\\n\' "$MGR_PATH" ;;\n'
      + '  *is-active*) echo active ;;\n'
      + '  *) prop=""\n'
      + '     while [ "$#" -gt 0 ]; do [ "$1" = "-p" ] && { prop="$2"; shift; }; shift; done\n'
      + '     case "$prop" in\n'
      + '       MainPID) echo 1234 ;;\n'
      + '       ActiveState) echo active ;;\n'
      + '       ActiveEnterTimestamp) echo "Mon 2026-10-27 00:00:00 UTC" ;;\n'
      + '       FragmentPath) echo "/tmp/fixture/claudecodeui-server.service" ;;\n'
      + '       SubState) echo running ;;\n'
      + '       Restart) echo on-failure ;;\n'
      + '       NRestarts) echo 0 ;;\n'
      + '       MemoryCurrent) echo 104857600 ;;\n'
      + '       *) echo "" ;;\n'
      + '     esac ;;\n'
      + 'esac',
  );
  stub('curl', 'printf \'200\'');
  stub('ss', 'exit 0');
  stub('claude', 'exit 0');

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ''}`,
    CALL_LOG: callLog,
    MGR_PATH: managerPath,
    QUAY_SERVER_UNIT: UNIT,
    QUAY_UNIT_DIR: unitDir,
    QUAY_RESTART_LOG_DIR: path.join(root, 'restart-logs'),
    QUAY_SERVER_LOG: path.join(root, 'server.log'),
    QUAY_RESTART_PORT: '3901',
    QUAY_BUILD_INFO_ROOT: root,
  };

  return { env, callLog };
}

/**
 * Runs the real restart script in dry-run mode; the caller seeds the build-info files first.
 *
 * @param {string} root
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} [extraArgs]
 * @returns {{ status: number | null, output: string, systemctlCalls: string }}
 */
function runRestartDryRun(root, env, extraArgs = []) {
  const callLog = env.CALL_LOG;
  const result = spawnSync(
    'bash',
    [path.join(root, 'scripts', 'restart-server-detached.sh'), '--dry-run', ...extraArgs],
    { encoding: 'utf8', env },
  );
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    systemctlCalls: callLog !== undefined && existsSync(callLog) ? readFileSync(callLog, 'utf8') : '',
  };
}

test('AC: --dry-run refuses a build skew, names both shas, and never calls systemctl', () => {
  withTempDir((/** @type {string} */ root) => {
    writeBuildInfo(root, 'dist/build-info.json', CLIENT_SHA);
    writeBuildInfo(root, 'dist-server/build-info.json', SERVER_SHA);
    const { env } = createRestartFixture(root);

    const run = runRestartDryRun(root, env);
    assert.notEqual(run.status, 0);
    assert.match(run.output, /SKEW/);
    assert.match(run.output, new RegExp(CLIENT_SHA));
    assert.match(run.output, new RegExp(SERVER_SHA));
    assert.match(run.output, /npm run build/);
    // The refusal happens first, so the fixture's systemctl stub recorded nothing at all.
    assert.equal(run.systemctlCalls, '');
  });
});

test('AC: --dry-run proceeds as usual when the two builds agree', () => {
  withTempDir((/** @type {string} */ root) => {
    writeBuildInfo(root, 'dist/build-info.json', CLIENT_SHA);
    writeBuildInfo(root, 'dist-server/build-info.json', CLIENT_SHA);
    const { env } = createRestartFixture(root);

    const run = runRestartDryRun(root, env);
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /build-skew preflight: SAME/);
    assert.match(run.output, /DRY RUN/);
    assert.match(run.systemctlCalls, /is-active/);
  });
});

test('the explicit --allow-build-skew escape hatch passes and records the reason', () => {
  withTempDir((/** @type {string} */ root) => {
    writeBuildInfo(root, 'dist/build-info.json', CLIENT_SHA);
    writeBuildInfo(root, 'dist-server/build-info.json', SERVER_SHA);
    const { env } = createRestartFixture(root);

    const run = runRestartDryRun(root, env, ['--allow-build-skew']);
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /build-skew OVERRIDE/);
    assert.match(run.output, new RegExp(CLIENT_SHA));
    assert.match(run.output, new RegExp(SERVER_SHA));
  });
});
