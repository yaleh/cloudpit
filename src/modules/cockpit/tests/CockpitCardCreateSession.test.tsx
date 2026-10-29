import { useSyncExternalStore } from 'react';
import { I18nextProvider } from 'react-i18next';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Clock, CockpitCard as CockpitCardData } from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitCardList from '@/modules/cockpit/CockpitCardList';
import type { CockpitCardListProps } from '@/modules/cockpit/CockpitCardList';
import {
  createCockpitCardController,
} from '@/modules/cockpit/cockpitCardController';
import type { CockpitCardController } from '@/modules/cockpit/cockpitCardController';
import type { CockpitStartConversationCreated } from '@/modules/cockpit/cockpitCardStartConversation';

/**
 * THE CARD BUTTON CREATES A SESSION; IT DOES NOT ACKNOWLEDGE AN INTENT.
 *
 * A press on 「就此开一个会话」 must allocate an EMPTY conversation through the shipped
 * `createChatSession` gateway, register it through the surface's own registration seam, and then
 * open that session's page. These cases drive the real card controller and the real cards list,
 * so "clicked the card's button" and "the gateway was called once" are one reading.
 *
 * The project is never guessed: the card's `startInProject` wins over its subject project, and a
 * value that is not an actually registered project FAILS visibly — no fallback to whatever
 * project the cockpit happens to be showing.
 */

