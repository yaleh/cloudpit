import assert from 'node:assert/strict';

import { cleanup, fireEvent, render, act } from '@testing-library/react';
import i18next from 'i18next';
import type { ReactNode } from 'react';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type {
  Clock,
  CockpitCard as CockpitCardData,
  CockpitCardOption,
  Project,
  ProjectSession,
  SessionHostsSnapshot,
} from '@/shared/types';
import enChat from '@/modules/i18n/locales/en/chat.json';
import enCommon from '@/modules/i18n/locales/en/common.json';
import {
  CockpitColumnContext,
  CockpitOverlayHost,
  createCockpitCardController,
  createCockpitColumnController,
} from '@/modules/cockpit';
import type { CockpitColumnBinding } from '@/modules/cockpit';
import WorkspaceHeader from '@/modules/project-workspace/WorkspaceHeader';

/**
 * The phone workspace header, as the redesign draws it (AC-430):
 *
 *   ☰  [model] Session title           R ▾
 *               Project name  [Quay 64×14]
 *                                      tab ▾   ⋯   ◎
 *
 * The three things that can silently regress are all readings, not intentions: the resident entry
 * must be a ONE-LETTER `R` that says running/stopped with COLOUR (running green, stopped gray, no
 * dot) and still opens the same Resident panel; the Quay thumbnail must sit AFTER the project name
 * at its compact size and open the session popover (its footer button is the way into the Quay
 * view); and the cockpit entry must be the third control in
 * the right-hand row, sized and bordered like the `⋯` beside it, with the provider's open-card
 * count as its badge (0 → faded and no badge, >99 → `99+`) and the phone layer it opens.
 *
 * THE PHONE COCKPIT PIN WAS DELIBERATELY REVERSED (2026-10-29). `cockpit-mobile-header-and-page`
 * decided the phone's cockpit was an independent page reached at `/cockpit?view=cards`; the newer
 * decision — and the user's own, after using both devices — is that the phone gets the PC's
 * "cockpit and conversation coexist" reading as a layer over the live session. The assertion this
 * file used to make ("clicking navigates to `/cockpit?view=cards`") is now "the layer opens AND
 * the session is still there", and the deep-link case below keeps the old page behaviour for a
 * direct `/cockpit?view=cards` (no conversation underfoot), so both decisions stay pinned.
 *
 * The desktop half is the reverse control: the same session must still show the `● Resident` pill
 * under the project name and the full-size pulse in the right-hand row — the phone change is a
 * branch, not a replacement of the header both surfaces share.
 *
 * Everything outside the header's own decisions is stubbed at its seam: the resident hosts poll
 * (one host listing per case, running or not), the pulse lanes hook (a successful empty reading),
 * the plugins store (no plugin tabs), and the cockpit's card transport (N synthetic cards). The
 * two cockpit controllers, the badge, the pulse trigger, the header and its title are the shipped
 * code, so the test exercises the composition rather than a second copy of it.
 */

const SESSION_ID = 'session-mobile-header';
const NOW = Date.parse('2026-10-27T00:10:00.000Z');

const SESSION: ProjectSession = { id: SESSION_ID, summary: 'Investigate the mobile header' };
const PROJECT: Project = {
  projectId: 'mobile-header-probe',
  displayName: '移动端 header 探针项目',
  fullPath: '/home/odoo/workspace/mobile-header-probe',
};

/** A host listing holding this session as resident, with a live process or without one. */
function hostListing(running: boolean): SessionHostsSnapshot {
  return {
    hosts: running
      ? [
          {
            hostId: 'host-mobile-header',
            provider: 'claude',
            mode: 'resident',
            state: 'idle',
            pid: 4242,
            startedAt: NOW,
            closeReason: null,
            closeDetail: null,
            bindings: [
              {
                appSessionId: SESSION_ID,
                providerSessionId: 'provider-mobile-header',
                state: 'idle',
                leases: [],
                lastActivityAt: NOW,
                peerName: 'resident@host',
              },
            ],
          },
        ]
      : [],
    sessions: [
      {
        appSessionId: SESSION_ID,
        provider: 'claude',
        lifecycleMode: 'resident',
        running,
        reason: null,
      },
    ],
  } as unknown as SessionHostsSnapshot;
}

// The hosts poll is replaced, helpers stay real: `findSessionHost`/`readResidentProcessState`
// are exactly what the badge derives its colour from, so stubbing them would stub the assertion.
const hostsMock = vi.hoisted(() => ({ snapshot: null as SessionHostsSnapshot | null }));
vi.mock('@/shared/hooks/useSessionHosts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useSessionHosts: () => ({
      snapshot: hostsMock.snapshot,
      error: null,
      loading: false,
      refresh: async () => {},
      start: async () => {},
      close: async () => {},
      forceClose: async () => {},
    }),
  };
});

