import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import express from 'express';

import { createCommandsRouter } from '../commands.routes.js';

/**
 * Stands in for `providerModelsService`. `resolveSessionModel` mirrors the real
 * precedence closely enough for the command handlers: a model recorded for the
 * session wins, otherwise the client's requested model, otherwise the catalog
 * default.
 */
function createModelsService(sessionModels: Record<string, string> = {}) {
  return {
    getProviderModels: async () => ({
      OPTIONS: [{ value: 'default', label: 'Default' }],
      DEFAULT: 'default',
    }),
    getCurrentActiveModel: async () => ({ model: 'default' }),
    setSessionModel: () => null,
    resolveSessionModel: async (
      provider: string,
      options: { sessionId?: string | null; requestedModel?: string | null } = {},
    ) => {
      const recorded = options.sessionId ? sessionModels[options.sessionId] : undefined;
      const model = recorded || options.requestedModel || 'default';
      return {
        provider,
        sessionId: options.sessionId ?? null,
        model,
        source: model === 'default' ? 'default' : 'session',
      };
    },
    resolveResumeModel: async () => undefined,
  };
}

/**
 * Stands in for the providers module's transcript reader. Defaults to "no
 * generated title", which is what every session that is not a Claude one with
 * a titled transcript answers.
 */
const noAiTitle = async () => null;

