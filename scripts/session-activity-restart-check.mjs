#!/usr/bin/env node
/**
 * End-to-end evidence for `gap-codex-restart-sync-last-activity`.
 *
 * WHAT IT PROVES, AND ON WHICH LEG. The unit criteria already pin the reader and the
 * synchronizer; this script drives the same story through a real server and a real page:
 *
 *   1. a Codex rollout is indexed on the first start with the activity its content records;
 *   2. the server is STOPPED, a newer activity row and a still-newer bookkeeping row are
 *      appended to that rollout, and the server is started again — the startup scan (the watcher
 *      ignores pre-existing files, so only the widened discovery filter can see this) must adopt
 *      the newer ACTIVITY time, keep the creation time, and keep one row per thread;
 *   3. a second restart is idempotent: the cursor moved past the file, the row does not move;
 *   4. the sidebar list draws that activity (the row's own `data-session-*` contract) and keeps
 *      it across a real browser reload and across switching to another session and back.
 *
 * WHY TWO BROWSER LEGS. `node scripts/ui-scenario.mjs` is the committed, reusable business
 * scenario and its JSON report + checkpoint screenshots are the artifact this task ships. The
 * additional in-process Playwright leg is the independent reading: it computes the expected
 * compact age from the timestamp and compares it to the age the row DREW, which the scenario
 * JSON cannot express without pinning a wall-clock-relative string.
 *
 * RUNTIME STATE GOES OUTSIDE THE REPO. The isolated instance's HOME (and its databases, logs and
 * settings) live under a fresh `/var/tmp/quay-codex-restart-*` directory, because a HOME inside
 * the worktree makes Vite's watcher follow the copied `~/.quay-fleet` self-link and die on
 * ELOOP. Only reports and screenshots are written back to `tmp/`.
 *
 * PREREQUISITES: `npm run build:server` in this worktree (the isolated instance runs
 * `dist-server/server/index.js`), plus a Playwright Chromium install. The script refuses with a
 * named failure rather than half-running when either is missing.
 *
 * USAGE: node scripts/session-activity-restart-check.mjs
 *   SESSION_ACTIVITY_RESTART_EVIDENCE_DIR  evidence directory (default <repo>/tmp/session-activity-restart)
 *   SESSION_ACTIVITY_RESTART_KEEP_RUNTIME  1 keeps the runtime directory for inspection
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { chromium } from 'playwright';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE_DIR = path.resolve(
  process.env.SESSION_ACTIVITY_RESTART_EVIDENCE_DIR ?? path.join(REPO_ROOT, 'tmp', 'session-activity-restart'),
);
const KEEP_RUNTIME = process.env.SESSION_ACTIVITY_RESTART_KEEP_RUNTIME === '1';
const TASK_ID = 'gap-codex-restart-sync-last-activity';
const SCENARIO_FILE = path.join(REPO_ROOT, 'scripts', 'ui-scenarios', 'session-activity-restart.json');

/**
 * The two threads the fixture writes, and the times their rows carry.
 *
 * DOWNTIME is the reading the list must show: it is appended while the server is down. MAINTENANCE
 * is later still but is a `token_count` row — the same file, a newer timestamp, and no activity —
 * so a list that moved to it would be reading the file rather than the conversation.
 */
const THREAD_TARGET = '0199aaaa-1111-7000-8000-aaaaaaaaaaaa';
const THREAD_OTHER = '0199bbbb-2222-7000-8000-bbbbbbbbbbbb';
const TARGET_TITLE = 'Restart sync target';
const OTHER_TITLE = 'Restart sync other';
const INITIAL_ACTIVITY = '2026-10-28T00:00:00.000Z';
const DOWNTIME_ACTIVITY = '2026-10-29T00:00:00.000Z';
const MAINTENANCE_RECORD = '2026-10-30T00:00:00.000Z';
const OTHER_ACTIVITY = '2026-10-27T00:00:00.000Z';
const OTHER_MAINTENANCE = '2026-10-30T06:00:00.000Z';

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {Array<{ name: string, ok: boolean, detail?: unknown }>} */
const checks = [];
/** @type {Error | null} */
let failure = null;

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {unknown} [detail]
 */
