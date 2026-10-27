import { act, fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Clock, CockpitCard as CockpitCardData, CockpitCardOption } from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitColumn from '@/modules/cockpit/CockpitColumn';
import CockpitHeaderButton from '@/modules/cockpit/CockpitHeaderButton';
import { createCockpitCardController } from '@/modules/cockpit/cockpitCardController';
import type { CockpitCardController } from '@/modules/cockpit/cockpitCardController';
import { createCockpitColumnController } from '@/modules/cockpit/cockpitColumnController';
import type { CockpitColumnController } from '@/modules/cockpit/cockpitColumnController';
import { CockpitColumnContext } from '@/modules/cockpit/hooks/useCockpitColumn';
import type { CockpitColumnBinding } from '@/modules/cockpit/hooks/useCockpitColumn';

/**
 * The PC column's rendered surface: the collapsed page is byte-identical to no column, the
 * expanded page carries the existing card list and the existing cockpit input, Details is pushed
 * inside with a way back, and the header badge is the controller's count.
 *
 * The hub and dictation hooks are stubbed: this criterion is about the column's frame, and the
 * real ones would open a websocket and a microphone. Everything else — the card controller, the
 * column controller, the card list, Details, the input, i18n — is the shipped code.
 */

vi.mock('@/modules/cockpit/hooks/useCockpitHub', () => ({
  useCockpitHub: () => ({
    state: { rev: 0 },
    connected: false,
    dispatch: vi.fn(),
    reportVisible: vi.fn(),
  }),
}));

vi.mock('@/modules/cockpit/hooks/useCockpitPushToTalk', () => ({
  useCockpitPushToTalk: () => ({ state: 'idle', inFlight: false, toggle: vi.fn() }),
}));

const NOW = Date.parse('2026-10-27T00:10:00.000Z');

const FAKE_CLOCK: Clock = {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 2,
  clearInterval: () => undefined,
  now: () => NOW,
};

function option(id: string, suggested = false): CockpitCardOption {
  return {
    id,
    label: id,
    does: `${id} does something`,
    suggested,
    source: 'provider',
    action: { executor: 'test.exec', params: { optionId: id } },
  };
}

function card(id: string): CockpitCardData {
  return {
    id,
    provider: 'test',
    revision: 1,
    kind: 'ask',
    group: 'test',
    rank: 1,
    state: 'open',
    waitingSince: '2026-10-27T00:00:00.000Z',
    surfacedAt: '2026-10-27T00:00:01.000Z',
    subject: { uri: `cloudcli://test/${id}`, project: 'p1' },
    facts: [],
    options: [option('one', true), option('two')],
    ownReply: { executor: 'test.reply', params: {} },
    conversation: { sessionId: 'session-1' },
  };
}

type Fixture = {
  cards: CockpitCardController;
  column: CockpitColumnController;
};

async function fixture(options: {
  cardCount?: number;
  viewportWidth?: number;
  expanded?: boolean;
} = {}): Promise<Fixture> {
  const count = options.cardCount ?? 2;
  const cards = createCockpitCardController({
    fetchCards: async () => Array.from({ length: count }, (_, index) => card(`c${index + 1}`)),
    confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
    clock: FAKE_CLOCK,
    refreshIntervalMs: 0,
  });
  await cards.load();
  const column = createCockpitColumnController({
    cards,
    readViewportWidth: () => options.viewportWidth ?? 1440,
    storage: null,
  });
  column.start();
  if (options.expanded === true) column.setExpanded(true);
  return { cards, column };
}