async function executeCommand(
  commandName: string,
  context: Record<string, unknown>,
  sessionModels: Record<string, string> = {},
  aiTitles: (sessionId: string) => Promise<string | null> = noAiTitle,
): Promise<Record<string, unknown>> {
  const router = createCommandsRouter({
    fileSystem: {
      readFile: async () => JSON.stringify({ name: 'claude-code-ui', version: '0.0.0-test' }),
    } as unknown as typeof import('node:fs/promises'),
    homeDirectory: () => '/home/test',
    appRoot: '/app',
    models: createModelsService(sessionModels) as never,
    aiTitles: aiTitles as never,
    runtime: {
      uptime: () => 0,
      memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
      version: 'v22', platform: 'linux', pid: 1,
    },
  });
  const app = express().use(express.json()).use('/api/commands', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}/api/commands/execute`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ commandName, context }),
    });
    assert.equal(response.status, 200);
    return await response.json() as Record<string, unknown>;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('models command returns models only for the active provider using injected catalog', async () => {
  const result = await executeCommand('/models', { provider: 'codex' });
  const data = result.data as Record<string, unknown>;
  assert.deepEqual(Object.keys(data.available as object), ['codex']);
});

test('models command falls back to claude for unsupported providers', async () => {
  const result = await executeCommand('/models', { provider: 'unknown-provider' });
  const data = result.data as { current: { provider: string } };
  assert.equal(data.current.provider, 'claude');
});

test('models command reports the model recorded for the session', async () => {
  const result = await executeCommand(
    '/models',
    { provider: 'claude', sessionId: 'session-1', model: 'sonnet' },
    { 'session-1': 'haiku' },
  );

  const data = result.data as { current: { model: string } };
  assert.equal(data.current.model, 'haiku');
});

test('models command reports the composer model for a chat with no session yet', async () => {
  const result = await executeCommand('/models', { provider: 'claude', model: 'haiku' });

  const data = result.data as { current: { model: string } };
  assert.equal(data.current.model, 'haiku');
});

test('cost and status commands report the same resolved model as /models', async () => {
  const context = { provider: 'claude', sessionId: 'session-1', model: 'sonnet' };
  const sessionModels = { 'session-1': 'haiku' };

  const cost = await executeCommand('/cost', context, sessionModels);
  const status = await executeCommand('/status', context, sessionModels);

  assert.equal((cost.data as { model: string }).model, 'haiku');
  assert.equal((status.data as { model: string }).model, 'haiku');
});

test('cost command reports the ai-title read for the session', async () => {
  const seen: string[] = [];
  const result = await executeCommand(
    '/cost',
    { provider: 'claude', sessionId: 'session-1' },
    {},
    async (sessionId) => {
      seen.push(sessionId);
      return 'Generated From The Chat';
    },
  );

  assert.deepEqual(seen, ['session-1'], 'the reader must be asked about this session');
  assert.equal((result.data as { aiTitle?: string }).aiTitle, 'Generated From The Chat');
});

test('cost command omits aiTitle when the session has none', async () => {
  const result = await executeCommand(
    '/cost',
    { provider: 'claude', sessionId: 'session-1' },
    {},
    async () => null,
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(result.data, 'aiTitle'),
    false,
    'an absent title must be an absent field, not a null the modal has to interpret',
  );
});

test('cost command does not ask for an ai-title without a session', async () => {
  const seen: string[] = [];
  const result = await executeCommand(
    '/cost',
    { provider: 'claude' },
    {},
    async (sessionId) => {
      seen.push(sessionId);
      return 'Generated From The Chat';
    },
  );

  assert.deepEqual(seen, [], 'a chat with no session row has no transcript to read');
  assert.equal(Object.prototype.hasOwnProperty.call(result.data, 'aiTitle'), false);
});

test('cost command still reports the derived view when the ai-title reader throws', async () => {
  const result = await executeCommand(
    '/cost',
    { provider: 'claude', sessionId: 'session-1', tokenUsage: { used: 120, total: 200 } },
    {},
    async () => {
      throw new Error('transcript unreadable');
    },
  );

  const data = result.data as {
    cost: { context?: { used?: number; window?: number } };
    model: string;
    aiTitle?: string;
  };
  assert.equal(data.cost.context?.used, 120);
  assert.equal(data.cost.context?.window, 200);
  assert.equal(data.model, 'default');
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'aiTitle'), false);
});

test('cost command folds a cumulative reading into the session slot and keeps the window separate', async () => {
  const tokenUsage = {
    used: 2_400,
    total: 258_400,
    inputTokens: 2_000,
    outputTokens: 400,
    cacheReadTokens: 1_500,
    reasoningOutputTokens: 150,
    usageScope: 'session-cumulative',
    observedAt: '2026-10-30T09:30:00.000Z',
    cumulative: {
      inputTokens: 2_000,
      outputTokens: 400,
      cacheReadTokens: 1_500,
      reasoningOutputTokens: 150,
      totalTokens: 2_400,
    },
    lastRequest: {
      inputTokens: 700,
      outputTokens: 120,
      cacheReadTokens: 500,
      reasoningOutputTokens: 60,
      totalTokens: 820,
    },
  };

  const result = await executeCommand('/cost', { provider: 'codex', sessionId: 'session-1', tokenUsage });
  const data = result.data as Record<string, any>;
  const cost = data.cost;

  // A cumulative reading's `used` IS the session total, so it lands in the
  // session slot instead of being repeated as a context occupancy.
  assert.equal(cost.session.total, tokenUsage.cumulative.totalTokens);
  assert.equal(cost.context.used, undefined);
  // The window is an independent fact, never a denominator applied to `used`.
  assert.equal(cost.context.window, 258_400);
  assert.equal(cost.session.input, 2_000);
  assert.equal(cost.session.output, 400);
  assert.equal(cost.session.cacheRead, 1_500);
  assert.equal(cost.session.reasoningOutput, 150);
  // Server-derived: cached input over input, and the uncached remainder.
  assert.equal(cost.session.cacheHitRatio, 0.75);
  assert.equal(cost.session.fresh, 500);
  assert.deepEqual(cost.lastRequest, tokenUsage.lastRequest);
  // Detail reads stay detail: no second total is produced by adding them up.
  assert.equal(Object.keys(cost.session).some((key) => /percent|fraction/i.test(key)), false);
});

test('cost command omits unreported quantities instead of reporting zero', async () => {
  const result = await executeCommand('/cost', {
    provider: 'codex',
    sessionId: 'session-1',
    tokenUsage: {
      used: 10,
      usageScope: 'session-cumulative',
      cumulative: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
    },
  });
  const data = result.data as Record<string, any>;
  const cost = data.cost;

  assert.equal(cost.session.total, 10);
  // The explicit zero survives, and the absent cache/reasoning reads do not
  // turn into zeros.
  assert.equal(cost.session.output, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(cost.session, 'cacheRead'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cost.session, 'cacheWrite'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cost.session, 'reasoningOutput'), false);
  // With no cache read reported there is no numerator, so no ratio or fresh row.
  assert.equal(cost.session.cacheHitRatio, undefined);
  assert.equal(cost.session.fresh, undefined);
  assert.equal(cost.lastRequest, undefined);
  // No window was reported, so the context block is absent rather than zeroed.
  assert.equal(cost.context, undefined);
});

test('cost command derives one provider-agnostic view for a context-scoped reading', async () => {
  // A Claude-shaped reading: `used` is the newest turn (context occupancy), and
  // the reader leaves `usageScope` unset. Its cumulative block still describes
  // the whole session, so the two facts land in different slots.
  const result = await executeCommand('/cost', {
    provider: 'claude',
    sessionId: 'session-1',
    tokenUsage: {
      used: 120,
      total: 200_000,
      cumulative: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 75,
        cacheWriteTokens: 5,
      },
      lastRequest: { inputTokens: 90, outputTokens: 15, cacheReadTokens: 60 },
    },
  });
  const data = result.data as Record<string, any>;
  const cost = data.cost;

  // The session total is the cumulative spend, never the newest-turn occupancy.
  assert.equal(cost.session.total, 100 + 20);
  assert.equal(cost.context.used, 120);
  assert.equal(cost.context.window, 200_000);
  // Ratio and fresh remainder are derived on the server from cache reads only.
  assert.equal(cost.session.cacheHitRatio, 0.75);
  assert.equal(cost.session.fresh, 100 - 75 - 5);
  assert.match(cost.accountingNote, /Input already includes cache reads and cache writes/);
  assert.deepEqual(cost.lastRequest, { inputTokens: 90, outputTokens: 15, cacheReadTokens: 60 });

  // The retired wire shape is gone, including the dual-meaning top-level fields.
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'used'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'scope'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'tokenUsage'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'tokenBreakdown'), false);
});

test('cost command passes cacheWrite through as a subset of input', async () => {
  const tokenUsage = {
    used: 2_400,
    total: 258_400,
    usageScope: 'session-cumulative',
    cumulative: {
      inputTokens: 2_000,
      outputTokens: 400,
      cacheReadTokens: 1_500,
      cacheWriteTokens: 300,
      totalTokens: 2_400,
    },
    lastRequest: {
      inputTokens: 700,
      outputTokens: 120,
      cacheReadTokens: 500,
      cacheWriteTokens: 80,
      totalTokens: 820,
    },
  };

  const result = await executeCommand('/cost', { provider: 'claude', sessionId: 'session-1', tokenUsage });
  const data = result.data as Record<string, any>;

  // Both scopes carry their own written-to-cache quantity unchanged.
  assert.deepEqual(data.cost.lastRequest, tokenUsage.lastRequest);
  assert.equal(data.cost.session.cacheWrite, 300);
  assert.equal(data.cost.lastRequest.cacheWriteTokens, 80);
  // cacheWrite is a subset of input and is never folded into input or output as
  // another addend; it is only subtracted from the derived fresh remainder.
  assert.equal(data.cost.session.input, 2_000);
  assert.equal(data.cost.session.fresh, 2_000 - 1_500 - 300);
});

test('cost command omits cacheWrite when the reading never reported it', async () => {
  const result = await executeCommand('/cost', {
    provider: 'claude',
    sessionId: 'session-1',
    tokenUsage: {
      used: 10,
      usageScope: 'session-cumulative',
      cumulative: { inputTokens: 10, outputTokens: 0, totalTokens: 10 },
    },
  });
  const data = result.data as Record<string, any>;

  assert.equal(
    Object.prototype.hasOwnProperty.call(data.cost.session, 'cacheWrite'),
    false,
    'an unreported cache write must stay absent, not print as zero',
  );
  assert.deepEqual(data.cost.session, {
    total: 10,
    input: 10,
    output: 0,
  });
});

test('cost command builds a session block from a flat context reading', async () => {
  const result = await executeCommand('/cost', {
    provider: 'claude',
    sessionId: 'session-1',
    tokenUsage: {
      used: 120,
      total: 200_000,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
    },
  });
  const data = result.data as Record<string, any>;
  const cost = data.cost;

  // The flat reading's own counts describe the session; `used` stays the
  // newest-turn occupancy in the context slot.
  assert.equal(cost.session.total, 100 + 20);
  assert.equal(cost.session.input, 100);
  assert.equal(cost.session.output, 20);
  assert.equal(cost.session.cacheRead, 10);
  // Anthropic's cache-creation quantity is the write half of the same prompt.
  assert.equal(cost.session.cacheWrite, 5);
  assert.equal(cost.session.cacheHitRatio, 0.1);
  assert.equal(cost.session.fresh, 100 - 10 - 5);
  assert.equal(cost.context.used, 120);
  assert.equal(cost.context.window, 200_000);
  assert.equal(cost.lastRequest, undefined);
  assert.equal(data.provider, 'claude');
});
