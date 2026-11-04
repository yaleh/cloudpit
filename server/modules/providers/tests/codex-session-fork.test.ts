import assert from 'node:assert/strict';
import test from 'node:test';

import { codexAppServer } from '@/modules/providers/list/codex/codex-app-server.client.js';
import { CodexForkProvider } from '@/modules/providers/list/codex/codex-fork.provider.js';
import { installCodexProviderRegistryPort } from '@/shared/ports/codex-provider-registry.port.js';

/**
 * The fork endpoint itself is exercised against the real `codex app-server` in
 * codex-message-editing.test.ts, which is where the rewind that depends on it
 * lives. What is left for the fork provider is the mapping either side of it.
 */

test('a Codex fork asks for the whole thread when no anchor is given', { concurrency: false }, async () => {
  const realForkThread = codexAppServer.forkThread;
  const forkCalls: unknown[] = [];
  codexAppServer.forkThread = async (input) => {
    forkCalls.push(input);
    return { threadId: 'thread-2', path: '/tmp/rollout-thread-2.jsonl' };
  };

  try {
    const forked = await new CodexForkProvider().forkSession({
      providerSessionId: 'thread-1',
      jsonlPath: '/tmp/rollout-thread-1.jsonl',
      projectPath: '/tmp/workspace',
      title: 'ignored by codex',
    });
    assert.deepEqual(forked, { providerSessionId: 'thread-2', jsonlPath: '/tmp/rollout-thread-2.jsonl' });
  } finally {
    codexAppServer.forkThread = realForkThread;
  }

  assert.deepEqual(forkCalls, [{ threadId: 'thread-1', lastTurnId: undefined, cwd: '/tmp/workspace' }]);
});

test('forking from a message cuts through that message\'s turn', async () => {
  const realForkThread = codexAppServer.forkThread;
  const forkCalls: unknown[] = [];
  codexAppServer.forkThread = async (input) => {
    forkCalls.push(input);
    return { threadId: 'thread-2', path: '/tmp/rollout-thread-2.jsonl' };
  };

  try {
    await new CodexForkProvider().forkSession({
      providerSessionId: 'thread-1',
      jsonlPath: '/tmp/rollout-thread-1.jsonl',
      projectPath: '/tmp/workspace',
      upToAnchorId: 'turn-b',
    });
  } finally {
    codexAppServer.forkThread = realForkThread;
  }

  // Inclusive of the turn it names, so the branch keeps the message that was
  // forked from *and* the answer it got. A turn is written as one thing; there
  // is no cut that stops between them.
  assert.deepEqual(forkCalls, [{ threadId: 'thread-1', lastTurnId: 'turn-b', cwd: '/tmp/workspace' }]);
});

test('a fork bound to an upstream provider carries that provider launch', { concurrency: false }, async () => {
  const realForkThread = codexAppServer.forkThread;
  const forkCalls: unknown[] = [];
  codexAppServer.forkThread = async (input) => {
    forkCalls.push(input);
    return { threadId: 'thread-2', path: '/tmp/rollout-thread-2.jsonl' };
  };
  installCodexProviderRegistryPort({
    read: () => ({ providers: [{ id: 'fjdac' }], reservedIds: [] }),
    resolve: (id) => ({ ok: true, provider: { id, name: 'FJDAC', baseUrl: 'http://127.0.0.1:26510/v1', envKey: 'FJDAC_API_KEY', wireApi: 'responses', secret: 'secret' } }),
  });

  try {
    await new CodexForkProvider().forkSession({
      providerSessionId: 'thread-1',
      jsonlPath: '/tmp/rollout-thread-1.jsonl',
      projectPath: '/tmp/workspace',
      modelProviderId: 'fjdac',
    });
  } finally {
    codexAppServer.forkThread = realForkThread;
  }

  const call = forkCalls[0] as { launch?: { args?: string[]; env?: Record<string, string | undefined> } };
  assert.ok(call.launch, 'a bound fork must carry a provider launch');
  assert.ok(
    (call.launch.args ?? []).some((arg) => arg.includes('model_provider')),
    `the launch must bind the provider, got: ${JSON.stringify(call.launch.args)}`,
  );
  assert.equal(call.launch.env?.FJDAC_API_KEY, 'secret');
});
