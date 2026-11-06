import assert from 'node:assert/strict';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, test, vi } from 'vitest';

import WebSocketContext from '@/shared/context/WebSocketContext';
import { SessionProtectionProvider } from '@/shared/context/SessionProtectionContext';
import type { Project, SidebarProjectListProps } from '@/shared/types';
import type { SidebarProjectItemProps } from '@/modules/sidebar/SidebarProjectItem';

/**
 * A project row click is ONE gesture that changes two pieces of state: the selected project
 * (owned by the workspace) and the project's expansion (owned by the sidebar).
 *
 * The sidebar's auto-expand effect reacts to the selection change and runs after the click's
 * update commits. Without the row telling the toggle that the same gesture caused the change,
 * the effect re-opened the project the click had just collapsed — so collapsing an expanded,
 * not-selected row took two clicks. Separately, that effect only ever added the newly selected
 * project, so selection changes that did not come from a row (a session route, the
 * Conversations feed) left several projects expanded although `toggleProject` is single-open.
 *
 * These cases drive the REAL controller; only the transports it would read are replaced.
 */

const apiMock = vi.hoisted(() => ({
  archivedProjects: vi.fn(),
  getArchivedSessions: vi.fn(),
  recentConversations: vi.fn(),
  migrateLegacyProjectStars: vi.fn(),
}));

vi.mock('@/shared/api', () => ({ api: apiMock }));

// The controller reaches the palette through its barrel, which drags the whole palette graph
// in behind it. None of it is under test here.
vi.mock('@/modules/command-palette', () => ({
  usePaletteOps: () => ({
    openFile: () => {},
    openFileInEditor: () => {},
    openDirectory: () => {},
    openSettings: () => {},
    refreshProjects: () => {},
  }),
}));

// The row's fleet readings are not part of this contract.
vi.mock('@/modules/sidebar/hooks/useFleetTaskCounts', () => ({
  useFleetProjectDriverState: () => null,
  useFleetTaskCounts: () => null,
}));
vi.mock('@/modules/sidebar/hooks/useFleetAttention', () => ({
  useFleetAttention: () => ({
    fleetProjectIdByProject: new Map<string, string>(),
    attentionByProject: new Map<string, string>(),
    needsHumanTotal: 0,
  }),
}));
vi.mock('@/modules/sidebar/hooks/useCompactSidebar', () => ({ useCompactSidebar: () => false }));
vi.mock('@/shared/hooks/useServerFeatures', () => ({ useServerFeatures: () => ({ cockpitEnabled: false }) }));

const { useSidebarController } = await import('@/modules/sidebar/hooks/useSidebarController');
const { default: SidebarProjectItem } = await import('@/modules/sidebar/SidebarProjectItem');

const makeProject = (projectId: string): Project => ({
  projectId,
  displayName: projectId,
  fullPath: `/tmp/${projectId}`,
  sessions: [],
}) as unknown as Project;

const PROJECT_A = makeProject('a');
const PROJECT_B = makeProject('b');
const PROJECTS = [PROJECT_A, PROJECT_B];

const t = ((key: string) => key) as unknown as SidebarProjectListProps['t'];
const noop = () => {};
const NO_SESSION_IDS: ReadonlySet<string> = new Set<string>();

/** The two providers the controller reads; the socket is where its events would arrive. */
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WebSocketContext.Provider
    value={{ ws: null, sendMessage: () => {}, subscribe: () => () => {}, isConnected: true }}
  >
    <SessionProtectionProvider>{children}</SessionProtectionProvider>
  </WebSocketContext.Provider>
);

type Controller = ReturnType<typeof useSidebarController>;

/** The controller's latest value, published after each render. */
const published: { current: Controller | null } = { current: null };

/**
 * One stable argument object for every render. `projects: []` written inline would be a new
 * array each render, and the controller's mount effect resets `initialSessionsLoaded` whenever
 * that identity changes — a fresh empty array per render is therefore an endless render loop.
 */
const CONTROLLER_ARGS = {
  projects: PROJECTS,
  selectedSession: null,
  activeSessions: NO_SESSION_IDS,
  isLoading: false,
  isMobile: false,
  t,
  onRefresh: () => {},
  onProjectSelect: () => {},
  onSessionSelect: () => {},
  onLoadMoreSessions: () => {},
  setCurrentProject: () => {},
  setSidebarVisible: () => {},
  sidebarVisible: true,
};

