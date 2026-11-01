import assert from 'node:assert/strict';

import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, test, vi } from 'vitest';

import { CockpitCardList } from '@/modules/cockpit';
import { i18n } from '@/modules/i18n';
import { attachScenarioSurface, detachScenarioSurface, scenarioWindow } from '@/modules/ui-scenario';
import type { ScenarioSurface } from '@/modules/ui-scenario';
import type * as SharedApi from '@/shared/api';
import type { CockpitCard } from '@/shared/types';

/**
 * The cards view's scenario surface: the reading the list publishes, and the six drive verbs
 * that press its controls.
 *
 * WHY THE REAL LIST IS THE FIXTURE. `data-cockpit-cards` is published by `CockpitCardList` from
 * the controller's own snapshot; hand-writing that attribute would only prove this test agrees
 * with itself. The list is rendered with its HTTP seam stubbed, so the reading under test is the
 * product's declaration, and the buttons the drive verbs press are the product's buttons.
 *
 * THE CLICK LEDGER IS THE FALSIFICATION ARM. Every press/keystroke the drive verbs make is
 * recorded off the rendered DOM. A verb that wrote the reading directly (instead of pressing a
 * control) would still move the reading, but the ledger would stay empty — that is what makes
 * 「the verb went through the control」 an observation rather than a claim.
 */

const apiMock = vi.hoisted(() => ({
  cockpitCards: vi.fn(),
  cockpitConfirmCard: vi.fn(),
  cockpitDismissCard: vi.fn(),
}));

vi.mock('@/shared/api', async (importOriginal) => {
  const actual = await importOriginal<typeof SharedApi>();
  return {
    ...actual,
    api: {
      ...actual.api,
      cockpitCards: apiMock.cockpitCards,
      cockpitConfirmCard: apiMock.cockpitConfirmCard,
      cockpitDismissCard: apiMock.cockpitDismissCard,
    },
  };
});

/** A body the API seam's `readApiJson` accepts without a real network or a `Response` class. */
function answer(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as unknown as Response;
}

const NEED_CARD: CockpitCard = {
  id: 'fixture:need',
  provider: 'fixture',
  revision: 1,
  kind: 'need',
  group: 'rescue',
  rank: 1,
  state: 'open',
  waitingSince: '2026-10-27T00:03:00.000Z',
  surfacedAt: '2026-10-27T00:03:05.000Z',
  subject: { uri: 'cloudcli://fixture/need', project: 'fixture-project' },
  ask: 'The deploy step needs a credential only you can provide.',
  facts: [],
  options: [
    {
      id: 'provide',
      label: 'Provide the credential',
      does: 'Open the secret form and continue the deploy.',
      suggested: true,
      source: 'assistant',
      action: { executor: 'fixture.record', params: { cardId: 'fixture:need', optionId: 'provide' } },
    },
    {
      id: 'later',
      label: 'Later',
      does: 'Leave the deploy parked.',
      suggested: false,
      source: 'provider',
      action: { executor: 'fixture.record', params: { cardId: 'fixture:need', optionId: 'later' } },
    },
  ],
  ownReply: { executor: 'fixture.record', params: { cardId: 'fixture:need', ownReply: true } },
};

/** The card with no suggested option: nothing is shown and its confirmation is unavailable. */
const DECISION_CARD: CockpitCard = {
  id: 'fixture:decision',
  provider: 'fixture',
  revision: 1,
  kind: 'decision',
  group: 'ruling',
  rank: 3,
  state: 'open',
  waitingSince: '2026-10-27T00:04:00.000Z',
  surfacedAt: '2026-10-27T00:04:05.000Z',
  subject: { uri: 'cloudcli://fixture/decision', project: 'fixture-project' },
  ask: 'Which release channel should this build use?',
  facts: [],
  options: [
    {
      id: 'stable',
      label: 'Stable',
      does: 'Release on the stable channel.',
      suggested: false,
      source: 'judge',
      action: { executor: 'fixture.record', params: { cardId: 'fixture:decision', optionId: 'stable' } },
    },
    {
      id: 'canary',
      label: 'Canary',
      does: 'Release to the canary channel first.',
      suggested: false,
      source: 'provider',
      action: { executor: 'fixture.record', params: { cardId: 'fixture:decision', optionId: 'canary' } },
    },
  ],
};