function recordCheck(name, ok, detail) {
  checks.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  process.stdout.write(`[activity-restart] ${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}\n`);
  if (!ok && failure === null) failure = new Error(`check failed: ${name}`);
}

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {unknown} [detail]
 */
function assertCheck(name, ok, detail) {
  recordCheck(name, ok, detail);
  if (!ok) throw new Error(`check failed: ${name}`);
}

/** A free loopback port, asked of the OS rather than guessed. */
/** @returns {Promise<number>} */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

/** Polls until `predicate` returns a truthy value; the value is returned. */
/**
 * @param {string} description
 * @param {() => any} predicate
 * @param {number} [timeoutMs]
 * @param {number} [intervalMs]
 * @returns {Promise<any>}
 */
async function waitFor(description, predicate, timeoutMs = 30_000, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  /** @type {Error | null} */
  let lastError = null;
  for (;;) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${description}${lastError === null ? '' : ` (last error: ${/** @type {Error} */ (lastError).message})`}`);
    }
    await sleep(intervalMs);
  }
}

/** Creates the runtime directory outside the repository, with a dot-free name (Vite-adjacent tools). */
function makeRuntimeDir() {
  const base = fs.existsSync('/var/tmp') ? '/var/tmp' : os.tmpdir();
  return fs.mkdtempSync(path.join(base, 'quay-codex-restart-'));
}

/**
 * @param {string} timestamp
 * @param {string} type
 * @param {unknown} payload
 */
function rolloutLine(timestamp, type, payload) {
  return JSON.stringify({ timestamp, type, payload });
}

/**
 * Seeds the two rollouts under `<home>/.codex/sessions`, plus the thread-name index.
 *
 * Each rollout starts with a `session_meta` row (the synchronizer reads the thread id, cwd and
 * sub-agent marker from it) and one activity row. Everything after that is appended by
 * {@link appendDowntimeRows} with the server stopped.
 */
/**
 * @param {string} homeDir
 * @param {string} projectPath
 */
function seedCodexHome(homeDir, projectPath) {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '10', '27');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });

  const targetPath = path.join(sessionsDir, `rollout-2026-10-27T23-59-00-${THREAD_TARGET}.jsonl`);
  const otherPath = path.join(sessionsDir, `rollout-2026-10-27T22-00-00-${THREAD_OTHER}.jsonl`);

  fs.writeFileSync(targetPath, [
    rolloutLine('2026-10-27T23:59:00.000Z', 'session_meta', {
      id: THREAD_TARGET,
      cwd: projectPath,
      thread_source: 'user',
      source: 'cli',
    }),
    rolloutLine(INITIAL_ACTIVITY, 'event_msg', { type: 'user_message', message: 'first prompt' }),
    rolloutLine('2026-10-28T00:05:00.000Z', 'event_msg', { type: 'thread_settings_applied', settings: {} }),
    '',
  ].join('\n'));

  fs.writeFileSync(otherPath, [
    rolloutLine('2026-10-27T21:59:00.000Z', 'session_meta', {
      id: THREAD_OTHER,
      cwd: projectPath,
      thread_source: 'user',
      source: 'cli',
    }),
    rolloutLine(OTHER_ACTIVITY, 'event_msg', { type: 'user_message', message: 'other prompt' }),
    '',
  ].join('\n'));

  fs.writeFileSync(
    path.join(homeDir, '.codex', 'session_index.jsonl'),
    [
      JSON.stringify({ id: THREAD_TARGET, thread_name: TARGET_TITLE }),
      JSON.stringify({ id: THREAD_OTHER, thread_name: OTHER_TITLE }),
      '',
    ].join('\n'),
  );

  return { targetPath, otherPath };
}

/**
 * Appends the rows the restart scan must find: a newer activity row (DOWNTIME_ACTIVITY) and a
 * still-newer bookkeeping row (MAINTENANCE_RECORD). Appending changes mtime, not birthtime.
 */
/** @param {string} targetPath */
function appendDowntimeRows(targetPath) {
  fs.appendFileSync(targetPath, [
    rolloutLine(DOWNTIME_ACTIVITY, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'done while down' }] }),
    rolloutLine(MAINTENANCE_RECORD, 'event_msg', { type: 'token_count', info: { total: 1 } }),
    '',
  ].join('\n'));
}

/** @param {string} otherPath */
function appendOtherMaintenance(otherPath) {
  fs.appendFileSync(otherPath, [
    rolloutLine(OTHER_MAINTENANCE, 'event_msg', { type: 'token_count', info: { total: 1 } }),
    '',
  ].join('\n'));
}

/** The isolated instance's environment; HOME is the whole point, so it is spelled out here. */
/**
 * @param {string} runtimeDir
 * @param {string} homeDir
 */
function isolatedEnv(runtimeDir, homeDir) {
  return {
    ...process.env,
    HOME: homeDir,
    ISOLATED_INSTANCE_STATE_DIR: path.join(runtimeDir, 'instance'),
    ISOLATED_INSTANCE_SOURCE_DB: path.join(runtimeDir, 'no-live-database.sqlite'),
    ISOLATED_INSTANCE_LOG_SETTLE_MS: '500',
  };
}

/**
 * @param {string} runtimeDir
 * @param {string} homeDir
 */
function startIsolated(runtimeDir, homeDir) {
  const result = spawnSync('bash', [path.join(REPO_ROOT, 'scripts', 'isolated-instance.sh'), 'start'], {
    cwd: REPO_ROOT,
    env: isolatedEnv(runtimeDir, homeDir),
    encoding: 'utf8',
    timeout: 120_000,
  });
  const lines = (result.stdout ?? '').trim().split('\n').filter(Boolean);
  let parsed = null;
  try {
    parsed = JSON.parse(lines.at(-1) ?? '{}');
  } catch {
    parsed = null;
  }
  if (result.status !== 0 || parsed?.ok !== true) {
    throw new Error(`isolated instance did not start (exit ${result.status}): ${(result.stderr ?? '').trim() || (result.stdout ?? '').trim()}`);
  }
  // The script prints the token's PATH, not the token: the secret stays in a 0600 file. Read it
  // from there rather than reconstructing a login, so this leg uses the same credential the
  // instance minted.
  const token = fs.readFileSync(parsed.token_file, 'utf8').trim();
  if (!token) {
    throw new Error(`isolated instance wrote no token to ${parsed.token_file}`);
  }
  return { ...parsed, token };
}

/**
 * @param {string} runtimeDir
 * @param {string} homeDir
 */
function stopIsolated(runtimeDir, homeDir) {
  spawnSync('bash', [path.join(REPO_ROOT, 'scripts', 'isolated-instance.sh'), 'stop'], {
    cwd: REPO_ROOT,
    env: isolatedEnv(runtimeDir, homeDir),
    encoding: 'utf8',
    timeout: 60_000,
  });
}

/**
 * Starts the same entrypoint `isolated-instance.sh` starts, against the SAME database, settings
 * and HOME, so a restart resumes the index and the scan cursor.
 *
 * WHY NOT THE SCRIPT AGAIN. Its auth flow is one-shot: on a database that already has a user,
 * `prepare_database` is skipped (there is no source DB to copy) and `/api/auth/register` answers
 * `AUTH_USER_ALREADY_CONFIGURED`, so a second start cannot mint a credential. A real restart does
 * not re-mint one either — the JWT secret lives in the database, so the token from the first
 * start stays valid. The isolation guards are reproduced here explicitly: the settings file that
 * disables resident restore, and host-wide scope sweeping off.
 *
 * @param {{ runtimeDir: string, homeDir: string, port: number, logName: string }} options
 * @returns {{ child: import('node:child_process').ChildProcess, logFile: string }}
 */
function startServerDirect({ runtimeDir, homeDir, port, logName }) {
  const logFile = path.join(runtimeDir, 'instance', logName);
  const logFd = fs.openSync(logFile, 'w');
  const child = spawn(process.execPath, [path.join(REPO_ROOT, 'dist-server', 'server', 'index.js')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      HOME: homeDir,
      SERVER_PORT: String(port),
      HOST: '127.0.0.1',
      DATABASE_PATH: path.join(runtimeDir, 'instance', 'auth.db'),
      SERVER_SETTINGS_PATH: path.join(runtimeDir, 'instance', 'server.settings.json'),
      CLAUDE_SESSION_SCOPE_SWEEP: 'off',
    },
    stdio: ['ignore', logFd, logFd],
  });
  fs.closeSync(logFd);
  return { child, logFile };
}

/**
 * Stops one directly-started server and waits for the process to be gone.
 * @param {import('node:child_process').ChildProcess | null} child
 */
async function stopServerDirect(child) {
  if (child === null || child.exitCode !== null) return;
  child.kill('SIGTERM');
  for (let attempt = 0; attempt < 100 && child.exitCode === null; attempt += 1) {
    await sleep(100);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}

/** Waits until the directly-started server answers `/health`.
 * @param {number} port
 */
async function waitForHealth(port) {
  await waitFor(`the server on port ${port} to answer /health`, async () => {
    const response = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
    return response?.ok === true;
  }, 60_000, 200);
}

/** Reads the API as the browser will: bearer token, no synchronization shortcut. */
/**
 * @param {string} baseUrl
 * @param {string} token
 * @returns {Promise<any[]>}
 */
async function fetchProjects(baseUrl, token) {
  const response = await fetch(`${baseUrl}/api/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`GET /api/projects -> ${response.status}`);
  }
  const body = /** @type {any} */ (await response.json());
  // `GET /api/projects` answers with the bare list; keep the envelope form accepted too so this
  // reader does not go silently empty if the route ever grows one.
  const projects = Array.isArray(body) ? body : body?.data?.projects;
  if (!Array.isArray(projects)) {
    throw new Error('GET /api/projects did not return a projects list');
  }
  return projects;
}

