import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Codex } from '@openai/codex-sdk';
import type { Thread, ThreadOptions } from '@openai/codex-sdk';

import { codexRuntime } from '@/modules/providers/list/codex/host/codex-runtime.provider.js';
import type { ProviderRuntimeContext } from '@/shared/index.js';

for (const resumed of [false, true]) {
  for (const permissionMode of [undefined, 'default', 'unknown', 'acceptEdits', 'bypassPermissions']) {
    test(`Codex ${resumed ? 'resumes' : 'starts'} with supported permissions (${permissionMode ?? 'omitted'})`, async (t) => {
      let capturedOptions: ThreadOptions | undefined;
      let capturedPrompt: unknown;
      const messages: unknown[] = [];
      const thread = {
        id: 'native-thread',
        async runStreamed(prompt: unknown) {
          capturedPrompt = prompt;
          return { events: (async function* () {
            yield { type: 'thread.started', thread_id: 'native-thread' };
          })() };
        },
      } as unknown as Thread;

      const start = t.mock.method(Codex.prototype, 'startThread', (options?: ThreadOptions) => {
        capturedOptions = options;
        return thread;
      });
      const resume = t.mock.method(Codex.prototype, 'resumeThread', (id: string, options?: ThreadOptions) => {
        assert.equal(id, 'native-thread');
        capturedOptions = options;
        return thread;
      });
      const context: ProviderRuntimeContext = {
        resolveProviderSessionId: () => resumed ? 'native-thread' : null,
        resolveResumeModel: async () => 'test-model',
        getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
        normalizeMessage: () => [],
        isProviderInstalled: async () => true,
      };

      await codexRuntime.run('hey there', {
        sessionId: resumed ? 'app-session' : undefined,
        permissionMode,
        cwd: process.cwd(),
      }, { isWebSocketWriter: true, send: (message) => messages.push(message) }, context);

      assert.equal(start.mock.callCount(), resumed ? 0 : 1);
      assert.equal(resume.mock.callCount(), resumed ? 1 : 0);
      assert.equal(capturedPrompt, 'hey there');
      assert.equal(capturedOptions?.sandboxMode, permissionMode === 'bypassPermissions' ? 'danger-full-access' : 'workspace-write');
      assert.equal(capturedOptions?.approvalPolicy, permissionMode === 'acceptEdits' || permissionMode === 'bypassPermissions' ? 'never' : 'on-request');
      assert.ok(messages.some((message: any) => message.kind === 'complete' && message.exitCode === 0));
      assert.ok(!messages.some((message: any) => message.kind === 'error'));
    });
  }
}

for (const command of ['', '  \n\t']) {
  test(`Codex supplies a prompt for an image-only turn (${JSON.stringify(command)})`, async (t) => {
    let capturedPrompt: unknown;
    const imagePath = path.join(process.cwd(), 'public', 'favicon.png');
    const thread = {
      id: 'native-thread',
      async runStreamed(prompt: unknown) {
        capturedPrompt = prompt;
        return { events: (async function* () {
          yield { type: 'thread.started', thread_id: 'native-thread' };
        })() };
      },
    } as unknown as Thread;

    t.mock.method(Codex.prototype, 'startThread', () => thread);
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => 'test-model',
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
      normalizeMessage: () => [],
      isProviderInstalled: async () => true,
    };

    await codexRuntime.run(command, {
      cwd: process.cwd(),
      images: [{ path: imagePath, mimeType: 'image/png' }],
    }, { isWebSocketWriter: true, send: () => {} }, context);

    assert.deepEqual(capturedPrompt, [
      { type: 'text', text: 'Please analyze the attached image(s).' },
      { type: 'local_image', path: imagePath },
    ]);
  });
}

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function writeRollout(homeDir: string, providerSessionId: string, info: unknown): Promise<void> {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '10', '30');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(
    path.join(sessionsDir, `rollout-${providerSessionId}.jsonl`),
    `${JSON.stringify({
      timestamp: '2026-10-30T10:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info },
    })}\n`,
    'utf8',
  );
}