/** A session-ask card: the only kind that carries the card-level 「忽略/丢弃」 target. */
const ASK_CARD: CockpitCard = {
  id: 'fixture:ask',
  provider: 'fixture',
  revision: 1,
  kind: 'ask',
  group: 'ruling',
  rank: 2,
  state: 'open',
  waitingSince: '2026-10-27T00:06:00.000Z',
  surfacedAt: '2026-10-27T00:06:03.000Z',
  subject: { uri: 'cloudcli://fixture/ask', project: 'fixture-project' },
  ask: 'Should the cleanup delete the staging directory?',
  facts: [],
  options: [
    {
      id: 'delete',
      label: 'Delete staging',
      does: 'Remove the staging directory after the archive is verified.',
      suggested: true,
      source: 'assistant',
      action: { executor: 'fixture.record', params: { cardId: 'fixture:ask', optionId: 'delete' } },
    },
    {
      id: 'keep',
      label: 'Keep staging',
      does: 'Leave the directory for a later inspection.',
      suggested: false,
      source: 'provider',
      action: { executor: 'fixture.record', params: { cardId: 'fixture:ask', optionId: 'keep' } },
    },
  ],
  ownReply: { executor: 'fixture.record', params: { cardId: 'fixture:ask', ownReply: true } },
};

/** What the drive verbs pressed/typed, in order — the falsification ledger. */
type ClickLedger = {
  pointerdowns: string[];
  clicks: string[];
  inputs: string[];
};

const CARD_LIST = [NEED_CARD, DECISION_CARD];

function renderCards(): { surface: ScenarioSurface; ledger: ClickLedger; container: HTMLElement } {
  assert.equal(attachScenarioSurface(), true, 'the runtime lock is open in this file');
  // The list is a routed container: its binding navigates to the conversation a `session.start`
  // confirmation opens. Mount it in the same context the product's page gives it, so the fixture
  // exercises the real binding rather than a router-less approximation of it.
  const view = render(
    React.createElement(
      MemoryRouter,
      null,
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(
          'div',
          { 'data-testid': 'cockpit-page', 'data-cockpit-view': 'cards' },
          React.createElement(CockpitCardList),
        ),
      ),
    ),
  );
  const surface = scenarioWindow().__cloudpitScenario;
  assert.notEqual(surface, undefined, 'attachScenarioSurface must install the surface');

  const ledger: ClickLedger = { pointerdowns: [], clicks: [], inputs: [] };
  const testIdOf = (target: EventTarget | null): string => {
    if (!(target instanceof Element)) return '';
    const control = target.closest('[data-testid]');
    return control instanceof Element ? control.getAttribute('data-testid') ?? '' : '';
  };
  view.container.addEventListener(
    'pointerdown',
    (event) => ledger.pointerdowns.push(testIdOf(event.target)),
    true,
  );
  view.container.addEventListener(
    'click',
    (event) => ledger.clicks.push(testIdOf(event.target)),
    true,
  );
  view.container.addEventListener(
    'input',
    (event) => ledger.inputs.push(testIdOf(event.target)),
    true,
  );
  return { surface: surface!, ledger, container: view.container };
}

/**
 * Crosses one task boundary, which is where React 18 commits a discrete event's update.
 *
 * Used only to observe the half-open state of a confirmation — the card's own bar between its
 * opening press and the countdown's send (or `settle`'s second press for an irreversible option).
 */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Waits until the list's first read has published its cards. */
async function waitForLoaded(surface: ScenarioSurface): Promise<void> {
  await waitFor(() => {
    assert.equal(surface.read().cockpit.cards?.cards.length, CARD_LIST.length);
  });
}

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

beforeEach(() => {
  detachScenarioSurface();
  window.localStorage.setItem('ui-scenario', 'on');
  apiMock.cockpitCards.mockReset();
  apiMock.cockpitCards.mockResolvedValue(answer({ cards: CARD_LIST }));
  apiMock.cockpitConfirmCard.mockReset();
  apiMock.cockpitConfirmCard.mockImplementation(
    async (request: { cardId: string; optionId?: string; replyText?: string }) =>
      answer({
        ok: true,
        cardId: request.cardId,
        executor: 'fixture.record',
        params: request,
        result: { recorded: request, total: 1 },
      }),
  );
  apiMock.cockpitDismissCard.mockReset();
  apiMock.cockpitDismissCard.mockImplementation(
    async (request: { cardId: string; revision: number }) =>
      answer({
        ok: true,
        cardId: request.cardId,
        executor: 'fixture.feedback',
        params: { ...request, dismiss: true },
        result: { receipt: { disposition: 'dismissed' } },
      }),
  );
});

