import assert from 'node:assert/strict';

import { act, fireEvent, render, within } from '@testing-library/react';
import i18next from 'i18next';
import { useCallback, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { initReactI18next } from 'react-i18next';
import { beforeEach, test, vi } from 'vitest';

import type { AppTab, Project } from '@/shared/types';
import enCommon from '@/modules/i18n/locales/en/common.json';
import WorkspaceHeader from '@/modules/project-workspace/WorkspaceHeader';
import WorkspaceTabs, { RESIDENT_SHELL_NOTICE_ID } from '@/modules/project-workspace/WorkspaceTabs';

/**
 * The mobile header used to stack "menu + title" over a horizontally scrolling
 * `role="tablist"` (94px at 390×844), and its responsive classes moved at `sm`
 * (640px) while `useDeviceSettings` called anything under 768px mobile — so
 * 640–767px had a mobile menu button beside a desktop tab bar. These cases pin
 * the two halves of the fix: below 768px there is no tablist at all, only a
 * single trigger that opens the workspace picker dialog and must keep every
 * enabled plugin reachable, and above it the tablist and its keyboard behaviour
 * are unchanged.
 *
 * The dialog cases assert through `document.activeElement` and the rendered entry
 * list rather than through props, because focus return and "no workspace
 * disappeared" are exactly what a collapse of the tab bar can silently break.
 */

const { PLUGINS, ENABLED_PLUGIN_COUNT } = vi.hoisted(() => {
  const makePlugin = (index: number, enabled: boolean) => ({
    name: `probe-${index}`,
    displayName: `Probe Workspace ${index}`,
    version: '1.0.0',
    description: `probe plugin ${index}`,
    author: 'probe',
    icon: 'icon.svg',
    type: 'module' as const,
    slot: 'tab' as const,
    entry: 'index.js',
    server: null,
    permissions: [],
    enabled,
    serverRunning: false,
    dirName: `probe-${index}`,
    repoUrl: null,
  });

  return {
    PLUGINS: [
      ...Array.from({ length: 12 }, (_, i) => makePlugin(i + 1, true)),
      // Disabled plugins are the reverse control: the list must filter, not merely render.
      ...Array.from({ length: 2 }, (_, i) => makePlugin(13 + i, false)),
    ],
    ENABLED_PLUGIN_COUNT: 12,
  };
});

// The pulse trigger polls the lanes endpoint whenever the Quay tab is offered. These cases are
// about layout (and about the trigger's own visibility gate), so the network hop answers an
// empty, successful reading; the mocks are spies so the gate case can count calls.
const apiMock = vi.hoisted(() => ({ quayLanes: vi.fn(), quaySessionMentions: vi.fn() }));
vi.mock('@/shared/api', () => ({ api: apiMock }));

beforeEach(() => {
  apiMock.quayLanes.mockReset();
  apiMock.quaySessionMentions.mockReset();
  apiMock.quayLanes.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, gantt: null, ganttUnavailable: 'lanes-read-failed', generatedAt: '' }),
  });
  apiMock.quaySessionMentions.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, sessionId: 's', projectId: 'p', tasks: [], goals: [], generatedAt: '' }),
  });
});

vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({
    plugins: PLUGINS,
    loading: false,
    pluginsError: null,
    refreshPlugins: async () => {},
    installPlugin: async () => ({ success: true }),
    uninstallPlugin: async () => ({ success: true }),
    updatePlugin: async () => ({ success: true }),
    togglePlugin: async () => ({ success: true, error: null }),
  }),
  // The real icon fetches a per-plugin SVG; the cases below are about which
  // workspaces are listed, so the icon renders nothing.
  PluginIcon: () => null,
}));

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common',
  resources: { en: { common: enCommon } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

// jsdom ships no ResizeObserver, and the desktop tab strip observes its own
// overflow to decide whether the scroll gradients and arrows are shown.
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom also ships no scrollIntoView, and the header scrolls its active tab into view from a
// requestAnimationFrame — which lands after the awaited assertions in the gate case.
Element.prototype.scrollIntoView = () => {};

/**
 * The desktop order with neither Quay nor Architecture offered. Shell is the LAST built-in
 * tab, right before the plugin divider: the terminal never sits between the session's views.
 */
const BUILT_IN_NAMES = ['Chat', 'Files', 'Source Control', 'Browser', 'Tasks', 'Shell'];
const ENABLED_PLUGIN_NAMES = Array.from({ length: ENABLED_PLUGIN_COUNT }, (_, i) => `Probe Workspace ${i + 1}`);
const DISABLED_PLUGIN_NAMES = ['Probe Workspace 13', 'Probe Workspace 14'];

/** The tab ids the mocks produce, in their built-in group, for the two switch states. */
const BUILT_IN_IDS = ['chat', 'files', 'git', 'browser', 'tasks', 'shell'];
const BUILT_IN_IDS_WITH_QUAY_AND_ARCHITECTURE = ['chat', 'quay', 'architecture', 'files', 'git', 'browser', 'tasks', 'shell'];
const PLUGIN_IDS = Array.from({ length: ENABLED_PLUGIN_COUNT }, (_, i) => `plugin:probe-${i + 1}`);

const PROJECT: Project = {
  projectId: 'mobile-layout-probe',
  displayName: '移动端布局探针项目名称',
  fullPath: '/home/odoo/workspace/mobile-layout-probe',
};

type HarnessProps = {
  isMobile: boolean;
  shouldShowTasksTab?: boolean;
  shouldShowQuayTab?: boolean;
  shouldShowArchitectureTab?: boolean;
  shouldShowBrowserTab?: boolean;
  isResidentSession?: boolean;
  onSetActiveTab?: (update: SetStateAction<AppTab>) => void;
};

/**
 * Mounts the real header with a live active tab, so the keyboard case and the
 * dialog-selection case both exercise the header's own wiring rather than a
 * stubbed setter that would let a broken selection path still look correct.
 */
function HeaderHarness({
  isMobile,
  shouldShowTasksTab = false,
  shouldShowQuayTab = false,
  shouldShowArchitectureTab = false,
  shouldShowBrowserTab = false,
  isResidentSession = false,
  onSetActiveTab,
}: HarnessProps) {
  const [activeTab, setActiveTab] = useState<AppTab>('chat');

  const handleSetActiveTab = useCallback<Dispatch<SetStateAction<AppTab>>>((update) => {
    onSetActiveTab?.(update);
    setActiveTab(update);
  }, [onSetActiveTab]);

  return (
    <WorkspaceHeader
      activeTab={activeTab}
      setActiveTab={handleSetActiveTab}
      selectedProject={PROJECT}
      selectedSession={null}
      shouldShowTasksTab={shouldShowTasksTab}
      shouldShowQuayTab={shouldShowQuayTab}
      shouldShowArchitectureTab={shouldShowArchitectureTab}
      shouldShowBrowserTab={shouldShowBrowserTab}
      isResidentSession={isResidentSession}
      isMobile={isMobile}
      onMenuClick={() => {}}
    />
  );
}

/** The name a screen reader computes for a plain element: aria-label wins, otherwise its text. */
const accessibleName = (element: Element): string =>
  element.getAttribute('aria-label') ?? (element.textContent ?? '').trim();

/** Every button's accessible name in document order — printed in failures so a wrong list is readable. */
const buttonNames = (): string[] => Array.from(document.querySelectorAll('button')).map(accessibleName);

const focusedName = (): string => {
  const active = document.activeElement;
  return active ? `${active.tagName.toLowerCase()} "${accessibleName(active)}"` : '<no activeElement>';
};

// The Quay pulse trigger also announces `aria-haspopup="dialog"`, so the workspace selector is
// identified by its own contract (`data-workspace-tab`) rather than by that attribute alone.
const collapsedTrigger = (): HTMLElement | null =>
  document.querySelector('[data-workspace-tab][aria-haspopup="dialog"]');

const workspaceDialog = (): HTMLElement | null => document.querySelector('[role="dialog"]');

const openWorkspaceDialog = (): { trigger: HTMLElement; panel: HTMLElement } => {
  const trigger = collapsedTrigger();
  assert.ok(trigger, `the mobile header must expose a collapsed trigger; button names were ${JSON.stringify(buttonNames())}`);
  fireEvent.click(trigger);

  const panel = workspaceDialog();
  assert.ok(panel, `clicking the trigger must open the workspace dialog; button names were ${JSON.stringify(buttonNames())}`);
  return { trigger, panel };
};

/** The overlay the Dialog primitive draws behind its panel; clicking it has to close the dialog. */
const dialogOverlay = (panel: HTMLElement): HTMLElement => {
  const overlay = panel.parentElement?.firstElementChild;
  assert.ok(overlay, 'the dialog panel must sit in a wrapper whose first child is the overlay');
  return overlay as HTMLElement;
};

/** The `data-workspace-tab` sequence the tablist renders, in document order. */
const tabIds = (root: ParentNode = document): (string | null)[] =>
  Array.from(root.querySelectorAll('[role="tab"]')).map((element) => element.getAttribute('data-workspace-tab'));

/**
 * The tablist's direct children as a readable sequence: a tab id, or `divider` for the
 * plugin separator. A tab may sit behind a tooltip wrapper, so each child is reduced to the
 * tab it contains.
 */
const tablistParts = (): string[] => {
  const tablist = document.querySelector('[role="tablist"]');
  assert.ok(tablist, 'the desktop header must render a tablist');
  return Array.from(tablist.children).map((child) => {
    if (child.tagName === 'SPAN' && child.getAttribute('aria-hidden') === 'true') return 'divider';
    const tab = child.matches('[role="tab"]') ? child : child.querySelector('[role="tab"]');
    return tab?.getAttribute('data-workspace-tab') ?? child.tagName.toLowerCase();
  });
};

/**
 * Installs the readings the label-mode decision takes, and lets a case move them.
 *
 * The room the header gives the strip is split across two flex children since the Loop Pulse
 * trigger moved next to the tabs: the empty grow cell (`data-workspace-tabs-spacer`) and the
 * content-sized tab container (`data-workspace-tabs-room`). The decision reads their SUM, so the
 * stub takes both. `natural` is the off-screen full-label copy; every other element reads 0, so
 * the three numbers cannot be confused with one another. `triggerResize` replays the
 * ResizeObserver notification the browser would send; `restore` puts the jsdom prototypes and the
 * global observer back.
 */
function installStripWidthStubs(widths: { spacer: number; room: number; natural: number }): {
  triggerResize: () => void;
  restore: () => void;
} {
  const callbacks: (() => void)[] = [];
  const OriginalResizeObserver = globalThis.ResizeObserver;

  globalThis.ResizeObserver = class {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      callbacks.push(() => this.callback([], this as unknown as ResizeObserver));
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.hasAttribute('data-workspace-tabs-spacer')) return widths.spacer;
      return this.hasAttribute('data-workspace-tabs-room') ? widths.room : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-workspace-tabs-measure') ? widths.natural : 0;
    },
  });

  return {
    triggerResize: () => {
      for (const trigger of callbacks) trigger();
    },
    restore: () => {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
      globalThis.ResizeObserver = OriginalResizeObserver;
    },
  };
}

