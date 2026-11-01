import { describe, expect, it } from 'vitest';

import type {
  Clock,
  CockpitCard,
  CockpitCardFeedback,
  CockpitCardOption,
  CockpitKnowledgeCase,
} from '@/shared/types';
import {
  cockpitCardsReading,
  createCockpitCardController,
  defaultShownOption,
} from '@/modules/cockpit/cockpitCardController';
import {
  dismissTargetsOf,
  projectCountsOf,
  projectsOf,
  targetsOf,
  typeCountsOf,
  visibleCardsOf,
} from '@/modules/cockpit/cockpitCardDerived';
import { createCockpitCardsDefaultOnEvent } from '@/modules/cockpit/hooks/useCockpitCards';
import type {
  CockpitCardConfirmRequest,
  CockpitCardController,
  CockpitCardControllerDeps,
  CockpitCardControllerEvent,
  CockpitCardControllerSnapshot,
  CockpitCardFilterMemory,
  CockpitCardFilters,
  CockpitCardMemory,
  CockpitCardMemoryState,
} from '@/modules/cockpit/cockpitCardController';

/**
 * The card controller's rules, proven without React and without a server.
 *
 * Each case is one AC-424 leg: one confirmation bound to the shown option, switching the option
 * switching the target, the own-reply path sharing it, the confirm card standing between the
 * press and the request, cancel sending nothing, no suggestion meaning no default and no
 * confirmation, digits selecting only options, Escape untouched, and a new revision replacing
 * content in place without moving the selection or the scroll anchor.
 *
 * The two transports are plain closures that record what they were asked, so "exactly one
 * request" is a length assertion rather than a claim about the UI.
 */

const NOW = Date.parse('2026-10-27T00:10:00.000Z');

const FAKE_CLOCK: Clock = {
  setTimeout: () => 1,
  clearTimeout: () => undefined,
  setInterval: () => 2,
  clearInterval: () => undefined,
  now: () => NOW,
};

/**
 * A clock whose timers only fire when the test advances them.
 *
 * The confirm state's retreat is a rule about TIME, not about a component: it is armed on this
 * clock, so a criterion states "six seconds passed" by calling `advance` and observes the reading
 * — no `vi.useFakeTimers` and no React in the loop.
 */
function manualClock(): Clock & { advance: (milliseconds: number) => void; armed: () => number } {
  let now = NOW;
  let nextHandle = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimeout: (callback, milliseconds) => {
      const handle = nextHandle++;
      timers.set(handle, { at: now + milliseconds, run: callback });
      return handle;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    setInterval: () => nextHandle++,
    clearInterval: () => undefined,
    now: () => now,
    advance: (milliseconds) => {
      now += milliseconds;
      for (const [handle, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(handle);
          timer.run();
        }
      }
    },
    armed: () => timers.size,
  };
}

function option(
  id: string,
  label: string,
  overrides: Partial<CockpitCardOption> = {},
): CockpitCardOption {
  return {
    id,
    label,
    does: `${label} does something`,
    suggested: false,
    source: 'provider',
    action: { executor: 'test.exec', params: { optionId: id } },
    ...overrides,
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
    options: [option('one', 'One', { suggested: true }), option('two', 'Two')],
    ...overrides,
  };
}

/**
 * A card whose suggested option is irreversible, so it keeps the two-press confirmation.
 *
 * The delayed-send legs below use the plain `card()` (a reversible option); the two-press legs
 * use this one. That split IS the contract: a `warn`/`irreversible` option never enters the
 * countdown.
 */
function irreversibleCard(id = 'c1', overrides: Partial<CockpitCard> = {}): CockpitCard {
  return card(id, {
    options: [
      option('one', 'One', {
        suggested: true,
        tags: [{ kind: 'irreversible', text: 'cannot be undone' }],
      }),
      option('two', 'Two'),
    ],
    ...overrides,
  });
}

/** Lets the promise chain a confirmation starts run to its next await (and the read after it). */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type Harness = {
  controller: CockpitCardController;
  /** The confirmation requests the transport actually received, in order. */
  requests: CockpitCardConfirmRequest[];
  /** How many times the list was read. */
  reads: number;
  /** Replaces what the next read answers, simulating a provider-side revision. */
  setCards: (next: CockpitCard[]) => void;
  snapshot: () => CockpitCardControllerSnapshot;
};

function harness(
  initial: CockpitCard[],
  overrides: Partial<CockpitCardControllerDeps> = {},
): Harness {
  let cards = initial;
  const requests: CockpitCardConfirmRequest[] = [];
  let reads = 0;
  const controller = createCockpitCardController({
    fetchCards: async () => {
      reads += 1;
      return cards;
    },
    confirm: async (request) => {
      requests.push(request);
      return { executor: 'test.exec', result: { ok: true } };
    },
    clock: FAKE_CLOCK,
    // No background polling: a criterion re-reads by calling `load()` explicitly.
    refreshIntervalMs: 0,
    ...overrides,
  });
  return {
    controller,
    requests,
    get reads() {
      return reads;
    },
    setCards: (next) => {
      cards = next;
    },
    snapshot: controller.getSnapshot,
  };
}

describe('one confirmation, bound to the shown option', () => {
  it('shows the provider’s suggested option and targets exactly that option', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();

    const snapshot = h.snapshot();
    expect(snapshot.shown.c1).toEqual({ kind: 'option', optionId: 'one' });
    expect(snapshot.targets.c1).toMatchObject({
      cardId: 'c1',
      revision: 1,
      optionId: 'one',
      replyText: null,
      label: 'One',
      irreversible: false,
      disabled: false,
    });
  });

  it('switching the shown option switches the confirm target with no second write', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();

    h.controller.showOption('c1', 'two');

    const snapshot = h.snapshot();
    expect(snapshot.shown.c1).toEqual({ kind: 'option', optionId: 'two' });
    expect(snapshot.targets.c1).toMatchObject({ optionId: 'two', label: 'Two' });
    expect(h.requests).toHaveLength(0);

    expect(h.controller.requestConfirm()).toBe(true);
    // A reversible option's first press is a countdown, not a pending second press.
    expect(h.snapshot().sendCountdown).toMatchObject({ cardId: 'c1', revision: 1 });
    expect(h.snapshot().targets.c1?.label).toBe('Two');
  });

  it('cancels a running countdown when the shown option changes under it', async () => {
    const clock = manualClock();
    const h = harness([card('c1')], { clock });
    await h.controller.load();

    expect(h.controller.requestConfirm()).toBe(true);
    expect(h.snapshot().sendCountdown).toMatchObject({ cardId: 'c1' });

    h.controller.showOption('c1', 'two');
    expect(h.snapshot().sendCountdown).toBeNull();
    expect(h.snapshot().pendingConfirm).toBeNull();

    clock.advance(5_000);
    await flushMicrotasks();
    expect(h.requests).toHaveLength(0);
  });

  it('marks an irreversible option from the contract’s warn vocabulary', async () => {
    const h = harness([
      card('c1', {
        options: [
          option('one', 'One', { suggested: true }),
          option('park', 'Park', { tags: [{ kind: 'warn', text: '不可逆' }] }),
        ],
      }),
    ]);
    await h.controller.load();

    expect(h.snapshot().targets.c1?.irreversible).toBe(false);
    h.controller.showOption('c1', 'park');
    expect(h.snapshot().targets.c1?.irreversible).toBe(true);
  });
});

