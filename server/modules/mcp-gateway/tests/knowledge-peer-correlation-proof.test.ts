/**
 * knowledge-peer-correlation-proof — a cross-session ask can be followed from
 * the server's OWN records all the way to the peer's reply, through the REAL
 * production `/mcp` mount.
 *
 * Nothing here scans source for a symbol, and nothing trusts the caller's
 * parameters. Each leg boots express with the production `mountMcpGateway` and
 * the production bearer middleware, connects the MCP SDK's own `Client` over
 * `StreamableHTTPClientTransport`, and drives the two real tools:
 *
 *   session_send      names the asking session + a correlation label, and the
 *                     production adapter writes the accepted-send record
 *                     (deliveryId + correlationId + source + target + boot)
 *                     into the process's delivery ledger;
 *   knowledge_facts   reads `peer_result` back with that delivery id and walks
 *                     the chain: saved record -> resident ledger -> the target
 *                     transcript row whose id IS the delivery id -> the FIRST
 *                     assistant turn after it.
 *
 * The session store is a real better-sqlite3 file, both sessions are real rows,
 * and both transcripts are real JSONL files in a throwaway directory. The
 * control service is the only scripted seam: it answers a send with the
 * delivery id the target transcript really carries, which is exactly what the
 * production control service answers with.
 *
 * Positive leg: `verified: true`, with build/boot/operation/correlation/
 * messageId all readable and traceable to the send that opened the chain.
 *
 * Negative legs prove each substitute is REFUSED with an explicit unknown and
 * no side effect:
 *   (b) the caller names the wrong peer for that delivery;
 *   (c) the caller names a different correlation;
 *   (d) no delivery record was ever saved for the id;
 *   (e) the target transcript holds only an assistant turn BEFORE the delivery
 *       (an old reply is never borrowed);
 *   (f) the transcript window holds no row with the delivery id, even though a
 *       later assistant turn exists;
 *   (g) the target transcript file is absent (unknown, not an empty success);
 *   (h) the resident delivery ledger no longer holds the delivery;
 *   (i) an ordinary answered ask that names no reply messageId;
 *   (j) authorization — a reply grants no action permission, and the reading's
 *       authorization field stays unknown.
 *
 * Run directly:
 *   npx tsx --tsconfig server/tsconfig.json --test \
 *     server/modules/mcp-gateway/tests/knowledge-peer-correlation-proof.test.ts
 */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

// Same module-load ordering as the sibling gateway criteria: the JWT secret and
// the platform switch are frozen on first aliased import.
process.env.JWT_SECRET = 'knowledge-peer-correlation-proof-secret';
delete process.env.VITE_IS_PLATFORM;

const { closeConnection, getConnection, initializeDatabase, projectsDb, sessionsDb } = await import(
  '@/modules/database/index.js'
);
const { createAccessTokensService } = await import('@/modules/oauth/index.js');
const { sessionsService } = await import('@/modules/providers/index.js');
const {
  KNOWLEDGE_ACTION_PERMISSION_REASON,
  KNOWLEDGE_DELIVERY_NOT_IN_LEDGER_REASON,
  KNOWLEDGE_NO_DELIVERY_RECORD_REASON,
  KNOWLEDGE_REPLY_NOT_AFTER_DELIVERY_REASON,
  createSessionControlLedger,
  createSessionControlPeerDelivery,
} = await import('@/modules/session-control/index.js');
// The composition root is a top-level wiring file with no barrel: this test
// assembles the gateway from the SAME wiring the executable uses.
// eslint-disable-next-line boundaries/no-unknown
const { createKnowledgeFactSource } = await import('../../../knowledge-facts-wiring.js');
const {
  KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON,
  deriveKnowledgeOperationId,
} = await import('@/modules/context-events/index.js');
const {
  KNOWLEDGE_FACT_CONTRACT,
  KNOWLEDGE_FACT_CONTRACT_VERSION,
  KNOWLEDGE_FACT_PROJECT,
} = await import('@/shared/knowledge-facts.js');
const { MCP_GATEWAY_PATH, createMcpAuthMiddleware, mountMcpGateway } = await import('../index.js');

type AnyRecord = Record<string, unknown>;

// --------------------------- evidence capture ---------------------------

