import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { QuayFleetSummary, QuaySnapshot } from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitPage from '@/modules/cockpit/CockpitPage';

/**
 * THE PHONE'S CARDS PAGE IS ITS OWN SHELL.
 *
 * Below the mobile breakpoint, `view=cards` draws the header, the card list (with its filter
 * chips) and the input — and nothing else. The deploy strip, the project strip and the Focus row
 * are the wall/fleet/board navigation chrome: on a phone they filled the first screen and pushed
 * the filters below the fold, which is the defect this file guards. The controls in this file are
 * the OTHER two legs: the same cards view on a desktop width still draws the chrome, and the
 * wall still draws it on a phone. Without those, a page that simply stopped rendering the chrome
 * everywhere would pass the first case.
 *
 * The page is the shipped component; only its two transports (the hub socket and the HTTP api)
 * are doubled, the same way `CockpitDeepLink.test.tsx` doubles them.
 */

const hubMock = vi.hoisted(() => {
  const state = {
    rev: 0,
    view: { type: 'fleet' as const },
    viewStack: [] as unknown[],
    focusUri: null,
    tray: [] as string[],
    history: [] as string[],
    visible: { viewUri: null, focusables: [], projects: [] },
    pendingSend: null,
    lastEventSource: null,
  };
  const listeners = new Set<(event: unknown) => void>();
  const socket = {
    isConnected: true,
    sendMessage() {
      // The page only reads hub state here; nothing this suite sends needs to change the view.
    },
    subscribe(listener: (event: unknown) => void) {
      listeners.add(listener);
      listener({ kind: 'cockpit.state', state: JSON.parse(JSON.stringify(state)) });
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    socket,
    reset() {
      listeners.clear();
      socket.isConnected = true;
    },
  };
});

vi.mock('@/shared/context/WebSocketContext', () => ({
  useWebSocketOptional: () => hubMock.socket,
  useWebSocket: () => hubMock.socket,
}));

const apiMock = vi.hoisted(() => ({
  quayFleetSummary: vi.fn(),
  quaySnapshot: vi.fn(),
  observationFetch: vi.fn(),
  cockpitCards: vi.fn(),
  system: { deployReadiness: vi.fn() },
}));

vi.mock('@/shared/api', () => ({
  api: apiMock,
  authenticatedFetch: apiMock.observationFetch,
}));

const FLEET: QuayFleetSummary = {
  projects: [
    {
      projectId: 'p1',
      fleetProjectId: 'claudecodeui',
      projectPath: '/work/claudecodeui',
      driver: { state: 'running' },
      tasks: { total: 1, todo: 0, ready: 1, needsHuman: 0, done: 0 },
      cached: false,
      error: null,
    },
  ],
  generatedAt: '2026-10-24T00:00:00.000Z',
  ttlPerProjectMs: 30000,
  cached: false,
};

const SNAPSHOT: QuaySnapshot = {
  projectId: 'p1',
  projectPath: '/work/claudecodeui',
  fleetProjectId: 'claudecodeui',
  generatedAt: '2026-10-24T00:00:00.000Z',
  cached: false,
  driver: { state: 'idle', alive: true, running: false, lastRecordAt: null },
  tasks: {
    total: 0,
    byStatus: { ready: 0 },
    ready: 0,
    needsHuman: 0,
    done: 0,
    recent: [],
  },
  goals: { total: 0, achieved: 0, breakdown: { byStatus: {}, recent: [] } },
  adrs: { total: 0, recent: [] },
  configIssues: { total: 0, errors: 0 },
  tests: { current: null, recentRounds: [] },
  fanIn: { recent: [] },
  inFlight: [],
  dashboardUrl: null,
  warnings: [],
};

/** A fresh deployment reading, so the strip has something to draw instead of rendering null. */
const DEPLOY_READING = {
  status: 'fresh',
  runningSha: 'abc1234',
  builtSha: 'abc1234',
  clientBuiltSha: 'abc1234',
  headSha: 'abc1234',
  buildSkew: false,
  pendingCommits: [],
  lastDeploy: null,
  failure: null,
  checkedAt: '2026-10-24T00:00:00.000Z',
};

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

function renderCockpit(initialPath: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialPath]}>
        <CockpitPage />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

/** Sets the window width the way a phone reports it; returns the undo for `afterEach`. */
function setViewportWidth(width: number): () => void {
  const original = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
  return () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: original,
    });
  };
}

let restoreViewport: (() => void) | null = null;

beforeEach(() => {
  hubMock.reset();
  apiMock.quayFleetSummary.mockReset();
  apiMock.quaySnapshot.mockReset();
  apiMock.observationFetch.mockReset();
  apiMock.cockpitCards.mockReset();
  apiMock.system.deployReadiness.mockReset();

  apiMock.quayFleetSummary.mockResolvedValue(okResponse(FLEET));
  apiMock.quaySnapshot.mockResolvedValue(okResponse(SNAPSHOT));
  apiMock.observationFetch.mockResolvedValue(
    okResponse({ entries: [], collapsedCount: 0, producers: [], self: null }),
  );
  apiMock.cockpitCards.mockResolvedValue(okResponse({ cards: [] }));
  apiMock.system.deployReadiness.mockResolvedValue(okResponse(DEPLOY_READING));
});

afterEach(() => {
  restoreViewport?.();
  restoreViewport = null;
});

describe('the phone cards page', () => {
  it('draws the card shell and the filter chips, without the deploy strip, project strip or Focus row', () => {
    restoreViewport = setViewportWidth(390);
    renderCockpit('/cockpit?view=cards');

    expect(screen.getByTestId('cockpit-page').getAttribute('data-cockpit-view')).toBe('cards');

    // The three pieces of navigation chrome this task removes on a phone.
    expect(screen.queryByTestId('deploy-readiness')).toBeNull();
    expect(screen.queryByTestId('cockpit-project-strip')).toBeNull();
    expect(screen.queryByTestId('cockpit-focus')).toBeNull();

    // What the phone's cards page DOES draw: the chips, the list and the input box.
    expect(screen.getByTestId('cockpit-card-filter-types')).toBeTruthy();
    expect(screen.getByTestId('cockpit-card-filter-project')).toBeTruthy();
    expect(screen.getByTestId('cockpit-card-list')).toBeTruthy();
    expect(screen.getByTestId('cockpit-input')).toBeTruthy();
    expect(screen.getByTestId('cockpit-input-scope-note')).toBeTruthy();
  });

  it('still draws the deploy strip, the project strip and the Focus row on a desktop width', async () => {
    restoreViewport = setViewportWidth(1440);
    renderCockpit('/cockpit?view=cards');

    // The strip draws nothing until its first read answers; the read is mocked above.
    await screen.findByTestId('deploy-readiness');
    expect(screen.getByTestId('cockpit-project-strip')).toBeTruthy();
    expect(screen.getByTestId('cockpit-focus')).toBeTruthy();
  });
});

describe('the wall on a phone', () => {
  it('keeps all three, so the removal is the cards view’s, not the phone’s', async () => {
    restoreViewport = setViewportWidth(390);
    renderCockpit('/cockpit?view=wall');

    expect(screen.getByTestId('cockpit-page').getAttribute('data-cockpit-view')).toBe('wall');
    await waitFor(() => expect(screen.getByTestId('deploy-readiness')).toBeTruthy());
    expect(screen.getByTestId('cockpit-project-strip')).toBeTruthy();
    expect(screen.getByTestId('cockpit-focus')).toBeTruthy();
  });
});