function Harness({ selectedProject }: { selectedProject: Project | null }) {
  const controller = useSidebarController({ ...CONTROLLER_ARGS, selectedProject });

  useEffect(() => {
    published.current = controller;
  }, [controller]);

  return null;
}

const store = (): Controller => {
  assert.notEqual(published.current, null);
  return published.current as Controller;
};

const mount = async (selectedProject: Project | null) => {
  const { rerender } = render(<Harness selectedProject={selectedProject} />, { wrapper });
  await waitFor(() => assert.notEqual(published.current, null));
  return {
    select: async (next: Project | null) => {
      rerender(<Harness selectedProject={next} />);
      await waitFor(() => assert.notEqual(published.current, null));
    },
  };
};

beforeEach(() => {
  published.current = null;
});

/** The desktop row's own props; only the two ports this contract names are ever inspected. */
const rowProps = (overrides: Partial<SidebarProjectItemProps>): SidebarProjectItemProps => ({
  project: PROJECT_A,
  selectedProject: PROJECT_B,
  selectedSession: null,
  isExpanded: true,
  isDeleting: false,
  isStarred: false,
  isEditing: false,
  renameDraft: '',
  sessions: [],
  initialSessionsLoaded: true,
  isLoadingMoreSessions: false,
  currentTime: new Date('2026-11-06T00:00:00.000Z'),
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
  activeSessions: NO_SESSION_IDS,
  attentionSessionIds: NO_SESSION_IDS,
  onNewSession: noop,
  isShowingHiddenSessions: false,
  onToggleShowHidden: noop,
  onEditSessionFilter: noop,
  onStartEditingSession: noop,
  onCancelEditingSession: noop,
  onSaveEditingSession: noop,
  t,
  ...overrides,
});

test('one click collapses an expanded, not-selected project instead of being replayed by the auto-expand effect', async () => {
  // The row half: a click that changes the selection reports that fact to the toggle.
  const onToggleProject = vi.fn();
  const onProjectSelect = vi.fn();
  const row = render(
    <MemoryRouter>
      <SidebarProjectItem
        {...rowProps({ onToggleProject, onProjectSelect })}
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByTestId('sidebar-project-row'));
  assert.deepEqual(onProjectSelect.mock.calls[0], [PROJECT_A]);
  assert.deepEqual(
    onToggleProject.mock.calls[0],
    [PROJECT_A.projectId, true],
    'the row click must tell the toggle that the same gesture changes the selection',
  );
  row.unmount();

  // The controller half: the same gesture's toggle must survive the selection-change effect.
  const harness = await mount(PROJECT_B);
  await waitFor(() => assert.equal(store().isProjectExpanded(PROJECT_B.projectId), true));

  // A project can be expanded without being selected (the compact card toggles without
  // selecting). Put the controller in that state through its own public verb.
  act(() => store().toggleProject(PROJECT_A.projectId));
  await waitFor(() => assert.equal(store().isProjectExpanded(PROJECT_A.projectId), true));

  // The desktop row click: selection and toggle land together.
  act(() => {
    void harness.select(PROJECT_A);
    store().toggleProject(PROJECT_A.projectId, true);
  });

  await waitFor(() => {
    assert.equal(
      store().isProjectExpanded(PROJECT_A.projectId),
      false,
      'the auto-expand effect must not undo the collapse the same click asked for',
    );
  });
  assert.equal(store().isProjectExpanded(PROJECT_B.projectId), false);
});

test('a selection change from outside the Projects row leaves exactly the newly selected project expanded', async () => {
  const harness = await mount(PROJECT_A);
  await waitFor(() => assert.equal(store().isProjectExpanded(PROJECT_A.projectId), true));

  // A session route or the Conversations feed selects another project without touching a row.
  act(() => {
    void harness.select(PROJECT_B);
  });
  await waitFor(() => assert.equal(store().isProjectExpanded(PROJECT_B.projectId), true));

  assert.equal(
    store().isProjectExpanded(PROJECT_A.projectId),
    false,
    'the project that was expanded before the selection change must close (single-open)',
  );

  act(() => {
    void harness.select(PROJECT_A);
  });
  await waitFor(() => assert.equal(store().isProjectExpanded(PROJECT_A.projectId), true));

  assert.equal(
    store().isProjectExpanded(PROJECT_B.projectId),
    false,
    'switching back must leave the same single-open shape',
  );
});
