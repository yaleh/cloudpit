import { StrictMode, useSyncExternalStore } from 'react';
import { I18nextProvider } from 'react-i18next';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/shared/api';
import type { Clock, CockpitCard as CockpitCardData } from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitCardList from '@/modules/cockpit/cards/CockpitCardList';
import type { CockpitCardListProps } from '@/modules/cockpit/cards/CockpitCardList';
import CockpitOverlay from '@/modules/cockpit/workspace/CockpitOverlay';
import { createCockpitCardController } from '@/modules/cockpit/cards/cockpitCardController';
import type { CockpitCardController } from '@/modules/cockpit/cards/cockpitCardController';
import type { CockpitCardsBinding } from '@/modules/cockpit/hooks/useCockpitCards';
import type { CockpitStartConversationCreated } from '@/modules/cockpit/cards/cockpitCardStartConversation';

/**
 * EVERY SURFACE THE CARD BUTTON APPEARS ON CREATES AND OPENS THE SESSION.
 *
 * The cockpit draws the same card list in three places: the standalone cards page
 * (`/cockpit?view=cards`), the phone's overlay above a live conversation, and the PC session
 * page's right column. A press on 「就此开一个会话」 must do the same thing on all three — one
 * empty session through `createChatSession`, then that session's page — and each surface must
 * open it through its OWN navigation seam (route change on the page, the overlay's close-and-
 * switch, the column's open-on-the-left).
 */

const { createSession } = vi.hoisted(() => ({ createSession: vi.fn() }));
vi.mock('@/modules/chat-session/utils/session/sessionCreation', () => ({
  createChatSession: createSession,
}));

const NOW = Date.parse('2026-10-29T00:10:00.000Z');
const FAKE_CLOCK: Clock = {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 2,
  clearInterval: () => undefined,
  now: () => NOW,
};

const REGISTERED_PROJECTS = [
  { projectId: 'p1', fleetProjectId: 'fleet-one', projectPath: '/repos/one' },
] as const;

function card(): CockpitCardData {
  return {
    id: 'c1',
    provider: 'test',
    revision: 1,
    kind: 'ask',
    group: 'test',
    rank: 1,
    state: 'open',
    waitingSince: '2026-10-29T00:00:00.000Z',
    surfacedAt: '2026-10-29T00:00:01.000Z',
    subject: { uri: 'cloudcli://test/c1', project: 'p1' },
    conversation: { startInProject: 'p1' },
    ask: 'Which way?',
    facts: [],
    options: [],
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function BoundCards({
  controller,
  ...props
}: Omit<CockpitCardListProps, 'binding'> & { controller: CockpitCardController }) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  return <CockpitCardList binding={{ snapshot, controller }} {...props} />;
}

/** The cards page's wiring: `CockpitStage` hands the list the route change it already owns. */
function CardsPageSurface({
  controller,
  onSessionCreated,
}: {
  controller: CockpitCardController;
  onSessionCreated: (created: CockpitStartConversationCreated) => void;
}) {
  const navigate = useNavigate();
  return (
    <BoundCards
      controller={controller}
      registeredProjects={REGISTERED_PROJECTS}
      onSessionCreated={onSessionCreated}
      onNavigateToSession={(sessionId) => navigate(`/session/${encodeURIComponent(sessionId)}`)}
    />
  );
}

type Cards = { controller: CockpitCardController; binding: CockpitCardsBinding };

/** A settled card controller holding one open card, with its Details already open. */
async function openCards(): Promise<Cards> {
  const controller = createCockpitCardController({
    fetchCards: async () => ({ cards: [card()] }),
    confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
    clock: FAKE_CLOCK,
    refreshIntervalMs: 0,
  });
  await controller.load();
  act(() => controller.openDetails('c1'));
  return {
    controller,
    binding: { snapshot: controller.getSnapshot(), controller },
  };
}

/** One real press on the card's button, with the created session's answer flushed. */
async function pressStart(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('cockpit-card-start-conversation'));
  });
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  createSession.mockReset();
  createSession.mockResolvedValue({ sessionId: 'new-1', sessionName: 'New conversation' });
  // The card start reads the server's effective launch selection before allocating. These
  // cases are about the surfaces, so the reading names nothing: the create call carries no
  // model/effort keys and every assertion below stays about create-and-open.
  // A fresh Response per call: a start may be retried, and a Response body can be read once.
  vi.spyOn(api.settings, 'cockpitSessionStart').mockImplementation(async () => new Response(
    JSON.stringify({
      model: '',
      effort: '',
      effectiveModel: '',
      effectiveEffort: '',
      version: 'v1',
      restartRequired: false,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  ));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the cards page surface', () => {
  it('creates an empty session, registers it, and navigates to its page', async () => {
    const { controller } = await openCards();
    const onSessionCreated = vi.fn();
    render(
      <MemoryRouter initialEntries={['/cockpit?view=cards']}>
        <I18nextProvider i18n={i18n}>
          <CardsPageSurface controller={controller} onSessionCreated={onSessionCreated} />
          <LocationProbe />
        </I18nextProvider>
      </MemoryRouter>,
    );

    await pressStart();

    // An EMPTY conversation: the gateway payload carries no first message.
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith({ provider: 'claude', projectPath: '/repos/one' });
    expect(onSessionCreated).toHaveBeenCalledTimes(1);
    expect((onSessionCreated.mock.calls[0]![0] as CockpitStartConversationCreated).sessionId).toBe('new-1');
    // The page really changed address to the new session's own page.
    expect(screen.getByTestId('location').textContent).toBe('/session/new-1');
  });

  it('still creates the session when the surface is mounted twice (React StrictMode)', async () => {
    // StrictMode's development pass cleans every mount effect up once and sets it up again. The
    // list's controller lives in a `useMemo`, so the same instance must survive that pass —
    // otherwise the button is silently dead for the whole page in `vite dev`.
    const { controller } = await openCards();
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/cockpit?view=cards']}>
          <I18nextProvider i18n={i18n}>
            <CardsPageSurface controller={controller} onSessionCreated={() => undefined} />
            <LocationProbe />
          </I18nextProvider>
        </MemoryRouter>
      </StrictMode>,
    );

    await pressStart();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('location').textContent).toBe('/session/new-1');
  });
});