describe('an option whose executor is not declared is not confirmable', () => {
  it('disables the target, states why and sends nothing', async () => {
    const h = harness([
      card('c1', {
        options: [
          option('one', 'One', {
            suggested: true,
            confirmable: false,
            confirmableReason: '执行器 fleet.redispatch 尚未接入',
            action: { executor: 'fleet.redispatch', params: {} },
          }),
        ],
      }),
    ]);
    await h.controller.load();

    expect(h.snapshot().targets.c1).toMatchObject({
      optionId: 'one',
      disabled: true,
      disabledReason: '执行器 fleet.redispatch 尚未接入',
    });
    expect(h.controller.requestConfirm()).toBe(false);
    expect(h.snapshot().pendingConfirm).toBeNull();
    expect(await h.controller.confirm()).toBe(false);
    expect(h.requests).toHaveLength(0);
  });

  it('leaves a confirmable option enabled with no reason', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();

    expect(h.snapshot().targets.c1).toMatchObject({ disabled: false, disabledReason: null });
    expect(h.controller.requestConfirm()).toBe(true);
  });
});

describe('the confirm card gates the one request', () => {
  it('the first press only opens the confirm card; the second sends exactly once', async () => {
    // An irreversible option is the one that keeps the two-press confirmation.
    const h = harness([irreversibleCard()]);
    await h.controller.load();

    expect(h.controller.requestConfirm()).toBe(true);
    // Opening the confirm card is not a send.
    expect(h.requests).toHaveLength(0);
    // Nor is it a countdown: the warning option never sends by itself.
    expect(h.snapshot().sendCountdown).toBeNull();

    expect(await h.controller.confirm()).toBe(true);
    expect(h.requests).toEqual([{ cardId: 'c1', revision: 1, optionId: 'one' }]);
    expect(h.snapshot().pendingConfirm).toBeNull();

    // A third press has nothing pending to send.
    expect(await h.controller.confirm()).toBe(false);
    expect(h.requests).toHaveLength(1);
  });

  it('two concurrent confirmations produce one request', async () => {
    const h = harness([irreversibleCard()]);
    await h.controller.load();
    h.controller.requestConfirm();

    const [first, second] = await Promise.all([h.controller.confirm(), h.controller.confirm()]);

    expect([first, second]).toEqual([true, false]);
    expect(h.requests).toHaveLength(1);
  });

  it('cancel sends nothing and closes the confirm card', async () => {
    const h = harness([irreversibleCard()]);
    await h.controller.load();

    h.controller.requestConfirm();
    expect(h.controller.cancelConfirm()).toBe(true);

    expect(h.snapshot().pendingConfirm).toBeNull();
    expect(await h.controller.confirm()).toBe(false);
    expect(h.requests).toHaveLength(0);
  });

  it('re-reads after a confirmation so the provider’s new revision lands in place', async () => {
    const h = harness([irreversibleCard(), card('c2', { rank: 2 })]);
    await h.controller.load();
    const readsAfterLoad = h.reads;

    h.controller.requestConfirm();
    await h.controller.confirm();

    expect(h.reads).toBeGreaterThan(readsAfterLoad);
    expect(h.snapshot().lastOutcome).toMatchObject({ ok: true, executor: 'test.exec' });
  });
});