/** The production binding's shape, driven by both controllers' subscriptions. */
function TestBinding({ fixture: f, children }: { fixture: Fixture; children: ReactNode }) {
  const cardsSnapshot = useSyncExternalStore(
    f.cards.subscribe,
    f.cards.getSnapshot,
    f.cards.getSnapshot,
  );
  const columnSnapshot = useSyncExternalStore(
    f.column.subscribe,
    f.column.getSnapshot,
    f.column.getSnapshot,
  );
  const binding = useMemo<CockpitColumnBinding>(
    () => ({
      snapshot: columnSnapshot,
      controller: f.column,
      cards: { snapshot: cardsSnapshot, controller: f.cards },
    }),
    [cardsSnapshot, columnSnapshot, f.cards, f.column],
  );
  return (
    <I18nextProvider i18n={i18n}>
      <CockpitColumnContext.Provider value={binding}>{children}</CockpitColumnContext.Provider>
    </I18nextProvider>
  );
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('collapsed', () => {
  it('draws nothing, so the page is structurally identical to one without a column', async () => {
    const f = await fixture({ expanded: false });

    const withoutColumn = render(
      <TestBinding fixture={f}>
        <div data-testid="session-page">session</div>
      </TestBinding>,
    );
    const withoutHtml = withoutColumn.container.innerHTML;
    withoutColumn.unmount();

    const withColumn = render(
      <TestBinding fixture={f}>
        <div data-testid="session-page">session</div>
        <CockpitColumn />
      </TestBinding>,
    );

    expect(screen.queryByTestId('cockpit-column')).toBeNull();
    expect(withColumn.container.innerHTML).toBe(withoutHtml);
  });

  it('keeps the header button, but draws no badge at zero cards', async () => {
    const f = await fixture({ cardCount: 0, expanded: false });
    render(
      <TestBinding fixture={f}>
        <CockpitHeaderButton />
      </TestBinding>,
    );
    expect(screen.getByTestId('cockpit-header-button')).toBeTruthy();
    expect(screen.queryByTestId('cockpit-header-badge')).toBeNull();
    expect(screen.getByTestId('cockpit-header-button').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('expanded', () => {
  it('draws the existing card list and the existing cockpit input in the column', async () => {
    const f = await fixture({ expanded: true });
    render(
      <TestBinding fixture={f}>
        <CockpitColumn />
      </TestBinding>,
    );

    const column = screen.getByTestId('cockpit-column');
    expect(column.getAttribute('data-cockpit-column-layout')).toBe('squeeze');
    expect(screen.getByTestId('cockpit-card-list')).toBeTruthy();
    expect(screen.getByTestId('cockpit-column-composer')).toBeTruthy();
    expect(screen.getByTestId('cockpit-input')).toBeTruthy();
    expect(screen.getByTestId('cockpit-column-count').textContent).toContain('2');
  });

  it('pushes Details inside the column and the back button returns to the list', async () => {
    const f = await fixture({ expanded: true });
    render(
      <TestBinding fixture={f}>
        <CockpitColumn />
      </TestBinding>,
    );

    act(() => f.cards.openDetails('c1'));

    expect(screen.getByTestId('cockpit-column-details')).toBeTruthy();
    // The page variant's floating layer must not appear: Details is pushed INSIDE.
    expect(screen.queryByTestId('cockpit-card-details-layer')).toBeNull();
    expect(screen.getByTestId('cockpit-card-details').getAttribute('data-cockpit-card-details-inline')).toBe('true');

    fireEvent.click(screen.getByTestId('cockpit-column-back'));

    expect(screen.queryByTestId('cockpit-column-details')).toBeNull();
    expect(screen.getByTestId('cockpit-card-list')).toBeTruthy();
  });

  it('opens the card’s conversation on the left and marks it while the squeeze layout stays open', async () => {
    const f = await fixture({ expanded: true });
    render(
      <TestBinding fixture={f}>
        <CockpitColumn />
      </TestBinding>,
    );

    act(() => f.cards.openDetails('c1'));
    const link = screen.getByTestId('cockpit-card-conversation-link');
    fireEvent.click(link);

    expect(f.column.getSnapshot().openedCardId).toBe('c1');
    expect(f.column.getSnapshot().openedSessionId).toBe('session-1');
    expect(f.column.getSnapshot().expanded).toBe(true);
    expect(screen.getByTestId('cockpit-card-opened-in-session')).toBeTruthy();
  });
});

describe('the header badge', () => {
  it('mirrors the open-card count and shows 99+ above 99', async () => {
    const three = await fixture({ cardCount: 3, expanded: false });
    const first = render(
      <TestBinding fixture={three}>
        <CockpitHeaderButton />
      </TestBinding>,
    );
    expect(screen.getByTestId('cockpit-header-badge').textContent).toBe('3');
    first.unmount();

    const hundred = await fixture({ cardCount: 100, expanded: false });
    render(
      <TestBinding fixture={hundred}>
        <CockpitHeaderButton />
      </TestBinding>,
    );
    expect(screen.getByTestId('cockpit-header-badge').textContent).toBe('99+');
  });

  it('is pressed while the column is open and absent below 900 px', async () => {
    const open = await fixture({ expanded: true });
    const first = render(
      <TestBinding fixture={open}>
        <CockpitHeaderButton />
      </TestBinding>,
    );
    expect(screen.getByTestId('cockpit-header-button').getAttribute('aria-pressed')).toBe('true');
    first.unmount();

    const phone = await fixture({ expanded: true, viewportWidth: 800 });
    render(
      <TestBinding fixture={phone}>
        <CockpitHeaderButton />
      </TestBinding>,
    );
    expect(screen.queryByTestId('cockpit-header-button')).toBeNull();
  });
});
