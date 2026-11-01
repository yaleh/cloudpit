/**
 * knowledge-application-fact-contract — `knowledge_facts` through the REAL
 * production `/mcp` mount.
 *
 * Everything that produces a reading is real except the seams this criterion
 * names: a real express app carries the production mount behind the production
 * token middleware, the client is the MCP SDK's own `Client` over
 * `StreamableHTTPClientTransport`, the database is a real better-sqlite3 file in
 * a temp directory, and the context-event stream is a real JSONL day file. The
 * fact source under it is the production `createKnowledgeFactSource`, so the
 * tool answers through the same code path `server/index.ts` installs.
 *
 * Legs:
 *   (a) the identity envelope names the contract, version, build and boot of
 *       the process that answered;
 *   (b) `inventory` keeps its scope, total and truncation, and both filters
 *       narrow the total rather than the page;
 *   (c) `peer_result` correlates the stream activity with an operation id that
 *       re-reads to the same activity, and verifies the reply against the
 *       transcript;
 *   (d) a named peer is echoed only after the store confirms it, and every field
 *       the stream cannot answer stays `unknown`;
 *   (e) `effective_config` is verified only when every layer is evidence, and an
 *       omitted expected layer is an explicit unknown, not a silent pass;
 *   (f) missing evidence is rejected where it belongs: an unknown session is
 *       SESSION_NOT_FOUND, a session-scoped kind without `session` (or with an
 *       unknown kind) is INVALID_ARGUMENT;
 *   (g) an unwired host source reports `unknown` (not "not live"), and a failed
 *       transcript read is a `readErrors` entry, never an empty transcript.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/mcp-gateway/tests/mcp-knowledge-facts.test.ts
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
// set before any aliased module is pulled in — and every application module
// below comes in dynamically.
process.env.JWT_SECRET = 'mcp-knowledge-facts-test-secret';
delete process.env.VITE_IS_PLATFORM;

const { closeConnection, getConnection, initializeDatabase, projectsDb, sessionsDb } = await import(
  '@/modules/database/index.js'
);
const { createAccessTokensService } = await import('@/modules/oauth/index.js');
const { sessionsService } = await import('@/modules/providers/index.js');
const { createKnowledgeFactSource } = await import('../../../knowledge-facts-wiring.js');
const { deriveKnowledgeOperationId } = await import('@/modules/context-events/index.js');
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
const DAY = new Date(BASE_MS).toISOString().slice(0, 10);

const SESSION_A = 'knowledge-fact-session-a';
const SESSION_B = 'knowledge-fact-session-b';
const PROJECT_A = '/tmp/knowledge-fact-project-a';
const PROJECT_B = '/tmp/knowledge-fact-project-b';

const ASK_ID = `${SESSION_A}:assistant-ask`;
const ANSWER_MESSAGE_ID = 'user-answer';
const RUN_ID = 'knowledge-fact-run-a';
const BUILD_ID = 'knowledge-fact-build-1';
const BOOT_ID = 'knowledge-fact-boot-1';
const GIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const SERVER_VERSION = '1.41.0';

/** The `session.asking` / `session.answered` rows the stream fixture carries. */
const STREAM_ROWS = [
  {
    v: 1,
    id: 'evt-asking-1',
    at: new Date(BASE_MS - 60_000).toISOString(),
    source: 'cloudcli',
    kind: 'session.asking',
    session: SESSION_A,
    project: PROJECT_A,
    data: { askId: ASK_ID, messageId: 'assistant-ask' },
  },
  {
    v: 1,
    id: 'evt-answered-1',
    at: new Date(BASE_MS - 30_000).toISOString(),
    source: 'cloudcli',
    kind: 'session.answered',
    session: SESSION_A,
    project: PROJECT_A,
    data: { askId: ASK_ID, messageId: ANSWER_MESSAGE_ID },
  },
];

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

// --------------------------- harness ---------------------------

type ToolCall = { isError: boolean; text: string; payload: AnyRecord | null };