describe('the confirm state is in place and retreats by itself', () => {
  it('retreats after the six-second window with no second press, sending nothing', async () => {
    const clock = manualClock();
    // The retreat belongs to the irreversible option; a reversible one counts down instead.
    const h = harness([irreversibleCard()], { clock });
    await h.controller.load();

    expect(h.controller.requestConfirm()).toBe(true);
    expect(h.snapshot().pendingConfirm).not.toBeNull();

    // One millisecond short of the window the state is still open: the retreat is a deadline,
    // not a guess, and the person's second press still has its full time.
    clock.advance(5_999);
    expect(h.snapshot().pendingConfirm).not.toBeNull();

    clock.advance(1);
    expect(h.snapshot().pendingConfirm).toBeNull();
    expect(h.requests).toHaveLength(0);
    // With the state gone the bar is idle again: a press would open it anew, not send.
    expect(await h.controller.confirm()).toBe(false);
    expect(h.requests).toHaveLength(0);
  });

  it('disarms the retreat when the second press sends, and never sends twice', async () => {
    const clock = manualClock();
    const h = harness([irreversibleCard()], { clock });
    await h.controller.load();

    h.controller.requestConfirm();
    expect(await h.controller.confirm()).toBe(true);
    expect(clock.armed()).toBe(0);

    clock.advance(6_000);
    expect(h.snapshot().pendingConfirm).toBeNull();
    expect(h.requests).toHaveLength(1);
  });

  it('retreats when another card is selected, so the second press cannot land on it', async () => {
    const h = harness([irreversibleCard(), card('c2', { rank: 2 })]);
    await h.controller.load();
    h.controller.selectCard('c1');
    expect(h.controller.requestConfirm()).toBe(true);

    h.controller.selectCard('c2');

    expect(h.snapshot().pendingConfirm).toBeNull();
    expect(h.requests).toHaveLength(0);
  });

  it('keeps the state when the selection is re-affirmed on the same card', async () => {
    const h = harness([irreversibleCard()]);
    await h.controller.load();
    expect(h.controller.requestConfirm()).toBe(true);

    h.controller.selectCard('c1');

    expect(h.snapshot().pendingConfirm).not.toBeNull();
  });

  it('Enter twice is one send: the same key opens the state and sends from it', async () => {
    const h = harness([irreversibleCard()]);
    await h.controller.load();
    h.controller.selectCard('c1');

    expect(h.controller.handleKey('Enter')).toBe(true);
    expect(h.snapshot().pendingConfirm).not.toBeNull();
    expect(h.requests).toHaveLength(0);

    expect(h.controller.handleKey('Enter')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(h.requests).toEqual([{ cardId: 'c1', revision: 1, optionId: 'one' }]);
    expect(h.snapshot().pendingConfirm).toBeNull();
    expect(h.snapshot().confirming).toBe(false);
  });

  it('a held Enter after the send opens the state again instead of sending twice', async () => {
    const h = harness([irreversibleCard()]);
    await h.controller.load();
    h.controller.selectCard('c1');

    h.controller.handleKey('Enter');
    h.controller.handleKey('Enter');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const requestsAfterSend = h.requests.length;

    h.controller.handleKey('Enter');

    expect(requestsAfterSend).toBe(1);
    expect(h.snapshot().pendingConfirm).not.toBeNull();
    expect(h.requests).toHaveLength(1);
  });
});

describe('a reversible option sends after a five-second countdown', () => {
  it('sends nothing at 4.9 seconds and exactly once at the fifth', async () => {
    const clock = manualClock();
    const h = harness([card('c1')], { clock });
    await h.controller.load();

    expect(h.controller.requestConfirm()).toBe(true);
    expect(h.snapshot().sendCountdown).toMatchObject({
      cardId: 'c1',
      revision: 1,
      startedAt: NOW,
      firesAt: NOW + 5_000,
    });
    expect(h.snapshot().pendingConfirm).toBeNull();

    clock.advance(4_900);
    await flushMicrotasks();
    expect(h.requests).toHaveLength(0);
    expect(h.snapshot().confirming).toBe(false);

    clock.advance(100);
    await flushMicrotasks();
    expect(h.requests).toEqual([{ cardId: 'c1', revision: 1, optionId: 'one' }]);
    expect(h.snapshot().sendCountdown).toBeNull();
  });

  it('cancelConfirm inside the countdown sends nothing, and the expired clock still sends nothing', async () => {
    const clock = manualClock();
    const h = harness([card('c1')], { clock });
    await h.controller.load();

    h.controller.requestConfirm();
    expect(h.controller.cancelConfirm()).toBe(true);
    expect(h.snapshot().sendCountdown).toBeNull();

    clock.advance(5_000);
    await flushMicrotasks();
    expect(h.requests).toHaveLength(0);
    // Nothing is left to cancel either.
    expect(h.controller.cancelConfirm()).toBe(false);
  });

  it('cancels when the card’s revision moves under the countdown', async () => {
    const clock = manualClock();
    const h = harness([card('c1')], { clock });
    await h.controller.load();
    h.controller.requestConfirm();

    h.setCards([card('c1', { revision: 2 })]);
    await h.controller.load();

    expect(h.snapshot().sendCountdown).toBeNull();
    clock.advance(5_000);
    await flushMicrotasks();
    expect(h.requests).toHaveLength(0);
  });

  it('cancels when another card is selected', async () => {
    const clock = manualClock();
    const h = harness([card('c1'), card('c2', { rank: 2 })], { clock });
    await h.controller.load();
    h.controller.selectCard('c1');
    h.controller.requestConfirm();

    h.controller.selectCard('c2');

    expect(h.snapshot().sendCountdown).toBeNull();
    clock.advance(5_000);
    await flushMicrotasks();
    expect(h.requests).toHaveLength(0);
  });

  it('Enter during the countdown cancels instead of sending early', async () => {
    const clock = manualClock();
    const h = harness([card('c1')], { clock });
    await h.controller.load();
    h.controller.selectCard('c1');

    expect(h.controller.handleKey('Enter')).toBe(true);
    expect(h.snapshot().sendCountdown).not.toBeNull();
    expect(h.requests).toHaveLength(0);

    expect(h.controller.handleKey('Enter')).toBe(true);
    expect(h.snapshot().sendCountdown).toBeNull();

    clock.advance(5_000);
    await flushMicrotasks();
    expect(h.requests).toHaveLength(0);
  });

  it('a request already in flight cannot be cancelled, and it is not undone', async () => {
    const clock = manualClock();
    const sent: CockpitCardConfirmRequest[] = [];
    let release: (() => void) | undefined;
    const h = harness([card('c1')], {
      clock,
      confirm: (request) => {
        sent.push(request);
        return new Promise((resolve) => {
          release = () => resolve({ executor: 'test.exec', result: { ok: true } });
        });
      },
    });
    await h.controller.load();
    h.controller.requestConfirm();

    clock.advance(5_000);
    expect(sent).toHaveLength(1);
    expect(h.snapshot().confirming).toBe(true);
    // The bar that was counting down keeps drawing this card while the request runs.
    expect(h.snapshot().confirmingCardId).toBe('c1');

    expect(h.controller.cancelConfirm()).toBe(false);
    expect(h.snapshot().confirming).toBe(true);

    release?.();
    await flushMicrotasks();
    expect(sent).toEqual([{ cardId: 'c1', revision: 1, optionId: 'one' }]);
    expect(h.snapshot().lastOutcome).toMatchObject({ ok: true });
    expect(h.snapshot().confirming).toBe(false);
    expect(h.snapshot().confirmingCardId).toBeNull();
  });

  it('the person’s own reply goes through the countdown too', async () => {
    const clock = manualClock();
    const h = harness(
      [card('c1', { ownReply: { executor: 'reply.exec', params: { cardId: 'c1' } } })],
      { clock },
    );
    await h.controller.load();
    h.controller.setOwnReply('c1', 'ship it after the archive check');

    expect(h.controller.requestConfirm()).toBe(true);
    expect(h.snapshot().sendCountdown).toMatchObject({ cardId: 'c1' });

    clock.advance(5_000);
    await flushMicrotasks();
    expect(h.requests).toEqual([
      { cardId: 'c1', revision: 1, replyText: 'ship it after the archive check' },
    ]);
  });

  it('still sends after stop(): leaving the page is not a cancel', async () => {
    const clock = manualClock();
    const h = harness([card('c1')], { clock });
    await h.controller.load();
    h.controller.requestConfirm();

    // A route change runs the page effect's cleanup, which only calls `stop`.
    h.controller.stop();
    expect(h.snapshot().sendCountdown).not.toBeNull();

    clock.advance(5_000);
    await flushMicrotasks();
    expect(h.requests).toHaveLength(1);
  });

  it('an irreversible option never enters the countdown', async () => {
    const clock = manualClock();
    const h = harness([irreversibleCard()], { clock });
    await h.controller.load();

    expect(h.controller.requestConfirm()).toBe(true);
    expect(h.snapshot().sendCountdown).toBeNull();
    expect(h.snapshot().pendingConfirm).toMatchObject({ optionId: 'one' });

    clock.advance(6_000);
    await flushMicrotasks();
    expect(h.requests).toHaveLength(0);
  });
});

describe('a started conversation is announced', () => {
  it('emits sessionStarted with the new session id when the executor is session.start', async () => {
    const events: CockpitCardControllerEvent[] = [];
    const h = harness([irreversibleCard()], {
      confirm: async () => ({
        executor: 'session.start',
        result: { sessionId: 'new-42', projectPath: '/repos/p1' },
      }),
      onEvent: (event) => events.push(event),
    });
    await h.controller.load();

    h.controller.requestConfirm();
    expect(await h.controller.confirm()).toBe(true);

    expect(events).toEqual([{ type: 'sessionStarted', sessionId: 'new-42' }]);

    // The display stays on the cards page, so the card itself must carry the way to the
    // background conversation — including after the confirm's own re-read replaced the list.
    const card = h.snapshot().cards.find((candidate) => candidate.id === irreversibleCard().id);
    expect(card?.conversation).toEqual({ sessionId: 'new-42' });
  });

  it('the default binding listener does not navigate for a started conversation', () => {
    // The started session runs in the background: the binding keeps the page where the person
    // left it, and following the conversation is a deliberate press on the card's link.
    const navigated: string[] = [];
    const onEvent = createCockpitCardsDefaultOnEvent((path) => navigated.push(path));

    onEvent({ type: 'sessionStarted', sessionId: 'new-42' });

    expect(navigated).toEqual([]);
  });

  it('says nothing for any other executor, even one whose answer names a session', async () => {
    const events: CockpitCardControllerEvent[] = [];
    const h = harness([irreversibleCard()], {
      confirm: async () => ({
        executor: 'test.exec',
        result: { sessionId: 'not-a-start' },
      }),
      onEvent: (event) => events.push(event),
    });
    await h.controller.load();

    h.controller.requestConfirm();
    expect(await h.controller.confirm()).toBe(true);

    expect(events).toEqual([]);
  });

  it('says nothing when a failed confirmation answers', async () => {
    const events: CockpitCardControllerEvent[] = [];
    const h = harness([irreversibleCard()], {
      confirm: async () => {
        throw new Error('refused');
      },
      onEvent: (event) => events.push(event),
    });
    await h.controller.load();

    h.controller.requestConfirm();
    expect(await h.controller.confirm()).toBe(false);

    expect(events).toEqual([]);
    expect(h.snapshot().lastOutcome).toMatchObject({ ok: false, message: 'refused' });
  });
});

describe('the person’s own reply shares the confirmation path', () => {
  it('a drafted reply becomes the target and sends replyText, never an optionId', async () => {
    const clock = manualClock();
    const h = harness(
      [
        card('c1', {
          ownReply: { executor: 'reply.exec', params: { cardId: 'c1' } },
        }),
      ],
      { clock },
    );
    await h.controller.load();

    h.controller.setOwnReply('c1', 'ship it after the archive check');
    expect(h.snapshot().shown.c1).toEqual({ kind: 'ownReply' });
    expect(h.snapshot().targets.c1).toMatchObject({
      optionId: null,
      replyText: 'ship it after the archive check',
      label: 'ship it after the archive check',
      disabled: false,
    });

    // The reply is a reversible reading: it sends when the countdown expires.
    expect(h.controller.requestConfirm()).toBe(true);
    clock.advance(5_000);
    await flushMicrotasks();
    expect(h.requests).toEqual([
      { cardId: 'c1', revision: 1, replyText: 'ship it after the archive check' },
    ]);
  });

  it('an empty draft is not confirmable', async () => {
    const h = harness([
      card('c1', { ownReply: { executor: 'reply.exec', params: { cardId: 'c1' } } }),
    ]);
    await h.controller.load();

    h.controller.showOwnReply('c1');
    expect(h.snapshot().targets.c1).toMatchObject({ optionId: null, disabled: true });
    expect(h.controller.requestConfirm()).toBe(false);
  });

  it('a card that declares no own-reply executor offers no reply editor', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();

    h.controller.showOwnReply('c1');
    h.controller.setOwnReply('c1', 'text that cannot be sent');
    expect(h.snapshot().shown.c1).toEqual({ kind: 'option', optionId: 'one' });
  });
});