afterEach(() => {
  cleanup();
  detachScenarioSurface();
  window.localStorage.removeItem('ui-scenario');
});

test('AC1: the reading is the list declaration — fields and visible order', async () => {
  const { surface } = renderCards();
  await waitForLoaded(surface);

  const cards = surface.read().cockpit.cards;
  assert.notEqual(cards, null);
  assert.deepEqual(cards!.visibleCardIds, ['fixture:need', 'fixture:decision']);
  assert.equal(cards!.selectedCardId, 'fixture:need', 'the first visible card is selected initially');
  assert.equal(cards!.detailsOpenCardId, null);
  assert.equal(cards!.confirmOpenCardId, null);
  assert.equal(cards!.density, 'cards');
  assert.equal(cards!.typeFilter, 'all');
  assert.equal(cards!.projectFilter, null);

  assert.deepEqual(
    cards!.cards.map((card) => ({
      id: card.id,
      shown: card.shownOptionId,
      ownReply: card.ownReply,
      confirmOptionId: card.confirmOptionId,
      confirmLabel: card.confirmLabel,
    })),
    [
      {
        id: 'fixture:need',
        shown: 'provide',
        ownReply: false,
        confirmOptionId: 'provide',
        confirmLabel: 'Provide the credential',
      },
      {
        id: 'fixture:decision',
        shown: null,
        ownReply: false,
        confirmOptionId: null,
        confirmLabel: null,
      },
    ],
  );
});

test('AC1: an absent or malformed attribute reads as null, never as a guessed list', () => {
  assert.equal(attachScenarioSurface(), true);
  const surface = scenarioWindow().__cloudpitScenario!;

  const view = render(React.createElement('div', { 'data-testid': 'cockpit-page' }));
  assert.equal(surface.read().cockpit.cards, null, 'no cards view mounted');

  view.rerender(
    React.createElement(
      'div',
      { 'data-testid': 'cockpit-page' },
      React.createElement('div', { 'data-cockpit-cards': 'not json' }),
    ),
  );
  assert.equal(surface.read().cockpit.cards, null, 'unparseable attribute');

  view.rerender(
    React.createElement(
      'div',
      { 'data-testid': 'cockpit-page' },
      React.createElement('div', { 'data-cockpit-cards': '{"visibleCardIds":"fixture:need"}' }),
    ),
  );
  assert.equal(surface.read().cockpit.cards, null, 'a partial shape is not a reading');
});

