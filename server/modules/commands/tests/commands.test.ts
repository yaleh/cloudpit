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

test('cost command still reports usage when the ai-title reader throws', async () => {
  const result = await executeCommand(
    '/cost',
    { provider: 'claude', sessionId: 'session-1', tokenUsage: { used: 120, total: 200 } },
    {},
    async () => {
      throw new Error('transcript unreadable');
    },
  );

  const data = result.data as { tokenUsage: { used: number; total: number }; model: string; aiTitle?: string };
  assert.equal(data.tokenUsage.used, 120);
  assert.equal(data.tokenUsage.total, 200);
  assert.equal(data.model, 'default');
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'aiTitle'), false);
});

test('cost command groups a cumulative Codex reading without deriving a context ratio', async () => {
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

  assert.deepEqual(data.tokenUsage, {
    used: 2_400,
    total: 258_400,
    scope: 'session-cumulative',
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
    observedAt: '2026-10-30T09:30:00.000Z',
  });
  // Detail reads stay detail: no second total is produced by adding them up.
  assert.deepEqual(data.tokenBreakdown, {
    input: 2_000,
    output: 400,
    cacheRead: 1_500,
    reasoningOutput: 150,
  });
  // The window is an independent fact, never a denominator applied to `used`.
  assert.equal(data.tokenUsage.total, 258_400);
  assert.notEqual(data.tokenUsage.total, data.tokenUsage.used);
  assert.equal(Object.keys(data.tokenUsage).some((key) => /percent|ratio|fraction/i.test(key)), false);
});

test('cost command omits unreported Codex quantities instead of reporting zero', async () => {
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

  assert.equal(data.tokenUsage.total, undefined);
  assert.equal(data.tokenUsage.lastRequest, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(data.tokenUsage, 'observedAt'), false);
  // The explicit zero survives, and the absent cache/reasoning reads do not
  // turn into zeros.
  assert.equal(data.tokenUsage.cumulative.outputTokens, 0);
  // Absent detail stays absent; assert before deepEqual narrows the block.
  assert.equal(data.tokenBreakdown.cacheRead, undefined);
  assert.equal(data.tokenBreakdown.reasoningOutput, undefined);
  assert.deepEqual(data.tokenBreakdown, { input: 10, output: 0 });
});

test('cost command keeps the legacy Claude reading and arithmetic', async () => {
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

  // No structured fields are grafted onto a context-style reading. Assert
  // absence before deepEqual narrows the object to the literal it compared.
  assert.equal(data.tokenUsage.scope, undefined);
  assert.equal(data.tokenUsage.cumulative, undefined);
  assert.equal(data.tokenUsage.lastRequest, undefined);
  assert.deepEqual(data.tokenUsage, { used: 120, total: 200_000 });
  assert.deepEqual(data.tokenBreakdown, { input: 100, output: 20 });
  assert.equal(data.provider, 'claude');
});
