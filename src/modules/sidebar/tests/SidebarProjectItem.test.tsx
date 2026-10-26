import assert from 'node:assert/strict';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TFunction } from 'i18next';
import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, test, vi } from 'vitest';

import type { Project } from '@/shared/types';
import type { SidebarProjectItemProps } from '@/modules/sidebar/SidebarProjectItem';

/**
 * AC4: the project row's 「在驾驶舱中查看」 link.
 *
 * The REAL row and the REAL shared fleet store run; only the fleet transport is replaced.
 * The fleet registry id — not the CloudCLI project id — is the address the link must carry,
 * and a project the fleet does not register must not draw the action at all.
 */

const apiMock = vi.hoisted(() => ({ quayFleetSummary: vi.fn() }));
/** The server's boot-time cockpit switch; the off arm proves both row actions disappear. */
const featuresMock = vi.hoisted(() => ({ cockpitEnabled: true }));
const compactState = vi.hoisted(() => ({ compact: false }));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    api: { ...(actual.api as Record<string, unknown>), quayFleetSummary: apiMock.quayFleetSummary },
  };
});

vi.mock('@/shared/hooks/useServerFeatures', () => ({
  useServerFeatures: () => ({ status: 'loaded' as const, cockpitEnabled: featuresMock.cockpitEnabled }),
}));

vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({
  useCompactSidebar: () => compactState.compact,
}));

const fleetProject = (projectId: string, fleetProjectId: string | null) => ({
  projectId,
  ...(fleetProjectId === null ? {} : { fleetProjectId }),
  projectPath: `/work/${projectId}`,
  driver: { state: 'idle' },
  tasks: { total: 0, todo: 0, ready: 0, needsHuman: 0, done: 0 },
  cached: false,
  error: null,
});

const FLEET_SUMMARY = {
  projects: [fleetProject('registered', 'claudecodeui'), fleetProject('plain', null)],
  fleet: { available: true, reason: null, state: 'ok' },
  generatedAt: '2026-10-24T00:00:00.000Z',
  ttlPerProjectMs: 120_000,
  cached: false,
};

const noop = () => {};
const t = ((key: string) => key) as unknown as TFunction;

function makeProject(projectId: string): Project {
  return {
    projectId,
    displayName: projectId,
    fullPath: `/tmp/${projectId}`,
    hasQuayConfig: true,
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
  currentTime: new Date('2026-10-24T00:00:00.000Z'),
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
  t,
});

const renderRow = async (
  project: Project,
  overrides: Partial<SidebarProjectItemProps> = {},
  options: { locationProbe?: boolean } = {},
) => {
  const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');
  return render(
    <MemoryRouter>
      <SidebarProjectItem
        {...({ ...rowProps(project), ...overrides } as unknown as SidebarProjectItemProps)}
      />
      {options.locationProbe ? <LocationProbe /> : null}
    </MemoryRouter>,
  );
};

/** Where the routed arm of the menu sent the app. MemoryRouter keeps this out of window.location. */
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

/** The three control slots the compact row is allowed to keep: star, ⋯ trigger, expand indicator. */
const IN_ROW_CONTROLS = [
  '[data-testid="project-star-toggle"]',
  '[data-testid="project-actions-menu"] button[aria-haspopup="menu"]',
  '[data-testid="project-expand-indicator"]',
].join(', ');

const controlNames = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll(IN_ROW_CONTROLS)).map((control) =>
    control.getAttribute('data-testid')
    ?? control.closest('[data-testid="project-actions-menu"]')?.getAttribute('data-testid')
    ?? control.tagName.toLowerCase(),
  );

const menuTrigger = (container: HTMLElement): HTMLButtonElement | null =>
  container.querySelector('[data-testid="project-actions-menu"] button[aria-haspopup="menu"]');

/** Opens the ⋯ menu and returns it; the menu itself is portalled to document.body. */
const openMenu = async (container: HTMLElement): Promise<HTMLElement> => {
  const trigger = menuTrigger(container);
  assert.notEqual(trigger, null, 'the compact row must render the ⋯ trigger');
  fireEvent.click(trigger!);
  return waitFor(() => {
    const menu = screen.queryByRole('menu');
    assert.notEqual(menu, null, 'clicking the ⋯ trigger must open the menu');
    return menu!;
  });
};

