/**
 * knowledge-effective-config-proof — `effective_config` proves THIS operation's
 * actual request and response, field by field, through the REAL production
 * `/mcp` mount.
 *
 * Nothing here scans source for a symbol. Each leg boots an express app with
 * the production mount and the production token middleware, connects the MCP
 * SDK's own `Client` over `StreamableHTTPClientTransport`, and reads through
 * `createKnowledgeFactSource` — the same wiring `server/index.ts` installs. The
 * database is a real better-sqlite3 file in a temp directory, the transcript is
 * a real JSONL file on disk, and the run/host fixtures are the process's real
 * seam shapes (`chatRunRegistry`, `sessionHostManager`).
 *
 * The positive leg proves the reading can be VERIFIED: one concrete Claude
 * operation whose request model/effort are read back from the provider's own
 * transcript, whose response names the message that answered, with real
 * `sourceRef`s, and whose permission mode is declared unavailable rather than
 * echoed from the stored row.
 *
 * The negative legs prove each substitute is REFUSED as proof of "this
 * operation's configuration took effect":
 *   (b) stored DB row only (no run, no live host);
 *   (c) the next turn (a completed run, so no in-flight operation);
 *   (d) a live process with no transcript read-back;
 *   (e) a run created by an older process boot;
 *   (f) a response older than the operation;
 *   (g) a transcript turn that records no effort;
 *   (h) an expectation that contradicts the readable actual;
 *   (i) a provider with no request/response read-back source;
 *   (j) a response older than the live process;
 *   (k) an unreadable transcript (reported as a read error, never an empty one);
 *   (l) a caller naming an operation that is not the current one.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/mcp-gateway/tests/knowledge-effective-config-proof.test.ts
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

// `auth.middleware.ts` resolves the JWT secret at module-load time and
// `shared/utils.ts` freezes IS_PLATFORM on first import, so the environment is
// set before any aliased module is pulled in.
process.env.JWT_SECRET = 'knowledge-effective-config-proof-secret';
delete process.env.VITE_IS_PLATFORM;

const { closeConnection, getConnection, initializeDatabase, projectsDb, sessionsDb } = await import(
  '@/modules/database/index.js'
);
const { createAccessTokensService } = await import('@/modules/oauth/index.js');
const { sessionsService } = await import('@/modules/providers/index.js');
// The composition root is a top-level wiring file with no barrel: this test
// assembles the gateway from the SAME wiring the executable uses.
// eslint-disable-next-line boundaries/no-unknown
const { createKnowledgeFactSource } = await import('../../../knowledge-facts-wiring.js');
const {
  KNOWLEDGE_FACT_CONTRACT,
  KNOWLEDGE_FACT_CONTRACT_VERSION,
  KNOWLEDGE_FACT_PROJECT,
} = await import('@/shared/knowledge-facts.js');
const { MCP_GATEWAY_PATH, createMcpAuthMiddleware, mountMcpGateway } = await import('../index.js');

type AnyRecord = Record<string, unknown>;

// --------------------------- fixture identities ---------------------------

const USER_ONE = 1;
const BASE_MS = Date.parse('2026-11-01T12:00:00.000Z');
const RUN_START_MS = BASE_MS - 30_000; // 11:59:30
const RESPONSE_MS = BASE_MS - 10_000; // 11:59:50

const SESSION = 'knowledge-effective-config-session';
const PROJECT = '/tmp/knowledge-effective-config-project';
const RUN_ID = 'effective-config-run-1';
const BUILD_ID = 'effective-config-build-1';
const BOOT_ID = 'effective-config-boot-1';
const GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const SERVER_VERSION = '1.41.0';

const CLAUDE_MODEL = 'claude-sonnet-5-5';
const CODEX_MODEL = 'gpt-5.5-codex';

function storedModel(provider: string): string {
  return provider === 'codex' ? CODEX_MODEL : CLAUDE_MODEL;
}

// --------------------------- HTTP: a node:http based fetch ---------------------------

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
              for (const entry of value) responseHeaders.append(key, entry);
            }
          }
          resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers: responseHeaders }));
        });
      },
    );
    request.on('error', reject);
    if (body !== null) request.write(body);
    request.end();
  });

// --------------------------- harness ---------------------------

type ToolCall = { isError: boolean; text: string; payload: AnyRecord | null };

function parseToolResult(result: unknown): ToolCall {
  const call = result as { content?: unknown; isError?: boolean; structuredContent?: unknown };
  const blocks = Array.isArray(call.content) ? call.content : [];
  const text = blocks.map((block) => (block as { type?: string; text?: string }).text ?? '').join('');
  let payload: AnyRecord | null = null;
  if (call.isError === true && typeof call.structuredContent === 'object' && call.structuredContent !== null) {
    payload = call.structuredContent as AnyRecord;
  } else {
    try {
      const parsed = JSON.parse(text) as unknown;
      payload = typeof parsed === 'object' && parsed !== null ? (parsed as AnyRecord) : null;
    } catch {
      payload = null;
    }
  }
  return { isError: call.isError === true, text, payload };
}

type Harness = { call: (name: string, args?: AnyRecord) => Promise<ToolCall> };

/**
 * Which world this leg builds. Every option changes a SOURCE, never the answer:
 * the reader must reach the same refusal from each missing or stale source.
 */