describe('no suggestion, no default', () => {
  it('shows nothing and leaves confirmation unavailable when no option is suggested', async () => {
    const h = harness([
      card('c1', {
        options: [option('one', 'One'), option('two', 'Two')],
      }),
    ]);
    await h.controller.load();

    const snapshot = h.snapshot();
    expect(snapshot.shown.c1).toBeUndefined();
    expect(snapshot.targets.c1).toBeUndefined();
    expect(defaultShownOption(snapshot.cards[0])).toBeNull();
    expect(h.controller.requestConfirm()).toBe(false);
    expect(h.snapshot().pendingConfirm).toBeNull();

    expect(await h.controller.confirm()).toBe(false);
    expect(h.requests).toHaveLength(0);
  });

  it('a judge-sourced suggested option IS the default and confirms only through the confirm bar', async () => {
    const clock = manualClock();
    const h = harness(
      [
        card('c1', {
          options: [
            option('one', 'One'),
            option('two', 'Two', {
              suggested: true,
              source: 'judge',
              why: 'The judge says this is the least risky next step.',
            }),
          ],
        }),
      ],
      { clock },
    );
    await h.controller.load();

    const snapshot = h.snapshot();
    expect(snapshot.shown.c1).toEqual({ kind: 'option', optionId: 'two' });
    expect(defaultShownOption(snapshot.cards[0])).toEqual({ kind: 'option', optionId: 'two' });
    expect(snapshot.targets.c1).toMatchObject({ optionId: 'two', label: 'Two', disabled: false });

    // A judge suggestion is only a preselection: the first press opens the bar's countdown.
    expect(h.controller.requestConfirm()).toBe(true);
    expect(h.requests).toHaveLength(0);
    expect(h.snapshot().sendCountdown).toMatchObject({ cardId: 'c1' });

    clock.advance(5_000);
    await flushMicrotasks();
    expect(h.requests).toEqual([{ cardId: 'c1', revision: 1, optionId: 'two' }]);
  });
});

describe('keys', () => {
  it('digits 1–9 change the shown option and never move the selection', async () => {
    const h = harness([
      card('c1', { options: [option('one', 'One', { suggested: true }), option('two', 'Two')] }),
      card('c2', { rank: 2 }),
    ]);
    await h.controller.load();
    expect(h.snapshot().selectedCardId).toBe('c1');

    expect(h.controller.handleKey('2')).toBe(true);
    expect(h.snapshot().shown.c1).toEqual({ kind: 'option', optionId: 'two' });
    expect(h.snapshot().selectedCardId).toBe('c1');

    // Out of range and non-digits are not consumed.
    expect(h.controller.handleKey('9')).toBe(false);
    expect(h.controller.handleKey('a')).toBe(false);
  });

  it('never handles Escape', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();
    h.controller.showOption('c1', 'two');

    expect(h.controller.handleKey('Escape')).toBe(false);
    // The cockpit consumed nothing, and nothing it owns changed.
    expect(h.snapshot().shown.c1).toEqual({ kind: 'option', optionId: 'two' });
    expect(h.snapshot().selectedCardId).toBe('c1');
  });
});

describe('a new revision updates in place', () => {
  it('replaces content by id, keeps the selection, the anchor and the provider order', async () => {
    const a = card('a');
    const b = card('b', { rank: 2 });
    const h = harness([a, b]);
    await h.controller.load();

    h.controller.selectCard('b');
    h.controller.setAnchor('a');

    h.setCards([{ ...a, revision: 2, ask: 'the question changed' }, b]);
    await h.controller.load();

    const snapshot = h.snapshot();
    expect(snapshot.cards.map((candidate) => candidate.id)).toEqual(['a', 'b']);
    expect(snapshot.cards[0]).toMatchObject({ revision: 2, ask: 'the question changed' });
    expect(snapshot.selectedCardId).toBe('b');
    expect(snapshot.anchorCardId).toBe('a');
  });

  it('closes a confirm card whose revision moved, instead of sending a stale revision', async () => {
    const a = irreversibleCard('a');
    const h = harness([a]);
    await h.controller.load();
    expect(h.controller.requestConfirm()).toBe(true);

    h.setCards([{ ...a, revision: 2 }]);
    await h.controller.load();

    expect(h.snapshot().pendingConfirm).toBeNull();
    expect(await h.controller.confirm()).toBe(false);
    expect(h.requests).toHaveLength(0);
  });
});

describe('filters keep provider order', () => {
  it('narrows by type and project, and moves the selection to the first visible card', async () => {
    const h = harness([
      card('ask', { kind: 'ask', options: [option('one', 'One', { suggested: true })] }),
      card('fix', {
        kind: 'fix',
        rank: 2,
        subject: { uri: 'cloudcli://test/fix', project: 'p2' },
        options: [option('apply', 'Apply', { suggested: true })],
      }),
      card('stuck', {
        kind: 'stuck',
        rank: 3,
        subject: { uri: 'cloudcli://test/stuck', project: 'p2' },
        options: [option('resume', 'Resume', { suggested: true })],
      }),
    ]);
    await h.controller.load();
    expect(h.snapshot().projects).toEqual(['p1', 'p2']);

    h.controller.setTypeFilter('ask');
    expect(h.snapshot().visibleCards.map((candidate) => candidate.id)).toEqual(['ask']);
    expect(h.snapshot().selectedCardId).toBe('ask');

    h.controller.setTypeFilter('all');
    h.controller.setProjectFilter('p2');
    expect(h.snapshot().visibleCards.map((candidate) => candidate.id)).toEqual(['fix', 'stuck']);
    expect(h.snapshot().selectedCardId).toBe('fix');
  });
});

