import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type {
  QuaySessionMentionsReading,
  SessionTaskChainReading,
} from '@/shared/types';
import enCommon from '@/modules/i18n/locales/en/common.json';
import { QuaySessionPanel } from '@/modules/quay/QuaySessionPanel';

/**
 * The Quay tab's session column (gap-quay-tab-status-band-charts-session-first-layout).
 *
 * The network hop is the only stub; the hook, the shared row/section component and the panel's
 * own empty/error states all run for real. The cases pin the task's honesty requirements: the
 * two blocks fail independently, `503`/`404` from the task-chain endpoint hides ONLY that block
 * (stating why), the 30 s read pauses while the page is hidden, the panel Refresh re-reads, and
 * a slow reply for a session the user already left cannot overwrite the current one.
 */

const apiMock = vi.hoisted(() => ({
  quaySessionMentions: vi.fn(),
  quaySessionTaskChain: vi.fn(),
}));
vi.mock('@/shared/api', () => ({ api: apiMock }));

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',
  resources: { en: { common: enCommon } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const PROJECT_ID = 'proj-a';
const SESSION_ID = 's1';

const jsonResponse = (body: unknown, ok = true, status = 200): Response =>
  ({ ok, status, json: async () => body }) as Response;

const MENTIONS: QuaySessionMentionsReading = {
  ok: true,
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  tasks: [
    {
      taskId: 'gap-mentioned-task',
      title: 'A mentioned task',
      status: 'ready',
      phase: null,
      goalId: 'GOAL-1',
      mentionCount: 2,
      lastMentionAt: '2026-10-20T11:58:00.000Z',
    },
  ],
  goals: [
    { goalId: 'GOAL-1', title: 'A mentioned goal', status: 'active', viaTaskCount: 1, mentionedDirectly: true },
  ],
  generatedAt: '2026-10-20T12:00:00.000Z',
};

const CHAIN: SessionTaskChainReading = {
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
  created: ['gap-started-task'],
  edited: [],
  counts: {
    total: 1,
    filed: 0,
    ready: 0,
    inProgress: 1,
    landed: 0,
    built: 0,
    running: 0,
    blocked: 0,
    needsHuman: 0,
    superseded: 0,
    unknown: 0,
  },
  tasks: [
    {
      taskId: 'gap-started-task',
      title: 'A task this session started',
      status: 'ready',
      stage: 'in-progress',
      origin: 'created',
      landCommit: null,
      blockedReason: null,
    },
  ],
  checkedAt: '2026-10-20T12:00:00.000Z',
};

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const renderPanel = (props: { sessionId?: string | null; refreshSignal?: number } = {}) =>
  render(
    <QuaySessionPanel
      projectId={PROJECT_ID}
      sessionId={props.sessionId === undefined ? SESSION_ID : props.sessionId}
      refreshSignal={props.refreshSignal ?? 0}
    />,
  );

beforeEach(() => {
  apiMock.quaySessionMentions.mockReset();
  apiMock.quaySessionTaskChain.mockReset();
  apiMock.quaySessionMentions.mockResolvedValue(jsonResponse(MENTIONS));
  apiMock.quaySessionTaskChain.mockResolvedValue(jsonResponse(CHAIN));
});

afterEach(() => {
  vi.useRealTimers();
  delete (document as { visibilityState?: DocumentVisibilityState }).visibilityState;
});

/* ── both blocks render ────────────────────────────────────────────────────────────────── */

test('the panel renders the mentioned goals/tasks and the tasks this session started', async () => {
  const { container, getByTestId } = renderPanel();
  await flush();

  // Mentions: the SAME rows/sections the title-bar popover draws, under the panel prefix.
  getByTestId('quay-session-goals');
  getByTestId('quay-session-tasks');
  assert.match(getByTestId('quay-session-goal-row').textContent ?? '', /GOAL-1/);
  assert.match(getByTestId('quay-session-task-row').textContent ?? '', /gap-mentioned-task/);

  // Started tasks: id, title and a stage badge.
  const rows = container.querySelectorAll('[data-testid="quay-session-chain-row"]');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].getAttribute('data-task-id'), 'gap-started-task');
  assert.equal(rows[0].getAttribute('data-stage'), 'in-progress');
  assert.match(rows[0].textContent ?? '', /A task this session started/);
  assert.match(getByTestId('quay-session-chain-stage').textContent ?? '', /in progress/i);

  // Both reads happened once each, for this project/session.
  assert.deepEqual(apiMock.quaySessionMentions.mock.calls, [[PROJECT_ID, SESSION_ID]]);
  assert.deepEqual(apiMock.quaySessionTaskChain.mock.calls, [[PROJECT_ID, SESSION_ID]]);
});