/** The strip's current mode as the header reports it. */
const stripMode = (): string | null =>
  document.querySelector('[role="tablist"]')?.getAttribute('data-workspace-tabs-mode') ?? null;

/** One tab's label span, by its stable id hook. */
const tabLabel = (id: string): HTMLElement | null =>
  document.querySelector(`[data-workspace-tab-label="${id}"]`);

test('desktop keeps the full tablist and renders no collapsed trigger', () => {
  const { getAllByRole } = render(
    <HeaderHarness isMobile={false} shouldShowTasksTab shouldShowBrowserTab />,
  );

  const tabNames = getAllByRole('tab').map(accessibleName);
  const expectedNames = [...BUILT_IN_NAMES, ...ENABLED_PLUGIN_NAMES];

  assert.deepEqual(
    tabNames,
    expectedNames,
    `desktop must list every built-in and enabled plugin tab; got ${JSON.stringify(tabNames)}`,
  );
  assert.equal(
    collapsedTrigger(),
    null,
    `desktop must not render the mobile collapsed trigger; button names were ${JSON.stringify(buttonNames())}`,
  );

  // Reverse control: the filter drops disabled plugins instead of listing everything.
  for (const name of DISABLED_PLUGIN_NAMES) {
    assert.ok(
      !tabNames.includes(name),
      `a disabled plugin must not get a tab: "${name}" appeared among ${JSON.stringify(tabNames)}`,
    );
  }
});

// The built-in order is one list for every surface. Chat first, the session's project-level
// views (Quay, Architecture) next, the file/history views after them, the optional extras,
// and Shell last — against the plugin divider rather than in the middle of the session's
// views. The reverse control turns the two project-level views off and shows that the rest of
// the sequence is unchanged.
test('desktop built-in order puts Quay and Architecture after Chat and Shell last before plugins', () => {
  const all = render(
    <HeaderHarness
      isMobile={false}
      shouldShowTasksTab
      shouldShowQuayTab
      shouldShowArchitectureTab
      shouldShowBrowserTab
    />,
  );

  assert.deepEqual(
    tabIds(),
    [...BUILT_IN_IDS_WITH_QUAY_AND_ARCHITECTURE, ...PLUGIN_IDS],
    `the full built-in order must be Chat, Quay, Architecture, Files, Git, Browser, Tasks, Shell, then plugins; got ${JSON.stringify(tabIds())}`,
  );
  assert.deepEqual(
    tablistParts(),
    [...BUILT_IN_IDS_WITH_QUAY_AND_ARCHITECTURE, 'divider', ...PLUGIN_IDS],
    `the plugin divider must sit between Shell and the first plugin; got ${JSON.stringify(tablistParts())}`,
  );

  all.unmount();

  // Reverse control: turning Quay and Architecture off removes only their slots.
  render(<HeaderHarness isMobile={false} shouldShowTasksTab shouldShowBrowserTab />);
  assert.deepEqual(
    tabIds(),
    [...BUILT_IN_IDS, ...PLUGIN_IDS],
    `without Quay and Architecture the order must be Chat, Files, Git, Browser, Tasks, Shell, then plugins; got ${JSON.stringify(tabIds())}`,
  );
  assert.deepEqual(tablistParts(), [...BUILT_IN_IDS, 'divider', ...PLUGIN_IDS]);
});

// The reordering is only about position: a resident session's Shell tab keeps the closure
// contract it already had (disabled, the notice id, the hover title) and now sits at the end
// of the built-in group, where the order asks for it.
test('a resident session keeps the Shell tab disabled and last in the built-in group', () => {
  render(<HeaderHarness isMobile={false} isResidentSession shouldShowTasksTab shouldShowBrowserTab />);

  const shell = document.querySelector<HTMLElement>('[role="tab"][data-workspace-tab="shell"]');
  assert.ok(shell, 'the Shell tab must render for a resident session (disabled, not removed)');
  assert.equal(shell.getAttribute('data-disabled-reason'), 'resident');
  assert.equal(shell.getAttribute('aria-disabled'), 'true');
  assert.equal(shell.getAttribute('aria-describedby'), RESIDENT_SHELL_NOTICE_ID);
  assert.equal(
    shell.getAttribute('title'),
    enCommon.tabs.shellResidentDisabled,
    'the hover text must still be the resident notice sentence',
  );

  const parts = tablistParts();
  const divider = parts.indexOf('divider');
  assert.ok(divider > 0, `the plugin divider must render; got ${JSON.stringify(parts)}`);
  assert.equal(parts[divider - 1], 'shell', `Shell must be the last built-in tab; got ${JSON.stringify(parts)}`);
});

