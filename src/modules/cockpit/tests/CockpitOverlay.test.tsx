import assert from 'node:assert/strict';

import { cleanup, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { initReactI18next } from 'react-i18next';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
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
import type { CockpitCardsBinding, CockpitColumnBinding } from '@/modules/cockpit';
import CockpitHeaderButton from '@/modules/cockpit/workspace/CockpitHeaderButton';

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

function card(index: number, overrides: Partial<CockpitCardData> = {}): CockpitCardData {
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
    ...overrides,
  };
}

/**
 * The production binding's shape at phone width: a real card controller holding one open card and
 * a real column controller reading a `hidden` (phone) workspace. The header reads the count from
 * it; the layer draws the same settled cards through `binding.cards`.
 */
async function columnBinding(
  settled: readonly CockpitCardData[] = [card(1)],
): Promise<CockpitColumnBinding> {
  const cards = createCockpitCardController({
    fetchCards: async () => ({ cards: settled }),
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
  const { sessionId } = useParams<{ sessionId: string }>();
  const [instance] = useState(() => {
    mountLedger.mounts += 1;
    return mountLedger.mounts;
  });
  return (
    <div data-testid="session-area" data-instance={instance} data-session-id={sessionId}>
      <CockpitHeaderButton variant="page" sessionTitle={SESSION_TITLE} />
      {/* The conversation's own transient state: the route must keep this very node (and its
          draft/scroll) across a card-opened session B and the Back that returns to A. */}
      <div data-testid="session-transcript" style={{ overflowY: 'auto' }}>
        transcript
      </div>
      <textarea data-testid="session-draft" defaultValue="" />
    </div>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

/** The browser's Back, as a press a MemoryRouter can perform. */
function HistoryControl() {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="browser-back" onClick={() => navigate(-1)}>
      back
    </button>
  );
}

/**
 * The production provider's shape: it re-reads the controller through `useSyncExternalStore`, so
 * a command the list issues (filter, select, scroll) repaints the shipped UI. A static binding
 * object would leave the DOM on its first snapshot while the controller moved underneath — the
 * test would then assert a reading no person could see.
 */
function LiveColumnContext({
  binding,
  children,
}: {
  binding: CockpitColumnBinding;
  children: ReactNode;
}) {
  const columnSnapshot = useSyncExternalStore(
    binding.controller.subscribe,
    binding.controller.getSnapshot,
  );
  const cardsSnapshot = useSyncExternalStore(
    binding.cards.controller.subscribe,
    binding.cards.controller.getSnapshot,
  );
  return (
    <CockpitColumnContext.Provider
      value={{
        snapshot: columnSnapshot,
        controller: binding.controller,
        cards: { snapshot: cardsSnapshot, controller: binding.cards.controller },
      }}
    >
      {children}
    </CockpitColumnContext.Provider>
  );
}

/** The same live re-read for the layer's own list (its prop is a plain binding object). */
function LiveOverlayHost({ cards }: { cards: CockpitCardsBinding }) {
  const snapshot = useSyncExternalStore(
    cards.controller.subscribe,
    cards.controller.getSnapshot,
  );
  return <CockpitOverlayHost binding={{ snapshot, controller: cards.controller }} />;
}

function renderSessionPage(binding: CockpitColumnBinding) {
  return render(
    <MemoryRouter initialEntries={[`/session/${SESSION_ID}`]}>
      <LiveColumnContext binding={binding}>
        <Routes>
          <Route path="/session/:sessionId" element={<SessionArea />} />
        </Routes>
        <LiveOverlayHost cards={binding.cards} />
        <HistoryControl />
        <LocationProbe />
      </LiveColumnContext>
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

const SESSION_B = 'session-phone-overlay-b';

/**
 * THE LAYER IS ONE ENTRY IN A REAL STACK, NOT A DETOUR OFF IT.
 *
 * A card's 「Open conversation」 must PUSH session B above the layer's entry. Otherwise the
 * browser's Back skips the layer and lands on bare session A: the person loses the cards they
 * had narrowed/selected/scrolled, and the layer they came from is unreachable except by opening
 * it again. This drives the whole round trip through the shipped router wiring and asserts the
 * stack on both halves — B is the current conversation, Back returns to the LAYER (not to A),
 * and only the layer's own close returns to A with the same mounted conversation, transcript
 * offset and composer draft.
 *
 * THE CARD CONTEXT IS READ FROM THE CONTROLLER, because that is the memory contract the shipped
 * list restores: a type filter, one selected card and a scroll offset. Details/option state is not
 * claimed here — the controller owns it, but this criterion states only what the list documents.
 */
test('phone: a card-opened session B sits ABOVE the layer, so Back returns to the same card context', async () => {
  mountLedger.mounts = 0;
  window.innerWidth = 390;
  const binding = await columnBinding([
    card(1),
    card(2, {
      kind: 'need',
      conversation: { sessionId: SESSION_B },
      subject: {
        uri: 'cloudcli://test/overlay-card-2',
        project: 'p1',
        sessionId: SESSION_B,
      },
    }),
  ]);
  const { controller } = binding.cards;
  renderSessionPage(binding);

  // Session A: one mounted instance with a draft and a transcript offset.
  const sessionAreaBefore = document.querySelector<HTMLElement>('[data-testid="session-area"]');
  assert.ok(sessionAreaBefore, 'session A renders');
  const instanceBefore = sessionAreaBefore.getAttribute('data-instance');
  const transcriptBefore = document.querySelector<HTMLElement>('[data-testid="session-transcript"]');
  assert.ok(transcriptBefore, 'the transcript renders');
  const draftBefore = document.querySelector<HTMLTextAreaElement>('[data-testid="session-draft"]');
  assert.ok(draftBefore, 'the composer draft renders');
  fireEvent.change(draftBefore, { target: { value: 'keep this draft for A' } });
  transcriptBefore.scrollTop = 42;
  assert.equal(mountLedger.mounts, 1, 'session A mounted once');

  // Open the layer over A.
  fireEvent.click(document.querySelector<HTMLElement>('[data-testid="cockpit-header-button"]')!);
  assert.ok(document.querySelector('[data-testid="cockpit-overlay"]'), 'the layer opens over A');

  // Arrange the observable card context: a type filter, one selected card, one scroll offset.
  fireEvent.click(
    document.querySelector<HTMLElement>('[data-testid="cockpit-card-filter-type-need"]')!,
  );
  const needCard = document.querySelector<HTMLElement>('[data-cockpit-card-id="overlay-card-2"]');
  assert.ok(needCard, 'the need card is visible under the need filter');
  fireEvent.pointerDown(needCard);
  const listBefore = document.querySelector<HTMLElement>('[data-testid="cockpit-card-list"]');
  assert.ok(listBefore, 'the list renders');
  listBefore.scrollTop = 137;
  fireEvent.scroll(listBefore);

  const contextBefore = {
    typeFilter: controller.getSnapshot().typeFilter,
    selectedCardId: controller.getSnapshot().selectedCardId,
    scrollPosition: controller.getSnapshot().scrollPosition,
  };
  assert.deepEqual(contextBefore, {
    typeFilter: 'need',
    selectedCardId: 'overlay-card-2',
    scrollPosition: 137,
  });

  // The card's own door: open its Details, then follow its conversation link.
  fireEvent.click(document.querySelector<HTMLElement>('[data-testid="cockpit-card-zone-a"]')!);
  assert.ok(
    document.querySelector('[data-testid="cockpit-card-details-layer"]'),
    'the card Details drawer opens',
  );
  const conversationLink = document.querySelector<HTMLAnchorElement>(
    '[data-testid="cockpit-card-conversation-link"]',
  );
  assert.ok(conversationLink, 'Details offers the card\'s conversation link');
  fireEvent.click(conversationLink);

  // B is the current conversation, and the layer is off screen (not unmounted from history).
  assert.equal(
    document.querySelector('[data-testid="location"]')?.textContent,
    `/session/${SESSION_B}`,
    'opening the card\'s conversation lands on session B',
  );
  assert.equal(
    document.querySelector('[data-testid="session-area"]')?.getAttribute('data-session-id'),
    SESSION_B,
    'session B is the current conversation, not A',
  );
  assert.equal(
    document.querySelector('[data-testid="cockpit-overlay"]'),
    null,
    'the layer is not drawn over session B',
  );
  assert.equal(
    document.querySelector('[data-testid="session-area"]')?.getAttribute('data-instance'),
    instanceBefore,
    'the workspace route kept its mount while switching to B',
  );

  // Browser Back: the layer comes back over A — NOT bare session A.
  fireEvent.click(document.querySelector<HTMLElement>('[data-testid="browser-back"]')!);
  assert.equal(
    document.querySelector('[data-testid="location"]')?.textContent,
    `/session/${SESSION_ID}`,
    'Back returns to the layer entry on session A\'s address',
  );
  assert.ok(
    document.querySelector('[data-testid="cockpit-overlay"]'),
    'Back lands on the layer, not directly on session A',
  );
  assert.ok(
    document.querySelector('[data-testid="cockpit-overlay-title"]')?.textContent?.includes(
      SESSION_TITLE,
    ),
    'the layer still names the conversation it covers',
  );
  assert.equal(
    document.querySelector('[data-testid="session-area"]')?.getAttribute('data-session-id'),
    SESSION_ID,
    'the conversation under the layer is A again',
  );
  assert.deepEqual(
    {
      typeFilter: controller.getSnapshot().typeFilter,
      selectedCardId: controller.getSnapshot().selectedCardId,
      scrollPosition: controller.getSnapshot().scrollPosition,
    },
    contextBefore,
    'the card context (filter/selection/scroll) matches what it was before opening B',
  );
  assert.equal(
    document.querySelector<HTMLElement>('[data-testid="cockpit-card-list"]')?.scrollTop,
    137,
    'the list restored the scroll offset',
  );

  // The layer's own close pops the last entry: A, same mount, same draft and transcript offset.
  fireEvent.click(document.querySelector<HTMLElement>('[data-testid="cockpit-overlay-close"]')!);
  const sessionAreaAfter = document.querySelector<HTMLElement>('[data-testid="session-area"]');
  assert.ok(sessionAreaAfter, 'session A is on screen after the layer closes');
  assert.equal(
    document.querySelector('[data-testid="location"]')?.textContent,
    `/session/${SESSION_ID}`,
    'closing returns to session A\'s address',
  );
  assert.equal(
    document.querySelector('[data-testid="cockpit-overlay"]'),
    null,
    'the layer is gone after its close',
  );
  assert.equal(sessionAreaAfter, sessionAreaBefore, 'the same session DOM node, not a rebuilt one');
  assert.equal(
    sessionAreaAfter.getAttribute('data-instance'),
    instanceBefore,
    'session A is the same mounted instance',
  );
  assert.equal(mountLedger.mounts, 1, 'session A never re-mounted across the round trip');

  const transcriptAfter = document.querySelector<HTMLElement>('[data-testid="session-transcript"]');
  assert.equal(transcriptAfter, transcriptBefore, 'the transcript is the same node');
  assert.equal(transcriptAfter?.scrollTop, 42, 'the transcript scroll offset is unchanged');
  const draftAfter = document.querySelector<HTMLTextAreaElement>('[data-testid="session-draft"]');
  assert.equal(draftAfter, draftBefore, 'the composer draft is the same node');
  assert.equal(draftAfter?.value, 'keep this draft for A', 'the draft text is unchanged');
});
