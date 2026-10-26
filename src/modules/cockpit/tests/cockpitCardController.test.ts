import { describe, expect, it } from 'vitest';

import type {
  Clock,
  CockpitCard,
  CockpitCardOption,
} from '@/shared/types';
import {
  createCockpitCardController,
  defaultShownOption,
} from '@/modules/cockpit/cockpitCardController';
import type {
  CockpitCardConfirmRequest,
  CockpitCardController,
  CockpitCardControllerDeps,
  CockpitCardControllerEvent,
  CockpitCardControllerSnapshot,
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
    expect(h.snapshot().pendingConfirm?.label).toBe('Two');
  });

  it('closes an open confirm card when the shown option changes under it', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();

    expect(h.controller.requestConfirm()).toBe(true);
    expect(h.snapshot().pendingConfirm).toMatchObject({ optionId: 'one' });

    h.controller.showOption('c1', 'two');
    expect(h.snapshot().pendingConfirm).toBeNull();
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

describe('the confirm card gates the one request', () => {
  it('the first press only opens the confirm card; the second sends exactly once', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();

    expect(h.controller.requestConfirm()).toBe(true);
    // Opening the confirm card is not a send.
    expect(h.requests).toHaveLength(0);

    expect(await h.controller.confirm()).toBe(true);
    expect(h.requests).toEqual([{ cardId: 'c1', revision: 1, optionId: 'one' }]);
    expect(h.snapshot().pendingConfirm).toBeNull();

    // A third press has nothing pending to send.
    expect(await h.controller.confirm()).toBe(false);
    expect(h.requests).toHaveLength(1);
  });

  it('two concurrent confirmations produce one request', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();
    h.controller.requestConfirm();

    const [first, second] = await Promise.all([h.controller.confirm(), h.controller.confirm()]);

    expect([first, second]).toEqual([true, false]);
    expect(h.requests).toHaveLength(1);
  });

  it('cancel sends nothing and closes the confirm card', async () => {
    const h = harness([card('c1')]);
    await h.controller.load();

    h.controller.requestConfirm();
    expect(h.controller.cancelConfirm()).toBe(true);

    expect(h.snapshot().pendingConfirm).toBeNull();
    expect(await h.controller.confirm()).toBe(false);
    expect(h.requests).toHaveLength(0);
  });

  it('re-reads after a confirmation so the provider’s new revision lands in place', async () => {
    const h = harness([card('c1'), card('c2', { rank: 2 })]);
    await h.controller.load();
    const readsAfterLoad = h.reads;

    h.controller.requestConfirm();
    await h.controller.confirm();

    expect(h.reads).toBeGreaterThan(readsAfterLoad);
    expect(h.snapshot().lastOutcome).toMatchObject({ ok: true, executor: 'test.exec' });
  });
});

describe('a started conversation is announced', () => {
  it('emits sessionStarted with the new session id when the executor is session.start', async () => {
    const events: CockpitCardControllerEvent[] = [];
    const h = harness([card('c1')], {
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
  });

  it('says nothing for any other executor, even one whose answer names a session', async () => {
    const events: CockpitCardControllerEvent[] = [];
    const h = harness([card('c1')], {
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
    const h = harness([card('c1')], {
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
    const h = harness([
      card('c1', {
        ownReply: { executor: 'reply.exec', params: { cardId: 'c1' } },
      }),
    ]);
    await h.controller.load();

    h.controller.setOwnReply('c1', 'ship it after the archive check');
    expect(h.snapshot().shown.c1).toEqual({ kind: 'ownReply' });
    expect(h.snapshot().targets.c1).toMatchObject({
      optionId: null,
      replyText: 'ship it after the archive check',
      label: 'ship it after the archive check',
      disabled: false,
    });

    expect(h.controller.requestConfirm()).toBe(true);
    expect(await h.controller.confirm()).toBe(true);
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
    const a = card('a');
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