type Arms = {
  provider?: string;
  /** `running` is the only state that establishes an in-flight operation. */
  run?: 'running' | 'completed' | 'boot-mismatch' | 'none';
  /** What the provider's transcript on disk contains. */
  transcript?: 'current' | 'old' | 'no-effort' | 'missing' | 'none';
  /** Where the live host sits relative to the observed response. */
  host?: 'current' | 'after-response' | 'none';
};

type HarnessRun = (harness: Harness, transcriptPath: string) => Promise<void>;

function makeFactSource(transcriptPath: string, arms: Arms) {
  return createKnowledgeFactSource({
    sessions: {
      getSessionById: (sessionId: string) => sessionsDb.getSessionById(sessionId),
      getAllSessions: () => sessionsDb.getAllSessions(),
      fetchHistory: async () => ({ messages: [] }),
    },
    ...(arms.host === 'none'
      ? {}
      : {
          hosts: {
            liveHostForSession: (sessionId: string) =>
              sessionId === SESSION
                ? {
                    pid: 4242,
                    startedAt:
                      arms.host === 'after-response'
                        ? RESPONSE_MS + 5_000
                        : RUN_START_MS - 60_000,
                  }
                : null,
          },
        }),
    runs: {
      listRunningRuns: () => [],
      getRun: (sessionId: string) => {
        if (sessionId !== SESSION) return undefined;
        if (arms.run === 'none') return undefined;
        return {
          runId: RUN_ID,
          startedAt: RUN_START_MS,
          status: arms.run === 'completed' ? 'completed' : 'running',
          providerSessionId: SESSION,
          bootId: arms.run === 'boot-mismatch' ? 'effective-config-boot-previous' : BOOT_ID,
        };
      },
    },
    projects: {
      getProjectIdByPath: (projectPath: string) => projectsDb.getProjectPath(projectPath)?.project_id ?? null,
    },
    buildId: BUILD_ID,
    gitSha: GIT_SHA,
    builtAt: '2026-10-31T08:00:00.000Z',
    serverVersion: SERVER_VERSION,
    bootId: BOOT_ID,
    now: () => BASE_MS,
    eventsDir: path.join(path.dirname(transcriptPath), 'events'),
  });
}

/** One assistant transcript line: both sides of the same request. */
function turnLine(provider: string, overrides: AnyRecord = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: new Date(RESPONSE_MS).toISOString(),
    sessionId: SESSION,
    uuid: 'assistant-turn-1',
    requestRef: 'request-1',
    requestedModel: storedModel(provider),
    effort: 'high',
    message: { id: 'message-1', model: storedModel(provider) },
    ...overrides,
  });
}