describe('the card page returns to where it was', () => {
  /** The route memory a mounted page leaves behind; a plain object proves the seam. */
  function memoryHarness(): { remember: CockpitCardMemory; state: () => CockpitCardMemoryState | null } {
    let state: CockpitCardMemoryState | null = null;
    return {
      remember: {
        read: () => state,
        write: (next) => {
          state = { ...next };
        },
      },
      state: () => state,
    };
  }

  it('restores the selected card and the recorded scroll offset on the next visit', async () => {
    const memory = memoryHarness();
    const cards = [card('a'), card('b', { rank: 2 }), card('c', { rank: 3 })];

    // First visit: the person opens the page, selects the third card and scrolls down.
    const first = harness(cards, { remember: memory.remember });
    await first.controller.load();
    first.controller.selectCard('c');
    first.controller.setScrollPosition(420);
    expect(memory.state()).toEqual({ selectedCardId: 'c', scrollPosition: 420 });
    // The route unmounts on the way to a conversation.
    first.controller.dispose();

    // Back on the page: a NEW controller, as the route remounts one.
    const second = harness(cards, { remember: memory.remember });
    // The offset is known before the first read; the selection waits for the card list, which
    // does not exist yet (`normalize` cannot keep a selection it cannot see).
    expect(second.snapshot().scrollPosition).toBe(420);
    expect(second.snapshot().selectedCardId).toBeNull();

    await second.controller.load();
    expect(second.snapshot().selectedCardId).toBe('c');
    expect(second.snapshot().scrollPosition).toBe(420);
  });

  it('does not resurrect a remembered card the filters no longer show', async () => {
    const memory = memoryHarness();
    memory.remember.write({ selectedCardId: 'gone', scrollPosition: 90 });

    const h = harness([card('a'), card('b', { rank: 2 })], { remember: memory.remember });
    await h.controller.load();

    expect(h.snapshot().selectedCardId).toBe('a');
    expect(h.snapshot().scrollPosition).toBe(90);
  });

  it('starts at the top when the memory cannot be read', async () => {
    const h = harness([card('a')], {
      remember: {
        read: () => {
          throw new Error('storage is blocked');
        },
        write: () => undefined,
      },
    });
    await h.controller.load();

    expect(h.snapshot().scrollPosition).toBe(0);
    expect(h.snapshot().selectedCardId).toBe('a');
  });
});

describe('the type chips count what the project filter leaves', () => {
  /** Four open cards: two asks (p1/p2), one fix (p2) and one stuck card (p1). */
  function fourCards(): CockpitCard[] {
    return [
      card('a1', { kind: 'ask', rank: 1 }),
      card('a2', {
        kind: 'ask',
        rank: 2,
        subject: { uri: 'cloudcli://test/a2', project: 'p2' },
      }),
      card('f1', {
        kind: 'fix',
        rank: 3,
        subject: { uri: 'cloudcli://test/f1', project: 'p2' },
      }),
      card('s1', {
        kind: 'stuck',
        rank: 4,
        subject: { uri: 'cloudcli://test/s1', project: 'p1' },
      }),
    ];
  }

  it('counts each type over the open cards that survive the project selection', async () => {
    const h = harness(fourCards());
    await h.controller.load();

    // No project selection: every open card counts, per type.
    expect(h.snapshot().typeCounts).toMatchObject({ all: 4, ask: 2, fix: 1, stuck: 1 });

    // One project: only its cards remain, so the chips must fall to its counts.
    h.controller.toggleProjectFilter('p2');
    expect(h.snapshot().typeCounts).toMatchObject({ all: 2, ask: 1, fix: 1 });
    // The chip number IS the number of cards that type would show.
    for (const kind of ['ask', 'fix', 'stuck'] as const) {
      const visibleOfKind = h.snapshot().visibleCards.filter(
        (candidate) => candidate.kind === kind,
      ).length;
      expect(h.snapshot().typeCounts[kind] ?? 0, kind).toBe(visibleOfKind);
    }

    // A second project is a union of both selections, not a replacement.
    h.controller.toggleProjectFilter('p1');
    expect(h.snapshot().projectFilters).toEqual(['p2', 'p1']);
    expect(h.snapshot().typeCounts.all).toBe(4);

    // Clearing returns to every project.
    h.controller.clearProjectFilters();
    expect(h.snapshot().projectFilters).toEqual([]);
    expect(h.snapshot().visibleCards).toHaveLength(4);
  });

  it('counts each project over the cards the type filter leaves', async () => {
    const h = harness(fourCards());
    await h.controller.load();

    h.controller.setTypeFilter('ask');
    expect(h.snapshot().projectCounts).toEqual({ p1: 1, p2: 1 });

    h.controller.setTypeFilter('fix');
    expect(h.snapshot().projectCounts).toEqual({ p2: 1 });
  });
});

describe('the project selection is remembered per device', () => {
  /** The device-scoped store a browser would supply; a plain object proves the seam. */
  function filterMemoryHarness(): {
    memory: CockpitCardFilterMemory;
    state: () => CockpitCardFilters | null;
  } {
    let state: CockpitCardFilters | null = null;
    return {
      memory: {
        read: () => state,
        write: (next) => {
          state = { typeFilter: next.typeFilter, projectFilters: [...next.projectFilters] };
        },
      },
      state: () => state,
    };
  }

  const CARDS = [
    card('a', { rank: 1 }),
    card('b', { rank: 2, subject: { uri: 'cloudcli://test/b', project: 'p2' } }),
    card('c', { rank: 3, subject: { uri: 'cloudcli://test/c', project: 'p3' } }),
  ];

  it('restores a multi-project selection on a rebuilt controller', async () => {
    const memory = filterMemoryHarness();

    const first = harness(CARDS, { rememberFilters: memory.memory });
    await first.controller.load();
    first.controller.toggleProjectFilter('p2');
    first.controller.toggleProjectFilter('p3');

    expect(first.snapshot().projectFilters).toEqual(['p2', 'p3']);
    expect(first.snapshot().visibleCards.map((candidate) => candidate.id)).toEqual(['b', 'c']);
    expect(memory.state()).toEqual({ typeFilter: 'all', projectFilters: ['p2', 'p3'] });
    first.controller.dispose();

    // A new controller, as a reload mounts: the filter is known BEFORE the first read because
    // it needs no card list to be applied.
    const second = harness(CARDS, { rememberFilters: memory.memory });
    expect(second.snapshot().projectFilters).toEqual(['p2', 'p3']);
    await second.controller.load();
    expect(second.snapshot().visibleCards.map((candidate) => candidate.id)).toEqual(['b', 'c']);

    // Removing one project, and clearing, both persist.
    second.controller.toggleProjectFilter('p2');
    expect(memory.state()).toEqual({ typeFilter: 'all', projectFilters: ['p3'] });
    second.controller.clearProjectFilters();
    expect(memory.state()).toEqual({ typeFilter: 'all', projectFilters: [] });
  });

  it('persists the type filter and starts unfiltered when the memory cannot be read', async () => {
    const memory = filterMemoryHarness();
    const h = harness(CARDS, { rememberFilters: memory.memory });
    await h.controller.load();

    h.controller.setTypeFilter('ask');
    expect(memory.state()).toEqual({ typeFilter: 'ask', projectFilters: [] });

    const blocked = harness(CARDS, {
      rememberFilters: {
        read: () => {
          throw new Error('storage is blocked');
        },
        write: () => undefined,
      },
    });
    expect(blocked.snapshot().typeFilter).toBe('all');
    expect(blocked.snapshot().projectFilters).toEqual([]);
    await blocked.controller.load();
    expect(blocked.snapshot().visibleCards).toHaveLength(3);
  });

  it('the single-project shim replaces the whole set', async () => {
    const memory = filterMemoryHarness();
    const h = harness(CARDS, { rememberFilters: memory.memory });
    await h.controller.load();

    h.controller.setProjectFilter('p2');
    expect(h.snapshot().projectFilters).toEqual(['p2']);
    expect(h.snapshot().projectFilter).toBe('p2');
    expect(memory.state()).toEqual({ typeFilter: 'all', projectFilters: ['p2'] });

    h.controller.setProjectFilter(null);
    expect(h.snapshot().projectFilters).toEqual([]);
    expect(h.snapshot().projectFilter).toBeNull();
  });
});

