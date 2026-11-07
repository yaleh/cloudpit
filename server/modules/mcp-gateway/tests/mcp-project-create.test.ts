/**
 * gap-mcp-project-create-tool criterion: the `project_create` MCP tool.
 *
 * Everything below is real. A real express application carries the production
 * `/mcp` mount behind the production token middleware (`createMcpAuthMiddleware`
 * over a real `AccessTokensService`), the client is the MCP SDK's own `Client`
 * over `StreamableHTTPClientTransport`, the database is a real better-sqlite3
 * file in a temp directory, and the directories are real filesystem entries.
 *
 * The tool is handed the PRODUCTION services — `createProject` and
 * `findProjectByPath` from the projects module, the same pair `server/index.ts`
 * binds — so this criterion cannot pass over a test-only re-implementation of
 * path validation or directory creation. That is also why `WORKSPACES_ROOT` is
 * pointed at a real, non-forbidden fixture root BEFORE the aliased modules load:
 * `validateWorkspacePath` reads it once at module load, and the production
 * validator refuses anything under `/tmp` or another system directory.
 *
 * Readings, one leg each:
 *   (a) a fresh directory is registered: `created: true`, `outcome: 'created'`,
 *       a real project id and path, and the directory exists afterwards;
 *   (b) a repeat with the same path answers the SAME id with `created: false` /
 *       `outcome: 'existing'`, and the project table still holds one row;
 *   (c) `/etc` (system blacklist) and a path outside `WORKSPACES_ROOT`
 *       (containment) are refused as structured `INVALID_ARGUMENT` envelopes
 *       with the service's own code in `details.code`, and neither writes a row;
 *       a legal directory under the SAME fixture root is the positive control;
 *   (d) the id `project_create` answered is read by `projects_list` and accepted
 *       by `session_create({ project: <id> })`, whose session row stores the
 *       created path;
 *   (e) a token without `cloudcli:session:create` is refused
 *       (`INSUFFICIENT_SCOPE`) before the handler runs: no row, no directory;
 *   (f) a mount that supplies no `projectCreate` deps does not register the
 *       name, so an older mount's `tools/list` is unchanged.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

import type {
  McpControlAbortResult,
  McpControlAbortSeam,
  McpControlSeam,
  McpControlSendResult,
} from '../index.js';

// `auth.middleware.ts` resolves the JWT secret at module-load time and
// `shared/utils.ts` freezes `IS_PLATFORM` (and `WORKSPACES_ROOT`) on first
// import, so the environment is set before any aliased module is pulled in.
process.env.JWT_SECRET = 'mcp-project-create-test-secret';
delete process.env.VITE_IS_PLATFORM;

/**
 * The fixture root every workspace lives under.
 *
 * `validateWorkspacePath` refuses `/tmp` (the default `os.tmpdir()` on this
 * host) as a system directory, so the root is taken from the first writable
 * base that is NOT on that blacklist: `/var/tmp` on Linux/macOS, else the home
 * directory. It is created BEFORE the imports below because `WORKSPACES_ROOT`
 * is a module-load-time `const`.
 */
async function createWorkspaceRoot(): Promise<string> {
  for (const base of ['/var/tmp', os.homedir()]) {
    try {
      return await mkdtemp(path.join(base, 'mcp-project-create-'));
    } catch {
      // Base missing or not writable on this host — try the next.
    }
  }
  throw new Error('No writable, non-blacklisted base directory for the workspace fixture.');
}

const WORKSPACE_ROOT = await createWorkspaceRoot();
process.env.WORKSPACES_ROOT = WORKSPACE_ROOT;

const { closeConnection, getConnection, initializeDatabase, projectsDb, sessionsDb } = await import(
  '@/modules/database/index.js'
);
const { createAccessTokensService } = await import('@/modules/oauth/index.js');
const { sessionsService } = await import('@/modules/providers/index.js');
const { createProject, findProjectByPath } = await import('@/modules/projects/index.js');
const {
  MCP_GATEWAY_PATH,
  buildRunGet,
  buildSessionCreateDeps,
  createMcpAuthMiddleware,
  createMcpGatewayModule,
  mountMcpGateway,
} = await import('../index.js');

after(async () => {
  await rm(WORKSPACE_ROOT, { recursive: true, force: true });
});

type AnyRecord = Record<string, unknown>;

