import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import { useChatComposerState } from '@/modules/chat-composer';
import { resetChatDrafts } from '@/shared/api/chatDrafts';
import type { PermissionMode, Project } from '@/shared/types';

/**
 * The composer's first send states the selection ON THE GATEWAY CALL, not only on the frame.
 *
 * THE CLAIM. `POST /api/providers/sessions` mints the row; a `chat.send` carries the model
 * as a per-message option and the row is written from it as a side effect. A session whose
 * first turn is not a composer send therefore had no recorded model — the Live Voice relay
 * delivers its first utterance through `session_send`, which has no such option — and the
 * Claude runtime launched it with `--model default` (measured 2026-10-15: the page showed
 * `v4.1flash`, the child ran the host account's default with no ANTHROPIC_* env at all).
 *
 * WHAT THIS PINS. The composer already holds the selection it is about to send; the gateway
 * call it makes in the same breath has to carry it, so the row is correct before any run
 * exists — whatever entry ends up opening the first turn.
 *
 * THE FIRST ASSERTION IS THE FALSIFYING ONE: before the fix the create payload was
 * `{provider, projectPath, initialMessage}`, so `payload.model` was `undefined`.
 */

const PROJECT: Project = {
  projectId: 'project-selection',
  displayName: 'Project Selection',
  fullPath: '/tmp/project-selection',
};

const CREATED_SESSION_ID = 'server-minted-selection-session';
const MODEL = 'v4.1flash';
const EFFORT = 'high';

const state = vi.hoisted(() => ({
  createSessionPayloads: [] as Array<Record<string, unknown>>,
  lifecycleCalls: [] as Array<{ provider: string; sessionId: string; mode: string }>,
  failNextCreate: false,
}));

vi.mock('@/shared/api', () => {
  const okJson = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
  return {
    api: {
      user: {
        drafts: () => okJson({ success: true, drafts: [] }),
        saveDraft: () => okJson({ success: true }),
        deleteDraft: () => okJson({ success: true }),
        preferences: () => okJson({ success: true, preferences: {} }),
        savePreferences: () => okJson({ success: true, preferences: {} }),
      },
      commands: { list: () => okJson({ success: true, commands: [] }) },
      files: { search: () => okJson({ success: true, files: [] }) },
      providers: {
        createSession: (payload: Record<string, unknown>) => {
          state.createSessionPayloads.push(payload);
          if (state.failNextCreate) {
            state.failNextCreate = false;
            return Promise.resolve({
              ok: false,
              status: 503,
              json: async () => ({ success: false, error: { code: 'UNAVAILABLE' } }),
            });
          }
          return okJson({
            success: true,
            data: { sessionId: CREATED_SESSION_ID, sessionName: 'selection chat' },
          });
        },
        setSessionLifecycleMode: (provider: string, sessionId: string, mode: string) => {
          state.lifecycleCalls.push({ provider, sessionId, mode });
          return okJson({ success: true });
        },
      },
    },
  };
});

const renderComposer = (overrides: {
  newSessionLifecycleMode?: 'per-run' | 'resident';
  onNewSessionLifecycleSpent?: () => void;
} = {}) => renderHook(() => useChatComposerState({
  selectedProject: PROJECT,
  selectedSession: null,
  currentSessionId: null,
  provider: 'claude',
  permissionMode: 'acceptEdits',
  cyclePermissionMode: () => undefined,
  resolvePermissionModeForProvider: () => 'acceptEdits' as PermissionMode,
  currentProviderModel: MODEL,
  currentProviderEffort: EFFORT,
  isLoading: false,
  canAbortSession: false,
  sendMessage: () => undefined,
  isConnected: true,
  scrollToBottom: () => undefined,
  addMessage: () => undefined,
  setIsUserScrolledUp: () => undefined,
  setPendingPermissionRequests: () => undefined,
  ...overrides,
}));