/**
 * Runs `run` against a fresh temp database, a fresh transcript file and the
 * production `/mcp` mount. `transcriptPath` is handed back so a leg can assert
 * the real `sourceRef` the reading kept.
 */
async function withHarness(arms: Arms, run: HarnessRun): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'knowledge-effective-config-'));
  const transcriptPath = path.join(tempDirectory, 'session.jsonl');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'knowledge-effective-config.db');
  await initializeDatabase();
  getConnection()
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(USER_ONE, 'owner', 'hash');

  const provider = arms.provider ?? 'claude';
  sessionsDb.createAppSession(SESSION, provider, PROJECT, 'Session', {
    model: storedModel(provider),
    effort: 'high',
    permissionMode: 'default',
    lifecycleMode: 'resident',
  });

  const transcript = arms.transcript ?? 'current';
  if (transcript !== 'none') {
    const body =
      transcript === 'old'
        ? `${turnLine(provider, { timestamp: new Date(RUN_START_MS - 10_000).toISOString() })}\n`
        : transcript === 'no-effort'
          ? `${turnLine(provider, { effort: undefined })}\n`
          : `${turnLine(provider)}\n`;
    const writtenPath = transcript === 'missing' ? path.join(tempDirectory, 'absent.jsonl') : transcriptPath;
    if (transcript !== 'missing') await writeFile(writtenPath, body, 'utf8');
    getConnection()
      .prepare('UPDATE sessions SET jsonl_path = ?, provider_session_id = ? WHERE session_id = ?')
      .run(writtenPath, SESSION, SESSION);
  }

  const tokens = createAccessTokensService({ now: () => new Date(BASE_MS) });
  const readToken = tokens.issueToken({
    userId: USER_ONE,
    name: 'knowledge-effective-config-proof',
    scopes: ['cloudcli:read'],
    expiresInDays: 30,
  });
  if (!readToken.ok) throw new Error('the harness must mint a read token');

  const facts = makeFactSource(transcriptPath, arms);

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  mountMcpGateway(app, {
    env: { MCP_ENABLED: 'true' },
    authorize: createMcpAuthMiddleware(tokens),
    readTools: {
      projects: {
        getProjectsWithSessions: async () => [],
        getArchivedProjectsWithSessions: async () => [],
        getProjectSessionsPage: async (projectId: string) => ({ projectId, sessions: [] }),
        getProjectIdByPath: (projectPath: string) =>
          projectsDb.getProjectPath(projectPath)?.project_id ?? null,
      },
      sessions: sessionsService,
      hosts: { snapshot: () => [], liveHostForSession: () => null },
      runs: { listRunningRuns: () => [] },
      knowledgeFacts: { facts },
      now: () => BASE_MS,
    },
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const endpoint = new URL(`http://127.0.0.1:${address.port}${MCP_GATEWAY_PATH}`);

  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${readToken.token.token}` } },
    fetch: nodeFetch,
  });
  const client = new Client({ name: 'knowledge-effective-config-proof', version: '0.0.0' });
  await client.connect(transport);

  const harness: Harness = {
    call: async (name, args = {}) =>
      parseToolResult(await client.callTool({ name, arguments: args } as Parameters<Client['callTool']>[0])),
  };

  try {
    await run(harness, transcriptPath);
  } finally {
    await transport.close().catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

// --------------------------- reading helpers ---------------------------

function readingOf(call: ToolCall): AnyRecord {
  assert.equal(call.isError, false, `knowledge_facts must succeed, saw: ${call.text}`);
  assert.ok(call.payload !== null, 'a success carries a JSON payload');
  const reading = call.payload!.reading as AnyRecord | undefined;
  assert.ok(reading !== undefined && typeof reading === 'object' && reading !== null, 'the payload carries a reading');
  return reading!;
}

function evidenceValue(field: AnyRecord): AnyRecord {
  assert.equal(field.state, 'evidence', `expected evidence, saw ${JSON.stringify(field)}`);
  return field.value as AnyRecord;
}

function unknownOf(reading: AnyRecord): string[] {
  return reading.unknown as string[];
}

/** The default expectation: exactly the readable fields, nothing invented. */
function expected(provider = 'claude'): AnyRecord {
  return { model: storedModel(provider), effort: 'high' };
}

function read(harness: Harness, extra: AnyRecord = {}): Promise<ToolCall> {
  return harness.call('knowledge_facts', {
    kind: 'effective_config',
    session: SESSION,
    expected: expected(),
    ...extra,
  });
}

// --------------------------- the criterion ---------------------------

test('(a) a concrete Claude operation is verified from its own request/response, with real refs and an explicit capability gap', async () => {
  await withHarness({}, async (harness, transcriptPath) => {
    const call = await read(harness);
    const reading = readingOf(call);

    const identity = call.payload!.identity as AnyRecord;
    assert.equal(identity.contract, KNOWLEDGE_FACT_CONTRACT);
    assert.equal(identity.version, KNOWLEDGE_FACT_CONTRACT_VERSION);
    assert.equal(identity.project, KNOWLEDGE_FACT_PROJECT);
    assert.equal(identity.buildId, BUILD_ID);
    assert.equal(identity.bootId, BOOT_ID);
    assert.equal(identity.observedAt, new Date(BASE_MS).toISOString());

    assert.equal(reading.verified, true, 'the operation and every stated field are readable evidence');
    assert.deepEqual(unknownOf(reading), []);

    // The operation is the in-flight run, not the next turn and not the row.
    const operation = evidenceValue(reading.operation as AnyRecord);
    assert.equal(operation.id, RUN_ID);
    assert.equal(operation.bootId, BOOT_ID);
    assert.equal(operation.at, new Date(RUN_START_MS).toISOString());
    assert.equal((reading.operation as AnyRecord).source, 'chat-runs');

    // The request is what the provider recorded for THAT turn, with the file
    // and line identity preserved rather than a synthesized value.
    const request = evidenceValue(reading.actualRequest as AnyRecord);
    assert.equal(request.model, CLAUDE_MODEL);
    assert.equal(request.effort, 'high');
    assert.equal(request.requestRef, 'request-1');
    assert.equal((reading.actualRequest as AnyRecord).source, 'sessions.transcript');
    assert.equal((reading.actualRequest as AnyRecord).sourceRef, `${transcriptPath}#assistant-turn-1`);
    assert.equal((reading.actualRequest as AnyRecord).observedAt, new Date(RESPONSE_MS).toISOString());

    // And the response is the message that answered it.
    const response = evidenceValue(reading.actualResponse as AnyRecord);
    assert.equal(response.model, CLAUDE_MODEL);
    assert.equal(response.responseId, 'message-1');
    assert.equal(response.at, new Date(RESPONSE_MS).toISOString());

    const fields = reading.fields as AnyRecord;
    assert.equal((fields.model as AnyRecord).state, 'verified');
    assert.equal((fields.model as AnyRecord).actual, CLAUDE_MODEL);
    assert.equal((fields.effort as AnyRecord).state, 'verified');
    assert.equal((fields.permissionMode as AnyRecord).state, 'unknown');
    assert.match(String((fields.permissionMode as AnyRecord).reason), /permissionMode/i);

    // A source that cannot answer a field is DECLARED, never filled from the
    // stored row, and does not become a mismatch.
    const capabilities = reading.capabilities as AnyRecord;
    assert.equal(capabilities.provider, 'claude');
    assert.equal((capabilities.request as AnyRecord).model, 'readable');
    assert.equal((capabilities.request as AnyRecord).effort, 'readable');
    assert.equal((capabilities.request as AnyRecord).permissionMode, 'unavailable');
    assert.equal((capabilities.response as AnyRecord).model, 'readable');

    const stored = evidenceValue(reading.stored as AnyRecord);
    assert.deepEqual(stored, { model: CLAUDE_MODEL, effort: 'high', permissionMode: 'default' });

    // Re-reading with the operation id the reading returned addresses the same
    // fact and stays verified.
    const reread = readingOf(
      await read(harness, { operationId: String(reading.operationId) }),
    );
    assert.equal(reread.verified, true, 'the returned operation id re-reads the same fact');
  });
});