const USER_ONE = 1;
const NOW_MS = Date.parse('2026-11-07T12:00:00.000Z');

// --------------------------- HTTP: a node:http based fetch ---------------------------

/**
 * The SDK client's `fetch`, implemented over `node:http`.
 *
 * `listen(0)` on this host can land on a port undici refuses; this is the same
 * seam every sibling MCP criterion uses, so a bad port cannot red this file.
 */
const nodeFetch: FetchLike = (url, init) =>
  new Promise<Response>((resolve, reject) => {
    const target = new URL(String(url));
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    const body = init?.body === undefined || init?.body === null ? null : String(init.body);

    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init?.method ?? 'GET',
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (typeof value === 'string') {
              responseHeaders.set(key, value);
            } else if (Array.isArray(value)) {
              for (const entry of value) {
                responseHeaders.append(key, entry);
              }
            }
          }
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: responseHeaders }));
        });
      },
    );
    request.on('error', reject);
    if (body !== null) {
      request.write(body);
    }
    request.end();
  });

// --------------------------- the tool-call reading ---------------------------

type ToolCall = {
  isError: boolean;
  text: string;
  /** The success payload (or, for a failure, the structured envelope). */
  payload: AnyRecord | null;
  /** `structuredContent` as the wire carried it. */
  structured: AnyRecord | null;
};

function parseToolResult(result: unknown): ToolCall {
  const call = result as { content?: unknown; structuredContent?: unknown; isError?: boolean };
  const blocks = Array.isArray(call.content) ? call.content : [];
  const text = blocks
    .map((block) => (block as { type?: string; text?: string }).text ?? '')
    .join('');
  let parsed: AnyRecord | null = null;
  try {
    const value = JSON.parse(text) as unknown;
    parsed = typeof value === 'object' && value !== null ? (value as AnyRecord) : null;
  } catch {
    parsed = null;
  }
  const structured =
    typeof call.structuredContent === 'object' && call.structuredContent !== null
      ? (call.structuredContent as AnyRecord)
      : null;
  const isError = call.isError === true;
  return {
    isError,
    text,
    // A failure's envelope is `structuredContent`; a success's body is the text
    // JSON (the SDK also mirrors it into `structuredContent`). Preferring the
    // structured arm first keeps the failure reading independent of the text
    // encoding.
    payload: isError ? (structured ?? parsed) : (parsed ?? structured),
    structured,
  };
}

// --------------------------- harness ---------------------------

/** The control seam `session_create` is handed; a message-less create never calls it. */
function makeControl(): McpControlSeam & McpControlAbortSeam {
  return {
    async send(): Promise<McpControlSendResult> {
      return { ok: true, runId: 'run-unused', queued: false, queuedMessageUuid: null };
    },
    async abort(): Promise<McpControlAbortResult> {
      return { ok: false, aborted: false, code: 'SESSION_NOT_FOUND', message: 'No such session.' };
    },
  };
}

/** AC-248's `run_get` deps, minimal but real-shaped so registration typechecks. */
function runGetSeam() {
  return {
    deps: {
      activity: { snapshot: () => null },
      sessions: { fetchHistory: async () => ({ messages: [] }) },
      now: () => NOW_MS,
      sleep: async () => undefined,
      bootId: () => 'project-create-boot',
    },
    build: buildRunGet,
  };
}

type Harness = {
  operator: Client;
  readOnly: Client;
  call: (client: Client, name: string, args?: AnyRecord) => Promise<ToolCall>;
};

type HarnessOptions = {
  /**
   * Whether the mount supplies `projectCreate` deps. False is the (f) negative
   * control: an older mount must keep its exact `tools/list`.
   */
  withProjectCreate?: boolean;
};

/**
 * Runs `run` against a fresh real database, the production project services and
 * the production `/mcp` assembly.
 */
