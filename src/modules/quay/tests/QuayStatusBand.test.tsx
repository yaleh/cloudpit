import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { test } from 'vitest';

import type {
  QuayInFlightTask,
  QuayLoopStatus,
  QuaySnapshot,
} from '@/shared/types';
import { QUAY_IN_FLIGHT_PHASE_META } from '@/shared/constants';
import enCommon from '@/modules/i18n/locales/en/common.json';
import { QuayStatusBand } from '@/modules/quay/QuayStatusBand';

/**
 * The Quay tab's overall running-status band (gap-quay-tab-status-band-charts-session-first-layout).
 *
 * Every case reads the rendered DOM against a snapshot, with an INJECTED clock (`nowIso`) so the
 * orphan countdown and heartbeat age are deterministic. The honesty rules are the point of the
 * file: `not-evaluated` never reads as `current`, a drain flag that could not be read is never
 * listed, and a missing `loop` renders no version/drain/orphan mark and no 「normal」 wording.
 */

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',
  resources: { en: { common: enCommon } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

/** 2026-10-20T12:00:00Z — the clock every relative reading is measured against. */
const NOW_ISO = '2026-10-20T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

const BASE: QuaySnapshot = {
  projectId: 'proj',
  projectPath: '/repo',
  generatedAt: NOW_ISO,
  cached: false,
  driver: {
    state: 'running',
    alive: true,
    running: true,
    lastRecordAt: new Date(NOW_MS - 10 * MINUTE_MS).toISOString(),
  },
  tasks: {
    total: 3,
    byStatus: { ready: 2, 'needs-human': 1 },
    ready: 2,
    needsHuman: 1,
    done: 0,
    recent: [],
  },
  goals: null,
  adrs: null,
  configIssues: null,
  tests: {
    current: {
      state: 'green',
      runner: 'inner',
      scope: 'worktree',
      startedAt: '2026-10-20T11:50:00.000Z',
      finishedAt: Math.floor(NOW_MS / 1000) - 30 * 60,
      durationMs: 120_000,
      laneCount: 4,
      commit: 'abc1234',
      taskId: 'gap-x',
      runId: 'r1',
    },
    recentRounds: [],
  },
  fanIn: { recent: [] },
  inFlight: [],
  dashboardUrl: null,
  warnings: [],
};

const snapshot = (overrides: Partial<QuaySnapshot> = {}): QuaySnapshot => ({ ...BASE, ...overrides });

const loop = (overrides: Partial<QuayLoopStatus> = {}): QuayLoopStatus => ({
  anchorPid: 4242,
  kernel: { loaded: '0.22.0', installed: '0.22.0', relation: 'current', reason: null },
  pointer: { state: 'current', linkVersion: '0.22.0', coreVersion: '0.22.0' },
  drain: { worker: false, promotion: false, quality: false },
  orphan: { state: 'none', markedAt: null, removeAfter: null },
  observedAt: NOW_ISO,
  ...overrides,
});

const renderBand = (value: QuaySnapshot, nowIso = NOW_ISO) =>
  render(<QuayStatusBand snapshot={value} nowIso={nowIso} staleAfterMs={300_000} />);

/* ── driver ─────────────────────────────────────────────────────────────────────────────── */

test('driver: each of the four readings (running, idle, stale, unavailable) has its own mark', () => {
  const cases = [
    ['running', 'Driver running'],
    ['idle', 'Driver idle'],
    ['stale', 'Driver stale'],
    ['unavailable', 'Driver status unavailable'],
  ] as const;

  for (const [state, label] of cases) {
    const { container, unmount } = renderBand(
      snapshot({ driver: { state, alive: state !== 'unavailable', running: state === 'running', lastRecordAt: null } }),
    );
    const badge = container.querySelector('[data-testid="quay-status-band-driver"]');
    assert.ok(badge, `the ${state} badge must render`);
    assert.equal(badge.getAttribute('data-state'), state);
    assert.equal(badge.textContent, label);
    unmount();
  }

  // A null driver reading is *unavailable*, never "not configured" — the tab only exists for a
  // project that has a config.
  const { container } = renderBand(snapshot({ driver: null }));
  assert.equal(
    container.querySelector('[data-testid="quay-status-band-driver"]')?.getAttribute('data-state'),
    'unavailable',
  );
});

/* ── kernel version relation ───────────────────────────────────────────────────────────── */

test('kernel: behind and ahead are stated with both versions, current is stated subtly', () => {
  const behind = renderBand(snapshot({
    loop: loop({ kernel: { loaded: '0.20.0', installed: '0.22.0', relation: 'behind', reason: null } }),
  }));
  const behindMark = behind.container.querySelector('[data-testid="quay-status-band-kernel"]');
  assert.ok(behindMark, 'behind must render a deviation mark');
  assert.equal(behindMark.getAttribute('data-relation'), 'behind');
  assert.match(behindMark.textContent ?? '', /0\.20\.0/);
  assert.match(behindMark.textContent ?? '', /0\.22\.0/);
  assert.ok((behindMark.className ?? '').includes('text-amber-'), 'behind is amber');
  behind.unmount();

  const ahead = renderBand(snapshot({
    loop: loop({ kernel: { loaded: '0.23.0', installed: '0.22.0', relation: 'ahead', reason: null } }),
  }));
  const aheadMark = ahead.container.querySelector('[data-testid="quay-status-band-kernel"]');
  assert.ok(aheadMark, 'ahead must render a deviation mark too');
  assert.equal(aheadMark.getAttribute('data-relation'), 'ahead');
  assert.match(aheadMark.textContent ?? '', /ahead/i);
  assert.ok((aheadMark.className ?? '').includes('text-amber-'), 'ahead is amber');
  ahead.unmount();

  const current = renderBand(snapshot({ loop: loop() }));
  const currentMark = current.container.querySelector('[data-testid="quay-status-band-kernel"]');
  assert.ok(currentMark, 'a determinate current reading is drawn');
  assert.equal(currentMark.getAttribute('data-relation'), 'current');
  assert.match(currentMark.textContent ?? '', /current/i);
  current.unmount();
});

test('kernel: not-evaluated is grey and draws no conclusion', () => {
  const { container } = renderBand(snapshot({
    loop: loop({ kernel: { loaded: null, installed: '0.22.0', relation: 'not-evaluated', reason: 'no run record' } }),
  }));
  const mark = container.querySelector('[data-testid="quay-status-band-kernel"]');
  assert.ok(mark, 'not-evaluated must still state that it could not tell');
  assert.equal(mark.getAttribute('data-relation'), 'not-evaluated');
  assert.match(mark.textContent ?? '', /not evaluated/i);
  assert.ok(!(mark.className ?? '').includes('text-amber-'), 'not-evaluated is not an alarm');
  assert.doesNotMatch(mark.textContent ?? '', /current|up to date/i, 'not-evaluated never claims agreement');
});

/* ── orphan marker ─────────────────────────────────────────────────────────────────────── */

test('orphan: a marked directory shows the remaining days against the injected clock, and expiry once past', () => {
  const marked = renderBand(snapshot({
    loop: loop({
      orphan: {
        state: 'marked',
        markedAt: new Date(NOW_MS - 11 * DAY_MS).toISOString(),
        removeAfter: new Date(NOW_MS + 3 * DAY_MS).toISOString(),
      },
    }),
  }));
  const mark = marked.container.querySelector('[data-testid="quay-status-band-orphan"]');
  assert.ok(mark, 'marked must render the orphan warning');
  assert.match(mark.textContent ?? '', /3 days/);
  marked.unmount();

  const expired = renderBand(snapshot({
    loop: loop({
      orphan: {
        state: 'marked',
        markedAt: new Date(NOW_MS - 20 * DAY_MS).toISOString(),
        removeAfter: new Date(NOW_MS - DAY_MS).toISOString(),
      },
    }),
  }));
  const expiredMark = expired.container.querySelector('[data-testid="quay-status-band-orphan"]');
  assert.ok(expiredMark, 'an expired removal window is still shown');
  assert.match(expiredMark.textContent ?? '', /window has passed/i);
  expired.unmount();
});

test('orphan: none, not-applicable and not-evaluated render no orphan warning', () => {
  for (const state of ['none', 'not-applicable', 'not-evaluated'] as const) {
    const { container, unmount } = renderBand(snapshot({
      loop: loop({ orphan: { state, markedAt: null, removeAfter: null } }),
    }));
    assert.equal(
      container.querySelector('[data-testid="quay-status-band-orphan"]'),
      null,
      `${state} must not render an orphan warning`,
    );
    unmount();
  }
});

/* ── drain ─────────────────────────────────────────────────────────────────────────────── */

test('drain: any true flag renders「draining」and names exactly the drained drivers', () => {
  const draining = renderBand(snapshot({
    loop: loop({ drain: { worker: true, promotion: false, quality: true } }),
  }));
  const mark = draining.container.querySelector('[data-testid="quay-status-band-drain"]');
  assert.ok(mark, 'a drained loop must say so');
  assert.equal(mark.getAttribute('data-drivers'), 'worker,quality');
  assert.match(mark.textContent ?? '', /draining/i);
  assert.match(mark.textContent ?? '', /worker/);
  assert.match(mark.textContent ?? '', /quality/);
  assert.doesNotMatch(mark.textContent ?? '', /promotion/);
  draining.unmount();

  // An unreadable flag (`null`) is neither drained nor "running": it is simply not listed.
  const unknown = renderBand(snapshot({
    loop: loop({ drain: { worker: null, promotion: false, quality: false } }),
  }));
  assert.equal(unknown.container.querySelector('[data-testid="quay-status-band-drain"]'), null);
});

/* ── pointer ───────────────────────────────────────────────────────────────────────────── */

test('pointer: shown only when it deviates, never when current or unevaluated', () => {
  const deviating = renderBand(snapshot({
    loop: loop({ pointer: { state: 'behind', linkVersion: '0.20.0', coreVersion: '0.22.0' } }),
  }));
  const mark = deviating.container.querySelector('[data-testid="quay-status-band-pointer"]');
  assert.ok(mark, 'a deviating pointer is shown');
  assert.match(mark.textContent ?? '', /0\.20\.0/);
  assert.match(mark.textContent ?? '', /0\.22\.0/);
  deviating.unmount();

  for (const state of ['current', 'not-evaluated'] as const) {
    const { container, unmount } = renderBand(snapshot({
      loop: loop({ pointer: { state, linkVersion: '0.22.0', coreVersion: '0.22.0' } }),
    }));
    assert.equal(container.querySelector('[data-testid="quay-status-band-pointer"]'), null, `${state} must not warn`);
    unmount();
  }
});

/* ── in-flight, task counts, suite ─────────────────────────────────────────────────────── */

test('in-flight: the count and each phase dot use the same colour the in-flight card draws', () => {
  const inFlight: QuayInFlightTask[] = [
    { taskId: 'a', phase: 'implementing', startedAt: NOW_ISO, lastHeartbeat: NOW_ISO, workerPid: 1 },
    { taskId: 'b', phase: 'implementing', startedAt: NOW_ISO, lastHeartbeat: NOW_ISO, workerPid: 1 },
    { taskId: 'c', phase: 'fan-in', startedAt: NOW_ISO, lastHeartbeat: NOW_ISO, workerPid: 1 },
  ];
  const { container } = renderBand(snapshot({ inFlight }));

  const count = container.querySelector('[data-testid="quay-status-band-inflight"]');
  assert.ok(count);
  assert.equal(count.getAttribute('data-count'), '3');
  assert.match(count.textContent ?? '', /3 in flight/);

  for (const [phase, expectedColor] of [
    ['implementing', QUAY_IN_FLIGHT_PHASE_META.implementing.color],
    ['fan-in', QUAY_IN_FLIGHT_PHASE_META['fan-in'].color],
  ] as const) {
    const dot = container.querySelector(`[data-testid="quay-status-band-phase-${phase}"]`);
    assert.ok(dot, `${phase} dot must render`);
    assert.equal(dot.getAttribute('data-color'), expectedColor, 'the palette name must be the shared one');
    const visibleDot = dot.querySelector('span');
    assert.ok(
      (visibleDot?.className ?? '').includes(`bg-${expectedColor}-500`),
      `the drawn dot must use the palette's colour, got ${visibleDot?.className}`,
    );
  }
  // A phase with no task draws no dot.
  assert.equal(container.querySelector('[data-testid="quay-status-band-phase-landed"]'), null);
});

test('an unread in-flight carrier prints no count, while a read empty one prints zero', () => {
  const unread = renderBand(snapshot({ inFlight: null }));
  assert.equal(unread.container.querySelector('[data-testid="quay-status-band-inflight"]'), null);
  unread.unmount();

  const empty = renderBand(snapshot({ inFlight: [] }));
  assert.equal(
    empty.container.querySelector('[data-testid="quay-status-band-inflight"]')?.textContent,
    '0 in flight',
  );
});

test('task counts and the suite state come from the snapshot', () => {
  const { container } = renderBand(snapshot());
  assert.match(container.querySelector('[data-testid="quay-status-band-needs-human"]')?.textContent ?? '', /1 needs human/);
  assert.match(container.querySelector('[data-testid="quay-status-band-ready"]')?.textContent ?? '', /2 ready/);
  const suite = container.querySelector('[data-testid="quay-status-band-suite"]');
  assert.equal(suite?.getAttribute('data-state'), 'green');
  assert.match(suite?.textContent ?? '', /green/);
  assert.match(suite?.textContent ?? '', /30 minutes ago/);

  // A failed task read must not be rendered as zeros.
  const unread = renderBand(snapshot({ tasks: null }));
  assert.equal(unread.container.querySelector('[data-testid="quay-status-band-needs-human"]'), null);
  assert.equal(unread.container.querySelector('[data-testid="quay-status-band-ready"]'), null);
});

/* ── heartbeat ─────────────────────────────────────────────────────────────────────────── */

test('heartbeat: a relative reading, marked red once it passes the existing stale threshold', () => {
  const fresh = renderBand(snapshot({
    driver: {
      state: 'running',
      alive: true,
      running: true,
      lastRecordAt: new Date(NOW_MS - 2 * MINUTE_MS).toISOString(),
    },
  }));
  const freshMark = fresh.container.querySelector('[data-testid="quay-status-band-heartbeat"]');
  assert.ok(freshMark);
  assert.match(freshMark.textContent ?? '', /2 minutes ago/);
  assert.equal(freshMark.getAttribute('data-stale'), 'false');
  assert.ok(!(freshMark.className ?? '').includes('text-red-'), 'a fresh heartbeat is not red');
  fresh.unmount();

  const stale = renderBand(snapshot({
    driver: {
      state: 'running',
      alive: true,
      running: true,
      lastRecordAt: new Date(NOW_MS - 6 * MINUTE_MS).toISOString(),
    },
  }));
  const staleMark = stale.container.querySelector('[data-testid="quay-status-band-heartbeat"]');
  assert.ok(staleMark);
  assert.equal(staleMark.getAttribute('data-stale'), 'true');
  assert.ok((staleMark.className ?? '').includes('text-red-'), 'a stale heartbeat is marked red');
});

/* ── honesty when the loop was not read ────────────────────────────────────────────────── */

test('a missing or null loop draws no version/drain/orphan/pointer mark and no 「normal」 wording', () => {
  for (const value of [snapshot({ loop: undefined }), snapshot({ loop: null })]) {
    const { container, unmount } = renderBand(value);
    for (const testId of [
      'quay-status-band-kernel',
      'quay-status-band-orphan',
      'quay-status-band-drain',
      'quay-status-band-pointer',
    ]) {
      assert.equal(container.querySelector(`[data-testid="${testId}"]`), null, `${testId} must be absent`);
    }
    // FALSIFICATION: if a later edit defaults the missing loop to `relation: 'current'`, the
    // kernel mark above appears and this case goes red. The text guard catches the same edit.
    assert.doesNotMatch(
      container.textContent ?? '',
      /normal|healthy|up to date|current/i,
      'a missing loop must not read as normal',
    );
    unmount();
  }
});
