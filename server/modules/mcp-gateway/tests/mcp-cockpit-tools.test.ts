/**
 * gap-mcp-cockpit-card-tools criterion: the cockpit's cards are reachable over
 * the MCP gateway — three reads under `cloudcli:read` and one confirm under the
 * new `cloudcli:cockpit:act` — and every one of them reads the SAME cockpit
 * module the HTTP face reads.
 *
 * Nothing here is a stand-in for the wiring. Each arm boots the REAL
 * `createCockpitCardsModule` (the fixture provider plus a criterion provider
 * whose executor only records what it was asked to confirm), mounts its router
 * at `/api/cockpit/cards` for the same-source readings, and mounts the
 * production `/mcp` endpoint behind the production token middleware. The client
 * is the MCP SDK's own `Client` over `StreamableHTTPClientTransport`, so
 * `tools/list`, the scope refusals and the error envelopes are read off the
 * wire. The database is a real migrated temp DB, so the audit rows land in the
 * shipping `mcp_audit_log`.
 *
 * Readings, one leg each:
 *   AC4 — `tools/list` carries the four names; each name's required scope is
 *       read back from the scope check itself (a token lacking it is refused
 *       with `details.requiredScopes`), because `tools/list` carries no scope;
 *       `cockpit_card_confirm` declares `readOnlyHint: false` /
 *       `openWorldHint: true`.
 *   AC5 — `cockpit_cards` deep-equals `GET /api/cockpit/cards`, `cockpit_card`
 *       returns the card the list carries, and `cockpit_card_brief` deep-equals
 *       `GET /api/cockpit/cards/:id/brief` (a fixture BriefSpec) or answers the
 *       deterministic `unsupported-content` fallback.
 *   AC6 — one confirm executes the executor exactly once; the same
 *       `(card, revision)` again is `ALREADY_CONFIRMED`; an older revision is
 *       `REVISION_CONFLICT`; an unknown option id is `INVALID_REQUEST`.
 *   AC7 — a `cloudcli:read`-only token reads but is refused on confirm with one
 *       `denied` audit row and zero executions; a `cloudcli:cockpit:act` token
 *       confirms successfully.
 *
 * The transport is handed a `node:http`-based `fetch`: `listen(0)` on this host
 * lands on a port undici refuses often enough to red a suite run at random, the
 * same seam the sibling criteria use.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import express from 'express';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { CockpitCard, CockpitCardOption } from '@/shared/types.js';

// `auth.middleware.ts` resolves the JWT secret at module-load time and
// `shared/utils.ts` freezes IS_PLATFORM on first import, so the environment is
// set before any aliased module is pulled in — every application module below
// therefore comes in dynamically.
process.env.JWT_SECRET = 'mcp-cockpit-tools-test-secret';
delete process.env.VITE_IS_PLATFORM;

const SCRATCH = mkdtempSync(path.join(os.tmpdir(), 'mcp-cockpit-tools-'));
after(async () => {
  await rm(SCRATCH, { recursive: true, force: true });
});

const { closeConnection, getConnection, initializeDatabase, mcpAuditLogDb } = await import(
  '@/modules/database/index.js'
);
const { createAccessTokensService } = await import('@/modules/oauth/index.js');
const { createCockpitCardsModule } = await import('@/modules/cockpit/index.js');
const {
  MCP_COCKPIT_ACT_SCOPE,
  MCP_COCKPIT_READ_SCOPE,
  MCP_COCKPIT_TOOL_NAMES,
  MCP_GATEWAY_PATH,
  createMcpAuthMiddleware,
  mountMcpGateway,
} = await import('../index.js');

type AnyRecord = Record<string, unknown>;

const USER_ONE = 1;
/** The card the criterion provider owns; its revision never moves in this file. */
const CARD_ID = 'criterion:card';
const OPTION_ID = 'approve';
const EXECUTOR_ID = 'criterion.record';
/** Deliberately not 1: an "older revision" leg has to be a real older value. */
const CARD_REVISION = 2;
/** A fixture card, used for the real-BriefSpec half of AC5. */
const FIXTURE_CARD_ID = 'fixture:ask';