test('(b) the stored DB row alone cannot prove effectiveness', async () => {
  await withHarness({ run: 'none', host: 'none' }, async (harness) => {
    const reading = readingOf(await read(harness));
    assert.equal(reading.verified, false);
    assert.equal((reading.operation as AnyRecord).state, 'unknown');
    assert.equal((reading.actualRequest as AnyRecord).state, 'unknown');
    assert.equal((reading.actualResponse as AnyRecord).state, 'unknown');
    assert.equal((reading.actual as AnyRecord).state, 'unknown');
    assert.equal(((reading.layers as AnyRecord).process as AnyRecord).state, 'unknown');
    const unknown = unknownOf(reading);
    for (const field of ['operation', 'actualRequest', 'actualResponse', 'actual', 'process', 'fields.model', 'fields.effort']) {
      assert.ok(unknown.includes(field), `the DB-only reading must name ${field} as unknown`);
    }
  });
});

test('(c) the next turn — a completed run — is not the operation the reading is about', async () => {
  await withHarness({ run: 'completed' }, async (harness) => {
    const reading = readingOf(await read(harness));
    assert.equal(reading.verified, false);
    const operation = reading.operation as AnyRecord;
    assert.equal(operation.state, 'unknown');
    assert.match(String(operation.reason), /no run/i);
    assert.equal((reading.actualRequest as AnyRecord).state, 'unknown');
    assert.match(String((reading.actualRequest as AnyRecord).reason), /no run/i);
    assert.ok(unknownOf(reading).includes('operation'));
  });
});