async function withGateway(
  run: (harness: Harness) => Promise<void>,
  options: HarnessOptions = {},
): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const dbDirectory = await mkdtemp(path.join(os.tmpdir(), 'mcp-project-create-db-'));

  closeConnection();
  process.env.DATABASE_PATH = path.join(dbDirectory, 'project-create.db');
  await initializeDatabase();
  getConnection()
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(USER_ONE, 'owner', 'hash');

  const tokens = createAccessTokensService({ now: () => new Date(NOW_MS) });
  const operatorToken = tokens.issueToken({
    userId: USER_ONE,
    name: 'project-create-operator',
    scopes: ['cloudpit:read', 'cloudpit:session:create'],
    expiresInDays: 30,
  });
  const readOnlyToken = tokens.issueToken({
    userId: USER_ONE,
    name: 'project-create-read-only',
    scopes: ['cloudpit:read'],
    expiresInDays: 30,
  });
  if (!operatorToken.ok || !readOnlyToken.ok) {
    throw new Error('the harness must mint both tokens');
  }

  const control = makeControl();
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountMcpGateway(
    app,
    createMcpGatewayModule({
      env: { MCP_ENABLED: 'true' },
      authorize: createMcpAuthMiddleware(tokens),
      control,
      // The read half `projects_list` needs; `createMcpGatewayModule` fills the
      // projects bag and the run registry itself, exactly as production does.
      readTools: {
        sessions: sessionsService,
        hosts: { snapshot: () => [], liveHostForSession: () => null },
        now: () => NOW_MS,
      },
      writeTools: {
        runGet: runGetSeam(),
        // The SAME production builder `server/index.ts` calls.
        sessionCreate: buildSessionCreateDeps({ projects: projectsDb, sessions: sessionsService, control }),
        // The SAME production pair `server/index.ts` binds (a) through the
        // projects barrel, so this criterion drives the real validator and the
        // real directory creation.
        ...(options.withProjectCreate === false ? {} : { projectCreate: { createProject, findProjectByPath } }),
      },
      // The production target gate, reading the same two stores.
      resolveDeps: {
        listProjects: () =>
          projectsDb.getProjectPaths().map((row) => ({
            id: row.project_id,
            title: row.custom_project_name?.trim() || path.basename(row.project_path),
            path: row.project_path,
          })),
        listSessions: () =>
          sessionsDb.getAllSessions().map((row) => ({
            id: row.session_id,
            title: row.custom_name?.trim() || row.session_id,
          })),
      },
    }),
  );

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const endpoint = new URL(`http://127.0.0.1:${address.port}${MCP_GATEWAY_PATH}`);

  const connect = async (token: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> => {
    const transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
      fetch: nodeFetch,
    });
    const client = new Client({ name: 'project-create-criterion', version: '0.0.0' });
    await client.connect(transport);
    return { client, transport };
  };

  const operator = await connect(operatorToken.token.token);
  const readOnly = await connect(readOnlyToken.token.token);

  const call = async (client: Client, name: string, args: AnyRecord = {}): Promise<ToolCall> =>
    parseToolResult(await client.callTool({ name, arguments: args } as Parameters<Client['callTool']>[0]));

  try {
    await run({ operator: operator.client, readOnly: readOnly.client, call });
  } finally {
    await operator.transport.close().catch(() => undefined);
    await readOnly.transport.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(dbDirectory, { recursive: true, force: true });
  }
}

/** How many project rows the real table holds right now. */
function projectRowCount(): number {
  const row = getConnection().prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number };
  return row.count;
}

/** How many project rows store exactly `projectPath`. */
function projectRowsAt(projectPath: string): number {
  const row = getConnection()
    .prepare('SELECT COUNT(*) AS count FROM projects WHERE project_path = ?')
    .get(projectPath) as { count: number };
  return row.count;
}

/** Whether a filesystem path exists (any entry type). */
async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

// --------------------------- (a) create ---------------------------

test('(a) project_create registers a fresh directory and answers its projectId and path', { concurrency: false }, async () => {
  await withGateway(async (harness) => {
    const target = path.join(WORKSPACE_ROOT, 'fresh-project');
    assert.equal(await exists(target), false, 'the fixture directory must not exist before the call');

    const created = await harness.call(harness.operator, 'project_create', { path: target, name: 'Fresh Project' });
    console.log(`[a] project_create -> isError=${created.isError} payload=${JSON.stringify(created.payload)} text=${JSON.stringify(created.text)}`);
    assert.equal(created.isError, false, 'creating a legal project must not error');

    const payload = created.payload as AnyRecord;
    assert.equal(typeof payload?.projectId, 'string');
    assert.ok(String(payload.projectId).length > 0, 'the answer must name the project id');
    assert.equal(payload.created, true, 'a new row must report created: true');
    assert.equal(payload.outcome, 'created');
    assert.equal(payload.displayName, 'Fresh Project', 'the optional name must reach the stored display name');

    // `path` is the service's normalized/realpath form; the fixture root itself
    // may be a symlinked base (macOS /var), so compare against realpath.
    const expectedPath = await realpath(target);
    assert.equal(payload.path, expectedPath, 'the answer path must be the stored project path');
    assert.equal(payload.fullPath, expectedPath);

    // Real filesystem: the directory now exists, and the real SQLite table holds
    // exactly the row the answer described.
    assert.equal(await exists(target), true, 'project_create must create the directory');
    const row = projectsDb.getProjectPath(expectedPath);
    console.log(`[a] db row = ${JSON.stringify(row)}`);
    assert.ok(row, 'the project row must be persisted');
    assert.equal(row?.project_id, payload.projectId, 'the answered id must be the persisted row id');
    assert.equal(projectRowsAt(expectedPath), 1, 'exactly one row must be written');
  });
});