/** One line of this criterion's readings. The readings are the evidence. */
function say(line: string): void {
  console.log(`cockpit ${line}`);
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

/** `GET` a JSON body over `node:http` (the cockpit router's HTTP face). */
async function getJson(url: string): Promise<AnyRecord> {
  const response = await nodeFetch(url, { method: 'GET' });
  assert.equal(response.status, 200, `${url} must answer 200`);
  return (await response.json()) as AnyRecord;
}

// --------------------------- tool result parsing ---------------------------

type ToolCall = { isError: boolean; text: string; payload: AnyRecord | null };

function parseToolResult(result: unknown): ToolCall {
  const call = result as { content?: unknown; isError?: boolean; structuredContent?: unknown };
  const blocks = Array.isArray(call.content) ? call.content : [];
  const text = blocks.map((block) => (block as { type?: string; text?: string }).text ?? '').join('');
  let payload: AnyRecord | null = null;
  // A FAILURE carries its machine fields in `structuredContent`
  // (`{ code, message, retryable, details? }`); a SUCCESS payload is the text body.
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

// --------------------------- the criterion provider ---------------------------

const NOW = '2026-10-28T09:00:00.000Z';

/** The one option the criterion card offers; its executor records the call. */
function criterionOption(): CockpitCardOption {
  return {
    id: OPTION_ID,
    label: 'Approve the criterion',
    does: 'Record that the criterion approved the card.',
    suggested: true,
    source: 'provider',
    action: { executor: EXECUTOR_ID, params: { cardId: CARD_ID, optionId: OPTION_ID } },
  };
}

/** The card the criterion provider owns — open, revision 2, one confirmable option. */
function criterionCard(): CockpitCard {
  return {
    id: CARD_ID,
    provider: 'criterion',
    revision: CARD_REVISION,
    kind: 'need',
    group: 'rescue',
    rank: 1,
    state: 'open',
    waitingSince: NOW,
    surfacedAt: NOW,
    subject: { uri: 'cloudcli://criterion/card', project: 'criterion-project', title: 'Criterion card' },
    ask: 'Should the criterion approve this card?',
    facts: [{ text: 'the criterion provider produced this card', mechanical: true, observedAt: NOW }],
    options: [criterionOption()],
  };
}

type ExecutorLog = { count: number; params: AnyRecord[] };

/**
 * The criterion provider and its executor. The executor does NOT bump the
 * revision: the accepted-ledger arm of AC6 needs the same `(card, revision)` to
 * still be current when it is confirmed a second time, so the repeat reaches
 * `ALREADY_CONFIRMED` rather than `REVISION_CONFLICT`.
 */
function createCriterionProvider(log: ExecutorLog) {
  // Shape-identical to `CockpitCardProviderDiagnostic` (the cockpit module's
  // server-side operator type); stated as a literal so this criterion does not
  // reach into the module's internals for a type it only has to produce.
  const diagnostic = {
    provider: 'criterion',
    ok: true,
    reason: null,
    cards: 1,
    skippedLines: 0,
    cached: false,
  };
  return {
    provider: {
      id: 'criterion',
      listCards: () => [criterionCard()],
      declaredExecutors: () => [EXECUTOR_ID],
      // Present so `diagnostics` rides the card list — the reading that tells an
      // empty list apart from a provider whose read failed.
      diagnostics: () => [diagnostic],
    },
    executor: {
      id: EXECUTOR_ID,
      execute: (params: AnyRecord) => {
        log.count += 1;
        log.params.push(params);
        return { recorded: true };
      },
    },
  };
}

// --------------------------- harness ---------------------------

type Arm = {
  baseUrl: string;
  log: ExecutorLog;
  /** Calls one tool with the read-only token / the act token / the navigate-only token. */
  callAs: (which: 'read' | 'act' | 'navigate', name: string, args?: AnyRecord) => Promise<ToolCall>;
  listToolsAs: (which: 'read' | 'act' | 'navigate') => Promise<Array<{ name: string; annotations?: AnyRecord }>>;
  /** `GET` a path on the SAME express app (the cockpit router lives there). */
  get: (route: string) => Promise<AnyRecord>;
};

/** Issues one token, failing the arm loudly if the service refuses. */
function issue(tokens: ReturnType<typeof createAccessTokensService>, name: string, scopes: string[]): string {
  const issued = tokens.issueToken({ userId: USER_ONE, name, scopes, expiresInDays: 30 });
  assert.ok(issued.ok, `the harness must mint the ${name} token`);
  return issued.token.token;
}

/**
 * Boots one arm: a fresh migrated temp DB, the real cockpit card module with the
 * fixture provider plus the criterion provider, its router mounted for the
 * same-source readings, and the production `/mcp` mount carrying the cockpit
 * tools bag derived from that ONE module.
 */
async function withArm(run: (arm: Arm) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(SCRATCH, 'arm-'));
  closeConnection();
  process.env.DATABASE_PATH = path.join(tempDirectory, 'cockpit.db');
  await initializeDatabase();
  getConnection()
    .prepare('INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)')
    .run(USER_ONE, 'owner', 'hash');

  const log: ExecutorLog = { count: 0, params: [] };
  const criterion = createCriterionProvider(log);
  const cockpitCards = createCockpitCardsModule({
    fixtureCards: true,
    providers: [criterion.provider],
    executors: [criterion.executor],
  });

  const tokens = createAccessTokensService({ now: () => new Date() });
  const issued = {
    read: issue(tokens, 'cockpit-read', [MCP_COCKPIT_READ_SCOPE]),
    act: issue(tokens, 'cockpit-act', [MCP_COCKPIT_READ_SCOPE, MCP_COCKPIT_ACT_SCOPE]),
    navigate: issue(tokens, 'cockpit-navigate', ['cloudcli:navigate']),
  };

  const app = express();
  app.use(express.json({ limit: '50mb' }));
  // The HTTP face the MCP tools must be same-source with.
  app.use('/api/cockpit/cards', cockpitCards.router);
  mountMcpGateway(app, {
    env: { MCP_ENABLED: 'true' },
    authorize: createMcpAuthMiddleware(tokens),
    // The card module's OWN members, taken whole — the production shape
    // `server/index.ts` passes.
    cockpitTools: {
      registry: cockpitCards.registry,
      actions: cockpitCards.actions,
      briefForCard: cockpitCards.briefForCard,
    },
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const clients = new Map<string, Client>();

  /** One connected SDK client per token, so a call never pays a second handshake. */
  async function clientFor(which: keyof typeof issued): Promise<Client> {
    const existing = clients.get(which);
    if (existing !== undefined) return existing;
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}${MCP_GATEWAY_PATH}`), {
      fetch: nodeFetch,
      requestInit: { headers: { authorization: `Bearer ${issued[which]}` } },
    });
    const client = new Client({ name: `cockpit-${which}`, version: '0.0.0' });
    await client.connect(transport);
    clients.set(which, client);
    return client;
  }

  try {
    await run({
      baseUrl,
      log,
      callAs: async (which, name, args = {}) => {
        const client = await clientFor(which);
        return parseToolResult(await client.callTool({ name, arguments: args }));
      },
      listToolsAs: async (which) => {
        const client = await clientFor(which);
        const listed = await client.listTools();
        return listed.tools.map((tool) => ({
          name: tool.name,
          annotations: tool.annotations as AnyRecord | undefined,
        }));
      },
      get: (route) => getJson(`${baseUrl}${route}`),
    });
  } finally {
    for (const client of clients.values()) {
      await client.close().catch(() => undefined);
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
  }
}

// --------------------------- (AC4) tools/list + scopes ---------------------------

test('(AC4) tools/list carries the four cockpit tools; the scopes are the ones the check enforces', async () => {
  await withArm(async (arm) => {
    const listed = await arm.listToolsAs('act');
    const byName = new Map(listed.map((tool) => [tool.name, tool]));

    for (const name of MCP_COCKPIT_TOOL_NAMES) {
      assert.ok(byName.has(name), `tools/list must carry ${name}`);
    }
    const confirm = byName.get('cockpit_card_confirm');
    assert.equal(confirm?.annotations?.readOnlyHint, false, 'cockpit_card_confirm must not be marked read-only');
    assert.equal(confirm?.annotations?.openWorldHint, true, 'cockpit_card_confirm drives a provider agent, so the world opens');
    say(
      `AC4 tools/list annotations cockpit_card_confirm ${JSON.stringify(confirm?.annotations)}`,
    );

    // `tools/list` carries no scope, so each tool's requiredScope is read from
    // the scope check itself: a token that lacks it is refused with
    // `details.requiredScopes` naming exactly the missing scope. That is the
    // reading AC4 asks for — what the mount actually enforces per tool.
    const reads = ['cockpit_cards', 'cockpit_card', 'cockpit_card_brief'];
    for (const name of reads) {
      const args = name === 'cockpit_cards' ? {} : { cardId: CARD_ID };
      const refused = await arm.callAs('navigate', name, args);
      assert.equal(refused.isError, true, `${name} must refuse a token without cloudcli:read`);
      assert.equal(refused.payload?.code, 'INSUFFICIENT_SCOPE', `${name} must be refused by the scope check`);
      assert.deepEqual(
        (refused.payload?.details as AnyRecord | undefined)?.requiredScopes,
        [MCP_COCKPIT_READ_SCOPE],
        `${name} must require exactly cloudcli:read`,
      );
      say(`AC4 ${name} requiredScope ${JSON.stringify((refused.payload?.details as AnyRecord).requiredScopes)}`);
    }

    const confirmRefusal = await arm.callAs('read', 'cockpit_card_confirm', {
      cardId: CARD_ID,
      revision: CARD_REVISION,
      optionId: OPTION_ID,
    });
    assert.equal(confirmRefusal.isError, true, 'a cloudcli:read token must not confirm');
    assert.deepEqual(
      (confirmRefusal.payload?.details as AnyRecord | undefined)?.requiredScopes,
      [MCP_COCKPIT_ACT_SCOPE],
      'cockpit_card_confirm must require exactly cloudcli:cockpit:act',
    );
    say(
      `AC4 cockpit_card_confirm requiredScope ${JSON.stringify((confirmRefusal.payload?.details as AnyRecord).requiredScopes)}`,
    );

    assert.equal(arm.log.count, 0, 'none of the scope readings may execute the executor');
  });
});

// --------------------------- (AC5) same-source reads ---------------------------

test('(AC5) cockpit_cards / cockpit_card / cockpit_card_brief read the same module as the HTTP face', async () => {
  await withArm(async (arm) => {
    const viaMcp = await arm.callAs('read', 'cockpit_cards');
    assert.equal(viaMcp.isError, false, 'cockpit_cards must succeed under cloudcli:read');
    const viaHttp = await arm.get('/api/cockpit/cards');
    assert.deepEqual(viaMcp.payload, viaHttp, 'cockpit_cards must answer the same body as GET /api/cockpit/cards');

    const cards = viaMcp.payload?.cards as Array<AnyRecord>;
    assert.ok(Array.isArray(cards) && cards.length > 1, 'the fixture provider plus the criterion provider must produce cards');
    assert.ok(
      Array.isArray(viaMcp.payload?.diagnostics) && (viaMcp.payload?.diagnostics as unknown[]).length === 1,
      'the criterion provider\'s diagnostic must ride along, so an empty list is distinguishable from a failed read',
    );
    say(`AC5 cockpit_cards ${JSON.stringify({ cards: cards.length, diagnostics: viaMcp.payload?.diagnostics })}`);

    const one = await arm.callAs('read', 'cockpit_card', { cardId: CARD_ID });
    assert.equal(one.isError, false, 'cockpit_card must succeed under cloudcli:read');
    assert.deepEqual(one.payload, cards.find((card) => card.id === CARD_ID), 'cockpit_card must return the card the list carries');
    say(`AC5 cockpit_card ${JSON.stringify(one.payload)}`);

    const fixtureBriefMcp = await arm.callAs('read', 'cockpit_card_brief', { cardId: FIXTURE_CARD_ID });
    assert.equal(fixtureBriefMcp.isError, false, 'cockpit_card_brief must succeed under cloudcli:read');
    const fixtureBriefHttp = await arm.get(`/api/cockpit/cards/${FIXTURE_CARD_ID}/brief`);
    assert.deepEqual(
      fixtureBriefMcp.payload,
      fixtureBriefHttp,
      'cockpit_card_brief must answer the same body as GET /api/cockpit/cards/:id/brief',
    );
    say(
      `AC5 cockpit_card_brief(${FIXTURE_CARD_ID}) status=${String(fixtureBriefMcp.payload?.status)} cardId=${String(fixtureBriefMcp.payload?.cardId)}`,
    );

    // A card with no briefable content answers the DETERMINISTIC fallback rather
    // than inventing a brief — the same answer the route gives it.
    const fallback = await arm.callAs('read', 'cockpit_card_brief', { cardId: CARD_ID });
    assert.equal(fallback.isError, false, 'an unbriefable card is still a successful brief reading');
    const fallbackHttp = await arm.get(`/api/cockpit/cards/${CARD_ID}/brief`);
    assert.deepEqual(fallback.payload, fallbackHttp, 'the fallback must be the route\'s fallback, not a second one');
    assert.equal(fallback.payload?.status, 'fallback', 'an unbriefable card must answer the fallback status');
    assert.equal(fallback.payload?.reason, 'unsupported-content', 'the fallback must name its reason');
    say(
      `AC5 cockpit_card_brief(${CARD_ID}) status=${String(fallback.payload?.status)} reason=${String(fallback.payload?.reason)}`,
    );

    // A missing card is the card module's own refusal, forwarded verbatim.
    const missing = await arm.callAs('read', 'cockpit_card', { cardId: 'criterion:absent' });
    assert.equal(missing.isError, true, 'an unknown card id must be an error');
    assert.equal(missing.payload?.code, 'CARD_NOT_FOUND', 'an unknown card id must answer CARD_NOT_FOUND');
    say(`AC5 cockpit_card(criterion:absent) code=${String(missing.payload?.code)}`);
  });
});

// --------------------------- (AC6) confirm through the action channel ---------------------------

test('(AC6) cockpit_card_confirm runs the executor once and forwards every action-channel refusal', async () => {
  await withArm(async (arm) => {
    const first = await arm.callAs('act', 'cockpit_card_confirm', {
      cardId: CARD_ID,
      revision: CARD_REVISION,
      optionId: OPTION_ID,
    });
    assert.equal(first.isError, false, 'the first confirmation at the current revision must succeed');
    assert.equal(arm.log.count, 1, 'the executor must run exactly once');
    assert.equal(first.payload?.executor, EXECUTOR_ID, 'the answer must name the executor that ran');
    assert.deepEqual(
      first.payload?.params,
      { cardId: CARD_ID, optionId: OPTION_ID },
      'the option\'s declared params must reach the executor verbatim',
    );
    assert.deepEqual(first.payload?.result, { recorded: true }, 'the executor\'s own result must be returned');
    say(`AC6 cockpit_card_confirm ok ${JSON.stringify(first.payload)}`);

    // Same (card, revision) again: the accepted ledger refuses a second run.
    const repeat = await arm.callAs('act', 'cockpit_card_confirm', {
      cardId: CARD_ID,
      revision: CARD_REVISION,
      optionId: OPTION_ID,
    });
    assert.equal(repeat.isError, true, 'a repeat of an accepted confirmation must be refused');
    assert.equal(repeat.payload?.code, 'ALREADY_CONFIRMED', 'a repeat must answer ALREADY_CONFIRMED');
    assert.equal(arm.log.count, 1, 'a refused repeat must not execute the executor');
    say(`AC6 cockpit_card_confirm repeat code=${String(repeat.payload?.code)} message=${String(repeat.payload?.message)}`);

    // An older revision is a conflict, not a second execution.
    const stale = await arm.callAs('act', 'cockpit_card_confirm', {
      cardId: CARD_ID,
      revision: CARD_REVISION - 1,
      optionId: OPTION_ID,
    });
    assert.equal(stale.isError, true, 'a stale revision must be refused');
    assert.equal(stale.payload?.code, 'REVISION_CONFLICT', 'a stale revision must answer REVISION_CONFLICT');
    assert.equal(arm.log.count, 1, 'a stale revision must not execute the executor');
    say(`AC6 cockpit_card_confirm stale code=${String(stale.payload?.code)} message=${String(stale.payload?.message)}`);

    // An option the card does not offer is malformed input, decided by the channel.
    const badOption = await arm.callAs('act', 'cockpit_card_confirm', {
      cardId: CARD_ID,
      revision: CARD_REVISION,
      optionId: 'criterion:no-such-option',
    });
    assert.equal(badOption.isError, true, 'an unknown option id must be refused');
    assert.equal(badOption.payload?.code, 'INVALID_REQUEST', 'an unknown option id must answer INVALID_REQUEST');
    assert.equal(arm.log.count, 1, 'an unknown option id must not execute the executor');
    say(`AC6 cockpit_card_confirm bad option code=${String(badOption.payload?.code)} message=${String(badOption.payload?.message)}`);
  });
});

// --------------------------- (AC7) the scopes are in force ---------------------------

test('(AC7) cloudcli:read reads but cannot confirm; cloudcli:cockpit:act confirms', async () => {
  await withArm(async (arm) => {
    // Positive control for the read scope: all three reads work with it.
    for (const [name, args] of [
      ['cockpit_cards', {}],
      ['cockpit_card', { cardId: CARD_ID }],
      ['cockpit_card_brief', { cardId: FIXTURE_CARD_ID }],
    ] as Array<[string, AnyRecord]>) {
      const reading = await arm.callAs('read', name, args);
      assert.equal(reading.isError, false, `${name} must succeed under a cloudcli:read-only token`);
    }
    say('AC7 read token: cockpit_cards / cockpit_card / cockpit_card_brief all ok');

    const before = mcpAuditLogDb.count();
    const denied = await arm.callAs('read', 'cockpit_card_confirm', {
      cardId: CARD_ID,
      revision: CARD_REVISION,
      optionId: OPTION_ID,
    });
    const afterCount = mcpAuditLogDb.count();

    assert.equal(denied.isError, true, 'a cloudcli:read-only token must not confirm');
    assert.equal(denied.payload?.code, 'INSUFFICIENT_SCOPE', 'the refusal must be the audited scope check');
    assert.equal(arm.log.count, 0, 'a denied confirmation must not execute the executor');
    assert.equal(afterCount, before + 1, 'a denied confirmation must write exactly one audit row');

    const rows = mcpAuditLogDb.allRows();
    const row = rows[rows.length - 1];
    assert.equal(row.tool, 'cockpit_card_confirm', 'the denied row must name the confirm tool');
    assert.equal(row.outcome, 'denied', 'the denied row must record the denial');
    assert.deepEqual(JSON.parse(String(row.denied_scopes)), [MCP_COCKPIT_ACT_SCOPE], 'the denied row must name the missing scope');
    say(
      `AC7 denied audit count ${before}->${afterCount} row=${JSON.stringify({ tool: row.tool, outcome: row.outcome, denied_scopes: row.denied_scopes })}`,
    );

    const allowed = await arm.callAs('act', 'cockpit_card_confirm', {
      cardId: CARD_ID,
      revision: CARD_REVISION,
      optionId: OPTION_ID,
    });
    assert.equal(allowed.isError, false, 'the cloudcli:cockpit:act token must confirm');
    assert.equal(arm.log.count, 1, 'the allowed confirmation must execute the executor exactly once');
    say(`AC7 act token: cockpit_card_confirm ok executor=${String(allowed.payload?.executor)}`);
  });
});
