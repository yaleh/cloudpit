#!/usr/bin/env node
/**
 * Offline protocol smoke matrix for the pinned `@openai/codex` app-server.
 *
 * The resident Codex driver is written against the app-server JSON-RPC surface,
 * not against the CLI's user-facing commands. Upgrading the package is therefore
 * only safe when the *same* surface still answers on the new version: the
 * handshake capability gate, the paginated model catalog, thread creation, the
 * queue group, live settings, the client-owned process verbs and the
 * experimental-feature probe.
 *
 * This script measures that surface against the packaged launcher, with a fresh
 * temporary `CODEX_HOME` (never the operator's `~/.codex`), no `auth.json` and no
 * account credential in the environment. It prints one JSON report and exits
 * non-zero when any step is not the shape the driver depends on, so the report
 * is evidence rather than a log.
 *
 * Usage:
 *   node scripts/codex-protocol-smoke.mjs
 *
 * Exit codes: 0 = every step matched its shape; 1 = at least one step did not.
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

/** How long one request may wait for its reply before the step fails. */
const REQUEST_TIMEOUT_MS = 20_000;
/** How long to wait for a server notification a step expects. */
const NOTIFICATION_TIMEOUT_MS = 10_000;
/** Page size used to force `model/list` through its cursor at least twice. */
const MODEL_PAGE_SIZE = 4;

/**
 * The server's verbatim refusal when `thread/queue/*` is called without
 * `capabilities.experimentalApi`. The driver matches this text (the RPC code is
 * not contract), so the smoke matrix asserts it character for character.
 */
const EXPECTED_QUEUE_REJECTION = 'thread/queue/add requires experimentalApi capability';

/** Resolves the launcher the server module resolves: the package the repo pins. */
function resolveLauncher() {
  try {
    return createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
  } catch {
    throw new Error('The @openai/codex package is not installed; run `npm install` first.');
  }
}

/**
 * Reads the packaged CLI's own version banner (`codex-cli <version>`).
 * @param {string} launcher
 * @param {NodeJS.ProcessEnv} env
 */
function readCliVersion(launcher, env) {
  const result = spawnSync(process.execPath, [launcher, '--version'], {
    encoding: 'utf8',
    timeout: 30_000,
    env,
  });
  const banner = String(result.stdout ?? '').trim();
  const match = /^codex-cli\s+(\S+)$/m.exec(banner);
  return { banner, version: match ? match[1] : null, status: result.status };
}

/**
 * One JSON-RPC connection to a freshly spawned `codex app-server`.
 *
 * Only the frames this matrix needs are modelled: request/reply correlation and
 * server notifications. Each connection owns its child and closes it in `stop`.
 */
class AppServerConnection {
  /**
   * @param {{ launcher: string, cwd: string, env: NodeJS.ProcessEnv }} options
   */
  constructor(options) {
    this.launcher = options.launcher;
    this.cwd = options.cwd;
    this.env = options.env;
    /** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
    this.child = null;
    /** @type {Map<number, { resolve: (value: any) => void, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    /** @type {Array<{ method?: string, params?: unknown, id?: number | string, result?: unknown, error?: unknown }>} */
    this.notifications = [];
    this.nextRequestId = 1;
    this.stderr = '';
    /** @type {import('node:readline').Interface | null} */
    this.reader = null;
  }

  /** Spawns the process and starts reading frames. */
  start() {
    const child = spawn(process.execPath, [this.launcher, 'app-server'], {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.stderr.on('data', (chunk) => {
      this.stderr = (this.stderr + String(chunk)).slice(-4000);
    });
    this.reader = readline.createInterface({ input: child.stdout });
    this.reader.on('line', (line) => this.handleLine(line));
    child.on('exit', () => {
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timer);
        pending.resolve({ error: { code: 'EXITED', message: `app-server exited before answering id ${id}` } });
      }
      this.pending.clear();
    });
    return this;
  }