test('(d) a live process with no transcript read-back is not proof of the request', async () => {
  await withHarness({ transcript: 'none' }, async (harness) => {
    const reading = readingOf(await read(harness));
    assert.equal(reading.verified, false);
    assert.equal((reading.actual as AnyRecord).state, 'evidence', 'the live process is real evidence');
    assert.equal(((reading.layers as AnyRecord).process as AnyRecord).state, 'evidence');
    const request = reading.actualRequest as AnyRecord;
    assert.equal(request.state, 'unknown');
    assert.match(String(request.reason), /transcript path/i);
    assert.ok(unknownOf(reading).includes('actualRequest'));
    assert.ok(unknownOf(reading).includes('fields.model'));
  });
});

test('(e) a run created by an older process boot is refused', async () => {
  await withHarness({ run: 'boot-mismatch' }, async (harness) => {
    const reading = readingOf(await read(harness));
    assert.equal(reading.verified, false);
    const operation = reading.operation as AnyRecord;
    assert.equal(operation.state, 'unknown');
    assert.match(String(operation.reason), /different process boot|old process/i);
    assert.equal((reading.actualRequest as AnyRecord).state, 'unknown');
  });
});

test('(f) a response older than the operation is refused', async () => {
  await withHarness({ transcript: 'old' }, async (harness) => {
    const reading = readingOf(await read(harness));
    assert.equal(reading.verified, false);
    const request = reading.actualRequest as AnyRecord;
    assert.equal(request.state, 'unknown');
    assert.match(String(request.reason), /predates this operation/i);
    assert.equal(((reading.fields as AnyRecord).model as AnyRecord).state, 'unknown');
  });
});

