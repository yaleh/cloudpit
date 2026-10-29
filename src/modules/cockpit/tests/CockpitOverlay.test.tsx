import assert from 'node:assert/strict';

import { cleanup, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { useState } from 'react';
import { initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, test, vi } from 'vitest';

import type {
  Clock,
  CockpitCard as CockpitCardData,
  CockpitCardOption,
} from '@/shared/types';
import enCommon from '@/modules/i18n/locales/en/common.json';
import {
  CockpitColumnContext,
  CockpitOverlayHost,
  createCockpitCardController,
  createCockpitColumnController,
} from '@/modules/cockpit';
import type { CockpitColumnBinding } from '@/modules/cockpit';
import CockpitHeaderButton from '@/modules/cockpit/CockpitHeaderButton';

/**
 * The phone's cockpit layer: opening it must not unmount the conversation it covers.
 *
 * THE READING IS THE ONE THAT MATTERS. A layer that renders the same cards but re-mounts the
 * workspace would look identical for one frame and still lose the composer draft and the
 * transcript's scroll position. The session fixture therefore carries a mount-stamped instance:
 * opening the layer and closing it again must leave the SAME instance (§1), while the address
 * stays `/session/<id>` throughout. The card list is the shipped list drawn from a settled
 * controller, so the layer's content is the product's own (`variant=page`).
 *
 * WHY THE `variant="page"` BUTTON IS DRIVEN DIRECTLY. That is the control the phone header draws
 * (`WorkspaceHeader`'s `isMobile` row); the header's own composition is the subject of
 * `mobileHeaderCockpitEntry.test.tsx`. This criterion is about what the entry does to the
 * conversation underneath, so the window is pinned to a phone width and the rest is the shipped
 * router wiring (`CockpitOverlayHost` mounted as a sibling of the routes, exactly as `App` does).
 */

const SESSION_ID = 'session-phone-overlay';
const SESSION_TITLE = 'Investigate the phone cockpit layer';
const NOW = Date.parse('2026-10-29T00:10:00.000Z');

/** The switch is boot-static; the layer is only drawn when the cockpit is on. */
vi.mock('@/shared/hooks/useServerFeatures', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useServerFeatures: () => ({ status: 'loaded', cockpitEnabled: true }),
  };
});

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    ns: ['common'],
    defaultNS: 'common',
    resources: { en: { common: enCommon } },
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
});

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
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
  const id = `overlay-card-${index}`;
  return {
    id,
    provider: 'test',
    revision: 1,
    kind: 'ask',
    group: 'test',
    rank: index,
    state: 'open',
    waitingSince: '2026-10-29T00:00:00.000Z',
    surfacedAt: '2026-10-29T00:00:01.000Z',
    subject: { uri: `cloudcli://test/${id}`, project: 'p1' },
    facts: [],
    options: [option('one'), option('two')],
  };
}

/**
 * The production binding's shape at phone width: a real card controller holding one open card and
 * a real column controller reading a `hidden` (phone) workspace. The header reads the count from
 * it; the layer draws the same settled cards through `binding.cards`.
 */
async function columnBinding(): Promise<CockpitColumnBinding> {
  const cards = createCockpitCardController({
    fetchCards: async () => [card(1)],
    confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
    clock: FAKE_CLOCK,
    refreshIntervalMs: 0,
  });
  await cards.load();
  const column = createCockpitColumnController({
    cards,
    readWorkspaceWidth: () => 390,
    storage: null,
  });
  column.start();
  return {
    snapshot: column.getSnapshot(),
    controller: column,
    cards: { snapshot: cards.getSnapshot(), controller: cards },
  };
}

/** How many times the conversation component has mounted; a normal render bumps it once. */
const mountLedger = { mounts: 0 };

/**
 * A mounted conversation with a stable instance stamp. `data-instance` is assigned in a state
 * initializer, which React runs exactly once per mount — so a re-mount (the failure the criterion
 * is about) changes the reading even though the DOM looks the same.
 */
