import assert from 'node:assert/strict';

import { render, waitFor } from '@testing-library/react';
import type { TFunction } from 'i18next';
import React from 'react';
import { beforeEach, test, vi } from 'vitest';

import type { Project, QuayFleetTaskCounts } from '@/shared/types';
import type { SidebarProjectItemProps } from '@/modules/sidebar/SidebarProjectItem';

/**
 * The project-row task badge: both sidebar layouts (desktop button and compact card)
 * render the counts the fleet-summary endpoint returns, and only the NON-ZERO buckets are
 * drawn — an all-zero reading draws no badge at all. The API module is mocked at its seam so
 * the REAL `useFleetTaskCounts` hook and the real component run; only the transport is
 * replaced.
 */

const apiMock = vi.hoisted(() => ({
  quayFleetSummary: vi.fn(),
}));

const compactState = vi.hoisted(() => ({ compact: false }));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { ...(actual.api as Record<string, unknown>), quayFleetSummary: apiMock.quayFleetSummary },
  };
});

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({
  useCompactSidebar: () => compactState.compact,
}));

const TASKS: QuayFleetTaskCounts = { total: 7, todo: 2, ready: 3, needsHuman: 1, done: 1 };

/**
 * Budgets for the render waits. The badge appears only after the shared fleet-summary read answers,
 * and on a loaded host that read (plus the row's cold module graph) has been observed at ~4s inside
 * this file and beyond the 5s default case budget in the full suite (`STACK_TRACE_ERROR`, i.e. a
 * vitest case timeout — not an assertion). Both budgets are therefore explicit: the whole file was
 * red once because it trusted the defaults, and a render that is merely slow must be AWAITED, never
 * cut off.
 */
const RENDER_WAIT_MS = 15_000;
const RENDER_WAIT = { timeout: RENDER_WAIT_MS };
/**
 * A case budget that covers a cold module graph AND one full render wait. 20s was measured to be
 * too tight on 2026-11-06 at host load1≈247: the file's first case (which pays the whole transform)
 * was cut off at 20,004ms. 45s keeps the hang detection (the case still fails, never hangs) while
 * giving the cold compile + the wait their own room.
 */
const CASE_BUDGET = { timeout: 45_000 };
/** The delay the slow-render regression case injects (longer than the default 5s case budget). */
const SLOW_RENDER_MS = 6_000;