test('(g) a transcript turn that records no effort leaves effort unknown, not verified', async () => {
  await withHarness({ transcript: 'no-effort' }, async (harness) => {
    const reading = readingOf(await read(harness));
    assert.equal(reading.verified, false);
    const request = evidenceValue(reading.actualRequest as AnyRecord);
    assert.equal(request.effort, null, 'the turn really carries no effort');
    const fields = reading.fields as AnyRecord;
    assert.equal((fields.model as AnyRecord).state, 'verified', 'the model it did record is still verified');
    assert.equal((fields.effort as AnyRecord).state, 'unknown');
    assert.match(String((fields.effort as AnyRecord).reason), /no effort/i);
    const unknown = unknownOf(reading);
    assert.ok(unknown.includes('fields.effort'));
    assert.ok(unknown.includes('actualRequest.effort'), 'the empty sub-field is named, not left as a silent null');
  });
});

test('(h) an expectation that contradicts the readable actual is a mismatch, not verified', async () => {
  await withHarness({}, async (harness) => {
    const reading = readingOf(
      await read(harness, { expected: { model: 'claude-opus-5-5', effort: 'high' } }),
    );
    assert.equal(reading.verified, false);
    const model = (reading.fields as AnyRecord).model as AnyRecord;
    assert.equal(model.state, 'mismatch');
    assert.equal(model.expected, 'claude-opus-5-5');
    assert.equal(model.actual, CLAUDE_MODEL);
    assert.ok(unknownOf(reading).includes('fields.model'));
    assert.equal(((reading.fields as AnyRecord).effort as AnyRecord).state, 'verified');
  });
});

test('(i) a provider with no request/response read-back source declares the capability gap', async () => {
  await withHarness({ provider: 'codex', transcript: 'none' }, async (harness) => {
    const reading = readingOf(await read(harness, { expected: expected('codex') }));
    assert.equal(reading.verified, false);
    const capabilities = reading.capabilities as AnyRecord;
    assert.equal(capabilities.provider, 'codex');
    const requestCapabilities = capabilities.request as AnyRecord;
    assert.equal(requestCapabilities.model, 'unavailable');
    assert.equal(requestCapabilities.effort, 'unavailable');
    assert.equal(requestCapabilities.permissionMode, 'unavailable');
    assert.match(String((capabilities.reasons as AnyRecord).request), /no request\/response read-back source/i);
    assert.equal((reading.actualRequest as AnyRecord).state, 'unknown');
    assert.equal(((reading.fields as AnyRecord).model as AnyRecord).state, 'unknown');
    const unknown = unknownOf(reading);
    assert.ok(unknown.includes('fields.model'));
    assert.ok(unknown.includes('fields.effort'));
  });
});

test('(j) a response older than the live process was produced by an older process', async () => {
  await withHarness({ host: 'after-response' }, async (harness) => {
    const reading = readingOf(await read(harness));
    assert.equal(reading.verified, false);
    const request = reading.actualRequest as AnyRecord;
    assert.equal(request.state, 'unknown');
    assert.match(String(request.reason), /predates the live process/i);
    assert.equal((reading.actualResponse as AnyRecord).state, 'unknown');
    assert.ok(unknownOf(reading).includes('actualResponse'));
  });
});

test('(k) an unreadable transcript is a read error, never an empty transcript', async () => {
  await withHarness({ transcript: 'missing' }, async (harness) => {
    const reading = readingOf(await read(harness));
    assert.equal(reading.verified, false);
    const readErrors = reading.readErrors as AnyRecord[];
    assert.ok(
      readErrors.some((error) => String(error.source) === 'sessions.transcript'),
      'the failed transcript read is reported',
    );
    assert.equal((reading.actualRequest as AnyRecord).state, 'unknown');
    assert.match(String((reading.actualRequest as AnyRecord).reason), /could not be read/i);
  });
});

test('(l) a caller naming an operation that is not the current one is refused', async () => {
  await withHarness({}, async (harness) => {
    const reading = readingOf(await read(harness, { operationId: 'run-from-a-previous-turn' }));
    assert.equal(reading.verified, false);
    const operation = reading.operation as AnyRecord;
    assert.equal(operation.state, 'unknown');
    assert.match(String(operation.reason), /in-flight run/i);
    assert.equal((reading.actualRequest as AnyRecord).state, 'unknown');
  });
});
