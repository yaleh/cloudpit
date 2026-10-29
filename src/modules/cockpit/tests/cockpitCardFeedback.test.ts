import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it } from 'vitest';

import type { Clock, CockpitCard, CockpitCardFeedback } from '@/shared/types';
import { i18n } from '@/modules/i18n';
import CockpitCardView from '@/modules/cockpit/CockpitCard';
import CockpitCardDetails from '@/modules/cockpit/CockpitCardDetails';
import {
  FEEDBACK_LOCKED_REASON,
  awaitingFeedbackCount,
  canResendFeedback,
  feedbackPhaseOf,
  isFeedbackLocked,
} from '@/modules/cockpit/cockpitCardFeedback';
import {
  cockpitCardsReading,
  confirmTargetOf,
  createCockpitCardController,
} from '@/modules/cockpit/cockpitCardController';
import type { CockpitCardController, CockpitCardShown } from '@/modules/cockpit/cockpitCardController';

/**
 * The card feedback lifecycle's client reading, proven with an injected clock and no React.
 *
 * Each case is one AC leg:
 *
 *   · a card whose feedback was sent keeps its place (same order, same id list), dimmed, with its
 *     options and confirmation locked;
 *   · the resend control does not exist before the 120-second mark and does at it;
 *   · after a matching receipt the card reads exactly what the provider's list states;
 *   · the header count is the number of cards waiting for a receipt.
 *
 * The clock advances time for real (timeouts and repeating intervals), so the controller's
 * one-second feedback tick is exercised rather than bypassed.
 */

const NOW = Date.parse('2026-10-27T00:10:00.000Z');
const AT = new Date(NOW).toISOString();

/**
 * A clock whose timers only fire when the test advances them. Intervals repeat: the controller
 * arms a one-second tick while a card waits for a receipt, and the phase has to move by itself.
 */
function manualClock(): Clock & { advance: (milliseconds: number) => void } {
  let now = NOW;
  let nextHandle = 1;
  const timeouts = new Map<number, { at: number; run: () => void }>();
  const intervals = new Map<number, { every: number; at: number; run: () => void }>();

  const runDue = (): void => {
    for (;;) {
      let due: { handle: number; at: number; run: () => void } | null = null;
      for (const [handle, timer] of timeouts) {
        if (timer.at <= now && (due === null || timer.at < due.at)) due = { handle, ...timer };
      }
      for (const [handle, timer] of intervals) {
        if (timer.at <= now && (due === null || timer.at < due.at)) due = { handle, ...timer };
      }
      if (due === null) return;
      if (intervals.has(due.handle)) {
        const interval = intervals.get(due.handle);
        if (interval === undefined) return;
        interval.at += interval.every;
        interval.run();
      } else {
        timeouts.delete(due.handle);
        due.run();
      }
    }
  };

  return {
    setTimeout: (callback, milliseconds) => {
      const handle = nextHandle++;
      timeouts.set(handle, { at: now + milliseconds, run: callback });
      return handle;
    },
    clearTimeout: (handle) => {
      timeouts.delete(handle as number);
    },
    setInterval: (callback, milliseconds) => {
      const handle = nextHandle++;
      intervals.set(handle, { every: milliseconds, at: now + milliseconds, run: callback });
      return handle;
    },
    clearInterval: (handle) => {
      intervals.delete(handle as number);
    },
    now: () => now,
    advance: (milliseconds) => {
      now += milliseconds;
      runDue();
    },
  };
}

function card(id: string, overrides: Partial<CockpitCard> = {}): CockpitCard {
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
    options: [
      {
        id: 'one',
        label: 'One',
        does: 'One does something',
        suggested: true,
        source: 'assistant',
        action: { executor: 'test.exec', params: { optionId: 'one' } },
      },
      {
        id: 'two',
        label: 'Two',
        does: 'Two does something',
        suggested: false,
        source: 'provider',
        action: { executor: 'test.exec', params: { optionId: 'two' } },
      },
    ],
    ...overrides,
  };
}

function feedbackOn(
  target: CockpitCard,
  overrides: Partial<CockpitCardFeedback> = {},
): CockpitCard {
  return {
    ...target,
    feedback: {
      cardId: target.id,
      revision: target.revision,
      feedbackId: `feedback-${target.id}`,
      optionId: 'one',
      label: 'One',
      sentAt: AT,
      outcome: { executor: 'test.exec', ok: true },
      canResend: true,
      ...overrides,
    },
  };
}

/** Binds a controller over a mutable card list, recording every resend request. */
function bind(cards: CockpitCard[], clock: Clock): {
  controller: CockpitCardController;
  resends: string[];
  setCards: (next: CockpitCard[]) => void;
} {
  let current = cards;
  const resends: string[] = [];
  const controller = createCockpitCardController({
    fetchCards: () => Promise.resolve(current.map((entry) => structuredClone(entry))),
    confirm: () => Promise.resolve({ executor: 'test.exec', result: {} }),
    resendFeedback: (cardId) => {
      resends.push(cardId);
      return Promise.resolve({ ok: true });
    },
    clock,
    refreshIntervalMs: 0,
  });
  return {
    controller,
    resends,
    setCards: (next) => {
      current = next;
    },
  };
}