// The pulse trigger polls the lanes endpoint; these cases are about its placement and shape.
// The popover's own one-shot reads are stubbed at the same seam: pressing the thumbnail now opens
// the popover on the phone too, so those hooks must exist for the dialog to render.
vi.mock('@/modules/quay/hooks/useSessionPulse', () => ({
  useSessionPulse: () => ({ gantt: null, loading: false, unavailable: false }),
  useSessionPulseWindow: () => ({ windowHours: 6, setWindowHours: () => {} }),
  useSessionMentions: () => ({ status: 'idle' }),
  useSessionSnapshot: () => ({ status: 'idle' }),
}));

vi.mock('@/modules/plugins', () => ({
  usePlugins: () => ({
    plugins: [],
    loading: false,
    pluginsError: null,
    refreshPlugins: async () => {},
    installPlugin: async () => ({ success: true }),
    uninstallPlugin: async () => ({ success: true }),
    updatePlugin: async () => ({ success: true }),
    togglePlugin: async () => ({ success: true, error: null }),
  }),
  PluginIcon: () => null,
}));

// The layer is drawn only while the cockpit switch is on; this suite is about the header's
// composition, so the boot-static reading is armed rather than fetched.
vi.mock('@/shared/hooks/useServerFeatures', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useServerFeatures: () => ({ status: 'loaded', cockpitEnabled: true }),
  };
});

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'chat'],
  defaultNS: 'common',
  resources: { en: { common: enCommon, chat: enChat } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
Element.prototype.scrollIntoView = () => {};

afterEach(() => {
  cleanup();
  hostsMock.snapshot = null;
});

const FAKE_CLOCK: Clock = {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 2,
  clearInterval: () => undefined,
  now: () => NOW,
};

function option(id: string): CockpitCardOption {
  return {
    id,
    label: id,
    does: `${id} does something`,
    suggested: id === 'one',
    source: 'provider',
    action: { executor: 'test.exec', params: { optionId: id } },
  };
}

function card(index: number): CockpitCardData {
  const id = `card-${index}`;
  return {
    id,
    provider: 'test',
    revision: 1,
    kind: 'ask',
    group: 'test',
    rank: index,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: `cloudcli://test/${id}`, project: 'p1' },
    facts: [],
    options: [option('one'), option('two')],
  };
}

/**
 * The production binding's shape: a real card controller holding `openCount` cards, a real column
 * controller reading a phone-width workspace, and the value the header's context consumes.
 *
 * At a 390 px workspace the column's own layout is `hidden` — which is exactly why the phone
 * entry is the `page` variant: it survives a layout in which the PC column does not exist.
 */