describe('the over-long situation’s inline expansion is per card and per revision', () => {
  it('records the expansion by card id and toggles it back', async () => {
    const h = harness([card('a'), card('b', { rank: 2 })]);
    await h.controller.load();
    expect(h.snapshot().situationExpanded).toEqual({});

    h.controller.toggleSituationExpanded('a');
    expect(h.snapshot().situationExpanded).toEqual({ a: 1 });

    // A second card expands independently: one card's control never moves another's.
    h.controller.toggleSituationExpanded('b');
    expect(h.snapshot().situationExpanded).toEqual({ a: 1, b: 1 });

    h.controller.toggleSituationExpanded('a');
    expect(h.snapshot().situationExpanded).toEqual({ b: 1 });
  });

  it('resets the expansion when the card’s revision moves, and keeps it on a same-revision read', async () => {
    const h = harness([card('a')]);
    await h.controller.load();
    h.controller.toggleSituationExpanded('a');
    expect(h.snapshot().situationExpanded).toEqual({ a: 1 });

    // A re-read of the same revision is the same situation: the expansion stays.
    await h.controller.load();
    expect(h.snapshot().situationExpanded).toEqual({ a: 1 });

    // New content is a new situation: the old expansion is dropped, not drawn over it.
    h.setCards([card('a', { revision: 2 })]);
    await h.controller.load();
    expect(h.snapshot().situationExpanded).toEqual({});
  });

  it('drops an expansion whose card has left the list', async () => {
    const h = harness([card('a'), card('b', { rank: 2 })]);
    await h.controller.load();
    h.controller.toggleSituationExpanded('b');

    h.setCards([card('a')]);
    await h.controller.load();
    expect(h.snapshot().situationExpanded).toEqual({});
  });
});

describe('read failures are stated, not swallowed', () => {
  it('records the read failure and keeps the last known cards', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();
    expect(h.snapshot().status).toBe('loaded');

    const failing = createCockpitCardController({
      fetchCards: async () => {
        throw new Error('the registry is down');
      },
      confirm: async () => ({ executor: 'test.exec', result: null }),
      clock: FAKE_CLOCK,
      refreshIntervalMs: 0,
    });
    await failing.load();
    expect(failing.getSnapshot().status).toBe('error');
    expect(failing.getSnapshot().error).toBe('the registry is down');

    // The first controller still holds its last successful reading.
    expect(h.snapshot().cards).toHaveLength(1);
  });
});

describe('the same question asked twice is one card', () => {
  /** A card that names a session and states a question, so two of them can fold. */
  function askedCard(id: string, surfacedAt: string, overrides: Partial<CockpitCard> = {}): CockpitCard {
    return card(id, {
      ask: 'Delete the staging directory?',
      subject: { uri: `cloudcli://test/${id}`, project: 'p1', sessionId: 's1' },
      surfacedAt,
      ...overrides,
    });
  }

  it('hides the folded card from visibleCards and from every count', async () => {
    const h = harness([
      askedCard('keep', '2026-10-27T00:10:00.000Z'),
      askedCard('folded', '2026-10-27T00:01:00.000Z'),
    ]);
    await h.controller.load();

    const snapshot = h.snapshot();
    expect(snapshot.visibleCards.map((subject) => subject.id)).toEqual(['keep']);
    expect(snapshot.openCount).toBe(1);
    expect(snapshot.typeCounts).toEqual({ all: 1, ask: 1 });
    expect(snapshot.projectCounts).toEqual({ p1: 1 });
    expect(snapshot.duplicates).toEqual({
      keep: { hiddenIds: ['folded'], expanded: false },
    });
  });

  it('gives the folded card no confirmation target, and keeps the kept card’s', async () => {
    const h = harness([
      askedCard('keep', '2026-10-27T00:10:00.000Z'),
      askedCard('folded', '2026-10-27T00:01:00.000Z'),
    ]);
    await h.controller.load();

    const snapshot = h.snapshot();
    expect(snapshot.targets.folded).toBeUndefined();
    expect(snapshot.targets.keep).toMatchObject({ cardId: 'keep', optionId: 'one' });
  });

  it('expands the earlier card back to its original position, not to the end', async () => {
    const h = harness([
      card('first'),
      askedCard('early', '2026-10-27T00:01:00.000Z'),
      card('middle'),
      askedCard('late', '2026-10-27T00:10:00.000Z'),
    ]);
    await h.controller.load();

    // The fold is applied in the provider's order: the earlier card is gone, the rest is intact.
    expect(h.snapshot().visibleCards.map((subject) => subject.id)).toEqual([
      'first',
      'middle',
      'late',
    ]);

    h.controller.toggleDuplicates('late');

    expect(h.snapshot().duplicates.late).toEqual({ hiddenIds: ['early'], expanded: true });
    expect(h.snapshot().visibleCards.map((subject) => subject.id)).toEqual([
      'first',
      'early',
      'middle',
      'late',
    ]);
  });

  it('keeps an expansion across a re-read of the same grouping', async () => {
    const cards = [
      askedCard('keep', '2026-10-27T00:10:00.000Z'),
      askedCard('folded', '2026-10-27T00:01:00.000Z'),
    ];
    const h = harness(cards);
    await h.controller.load();
    h.controller.toggleDuplicates('keep');

    h.setCards(cards.map((subject) => ({ ...subject, revision: 2 })));
    await h.controller.load();

    expect(h.snapshot().duplicates.keep).toEqual({ hiddenIds: ['folded'], expanded: true });
    expect(h.snapshot().visibleCards.map((subject) => subject.id)).toEqual(['keep', 'folded']);
  });

  it('starts a regrouped fold collapsed, because it is a different kept card', async () => {
    const h = harness([
      askedCard('keep', '2026-10-27T00:10:00.000Z'),
      askedCard('folded', '2026-10-27T00:01:00.000Z'),
    ]);
    await h.controller.load();
    h.controller.toggleDuplicates('keep');

    // A newer duplicate arrives: the kept card is now `newer`, and the person never expanded it.
    h.setCards([
      askedCard('keep', '2026-10-27T00:10:00.000Z'),
      askedCard('folded', '2026-10-27T00:01:00.000Z'),
      askedCard('newer', '2026-10-27T00:20:00.000Z'),
    ]);
    await h.controller.load();

    expect(h.snapshot().duplicates.newer).toEqual({
      hiddenIds: ['keep', 'folded'],
      expanded: false,
    });
    expect(h.snapshot().visibleCards.map((subject) => subject.id)).toEqual(['newer']);
  });

  it('folds questionless cards by their contentRef message, not by session', async () => {
    /** A questionless card that names one message id of `s1`. */
    function questionlessCard(id: string, messageId: string, surfacedAt: string): CockpitCard {
      return card(id, {
        ask: undefined,
        surfacedAt,
        subject: { uri: `cloudcli://test/${id}`, project: 'p1', sessionId: 's1' },
        contentRef: { resolver: 'cloudcli.session-ask', ref: `s1#${messageId}` },
      });
    }

    const h = harness([
      questionlessCard('a', 'msgA', '2026-10-27T00:00:01.000Z'),
      questionlessCard('b', 'msgA', '2026-10-27T00:03:00.000Z'),
      questionlessCard('c', 'msgB', '2026-10-27T00:02:00.000Z'),
    ]);
    await h.controller.load();

    // The two msgA cards are one ask (kept card, count 2); msgB is a different ask and stays
    // visible as its own card. The list draws two cards, and the fold counts 2, not 3.
    expect(h.snapshot().duplicates).toEqual({
      b: { hiddenIds: ['a'], expanded: false },
    });
    expect(h.snapshot().visibleCards.map((subject) => subject.id)).toEqual(['b', 'c']);
    expect(h.snapshot().openCount).toBe(2);
  });
});