describe('cockpit card feedback lifecycle', () => {
  it('keeps a sent card in place and locks its options and confirmation', async () => {
    const clock = manualClock();
    const before = [card('a'), card('b'), card('c')];
    const { controller, setCards } = bind(before, clock);

    await controller.load();
    const idsBefore = controller.getSnapshot().cards.map((entry) => entry.id);
    expect(idsBefore).toEqual(['a', 'b', 'c']);

    // The overlay arrives on the MIDDLE card: its revision is unchanged, so it keeps its place.
    setCards([card('a'), feedbackOn(card('b')), card('c')]);
    await controller.load();

    const snapshot = controller.getSnapshot();
    expect(snapshot.cards.map((entry) => entry.id)).toEqual(idsBefore);
    expect(snapshot.visibleCards.map((entry) => entry.id)).toEqual(idsBefore);
    expect(snapshot.feedbackPhases.b).toBe('sent');
    expect(snapshot.awaitingFeedback).toBe(1);
    expect(isFeedbackLocked(snapshot.cards[1]!)).toBe(true);

    // Options and confirmation are locked: the shown reading does not move, the target refuses.
    expect(snapshot.targets.b?.disabled).toBe(true);
    expect(snapshot.targets.b?.disabledReason).toBe(FEEDBACK_LOCKED_REASON);
    controller.showOption('b', 'two');
    expect(controller.getSnapshot().shown.b).toEqual({ kind: 'option', optionId: 'one' });
    expect(controller.requestConfirm('b')).toBe(false);
    expect(controller.getSnapshot().sendCountdown).toBeNull();

    controller.dispose();
  });

  it('offers no resend before 120 seconds and offers it at the mark', async () => {
    const clock = manualClock();
    const { controller, resends } = bind([card('a'), feedbackOn(card('b'))], clock);
    await controller.load();

    expect(controller.getSnapshot().feedbackPhases.b).toBe('sent');
    expect(canResendFeedback(controller.getSnapshot().cards[1]!, clock.now())).toBe(false);
    expect(await controller.resendFeedback('b')).toBe(false);
    expect(resends).toEqual([]);

    clock.advance(119_999);
    expect(controller.getSnapshot().feedbackPhases.b).toBe('sent');
    expect(canResendFeedback(controller.getSnapshot().cards[1]!, clock.now())).toBe(false);
    expect(await controller.resendFeedback('b')).toBe(false);
    expect(resends).toEqual([]);

    clock.advance(1);
    expect(clock.now() - Date.parse(AT)).toBe(120_000);
    expect(controller.getSnapshot().feedbackPhases.b).toBe('unconfirmed');
    expect(canResendFeedback(controller.getSnapshot().cards[1]!, clock.now())).toBe(true);
    expect(await controller.resendFeedback('b')).toBe(true);
    expect(resends).toEqual(['b']);

    controller.dispose();
  });

  it('returns to the provider reading once a matching receipt arrives', async () => {
    const clock = manualClock();
    const sent = feedbackOn(card('b'));
    const { controller, setCards } = bind([card('a'), sent, card('c')], clock);
    await controller.load();
    expect(controller.getSnapshot().awaitingFeedback).toBe(1);

    // The provider's next reading carries the kept notice and no overlay: the card is back.
    setCards([
      card('a'),
      {
        ...card('b'),
        feedbackNotice: { cardId: 'b', feedbackId: 'feedback-b', kind: 'kept' },
      },
      card('c'),
    ]);
    await controller.load();

    const snapshot = controller.getSnapshot();
    expect(snapshot.cards.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(snapshot.cards[1]?.feedback).toBeUndefined();
    expect(snapshot.cards[1]?.feedbackNotice?.kind).toBe('kept');
    expect(snapshot.feedbackPhases.b).toBeUndefined();
    expect(snapshot.awaitingFeedback).toBe(0);
    expect(snapshot.targets.b?.disabled).toBe(false);
    expect(controller.requestConfirm('b')).toBe(true);
    expect(controller.getSnapshot().sendCountdown?.cardId).toBe('b');

    // The reading a scenario runner prints carries the same waiting count.
    expect(cockpitCardsReading(controller.getSnapshot()).awaitingFeedback).toBe(0);

    controller.cancelConfirm();
    controller.dispose();
  });

  it('counts every awaited receipt, and only cards waiting for one', async () => {
    const clock = manualClock();
    const cards = [
      card('a'),
      feedbackOn(card('b')),
      feedbackOn(card('c'), { feedbackId: 'feedback-c', canResend: false }),
      card('d'),
    ];
    const { controller } = bind(cards, clock);
    await controller.load();

    const snapshot = controller.getSnapshot();
    expect(snapshot.awaitingFeedback).toBe(2);
    expect(awaitingFeedbackCount(snapshot.cards)).toBe(2);
    expect(cockpitCardsReading(snapshot).awaitingFeedback).toBe(2);
    expect(snapshot.feedbackPhases).toEqual({ b: 'sent', c: 'sent' });
    // A provider with no feedback executor still locks the card; its reason is what the button says.
    expect(snapshot.cards[2]?.feedback?.canResend).toBe(false);

    controller.dispose();
  });

  it('reads the phase from the injected clock, not from the wall clock', () => {
    const feedback = feedbackOn(card('b')).feedback!;
    expect(feedbackPhaseOf(feedback, Date.parse(AT))).toBe('sent');
    expect(feedbackPhaseOf(feedback, Date.parse(AT) + 119_999)).toBe('sent');
    expect(feedbackPhaseOf(feedback, Date.parse(AT) + 120_000)).toBe('unconfirmed');
  });
});

/**
 * The card's SENT STATE as the person reads it, rendered against the real i18n bundle.
 *
 * These are the three readings the task's presentation fixes: a sent card has no confirm bar
 * (the action already ran), ONE phase sentence that swaps at the injected clock's two-minute
 * mark, and amber ONLY for a feedback call that actually failed. `now` is the same injected
 * clock reading the component receives from the controller — nothing here waits.
 */
const SHOWN: CockpitCardShown = { kind: 'option', optionId: 'one' };

function renderFeedbackCard(target: CockpitCard, now: number): HTMLElement {
  const { container } = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(CockpitCardView, {
        card: target,
        now,
        shown: SHOWN,
        target: confirmTargetOf(target, SHOWN, ''),
        ownReply: '',
        dropdownOpen: false,
        selected: false,
        density: 'cards',
        onSelect: () => undefined,
        onOpenDetails: () => undefined,
        onToggleDropdown: () => undefined,
        onShowOption: () => undefined,
        onShowOwnReply: () => undefined,
        onOwnReplyChange: () => undefined,
        onRequestConfirm: () => undefined,
      }),
    ),
  );
  return container;
}