/**
 * Set to a path to rewrite `docs/evidence/knowledge-peer-correlation-proof.json`
 * from THIS run. Unset — the suite's own case — every capture is a no-op, so a
 * normal run never writes a repository file.
 */
const CAPTURE_PATH = process.env.KNOWLEDGE_PEER_CORRELATION_EVIDENCE;
const capturedCalls: AnyRecord[] = [];
let capturedTools: AnyRecord[] | null = null;
let capturedBaseUrl: string | null = null;

function capture(label: string, arms: string, request: AnyRecord, call: ToolCall): void {
  if (CAPTURE_PATH === undefined) return;
  capturedCalls.push({
    label,
    arms,
    gateway: MCP_GATEWAY_PATH,
    request,
    isError: call.isError,
    payload: call.payload,
  });
}

after(async () => {
  if (CAPTURE_PATH === undefined || capturedTools === null) return;
  await writeFile(
    CAPTURE_PATH,
    `${JSON.stringify(
      {
        task: 'knowledge-peer-correlation-proof',
        capturedAt: new Date().toISOString(),
        instance: {
          kind: 'controlled-instance',
          baseUrl: capturedBaseUrl,
          gatewayPath: MCP_GATEWAY_PATH,
          isolation:
            'Real express + production mountMcpGateway + production bearer middleware on a loopback socket, with a real better-sqlite3 file, real session rows and real transcript JSONL files in a throwaway directory. The control service is scripted to answer the delivery id the transcript carries. No live fleet instance, operator database or operator ~/.quay-fleet stream was read or written; production deployment verification is left to F10.',
        },
        tools: capturedTools,
        calls: capturedCalls,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
});

// --------------------------- fixture identities ---------------------------

const USER_ONE = 1;
const BASE_MS = Date.parse('2026-11-01T12:00:00.000Z');
const DAY = new Date(BASE_MS).toISOString().slice(0, 10);
const DELIVERY_MS = BASE_MS - 20_000; // 11:59:40
const REPLY_MS = BASE_MS - 10_000; // 11:59:50
const OLD_REPLY_MS = BASE_MS - 40_000; // 11:59:20, before the delivery
const PROJECT = '/tmp/knowledge-peer-correlation-project';
const BUILD_ID = 'peer-correlation-build-1';
const BOOT_ID = 'peer-correlation-boot-1';
const SERVER_VERSION = '1.41.0';
const CORRELATION = 'corr-peer-ask-1';
const DELIVERY_ID = 'delivery-peer-ask-1';
const REPLY_UUID = 'reply-assistant-1';
const ASK_MESSAGE_ID = 'assistant-ask-1';
const READ_SCOPE = 'cloudcli:read';
const SEND_SCOPE = 'cloudcli:session:send';

function idsOf(tag: string) {
  return {
    source: `peer-correlation-source-${tag}`,
    target: `peer-correlation-target-${tag}`,
    other: `peer-correlation-other-${tag}`,
  };
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

/**
 * Which world this leg builds. Every option changes a SOURCE, never the answer:
 * the reader must reach the same explicit unknown from each missing, stale or
 * disagreeing source.
 */
type Arms = {
  tag: string;
  /** What the target transcript on disk contains. */
  transcript?: 'answered' | 'old-reply' | 'no-delivery-row' | 'no-reply' | 'missing' | 'none';
  /** The resident delivery ledger's reading for the recorded delivery. */
  residentDelivery?: 'present' | 'forgotten' | 'other-session';
  /** The source session's activity stream: an answered ask, or one that names no reply. */
  events?: 'asking' | 'answered-without-message';
};

type World = {
  call: (name: string, args?: AnyRecord) => Promise<ToolCall>;
  source: string;
  target: string;
  other: string;
  deliveryId: string;
  correlationId: string;
  replyUuid: string;
  transcriptPath: string;
  /** How many sends reached the scripted control service. */
  controlCalls: () => number;
};

/** The writer's envelope, reduced to the fields the activity reader reads. */
function activityRow(
  session: string,
  kind: string,
  data: AnyRecord,
): AnyRecord {
  return {
    v: 1,
    id: `evt-${kind}-${String(data.askId ?? '')}`,
    at: new Date(BASE_MS).toISOString(),
    source: 'cloudcli',
    kind,
    session,
    project: PROJECT,
    data,
  };
}

/** One transcript line, in the shape the Claude history reader normalizes. */
function transcriptRow(type: 'user' | 'assistant', uuid: string, atMs: number, text: string): string {
  return JSON.stringify({
    type,
    uuid,
    sessionId: null, // patched by the caller to the provider session id
    timestamp: new Date(atMs).toISOString(),
    // A string body normalizes to a row whose id IS the uuid; a content-block
    // body would suffix the first block (`<uuid>_0`). The delivered message's
    // identity must equal the delivery id, so the fixture uses the string form.
    message: { role: type, content: text },
  });
}

function makeFactSource(world: {
  eventsDir: string;
  ledger: ReturnType<typeof createSessionControlLedger>;
  lookupById: (deliveryId: string) => {
    deliveryId: string;
    sessionId: string;
    state: string;
    enqueuedAt: number;
  } | null;
}) {
  const sessionControl = createSessionControlPeerDelivery({
    ledger: world.ledger,
    deliveries: { lookupById: world.lookupById },
    sessions: {
      getSessionById: (sessionId: string) => sessionsDb.getSessionById(sessionId),
      fetchHistory: (sessionId: string, options?: { limit?: number | null }) =>
        sessionsService.fetchHistory(sessionId, options ?? {}),
    },
  });

  return createKnowledgeFactSource({
    sessions: {
      getSessionById: (sessionId: string) => sessionsDb.getSessionById(sessionId),
      getAllSessions: () => sessionsDb.getAllSessions(),
      fetchHistory: (sessionId: string, options?: { limit?: number | null }) =>
        sessionsService.fetchHistory(sessionId, options ?? {}),
    },
    projects: {
      getProjectIdByPath: (projectPath: string) => projectsDb.getProjectPath(projectPath)?.project_id ?? null,
    },
    buildId: BUILD_ID,
    gitSha: '89abcdef0123456789abcdef0123456789abcdef',
    builtAt: '2026-10-31T08:00:00.000Z',
    serverVersion: SERVER_VERSION,
    bootId: BOOT_ID,
    now: () => BASE_MS,
    eventsDir: world.eventsDir,
    sessionControl,
  });
}

async function withHarness(arms: Arms, run: (world: World) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'knowledge-peer-correlation-'));
  const ids = idsOf(arms.tag);
  const eventsDir = path.join(tempDirectory, 'events');
  const transcriptPath = path.join(tempDirectory, `${ids.target}.jsonl`);

  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'knowledge-peer-correlation.db');
  await initializeDatabase();
  getConnection()
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(USER_ONE, 'owner', 'hash');

  sessionsDb.createAppSession(ids.source, 'claude', PROJECT, 'Asking session', { lifecycleMode: 'resident' });
  sessionsDb.createAppSession(ids.target, 'claude', PROJECT, 'Peer session', { lifecycleMode: 'resident' });
  sessionsDb.createAppSession(ids.other, 'claude', PROJECT, 'Other peer', { lifecycleMode: 'resident' });

  const transcript = arms.transcript ?? 'answered';
  if (transcript !== 'none') {
    const lines =
      transcript === 'old-reply'
        ? [
            transcriptRow('assistant', REPLY_UUID, OLD_REPLY_MS, 'an answer from an earlier ask'),
            transcriptRow('user', DELIVERY_ID, DELIVERY_MS, 'please review the fact contract'),
          ]
        : transcript === 'no-delivery-row'
          ? [
              transcriptRow('user', 'stranger-message-1', DELIVERY_MS, 'a different message'),
              transcriptRow('assistant', REPLY_UUID, REPLY_MS, 'the contract is readable'),
            ]
          : transcript === 'no-reply'
            ? [transcriptRow('user', DELIVERY_ID, DELIVERY_MS, 'please review the fact contract')]
            : transcript === 'missing'
              ? []
              : [
                  transcriptRow('user', DELIVERY_ID, DELIVERY_MS, 'please review the fact contract'),
                  transcriptRow('assistant', REPLY_UUID, REPLY_MS, 'the contract is readable'),
                ];
    const writtenPath = transcript === 'missing' ? path.join(tempDirectory, 'absent.jsonl') : transcriptPath;
    if (transcript !== 'missing') {
      await writeFile(
        writtenPath,
        lines.map((line) => line.replace('"sessionId":null', `"sessionId":${JSON.stringify(ids.target)}`)).join('\n') + '\n',
        'utf8',
      );
    }
    getConnection()
      .prepare('UPDATE sessions SET jsonl_path = ?, provider_session_id = ? WHERE session_id = ?')
      .run(writtenPath, ids.target, ids.target);
  }

  const askId = `${ids.source}:${ASK_MESSAGE_ID}`;
  const eventRows =
    arms.events === 'answered-without-message'
      ? [
          activityRow(ids.source, 'session.asking', { askId, messageId: ASK_MESSAGE_ID }),
          activityRow(ids.source, 'session.answered', { askId }),
        ]
      : arms.events === 'asking' || arms.events === undefined
        ? [activityRow(ids.source, 'session.asking', { askId, messageId: ASK_MESSAGE_ID })]
        : [];
  if (eventRows.length > 0) {
    await mkdir(eventsDir, { recursive: true });
    await writeFile(
      path.join(eventsDir, `${DAY}.jsonl`),
      `${eventRows.map((row) => JSON.stringify(row)).join('\n')}\n`,
      'utf8',
    );
  }

  const ledger = createSessionControlLedger({ bootId: BOOT_ID, now: () => BASE_MS });
  const resident = arms.residentDelivery ?? 'present';
  const lookupById = (deliveryId: string): {
    deliveryId: string;
    sessionId: string;
    state: string;
    enqueuedAt: number;
  } | null => {
    if (deliveryId !== DELIVERY_ID || resident === 'forgotten') return null;
    return {
      deliveryId,
      sessionId: resident === 'other-session' ? ids.other : ids.target,
      state: 'completed',
      enqueuedAt: DELIVERY_MS,
    };
  };

  const facts = makeFactSource({
    eventsDir,
    ledger,
    lookupById,
  });

  const tokens = createAccessTokensService({ now: () => new Date(BASE_MS) });
  const token = tokens.issueToken({
    userId: USER_ONE,
    name: 'knowledge-peer-correlation-proof',
    scopes: [READ_SCOPE, SEND_SCOPE],
    expiresInDays: 30,
  });
  if (!token.ok) throw new Error('the harness must mint a read/send token');

  let controlCalls = 0;
  const control = {
    async send() {
      controlCalls += 1;
      return { ok: true as const, deliveryId: DELIVERY_ID, runId: null, queued: false, queuedMessageUuid: null };
    },
  };

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
    writeTools: {
      control,
      runs: { getRun: () => undefined },
      runGet: {
        deps: {
          runs: {
            getRunById: () => ({ status: 'unknown', reason: 'unknown' } as const),
            getRunBootId: () => null,
          },
          activity: { snapshot: () => null },
          sessions: { fetchHistory: async () => ({ messages: [] }) },
          now: () => BASE_MS,
          sleep: async () => undefined,
          bootId: () => BOOT_ID,
        },
        build: async () => {
          throw new Error('this harness never asks session_send to wait');
        },
      },
      deliveries: ledger,
    },
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  const endpoint = new URL(`http://127.0.0.1:${address.port}${MCP_GATEWAY_PATH}`);

  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { authorization: `Bearer ${token.token.token}` } },
    fetch: nodeFetch,
  });
  const client = new Client({ name: 'knowledge-peer-correlation-proof', version: '0.0.0' });
  await client.connect(transport);

  if (CAPTURE_PATH !== undefined && capturedTools === null) {
    capturedBaseUrl = `http://127.0.0.1:${address.port}`;
    const listed = await client.listTools();
    capturedTools = (listed.tools as AnyRecord[]).filter(
      (tool) => tool.name === 'knowledge_facts' || tool.name === 'session_send',
    );
  }

  const world: World = {
    call: async (name, args = {}) =>
      parseToolResult(await client.callTool({ name, arguments: args } as Parameters<Client['callTool']>[0])),
    source: ids.source,
    target: ids.target,
    other: ids.other,
    deliveryId: DELIVERY_ID,
    correlationId: CORRELATION,
    replyUuid: REPLY_UUID,
    transcriptPath,
    controlCalls: () => controlCalls,
  };

  try {
    await run(world);
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

function unknownReason(field: AnyRecord): string {
  assert.equal(field.state, 'unknown', `expected unknown, saw ${JSON.stringify(field)}`);
  return String(field.reason);
}

function unknownOf(reading: AnyRecord): string[] {
  return reading.unknown as string[];
}

/** Sends the relayed ask through the REAL session_send adapter. */
async function relayAsk(world: World, extra: AnyRecord = {}): Promise<ToolCall> {
  return world.call('session_send', {
    session: world.target,
    message: 'please review the fact contract',
    correlationId: world.correlationId,
    sourceSession: world.source,
    ...extra,
  });
}

async function readDelivery(
  world: World,
  extra: AnyRecord = {},
  captureAs?: { label: string; arms: string },
): Promise<AnyRecord> {
  const request = {
    kind: 'peer_result',
    session: world.source,
    peerSession: world.target,
    deliveryId: world.deliveryId,
    correlationId: world.correlationId,
    ...extra,
  };
  const call = await world.call('knowledge_facts', request);
  if (captureAs !== undefined) capture(captureAs.label, captureAs.arms, { tool: 'knowledge_facts', arguments: request }, call);
  return readingOf(call);
}

// --------------------------- the criteria ---------------------------

test('(a) the ask -> delivery -> reply chain is verified from the server records, not from the caller parameters', async () => {
  await withHarness({ tag: 'positive', transcript: 'answered' }, async (world) => {
    const sent = await relayAsk(world);
    assert.equal(sent.isError, false, `session_send must succeed, saw: ${sent.text}`);
    assert.equal(world.controlCalls(), 1, 'the real send adapter reached the control service once');
    const payload = sent.payload as AnyRecord;
    assert.equal(payload.deliveryId, DELIVERY_ID);
    capture(
      'send-relayed-ask',
      'positive',
      {
        tool: 'session_send',
        arguments: {
          session: world.target,
          message: 'please review the fact contract',
          correlationId: world.correlationId,
          sourceSession: world.source,
        },
      },
      sent,
    );

    const reading = await readDelivery(world, {}, { label: 'verified-correlation', arms: 'positive' });
    assert.equal(reading.kind, 'peer_result');
    assert.equal((reading.capabilities as AnyRecord).deliveryCorrelation, 'readable', 'this build can read the arm back');

    // The operation is the ASK the source session stated, with both readings
    // naming the same derived operation id.
    const correlation = evidenceValue(reading.correlation as AnyRecord);
    assert.equal(correlation.operationId, deriveKnowledgeOperationId(`${world.source}:${ASK_MESSAGE_ID}`));
    assert.equal(correlation.sourceSessionId, world.source);
    assert.equal(correlation.targetSessionId, world.target, 'the saved delivery named the target');
    assert.equal(correlation.deliveryId, DELIVERY_ID);
    assert.equal(correlation.correlationId, CORRELATION);

    const block = reading.deliveryCorrelation as AnyRecord;
    assert.equal(block.verified, true, 'every link of the chain is evidence');
    assert.deepEqual(block.unknown, []);

    // (1) The server's own accepted-send record.
    const delivery = evidenceValue(block.delivery as AnyRecord);
    assert.deepEqual(delivery, {
      deliveryId: DELIVERY_ID,
      correlationId: CORRELATION,
      sourceSessionId: world.source,
      targetSessionId: world.target,
      bootId: BOOT_ID,
      recordedAt: new Date(BASE_MS).toISOString(),
    });
    assert.equal((block.delivery as AnyRecord).source, 'session-control.send');
    assert.equal((block.delivery as AnyRecord).sourceRef, `delivery:${DELIVERY_ID}`);

    // (2) The delivered message: the transcript row's id IS the delivery id.
    const original = evidenceValue(block.originalMessage as AnyRecord);
    assert.equal(original.messageId, DELIVERY_ID);
    assert.equal(original.messageId, delivery.deliveryId, 'the row identity and the delivery identity agree');
    assert.equal(original.role, 'user');
    assert.equal(original.verifiedAgainstTranscript, true);
    assert.equal((block.originalMessage as AnyRecord).source, 'sessions.transcript');
    assert.equal((block.originalMessage as AnyRecord).sourceRef, `${world.target}#${DELIVERY_ID}`);

    // (3) The reply is the FIRST assistant turn AFTER it, by message id.
    const reply = evidenceValue(block.reply as AnyRecord);
    assert.equal(reply.messageId, REPLY_UUID);
    assert.equal(reply.role, 'assistant');
    assert.equal(reply.afterMessageId, DELIVERY_ID, 'the direction of the answer is stated, not assumed');
    assert.equal(reply.verifiedAgainstTranscript, true);
    assert.equal(reply.at, new Date(REPLY_MS).toISOString());

    // (4) A reply grants nothing.
    const permission = block.actionPermission as AnyRecord;
    assert.equal(permission.granted, false);
    assert.equal(permission.reason, KNOWLEDGE_ACTION_PERMISSION_REASON);
    assert.equal((reading.authorization as AnyRecord).state, 'unknown', 'a reply is not an authorization reference');

    // The identity fields travel with the reading.
    const identity = (await world.call('knowledge_facts', {
      kind: 'peer_result',
      session: world.source,
      deliveryId: world.deliveryId,
    })).payload!.identity as AnyRecord;
    assert.equal(identity.contract, KNOWLEDGE_FACT_CONTRACT);
    assert.equal(identity.version, KNOWLEDGE_FACT_CONTRACT_VERSION);
    assert.equal(identity.project, KNOWLEDGE_FACT_PROJECT);
    assert.equal(identity.buildId, BUILD_ID);
    assert.equal(identity.bootId, BOOT_ID);
  });
});

test('(b) a delivery that targeted another session is refused for the named peer', async () => {
  await withHarness({ tag: 'wrong-peer' }, async (world) => {
    await relayAsk(world);
    const reading = await readDelivery(world, { peerSession: world.other }, { label: 'wrong-target', arms: 'wrong-peer' });
    const block = reading.deliveryCorrelation as AnyRecord;
    assert.equal(block.verified, false);
    assert.equal((block.delivery as AnyRecord).state, 'unknown');
    assert.match(
      unknownReason(block.delivery as AnyRecord),
      new RegExp(`targets session "${world.target}", not the named peer "${world.other}"`),
    );
    assert.ok(unknownOf(reading).includes('delivery'));
    assert.equal(world.controlCalls(), 1, 'the read sent nothing; only the explicit relay did');
  });
});

test('(c) a delivery that carried a different correlation is refused', async () => {
  await withHarness({ tag: 'wrong-correlation' }, async (world) => {
    await relayAsk(world);
    const reading = await readDelivery(world, { correlationId: 'corr-some-other-ask' }, { label: 'wrong-correlation', arms: 'wrong-correlation' });
    const block = reading.deliveryCorrelation as AnyRecord;
    assert.equal(block.verified, false);
    assert.match(
      unknownReason(block.delivery as AnyRecord),
      /carries correlation "corr-peer-ask-1", not the named "corr-some-other-ask"/,
    );
  });
});

test('(d) a delivery id with no saved record is an explicit unknown, not a silent success', async () => {
  await withHarness({ tag: 'no-record' }, async (world) => {
    const request = {
      kind: 'peer_result',
      session: world.source,
      peerSession: world.target,
      deliveryId: 'delivery-never-accepted',
    };
    const call = await world.call('knowledge_facts', request);
    capture('no-delivery-record', 'no-record', { tool: 'knowledge_facts', arguments: request }, call);
    const reading = readingOf(call);
    const block = reading.deliveryCorrelation as AnyRecord;
    assert.equal(block.verified, false);
    assert.equal(unknownReason(block.delivery as AnyRecord), KNOWLEDGE_NO_DELIVERY_RECORD_REASON);
    assert.equal((block.originalMessage as AnyRecord).state, 'unknown');
    assert.equal((block.reply as AnyRecord).state, 'unknown');
    assert.ok(unknownOf(reading).includes('delivery.reply'));
    assert.equal(world.controlCalls(), 0, 'reading never sends');
    assert.equal((block.actionPermission as AnyRecord).granted, false);
  });
});

test('(e) an assistant turn that predates the delivery is not borrowed as the reply', async () => {
  await withHarness({ tag: 'old-reply', transcript: 'old-reply' }, async (world) => {
    await relayAsk(world);
    const reading = await readDelivery(world, {}, { label: 'old-reply', arms: 'old-reply' });
    const block = reading.deliveryCorrelation as AnyRecord;
    assert.equal(block.verified, false);
    // The delivered row really is there; only the answer is missing.
    assert.equal(evidenceValue(block.originalMessage as AnyRecord).messageId, DELIVERY_ID);
    assert.equal(unknownReason(block.reply as AnyRecord), KNOWLEDGE_REPLY_NOT_AFTER_DELIVERY_REASON);
    assert.ok(unknownOf(reading).includes('delivery.reply'));
  });
});

test('(f) a transcript window without the delivery id cannot tie the delivery to a row, even when another reply follows', async () => {
  await withHarness({ tag: 'no-row', transcript: 'no-delivery-row' }, async (world) => {
    await relayAsk(world);
    const reading = await readDelivery(world, {}, { label: 'no-delivery-row', arms: 'no-delivery-row' });
    const block = reading.deliveryCorrelation as AnyRecord;
    assert.equal(block.verified, false);
    assert.match(
      unknownReason(block.originalMessage as AnyRecord),
      new RegExp(`does not hold a message with id "${DELIVERY_ID}"`),
    );
    assert.equal((block.reply as AnyRecord).state, 'unknown', 'the later assistant turn is not borrowed either');
  });
});

test('(g) an absent transcript file is an explicit unknown, never an empty successful read', async () => {
  await withHarness({ tag: 'unreadable', transcript: 'missing' }, async (world) => {
    await relayAsk(world);
    const reading = await readDelivery(world, {}, { label: 'absent-transcript', arms: 'missing-transcript' });
    const block = reading.deliveryCorrelation as AnyRecord;
    assert.equal(block.verified, false);
    assert.equal((block.originalMessage as AnyRecord).state, 'unknown');
    assert.match(
      unknownReason(block.originalMessage as AnyRecord),
      new RegExp(`does not hold a message with id "${DELIVERY_ID}"`),
    );
    assert.equal((block.reply as AnyRecord).state, 'unknown');
    assert.equal((block.actionPermission as AnyRecord).granted, false, 'no permission is invented from an unread source');
  });
});

test('(h) a delivery the resident ledger no longer holds cannot be confirmed', async () => {
  await withHarness({ tag: 'forgotten', residentDelivery: 'forgotten' }, async (world) => {
    await relayAsk(world);
    const reading = await readDelivery(world, {}, { label: 'forgotten-delivery', arms: 'forgotten' });
    const block = reading.deliveryCorrelation as AnyRecord;
    assert.equal(block.verified, false);
    assert.equal(unknownReason(block.delivery as AnyRecord), KNOWLEDGE_DELIVERY_NOT_IN_LEDGER_REASON);
  });
});

test('(i) an ordinary answered ask that names no reply messageId stays explicitly unknown', async () => {
  await withHarness({ tag: 'answered-unnamed', events: 'answered-without-message' }, async (world) => {
    const request = { kind: 'peer_result', session: world.source, peerSession: world.target };
    const call = await world.call('knowledge_facts', request);
    capture('answered-without-message', 'answered-unnamed', { tool: 'knowledge_facts', arguments: request }, call);
    const reading = readingOf(call);
    // Not asked for a delivery; the capability is still advertised.
    assert.equal(reading.deliveryCorrelation, null);
    assert.equal((reading.capabilities as AnyRecord).deliveryCorrelation, 'readable');
    assert.equal(unknownReason(reading.reply as AnyRecord), KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON);
    assert.ok(unknownOf(reading).includes('reply'));
    assert.equal(world.controlCalls(), 0);
  });
});

test('(j) unauthorized fields are explicit gaps and a verified reply still grants no action permission', async () => {
  await withHarness({ tag: 'authorization' }, async (world) => {
    await relayAsk(world);
    const reading = await readDelivery(world, {}, { label: 'verified-no-permission', arms: 'authorization' });
    const block = reading.deliveryCorrelation as AnyRecord;
    assert.equal(block.verified, true);
    assert.equal((reading.authorization as AnyRecord).state, 'unknown');
    assert.ok(unknownOf(reading).includes('authorization'));
    const permission = block.actionPermission as AnyRecord;
    assert.deepEqual(Object.keys(permission).sort(), ['granted', 'reason']);
    assert.equal(permission.granted, false);
    assert.match(String(permission.reason), /authorization/i);
  });
});