// The order comes from the ONE `useWorkspaceTabDefinitions` list, so the mobile picker cannot
// drift from the desktop pills. This reads the ids from both surfaces and compares them
// item-for-item; the ids are locale-independent, so the case does not depend on the labels.
test('mobile dialog lists the same order as desktop', () => {
  const desktop = render(
    <HeaderHarness
      isMobile={false}
      shouldShowTasksTab
      shouldShowQuayTab
      shouldShowArchitectureTab
      shouldShowBrowserTab
    />,
  );
  const desktopIds = tabIds();
  desktop.unmount();

  render(
    <HeaderHarness
      isMobile
      shouldShowTasksTab
      shouldShowQuayTab
      shouldShowArchitectureTab
      shouldShowBrowserTab
    />,
  );
  const { panel } = openWorkspaceDialog();
  const mobileIds = Array.from(panel.querySelectorAll('button[data-workspace-tab]'))
    .map((element) => element.getAttribute('data-workspace-tab'));

  assert.deepEqual(
    mobileIds,
    desktopIds,
    `the mobile dialog must list the same views in the same order as the desktop strip; desktop ${JSON.stringify(desktopIds)} vs mobile ${JSON.stringify(mobileIds)}`,
  );
});

// B2: the strip has two label modes and picks between them from the measured room. The
// off-screen full-label copy is what makes the decision stable, so this case also reads that
// copy across the two switches: its width and its labels must not change with the mode.
test('tab strip drops to icon-only when the full-label width exceeds the room, and returns when it fits', () => {
  // 200 + 300 is the same 500 px total the single `room` reading used to carry; the split is
  // only how that total is now presented to the header.
  const widths = { spacer: 200, room: 300, natural: 900 };
  const stubs = installStripWidthStubs(widths);

  try {
    render(<HeaderHarness isMobile={false} shouldShowTasksTab shouldShowBrowserTab />);

    assert.equal(stripMode(), 'icon', 'a 500px room for a 900px full strip must choose icon-only');
    // Inactive tabs drop their word; the active tab keeps its own.
    assert.ok(tabLabel('files')?.classList.contains('hidden'), 'an inactive tab must hide its label in icon mode');
    assert.ok(!tabLabel('files')?.classList.contains('inline'), 'the inactive label must not stay inline');
    assert.ok(tabLabel('chat')?.classList.contains('inline'), 'the active tab must keep its label in icon mode');

    const measure = document.querySelector('[data-workspace-tabs-measure]');
    assert.ok(measure, 'the header must render the off-screen full-label measuring copy');
    const naturalInIconMode = (measure as HTMLElement).scrollWidth;
    const labelsInIconMode = measure.textContent;

    // The total left for the strip grows past the natural width: the strip returns to full labels.
    widths.spacer = 200;
    widths.room = 800;
    act(() => {
      stubs.triggerResize();
    });

    assert.equal(stripMode(), 'full', 'a room wider than the full strip must return to full labels');
    for (const id of ['chat', 'files', 'git', 'browser', 'tasks', 'shell']) {
      assert.ok(
        tabLabel(id)?.classList.contains('inline'),
        `every tab must show its label in full mode; "${id}" did not`,
      );
    }

    // No oscillation: the natural reading is a property of the tab set and the language, not
    // of the mode. A measure that shrank with the mode would flip back and forth.
    assert.equal(
      (measure as HTMLElement).scrollWidth,
      naturalInIconMode,
      'the natural full width must read the same in both modes',
    );
    assert.equal(
      measure.textContent,
      labelsInIconMode,
      'the off-screen copy must keep every label in both modes',
    );
  } finally {
    stubs.restore();
  }
});

// The strip's decision reads the SUM of the two flex children that now share its old room. The
// boundary is exact: `natural + reserved` is full, one pixel less is icon. Redistributing a fixed
// sum between the two must not change the mode — if it did, icon mode narrowing the container
// would grow the spacer and keep choosing icon, which is the feedback loop the spacer exists to
// prevent.
test('the label-mode decision reads spacer + room and ignores how the same total is split', () => {
  const NATURAL = 900;
  const RESERVED = 4; // WorkspaceHeader's TAB_STRIP_INLINE_PADDING_PX
  const widths = { spacer: 400, room: NATURAL + RESERVED - 400, natural: NATURAL };
  const stubs = installStripWidthStubs(widths);

  try {
    render(<HeaderHarness isMobile={false} shouldShowTasksTab shouldShowBrowserTab />);

    assert.equal(widths.spacer + widths.room, NATURAL + RESERVED);
    assert.equal(stripMode(), 'full', 'available = natural + the reserved slack must keep full labels');

    // One pixel under the boundary: icon-only.
    widths.room = NATURAL + RESERVED - 1 - widths.spacer;
    act(() => {
      stubs.triggerResize();
    });
    assert.equal(stripMode(), 'icon', 'available = natural + the reserved slack - 1 must choose icon-only');

    // Back to the full boundary, then move the SAME total from the container into the spacer.
    // The mode must not change: the two readings are one number.
    widths.spacer = 100;
    widths.room = NATURAL + RESERVED - 100;
    act(() => {
      stubs.triggerResize();
    });
    assert.equal(stripMode(), 'full', 'a total at the boundary must be full no matter which child holds it');

    widths.spacer = 800;
    widths.room = NATURAL + RESERVED - 800;
    act(() => {
      stubs.triggerResize();
    });
    assert.equal(
      stripMode(),
      'full',
      'moving 700 px from the container to the spacer must not flip the mode: the decision reads their sum',
    );
  } finally {
    stubs.restore();
  }
});