// --------------------------- (b) idempotency ---------------------------

test('(b) a repeat with the same path answers the same id, created:false, existing, one row', { concurrency: false }, async () => {
  await withGateway(async (harness) => {
    const target = path.join(WORKSPACE_ROOT, 'repeat-project');

    const first = await harness.call(harness.operator, 'project_create', { path: target });
    assert.equal(first.isError, false);
    const firstPayload = first.payload as AnyRecord;
    console.log(`[b] first -> ${JSON.stringify(firstPayload)}`);

    const second = await harness.call(harness.operator, 'project_create', { path: target });
    console.log(`[b] second -> isError=${second.isError} payload=${JSON.stringify(second.payload)}`);
    assert.equal(second.isError, false, 'a repeated path must be an idempotent reading, not an error');

    const secondPayload = second.payload as AnyRecord;
    assert.equal(secondPayload.projectId, firstPayload.projectId, 'the same path must answer the same project id');
    assert.equal(secondPayload.path, firstPayload.path);
    assert.equal(secondPayload.created, false, 'the repeat created nothing');
    assert.equal(secondPayload.outcome, 'existing');

    const storedRow = projectsDb.getProjectPath(String(firstPayload.path));
    assert.equal(storedRow?.project_id, firstPayload.projectId);
    assert.equal(projectRowsAt(String(firstPayload.path)), 1, 'the repeat must not insert a second row');
    assert.equal(projectRowCount(), 1, 'the table must still hold the one project');
  });
});

// --------------------------- (c) safety ---------------------------

test('(c) /etc and an out-of-root path are refused with no row; a legal directory succeeds', { concurrency: false }, async () => {
  await withGateway(async (harness) => {
    const before = projectRowCount();

    // A system directory the production validator blacklists outright.
    const system = await harness.call(harness.operator, 'project_create', { path: '/etc' });
    console.log(`[c] /etc -> isError=${system.isError} envelope=${JSON.stringify(system.structured)} text=${JSON.stringify(system.text)}`);
    assert.equal(system.isError, true, '/etc must be refused');
    assert.equal(system.structured?.code, 'INVALID_ARGUMENT', 'a refused path must be a structured INVALID_ARGUMENT envelope');
    const systemDetails = system.structured?.details as AnyRecord | undefined;
    assert.equal(systemDetails?.code, 'INVALID_PROJECT_PATH', "the service's own refusal code must ride in details.code");

    // A path OUTSIDE the allowed workspace root: containment, not the blacklist.
    const outside = path.join(WORKSPACE_ROOT, '..', `outside-${path.basename(WORKSPACE_ROOT)}`);
    const escaped = await harness.call(harness.operator, 'project_create', { path: outside });
    console.log(`[c] outside -> isError=${escaped.isError} envelope=${JSON.stringify(escaped.structured)} text=${JSON.stringify(escaped.text)}`);
    assert.equal(escaped.isError, true, 'a path outside WORKSPACES_ROOT must be refused');
    assert.equal(escaped.structured?.code, 'INVALID_ARGUMENT');
    const escapedDetails = escaped.structured?.details as AnyRecord | undefined;
    assert.equal(escapedDetails?.code, 'INVALID_PROJECT_PATH');
    assert.equal(await exists(outside), false, 'a refused path must leave no directory behind');

    assert.equal(projectRowCount(), before, 'neither refusal may write a row');
    assert.equal(projectsDb.getProjectPath('/etc'), null, 'the system path must not be registered');
    assert.equal(projectsDb.getProjectPath(outside), null, 'the outside path must not be registered');

    // Positive control: the SAME fixture root that just refused a path outside
    // it accepts a directory inside it, so the two refusals above are not an
    // always-false validator.
    const legal = path.join(WORKSPACE_ROOT, 'legal-project');
    const positive = await harness.call(harness.operator, 'project_create', { path: legal });
    console.log(`[c] legal control -> isError=${positive.isError} payload=${JSON.stringify(positive.payload)}`);
    assert.equal(positive.isError, false, 'a legal directory under the fixture root must succeed');
    assert.equal(projectRowCount(), before + 1, 'only the legal call may add a row');
  });
});