  /** @param {string} line */
  handleLine(line) {
    if (!line.trim()) {
      return;
    }
    /** @type {{ id?: number | string, method?: string, params?: unknown, result?: unknown, error?: unknown }} */
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      // Banner/diagnostic lines are not protocol frames.
      return;
    }
    if (typeof frame.id === 'number') {
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        clearTimeout(pending.timer);
        pending.resolve(frame);
        return;
      }
    }
    if (typeof frame.method === 'string') {
      this.notifications.push(frame);
    }
  }

  /**
   * Sends one request and resolves with its full reply frame.
   * @param {string} method
   * @param {unknown} params
   * @returns {Promise<any>}
   */
  request(method, params) {
    const child = this.child;
    if (!child) {
      return Promise.resolve({ error: { code: 'NOT_STARTED', message: 'app-server was not started' } });
    }
    return new Promise((resolve) => {
      const id = this.nextRequestId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: { code: 'TIMEOUT', message: `no reply to ${method} within ${REQUEST_TIMEOUT_MS}ms` } });
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /**
   * Writes one notification.
   * @param {string} method
   * @param {unknown} params
   */
  notify(method, params) {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  /**
   * Waits for the first notification matching `method` and `predicate`.
   * @param {string} method
   * @param {(params: any) => boolean} predicate
   * @returns {Promise<unknown | null>}
   */
  waitForNotification(method, predicate) {
    const existing = this.notifications.find((frame) => frame.method === method && predicate(frame.params));
    if (existing) {
      return Promise.resolve(existing.params ?? null);
    }
    return new Promise((resolve) => {
      const deadline = setTimeout(() => {
        clearInterval(poll);
        resolve(null);
      }, NOTIFICATION_TIMEOUT_MS);
      const poll = setInterval(() => {
        const found = this.notifications.find((frame) => frame.method === method && predicate(frame.params));
        if (found) {
          clearTimeout(deadline);
          clearInterval(poll);
          resolve(found.params ?? null);
        }
      }, 25);
      poll.unref?.();
    });
  }

  /** Terminates the process and releases the pipes. */
  async stop() {
    this.reader?.close();
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
    }
  }
}

/**
 * Performs the handshake and the stable steps every arm needs.
 * @param {AppServerConnection} connection
 * @param {boolean} experimentalApi
 */
async function handshake(connection, experimentalApi) {
  const capabilities = experimentalApi ? { experimentalApi: true } : {};
  const reply = await connection.request('initialize', {
    clientInfo: { name: 'cloudpit', title: 'Cloudpit', version: '1' },
    capabilities,
  });
  connection.notify('initialized', {});
  return reply;
}

/**
 * Reads a reply's `result`, or null when it carried an error.
 * @param {any} reply
 * @returns {any}
 */
function resultOf(reply) {
  if (!reply || reply.error) {
    return null;
  }
  return reply.result ?? null;
}

/**
 * Why a reply is not a usable result, for the report's `errors`.
 * @param {string} step
 * @param {any} reply
 * @returns {string}
 */
function describeError(step, reply) {
  if (reply && reply.error) {
    return `${step}: ${reply.error.code ?? 'error'} ${reply.error.message ?? ''}`.trim();
  }
  return `${step}: reply did not carry a result`;
}

/**
 * Runs every step and returns the report plus the failure list.
 * @param {{ root: string, launcher: string }} options
 */
