import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import type { NormalizedMessage } from '@/shared/types';

/**
 * The composer's token counter sat at 0 for Claude sessions and only sometimes
 * flickered to a real number.
 *
 * Two writers feed it: a one-shot fetch of `/token-usage` when a session is
 * selected, and whatever the session store carries on a history page. The store
 * initialised its per-session `tokenUsage` to `null` while every consumer
 * guarded on `!== undefined`, so a provider that reports no usage on its
 * history pages was indistinguishable from one reporting zero — and each
 * history refresh pushed that zero over the fetched value.
 */

const sessionMessages = vi.fn();

vi.mock('@/shared/api', () => ({
  api: {
    providers: {
      sessionMessages: (...args: unknown[]) => sessionMessages(...args),
    },
  },
}));

const message: NormalizedMessage = {
  id: 'm-1',
  kind: 'text',
  role: 'assistant',
  provider: 'claude',
  sessionId: 'session-1',
  content: 'hi',
  timestamp: '2026-01-01T00:00:00.000Z',
} as NormalizedMessage;

const respondWith = (body: Record<string, unknown>) => {
  sessionMessages.mockResolvedValue({ ok: true, json: async () => ({ data: body }) });
};

beforeEach(() => {
  sessionMessages.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

async function loadStore() {
  const { useSessionStore } = await import('@/modules/chat-session');
  return renderHook(() => useSessionStore());
}

describe('token usage on a history page', () => {
  it('leaves the slot untouched when the provider reports none', async () => {
    respondWith({ messages: [message], total: 1, hasMore: false });
    const { result } = await loadStore();

    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    const slot = result.current.getSessionSlot('session-1');
    assert.equal(
      slot?.tokenUsage,
      undefined,
      'a provider that reports no usage must not look like one reporting zero',
    );
  });

  it('adopts the usage a provider does report', async () => {
    respondWith({
      messages: [message],
      total: 1,
      hasMore: false,
      tokenUsage: { used: 4183, total: 200000 },
    });
    const { result } = await loadStore();

    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    await waitFor(() => {
      assert.deepEqual(result.current.getSessionSlot('session-1')?.tokenUsage, {
        used: 4183,
        total: 200000,
      });
    });
  });
});

describe('token usage ordering', () => {
  it('keeps a newer realtime reading when an older history page lands after it', async () => {
    sessionMessages
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            messages: [message],
            total: 1,
            hasMore: false,
            tokenUsage: { used: 2_400, observedAt: '2026-10-30T10:00:00.000Z' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            messages: [message],
            total: 1,
            hasMore: false,
            tokenUsage: { used: 1_000, observedAt: '2026-10-30T09:00:00.000Z' },
          },
        }),
      });

    const { result } = await loadStore();
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    assert.deepEqual(result.current.getSessionSlot('session-1')?.tokenUsage, {
      used: 2_400,
      observedAt: '2026-10-30T10:00:00.000Z',
    });
  });

  it('adopts a history reading newer than the one already held', async () => {
    sessionMessages
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            messages: [message],
            total: 1,
            hasMore: false,
            tokenUsage: { used: 1_000, observedAt: '2026-10-30T09:00:00.000Z' },
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            messages: [message],
            total: 1,
            hasMore: false,
            tokenUsage: { used: 2_400, observedAt: '2026-10-30T10:00:00.000Z' },
          },
        }),
      });

    const { result } = await loadStore();
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    assert.deepEqual(result.current.getSessionSlot('session-1')?.tokenUsage, {
      used: 2_400,
      observedAt: '2026-10-30T10:00:00.000Z',
    });
  });

  it('keeps last-writer-wins for readings that carry no timestamp', async () => {
    sessionMessages
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { messages: [message], total: 1, hasMore: false, tokenUsage: { used: 1 } },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: { messages: [message], total: 1, hasMore: false, tokenUsage: { used: 2 } },
        }),
      });

    const { result } = await loadStore();
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });
    await act(async () => {
      await result.current.fetchFromServer('session-1', { limit: 20, offset: 0 });
    });

    assert.deepEqual(result.current.getSessionSlot('session-1')?.tokenUsage, { used: 2 });
  });

  it('never lets an untimestamped reading displace a timestamped one', async () => {
    const { pickFresherTokenUsage } = await import('@/modules/chat-session');
    const timed: Record<string, unknown> = { used: 2_400, observedAt: '2026-10-30T10:00:00.000Z' };

    // Unparseable or absent timestamps cannot prove the incoming value is newer.
    assert.equal(pickFresherTokenUsage<Record<string, unknown>>(timed, { used: 1_000 }), timed);
    assert.equal(pickFresherTokenUsage<Record<string, unknown>>(timed, { used: 1_000, observedAt: 'not-a-date' }), timed);
    // A timestamped reading always wins over an untimestamped current value.
    assert.deepEqual(pickFresherTokenUsage<Record<string, unknown>>({ used: 1_000 }, timed), timed);
    // Nothing incoming means nothing to replace.
    assert.equal(pickFresherTokenUsage<Record<string, unknown> | undefined>(timed, undefined), timed);
  });
});