describe('the phone overlay surface', () => {
  it('creates the session and opens it through the overlay’s own close-and-switch', async () => {
    // The overlay is mounted above the workspace, so it reads the fleet registry on the first
    // press rather than receiving it as a prop — the production path.
    const fleet = vi.spyOn(api, 'quayFleetSummary').mockResolvedValue({
      ok: true,
      json: async () => ({ projects: REGISTERED_PROJECTS }),
    } as unknown as Response);
    const { binding } = await openCards();
    const onOpenConversation = vi.fn();
    render(
      <MemoryRouter initialEntries={['/session/live-session']}>
        <I18nextProvider i18n={i18n}>
          <CockpitOverlay
            sessionTitle="Live conversation"
            onClose={() => undefined}
            onOpenConversation={onOpenConversation}
            binding={binding}
          />
        </I18nextProvider>
      </MemoryRouter>,
    );

    await pressStart();

    expect(fleet).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith({ provider: 'claude', projectPath: '/repos/one' });
    expect(onOpenConversation).toHaveBeenCalledTimes(1);
    expect(onOpenConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), 'new-1');
  });
});

describe('the PC column surface', () => {
  it('registers the session and opens it on the left, in that order', async () => {
    const { controller } = await openCards();
    const order: string[] = [];
    const onSessionCreated = vi.fn((created: CockpitStartConversationCreated) => {
      order.push(`created:${created.sessionId}`);
    });
    const onOpenConversation = vi.fn((_card: CockpitCardData, sessionId: string) => {
      order.push(`opened:${sessionId}`);
    });
    render(
      <MemoryRouter initialEntries={['/session/live-session']}>
        <I18nextProvider i18n={i18n}>
          <BoundCards
            controller={controller}
            variant="column"
            registeredProjects={REGISTERED_PROJECTS}
            onSessionCreated={onSessionCreated}
            onOpenConversation={onOpenConversation}
          />
          <LocationProbe />
        </I18nextProvider>
      </MemoryRouter>,
    );

    // The column pushes Details INSIDE the list, so the control is the inline one.
    expect(screen.getByTestId('cockpit-column-details')).not.toBeNull();
    await pressStart();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith({ provider: 'claude', projectPath: '/repos/one' });
    expect(order).toEqual(['created:new-1', 'opened:new-1']);
  });
});