// The desktop header's direct children are one row in DOM order: title block, the empty grow
// cell, the Loop Pulse trigger, the tab container, the menu. The trigger must be a SIBLING of the
// container, never a descendant: the move exists to put the pulse next to the tabs without
// putting it inside the tab surface. The mobile branch is untouched and renders no spacer.
test('desktop header places the pulse trigger between the grow spacer and the tab container', () => {
  render(<HeaderHarness isMobile={false} shouldShowTasksTab shouldShowQuayTab shouldShowBrowserTab />);

  const header = document.querySelector('header[data-app-header]');
  assert.ok(header, 'the header must render');
  const children = Array.from(header.children);
  assert.equal(
    children.length,
    5,
    `the desktop header must have exactly its five direct children; got ${children.map((element) => element.tagName).join(',')}`,
  );

  assert.ok(
    (children[0].textContent ?? '').includes(PROJECT.displayName),
    'the first child must be the title block',
  );

  const spacer = children[1];
  assert.equal(spacer.getAttribute('data-workspace-tabs-spacer'), '', 'the second child must be the grow spacer');
  assert.equal(spacer.getAttribute('aria-hidden'), 'true', 'the spacer is decorative and must never be announced');
  assert.equal((spacer.textContent ?? '').trim(), '', 'the spacer must carry no content');

  const pulse = children[2];
  assert.equal(pulse.getAttribute('data-testid'), 'quay-pulse-trigger', 'the third child must be the pulse trigger');

  const room = children[3];
  assert.equal(room.getAttribute('data-workspace-tabs-room'), '', 'the fourth child must be the tab container');
  assert.equal(
    room.querySelector('[data-testid="quay-pulse-trigger"]'),
    null,
    'the pulse trigger must not be a descendant of the tab container',
  );

  assert.ok(
    children[4].querySelector('[data-workspace-menu-trigger]'),
    'the last child must be the workspace menu',
  );
});

test('mobile header keeps its pre-change child order and renders no spacer', () => {
  render(<HeaderHarness isMobile shouldShowTasksTab shouldShowQuayTab shouldShowBrowserTab />);

  const header = document.querySelector('header[data-app-header]');
  assert.ok(header, 'the header must render');
  const children = Array.from(header.children);
  assert.equal(
    children.length,
    2,
    `the mobile header must still be title block + one action row; got ${children.map((element) => element.tagName).join(',')}`,
  );
  assert.ok((children[0].textContent ?? '').includes(PROJECT.displayName), 'the first child must be the title block');
  assert.equal(
    document.querySelector('[data-workspace-tabs-spacer]'),
    null,
    'the desktop-only spacer must not render on mobile',
  );
  assert.ok(
    children[0].querySelector('[data-testid="quay-pulse-trigger"]'),
    // AC-430 moved the pulse out of the action row: it is now the in-flight thumbnail after the
    // project name in the title block (the old Resident pill position), so the phone's right-hand
    // row is picker + menu + cockpit entry only.
    'the title block must carry the pulse trigger, after the project name',
  );
  assert.equal(
    children[1].querySelector('[data-testid="quay-pulse-trigger"]'),
    null,
    'the mobile action row must no longer carry the pulse trigger',
  );
  assert.ok(
    children[1].querySelector('[data-workspace-tab][aria-haspopup="dialog"]'),
    'the mobile action row must still carry the workspace picker',
  );
  assert.ok(
    children[1].querySelector('[data-workspace-menu-trigger]'),
    'the mobile action row must still carry the menu',
  );
});

// The tooltip rule from `gap-architecture-compact-chrome-and-tab-tooltip` — a bubble only for
// a tab whose word is hidden — now follows the label MODE rather than a viewport breakpoint.
// A tab is tooltipped when its Pill sits inside Tooltip's wrapper element.
test('tab tooltip follows the label mode, not the breakpoint', () => {
  const tooltipWrapped = (tab: Element): boolean =>
    tab.parentElement?.matches('div.relative.inline-block') ?? false;

  const full = render(<HeaderHarness isMobile={false} shouldShowTasksTab shouldShowBrowserTab />);
  assert.equal(stripMode(), 'full', 'the unmeasured jsdom header must default to full labels');
  const fullTabs = Array.from(document.querySelectorAll('[role="tab"]'));
  assert.ok(fullTabs.length > 0, 'the desktop strip must render tabs');
  for (const tab of fullTabs) {
    assert.equal(
      tooltipWrapped(tab),
      false,
      `a visible label must not render a tooltip; "${tab.getAttribute('data-workspace-tab')}" did`,
    );
  }
  full.unmount();

  const widths = { spacer: 150, room: 250, natural: 900 };
  const stubs = installStripWidthStubs(widths);
  try {
    render(<HeaderHarness isMobile={false} shouldShowTasksTab shouldShowBrowserTab />);
    assert.equal(stripMode(), 'icon', 'the narrow room must choose icon-only');

    for (const tab of Array.from(document.querySelectorAll('[role="tab"]'))) {
      const id = tab.getAttribute('data-workspace-tab');
      if (id === 'chat') {
        assert.equal(
          tooltipWrapped(tab),
          false,
          'the active tab keeps its label in icon mode, so it must not render a tooltip',
        );
      } else {
        assert.equal(
          tooltipWrapped(tab),
          true,
          `an icon-only inactive tab must render a tooltip; "${id}" did not`,
        );
      }
    }
  } finally {
    stubs.restore();
  }
});