test('AC1: the six drive verbs press the page controls and the reading follows', async () => {
  const { surface, ledger } = renderCards();
  await waitForLoaded(surface);

  // ── select: a pointer press on the second card's body ────────────────────────────────────
  surface.drive({ 'cockpitCard.select': 'fixture:decision' });
  await surface.settle();
  assert.equal(surface.read().cockpit.cards?.selectedCardId, 'fixture:decision');
  assert.ok(
    ledger.pointerdowns.includes('cockpit-card-fixture:decision'),
    'selecting was a pointer press on the second card, not a state write',
  );

  // ── showOption: dropdown trigger, then the option's own button ───────────────────────────
  surface.drive({ 'cockpitCard.showOption': { cardId: 'fixture:need', optionId: 'later' } });
  await surface.settle();
  const switched = surface.read().cockpit.cards?.cards.find((card) => card.id === 'fixture:need');
  assert.equal(switched?.shownOptionId, 'later');
  assert.equal(switched?.confirmOptionId, 'later');
  assert.equal(switched?.confirmLabel, 'Later');
  assert.ok(ledger.clicks.includes('cockpit-card-option-trigger'));
  assert.ok(ledger.clicks.includes('cockpit-card-option-later'));

  // ── openDetails: the upper body, which is the affordance ─────────────────────────────────
  surface.drive({ 'cockpitCard.openDetails': 'fixture:need' });
  await surface.settle();
  assert.equal(surface.read().cockpit.cards?.detailsOpenCardId, 'fixture:need');
  assert.ok(ledger.clicks.includes('cockpit-card-zone-a'));

  // ── ownReply: the dropdown's own-reply trigger, then typing into the editor ──────────────
  surface.drive({
    'cockpitCard.ownReply': { cardId: 'fixture:need', text: 'Keep it one more day.' },
  });
  await surface.settle();
  const replied = surface.read().cockpit.cards?.cards.find((card) => card.id === 'fixture:need');
  assert.equal(replied?.ownReply, true);
  assert.equal(replied?.confirmOptionId, null);
  assert.equal(replied?.confirmLabel, 'Keep it one more day.');
  assert.ok(ledger.clicks.includes('cockpit-card-own-reply-trigger'));
  assert.ok(ledger.inputs.includes('cockpit-card-own-reply-input'));

  // ── confirm: one press starts the countdown on the bar's own button ─────────────────────────
  const pressesBefore = ledger.clicks.filter((id) => id === 'cockpit-card-confirm').length;
  surface.drive({ 'cockpitCard.confirm': 'fixture:need' });
  // The bar's press is committed in React's microtask; one task boundary lets the card show.
  await nextTask();
  assert.equal(
    surface.read().cockpit.cards?.confirmOpenCardId,
    'fixture:need',
    'the first press turned the card\'s own bar into its countdown state',
  );
  const countdownButton = document.querySelector<HTMLButtonElement>(
    '[data-testid="cockpit-card-confirm"]',
  );
  assert.equal(countdownButton?.getAttribute('data-confirm-mode'), 'cancel');
  assert.equal(
    ledger.clicks.filter((id) => id === 'cockpit-card-confirm').length - pressesBefore,
    1,
    'a reversible option takes ONE press: the same button turns into the countdown, no send control',
  );
  // Cancel instead of waiting out the five seconds: a case here must stay inside the case budget
  // (scripts/test-timeout-margin-check.sh). The send-on-expiry path is pinned by the controller
  // cases under an injected clock and by the scenario/e2e runs, which drive the real 5 s.
  // The continuation `drive` left behind is deliberately not awaited: with the countdown
  // cancelled there is no pending bar, and `settle` would wait out its own control timeout.
  countdownButton?.click();
  await nextTask();
  assert.equal(
    surface.read().cockpit.cards?.confirmOpenCardId,
    null,
    'the same button cancelled the countdown',
  );
  assert.equal(apiMock.cockpitConfirmCard.mock.calls.length, 0, 'cancel before the deadline sends nothing');
  assert.equal(
    ledger.clicks.includes('cockpit-card-confirm-send'),
    false,
    'no separate send control exists: the bar cancels in place',
  );
});

test('AC1: the dismiss verb presses the card\'s own two-step control, sends no confirmation, and the card leaves', async () => {
  let dismissed = false;
  apiMock.cockpitDismissCard.mockImplementation(
    async (request: { cardId: string; revision: number }) => {
      dismissed = true;
      return answer({
        ok: true,
        cardId: request.cardId,
        executor: 'fixture.feedback',
        params: { ...request, dismiss: true },
        result: { receipt: { disposition: 'dismissed' } },
      });
    },
  );
  apiMock.cockpitCards.mockImplementation(async () =>
    answer({ cards: dismissed ? [NEED_CARD] : [NEED_CARD, ASK_CARD] }),
  );

  const { surface, ledger } = renderCards();
  await waitFor(() => {
    assert.deepEqual(surface.read().cockpit.cards?.visibleCardIds, ['fixture:need', 'fixture:ask']);
  });

  surface.drive({ 'cockpitCard.dismiss': 'fixture:ask' });
  await surface.settle();

  assert.deepEqual(
    surface.read().cockpit.cards?.visibleCardIds,
    ['fixture:need'],
    'the dismissed card left the visible list, and every other card stayed',
  );
  assert.equal(
    surface.read().cockpit.cards?.dismissNoticeOk,
    true,
    'the list-level answer outlives the card and reads as a success',
  );
  assert.deepEqual(
    apiMock.cockpitDismissCard.mock.calls,
    [[{ cardId: 'fixture:ask', revision: 1 }]],
    'exactly the dismiss channel ran, with the revision the page showed',
  );
  assert.equal(
    apiMock.cockpitConfirmCard.mock.calls.length,
    0,
    'a dismissal never reaches the confirmation channel',
  );
  assert.ok(ledger.clicks.includes('cockpit-card-dismiss'), 'the first press was the card\'s own control');
  assert.ok(
    ledger.clicks.includes('cockpit-card-dismiss-confirm'),
    'the second press was the bar\'s confirm, not a synthesized request',
  );
});

test('AC1: with the runtime lock closed the surface is not mounted', () => {
  window.localStorage.removeItem('ui-scenario');
  detachScenarioSurface();

  assert.equal(attachScenarioSurface(), false);
  assert.equal(scenarioWindow().__cloudpitScenario, undefined);
});