/**
 * @param {any[]} projects
 * @param {string} projectPath
 */
function findProject(projects, projectPath) {
  return projects.find((project) => project.path === projectPath || project.fullPath === projectPath) ?? null;
}

/** The API's own reading of one session: lastActivity is the column the sidebar formats. */
/**
 * @param {any[]} projects
 * @param {string} projectPath
 * @param {string} sessionId
 */
function findSession(projects, projectPath, sessionId) {
  const project = findProject(projects, projectPath);
  if (project === null) return null;
  return (project.sessions ?? []).find((/** @type {any} */ session) => session.id === sessionId) ?? null;
}

/**
 * @param {string} dbPath
 * @returns {Array<{ session_id: string, provider_session_id: string, project_path: string, jsonl_path: string | null, created_at: string, updated_at: string }>}
 */
function readRowsFromDatabase(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return /** @type {any} */ (db
      .prepare('SELECT session_id, provider_session_id, project_path, jsonl_path, created_at, updated_at FROM sessions WHERE provider = ? ORDER BY session_id')
      .all('codex'));
  } finally {
    db.close();
  }
}

/** @param {string} dbPath */
function readScanCursor(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const row = /** @type {any} */ (db.prepare('SELECT last_scanned_at FROM scan_state WHERE id = 1').get());
    // The column holds SQLite's timezone-less UTC form (`YYYY-MM-DD HH:MM:SS`). Parsing it as a
    // local date would shift the cursor by the host offset and make the comparison against an ISO
    // mtime lie — the app's own reader normalizes it the same way.
    return row?.last_scanned_at ? `${row.last_scanned_at.replace(' ', 'T')}Z` : null;
  } finally {
    db.close();
  }
}