function SessionArea() {
  const [instance] = useState(() => {
    mountLedger.mounts += 1;
    return mountLedger.mounts;
  });
  return (
    <div data-testid="session-area" data-instance={instance}>
      <CockpitHeaderButton variant="page" sessionTitle={SESSION_TITLE} />
    </div>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderSessionPage(binding: CockpitColumnBinding) {
  return render(
    <MemoryRouter initialEntries={[`/session/${SESSION_ID}`]}>
      <CockpitColumnContext.Provider value={binding}>
        <Routes>
          <Route path="/session/:sessionId" element={<SessionArea />} />
        </Routes>
        <CockpitOverlayHost binding={binding.cards} />
        <LocationProbe />
      </CockpitColumnContext.Provider>
    </MemoryRouter>,
  );
}

test('phone: the cockpit entry draws the cards layer and the conversation underneath stays mounted', async () => {
  mountLedger.mounts = 0;
  window.innerWidth = 390;
  const binding = await columnBinding();
  renderSessionPage(binding);

  const sessionArea = document.querySelector<HTMLElement>('[data-testid="session-area"]');
  assert.ok(sessionArea, 'the conversation renders before the layer is opened');
  const instanceBefore = sessionArea.getAttribute('data-instance');
  assert.equal(mountLedger.mounts, 1, 'the conversation mounted once');

  const button = document.querySelector<HTMLElement>('[data-testid="cockpit-header-button"]');
  assert.ok(button, 'the phone header draws the cockpit entry');
  fireEvent.click(button);

  const overlay = document.querySelector<HTMLElement>('[data-testid="cockpit-overlay"]');
  assert.ok(overlay, 'pressing the cockpit entry opens the layer');
  assert.ok(
    document.querySelector('[data-testid="cockpit-overlay-close"]'),
    'the layer carries its way back',
  );

  // The title names the conversation the person will land on.
  const title = document.querySelector<HTMLElement>('[data-testid="cockpit-overlay-title"]');
  assert.ok(title, 'the back bar draws the session title');
  assert.ok(
    title.textContent?.includes(SESSION_TITLE),
    `the layer title must contain the session title; read "${title.textContent}"`,
  );

  // The cards are the shipped card list, in the page variant the standalone cards page uses.
  const list = document.querySelector<HTMLElement>('[data-testid="cockpit-card-list"]');
  assert.ok(list, 'the layer draws the cards');
  assert.equal(list.getAttribute('data-cockpit-card-list-variant'), 'page');
  assert.ok(
    list.querySelector('[data-cockpit-card-id]'),
    'the settled card is visible inside the layer',
  );

  // THE POINT: the conversation did not unmount or rebuild underneath the layer.
  const sessionAreaWhileOpen = document.querySelector<HTMLElement>('[data-testid="session-area"]');
  assert.ok(sessionAreaWhileOpen, 'the conversation stays in the DOM under the layer');
  assert.equal(
    sessionAreaWhileOpen.getAttribute('data-instance'),
    instanceBefore,
    'the conversation is the SAME instance under the layer',
  );
  assert.equal(mountLedger.mounts, 1, 'the conversation mounted once, not twice');
  assert.equal(
    document.querySelector('[data-testid="location"]')?.textContent,
    `/session/${SESSION_ID}`,
    'the layer is one history entry on the session address',
  );

  fireEvent.click(document.querySelector<HTMLElement>('[data-testid="cockpit-overlay-close"]')!);

  assert.equal(document.querySelector('[data-testid="cockpit-overlay"]'), null, 'closing removes the layer');
  const sessionAreaAfter = document.querySelector<HTMLElement>('[data-testid="session-area"]');
  assert.ok(sessionAreaAfter, 'the conversation is back on screen');
  assert.equal(
    sessionAreaAfter.getAttribute('data-instance'),
    instanceBefore,
    'closing does not re-create the conversation either',
  );
  assert.equal(mountLedger.mounts, 1, 'the conversation never re-mounted');
  assert.equal(
    document.querySelector('[data-testid="location"]')?.textContent,
    `/session/${SESSION_ID}`,
    'closing returns to the session address',
  );
});