describe('the card-level 「忽略/丢弃」 target', () => {
  it('sits beside the option target and confirms through the dismiss channel', async () => {
    const dismissRequests: { cardId: string; revision: number }[] = [];
    const h = harness([card('c1')], {
      dismiss: async (request) => {
        dismissRequests.push(request);
        return { ok: true };
      },
    });
    await h.controller.load();

    // Two choices on the same card: the shown option's confirm target and the card-level
    // dismiss target. They are separate readings, not one replacing the other.
    expect(h.snapshot().targets.c1).toMatchObject({ optionId: 'one', label: 'One' });
    expect(h.snapshot().dismissTargets.c1).toMatchObject({
      cardId: 'c1',
      revision: 1,
      disabled: false,
      disabledReason: null,
    });

    // The first press only opens the dismiss confirmation.
    expect(h.controller.requestDismiss('c1')).toBe(true);
    expect(h.snapshot().pendingDismiss).toMatchObject({ cardId: 'c1', revision: 1 });
    expect(dismissRequests).toHaveLength(0);

    // The second press sends the dismiss transport, never the action/confirm transport.
    expect(await h.controller.confirmDismiss()).toBe(true);
    expect(dismissRequests).toEqual([{ cardId: 'c1', revision: 1 }]);
    expect(h.requests).toHaveLength(0);
    expect(h.snapshot().pendingDismiss).toBeNull();
    expect(h.snapshot().dismissNotice).toMatchObject({
      cardId: 'c1',
      ok: true,
      message: '已忽略',
    });
  });

  it('keeps the dismiss reading in flight until the re-read lands, then draws the card gone', async () => {
    let reads = 0;
    let releaseRead: ((cards: CockpitCard[]) => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const h = harness([card('c1'), card('c2')], {
      fetchCards: async () => {
        reads += 1;
        if (reads === 1) return [card('c1'), card('c2')];
        return new Promise<CockpitCard[]>((resolve) => {
          releaseRead = resolve;
          markStarted?.();
        });
      },
      dismiss: async () => ({ ok: true }),
    });
    await h.controller.load();

    expect(h.controller.requestDismiss('c1')).toBe(true);
    const pending = h.controller.confirmDismiss();
    await started;

    // The dismiss answered and the re-read is in flight. The card must still read as leaving:
    // closing the bar here would put 「忽略/丢弃」 back on a card the server has already
    // discarded, which reads as the dismissal having been undone.
    expect(h.snapshot().dismissingCardId).toBe('c1');
    expect(h.snapshot().pendingDismiss).toMatchObject({ cardId: 'c1', revision: 1 });
    expect(h.snapshot().cards.map((subject) => subject.id)).toEqual(['c1', 'c2']);
    // ...and a second card cannot open its own dismiss confirmation under the in-flight one:
    // the first command's cleanup would close that confirmation when its re-read lands.
    expect(h.controller.requestDismiss('c2')).toBe(false);

    releaseRead?.([]);
    expect(await pending).toBe(true);
    expect(h.snapshot().cards).toEqual([]);
    expect(h.snapshot().dismissingCardId).toBeNull();
  });

  it('cancelling the dismiss confirmation sends nothing and keeps the option target', async () => {
    const dismissRequests: unknown[] = [];
    const h = harness([card('c1')], {
      dismiss: async (request) => {
        dismissRequests.push(request);
        return { ok: true };
      },
    });
    await h.controller.load();

    expect(h.controller.requestDismiss('c1')).toBe(true);
    expect(h.controller.cancelDismiss()).toBe(true);
    expect(h.snapshot().pendingDismiss).toBeNull();
    expect(h.snapshot().targets.c1).toMatchObject({ optionId: 'one', disabled: false });
    expect(dismissRequests).toHaveLength(0);
  });

  it('offers no dismiss target on a card that is not a session-ask', async () => {
    const h = harness([card('c1', { kind: 'fix' })], {
      dismiss: async () => ({ ok: true }),
    });
    await h.controller.load();

    expect(h.snapshot().dismissTargets.c1).toBeUndefined();
    expect(h.controller.requestDismiss('c1')).toBe(false);
  });

  it('offers no dismiss target when the surface has no dismiss transport', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();

    expect(h.snapshot().dismissTargets).toEqual({});
    expect(h.controller.requestDismiss('c1')).toBe(false);
  });

  it('is one decision at a time: an open discard and an open confirmation refuse each other', async () => {
    const h = harness([card('c1')], { dismiss: async () => ({ ok: true }) });
    await h.controller.load();

    // No countdown to intercept: this card's option is reversible, so the FIRST option press
    // arms the countdown, which the dismiss request must refuse.
    expect(h.controller.requestConfirm('c1')).toBe(true);
    expect(h.snapshot().sendCountdown).not.toBeNull();
    expect(h.controller.requestDismiss('c1')).toBe(false);
    expect(h.snapshot().pendingDismiss).toBeNull();
    expect(h.controller.cancelConfirm()).toBe(true);
    expect(h.snapshot().sendCountdown).toBeNull();

    // ...and the reverse: with the discard confirmation open, the option press is refused.
    expect(h.controller.requestDismiss('c1')).toBe(true);
    expect(h.controller.requestConfirm('c1')).toBe(false);
    expect(h.snapshot().sendCountdown).toBeNull();
    expect(h.snapshot().pendingConfirm).toBeNull();
    expect(h.controller.cancelDismiss()).toBe(true);
  });

  it('leaves the card and its choices in place after a failed discard, and retries', async () => {
    let attempts = 0;
    const h = harness([card('c1')], {
      dismiss: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('gateway answered 502');
        return { ok: true };
      },
    });
    await h.controller.load();

    expect(h.controller.requestDismiss('c1')).toBe(true);
    expect(await h.controller.confirmDismiss()).toBe(false);

    // The dismissal did not happen: the card is still there, its option target is untouched,
    // and the one-line notice says why the request failed.
    expect(h.snapshot().cards.map((subject) => subject.id)).toEqual(['c1']);
    expect(h.snapshot().targets.c1).toMatchObject({ optionId: 'one', label: 'One' });
    expect(h.snapshot().pendingDismiss).toBeNull();
    expect(h.snapshot().dismissingCardId).toBeNull();
    expect(h.snapshot().dismissNotice).toMatchObject({ cardId: 'c1', ok: false });
    expect(h.snapshot().dismissNotice?.message).toContain('502');
    // The discard target is still offered, so the second attempt starts from the first press.
    expect(h.snapshot().dismissTargets.c1).toMatchObject({ disabled: false });

    expect(h.controller.requestDismiss('c1')).toBe(true);
    expect(await h.controller.confirmDismiss()).toBe(true);
    expect(attempts).toBe(2);
    expect(h.snapshot().dismissNotice).toMatchObject({ cardId: 'c1', ok: true });
  });

  it('closes the details drawer when a successful discard takes its card out of the list', async () => {
    const h = harness([card('c1'), card('c2')], { dismiss: async () => ({ ok: true }) });
    await h.controller.load();

    h.controller.openDetails('c1');
    expect(h.snapshot().detailsStack).toEqual(['c1']);

    expect(h.controller.requestDismiss('c1')).toBe(true);
    h.setCards([card('c2')]);
    expect(await h.controller.confirmDismiss()).toBe(true);

    // The re-read is the picture of the provider's post-dismiss state: the card is gone and the
    // drawer that was reading it is closed, not left pointing at a card the list no longer has.
    expect(h.snapshot().cards.map((subject) => subject.id)).toEqual(['c2']);
    expect(h.snapshot().detailsStack).toEqual([]);
    expect(h.snapshot().dismissNotice).toMatchObject({ cardId: 'c1', ok: true });
  });

  it('withdraws the discard target once an action awaits its receipt, and carries the revision', async () => {
    const feedback: CockpitCardFeedback = {
      cardId: 'c1',
      revision: 1,
      feedbackId: 'f1',
      optionId: 'one',
      label: 'One',
      sentAt: '2026-10-27T00:00:05.000Z',
      outcome: { executor: 'test.exec', ok: true },
      canResend: false,
    };
    const h = harness([card('c1', { feedback })], { dismiss: async () => ({ ok: true }) });
    await h.controller.load();

    // The action already ran; discarding now would be a second, contradictory decision.
    expect(h.snapshot().dismissTargets.c1).toMatchObject({ disabled: true });
    expect(h.snapshot().dismissTargets.c1?.disabledReason).not.toBeNull();
    expect(h.controller.requestDismiss('c1')).toBe(false);
  });
});