function parseToolResult(result: unknown): ToolCall {
  const call = result as { content?: unknown; isError?: boolean; structuredContent?: unknown };
  const blocks = Array.isArray(call.content) ? call.content : [];
  const text = blocks.map((block) => (block as { type?: string; text?: string }).text ?? '').join('');
  let payload: AnyRecord | null = null;
  // A FAILURE carries its machine fields in `structuredContent` (`{ code, … }`);
  // a SUCCESS payload is the JSON text body.
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

/** Which injected seams this mount supplies; absent means "the host cannot answer that layer". */
type HarnessOptions = {
  hosts?: boolean;
  transcripts?: boolean;
};

type HarnessRun = (harness: Harness) => Promise<void>;

/** Builds the production fact source over the real session rows and the temp stream. */
function makeFactSource(eventsDir: string, options: HarnessOptions) {
  return createKnowledgeFactSource({
    sessions: {
      getSessionById: (sessionId: string) => sessionsDb.getSessionById(sessionId),
      getAllSessions: () => sessionsDb.getAllSessions(),
      fetchHistory: async (sessionId: string, request?: { limit?: number | null }) => {
        if (options.transcripts === false) throw new Error('transcript store unavailable');
        const messages =
          sessionId === SESSION_A
            ? [{ id: ANSWER_MESSAGE_ID, role: 'user', timestamp: '2026-11-01T11:59:30.000Z' }]
            : [];
        return { messages: messages.slice(-(request?.limit ?? messages.length)) };
      },
    },
    ...(options.hosts === false
      ? {}
      : {
          hosts: {
            liveHostForSession: (sessionId: string) =>
              sessionId === SESSION_A ? { pid: 4242, startedAt: BASE_MS - 120_000 } : null,
          },
        }),
    runs: {
      listRunningRuns: () => [],
      getRun: (sessionId: string) =>
        sessionId === SESSION_A
          ? { runId: RUN_ID, startedAt: BASE_MS, status: 'running', providerSessionId: null }
          : undefined,
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
    eventsDir,
  });
}

/**
 * Runs `run` against a fresh temp database, a fresh temp event directory and the
 * production `/mcp` mount.
 */
async function withKnowledgeFactsHarness(run: HarnessRun, options: HarnessOptions = {}): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'mcp-knowledge-facts-'));
  const eventsDir = path.join(tempDirectory, 'events');

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'knowledge-facts.db');
  await initializeDatabase();
  getConnection()
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(USER_ONE, 'owner', 'hash');

  sessionsDb.createAppSession(SESSION_A, 'claude', PROJECT_A, 'Session A', {
    model: 'claude-sonnet-5-5',
    effort: 'high',
    permissionMode: 'default',
    lifecycleMode: 'resident',
  });
  sessionsDb.createAppSession(SESSION_B, 'codex', PROJECT_B, 'Session B', {
    model: 'gpt-5.5-codex',
    effort: 'low',
    permissionMode: 'acceptEdits',
    lifecycleMode: 'per-run',
  });

  await mkdir(eventsDir, { recursive: true });
  await writeFile(
    path.join(eventsDir, `${DAY}.jsonl`),
    `${STREAM_ROWS.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'utf8',
  );

  const tokens = createAccessTokensService({ now: () => new Date(BASE_MS) });
  const readToken = tokens.issueToken({
    userId: USER_ONE,
    name: 'mcp-knowledge-facts',
    scopes: ['cloudcli:read'],
    expiresInDays: 30,
  });
  if (!readToken.ok) throw new Error('the harness must mint a read token');

  const facts = makeFactSource(eventsDir, options);

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
  const client = new Client({ name: 'knowledge-facts-criterion', version: '0.0.0' });
  await client.connect(transport);

  const harness: Harness = {
    call: async (name, args = {}) =>
      parseToolResult(await client.callTool({ name, arguments: args } as Parameters<Client['callTool']>[0])),
  };

  try {
    await run(harness);
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

/** The reading inside a successful payload. */
function readingOf(call: ToolCall): AnyRecord {
  assert.equal(call.isError, false, `knowledge_facts must succeed, saw: ${call.text}`);
  assert.ok(call.payload !== null, 'a success carries a JSON payload');
  const reading = call.payload!.reading as AnyRecord | undefined;
  assert.ok(reading !== undefined && typeof reading === 'object' && reading !== null, 'the payload carries a reading');
  return reading!;
}

/** The project id the fixture row was stored under. */
function projectIdOf(projectPath: string): string {
  const projectId = projectsDb.getProjectPath(projectPath)?.project_id ?? null;
  assert.notEqual(projectId, null, `the fixture project ${projectPath} was recorded`);
  return projectId!;
}

/** The value of one evidence reading, asserting it is evidence first. */
function evidenceValue(field: AnyRecord): AnyRecord {
  assert.equal(field.state, 'evidence', `expected evidence, saw ${JSON.stringify(field)}`);
  return field.value as AnyRecord;
}

// --------------------------- criteria ---------------------------

test('(a) the identity envelope names the contract, build and boot that answered', async () => {
  await withKnowledgeFactsHarness(async ({ call }) => {
    const callResult = await call('knowledge_facts', { kind: 'inventory' });
    assert.equal(callResult.isError, false, callResult.text);
    const identity = callResult.payload!.identity as AnyRecord;
    assert.equal(identity.contract, KNOWLEDGE_FACT_CONTRACT);
    assert.equal(identity.version, KNOWLEDGE_FACT_CONTRACT_VERSION);
    assert.equal(identity.project, KNOWLEDGE_FACT_PROJECT);
    assert.equal(identity.buildId, BUILD_ID);
    assert.equal(identity.bootId, BOOT_ID);
    assert.equal(identity.serverVersion, SERVER_VERSION);
    assert.equal(identity.gitSha, GIT_SHA);
    assert.equal(identity.observedAt, new Date(BASE_MS).toISOString());
  });
});

test('(b) inventory keeps scope, total and truncation, and each filter narrows the total', async () => {
  await withKnowledgeFactsHarness(async ({ call }) => {
    const page = readingOf(await call('knowledge_facts', { kind: 'inventory', limit: 1, offset: 0 }));
    assert.equal(page.total, 2, 'the total counts the whole filtered scope, not the page');
    assert.equal(page.truncated, true, 'a one-row page over two sessions is truncated');
    assert.equal((page.items as AnyRecord[]).length, 1);
    assert.deepEqual((page.scope as AnyRecord).filtersApplied, []);
    assert.equal((page.scope as AnyRecord).limit, 1);
    assert.deepEqual(page.providers, ['claude', 'codex']);
    assert.equal(typeof page.operationId, 'string');

    const second = readingOf(await call('knowledge_facts', { kind: 'inventory', limit: 1, offset: 1 }));
    assert.equal(second.truncated, false, 'the last page is not truncated');
    assert.notEqual(second.operationId, page.operationId, 'a different page is a different bounded query');

    const codex = readingOf(await call('knowledge_facts', { kind: 'inventory', provider: 'codex' }));
    assert.equal(codex.total, 1);
    assert.deepEqual((codex.scope as AnyRecord).filtersApplied, ['provider']);
    assert.equal((codex.items as AnyRecord[])[0]!.sessionId, SESSION_B);
    assert.deepEqual(codex.providers, ['codex'], 'providers describe the filtered scope');
    assert.equal(((codex.items as AnyRecord[])[0]!.lifecycle as AnyRecord).stored, 'per-run');

    const project = readingOf(
      await call('knowledge_facts', { kind: 'inventory', projectId: projectIdOf(PROJECT_A) }),
    );
    assert.equal(project.total, 1, 'a project filter narrows the total');
    assert.deepEqual((project.scope as AnyRecord).filtersApplied, ['projectId']);
    const item = (project.items as AnyRecord[])[0]!;
    assert.equal(item.sessionId, SESSION_A);
    assert.equal((item.lifecycle as AnyRecord).stored, 'resident');
    assert.equal((item.lifecycle as AnyRecord).live, true, 'the wired host source reports the live process');
    assert.equal(item.provider, 'claude');
  });
});

test('(c) peer_result correlates the stream activity with the transcript-verified reply', async () => {
  await withKnowledgeFactsHarness(async ({ call }) => {
    const reading = readingOf(await call('knowledge_facts', { kind: 'peer_result', session: SESSION_A }));

    assert.equal(reading.kind, 'peer_result');
    assert.equal(
      reading.operationId,
      deriveKnowledgeOperationId(ASK_ID),
      'the operation is derived from the ask identity, not from memory',
    );

    const activity = reading.activity as AnyRecord;
    const activityValue = evidenceValue(activity);
    assert.equal(activityValue.askId, ASK_ID);
    assert.equal(activityValue.state, 'answered');
    assert.equal(activity.source, 'context-events');

    const correlation = reading.correlation as AnyRecord;
    const correlationValue = evidenceValue(correlation);
    assert.equal(correlationValue.operationId, reading.operationId);
    assert.equal(correlationValue.sourceSessionId, SESSION_A);
    assert.equal(correlationValue.answeredMessageId, ANSWER_MESSAGE_ID);
    assert.equal(correlationValue.targetSessionId, null);

    const reply = reading.reply as AnyRecord;
    assert.equal(reply.state, 'evidence', 'the transcript confirmed the settling message');
    const replyValue = evidenceValue(reply);
    assert.equal(replyValue.messageId, ANSWER_MESSAGE_ID);
    assert.equal(replyValue.role, 'user');
    assert.equal(replyValue.verifiedAgainstTranscript, true);
    assert.equal(reply.source, 'sessions.transcript');

    const waiting = evidenceValue(reading.waiting as AnyRecord);
    assert.equal(waiting.state, 'answered');

    const unknown = reading.unknown as string[];
    assert.ok(unknown.includes('authorization'), 'the stream carries no authorization scope');
    assert.ok(unknown.includes('targetSessionId'), 'the caller named no peer session');
    assert.deepEqual(reading.readErrors, []);

    // The authoritative re-read: asking again by the returned operation id reads
    // the SAME activity from the files, not a remembered one.
    const reRead = readingOf(
      await call('knowledge_facts', {
        kind: 'peer_result',
        session: SESSION_A,
        operationId: reading.operationId,
      }),
    );
    const reReadValue = evidenceValue(reRead.activity as AnyRecord);
    assert.equal(reReadValue.sourceRef, activityValue.sourceRef, 'the re-read names the same stream row');
    assert.equal(reRead.operationId, reading.operationId);

    // An operation id the stream does not carry is not invented.
    const absent = readingOf(
      await call('knowledge_facts', {
        kind: 'peer_result',
        session: SESSION_A,
        operationId: deriveKnowledgeOperationId('no-such-ask'),
      }),
    );
    assert.equal((absent.activity as AnyRecord).state, 'unknown');
    assert.ok((absent.unknown as string[]).includes('activity'));
  });
});

test('(d) a named peer is echoed only after the store confirms it; absent layers stay unknown', async () => {
  await withKnowledgeFactsHarness(async ({ call }) => {
    const confirmed = readingOf(
      await call('knowledge_facts', { kind: 'peer_result', session: SESSION_A, peerSession: SESSION_B }),
    );
    const correlation = evidenceValue(confirmed.correlation as AnyRecord);
    assert.equal(correlation.targetSessionId, SESSION_B);
    assert.equal((confirmed.unknown as string[]).includes('targetSessionId'), false);

    const noActivity = readingOf(await call('knowledge_facts', { kind: 'peer_result', session: SESSION_B }));
    assert.equal(
      (noActivity.activity as AnyRecord).state,
      'unknown',
      'no asking row is an explicit unknown, not an empty activity',
    );
    assert.equal((noActivity.correlation as AnyRecord).state, 'unknown');
    assert.equal((noActivity.waiting as AnyRecord).state, 'unknown');
    assert.equal((noActivity.reply as AnyRecord).state, 'unknown');
    const unknown = noActivity.unknown as string[];
    for (const field of ['activity', 'reply', 'targetSessionId', 'authorization']) {
      assert.ok(unknown.includes(field), `${field} must be named`);
    }
    assert.equal(noActivity.operationId, null);
  });
});

test('(e) effective_config is verified only when every layer is evidence', async () => {
  await withKnowledgeFactsHarness(async ({ call }) => {
    const unverified = readingOf(await call('knowledge_facts', { kind: 'effective_config', session: SESSION_A }));
    assert.equal(unverified.verified, false, 'without an expected layer the reading cannot be verified');
    assert.equal((unverified.expected as AnyRecord).state, 'unknown');
    assert.ok((unverified.unknown as string[]).includes('expected'));
    const stored = evidenceValue(unverified.stored as AnyRecord);
    assert.equal(stored.model, 'claude-sonnet-5-5');
    assert.equal(stored.effort, 'high');
    assert.equal(stored.permissionMode, 'default');
    const actual = evidenceValue(unverified.actual as AnyRecord);
    assert.equal(actual.live, true);
    assert.equal(actual.runId, RUN_ID, 'the run identity comes from the registry lookup');

    const verified = readingOf(
      await call('knowledge_facts', {
        kind: 'effective_config',
        session: SESSION_A,
        expected: { model: 'claude-sonnet-5-5', effort: 'high', permissionMode: 'default' },
      }),
    );
    assert.equal(verified.verified, true, 'every layer is evidence, so the reading is verified');
    assert.deepEqual(verified.unknown, []);
    assert.equal(evidenceValue(verified.expected as AnyRecord).model, 'claude-sonnet-5-5');
    assert.equal((verified.expected as AnyRecord).source, 'caller');

    const layers = verified.layers as AnyRecord;
    assert.equal(evidenceValue(layers.process as AnyRecord).bootId, BOOT_ID);
    assert.equal(evidenceValue(layers.build as AnyRecord).buildId, BUILD_ID);
    assert.equal(evidenceValue(layers.request as AnyRecord).runId, RUN_ID);
    assert.equal(evidenceValue(layers.request as AnyRecord).sessionId, SESSION_A);
  });
});

test('(f) missing evidence is rejected where it belongs', async () => {
  await withKnowledgeFactsHarness(async ({ call }) => {
    const unknownSession = await call('knowledge_facts', { kind: 'effective_config', session: 'no-such-session' });
    assert.equal(unknownSession.isError, true, 'an unresolved address is an error, not an all-unknown fact');
    assert.equal((unknownSession.payload as AnyRecord).code, 'SESSION_NOT_FOUND');

    const missingArgument = await call('knowledge_facts', { kind: 'peer_result' });
    assert.equal(missingArgument.isError, true);
    assert.equal((missingArgument.payload as AnyRecord).code, 'INVALID_ARGUMENT');

    const invalidKind = await call('knowledge_facts', { kind: 'bogus' });
    assert.equal(invalidKind.isError, true);
    assert.equal((invalidKind.payload as AnyRecord).code, 'INVALID_ARGUMENT');

    // A peer the store does not hold is NOT a refusal — the ask is real, and the
    // unconfirmed peer is reported as an explicit gap.
    const peerMissing = await call('knowledge_facts', {
      kind: 'peer_result',
      session: SESSION_A,
      peerSession: 'no-such-peer',
    });
    assert.equal(peerMissing.isError, false, 'a named-but-absent peer is a reading with an explicit gap');
    const peerReading = readingOf(peerMissing);
    assert.equal(evidenceValue(peerReading.correlation as AnyRecord).targetSessionId, null);
    assert.ok((peerReading.unknown as string[]).includes('targetSessionId'));
    assert.ok(
      (peerReading.readErrors as AnyRecord[]).some((error) => String(error.source) === 'sessions.db'),
      'the failed peer lookup is a read error',
    );
  });
});

test('(g) an unwired host source reports unknown, and a failed transcript read is a read error', async () => {
  await withKnowledgeFactsHarness(
    async ({ call }) => {
      const config = readingOf(await call('knowledge_facts', { kind: 'effective_config', session: SESSION_A }));
      assert.equal((config.actual as AnyRecord).state, 'unknown', 'no host source means the live layer is unknown');
      assert.equal(((config.layers as AnyRecord).process as AnyRecord).state, 'unknown');
      assert.ok((config.unknown as string[]).includes('actual'));
      assert.ok((config.unknown as string[]).includes('process'));

      const inventory = readingOf(await call('knowledge_facts', { kind: 'inventory' }));
      assert.ok((inventory.unknown as string[]).includes('lifecycle.live'));
      const item = (inventory.items as AnyRecord[])[0]!;
      assert.equal((item.lifecycle as AnyRecord).live, null, 'no host source is not the same as "not live"');

      const peer = readingOf(await call('knowledge_facts', { kind: 'peer_result', session: SESSION_A }));
      assert.equal((peer.reply as AnyRecord).state, 'unknown');
      assert.ok(
        (peer.readErrors as AnyRecord[]).some((error) => String(error.source) === 'sessions.transcript'),
        'the failed transcript read is reported instead of an empty transcript',
      );
    },
    { hosts: false, transcripts: false },
  );
});