function renderFeedbackDetails(target: CockpitCard, now: number): HTMLElement {
  const { container } = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(CockpitCardDetails, {
        card: target,
        now,
        onClose: () => undefined,
        shown: SHOWN,
        target: confirmTargetOf(target, SHOWN, ''),
      }),
    ),
  );
  return container;
}

describe('a sent card is one status line, not a disabled confirm bar', () => {
  afterEach(() => cleanup());

  it('draws no confirm bar on a sent card, nor in its Details variant', () => {
    const sent = feedbackOn(card('b'));
    renderFeedbackCard(sent, Date.parse(AT));
    expect(screen.queryByTestId('cockpit-card-confirm')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-confirm-bar')).toBeNull();
    cleanup();

    renderFeedbackDetails(sent, Date.parse(AT));
    expect(screen.queryByTestId('cockpit-card-details-confirm')).toBeNull();
    expect(screen.queryByTestId('cockpit-card-details-confirm-bar')).toBeNull();
  });

  it('states the sent phase as ONE sentence and swaps it for the 2-minute reading', () => {
    const sent = feedbackOn(card('b'));
    renderFeedbackCard(sent, Date.parse(AT));
    const waiting = screen.getByTestId('cockpit-card-feedback-sent');
    expect(waiting.textContent).toContain('waiting for the fleet');
    expect(waiting.textContent).not.toContain('no receipt after 2 minutes');
    expect(screen.getAllByTestId('cockpit-card-feedback-sent')).toHaveLength(1);
    cleanup();

    renderFeedbackCard(sent, Date.parse(AT) + 120_000);
    const unconfirmed = screen.getByTestId('cockpit-card-feedback-sent');
    expect(unconfirmed.textContent).toContain('no receipt after 2 minutes');
    expect(unconfirmed.textContent).not.toContain('waiting for the fleet');
    expect(screen.getAllByTestId('cockpit-card-feedback-sent')).toHaveLength(1);
  });

  it('turns the status row amber ONLY for a real feedback-call failure', () => {
    const failed = feedbackOn(card('b'), { lastError: 'fleet unreachable' });
    renderFeedbackCard(failed, Date.parse(AT));
    const status = screen.getByTestId('cockpit-card-feedback-status');
    expect(status.className).toContain('amber');
    expect(screen.getByTestId('cockpit-card-feedback-error').textContent).toBe('fleet unreachable');
    cleanup();

    // The ordinary 「2 分钟无回执」 phase is neutral: no amber, no failure reason.
    renderFeedbackCard(feedbackOn(card('b')), Date.parse(AT) + 120_000);
    const waiting = screen.getByTestId('cockpit-card-feedback-status');
    expect(waiting.className).not.toContain('amber');
    expect(screen.queryByTestId('cockpit-card-feedback-error')).toBeNull();
  });

  it('does not dim the whole card while its feedback waits', () => {
    renderFeedbackCard(feedbackOn(card('b')), Date.parse(AT));
    expect(screen.getByTestId('cockpit-card-b').className).not.toContain('opacity-70');
  });
});