/**
 * The extracted derivations and the controller's public snapshot must agree on the same input.
 *
 * The controller is what decides WHICH cards a derivation runs on (the fold and filter rules), so
 * this block feeds the snapshot's own `cards` back into the selectors and states equality. A
 * drift on either side — a selector changed alone, or `normalize` computing a value its own way —
 * lands here rather than in the UI.
 */
describe('the controller publishes exactly the extracted selectors’ readings', () => {
  const CARDS = [
    card('a', { kind: 'ask', subject: { uri: 'u/a', project: 'p1' } }),
    card('b', { kind: 'need', subject: { uri: 'u/b', project: 'p2' } }),
    card('c', { kind: 'fix', subject: { uri: 'u/c', project: 'p1' } }),
  ];

  function expectSameDerivations(snapshot: CockpitCardControllerSnapshot): void {
    expect(snapshot.visibleCards.map((entry) => entry.id)).toEqual(
      visibleCardsOf(snapshot.cards, snapshot.typeFilter, snapshot.projectFilters).map(
        (entry) => entry.id,
      ),
    );
    expect(snapshot.typeCounts).toEqual(typeCountsOf(snapshot.cards, snapshot.projectFilters));
    expect(snapshot.projectCounts).toEqual(
      projectCountsOf(snapshot.cards, snapshot.typeFilter),
    );
    expect(snapshot.projects).toEqual(projectsOf(snapshot.cards));
    expect(snapshot.targets).toEqual(
      targetsOf(snapshot.cards, snapshot.shown, snapshot.ownReplies),
    );
    // A card the person has not replied to shows exactly what `defaultShownOption` names.
    for (const entry of snapshot.cards) {
      expect(snapshot.shown[entry.id]).toEqual(defaultShownOption(entry) ?? undefined);
    }
  }

  it('agrees on the list, the counts, the projects and the targets', async () => {
    const h = harness(CARDS, { dismiss: async () => ({ ok: true }) });
    await h.controller.load();

    expectSameDerivations(h.snapshot());
    expect(h.snapshot().dismissTargets).toEqual(dismissTargetsOf(h.snapshot().cards));
  });

  it('agrees after the type filter and the project filter move', async () => {
    const h = harness(CARDS, { dismiss: async () => ({ ok: true }) });
    await h.controller.load();

    h.controller.setTypeFilter('need');
    expectSameDerivations(h.snapshot());

    h.controller.setTypeFilter('all');
    h.controller.toggleProjectFilter('p1');
    expectSameDerivations(h.snapshot());
    expect(h.snapshot().visibleCards.map((entry) => entry.id)).toEqual(['a', 'c']);
  });
});

/**
 * A knowledge suggestion as the server sends it: the case evidence carries the reference the
 * server minted for THIS revision, and the controller copies it onto the request.
 */
function knowledgeCard(id = 'k1', overrides: Partial<CockpitCard> = {}): CockpitCard {
  const knowledge: CockpitKnowledgeCase = {
    caseId: 'case-1',
    knowledgeRevision: 2,
    proposalRevision: 1,
    state: 'verifying',
    factsFingerprint: 'fp-1',
    verification: { state: 'pending', summary: 'criterion is running' },
    confirmationRef: 'kc1.payload.signature',
    plan: { scope: ['server'], steps: ['apply it'], verification: 'the criterion exits 0' },
  };
  return card(id, {
    kind: 'knowledge',
    knowledge,
    options: [
      option('apply', 'Apply', {
        decision: 'apply',
        plan: knowledge.plan,
        suggested: true,
        // Irreversible so the leg exercises the direct confirm, not the countdown.
        tags: [{ kind: 'irreversible', text: 'cannot be undone' }],
      }),
      option('defer', 'Defer', { decision: 'defer' }),
    ],
    ...overrides,
  });
}

describe('a knowledge suggestion turns the person’s decision into a trusted request', () => {
  it('presents the server-issued reference for the revision on screen', async () => {
    const h = harness([knowledgeCard()]);
    await h.controller.load();

    h.controller.requestConfirm();
    expect(await h.controller.confirm()).toBe(true);

    expect(h.requests).toEqual([
      {
        cardId: 'k1',
        revision: 1,
        optionId: 'apply',
        confirmationRef: 'kc1.payload.signature',
      },
    ]);
  });

  it('sends no reference for a card that carries no knowledge case', async () => {
    const h = harness([irreversibleCard()]);
    await h.controller.load();

    h.controller.requestConfirm();
    await h.controller.confirm();

    expect(h.requests).toEqual([{ cardId: 'c1', revision: 1, optionId: 'one' }]);
    expect('confirmationRef' in (h.requests[0] as object)).toBe(false);
  });

  it('re-reads when the server answers a stale revision, so the card on screen catches up', async () => {
    const conflict = Object.assign(new Error('该建议已更新'), { code: 'REVISION_CONFLICT' });
    const h = harness([knowledgeCard()], {
      confirm: async () => {
        throw conflict;
      },
    });
    await h.controller.load();
    const readsAfterLoad = h.reads;

    h.controller.requestConfirm();
    expect(await h.controller.confirm()).toBe(false);
    expect(h.reads).toBeGreaterThan(readsAfterLoad);
    expect(h.snapshot().lastOutcome).toMatchObject({ ok: false, cardId: 'k1' });
  });

  it('does not re-read for a failure that says nothing about the revision', async () => {
    const h = harness([knowledgeCard()], {
      confirm: async () => {
        throw Object.assign(new Error('执行器失败'), { code: 'EXECUTOR_FAILED' });
      },
    });
    await h.controller.load();
    const readsAfterLoad = h.reads;

    h.controller.requestConfirm();
    await h.controller.confirm();

    expect(h.reads).toBe(readsAfterLoad);
  });

  it('publishes the case and verification state in the scenario reading', async () => {
    const h = harness([knowledgeCard(), card('plain', { rank: 2 })]);
    await h.controller.load();

    const reading = cockpitCardsReading(h.snapshot());
    expect(reading.cards).toEqual([
      expect.objectContaining({
        id: 'k1',
        knowledgeState: 'verifying',
        knowledgeVerificationState: 'pending',
      }),
      expect.objectContaining({
        id: 'plain',
        knowledgeState: null,
        knowledgeVerificationState: null,
      }),
    ]);
  });
});