/** The menu's items, in render order, by the locale key each label is built from (the test `t` is identity). */
const menuItemLabels = (menu: HTMLElement): string[] =>
  Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).map(
    (item) => (item.textContent ?? '').trim(),
  );

const clickMenuItem = (menu: HTMLElement, label: string) => {
  fireEvent.click(within(menu).getByRole('menuitem', { name: label }));
};

beforeEach(() => {
  compactState.compact = false;
  featuresMock.cockpitEnabled = true;
  apiMock.quayFleetSummary.mockReset();
  apiMock.quayFleetSummary.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => FLEET_SUMMARY,
  }));
  // The fleet reading is module-level in the shared store; a cold import per case keeps it so.
  vi.resetModules();
});

vi.setConfig({ testTimeout: 20_000 });

test('a registered project links to its board in the cockpit, addressed by the fleet id', async () => {
  const { container } = await renderRow(makeProject('registered'));

  await waitFor(() =>
    assert.notEqual(container.querySelector('[data-testid="cockpit-project-link"]'), null),
  );
  const link = container.querySelector('[data-testid="cockpit-project-link"]') as HTMLAnchorElement;
  assert.equal(link.getAttribute('data-cockpit-project'), 'claudecodeui');
  assert.equal(link.getAttribute('href'), '/cockpit?view=board&project=claudecodeui');
  assert.equal(link.getAttribute('aria-label'), 'common:cockpit.openProject');
  // The CloudCLI id is not an address: it must never appear in the link.
  assert.doesNotMatch(link.getAttribute('href') ?? '', /project=registered/);
});

test('a project the fleet does not register has no such action', async () => {
  const { container } = await renderRow(makeProject('plain'));

  // The fleet read still happens (the store covers the whole fleet); the row simply has no
  // addressable board for this project.
  await waitFor(() => assert.equal(apiMock.quayFleetSummary.mock.calls.length, 1));
  assert.equal(container.querySelector('[data-testid="cockpit-project-link"]'), null);
});

test('the compact row keeps three control slots and moves every project action into ⋯', async () => {
  compactState.compact = true;
  const { container } = await renderRow(makeProject('registered'), { onEditSessionFilter: noop });

  await waitFor(() =>
    assert.notEqual(container.querySelector('[data-testid="project-actions-menu"]'), null),
  );

  const controls = container.querySelectorAll(IN_ROW_CONTROLS);
  const names = controlNames(container);
  assert.equal(
    controls.length,
    3,
    `the compact row must keep exactly three control slots (star, ⋯, expand); read ${controls.length}: ${names.join(', ')}`,
  );
  assert.equal(
    container.querySelectorAll('[data-testid="sidebar-project-card"] button').length,
    2,
    'only the favorite star and the ⋯ trigger may be buttons in the row; the expand slot is status-only',
  );
  // The two cockpit entry points that used to sit inline are gone from the row.
  assert.equal(
    container.querySelector('[data-testid="cockpit-project-link"]'),
    null,
    'the board link must not stay inline on the compact row',
  );
  assert.equal(
    container.querySelector('[data-testid="cockpit-project-watch-toggle"]'),
    null,
    'the watch pin must not stay inline on the compact row',
  );

  const menu = await openMenu(container);
  const labels = menuItemLabels(menu);
  const EXPECTED = [
    'tooltips.renameProject',
    'sessionFilter.menuItem',
    'common:cockpit.openProject',
    'common:cockpit.observationPin',
    'tooltips.deleteProject',
  ];
  assert.deepEqual(
    labels,
    EXPECTED,
    `menu items must read ${JSON.stringify(EXPECTED)}; read ${JSON.stringify(labels)}`,
  );

  // Delete is the destructive action and sits after a separator, not among the ordinary items.
  const deleteItem = within(menu).getByRole('menuitem', { name: 'tooltips.deleteProject' });
  const divider = deleteItem.previousElementSibling;
  assert.equal(
    divider?.className.includes('bg-border'),
    true,
    `delete must sit after a divider; its preceding sibling is ${divider?.outerHTML ?? 'nothing'}`,
  );
});