async function columnBinding(openCount: number, workspaceWidth = 390): Promise<CockpitColumnBinding> {
  const cards = createCockpitCardController({
    fetchCards: async () => Array.from({ length: openCount }, (_unused, index) => card(index + 1)),
    confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
    clock: FAKE_CLOCK,
    refreshIntervalMs: 0,
  });
  await cards.load();
  const column = createCockpitColumnController({
    cards,
    readWorkspaceWidth: () => workspaceWidth,
    storage: null,
  });
  column.start();
  return {
    snapshot: column.getSnapshot(),
    controller: column,
    cards: { snapshot: cards.getSnapshot(), controller: cards },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

/**
 * The header, on a real session route, with the cockpit layer's host mounted exactly as `App`
 * mounts it (a sibling of the routes, so opening the layer does not change the route match).
 *
 * The session route also draws a marker: a criterion that says "the session is still there"
 * reads a fact about the mounted conversation, not about the header alone.
 */
function Header({
  binding,
  isMobile,
  children,
}: {
  binding: CockpitColumnBinding;
  isMobile: boolean;
  children?: ReactNode;
}) {
  return (
    <MemoryRouter initialEntries={[`/session/${SESSION_ID}`]}>
      <CockpitColumnContext.Provider value={binding}>
        <Routes>
          <Route
            path="/session/:sessionId"
            element={
              <>
                <WorkspaceHeader
                  activeTab="chat"
                  setActiveTab={() => {}}
                  selectedProject={PROJECT}
                  selectedSession={SESSION}
                  shouldShowTasksTab={false}
                  shouldShowQuayTab
                  shouldShowBrowserTab={false}
                  isMobile={isMobile}
                  onMenuClick={() => {}}
                />
                <div data-testid="session-marker" />
              </>
            }
          />
          {/* The standalone cockpit page, as `App` mounts it at `/cockpit`. */}
          <Route path="/cockpit" element={<div data-testid="standalone-cockpit" />} />
        </Routes>
        <CockpitOverlayHost binding={binding.cards} />
        {children}
        <LocationProbe />
      </CockpitColumnContext.Provider>
    </MemoryRouter>
  );
}

const headerElement = (): HTMLElement => {
  const header = document.querySelector<HTMLElement>('header[data-app-header]');
  assert.ok(header, 'the workspace header must render');
  return header;
};

/** An element must precede another in document order. */
const precedes = (first: Element, second: Element): boolean =>
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const letterBadge = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-resident-badge-variant="letter"]');

const projectNameElement = (): HTMLElement => {
  const name = Array.from(document.querySelectorAll<HTMLElement>('div')).find(
    (element) => element.children.length === 0 && element.textContent === PROJECT.displayName,
  );
  assert.ok(name, `the header must draw the project name "${PROJECT.displayName}"`);
  return name;
};

const leftButton = (row: HTMLElement): HTMLElement => {
  // The workspace picker is the trigger that owns the dialog; identifying it by that contract
  // avoids mistaking the Quay trigger (also `aria-haspopup`) for it.
  const picker = row.querySelector<HTMLElement>('[data-workspace-tab][aria-haspopup="dialog"]');
  assert.ok(picker, 'the phone action row must carry the workspace tab dropdown first');
  return picker;
};

beforeEach(() => {
  hostsMock.snapshot = hostListing(true);
});

test('phone: the resident entry is a one-letter R after the title, green while the process runs', async () => {
  const binding = await columnBinding(1);
  render(<Header binding={binding} isMobile />);

  const badge = letterBadge();
  assert.ok(badge, 'the phone header must draw the letter variant after the title');
  assert.equal(badge.textContent?.trim(), 'R', 'the trigger is exactly the one letter R');
  assert.equal(
    badge.querySelectorAll('svg').length,
    1,
    'the letter R keeps its disclosure chevron',
  );
  assert.equal(
    badge.querySelector('[data-resident-badge-dot]'),
    null,
    'the letter variant must not draw the state dot — its colour is the reading',
  );

  // Placement: the heading first, then R, in the same row.
  const heading = document.querySelector('h2');
  assert.ok(heading, 'the session title must render');
  assert.ok(precedes(heading, badge), 'R must sit AFTER the session title');
  assert.equal(badge.parentElement, heading.parentElement, 'R must share the title row');

  // Running is GREEN (border, text and a light green fill), not merely "different from stopped".
  assert.equal(badge.getAttribute('data-resident-badge'), 'running');
  assert.ok(badge.classList.contains('border-emerald-500/50'), `running border; class was ${badge.className}`);
  assert.ok(badge.classList.contains('text-emerald-600'), `running text; class was ${badge.className}`);
  assert.ok(badge.classList.contains('bg-emerald-500/10'), `running fill; class was ${badge.className}`);

  // It is still the door to the Resident details.
  fireEvent.click(badge);
  assert.ok(
    document.querySelector('[data-resident-badge-panel]'),
    'pressing R must open the existing Resident details panel',
  );
});

test('phone: the same R is gray when the process is not running', async () => {
  hostsMock.snapshot = hostListing(false);
  const binding = await columnBinding(1);
  render(<Header binding={binding} isMobile />);

  const badge = letterBadge();
  assert.ok(badge, 'a resident session with no live process still shows its entry');
  assert.equal(badge.getAttribute('data-resident-badge'), 'stopped');
  assert.ok(badge.classList.contains('text-muted-foreground'), `stopped text; class was ${badge.className}`);
  assert.ok(badge.classList.contains('border-border/60'), `stopped border; class was ${badge.className}`);
  assert.ok(
    !badge.className.includes('emerald'),
    `a stopped process must not borrow the running green; class was ${badge.className}`,
  );
  assert.equal(badge.querySelector('[data-resident-badge-dot]'), null);
});

test('phone: the Quay in-flight thumbnail follows the project name at 64×14', async () => {
  const binding = await columnBinding(1);
  render(<Header binding={binding} isMobile />);

  const trigger = document.querySelector<HTMLElement>('[data-testid="quay-pulse-trigger"]');
  assert.ok(trigger, 'the phone header must draw the Quay thumbnail');
  assert.equal(trigger.getAttribute('data-variant'), 'compact', 'the phone shape is the compact one');
  assert.equal(trigger.style.width, '64px');
  assert.equal(trigger.style.height, '14px');

  const name = projectNameElement();
  assert.ok(precedes(name, trigger), 'the thumbnail must sit AFTER the project name');
  assert.equal(trigger.parentElement, name.parentElement, 'both must share the project-name line');
  assert.ok(
    headerElement().children[0].contains(trigger),
    'the thumbnail belongs to the title block, not the right-hand action row',
  );
});

test('phone: pressing the Quay thumbnail opens the popover below the header, and closing returns focus', async () => {
  const binding = await columnBinding(1);
  render(<Header binding={binding} isMobile />);

  const trigger = document.querySelector<HTMLElement>('[data-testid="quay-pulse-trigger"]');
  assert.ok(trigger, 'the phone header must draw the Quay thumbnail');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog', 'the thumbnail opens a dialog on the phone');

  // The popover's geometry comes from the header's live rect, which jsdom leaves at zero.
  const HEADER_BOTTOM = 56;
  headerElement().getBoundingClientRect = () => ({
    x: 0, y: 0, width: 390, height: HEADER_BOTTOM, top: 0, right: 390,
    bottom: HEADER_BOTTOM, left: 0, toJSON: () => ({}),
  }) as DOMRect;

  fireEvent.click(trigger);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  const panel = document.querySelector<HTMLElement>('[data-testid="quay-pulse-popover"]');
  assert.ok(panel, 'pressing the compact thumbnail must open the popover');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.ok(
    parseFloat(panel.style.top) >= HEADER_BOTTOM,
    `the popover must sit below the header's bottom: top=${panel.style.top}, bottom=${HEADER_BOTTOM}`,
  );

  // Closing returns focus to the thumbnail, exactly as the desktop shape does.
  fireEvent.mouseDown(document.body);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  assert.equal(document.querySelector('[data-testid="quay-pulse-popover"]'), null, 'an outside press closes it');
  assert.equal(document.activeElement, trigger, 'focus returns to the thumbnail');
});

test('phone: the right-hand row is tab ▾, ⋯, cockpit — the cockpit in the menu’s own box', async () => {
  const binding = await columnBinding(1);
  render(<Header binding={binding} isMobile />);

  const row = headerElement().children[1] as HTMLElement;
  assert.equal(headerElement().children.length, 2, 'the phone header stays title block + action row');

  const picker = leftButton(row);
  const menu = row.querySelector<HTMLElement>('[data-workspace-menu-trigger]');
  const cockpit = row.querySelector<HTMLElement>('[data-testid="cockpit-header-button"]');
  assert.ok(menu, 'the row must carry the ⋯ menu');
  assert.ok(cockpit, 'the row must carry the cockpit entry');

  assert.ok(precedes(picker, menu), 'the tab dropdown comes before ⋯');
  assert.ok(precedes(menu, cockpit), 'the cockpit entry comes after ⋯');

  // Same box and same border as the menu beside it, so it reads as the same class of control.
  for (const token of ['h-8', 'w-8', 'rounded-lg', 'border', 'border-border/50']) {
    assert.ok(cockpit.classList.contains(token), `cockpit button must carry "${token}"; class was ${cockpit.className}`);
    assert.ok(menu.classList.contains(token), `the ⋯ menu carries "${token}" too; class was ${menu.className}`);
  }
});

test('phone: the cockpit badge reads 0 (faded, no badge), 7, and 120 as 99+', async () => {
  const zero = await columnBinding(0);
  render(<Header binding={zero} isMobile />);
  let button = document.querySelector<HTMLElement>('[data-testid="cockpit-header-button"]');
  assert.ok(button);
  assert.equal(document.querySelector('[data-testid="cockpit-header-badge"]'), null, 'zero draws no badge');
  assert.ok(button.classList.contains('opacity-60'), 'zero recedes, it does not shout "0"');
  cleanup();

  const seven = await columnBinding(7);
  render(<Header binding={seven} isMobile />);
  const sevenBadge = document.querySelector('[data-testid="cockpit-header-badge"]');
  assert.ok(sevenBadge, 'seven open cards draw a badge');
  assert.equal(sevenBadge.textContent, '7');
  button = document.querySelector<HTMLElement>('[data-testid="cockpit-header-button"]');
  assert.ok(button);
  assert.ok(!button.classList.contains('opacity-60'), 'a non-zero count is not faded');
  cleanup();

  const many = await columnBinding(120);
  render(<Header binding={many} isMobile />);
  const manyBadge = document.querySelector('[data-testid="cockpit-header-badge"]');
  assert.ok(manyBadge, 'a three-digit count still draws a badge');
  assert.equal(manyBadge.textContent, '99+', 'above 99 the badge caps its text');
});

test('phone: the cockpit entry opens the cards layer and the conversation underneath survives', async () => {
  const binding = await columnBinding(3);
  render(<Header binding={binding} isMobile />);

  assert.ok(document.querySelector('[data-testid="session-marker"]'), 'the session starts mounted');

  const button = document.querySelector<HTMLElement>('[data-testid="cockpit-header-button"]');
  assert.ok(button);
  fireEvent.click(button);

  // This is the assertion that replaced `cockpit-mobile-header-and-page`'s old pin (the entry
  // used to navigate to `/cockpit?view=cards`). The phone now gets the PC reading: cards ON the
  // conversation, which stays mounted underneath.
  const overlay = document.querySelector<HTMLElement>('[data-testid="cockpit-overlay"]');
  assert.ok(overlay, 'the phone cockpit entry opens the cards layer');
  assert.ok(
    document.querySelector('[data-testid="cockpit-card-list"]'),
    'the layer draws the cards content',
  );
  assert.ok(
    document.querySelectorAll('[data-cockpit-card-id]').length > 0,
    'the settled cards are visible inside the layer',
  );
  assert.ok(
    document.querySelector('[data-testid="session-marker"]'),
    'the conversation stays mounted under the layer',
  );

  const title = document.querySelector<HTMLElement>('[data-testid="cockpit-overlay-title"]');
  assert.ok(title, 'the layer names the conversation it covers');
  assert.ok(
    title.textContent?.includes(SESSION.summary!),
    `the layer title contains the session title; read "${title.textContent}"`,
  );

  assert.equal(
    document.querySelector('[data-testid="location"]')?.textContent,
    `/session/${SESSION_ID}`,
    'the layer is a history entry on the session address, not a navigation away from it',
  );
});

test('phone: a direct /cockpit?view=cards deep link is the standalone page, with no back bar', async () => {
  const previousWidth = window.innerWidth;
  window.innerWidth = 390;
  try {
    const binding = await columnBinding(1);
    render(
      <MemoryRouter initialEntries={['/cockpit?view=cards']}>
        <CockpitColumnContext.Provider value={binding}>
          <Routes>
            <Route path="/session/:sessionId" element={<div data-testid="session-marker" />} />
            <Route path="/cockpit" element={<div data-testid="standalone-cockpit" />} />
          </Routes>
          <CockpitOverlayHost binding={binding.cards} />
          <LocationProbe />
        </CockpitColumnContext.Provider>
      </MemoryRouter>,
    );

    assert.ok(
      document.querySelector('[data-testid="standalone-cockpit"]'),
      'the deep link renders the cockpit page itself',
    );
    assert.equal(
      document.querySelector('[data-testid="cockpit-overlay"]'),
      null,
      'with no conversation underfoot there is no layer',
    );
    assert.equal(
      document.querySelector('[data-testid="cockpit-overlay-close"]'),
      null,
      'and therefore no back bar',
    );
    assert.equal(
      document.querySelector('[data-testid="location"]')?.textContent,
      '/cockpit?view=cards',
      'the deep link keeps its own address',
    );
  } finally {
    window.innerWidth = previousWidth;
  }
});

test('desktop: the resident pill stays under the project name and the pulse stays full-size', async () => {
  // 1440 px: the column exists, so the default (column) cockpit entry draws as it always did.
  const binding = await columnBinding(3, 1440);
  render(<Header binding={binding} isMobile={false} />);

  assert.equal(letterBadge(), null, 'desktop must not replace its pill with the phone letter');

  const pill = document.querySelector<HTMLElement>('[data-resident-badge-variant="pill"]');
  assert.ok(pill, 'desktop keeps the Resident pill');
  assert.equal(pill.getAttribute('data-resident-badge'), 'running');
  assert.ok(
    pill.querySelector('[data-resident-badge-dot]'),
    'the desktop pill keeps its state dot',
  );
  assert.ok(precedes(projectNameElement(), pill), 'the pill sits after the project name');

  const trigger = document.querySelector<HTMLElement>('[data-testid="quay-pulse-trigger"]');
  assert.ok(trigger, 'desktop keeps the pulse trigger');
  assert.notEqual(trigger.getAttribute('data-variant'), 'compact', 'desktop keeps the full-size pulse');

  // The desktop cockpit entry is still the column toggle it always was.
  const button = document.querySelector<HTMLElement>('[data-testid="cockpit-header-button"]');
  assert.ok(button, 'desktop keeps the column entry point');
  assert.ok(button.classList.contains('h-8'));
});