test('mobile drops the tablist for a single trigger that reports the active workspace and toggles aria-expanded', () => {
  const { queryAllByRole } = render(
    <HeaderHarness isMobile shouldShowTasksTab shouldShowBrowserTab />,
  );

  assert.equal(
    queryAllByRole('tab').length,
    0,
    `mobile must not render the tablist; button names were ${JSON.stringify(buttonNames())}`,
  );

  const triggers = document.querySelectorAll('[aria-haspopup="dialog"]');
  assert.equal(
    triggers.length,
    1,
    `mobile must render exactly one collapsed trigger; button names were ${JSON.stringify(buttonNames())}`,
  );

  const trigger = triggers[0] as HTMLElement;
  // A project without the quay pulse strip has nothing to make room for, so the trigger names
  // the active view on screen as well as through `aria-label`.
  assert.equal(
    (trigger.textContent ?? '').trim(),
    'Chat',
    `the collapsed trigger must show the active view name; it rendered "${trigger.textContent}"`,
  );
  assert.ok(
    accessibleName(trigger).includes('Chat'),
    `the trigger must name the active workspace; its name was "${accessibleName(trigger)}"`,
  );
  assert.equal(
    trigger.getAttribute('aria-expanded'),
    'false',
    `a closed trigger must report aria-expanded="false"; button names were ${JSON.stringify(buttonNames())}`,
  );

  fireEvent.click(trigger);

  assert.ok(workspaceDialog(), `clicking the trigger must open the dialog; button names were ${JSON.stringify(buttonNames())}`);
  assert.equal(
    trigger.getAttribute('aria-expanded'),
    'true',
    `an open trigger must report aria-expanded="true"; button names were ${JSON.stringify(buttonNames())}`,
  );

  fireEvent.keyDown(document, { key: 'Escape' });

  assert.equal(trigger.getAttribute('aria-expanded'), 'false', 'closing the dialog must flip aria-expanded back');
  assert.equal(workspaceDialog(), null, 'Escape must close the dialog');
});

test('the mobile dialog lists every built-in, conditional and enabled plugin workspace', () => {
  const { getByRole } = render(
    <HeaderHarness isMobile shouldShowTasksTab shouldShowBrowserTab />,
  );

  const { panel } = openWorkspaceDialog();

  assert.ok(
    getByRole('dialog', { name: 'Workspace views' }),
    'the dialog must be titled from tabs.views so a screen reader announces what opened',
  );

  const entryNames = Array.from(panel.querySelectorAll('button')).map(accessibleName);
  const expectedNames = [...BUILT_IN_NAMES, ...ENABLED_PLUGIN_NAMES];

  assert.deepEqual(
    entryNames,
    expectedNames,
    `the dialog must list every workspace view, plugins included; got ${JSON.stringify(entryNames)}`,
  );

  for (const name of DISABLED_PLUGIN_NAMES) {
    assert.ok(
      !entryNames.includes(name),
      `a disabled plugin must not appear in the dialog: "${name}" appeared among ${JSON.stringify(entryNames)}`,
    );
  }
});

test('choosing a workspace calls setActiveTab once with its id, closes the dialog and returns focus to the trigger', () => {
  const setActiveTab = vi.fn();
  render(<HeaderHarness isMobile shouldShowTasksTab shouldShowBrowserTab onSetActiveTab={setActiveTab} />);

  const { trigger, panel } = openWorkspaceDialog();
  fireEvent.click(within(panel).getByRole('button', { name: 'Files' }));

  const calls = setActiveTab.mock.calls;
  assert.equal(
    calls.length,
    1,
    `selecting one workspace must call setActiveTab exactly once; got ${calls.length} calls ${JSON.stringify(calls)}`,
  );
  assert.equal(calls[0][0], 'files', `setActiveTab must receive the chosen workspace id; got ${JSON.stringify(calls[0])}`);

  assert.equal(
    workspaceDialog(),
    null,
    `choosing a workspace must close the dialog; button names were ${JSON.stringify(buttonNames())}`,
  );
  assert.equal(
    document.activeElement,
    trigger,
    `focus must return to the trigger after choosing; focus was on ${focusedName()}`,
  );
});

test('Escape closes the workspace dialog and returns focus to the trigger', () => {
  render(<HeaderHarness isMobile />);

  const { trigger } = openWorkspaceDialog();
  fireEvent.keyDown(document, { key: 'Escape' });

  assert.equal(workspaceDialog(), null, 'Escape must close the dialog');
  assert.equal(
    document.activeElement,
    trigger,
    `focus must return to the trigger after Escape; focus was on ${focusedName()}`,
  );
});

test('clicking the overlay closes the workspace dialog and returns focus to the trigger', () => {
  render(<HeaderHarness isMobile />);

  const { trigger, panel } = openWorkspaceDialog();
  fireEvent.click(dialogOverlay(panel));

  assert.equal(workspaceDialog(), null, 'clicking the overlay must close the dialog');
  assert.equal(
    document.activeElement,
    trigger,
    `focus must return to the trigger after an overlay click; focus was on ${focusedName()}`,
  );
});