async function runMatrix({ root, launcher }) {
  const codexHome = path.join(root, 'codex-home');
  const home = path.join(root, 'home');
  const work = path.join(root, 'work');
  await mkdir(codexHome, { recursive: true });
  await mkdir(home, { recursive: true });
  await mkdir(work, { recursive: true });

  // A fresh environment: no account credential, and both the CLI's own home and
  // the shell HOME point inside this run, so nothing touches the operator's
  // `~/.codex`.
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, CODEX_HOME: codexHome, HOME: home };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.CODEX_ACCESS_TOKEN;

  /** @type {string[]} */
  const errors = [];
  /**
   * @type {{
   *   ok: boolean,
   *   checkedAt: string,
   *   launcher: string,
   *   cliVersion: { banner: string, version: string | null, status: number | null },
   *   codexHome: string,
   *   isolatedHome: string,
   *   steps: Record<string, any>,
   *   noCapability: Record<string, any>,
   *   errors: string[],
   * }}
   */
  const report = {
    ok: false,
    checkedAt: new Date().toISOString(),
    launcher,
    cliVersion: readCliVersion(launcher, env),
    codexHome,
    isolatedHome: home,
    steps: {},
    noCapability: {},
    errors,
  };

  const connection = new AppServerConnection({ launcher, cwd: work, env }).start();
  try {
    // ---- initialize (with the capability) ----
    const initializeReply = await handshake(connection, true);
    const initializeResult = resultOf(initializeReply);
    report.steps.initialize = initializeResult
      ? {
        ok: true,
        userAgent: initializeResult.userAgent ?? null,
        platformFamily: initializeResult.platformFamily ?? null,
        platformOs: initializeResult.platformOs ?? null,
        reportedCodexHome: initializeResult.codexHome ?? null,
      }
      : { ok: false, reply: initializeReply };
    if (!initializeResult) {
      errors.push(describeError('initialize', initializeReply));
    }

    // ---- model/list, walked through its cursor ----
    /** @type {any[]} */
    const models = [];
    let cursor = null;
    let pages = 0;
    let modelListError = null;
    do {
      const params = cursor ? { cursor, limit: MODEL_PAGE_SIZE } : { limit: MODEL_PAGE_SIZE };
      const reply = await connection.request('model/list', params);
      const result = resultOf(reply);
      if (!result || !Array.isArray(result.data)) {
        modelListError = describeError('model/list', reply);
        break;
      }
      models.push(...result.data);
      cursor = typeof result.nextCursor === 'string' ? result.nextCursor : null;
      pages += 1;
    } while (cursor && pages < 20);
    const visibleModels = models.filter((model) => model.hidden === false);
    report.steps.modelList = modelListError
      ? { ok: false, error: modelListError }
      : {
        ok: models.length > 0 && pages > 1,
        count: models.length,
        pages,
        ids: models.map((model) => model.id),
        visibleIds: visibleModels.map((model) => model.id),
      };
    if (modelListError) {
      errors.push(modelListError);
    } else if (!(models.length > 0)) {
      errors.push('model/list: no models returned');
    } else if (pages <= 1) {
      errors.push(`model/list: pagination was not exercised (pages=${pages})`);
    }

    // ---- thread/start ----
    const threadReply = await connection.request('thread/start', { cwd: work });
    const threadResult = resultOf(threadReply);
    const threadId = threadResult?.thread?.id;
    report.steps.threadStart = threadResult && typeof threadId === 'string'
      ? { ok: true, threadId, model: threadResult.thread.model ?? null }
      : { ok: false, reply: threadReply };
    if (!(threadResult && typeof threadId === 'string')) {
      errors.push(describeError('thread/start', threadReply));
    }

    // ---- thread/queue/add + thread/queue/list ----
    if (typeof threadId === 'string') {
      const clientUserMessageId = `smoke-${Date.now()}`;
      const addReply = await connection.request('thread/queue/add', {
        threadId,
        clientUserMessageId,
        input: [{ type: 'text', text: 'protocol smoke queued turn', text_elements: [] }],
      });
      const addResult = resultOf(addReply);
      const submission = addResult?.queuedSubmission;
      report.steps.queueAdd = submission && typeof submission.id === 'string'
        ? {
          ok: true,
          queuedSubmissionId: submission.id,
          clientUserMessageId: submission.clientUserMessageId ?? null,
        }
        : { ok: false, reply: addReply };
      if (!(submission && typeof submission.id === 'string')) {
        errors.push(describeError('thread/queue/add', addReply));
      }

      const listReply = await connection.request('thread/queue/list', { threadId });
      const listResult = resultOf(listReply);
      const listIsShape = Boolean(listResult) && Array.isArray(listResult.data);
      report.steps.queueList = listIsShape
        ? {
          ok: true,
          depth: listResult.data.length,
          ids: listResult.data.map((/** @type {any} */ row) => row?.id ?? null),
          nextCursor: listResult.nextCursor ?? null,
        }
        : { ok: false, reply: listReply };
      if (!listIsShape) {
        errors.push(describeError('thread/queue/list', listReply));
      }

      // ---- thread/settings/update: `{}` plus the matching notification ----
      const settingsReply = await connection.request('thread/settings/update', { threadId, effort: 'low' });
      const settingsResult = resultOf(settingsReply);
      const settingsNotification = await connection.waitForNotification(
        'thread/settings/updated',
        (params) => params?.threadId === threadId && params?.threadSettings?.effort === 'low',
      );
      const updateIsObject = Boolean(settingsResult)
        && typeof settingsResult === 'object'
        && !Array.isArray(settingsResult)
        && Object.keys(settingsResult).length === 0;
      report.steps.settings = settingsResult
        ? {
          ok: updateIsObject && settingsNotification !== null,
          updateResult: settingsResult,
          updateResultIsEmptyObject: updateIsObject,
          notification: settingsNotification,
        }
        : { ok: false, reply: settingsReply };
      if (!settingsResult) {
        errors.push(describeError('thread/settings/update', settingsReply));
      } else if (!updateIsObject) {
        errors.push(`thread/settings/update: expected {}, got ${JSON.stringify(settingsResult)}`);
      } else if (settingsNotification === null) {
        errors.push('thread/settings/update: no thread/settings/updated notification for the requested effort');
      }
    } else {
      errors.push('thread/queue/*: skipped because thread/start produced no thread id');
      errors.push('thread/settings/update: skipped because thread/start produced no thread id');
    }

    // ---- process/spawn + process/kill (client-owned background process) ----
    const processHandle = `smoke-process-${Date.now()}`;
    const spawnReply = await connection.request('process/spawn', {
      processHandle,
      cwd: work,
      command: ['/bin/sh', '-c', 'sleep 30'],
    });
    const spawnResult = resultOf(spawnReply);
    report.steps.processSpawn = spawnResult !== null
      ? { ok: true, processHandle, result: spawnResult, cwd: work }
      : { ok: false, reply: spawnReply };
    if (spawnResult === null) {
      errors.push(describeError('process/spawn', spawnReply));
    }

    const killReply = await connection.request('process/kill', { processHandle });
    const killResult = resultOf(killReply);
    const exitedNotification = await connection.waitForNotification(
      'process/exited',
      (params) => params?.processHandle === processHandle,
    );
    report.steps.processKill = killResult !== null
      ? { ok: true, processHandle, result: killResult, exitedNotification }
      : { ok: false, reply: killReply };
    if (killResult === null) {
      errors.push(describeError('process/kill', killReply));
    }

    // ---- experimentalFeature/list (the live-settings capability probe) ----
    const featuresReply = await connection.request('experimentalFeature/list', {});
    const featuresResult = resultOf(featuresReply);
    const featureEntries = Array.isArray(featuresResult?.data) ? featuresResult.data : null;
    report.steps.experimentalFeatureList = featureEntries
      ? {
        ok: true,
        count: featureEntries.length,
        stepModelSwitching: featureEntries.find((/** @type {any} */ entry) => entry?.name === 'step_model_switching') ?? null,
      }
      : { ok: false, reply: featuresReply };
    if (!featureEntries) {
      errors.push(describeError('experimentalFeature/list', featuresReply));
    }
  } finally {
    await connection.stop();
  }

  // ---- negative arm: the capability gate is still a verbatim server-side refusal ----
  const noCapability = new AppServerConnection({ launcher, cwd: work, env }).start();
  try {
    const initReply = await handshake(noCapability, false);
    const initResult = resultOf(initReply);
    const threadReply = await noCapability.request('thread/start', { cwd: work });
    const threadId = resultOf(threadReply)?.thread?.id;
    if (!initResult || typeof threadId !== 'string') {
      errors.push(initResult ? 'noCapability: thread/start produced no thread id' : describeError('noCapability initialize', initReply));
      report.noCapability = { initialize: initResult ? { ok: true } : { ok: false, reply: initReply }, queueAdd: null };
    } else {
      const queueReply = await noCapability.request('thread/queue/add', {
        threadId,
        clientUserMessageId: `smoke-neg-${Date.now()}`,
        input: [{ type: 'text', text: 'must be refused', text_elements: [] }],
      });
      const error = queueReply?.error;
      const verbatimMatch = error?.message === EXPECTED_QUEUE_REJECTION;
      report.noCapability = {
        initialize: { ok: true, experimentalApi: false },
        queueAdd: error
          ? { ok: verbatimMatch, code: error.code ?? null, message: error.message ?? null, expected: EXPECTED_QUEUE_REJECTION }
          : { ok: false, result: queueReply?.result ?? null },
      };
      if (!error) {
        errors.push('noCapability: thread/queue/add was accepted without experimentalApi');
      } else if (!verbatimMatch) {
        errors.push(`noCapability: refusal text changed: ${JSON.stringify(error.message)}`);
      }
    }
  } finally {
    await noCapability.stop();
  }

  report.ok = errors.length === 0;
  return report;
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'codex-protocol-smoke-'));
  try {
    const launcher = resolveLauncher();
    const report = await runMatrix({ root, launcher });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) {
      process.stderr.write(`codex-protocol-smoke failed:\n${report.errors.map((line) => `- ${line}`).join('\n')}\n`);
      process.exitCode = 1;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((failure) => {
  process.stderr.write(`codex-protocol-smoke crashed: ${failure?.stack ?? String(failure)}\n`);
  process.exitCode = 1;
});