beforeEach(() => {
  resetChatDrafts();
  state.createSessionPayloads = [];
  state.lifecycleCalls = [];
  state.failNextCreate = false;
});

test('the first send of a brand-new conversation states its selection on the gateway call', async () => {
  const view = renderComposer();

  await act(async () => {
    view.result.current.setInput('first message');
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  await waitFor(() => {
    assert.equal(
      state.createSessionPayloads.length,
      1,
      `the first send must allocate exactly one session through the gateway; it made ${state.createSessionPayloads.length} call(s)`,
    );
  });

  // The falsifying assertion, first: the pre-fix payload carried provider, projectPath and
  // initialMessage only, so `model` was undefined and the minted row had no selection.
  assert.equal(
    state.createSessionPayloads[0].model,
    MODEL,
    `the gateway call that mints the row must carry the model the composer is about to send; payload=${JSON.stringify(state.createSessionPayloads[0])}`,
  );
  assert.equal(state.createSessionPayloads[0].effort, EFFORT);
  assert.equal(state.createSessionPayloads[0].permissionMode, 'acceptEdits');
});

test('an explicit new-session lifecycle mode rides the creation and is spent after success', async () => {
  const spent: number[] = [];
  const view = renderComposer({
    newSessionLifecycleMode: 'per-run',
    onNewSessionLifecycleSpent: () => spent.push(1),
  });

  await act(async () => {
    view.result.current.setInput('first message');
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  await waitFor(() => {
    assert.equal(state.createSessionPayloads.length, 1);
  });

  assert.equal(
    state.createSessionPayloads[0].lifecycleMode,
    'per-run',
    'the switch turned off for this next session must be stated ON the creation, not written afterwards',
  );
  assert.equal(
    state.lifecycleCalls.length,
    0,
    'the mode is stored by the insert; no create-then-switch call may run',
  );
  assert.equal(spent.length, 1, 'the override is spent once the session it applied to exists');
});

test('a failed creation keeps the override for the retry, and only the successful creation spends it', async () => {
  const spent: number[] = [];
  const view = renderComposer({
    newSessionLifecycleMode: 'per-run',
    onNewSessionLifecycleSpent: () => spent.push(1),
  });

  state.failNextCreate = true;
  await act(async () => {
    view.result.current.setInput('first attempt');
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  assert.equal(state.createSessionPayloads.length, 1);
  assert.equal(
    state.createSessionPayloads[0].lifecycleMode,
    'per-run',
    'the first attempt stated the choice the switch showed',
  );
  assert.equal(spent.length, 0, 'a failed creation must not spend the override — the retry still owns it');

  // Retry without touching the switch: the same selection must be stated again,
  // so the session that finally exists is the mode the page kept showing.
  await act(async () => {
    view.result.current.setInput('second attempt');
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  await waitFor(() => {
    assert.equal(state.createSessionPayloads.length, 2);
  });
  assert.equal(
    state.createSessionPayloads[1].lifecycleMode,
    'per-run',
    'the retry must create the mode the switch still displays, not fall back to the provider default',
  );
  assert.equal(spent.length, 1, 'only the successful creation spends the override');
});

test('with no override the creation omits the mode and the override is still spent after success', async () => {
  const spent: number[] = [];
  const view = renderComposer({
    onNewSessionLifecycleSpent: () => spent.push(1),
  });

  await act(async () => {
    view.result.current.setInput('first message');
  });
  await act(async () => {
    await view.result.current.handleSubmit({ preventDefault: () => undefined } as never);
  });

  await waitFor(() => {
    assert.equal(state.createSessionPayloads.length, 1);
  });

  assert.equal(
    'lifecycleMode' in state.createSessionPayloads[0],
    false,
    'following the provider default means omitting the field, so the server applies the mode it declared',
  );
  assert.equal(state.lifecycleCalls.length, 0);
  assert.equal(spent.length, 1, 'a successful creation spends the selection even when it was the default');
});