test('a blocked task shows the first line of its unlanded reason', async () => {
  apiMock.quaySessionTaskChain.mockResolvedValue(jsonResponse({
    ...CHAIN,
    tasks: [{
      ...CHAIN.tasks[0],
      stage: 'blocked',
      blockedReason: 'the lint gate never answered\nand a second line that must not show',
    }],
  }));
  const { getByTestId } = renderPanel();
  await flush();

  const reason = getByTestId('quay-session-chain-blocked-reason').textContent ?? '';
  assert.match(reason, /the lint gate never answered/);
  assert.doesNotMatch(reason, /second line/);
});

/* ── honest empty / no-session states ──────────────────────────────────────────────────── */

test('no selected session says so and spends no request', async () => {
  const { getByTestId } = renderPanel({ sessionId: null });
  await flush();

  assert.match(getByTestId('quay-session-no-session').textContent ?? '', /No session selected/);
  assert.equal(apiMock.quaySessionMentions.mock.calls.length, 0);
  assert.equal(apiMock.quaySessionTaskChain.mock.calls.length, 0);
});

test('a session with no mentions and no started tasks states both empties', async () => {
  apiMock.quaySessionMentions.mockResolvedValue(jsonResponse({ ...MENTIONS, tasks: [], goals: [] }));
  apiMock.quaySessionTaskChain.mockResolvedValue(jsonResponse({ ...CHAIN, tasks: [], created: [] }));

  const { getByTestId } = renderPanel();
  await flush();

  assert.match(getByTestId('quay-session-mentions-empty').textContent ?? '', /No quay tasks have been mentioned/i);
  assert.match(getByTestId('quay-session-chain-empty').textContent ?? '', /No tasks were started/i);
});

/* ── the two blocks fail independently ─────────────────────────────────────────────────── */

test('a mention read failure leaves the started-task block rendered', async () => {
  apiMock.quaySessionMentions.mockResolvedValue(jsonResponse({ ok: false }, false, 500));
  const { container, getByTestId } = renderPanel();
  await flush();

  getByTestId('quay-session-mentions-error');
  assert.equal(container.querySelector('[data-testid="quay-session-goals"]'), null);
  // The other block is unaffected.
  assert.equal(container.querySelectorAll('[data-testid="quay-session-chain-row"]').length, 1);
  assert.equal(container.querySelector('[data-testid="quay-session-chain-error"]'), null);
});

test('a task-chain read failure leaves the mention block rendered', async () => {
  apiMock.quaySessionTaskChain.mockResolvedValue(jsonResponse({ ok: false }, false, 500));
  const { container, getByTestId } = renderPanel();
  await flush();

  getByTestId('quay-session-chain-error');
  assert.equal(container.querySelector('[data-testid="quay-session-chain-row"]'), null);
  // The mention block is unaffected.
  getByTestId('quay-session-goals');
  getByTestId('quay-session-tasks');
});

/* ── 503 / 404 hide only the started-task block, with the reason ───────────────────────── */

