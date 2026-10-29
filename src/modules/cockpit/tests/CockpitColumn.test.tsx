import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Clock, CockpitCard as CockpitCardData, CockpitCardOption } from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitColumn, { CockpitColumnRegion } from '@/modules/cockpit/CockpitColumn';
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

function card(id: string, group = 'test', kind: CockpitCardData['kind'] = 'ask'): CockpitCardData {
  return {
    id,
    provider: 'test',
    revision: 1,
    kind,
    group,
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
  /** How many of the cards belong to the rescue group (the rest are an ordinary group). */
  rescueCount?: number;
  /** One kind per card, in provider order; omitted cards are `ask`. */
  kinds?: readonly CockpitCardData['kind'][];
  viewportWidth?: number;
  expanded?: boolean;
} = {}): Promise<Fixture> {
  const count = options.cardCount ?? 2;
  const rescueCount = options.rescueCount ?? 0;
  const cards = createCockpitCardController({
    fetchCards: async () =>
      Array.from({ length: count }, (_, index) =>
        card(
          `c${index + 1}`,
          index < rescueCount ? 'rescue' : 'test',
          options.kinds?.[index] ?? 'ask',
        ),
      ),
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
    expect(screen.getByTestId('cockpit-card-count-summary').textContent).toContain('2');
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

describe('the column title', () => {
  it('counts stuck cards by kind, so a rescue-group question is not called stuck', async () => {
    // The live shape: quay-fleet files every session-ask card in the rescue GROUP, while its
    // kind is `ask`/`need`/`decision`. Counting `card.group === 'rescue'` would read 7 stuck.
    const f = await fixture({
      cardCount: 7,
      rescueCount: 7,
      kinds: ['ask', 'ask', 'ask', 'ask', 'ask', 'need', 'decision'],
      expanded: true,
    });
    render(
      <TestBinding fixture={f}>
        <CockpitColumn />
      </TestBinding>,
    );

    expect(f.cards.getSnapshot().typeCounts.stuck ?? 0).toBe(0);
    expect(screen.getByTestId('cockpit-card-count-summary').textContent).toContain('7 needs you');
    expect(screen.queryByTestId('cockpit-column-stuck-count')).toBeNull();
    const title = screen.getByTestId('cockpit-column-title').textContent ?? '';
    expect(title).not.toContain('stuck');
  });

  it('shows the stuck segment only when stuck cards exist, with the controller’s own count', async () => {
    const f = await fixture({
      cardCount: 5,
      // Every card is in the rescue group, but only two are kind `stuck`: a group-shaped count
      // would read 5, the kind count reads 2.
      rescueCount: 5,
      kinds: ['ask', 'stuck', 'need', 'stuck', 'decision'],
      expanded: true,
    });
    render(
      <TestBinding fixture={f}>
        <CockpitColumn />
      </TestBinding>,
    );

    const controllerCount = f.cards.getSnapshot().typeCounts.stuck ?? 0;
    expect(controllerCount).toBe(2);
    expect(screen.getByTestId('cockpit-column-stuck-count').textContent).toBe(
      `${controllerCount} stuck`,
    );
    expect(screen.getByTestId('cockpit-card-count-summary').textContent).toContain('5 needs you');
    expect(screen.getByTestId('cockpit-column-title').textContent).toContain('2 stuck');
  });

  it('reads zero when no card is of kind stuck', async () => {
    const f = await fixture({ cardCount: 2, expanded: true });
    render(
      <TestBinding fixture={f}>
        <CockpitColumn />
      </TestBinding>,
    );

    expect(screen.queryByTestId('cockpit-column-stuck-count')).toBeNull();
    expect(screen.getByTestId('cockpit-column-title').textContent).not.toContain('stuck');
  });

  it('draws ONE count line covering needs-you, waiting-for-fleet and answered, and fades the filter strip', async () => {
    // One card per state, so the line is a partition of what is on screen rather than a repeat of
    // one number: c1 is answered and awaiting the fleet's receipt, c2 was answered and the fleet
    // kept it (the server leaves a notice beside the card), c3 still needs the person.
    const cards = createCockpitCardController({
      fetchCards: async () => [
        {
          ...card('c1'),
          feedback: {
            cardId: 'c1',
            revision: 1,
            feedbackId: 'f1',
            optionId: 'one',
            label: 'one',
            sentAt: new Date(NOW - 30_000).toISOString(),
            outcome: { executor: 'test.exec', ok: true },
            canResend: false,
          },
        },
        {
          ...card('c2'),
          feedbackNotice: { cardId: 'c2', feedbackId: 'f2', kind: 'kept' },
        },
        card('c3'),
      ],
      confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
      clock: FAKE_CLOCK,
      refreshIntervalMs: 0,
    });
    await cards.load();
    const column = createCockpitColumnController({
      cards,
      readViewportWidth: () => 1440,
      storage: null,
    });
    column.start();
    column.setExpanded(true);
    render(
      <TestBinding fixture={{ cards, column }}>
        <CockpitColumn />
      </TestBinding>,
    );

    const summary = screen.getByTestId('cockpit-card-count-summary');
    expect(summary.textContent).toBe(
      '1 needs you · 1 waiting for the fleet · 1 answered cards still open',
    );
    // The old two-count header is gone: neither the column title's `N waiting for you` badge nor
    // the list's `N cards, M waiting...` sentence is rendered anywhere.
    expect(screen.queryByTestId('cockpit-column-count')).toBeNull();
    expect(screen.queryByText(/\d+ waiting for you/)).toBeNull();
    expect(screen.queryByText(/\d+ cards?, \d+ waiting for the fleet/)).toBeNull();

    // The horizontally scrolling filter strip ends under a fade, so a cut chip reads as "more to
    // the right" instead of as the end of the row.
    const chips = screen.getByTestId('cockpit-card-filter-types');
    expect(chips.getAttribute('style') ?? '').toContain('mask-image: linear-gradient');
  });
});

describe('the session layout', () => {
  it('places the squeeze column beside the whole session area, not inside its content', async () => {
    const f = await fixture({ expanded: true });
    render(
      <TestBinding fixture={f}>
        <CockpitColumnRegion>
          <header data-testid="session-header">header</header>
          <div data-testid="session-content">content</div>
        </CockpitColumnRegion>
      </TestBinding>,
    );

    const column = screen.getByTestId('cockpit-column');
    const header = screen.getByTestId('session-header');
    const content = screen.getByTestId('session-content');
    const sessionArea = header.closest<HTMLElement>('[data-workspace-session-area]');
    expect(sessionArea).not.toBeNull();
    // The session area owns the header AND the content, but the column is its SIBLING: a column
    // inside the area would start below the header and the header would keep its full width.
    expect(sessionArea!.contains(content)).toBe(true);
    expect(sessionArea!.contains(column)).toBe(false);
    expect(column.parentElement).toBe(sessionArea!.parentElement);
  });

  it('draws the column’s own title row, whose collapse button drives the header button', async () => {
    const f = await fixture({ expanded: true });
    render(
      <TestBinding fixture={f}>
        <CockpitColumnRegion>
          <CockpitHeaderButton />
        </CockpitColumnRegion>
      </TestBinding>,
    );

    const column = screen.getByTestId('cockpit-column');
    expect(within(column).getByText('Cockpit')).toBeTruthy();
    expect(within(column).getByTestId('cockpit-card-count-summary').textContent).toContain('2');
    expect(screen.getByTestId('cockpit-header-button').getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(within(column).getByTestId('cockpit-column-collapse'));

    // ONE state: the column is gone and the header button reads the same collapse.
    expect(f.column.getSnapshot().expanded).toBe(false);
    expect(screen.queryByTestId('cockpit-column')).toBeNull();
    expect(screen.getByTestId('cockpit-header-button').getAttribute('aria-pressed')).toBe('false');
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

/** Renders the column under a route whose `sessionId` is what the left pane shows. */
function renderAtSession(f: Fixture, sessionId: string) {
  return render(
    <MemoryRouter initialEntries={[`/session/${sessionId}`]}>
      <Routes>
        <Route
          path="/session/:sessionId"
          element={
            <TestBinding fixture={f}>
              <CockpitColumn />
            </TestBinding>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the already-open-on-the-left marker', () => {
  it('marks a card whose conversation is the route session instead of rendering the link', async () => {
    const f = await fixture({ expanded: true });
    renderAtSession(f, 'session-1');

    act(() => f.cards.openDetails('c1'));

    expect(screen.getByTestId('cockpit-card-opened-in-session')).toBeTruthy();
    expect(screen.queryByTestId('cockpit-card-conversation-link')).toBeNull();
  });

  it('renders the link when the route session is a different conversation', async () => {
    const f = await fixture({ expanded: true });
    renderAtSession(f, 'session-2');

    act(() => f.cards.openDetails('c1'));

    expect(screen.getByTestId('cockpit-card-conversation-link')).toBeTruthy();
    expect(screen.queryByTestId('cockpit-card-opened-in-session')).toBeNull();
  });
});