/** The endpoint reading the badge must reproduce, for one project id and one count shape. */
const serveFleet = (
  tasks: QuayFleetTaskCounts,
  extraProjects: Array<{ projectId: string; tasks: QuayFleetTaskCounts }> = [],
  options: { delayMs?: number } = {},
) => {
  const summary = {
    projects: [
      {
        projectId: 'quay-a',
        projectPath: '/tmp/quay-a',
        driver: { state: 'idle' },
        tasks,
        cached: false,
        error: null,
      },
      ...extraProjects.map((project) => ({
        projectId: project.projectId,
        projectPath: `/tmp/${project.projectId}`,
        driver: { state: 'idle' },
        tasks: project.tasks,
        cached: false,
        error: null,
      })),
    ],
    generatedAt: '2026-10-19T00:00:00.000Z',
    ttlPerProjectMs: 120_000,
    cached: false,
  };
  apiMock.quayFleetSummary.mockImplementation(async () => {
    if (options.delayMs !== undefined && options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }
    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
};

const noop = () => {};
const t = ((key: string) => key) as unknown as TFunction;

function makeProject(projectId: string, hasQuayConfig: boolean): Project {
  return {
    projectId,
    name: projectId,
    displayName: projectId,
    fullPath: `/tmp/${projectId}`,
    hasQuayConfig,
    sessions: [],
  } as unknown as Project;
}

const rowProps = (project: Project) => ({
  project,
  selectedProject: null,
  selectedSession: null,
  isExpanded: false,
  isDeleting: false,
  isStarred: false,
  isEditing: false,
  renameDraft: '',
  sessions: [],
  initialSessionsLoaded: true,
  isLoadingMoreSessions: false,
  currentTime: new Date('2026-10-19T00:00:00.000Z'),
  sessionRenameId: null,
  sessionRenameDraft: '',
  tasksEnabled: false,
  mcpServerStatus: null,
  onRenameDraftChange: noop,
  onToggleProject: noop,
  onProjectSelect: noop,
  onToggleStarProject: noop,
  onStartEditingProject: noop,
  onCancelEditingProject: noop,
  onSaveProjectName: noop,
  onDeleteProject: noop,
  onSessionSelect: noop,
  onDeleteSession: noop,
  onLoadMoreSessions: noop,
  activeSessions: new Set<string>(),
  attentionSessionIds: new Set<string>(),
  onNewSession: noop,
  isShowingHiddenSessions: false,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  showPathOnName: false,
  t,
});

/** Mounts the real row in one layout; each call imports a cold module graph (fresh fleet store). */
const renderRowIn = async (compact: boolean, project = makeProject('quay-a', true)) => {
  const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');
  compactState.compact = compact;
  return render(
    <SidebarProjectItem {...(rowProps(project) as unknown as SidebarProjectItemProps)} />,
  );
};

/** Reads the badge's data attributes, failing loudly when no badge was rendered. */
function readBadge(container: HTMLElement): { todo: string | null; ready: string | null; needsHuman: string | null } {
  const badge = container.querySelector('[data-project-task-counts]');
  assert.notEqual(badge, null, 'the quay project row must render a task badge');
  return {
    todo: badge!.getAttribute('data-task-todo'),
    ready: badge!.getAttribute('data-task-ready'),
    needsHuman: badge!.getAttribute('data-task-needs-human'),
  };
}

/** The buckets the badge actually drew, as the chip kinds in render order. */
const drawnBuckets = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('[data-project-task-counts] [data-task-count]')).map(
    (chip) => chip.getAttribute('data-task-count') ?? '',
  );

beforeEach(() => {
  compactState.compact = false;
  apiMock.quayFleetSummary.mockReset();
  serveFleet(TASKS);
  // The hook keeps one module-level reading; resetting the registry gives each test a cold one.
  vi.resetModules();
});

for (const compact of [false, true]) {
  const layout = compact ? 'compact (mobile)' : 'desktop (non-compact)';

  test(`${layout} row renders only the non-zero fleet-summary buckets`, CASE_BUDGET, async () => {
    const { container } = await renderRowIn(compact);
    await waitFor(() => assert.notEqual(container.querySelector('[data-project-task-counts]'), null), RENDER_WAIT);

    assert.deepEqual(readBadge(container), { todo: '2', ready: '3', needsHuman: '1' });
    assert.deepEqual(drawnBuckets(container), ['todo', 'ready', 'needs-human']);

    // Exactly one shared read for the whole sidebar, not one per row.
    if (!compact) {
      assert.equal(apiMock.quayFleetSummary.mock.calls.length, 1);
    }
  });

  test(`${layout} row draws no badge at all when every bucket is zero`, CASE_BUDGET, async () => {
    serveFleet(
      { total: 0, todo: 0, ready: 0, needsHuman: 0, done: 0 },
      [{ projectId: 'quay-b', tasks: { total: 1, todo: 1, ready: 0, needsHuman: 0, done: 0 } }],
    );
    // The zero project's row is the reading under test…
    const { container } = await renderRowIn(compact);
    // …and the non-zero sibling proves the shared snapshot actually landed: without it, "no
    // badge" would also be true before the request answered.
    const control = await renderRowIn(compact, makeProject('quay-b', true));
    await waitFor(() => assert.notEqual(control.container.querySelector('[data-project-task-counts]'), null), RENDER_WAIT);

    assert.ok(container.querySelector('[data-project-task-counts]') === null);
  });

  test(`${layout} row draws exactly one chip when only ready is non-zero`, CASE_BUDGET, async () => {
    serveFleet({ total: 2, todo: 0, ready: 2, needsHuman: 0, done: 0 });
    const { container } = await renderRowIn(compact);
    await waitFor(() => assert.notEqual(container.querySelector('[data-project-task-counts]'), null), RENDER_WAIT);

    assert.deepEqual(readBadge(container), { todo: '0', ready: '2', needsHuman: '0' });
    assert.deepEqual(drawnBuckets(container), ['ready']);

    const badge = container.querySelector('[data-project-task-counts]')!;
    assert.equal(
      badge.textContent?.replace(/\s+/g, ''),
      '2',
      `the ready-only badge must print one dot+number; read "${badge.textContent}"`,
    );
  });

  test(`${layout} row emphasises the needs-human number when it is non-zero`, CASE_BUDGET, async () => {
    serveFleet({ total: 4, todo: 0, ready: 0, needsHuman: 4, done: 0 });
    const { container } = await renderRowIn(compact);
    await waitFor(() => assert.notEqual(container.querySelector('[data-project-task-counts]'), null), RENDER_WAIT);

    const needsHumanChip = container.querySelector('[data-task-count="needs-human"]');
    assert.notEqual(needsHumanChip, null, 'the needs-human chip must be drawn');
    assert.notEqual(
      needsHumanChip!.querySelector('span.font-medium'),
      null,
      `the needs-human number node must carry font-medium; read ${needsHumanChip!.outerHTML}`,
    );
  });
}

test('both layouts read the same badge attributes and the same drawn buckets', CASE_BUDGET, async () => {
  const desktop = await renderRowIn(false);
  await waitFor(() => assert.notEqual(desktop.container.querySelector('[data-project-task-counts]'), null), RENDER_WAIT);
  const desktopReading = { attributes: readBadge(desktop.container), buckets: drawnBuckets(desktop.container) };
  desktop.unmount();

  vi.resetModules();
  compactState.compact = true;
  const mobile = await renderRowIn(true);
  await waitFor(() => assert.notEqual(mobile.container.querySelector('[data-project-task-counts]'), null), RENDER_WAIT);
  const mobileReading = { attributes: readBadge(mobile.container), buckets: drawnBuckets(mobile.container) };

  assert.deepEqual(mobileReading, desktopReading);
});

test('a badge that arrives 6s late is awaited, not cut off by the default case budget', CASE_BUDGET, async () => {
  // The full-suite red this case guards against was a vitest case timeout (`STACK_TRACE_ERROR`)
  // on a loaded host, not an assertion. The read is deliberately slower than the default 5s case
  // budget: with the explicit wait and case budgets above it must be awaited and read, and both
  // the default wait timeout and the default case budget make it red (see the task's negative
  // control). If this passes only because the mock resolved early, both arms have stopped being
  // load-bearing.
  serveFleet(TASKS, [], { delayMs: SLOW_RENDER_MS });
  const { container } = await renderRowIn(false);
  await waitFor(() => assert.notEqual(container.querySelector('[data-project-task-counts]'), null), RENDER_WAIT);

  assert.deepEqual(readBadge(container), { todo: '2', ready: '3', needsHuman: '1' });
  assert.deepEqual(drawnBuckets(container), ['todo', 'ready', 'needs-human']);
});

test('a project without quay config renders no task badge and keeps its row unchanged', CASE_BUDGET, async () => {
  const { container } = await renderRowIn(false, makeProject('plain', false));

  // The shared read still happens (it covers the whole fleet), but this row never shows it.
  await waitFor(() => assert.equal(apiMock.quayFleetSummary.mock.calls.length, 1), RENDER_WAIT);
  assert.ok(container.querySelector('[data-project-task-counts]') === null);
});