test('a 503 or 404 from session-task-chain hides only that block and states why', async () => {
  for (const status of [503, 404]) {
    apiMock.quaySessionMentions.mockClear();
    apiMock.quaySessionTaskChain.mockClear();
    apiMock.quaySessionTaskChain.mockResolvedValue(jsonResponse({ ok: false }, false, status));

    const { container, getByTestId, unmount } = renderPanel();
    await flush();

    const unavailable = getByTestId('quay-session-chain-unavailable');
    assert.match(unavailable.textContent ?? '', new RegExp(`HTTP ${status}`));
    assert.equal(container.querySelector('[data-testid="quay-session-chain-row"]'), null);
    assert.equal(container.querySelector('[data-testid="quay-session-chain-error"]'), null);
    // The mention block still rendered.
    getByTestId('quay-session-goals');
    getByTestId('quay-session-tasks');
    unmount();
  }
});

/* ── polling ───────────────────────────────────────────────────────────────────────────── */

test('the reading is taken once on mount, then every 30 s, and pauses while the page is hidden', async () => {
  vi.useFakeTimers();
  renderPanel();
  await flush();
  assert.equal(apiMock.quaySessionMentions.mock.calls.length, 1, 'one initial mention read');
  assert.equal(apiMock.quaySessionTaskChain.mock.calls.length, 1, 'one initial chain read');

  for (let poll = 0; poll < 2; poll += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
  }
  assert.equal(apiMock.quaySessionMentions.mock.calls.length, 3, 'two polls after the initial read');
  assert.equal(apiMock.quaySessionTaskChain.mock.calls.length, 3);

  let visibility: DocumentVisibilityState = 'hidden';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  assert.equal(apiMock.quaySessionMentions.mock.calls.length, 3, 'a hidden page spawns no read');
  assert.equal(apiMock.quaySessionTaskChain.mock.calls.length, 3);

  visibility = 'visible';
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
  assert.equal(apiMock.quaySessionMentions.mock.calls.length, 4, 'becoming visible catches up immediately');
  assert.equal(apiMock.quaySessionTaskChain.mock.calls.length, 4);
});

test('the panel refresh signal re-reads both blocks in place', async () => {
  const { rerender } = render(
    <QuaySessionPanel projectId={PROJECT_ID} sessionId={SESSION_ID} refreshSignal={0} />,
  );
  await flush();
  assert.equal(apiMock.quaySessionMentions.mock.calls.length, 1);
  assert.equal(apiMock.quaySessionTaskChain.mock.calls.length, 1);

  rerender(<QuaySessionPanel projectId={PROJECT_ID} sessionId={SESSION_ID} refreshSignal={1} />);
  await flush();
  assert.equal(apiMock.quaySessionMentions.mock.calls.length, 2);
  assert.equal(apiMock.quaySessionTaskChain.mock.calls.length, 2);
});

/* ── stale replies ─────────────────────────────────────────────────────────────────────── */

test('a slow reply for the previous session is discarded when the session changes', async () => {
  let resolveSlow: (value: Response) => void = () => {};
  apiMock.quaySessionMentions.mockImplementationOnce(
    () => new Promise<Response>((resolve) => {
      resolveSlow = resolve;
    }),
  );

  const { rerender, container, queryByTestId } = render(
    <QuaySessionPanel projectId={PROJECT_ID} sessionId="session-a" refreshSignal={0} />,
  );
  await flush();

  // Switch to session B; its reply lands first.
  rerender(<QuaySessionPanel projectId={PROJECT_ID} sessionId="session-b" refreshSignal={0} />);
  await flush();
  assert.match(container.textContent ?? '', /gap-mentioned-task/, 'session B\'s reading is drawn');

  // Now the slow session-A reply arrives. It must not overwrite B's rows.
  await act(async () => {
    resolveSlow(jsonResponse({
      ...MENTIONS,
      sessionId: 'session-a',
      tasks: [{ ...MENTIONS.tasks[0], taskId: 'gap-session-a-stale-task', title: 'Stale A task' }],
      goals: [],
    }));
    await Promise.resolve();
  });
  await flush();

  assert.match(container.textContent ?? '', /gap-mentioned-task/, 'session B is still shown');
  assert.doesNotMatch(container.textContent ?? '', /gap-session-a-stale-task/, 'the stale reply was dropped');
  assert.equal(queryByTestId('quay-session-mentions-error'), null);
});
