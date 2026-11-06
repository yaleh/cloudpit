import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CockpitBriefResponse,
  CockpitCard,
  QuayFleetSummary,
  QuayPulseSummary,
  QuaySnapshot,
  QuaySuiteState,
} from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitPage from '@/modules/cockpit/workspace/CockpitPage';

/**
 * THE PHONE'S CARDS PAGE, MATCHED TO THE MOCKUP.
 *
 * Four readings this file guards, all on the shipped page at 390px:
 *
 *   1. Details is a BOTTOM SHEET: pinned to the bottom edge, ~90% tall, with a drag handle, and
 *      the SAME persistent confirm bar bound to the card's shown option.
 *   2. The summary's quoted assistant sentence is drawn as a quote with the 「in session」 link
 *      that jumps back to that conversation.
 *   3. A brief the feature turned OFF draws NO brief area — the 「No model brief / the brief
 *      feature is off」 block the live page showed is chrome, not a reading.
 *   4. The phone shell's ONE status row (driver · landed · suite · deploy · todo) and the
 *      single-line input whose send button appears only once there is something to send.
 *
 * The brief's other arm (a generated brief DOES draw its section) is a leg of this file: without
 * it, a page that stopped rendering the brief everywhere would pass case 3.
 *
 * Only the page's transports are doubled (the hub socket and the HTTP api), the same way
 * `cockpitCardsMobileShell.test.tsx` doubles them.
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
  cockpitCardBrief: vi.fn(),
  cockpitConfirmCard: vi.fn(),
  cockpitDismissCard: vi.fn(),
  system: { deployReadiness: vi.fn() },
}));

const readApiJsonMock = vi.hoisted(() => vi.fn(async (response: { json: () => Promise<unknown> }) => response.json()));

vi.mock('@/shared/api', () => ({
  api: apiMock,
  readApiJson: readApiJsonMock,
  authenticatedFetch: apiMock.observationFetch,
}));

const SUITE: QuaySuiteState = {
  state: 'green',
  runner: 'quay',
  scope: 'full',
  startedAt: null,
  finishedAt: null,
  durationMs: 1_200,
  laneCount: 2,
  commit: 'abc1234',
  taskId: null,
  runId: null,
};

const PULSE: QuayPulseSummary = {
  generatedAt: '2026-10-27T00:00:00.000Z',
  inFlight: [],
  gantt: null,
  tests: { current: SUITE, recentRounds: [] },
  fanIn: {
    recent: [
      { task: 'landed-task', outcome: 'landed', lockAcquireEpoch: null, lockReleaseEpoch: null },
      { task: 'failed-task', outcome: 'failed', lockAcquireEpoch: null, lockReleaseEpoch: null },
    ],
  },
  blockers: [],
};

const FLEET: QuayFleetSummary = {
  projects: [
    {
      projectId: 'p1',
      fleetProjectId: 'claudecodeui',
      projectPath: '/work/claudecodeui',
      driver: { state: 'running' },
      tasks: { total: 4, todo: 2, ready: 1, needsHuman: 1, done: 0 },
      pulse: PULSE,
      cached: false,
      error: null,
    },
  ],
  generatedAt: '2026-10-27T00:00:00.000Z',
  ttlPerProjectMs: 30000,
  cached: false,
};

const SNAPSHOT: QuaySnapshot = {
  projectId: 'p1',
  projectPath: '/work/claudecodeui',
  fleetProjectId: 'claudecodeui',
  generatedAt: '2026-10-27T00:00:00.000Z',
  cached: false,
  driver: { state: 'running', alive: true, running: true, lastRecordAt: null },
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
  tests: { current: SUITE, recentRounds: [] },
  fanIn: { recent: [] },
  inFlight: [],
  dashboardUrl: null,
  warnings: [],
};

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
  checkedAt: '2026-10-27T00:00:00.000Z',
};

/**
 * One card whose summary QUOTES the assistant (`“继续”`) and whose conversation is
 * `fixture-session` — the two readings the drawer's quote section needs. The suggested option is
 * what the persistent bar must name.
 */