test('desktop keyboard: End moves focus and selection to the last tab, Home returns to the first', () => {
  const { getAllByRole } = render(
    <HeaderHarness isMobile={false} shouldShowTasksTab shouldShowBrowserTab />,
  );

  const tabs = getAllByRole('tab');
  const firstTab = tabs[0];
  const lastTab = tabs[tabs.length - 1];

  firstTab.focus();
  fireEvent.keyDown(firstTab, { key: 'End' });

  assert.equal(
    document.activeElement,
    lastTab,
    `End must move focus to the last tab; focus was on ${focusedName()}`,
  );
  assert.equal(
    lastTab.getAttribute('aria-selected'),
    'true',
    `End must select the last tab; aria-selected values were ${JSON.stringify(tabs.map((tab) => tab.getAttribute('aria-selected')))}`,
  );

  fireEvent.keyDown(lastTab, { key: 'Home' });

  assert.equal(
    document.activeElement,
    firstTab,
    `Home must move focus back to the first tab; focus was on ${focusedName()}`,
  );
  assert.equal(
    firstTab.getAttribute('aria-selected'),
    'true',
    `Home must select the first tab; aria-selected values were ${JSON.stringify(tabs.map((tab) => tab.getAttribute('aria-selected')))}`,
  );
});

// The Quay workspace view is offered from `tabs.quay`. When that key is missing, react-i18next
// renders the key verbatim, which is how the tab shipped showing the literal `tabs.quay`. This
// reads the tab's accessible name (its `aria-label`, which mirrors its visible text) and pins it
// to a real label from the translation table.
test('the Quay tab is labelled from tabs.quay, never the bare literal "tabs.quay"', () => {
  render(
    <WorkspaceTabs
      activeTab="quay"
      setActiveTab={() => {}}
      shouldShowTasksTab={false}
      shouldShowQuayTab
      shouldShowBrowserTab={false}
    />,
  );

  const quayTab = document.querySelector('[data-workspace-tab="quay"]');
  assert.ok(
    quayTab,
    `the Quay tab must render when shouldShowQuayTab is set; tabs rendered were ${JSON.stringify(
      Array.from(document.querySelectorAll('[data-workspace-tab]')).map((el) => el.getAttribute('data-workspace-tab')),
    )}`,
  );

  const label = accessibleName(quayTab);
  // The English bundle must not itself hold the raw key, or the two assertions below would both
  // pass over a tab that still shows the defect.
  assert.notEqual(enCommon.tabs.quay, 'tabs.quay', 'the en bundle must carry a real label for tabs.quay');
  assert.notEqual(
    label,
    'tabs.quay',
    `the Quay tab must not show the raw key; its name was ${JSON.stringify(label)}`,
  );
  assert.equal(
    label,
    enCommon.tabs.quay,
    `the Quay tab must be labelled from tabs.quay; its name was ${JSON.stringify(label)}`,
  );
});

// The header is the only surface that mounts the pulse trigger, so its visibility gate is read
// here: no Quay tab ⇒ no trigger AND no lanes request; a Quay tab ⇒ the trigger at both layouts.
test('shouldShowQuayTab gates the pulse trigger and its lanes read', async () => {
  const noQuay = render(<HeaderHarness isMobile={false} />);
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(
    noQuay.container.querySelector('[data-testid="quay-pulse-trigger"]'),
    null,
    'a project without the Quay tab must not render the pulse trigger',
  );
  assert.equal(apiMock.quayLanes.mock.calls.length, 0, 'a project without the Quay tab must not read lanes');
  noQuay.unmount();

  const desktop = render(<HeaderHarness isMobile={false} shouldShowQuayTab />);
  await act(async () => {
    await Promise.resolve();
  });
  assert.ok(desktop.container.querySelector('[data-testid="quay-pulse-trigger"]'), 'desktop quay trigger');
  assert.ok(apiMock.quayLanes.mock.calls.length > 0, 'the desktop trigger polls lanes');
  desktop.unmount();

  const mobile = render(<HeaderHarness isMobile shouldShowQuayTab />);
  await act(async () => {
    await Promise.resolve();
  });
  assert.ok(mobile.container.querySelector('[data-testid="quay-pulse-trigger"]'), 'mobile quay trigger');
});