// --------------------------- (d) usability ---------------------------

test('(d) the created id is read by projects_list and accepted by session_create', { concurrency: false }, async () => {
  await withGateway(async (harness) => {
    const target = path.join(WORKSPACE_ROOT, 'usable-project');
    const created = await harness.call(harness.operator, 'project_create', { path: target, name: 'Usable Project' });
    assert.equal(created.isError, false, 'the setup create must succeed');
    const createdPayload = created.payload as AnyRecord;
    const projectId = String(createdPayload.projectId);
    const projectPath = String(createdPayload.path);
    console.log(`[d] created id=${projectId} path=${projectPath}`);

    // 1. The id is in projects_list, and it carries the created path.
    const listed = await harness.call(harness.operator, 'projects_list');
    assert.equal(listed.isError, false, 'projects_list must read the store');
    const projects = ((listed.payload?.projects as AnyRecord[] | undefined) ?? []);
    console.log(`[d] projects_list = ${JSON.stringify(projects)}`);
    const listedProject = projects.find((project) => project.id === projectId);
    assert.ok(listedProject, 'projects_list must contain the created project id');
    assert.equal(listedProject?.path, projectPath, 'projects_list must report the created path');

    // 2. session_create resolves the same id through AC-246's gate and stores
    //    that path on the session row.
    const session = await harness.call(harness.operator, 'session_create', { project: projectId });
    console.log(`[d] session_create -> isError=${session.isError} payload=${JSON.stringify(session.payload)} text=${JSON.stringify(session.text)}`);
    assert.equal(session.isError, false, 'session_create must accept the created project id');
    const sessionId = String((session.payload as AnyRecord)?.sessionId ?? '');
    assert.ok(sessionId.length > 0, 'session_create must answer the session id');

    const row = sessionsDb.getSessionById(sessionId);
    console.log(`[d] session row project_path=${JSON.stringify(row?.project_path)}`);
    assert.ok(row, 'the session row must exist');
    assert.equal(row?.project_path, projectPath, "the session row's project_path must be the created project path");
  });
});

// --------------------------- (e) permission ---------------------------

test('(e) a token without cloudcli:session:create is refused and writes nothing', { concurrency: false }, async () => {
  await withGateway(async (harness) => {
    const target = path.join(WORKSPACE_ROOT, 'forbidden-project');
    const before = projectRowCount();

    const denied = await harness.call(harness.readOnly, 'project_create', { path: target });
    console.log(`[e] read-only token -> isError=${denied.isError} envelope=${JSON.stringify(denied.structured)}`);
    assert.equal(denied.isError, true, 'a token without the create scope must be refused');
    assert.equal(denied.structured?.code, 'INSUFFICIENT_SCOPE', 'the refusal must be the audited scope check');
    const required = (denied.structured?.details as AnyRecord | undefined)?.requiredScopes;
    assert.deepEqual(required, ['cloudcli:session:create'], 'the refusal must name the missing scope');

    assert.equal(projectRowCount(), before, 'a refused call must not write a project row');
    assert.equal(await exists(target), false, 'a refused call must not create the directory (the handler never ran)');
  });
});

// --------------------------- (f) absent deps ---------------------------

test('(f) a mount without projectCreate deps does not register the tool name', { concurrency: false }, async () => {
  await withGateway(async (harness) => {
    const listed = await harness.operator.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    console.log(`[f] tools/list = ${JSON.stringify(names)}`);
    assert.ok(!names.includes('project_create'), 'an unwired mount must keep its exact old tools/list');
    // Positive control: the mount is not empty — the five stage-4 names are there.
    for (const name of ['session_send', 'session_create', 'session_interrupt', 'session_start', 'session_close']) {
      assert.ok(names.includes(name), `${name} must still be registered`);
    }
  }, { withProjectCreate: false });
});