test('Codex emits the rollout snapshot as the token budget, not the per-turn SDK usage', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-runtime-token-budget-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  const messages: any[] = [];
  const providerSessionId = 'codex-live-usage-1';

  try {
    // The SDK reports only this turn's counts. The session-cumulative reading
    // and the window live in the rollout, so the runtime must read that file
    // rather than forwarding `turn.completed.usage` as a budget.
    await writeRollout(tempRoot, providerSessionId, {
      total_token_usage: {
        input_tokens: 900,
        cached_input_tokens: 700,
        output_tokens: 100,
        reasoning_output_tokens: 40,
        total_tokens: 1_000,
      },
      last_token_usage: {
        input_tokens: 300,
        cached_input_tokens: 200,
        output_tokens: 50,
        reasoning_output_tokens: 20,
        total_tokens: 350,
      },
      model_context_window: 258_400,
    });

    const thread = {
      id: providerSessionId,
      async runStreamed() {
        return { events: (async function* () {
          yield { type: 'thread.started', thread_id: providerSessionId };
          yield {
            type: 'turn.completed',
            usage: {
              input_tokens: 300,
              cached_input_tokens: 200,
              output_tokens: 50,
              reasoning_output_tokens: 20,
            },
          };
        })() };
      },
    } as unknown as Thread;

    t.mock.method(Codex.prototype, 'startThread', () => thread);
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => 'test-model',
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
      normalizeMessage: () => [],
      isProviderInstalled: async () => true,
    };

    await codexRuntime.run('measure the session', {
      cwd: process.cwd(),
    }, { isWebSocketWriter: true, send: (message) => messages.push(message) }, context);

    const budgetMessages = messages.filter((message) => message.kind === 'status' && message.text === 'token_budget');
    assert.equal(budgetMessages.length, 1);
    const budget = budgetMessages[0].tokenBudget;
    assert.equal(budget.usageScope, 'session-cumulative');
    assert.equal(budget.used, 1_000);
    assert.equal(budget.total, 258_400);
    assert.deepEqual(budget.cumulative, {
      inputTokens: 900,
      outputTokens: 100,
      cacheReadTokens: 700,
      reasoningOutputTokens: 40,
      totalTokens: 1_000,
    });
    assert.deepEqual(budget.lastRequest, {
      inputTokens: 300,
      outputTokens: 50,
      cacheReadTokens: 200,
      reasoningOutputTokens: 20,
      totalTokens: 350,
    });
    assert.equal(budget.observedAt, '2026-10-30T10:00:00.000Z');
    // The per-turn SDK numbers must not be mistaken for cumulative spend.
    assert.notEqual(budget.used, 350);
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex sends no token budget frame when the rollout has no readable snapshot', async (t) => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-runtime-token-budget-empty-'));
  const restoreHomeDir = patchHomeDir(tempRoot);
  const messages: any[] = [];

  try {
    const thread = {
      id: 'codex-live-usage-2',
      async runStreamed() {
        return { events: (async function* () {
          yield { type: 'thread.started', thread_id: 'codex-live-usage-2' };
          yield { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } };
        })() };
      },
    } as unknown as Thread;

    t.mock.method(Codex.prototype, 'startThread', () => thread);
    const context: ProviderRuntimeContext = {
      resolveProviderSessionId: () => null,
      resolveResumeModel: async () => 'test-model',
      getProviderModels: async () => ({ OPTIONS: [], DEFAULT: 'test-model' }),
      normalizeMessage: () => [],
      isProviderInstalled: async () => true,
    };

    await codexRuntime.run('nothing to measure', {
      cwd: process.cwd(),
    }, { isWebSocketWriter: true, send: (message) => messages.push(message) }, context);

    // A fabricated all-zero budget would look like a real reading; no frame is
    // the honest answer while the snapshot cannot be read.
    assert.equal(messages.some((message) => message.kind === 'status' && message.text === 'token_budget'), false);
    assert.ok(messages.some((message) => message.kind === 'complete'));
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
