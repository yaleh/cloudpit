import assert from 'node:assert/strict';

import { renderHook } from '@testing-library/react';
import { test } from 'vitest';

import { useChatRealtimeHandlers } from '@/modules/chat-session';
import type { ServerEvent, ProjectSession } from '@/shared/types';
import type { SessionStore } from '@/modules/chat-session';

/**
 * Several sessions can stream at once, and the server stamps every
 * `token_budget` status event with its session id. The composer counter shows
 * the viewed session's context, so a budget from another running session must
 * not overwrite it — that is what made the number drop and jump around while a
 * response was generating.
 */

const renderHandlers = () => {
  let listener: ((event: ServerEvent) => void) | null = null;
  const budgets: Array<Record<string, unknown> | null> = [];

  renderHook(() => useChatRealtimeHandlers({
    isActive: true,
    subscribe: (fn) => {
      listener = fn;
      return () => { listener = null; };
    },
    provider: 'claude',
    selectedSession: { id: 'viewed-session' } as ProjectSession,
    currentSessionId: 'viewed-session',
    setLiveFrame: (frame) => budgets.push(frame),
    pendingPermissionRequests: [],
    setPendingPermissionRequests: () => {},
    streamTimerRef: { current: null },
    accumulatedStreamRef: { current: '' },
    lastSeqRef: { current: new Map() },
    statusCheckSentAtRef: { current: new Map() },
    requestLatestMessages: async () => {},
    sessionStore: {} as SessionStore,
  }));

  const dispatch = (event: ServerEvent) => listener?.(event);
  return { budgets, dispatch };
};

const budgetEvent = (sessionId: string): ServerEvent => ({
  kind: 'status',
  text: 'token_budget',
  sessionId,
  tokenBudget: { used: 1234, total: 160000 },
} as unknown as ServerEvent);

test('adopts token budgets stamped with the viewed session', () => {
  const { budgets, dispatch } = renderHandlers();

  dispatch(budgetEvent('viewed-session'));

  assert.equal(budgets.length, 1);
  assert.deepEqual(budgets[0], { used: 1234, total: 160000 });
});

test('ignores token budgets from other running sessions', () => {
  const { budgets, dispatch } = renderHandlers();

  dispatch(budgetEvent('some-other-session'));

  assert.equal(budgets.length, 0);
});

test('forwards a cumulative reading with its scope and observedAt intact', () => {
  const { budgets, dispatch } = renderHandlers();

  dispatch({
    kind: 'status',
    text: 'token_budget',
    sessionId: 'viewed-session',
    tokenBudget: {
      used: 2_400,
      total: 258_400,
      usageScope: 'session-cumulative',
      observedAt: '2026-10-30T10:00:00.000Z',
      cumulative: { inputTokens: 2_000, outputTokens: 400, totalTokens: 2_400 },
      lastRequest: { inputTokens: 700, outputTokens: 120, totalTokens: 820 },
    },
  } as unknown as ServerEvent);

  assert.equal(budgets.length, 1);
  // The realtime frame is passed through whole: the counter needs the scope,
  // and the freshness check needs the reading's own timestamp.
  assert.deepEqual(budgets[0], {
    used: 2_400,
    total: 258_400,
    usageScope: 'session-cumulative',
    observedAt: '2026-10-30T10:00:00.000Z',
    cumulative: { inputTokens: 2_000, outputTokens: 400, totalTokens: 2_400 },
    lastRequest: { inputTokens: 700, outputTokens: 120, totalTokens: 820 },
  });
});