// The visible label is a space trade with the pulse strip, so it exists exactly where there is no
// pulse strip: dropping it for a non-quay project took away the only on-screen name of the view
// for no benefit. Both shapes keep the same accessibility and tab contract.
test('the mobile trigger shows the view name unless the quay pulse strip needs the room', () => {
  const withoutQuay = render(<HeaderHarness isMobile />);
  const trigger = collapsedTrigger();
  assert.ok(trigger, `a non-quay project must render the workspace picker; button names were ${JSON.stringify(buttonNames())}`);
  assert.equal(
    (trigger.textContent ?? '').trim(),
    'Chat',
    `a non-quay project must show the active view name; it rendered "${trigger.textContent}"`,
  );
  const label = trigger.querySelector('span.truncate');
  assert.ok(label, `the visible label must be a truncating span; markup was ${trigger.innerHTML.slice(0, 300)}`);
  assert.equal((label.textContent ?? '').trim(), 'Chat');
  assert.ok(
    trigger.className.includes('max-w-[8rem]'),
    `the labelled trigger must cap its width; class was "${trigger.className}"`,
  );
  assert.ok(accessibleName(trigger).includes('Chat'), `the trigger must name the active view; name was "${accessibleName(trigger)}"`);
  assert.equal(trigger.getAttribute('data-workspace-tab'), 'chat');
  assert.equal(trigger.getAttribute('aria-current'), 'true');
  withoutQuay.unmount();

  render(<HeaderHarness isMobile shouldShowQuayTab />);
  const withQuay = collapsedTrigger();
  assert.ok(withQuay, `a quay project must render the workspace picker; button names were ${JSON.stringify(buttonNames())}`);
  assert.equal(
    (withQuay.textContent ?? '').trim(),
    '',
    `a quay project must drop the visible text for the pulse strip; it rendered "${withQuay.textContent}"`,
  );
  assert.ok(accessibleName(withQuay).includes('Chat'), `the text-free picker must still name the view; name was "${accessibleName(withQuay)}"`);
  assert.equal(withQuay.getAttribute('data-workspace-tab'), 'chat');
  assert.equal(withQuay.getAttribute('aria-current'), 'true');
  assert.ok(
    !withQuay.className.includes('max-w-[8rem]'),
    `the text-free trigger takes its own width; class was "${withQuay.className}"`,
  );
});

// With a quay project the mobile row carries TWO dialog-opening controls: the pulse trigger and
// the workspace picker. The picker lost its visible text to make room for the pulse strip, so
// its accessible name and its tab contract are the only things identifying it now.
test('a quay project adds the pulse trigger beside a text-free workspace picker on mobile', () => {
  render(<HeaderHarness isMobile shouldShowQuayTab />);

  const pulse = document.querySelector('[data-testid="quay-pulse-trigger"]');
  assert.ok(pulse, `the quay project must render its pulse trigger; button names were ${JSON.stringify(buttonNames())}`);

  const picker = collapsedTrigger();
  assert.ok(picker, `the workspace picker must still render; button names were ${JSON.stringify(buttonNames())}`);
  assert.equal((picker.textContent ?? '').trim(), '', 'the picker renders icon + chevron, no text');
  assert.ok(
    accessibleName(picker).includes('Chat'),
    `the picker must name the active view; its name was "${accessibleName(picker)}"`,
  );
  assert.equal(picker.getAttribute('data-workspace-tab'), 'chat');
  assert.equal(picker.getAttribute('aria-current'), 'true');
  assert.equal(picker.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(picker.getAttribute('aria-expanded'), 'false');

  fireEvent.click(picker);
  assert.ok(workspaceDialog(), 'the text-free picker must still open the workspace dialog');
  fireEvent.click(within(workspaceDialog() as HTMLElement).getByRole('button', { name: 'Files' }));
  assert.equal(document.querySelector('[aria-current="true"]')?.getAttribute('data-workspace-tab'), 'files');
});

// The label mode is now chosen from the measured room (see `installStripWidthStubs`), not
// from a `matchMedia` breakpoint: the full-label copy is what the header measures, so these
// cases drive the same two readings the component reads.
test('tab tooltip only when the label is hidden', async () => {
  // Full mode: every tab spells its name, so no tab gets a bubble.
  const wide = render(<HeaderHarness isMobile={false} shouldShowTasksTab shouldShowBrowserTab />);
  assert.equal(stripMode(), 'full', 'the unmeasured jsdom header must default to full labels');
  assert.equal(
    document.querySelectorAll('[data-tooltip-container]').length,
    0,
    `a visible label makes the bubble pure duplication; got ${JSON.stringify(buttonNames())}`,
  );
  wide.unmount();

  // Icon mode: only the icon is drawn, so an inactive tab earns a bubble.
  // The ACTIVE tab still spells its own name and must not get one.
  const stubs = installStripWidthStubs({ spacer: 150, room: 250, natural: 900 });
  try {
    render(<HeaderHarness isMobile={false} shouldShowTasksTab shouldShowBrowserTab />);
    assert.equal(stripMode(), 'icon', 'the narrow room must choose icon-only');
    assert.equal(
      document.querySelector('[data-tooltip-container] [data-workspace-tab="chat"]'),
      null,
      'the active tab shows its label and needs no bubble',
    );
    const shellTab = document.querySelector('[data-tooltip-container] [data-workspace-tab="shell"]');
    assert.ok(shellTab instanceof HTMLElement, 'an icon-only tab carries the bubble');
    const bubbleHost = shellTab.closest('[data-tooltip-container]');
    assert.ok(bubbleHost instanceof HTMLElement);
    assert.equal(document.querySelector('[data-tooltip-bubble]'), null, 'nothing is shown before a hover');

    fireEvent.mouseEnter(bubbleHost);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
    assert.equal(document.querySelector('[data-tooltip-bubble]')?.textContent, 'Shell', 'hovering the icon names it');

    fireEvent.click(shellTab);
    assert.equal(document.querySelector('[data-tooltip-bubble]'), null, 'the click that selects the tab closes the bubble');
    assert.equal(
      document.querySelector('[data-tooltip-container] [data-workspace-tab="shell"]'),
      null,
      'the now-active tab draws its own label instead of a bubble',
    );
    assert.ok(
      document.querySelector('[data-tooltip-container] [data-workspace-tab="chat"]'),
      'the tab it replaced is icon-only now and carries the bubble instead',
    );
  } finally {
    stubs.restore();
  }
});