/** The sidebar's own age formatting, so the expected text is computed from the same rule. */
/**
 * @param {string} dateString
 * @param {Date} now
 */
function compactAge(dateString, now) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.floor(Math.max(0, now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}hr` : `${Math.floor(hours / 24)}d`;
}

/** Waits for Vite's dev server and returns the served-transform readings this run depends on. */
/** @param {number} vitePort */
async function waitForVite(vitePort) {
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  await waitFor('Vite dev server', async () => {
    const response = await fetch(`${baseUrl}/`).catch(() => null);
    return response?.ok === true;
  }, 60_000, 500);

  // The page only proves THIS tree when its transform is the one compiled from these edits.
  const surface = await (await fetch(`${baseUrl}/src/modules/ui-scenario/scenarioSurface.ts`)).text();
  const sidebar = await (await fetch(`${baseUrl}/src/modules/sidebar/SidebarSessionItem.tsx`)).text();
  assertCheck('Vite serves the sidebar activity contract', sidebar.includes('data-session-last-activity'));
  assertCheck('Vite serves the scenario sidebar reading', surface.includes('sidebar: readSidebarReading()'));
  return baseUrl;
}

/** Reads the session rows as the sidebar draws them (the row-level contract, not class names). */
/**
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{ sessionId: string | null, lastActivity: string | null, ageText: string | null, text: string }>>}
 */
async function readSidebarRows(page) {
  return page.$$eval('#sidebar-panel [data-session-id]', (nodes) => nodes.map((node) => ({
    sessionId: node.getAttribute('data-session-id'),
    lastActivity: node.getAttribute('data-session-last-activity'),
    ageText: node.getAttribute('data-session-age'),
    text: node.textContent ?? '',
  })));
}

/**
 * The independent browser leg: real clicks, a real reload and a real switch, with the expected
 * age computed from the timestamp rather than copied from the app.
 */
/**
 * @param {string} baseUrl
 * @param {string} token
 * @param {string} projectName
 */
async function driveBrowser(baseUrl, token, projectName) {
  const browser = await chromium.launch({ headless: true });
  /** @type {string[]} */
  const screenshots = [];
  try {
    const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: 1280, height: 900 } });
    await context.addInitScript(({ authToken }) => {
      const storage = globalThis.localStorage;
      storage.setItem('auth-token', authToken);
      storage.setItem('ui-scenario', 'on');
      storage.setItem('userLanguage', 'en');
    }, { authToken: token });
    const page = await context.newPage();

    /** @param {string} name */
    const shot = async (name) => {
      const file = path.join(EVIDENCE_DIR, 'browser', `${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      screenshots.push(file);
    };

    await page.goto('/');
    const projectRow = page
      .locator('#sidebar-panel [data-testid="sidebar-project-row"]:visible')
      .filter({ hasText: projectName })
      .first();
    await projectRow.waitFor({ state: 'visible', timeout: 30_000 });
    await projectRow.click();
    const targetRow = page.locator(`#sidebar-panel [data-session-id="${THREAD_TARGET}"]`).first();
    await targetRow.waitFor({ state: 'visible', timeout: 30_000 });

    let rows = await readSidebarRows(page);
    assertCheck(
      'the list draws each session once',
      rows.length === 2 && new Set(rows.map((row) => row.sessionId)).size === rows.length,
      rows.map((row) => row.sessionId),
    );
    const target = rows.find((row) => row.sessionId === THREAD_TARGET);
    assertCheck(
      'the target row shows the downtime activity, not the later bookkeeping row',
      target?.lastActivity === DOWNTIME_ACTIVITY,
      { expected: DOWNTIME_ACTIVITY, actual: target?.lastActivity ?? null },
    );
    const before = compactAge(DOWNTIME_ACTIVITY, new Date());
    await sleep(1_000);
    const after = compactAge(DOWNTIME_ACTIVITY, new Date());
    assertCheck(
      'the visible age is the formatted downtime activity',
      target !== undefined && target.ageText !== null
        && [before, after].includes(target.ageText) && target.text.includes(target.ageText),
      { expected: [...new Set([before, after])], actual: target?.ageText ?? null },
    );
    const other = rows.find((row) => row.sessionId === THREAD_OTHER);
    assertCheck(
      'the other session keeps its own activity beside a newer bookkeeping row',
      other?.lastActivity === OTHER_ACTIVITY,
      { expected: OTHER_ACTIVITY, actual: other?.lastActivity ?? null },
    );
    await shot('01-sidebar-after-restart');

    await targetRow.click();
    await page.waitForURL((url) => url.pathname === `/session/${THREAD_TARGET}`, { timeout: 30_000 });
    await shot('02-target-session');

    await page.reload();
    await page.locator(`#sidebar-panel [data-session-id="${THREAD_TARGET}"]`).first().waitFor({ state: 'visible', timeout: 30_000 });
    rows = await readSidebarRows(page);
    assertCheck(
      'a real reload keeps the same two rows and the same activity',
      rows.length === 2 && rows.find((row) => row.sessionId === THREAD_TARGET)?.lastActivity === DOWNTIME_ACTIVITY,
      rows.map((row) => ({ sessionId: row.sessionId, lastActivity: row.lastActivity })),
    );
    await shot('03-after-reload');

    await page.locator(`#sidebar-panel [data-session-id="${THREAD_OTHER}"]`).first().click();
    await page.waitForURL((url) => url.pathname === `/session/${THREAD_OTHER}`, { timeout: 30_000 });
    rows = await readSidebarRows(page);
    assertCheck(
      'switching sessions keeps the target activity and one row per thread',
      rows.length === 2 && rows.find((row) => row.sessionId === THREAD_TARGET)?.lastActivity === DOWNTIME_ACTIVITY,
      rows.map((row) => ({ sessionId: row.sessionId, lastActivity: row.lastActivity })),
    );
    await shot('04-other-session');

    await page.locator(`#sidebar-panel [data-session-id="${THREAD_TARGET}"]`).first().click();
    await page.waitForURL((url) => url.pathname === `/session/${THREAD_TARGET}`, { timeout: 30_000 });
    rows = await readSidebarRows(page);
    assertCheck(
      'switching back still shows the downtime activity once',
      rows.length === 2
        && rows.filter((row) => row.sessionId === THREAD_TARGET).length === 1
        && rows.find((row) => row.sessionId === THREAD_TARGET)?.lastActivity === DOWNTIME_ACTIVITY,
      rows.map((row) => ({ sessionId: row.sessionId, lastActivity: row.lastActivity })),
    );
    await shot('05-back-to-target');

    await context.close();
    return { screenshots, rows };
  } finally {
    await browser.close();
  }
}