const CARD: CockpitCard = {
  id: 'fixture:ask',
  provider: 'fixture',
  revision: 1,
  kind: 'ask',
  group: 'ruling',
  rank: 1,
  state: 'open',
  waitingSince: '2026-10-27T00:00:00.000Z',
  surfacedAt: '2026-10-27T00:00:03.000Z',
  subject: {
    uri: 'cloudcli://fixture/ask',
    project: 'fixture-project',
    sessionId: 'fixture-session',
    title: 'Cleanup the staging directory',
  },
  load: 2,
  ask: 'Should the cleanup delete the staging directory?',
  situation: '对话里只有“继续”，没有 diff 内容。',
  assistantQuote: '继续',
  facts: [{ text: 'staging holds 1.2 GB', mechanical: true }],
  options: [
    {
      id: 'delete',
      label: 'Delete staging',
      does: 'Remove the staging directory after the archive is verified.',
      suggested: true,
      source: 'assistant',
      action: { executor: 'fixture.record', params: { optionId: 'delete' } },
    },
  ],
  ownReply: { executor: 'fixture.record', params: { cardId: 'fixture:ask' } },
  conversation: { sessionId: 'fixture-session' },
};

/** The same card whose only option carries the irreversible tag: the two-press arm. */
const IRREVERSIBLE_CARD: CockpitCard = {
  ...CARD,
  options: CARD.options.map((option) => ({
    ...option,
    tags: [{ kind: 'irreversible', text: '不可逆' }],
  })),
};

/** The server's answer when `cockpit.brief.enabled` is off: HTTP 200, a fallback document. */
const BRIEF_DISABLED: CockpitBriefResponse = {
  cardId: CARD.id,
  sessionId: 'fixture-session',
  askId: null,
  revision: 1,
  messageId: null,
  status: 'fallback',
  reason: 'disabled',
  cached: false,
  question: null,
  rounds: 0,
  durationMs: 0,
  failures: [],
  tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 },
  v: 1,
  itemRef: '',
  headline: '',
  options: [],
  recommendation: null,
  evidence: [],
  blocks: [],
};

/** The same answer when the feature IS on and a model brief was produced. */
const BRIEF_GENERATED: CockpitBriefResponse = {
  ...BRIEF_DISABLED,
  status: 'generated',
  reason: null,
  question: CARD.ask ?? null,
  headline: 'Deleting staging is the low-risk step.',
};