test('with the cockpit switched off the menu offers neither cockpit item', async () => {
  compactState.compact = true;
  featuresMock.cockpitEnabled = false;
  const { container } = await renderRow(makeProject('registered'), { onEditSessionFilter: noop });

  const menu = await openMenu(container);
  const labels = menuItemLabels(menu);
  assert.deepEqual(
    labels,
    ['tooltips.renameProject', 'sessionFilter.menuItem', 'tooltips.deleteProject'],
    `a cockpit-off menu must hold only rename/filter/delete; read ${JSON.stringify(labels)}`,
  );
});

test('without a session-filter editor the menu omits that item', async () => {
  compactState.compact = true;
  const { container } = await renderRow(makeProject('registered'));

  const menu = await openMenu(container);
  const labels = menuItemLabels(menu);
  assert.deepEqual(
    labels,
    [
      'tooltips.renameProject',
      'common:cockpit.openProject',
      'common:cockpit.observationPin',
      'tooltips.deleteProject',
    ],
    `an absent onEditSessionFilter must drop the filter item; read ${JSON.stringify(labels)}`,
  );
});

test('menu items call their ports and never expand the row', async () => {
  compactState.compact = true;
  const project = makeProject('registered');
  const onStartEditingProject = vi.fn();
  const onDeleteProject = vi.fn();
  const onToggleProject = vi.fn();
  const onEditSessionFilter = vi.fn();
  const { container } = await renderRow(
    project,
    { onStartEditingProject, onDeleteProject, onToggleProject, onEditSessionFilter },
    { locationProbe: true },
  );

  // Opening the menu is itself a row-cluster interaction: it must not expand the project.
  const menu = await openMenu(container);
  assert.equal(onToggleProject.mock.calls.length, 0, 'the ⋯ trigger must not expand the row');

  clickMenuItem(menu, 'tooltips.renameProject');
  await waitFor(() => assert.equal(onStartEditingProject.mock.calls.length, 1));
  assert.deepEqual(onStartEditingProject.mock.calls[0], [project], 'rename receives the row project');

  const deleteMenu = await openMenu(container);
  clickMenuItem(deleteMenu, 'tooltips.deleteProject');
  await waitFor(() => assert.equal(onDeleteProject.mock.calls.length, 1));
  assert.deepEqual(onDeleteProject.mock.calls[0], [project], 'delete receives the row project');

  const cockpitMenu = await openMenu(container);
  clickMenuItem(cockpitMenu, 'common:cockpit.openProject');
  await waitFor(() =>
    assert.equal(
      screen.getByTestId('location').textContent,
      '/cockpit?view=board&project=claudecodeui',
    ),
  );

  assert.equal(
    onToggleProject.mock.calls.length,
    0,
    `no menu item or trigger may expand the row; onToggleProject was called ${onToggleProject.mock.calls.length} times`,
  );
});

test('with the cockpit switched off the row draws neither the pin nor the board link', async () => {
  featuresMock.cockpitEnabled = false;
  const { container } = await renderRow(makeProject('registered'));

  // The fleet read still runs (the task-count badge is not a cockpit surface); the two entry
  // points into the cockpit are absent in both layouts.
  await waitFor(() => assert.equal(apiMock.quayFleetSummary.mock.calls.length, 1));
  assert.equal(container.querySelector('[data-testid="cockpit-project-link"]'), null);
  assert.equal(container.querySelector('[data-testid="cockpit-project-watch-toggle"]'), null);

  compactState.compact = true;
  const compact = await renderRow(makeProject('registered'));
  assert.equal(compact.container.querySelector('[data-testid="cockpit-project-link"]'), null);
  assert.equal(compact.container.querySelector('[data-testid="cockpit-project-watch-toggle"]'), null);
});