async function main() {
  for (const required of [
    path.join(REPO_ROOT, 'dist-server', 'server', 'index.js'),
    SCENARIO_FILE,
  ]) {
    if (!fs.existsSync(required)) {
      throw new Error(`missing ${required} — run \`npm run build:server\` first`);
    }
  }

  fs.rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(EVIDENCE_DIR, 'browser'), { recursive: true });
  fs.mkdirSync(path.join(EVIDENCE_DIR, 'scenario'), { recursive: true });

  const runtimeDir = makeRuntimeDir();
  const homeDir = path.join(runtimeDir, 'home');
  const projectPath = path.join(runtimeDir, 'codex-restart-project');
  fs.mkdirSync(homeDir, { recursive: true });

  let vite = null;
  let viteLog = '';
  /** @type {any} */
  let currentInstance = null;
  /** @type {import('node:child_process').ChildProcess | null} */
  let restartChild = null;
  let instanceMayExist = false;

  try {
    const { targetPath, otherPath } = seedCodexHome(homeDir, projectPath);
    const birthtime = fs.statSync(targetPath).birthtime.toISOString();

    // ---- start 1: the first start indexes the initial activity ----
    instanceMayExist = true;
    currentInstance = startIsolated(runtimeDir, homeDir);
    const apiBaseUrl = currentInstance.base_url;
    const apiToken = currentInstance.token;
    const instancePort = currentInstance.port;
    const dbPath = path.join(runtimeDir, 'instance', 'auth.db');
    const settingsPath = path.join(runtimeDir, 'instance', 'server.settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assertCheck(
      'the isolated instance disables resident restore, so a start is not a session replay',
      settings?.residentRestore?.enabled === false,
      settings?.residentRestore ?? null,
    );
    const initialSession = await waitFor('the first start boot scan to index the target', async () => {
      // Read the database BEFORE asking the API: a listing runs its own provider scan, so polling
      // the API first would prove the listing path, not the boot scan this check is about.
      const row = readRowsFromDatabase(dbPath).find((entry) => entry.provider_session_id === THREAD_TARGET);
      return row?.updated_at === INITIAL_ACTIVITY
        ? findSession(await fetchProjects(apiBaseUrl, apiToken), projectPath, THREAD_TARGET)
        : null;
    });
    assertCheck(
      'first start records the activity its content carries',
      initialSession.lastActivity === INITIAL_ACTIVITY,
      { expected: INITIAL_ACTIVITY, actual: initialSession.lastActivity },
    );
    assertCheck('first start indexes both threads', readRowsFromDatabase(dbPath).length === 2);

    // ---- downtime: the server is stopped, then the rollout grows ----
    stopIsolated(runtimeDir, homeDir);
    currentInstance = null;
    appendDowntimeRows(targetPath);
    appendOtherMaintenance(otherPath);
    const appendedMtime = fs.statSync(targetPath).mtime.toISOString();

    // ---- start 2 (the restart): the widened discovery filter must re-read this file ----
    instanceMayExist = true;
    restartChild = startServerDirect({ runtimeDir, homeDir, port: instancePort, logName: 'server-restart-1.log' }).child;
    await waitForHealth(instancePort);
    const restarted = await waitFor('the restart boot scan to adopt the downtime activity', async () => {
      // Same ordering as above: the database must already carry the downtime time before this
      // check asks the API, so only the boot scan can be the writer.
      const row = readRowsFromDatabase(dbPath).find((entry) => entry.provider_session_id === THREAD_TARGET);
      return row?.updated_at === DOWNTIME_ACTIVITY
        ? findSession(await fetchProjects(apiBaseUrl, apiToken), projectPath, THREAD_TARGET)
        : null;
    });
    assertCheck(
      'restart adopts the activity appended while the server was down',
      restarted.lastActivity === DOWNTIME_ACTIVITY,
      { expected: DOWNTIME_ACTIVITY, actual: restarted.lastActivity },
    );

    const rowsAfterRestart = readRowsFromDatabase(dbPath);
    const targetRow = rowsAfterRestart.find((row) => row.provider_session_id === THREAD_TARGET);
    assertCheck(
      'restart keeps exactly one row for the thread',
      rowsAfterRestart.filter((row) => row.provider_session_id === THREAD_TARGET).length === 1,
      rowsAfterRestart.map((row) => row.provider_session_id),
    );
    assertCheck(
      'restart keeps the creation time unchanged',
      targetRow?.created_at === birthtime,
      { expected: birthtime, actual: targetRow?.created_at ?? null },
    );

    // ---- start 3: a second restart must not move the row again ----
    const cursorAfterRestart = readScanCursor(dbPath);
    await stopServerDirect(restartChild);
    restartChild = startServerDirect({ runtimeDir, homeDir, port: instancePort, logName: 'server-restart-2.log' }).child;
    await waitForHealth(instancePort);
    await waitFor('the second restart scan to advance the cursor past the appended file', async () => {
      const cursor = readScanCursor(dbPath);
      return cursor !== null && new Date(cursor).getTime() > new Date(appendedMtime).getTime();
    });
    const projectsAfterSecondRestart = await fetchProjects(apiBaseUrl, apiToken);
    const afterSecondRestart = findSession(projectsAfterSecondRestart, projectPath, THREAD_TARGET);
    assertCheck(
      'a second restart is idempotent: same activity, one row',
      afterSecondRestart?.lastActivity === DOWNTIME_ACTIVITY
        && readRowsFromDatabase(dbPath).filter((row) => row.provider_session_id === THREAD_TARGET).length === 1,
      { lastActivity: afterSecondRestart?.lastActivity ?? null, cursorAfterRestart },
    );

    // ---- the page: the isolation instance above is the API, Vite serves the dev client ----
    const vitePort = await freePort();
    vite = spawn(process.execPath, [path.join(REPO_ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1'], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        SERVER_PORT: String(instancePort),
        VITE_PORT: String(vitePort),
      },
      // stdin stays open: Vite exits on stdin EOF, and a closed pipe here would look like a
      // server that died mid-run.
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    vite.stdout.on('data', (chunk) => { viteLog += chunk.toString(); });
    vite.stderr.on('data', (chunk) => { viteLog += chunk.toString(); });
    const baseUrl = await waitForVite(vitePort);

    const projectName = path.basename(projectPath);
    const apiProjects = await fetchProjects(apiBaseUrl, apiToken);

    // The committed scenario runner: one JSON report plus its checkpoint screenshots.
    const scenarioOut = path.join(EVIDENCE_DIR, 'scenario');
    const scenarioRun = spawnSync(process.execPath, [
      path.join(REPO_ROOT, 'scripts', 'ui-scenario.mjs'),
      SCENARIO_FILE,
      '--base-url', baseUrl,
      '--auth-token', apiToken,
      '--project', projectName,
      '--session', TARGET_TITLE,
      '--out', scenarioOut,
    ], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 300_000 });
    fs.writeFileSync(path.join(scenarioOut, 'stdout.json'), scenarioRun.stdout ?? '', 'utf8');
    fs.writeFileSync(path.join(scenarioOut, 'stderr.log'), scenarioRun.stderr ?? '', 'utf8');
    const scenarioReport = JSON.parse(fs.readFileSync(path.join(scenarioOut, 'report.json'), 'utf8'));
    const scenarioDefinition = JSON.parse(fs.readFileSync(SCENARIO_FILE, 'utf8'));
    assertCheck(
      'the scenario runner passes every step',
      scenarioRun.status === 0 && scenarioReport.ok === true && scenarioReport.failedStep === null,
      { exit: scenarioRun.status, failedStep: scenarioReport.failedStep, steps: scenarioReport.stepCount },
    );
    assertCheck(
      'the scenario ran the steps its file declares',
      scenarioReport.stepCount === scenarioDefinition.steps.length
        && scenarioReport.checkpoints.length === scenarioDefinition.steps.filter((/** @type {any} */ step) => step.checkpoint === true).length,
      { steps: scenarioReport.stepCount, checkpoints: scenarioReport.checkpoints.length },
    );

    const browserReading = await driveBrowser(baseUrl, apiToken, projectName);

    // The API reading the page is served from, recorded next to the page readings.
    const apiTarget = findSession(apiProjects, projectPath, THREAD_TARGET);
    assertCheck(
      'the API the page reads reports the same last activity',
      apiTarget?.lastActivity === DOWNTIME_ACTIVITY,
      { expected: DOWNTIME_ACTIVITY, actual: apiTarget?.lastActivity ?? null },
    );

    const browserReport = {
      task: TASK_ID,
      ok: checks.every((check) => check.ok),
      baseUrl,
      projectPath,
      projectName,
      targetThreadId: THREAD_TARGET,
      otherThreadId: THREAD_OTHER,
      expectedLastActivity: DOWNTIME_ACTIVITY,
      maintenanceRecord: MAINTENANCE_RECORD,
      initialActivity: INITIAL_ACTIVITY,
      birthtime,
      appendedMtime,
      cursorAfterRestart,
      api: { target: apiTarget, projects: apiProjects.map((/** @type {any} */ project) => ({ path: project.path, sessions: project.sessions })) },
      rows: browserReading.rows,
      checks,
      screenshots: browserReading.screenshots,
    };
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'browser', 'report.json'), `${JSON.stringify(browserReport, null, 2)}\n`, 'utf8');

    /** @type {string[]} */
    const manifestFiles = [];
    /** @param {string} dir */
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else manifestFiles.push(file);
      }
    };
    walk(EVIDENCE_DIR);
    /** @type {Record<string, string>} */
    const artifacts = {};
    for (const file of manifestFiles) {
      if (path.basename(file) === 'manifest.json') continue;
      artifacts[path.relative(EVIDENCE_DIR, file)] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    }
    const head = spawnSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'manifest.json'), `${JSON.stringify({
      task: TASK_ID,
      gitHead: head,
      generatedAt: new Date().toISOString(),
      scenario: 'session-activity-restart',
      artifacts,
    }, null, 2)}\n`, 'utf8');

    process.stdout.write(`[activity-restart] evidence in ${EVIDENCE_DIR}\n`);
    process.stdout.write(`[activity-restart] scenario steps=${scenarioReport.stepCount} checkpoints=${scenarioReport.checkpoints.length}\n`);
    process.stdout.write(`[activity-restart] browser checks=${checks.length} screenshots=${browserReading.screenshots.length}\n`);
    process.stdout.write('[activity-restart] PASS\n');
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    process.stderr.write(`[activity-restart] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    if (viteLog) process.stderr.write(`[activity-restart] vite log:\n${viteLog}\n`);
    for (const name of ['server-restart-1.log', 'server-restart-2.log', 'server.log']) {
      const file = path.join(runtimeDir, 'instance', name);
      if (fs.existsSync(file)) {
        process.stderr.write(`[activity-restart] ${name} (tail):\n${fs.readFileSync(file, 'utf8').slice(-4000)}\n`);
      }
    }
  } finally {
    if (vite !== null) {
      vite.kill('SIGTERM');
      await sleep(500);
      if (vite.exitCode === null) vite.kill('SIGKILL');
    }
    if (restartChild !== null) {
      await stopServerDirect(restartChild);
      restartChild = null;
    }
    if (instanceMayExist) {
      stopIsolated(runtimeDir, homeDir);
    }
    if (!KEEP_RUNTIME) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    } else {
      process.stdout.write(`[activity-restart] runtime kept at ${runtimeDir}\n`);
    }
  }

  if (failure !== null) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`[activity-restart] FAIL ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