// The gateway is the subject of these cases: the hook imports this module, so the recorder
// replaces it here and every press is observed exactly where production allocates a session.
const { createSession } = vi.hoisted(() => ({ createSession: vi.fn() }));
vi.mock('@/modules/chat/utils/session/sessionCreation', () => ({
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

/** The projects the cockpit's registry reports; only these two may receive a session. */
const REGISTERED_PROJECTS = [
  { projectId: 'p1', fleetProjectId: 'fleet-one', projectPath: '/repos/one' },
  { projectId: 'p2', fleetProjectId: null, projectPath: '/repos/two' },
] as const;

function card(overrides: Partial<CockpitCardData> = {}): CockpitCardData {
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
    ...overrides,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

/** The list, re-rendering from the controller it was handed (the column/page binding shape). */
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

/** Renders the cards view with the card's Details already open, inside the shipped Router. */
async function renderOpenCard(
  cards: readonly CockpitCardData[],
  props: Omit<CockpitCardListProps, 'binding'> = {},
): Promise<CockpitCardController> {
  const controller = createCockpitCardController({
    fetchCards: async () => cards,
    confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
    clock: FAKE_CLOCK,
    // No background polling: the reading is the fixture until a criterion re-reads explicitly.
    refreshIntervalMs: 0,
  });
  await controller.load();
  render(
    <MemoryRouter initialEntries={['/cockpit?view=cards']}>
      <I18nextProvider i18n={i18n}>
        <BoundCards controller={controller} registeredProjects={REGISTERED_PROJECTS} {...props} />
        <LocationProbe />
      </I18nextProvider>
    </MemoryRouter>,
  );
  act(() => controller.openDetails(cards[0]!.id));
  return controller;
}

/** One real press on the card's button, with whatever the press settles flushed. */
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
});

describe('the card button’s project resolution', () => {
  it('prefers conversation.startInProject over the subject project', async () => {
    const onSessionCreated = vi.fn();
    await renderOpenCard(
      [card({ conversation: { startInProject: 'p1' }, subject: { uri: 'cloudcli://test/c1', project: 'p2' } })],
      { onSessionCreated },
    );

    await pressStart();

    // The registered project the card named first is the one the gateway is given — not p2.
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith({ provider: 'claude', projectPath: '/repos/one' });
    expect(onSessionCreated.mock.calls[0][0]).toMatchObject({
      sessionId: 'new-1',
      project: { projectId: 'p1', projectPath: '/repos/one' },
    });
  });

  it('uses the subject project only when startInProject is absent', async () => {
    const onSessionCreated = vi.fn();
    await renderOpenCard(
      [card({ conversation: undefined, subject: { uri: 'cloudcli://test/c1', project: 'p2' } })],
      { onSessionCreated },
    );

    await pressStart();

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith({ provider: 'claude', projectPath: '/repos/two' });
    expect(onSessionCreated.mock.calls[0][0]).toMatchObject({
      project: { projectId: 'p2', projectPath: '/repos/two' },
    });
  });

  it('resolves a card that addresses the registered project by its fleet id', async () => {
    const onSessionCreated = vi.fn();
    await renderOpenCard(
      [card({ conversation: { startInProject: 'FLEET-ONE' } })],
      { onSessionCreated },
    );

    await pressStart();

    expect(createSession).toHaveBeenCalledWith({ provider: 'claude', projectPath: '/repos/one' });
    expect(onSessionCreated.mock.calls[0][0].project.projectId).toBe('p1');
  });
});

describe('an unregistered project', () => {
  it('shows a visible error and neither creates nor navigates', async () => {
    const onSessionCreated = vi.fn();
    const onNavigateToSession = vi.fn();
    await renderOpenCard(
      // p1 IS registered — and must NOT be used as a fallback for the card's own value.
      [card({ conversation: { startInProject: 'ghost-project' }, subject: { uri: 'cloudcli://test/c1', project: 'p1' } })],
      { onSessionCreated, onNavigateToSession },
    );

    await pressStart();

    const error = screen.getByRole('alert');
    expect(error).toBe(screen.getByTestId('cockpit-card-start-conversation-error'));
    expect(error.getAttribute('data-error-kind')).toBe('unregistered');
    expect(error.textContent).toContain('ghost-project');
    expect(createSession).not.toHaveBeenCalled();
    expect(onSessionCreated).not.toHaveBeenCalled();
    expect(onNavigateToSession).not.toHaveBeenCalled();
    // No fallback project, and no route change: the readings stayed on the cockpit.
    expect(createSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ projectPath: '/repos/one' }),
    );
    expect(screen.getByTestId('location').textContent).toBe('/cockpit?view=cards');
  });

  it('treats a bare project value that names no registered project the same way', async () => {
    await renderOpenCard([
      card({ conversation: undefined, subject: { uri: 'cloudcli://test/c1', project: 'not-a-project' } }),
    ]);

    await pressStart();

    expect(screen.getByRole('alert').textContent).toContain('not-a-project');
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('one press at a time', () => {
  it('creates once while the request is pending and cannot be pressed again', async () => {
    let resolveCreation!: (value: { sessionId: string; sessionName: string }) => void;
    createSession.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveCreation = resolve;
      }),
    );
    const onNavigateToSession = vi.fn();
    await renderOpenCard([card()], { onNavigateToSession });

    const button = screen.getByTestId('cockpit-card-start-conversation') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(button);
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByTestId('cockpit-card-start-conversation-action').getAttribute('data-status')).toBe('starting');

    // Repeated presses while pending: the pending lock is the controller's, not a UI hint.
    fireEvent.click(button);
    fireEvent.click(button);
    expect(createSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveCreation({ sessionId: 'new-1', sessionName: 'New conversation' });
    });
    expect(onNavigateToSession).toHaveBeenCalledTimes(1);
    expect(onNavigateToSession).toHaveBeenCalledWith('new-1');
  });

  it('shows a retryable failure, then creates and opens exactly one session on retry', async () => {
    createSession.mockRejectedValueOnce(new Error('gateway down'));
    const onSessionCreated = vi.fn();
    const onNavigateToSession = vi.fn();
    await renderOpenCard([card()], { onSessionCreated, onNavigateToSession });

    await pressStart();

    const error = screen.getByRole('alert');
    expect(error.getAttribute('data-error-kind')).toBe('failed');
    expect(error.textContent).toContain('gateway down');
    expect(onNavigateToSession).not.toHaveBeenCalled();
    expect(onSessionCreated).not.toHaveBeenCalled();
    expect(screen.getByTestId('cockpit-card-start-conversation').textContent).toContain('Retry');

    // The retry is the same control: the error is recoverable without another path.
    await pressStart();

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(onSessionCreated).toHaveBeenCalledTimes(1);
    expect(onNavigateToSession).toHaveBeenCalledTimes(1);
    expect(onNavigateToSession).toHaveBeenCalledWith('new-1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not allocate a second session on a press after a successful start', async () => {
    const onNavigateToSession = vi.fn();
    await renderOpenCard([card()], { onNavigateToSession });

    await pressStart();
    expect(createSession).toHaveBeenCalledTimes(1);

    const button = screen.getByTestId('cockpit-card-start-conversation');
    await act(async () => {
      fireEvent.click(button);
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(onNavigateToSession).toHaveBeenCalledTimes(1);
  });
});

describe('the created session', () => {
  it('registers the session before the surface opens it', async () => {
    const order: string[] = [];
    const onSessionCreated = vi.fn((created: CockpitStartConversationCreated) => {
      order.push(`created:${created.sessionId}`);
    });
    const onNavigateToSession = vi.fn((sessionId: string) => {
      order.push(`opened:${sessionId}`);
    });
    await renderOpenCard([card()], { onSessionCreated, onNavigateToSession });

    await pressStart();

    expect(order).toEqual(['created:new-1', 'opened:new-1']);
  });
});