/** A read that produced no brief because this card has nothing a brief can be written about. */
const BRIEF_UNSUPPORTED: CockpitBriefResponse = {
  ...BRIEF_DISABLED,
  reason: 'unsupported-content',
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

/** Renders the phone cards page and opens the fixture card's Details. */
async function openPhoneDetails(): Promise<void> {
  restoreViewport = setViewportWidth(390);
  renderCockpit('/cockpit?view=cards');
  const card = await screen.findByTestId('cockpit-card-fixture:ask');
  fireEvent.click(within(card).getByTestId('cockpit-card-zone-a'));
  await screen.findByTestId('cockpit-card-details');
}

beforeEach(async () => {
  await i18n.changeLanguage('en');
  hubMock.reset();
  apiMock.quayFleetSummary.mockReset();
  apiMock.quaySnapshot.mockReset();
  apiMock.observationFetch.mockReset();
  apiMock.cockpitCards.mockReset();
  apiMock.cockpitCardBrief.mockReset();
  apiMock.cockpitConfirmCard.mockReset();
  apiMock.cockpitDismissCard.mockReset();
  apiMock.system.deployReadiness.mockReset();
  readApiJsonMock.mockClear();

  apiMock.quayFleetSummary.mockResolvedValue(okResponse(FLEET));
  apiMock.quaySnapshot.mockResolvedValue(okResponse(SNAPSHOT));
  apiMock.observationFetch.mockResolvedValue(
    okResponse({ entries: [], collapsedCount: 0, producers: [], self: null }),
  );
  apiMock.cockpitCards.mockResolvedValue(okResponse({ cards: [CARD] }));
  apiMock.cockpitCardBrief.mockResolvedValue(okResponse(BRIEF_DISABLED));
  apiMock.cockpitConfirmCard.mockResolvedValue(
    okResponse({
      ok: true,
      cardId: 'fixture:ask',
      executor: 'fixture.record',
      params: {},
      result: { total: 1 },
    }),
  );
  apiMock.cockpitDismissCard.mockResolvedValue(okResponse({ ok: true, cardId: 'fixture:ask' }));
  apiMock.system.deployReadiness.mockResolvedValue(okResponse(DEPLOY_READING));
});

afterEach(() => {
  restoreViewport?.();
  restoreViewport = null;
});

describe('the phone Details sheet', () => {
  it('opens as a bottom sheet with a drag handle and the persistent confirm bar', async () => {
    await openPhoneDetails();

    const details = screen.getByTestId('cockpit-card-details');
    expect(details.getAttribute('data-drawer')).toBe('true');
    expect(details.className).toContain('h-[90vh]');
    expect(details.className).toContain('rounded-t-2xl');

    const layer = screen.getByTestId('cockpit-card-details-layer');
    expect(layer.getAttribute('data-drawer')).toBe('true');
    expect(layer.className).toContain('items-end');

    expect(screen.getByTestId('cockpit-card-details-drag-handle')).toBeTruthy();
    // The sheet is dismissed by its handle, not by a desktop Close button.
    expect(screen.queryByTestId('cockpit-card-details-close')).toBeNull();

    // The bar is bound to the SAME target the card shows, but the button carries the short label:
    // the selected option is expressed by the highlighted rows, not by the button's text.
    const bar = screen.getByTestId('cockpit-card-details-confirm');
    expect(bar.textContent?.trim()).toBe('Confirm');
    expect(screen.getByTestId('cockpit-card-details-confirm-bar')).toBeTruthy();
  });

  it('scrolls the reading above a confirm bar that is not inside the scroller', async () => {
    await openPhoneDetails();

    const scroll = screen.getByTestId('cockpit-card-details-scroll');
    const bar = screen.getByTestId('cockpit-card-details-confirm-bar');
    // The defect was the bar being the scroller's LAST CHILD: its height covered the closing rows
    // (the last option, the conversation link). Two regions, siblings in the drawer's column.
    expect(scroll.contains(bar)).toBe(false);
    expect(bar.closest('[data-testid="cockpit-card-details-scroll"]')).toBeNull();
    expect(bar.parentElement?.parentElement?.getAttribute('data-testid')).toBe(
      'cockpit-card-details-footer',
    );
  });

  it('closes when the drag handle is swiped down', async () => {
    await openPhoneDetails();

    const handle = screen.getByTestId('cockpit-card-details-drag-handle');
    // jsdom does not ship PointerEvent by default; a MouseEvent of the pointer type carries
    // `clientY` into React's synthetic pointer event, which is what the handler measures.
    fireEvent(handle, new MouseEvent('pointerdown', { bubbles: true, clientY: 100 }));
    fireEvent(handle, new MouseEvent('pointerup', { bubbles: true, clientY: 200 }));

    await waitFor(() => expect(screen.queryByTestId('cockpit-card-details')).toBeNull());
  });

  it('keeps the title row below the drag handle in the same sticky header', async () => {
    await openPhoneDetails();

    const handle = screen.getByTestId('cockpit-card-details-drag-handle');
    const titleRow = screen.getByTestId('cockpit-card-details-title-row');

    // The defect was the sticky handle scrolling OVER a non-sticky title. Sharing one sticky
    // parent is the mechanism that makes that impossible.
    expect(titleRow.parentElement).toBe(handle.parentElement);
    expect(handle.parentElement?.className).toContain('sticky');
    expect(handle.compareDocumentPosition(titleRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws the Details confirm bar with the card’s own styling', async () => {
    await openPhoneDetails();

    const cardButton = screen.getByTestId('cockpit-card-confirm');
    const detailsButton = screen.getByTestId('cockpit-card-details-confirm');

    // One action, one style: the drawer must not draw the card's confirmation as a blue
    // primary button while the card itself draws a black solid one.
    expect(detailsButton.className).toBe(cardButton.className);
    expect(detailsButton.className).toContain('bg-neutral-950');
    expect(detailsButton.className).not.toContain('bg-primary');
  });

  it('keeps the Details button on the short label when the shown option changes', async () => {
    // Two reversible options: the drawer's own rows switch the bar's target, so the assertion is
    // about the wording following the selection (and deliberately not re-stating it).
    const twoOptionCard: CockpitCard = {
      ...CARD,
      options: [
        CARD.options[0],
        {
          ...CARD.options[0],
          id: 'park',
          label: 'Park it',
          does: 'Stop the run and keep the transcript.',
          suggested: false,
          source: 'provider',
        },
      ],
    };
    apiMock.cockpitCards.mockResolvedValue(okResponse({ cards: [twoOptionCard] }));
    restoreViewport = setViewportWidth(390);
    renderCockpit('/cockpit?view=cards');
    const card = await screen.findByTestId('cockpit-card-fixture:ask');
    fireEvent.click(within(card).getByTestId('cockpit-card-zone-a'));
    await screen.findByTestId('cockpit-card-details');

    const button = screen.getByTestId('cockpit-card-details-confirm');
    expect(button.textContent?.trim()).toBe('Confirm');

    fireEvent.click(screen.getByTestId('cockpit-card-details-option-park'));
    const switched = screen.getByTestId('cockpit-card-details-confirm');
    expect(switched).toBe(button);
    expect(switched.textContent?.trim()).toBe('Confirm');
    expect(switched.textContent).not.toContain('Park it');
  });

  it('turns the drawer’s bar into its countdown in place, and the same button cancels it', async () => {
    await openPhoneDetails();

    const before = screen.getByTestId('cockpit-card-details-confirm');
    expect(before.getAttribute('data-confirm-mode')).toBe('open');
    // The idle bar is the button alone: no hint row above it any more.
    expect(screen.queryByTestId('cockpit-card-details-confirm-hint')).toBeNull();
    fireEvent.click(before);

    // The SAME button, in the SAME bar: the sheet does not grow a second send control, and no
    // fixed panel is mounted at the page's bottom edge. One press starts the countdown.
    const counting = screen.getByTestId('cockpit-card-details-confirm');
    expect(counting).toBe(before);
    expect(counting.getAttribute('data-confirm-mode')).toBe('cancel');
    expect(counting.getAttribute('data-confirm-seconds')).toBe('5');
    expect(
      screen.getByTestId('cockpit-card-details-confirm-bar').getAttribute('data-confirm-pending'),
    ).toBe('true');
    expect(screen.queryByTestId('cockpit-card-details-confirm-message')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-confirm-panel')).toBeNull();
    expect(document.querySelector('[data-testid="cockpit-card-confirm-panel"]')).toBeNull();
    expect(apiMock.cockpitConfirmCard).not.toHaveBeenCalled();

    // Pressing it again cancels the send, still without a request.
    fireEvent.click(counting);
    expect(screen.getByTestId('cockpit-card-details-confirm').getAttribute('data-confirm-mode')).toBe(
      'open',
    );
    expect(
      screen.getByTestId('cockpit-card-details-confirm-bar').getAttribute('data-confirm-pending'),
    ).toBe('false');
    expect(apiMock.cockpitConfirmCard).not.toHaveBeenCalled();
  });

  it('sends an irreversible option from the same button, with its warning floating above', async () => {
    // The warning options keep the two-press confirmation: that arm needs a card whose option is
    // tagged irreversible, so it is seeded before the page reads its cards.
    apiMock.cockpitCards.mockResolvedValue(okResponse({ cards: [IRREVERSIBLE_CARD] }));
    restoreViewport = setViewportWidth(390);
    renderCockpit('/cockpit?view=cards');
    const card = await screen.findByTestId('cockpit-card-fixture:ask');
    fireEvent.click(within(card).getByTestId('cockpit-card-zone-a'));
    await screen.findByTestId('cockpit-card-details');

    const before = screen.getByTestId('cockpit-card-details-confirm');
    fireEvent.click(before);

    const pending = screen.getByTestId('cockpit-card-details-confirm');
    expect(pending).toBe(before);
    expect(pending.getAttribute('data-confirm-mode')).toBe('send');
    expect(pending.hasAttribute('data-confirm-seconds')).toBe(false);
    const warning = screen.getByTestId('cockpit-card-details-confirm-warning');
    expect(warning.textContent).toContain('⚠');
    expect(
      screen.getByTestId('cockpit-card-details-confirm-message').parentElement?.className,
    ).toContain('bottom-full');
    expect(apiMock.cockpitConfirmCard).not.toHaveBeenCalled();

    fireEvent.click(pending);
    await waitFor(() => expect(apiMock.cockpitConfirmCard).toHaveBeenCalledTimes(1));
    expect(apiMock.cockpitConfirmCard.mock.calls[0]?.[0]).toEqual({
      cardId: 'fixture:ask',
      revision: 1,
      optionId: 'delete',
    });

    // Success is reported inside the bar, and the bar returns to its idle label.
    await waitFor(() =>
      expect(screen.getByTestId('cockpit-card-details-confirm-outcome').textContent).toBe('Sent ✓'),
    );
    expect(
      screen.getByTestId('cockpit-card-details-confirm-bar').getAttribute('data-confirm-pending'),
    ).toBe('false');
    expect(screen.getByTestId('cockpit-card-details-confirm').textContent).toContain('Confirm');
  });

  it('carries the third action inside the sheet: cancel sends nothing and leaves the arrow alone', async () => {
    await openPhoneDetails();

    // First press: an in-place confirmation inside the drawer, and neither channel has run.
    fireEvent.click(screen.getByTestId('cockpit-card-details-dismiss'));
    expect(screen.getByTestId('cockpit-card-details-dismiss-confirm').textContent?.trim()).toBe(
      'Confirm discard',
    );
    expect(apiMock.cockpitDismissCard).not.toHaveBeenCalled();
    expect(apiMock.cockpitConfirmCard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('cockpit-card-details-dismiss-cancel'));
    expect(screen.queryByTestId('cockpit-card-details-dismiss-confirm')).toBeNull();
    expect(apiMock.cockpitDismissCard).not.toHaveBeenCalled();
    // The sheet and the card's shown option are untouched: cancelling a discard is not an answer.
    expect(screen.getByTestId('cockpit-card-details')).toBeTruthy();
    expect(screen.getByTestId('cockpit-card-details-confirm').getAttribute('data-confirm-mode')).toBe(
      'open',
    );
  });

  it('discards from the sheet without answering, then returns to the list with the card gone', async () => {
    const other: CockpitCard = { ...CARD, id: 'fixture:fix', kind: 'fix', ask: 'Repair the fixture?' };
    apiMock.cockpitCards.mockResolvedValue(okResponse({ cards: [CARD, other] }));
    restoreViewport = setViewportWidth(390);
    renderCockpit('/cockpit?view=cards');
    const row = await screen.findByTestId('cockpit-card-fixture:ask');
    fireEvent.click(within(row).getByTestId('cockpit-card-zone-a'));
    await screen.findByTestId('cockpit-card-details');

    const reading = () =>
      JSON.parse(
        document.querySelector('[data-cockpit-cards]')?.getAttribute('data-cockpit-cards') ?? '{}',
      );
    expect(reading().visibleCardIds).toEqual(['fixture:ask', 'fixture:fix']);
    expect(reading().detailsOpenCardId).toBe('fixture:ask');

    fireEvent.click(screen.getByTestId('cockpit-card-details-dismiss'));
    // The re-read after a successful discard is the provider's post-dismiss state.
    apiMock.cockpitCards.mockResolvedValue(okResponse({ cards: [other] }));
    fireEvent.click(screen.getByTestId('cockpit-card-details-dismiss-confirm'));

    await waitFor(() => expect(apiMock.cockpitDismissCard).toHaveBeenCalledTimes(1));
    expect(apiMock.cockpitDismissCard.mock.calls[0]?.[0]).toEqual({
      cardId: 'fixture:ask',
      revision: 1,
    });
    // The dismissal went through its own channel: no option answer was sent.
    expect(apiMock.cockpitConfirmCard).not.toHaveBeenCalled();

    // The card is gone, the drawer that was reading it is closed, the remaining card keeps its
    // place, and the list states the dismissal.
    await waitFor(() => expect(screen.queryByTestId('cockpit-card-details')).toBeNull());
    expect(screen.queryByTestId('cockpit-card-fixture:ask')).toBeNull();
    expect(screen.getByTestId('cockpit-card-fixture:fix')).toBeTruthy();
    expect(reading().visibleCardIds).toEqual(['fixture:fix']);
    expect(reading().detailsOpenCardId).toBeNull();
    const notice = screen.getByTestId('cockpit-card-dismiss-notice');
    expect(notice.getAttribute('data-ok')).toBe('true');
  });

  it('keeps the card in the sheet when the discard fails, then retries from the same control', async () => {
    await openPhoneDetails();
    apiMock.cockpitDismissCard.mockRejectedValueOnce(new Error('gateway answered 502'));

    fireEvent.click(screen.getByTestId('cockpit-card-details-dismiss'));
    fireEvent.click(screen.getByTestId('cockpit-card-details-dismiss-confirm'));

    await waitFor(() =>
      expect(apiMock.cockpitDismissCard).toHaveBeenCalledTimes(1),
    );
    const failed = await screen.findByTestId('cockpit-card-details-dismiss-notice');
    expect(failed.getAttribute('data-ok')).toBe('false');
    expect(failed.textContent).toContain('502');
    // The dismissal did not happen: the drawer, the card and the option's own bar remain.
    expect(screen.getByTestId('cockpit-card-details')).toBeTruthy();
    expect(screen.getByTestId('cockpit-card-fixture:ask')).toBeTruthy();
    expect(screen.getByTestId('cockpit-card-details-confirm')).toBeTruthy();

    // Retry starts again at the first press and settles through the dismiss channel.
    apiMock.cockpitCards.mockResolvedValue(okResponse({ cards: [] }));
    fireEvent.click(screen.getByTestId('cockpit-card-details-dismiss'));
    fireEvent.click(screen.getByTestId('cockpit-card-details-dismiss-confirm'));
    await waitFor(() => expect(apiMock.cockpitDismissCard).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId('cockpit-card-details')).toBeNull());
    expect(screen.queryByTestId('cockpit-card-fixture:ask')).toBeNull();
  });

  it('quotes the assistant’s own words with the link back into the session', async () => {
    await openPhoneDetails();

    const quote = screen.getByTestId('cockpit-card-assistant-quote');
    expect(quote.textContent).toBe('继续');
    const link = screen.getByTestId('cockpit-card-quote-session-link');
    expect(link.textContent).toBe('in session');
    expect(link.getAttribute('href')).toBe('/session/fixture-session');
  });
});

describe('the brief section', () => {
  it('draws no brief area when the brief feature is off', async () => {
    await openPhoneDetails();

    // The read DID happen (the drawer always asks); the answer was 「disabled」.
    await waitFor(() => expect(apiMock.cockpitCardBrief).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId('cockpit-card-details-brief')).toBeNull();
    expect(screen.queryByTestId('cockpit-brief-fallback')).toBeNull();
    expect(screen.queryByTestId('cockpit-brief')).toBeNull();
  });

  it('draws the brief section for a generated brief, so the gate is the status and not the section', async () => {
    apiMock.cockpitCardBrief.mockResolvedValue(okResponse(BRIEF_GENERATED));
    await openPhoneDetails();

    const section = await screen.findByTestId('cockpit-card-details-brief');
    expect(within(section).getByTestId('cockpit-brief').getAttribute('data-brief-status')).toBe(
      'generated',
    );
  });
});

describe('the wide-screen reading', () => {
  it('caps the Details inner container at max-w-3xl and centres it at a PC width', async () => {
    restoreViewport = setViewportWidth(1600);
    renderCockpit('/cockpit?view=cards');
    const card = await screen.findByTestId('cockpit-card-fixture:ask');
    fireEvent.click(within(card).getByTestId('cockpit-card-zone-a'));
    await screen.findByTestId('cockpit-card-details');

    // PC draws the floating centred card, not the phone sheet.
    expect(screen.getByTestId('cockpit-card-details').getAttribute('data-drawer')).toBe('false');
    const inner = screen.getByTestId('cockpit-card-details-inner');
    expect(inner.className).toContain('max-w-3xl');
    expect(inner.className).toContain('mx-auto');
  });

  it('hides the whole BRIEF section when the read produced no brief', async () => {
    apiMock.cockpitCardBrief.mockResolvedValue(okResponse(BRIEF_UNSUPPORTED));
    await openPhoneDetails();
    await waitFor(() => expect(apiMock.cockpitCardBrief).toHaveBeenCalledTimes(1));
    await act(async () => {
      await Promise.resolve();
    });

    // Not the heading, not 「No model brief」, and not the developer-facing reason the live page
    // leaked (`unsupported-content` is a judgement about the card, not a reading for the person).
    expect(screen.queryByTestId('cockpit-card-details-brief')).toBeNull();
    expect(screen.queryByText('Brief')).toBeNull();
    expect(screen.queryByText('No model brief for this card.')).toBeNull();
    expect(screen.queryByTestId('cockpit-brief-fallback')).toBeNull();
    expect(screen.queryByText(i18n.t('cockpit.briefReasonUnsupportedContent'))).toBeNull();
  });
});

describe('the phone cards page states an incomplete provider read', () => {
  it('draws the warning beside the cards and keeps Details working from the same list', async () => {
    restoreViewport = setViewportWidth(390);
    apiMock.cockpitCards.mockResolvedValue(
      okResponse({
        cards: [CARD],
        diagnostics: [
          {
            provider: 'quay-fleet',
            ok: true,
            reason: 'read output was cut at the 8 MiB bound',
            cards: 1,
            skippedLines: 0,
            cached: false,
            truncated: true,
          },
        ],
      }),
    );
    renderCockpit('/cockpit?view=cards');

    const warning = await screen.findByTestId('cockpit-card-provider-warning');
    expect(warning.textContent).toContain('read output was cut at the 8 MiB bound');
    // The salvaged card is real and opens its sheet; the warning does not hide the wall.
    const card = screen.getByTestId('cockpit-card-fixture:ask');
    expect(card).toBeTruthy();
    fireEvent.click(within(card).getByTestId('cockpit-card-zone-a'));
    expect(await screen.findByTestId('cockpit-card-details')).toBeTruthy();
    expect(screen.queryByTestId('cockpit-card-provider-error')).toBeNull();
  });
});

describe('the phone shell around the cards', () => {
  it('draws one status row from the existing fleet and deploy readings', async () => {
    restoreViewport = setViewportWidth(390);
    renderCockpit('/cockpit?view=cards');

    const status = await screen.findByTestId('cockpit-phone-status');
    await waitFor(() => expect(screen.getByTestId('cockpit-phone-status-deploy')).toBeTruthy());

    expect(within(status).getByTestId('cockpit-phone-status-driver').getAttribute('data-driver')).toBe(
      'running',
    );
    // One landed fan-in attempt; the failed one is not a landing.
    expect(within(status).getByTestId('cockpit-phone-status-landed').getAttribute('data-landed')).toBe(
      '1',
    );
    const suite = within(status).getByTestId('cockpit-phone-status-suite');
    expect(suite.getAttribute('data-suite')).toBe('green');
    expect(suite.getAttribute('data-ok')).toBe('true');
    const deploy = within(status).getByTestId('cockpit-phone-status-deploy');
    expect(deploy.getAttribute('data-deploy')).toBe('fresh');
    expect(deploy.getAttribute('data-ok')).toBe('true');
    expect(within(status).getByTestId('cockpit-phone-status-todo').getAttribute('data-todo')).toBe('2');
  });

  it('draws a one-line input whose send button appears only when there is content', async () => {
    restoreViewport = setViewportWidth(390);
    renderCockpit('/cockpit?view=cards');

    const form = await screen.findByTestId('cockpit-input');
    expect(form.getAttribute('data-single-line')).toBe('true');
    const textarea = within(form).getByRole('textbox');
    expect(textarea.getAttribute('rows')).toBe('1');

    const submitName = i18n.t('cockpit.intentSubmit');
    expect(within(form).queryByRole('button', { name: submitName })).toBeNull();

    fireEvent.change(textarea, { target: { value: 'open the board' } });
    expect(within(form).getByRole('button', { name: submitName })).toBeTruthy();
  });
});
