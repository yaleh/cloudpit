import { afterEach, describe, expect, it } from 'vitest';

import type { Clock, CockpitCard, CockpitCardOption } from '@/shared/types';
import { createCockpitCardController } from '@/modules/cockpit/cockpitCardController';
import type { CockpitCardController } from '@/modules/cockpit/cockpitCardController';
import { createCockpitColumnController } from '@/modules/cockpit/cockpitColumnController';
import type {
  CockpitColumnController,
  CockpitColumnStorage,
} from '@/modules/cockpit/cockpitColumnController';

/**
 * The PC column's frame rules, proven without React.
 *
 * Each case is one AC-429 leg: the three layout boundaries and their exact edges, the expand
 * intent and dragged width surviving a rebuild, the header count at 0 / 1 / 100, the overlay
 * collapsing after a conversation link while the squeeze layout does not, keys landing in the
 * column when no field owns the keyboard, a focused session textarea ending the handler, and
 * Escape never consumed.
 *
 * The card controller is the REAL one (with plain transports), so a key press exercises the same
 * selection and shown-option rules the cards view uses — not a second interpretation in the test.
 */

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

function card(id: string): CockpitCard {
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
  };
}

function memoryStorage(initial?: string): CockpitColumnStorage & { dump: () => string | null } {
  let value = initial ?? null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    dump: () => value,
  };
}

async function cardsWith(initial: CockpitCard[]): Promise<CockpitCardController> {
  const controller = createCockpitCardController({
    fetchCards: async () => initial,
    confirm: async () => ({ executor: 'test.exec', result: { ok: true } }),
    clock: FAKE_CLOCK,
    refreshIntervalMs: 0,
  });
  await controller.load();
  return controller;
}

type ColumnHarness = {
  column: CockpitColumnController;
  cards: CockpitCardController;
  openedSessions: string[];
};

async function columnHarness(options: {
  cards?: CockpitCard[];
  viewportWidth?: number;
  storage?: CockpitColumnStorage | null;
  isEditableFocused?: () => boolean;
} = {}): Promise<ColumnHarness> {
  const cards = await cardsWith(options.cards ?? [card('c1'), card('c2')]);
  const openedSessions: string[] = [];
  const column = createCockpitColumnController({
    cards,
    readViewportWidth: () => options.viewportWidth ?? 1440,
    storage: options.storage === undefined ? memoryStorage() : options.storage,
    ...(options.isEditableFocused === undefined
      ? {}
      : { isEditableFocused: options.isEditableFocused }),
    openSession: (sessionId) => openedSessions.push(sessionId),
  });
  column.start();
  return { column, cards, openedSessions };
}

afterEach(() => {
  // A focused textarea would leak into the next case (the default focus reader sees the body).
  document.body.innerHTML = '';
});

describe('the three layouts and their exact edges', () => {
  it('does not mount below 900, overlays from 900 to 1279, and squeezes from 1280', async () => {
    const cases: Array<[number, 'hidden' | 'overlay' | 'squeeze']> = [
      [899, 'hidden'],
      [900, 'overlay'],
      [1279, 'overlay'],
      [1280, 'squeeze'],
    ];
    for (const [viewportWidth, layout] of cases) {
      const { column } = await columnHarness({ viewportWidth, storage: null });
      expect(column.getSnapshot().layout, `width ${viewportWidth}`).toBe(layout);
    }
  });

  it('re-derives the layout when the viewport changes, and never shows the column when hidden', async () => {
    const { column } = await columnHarness({ viewportWidth: 1440 });
    column.setExpanded(true);
    expect(column.getSnapshot().layout).toBe('squeeze');
    expect(column.getSnapshot().expanded).toBe(true);

    column.setViewportWidth(1000);
    expect(column.getSnapshot().layout).toBe('overlay');
    expect(column.getSnapshot().expanded).toBe(true);

    column.setViewportWidth(800);
    expect(column.getSnapshot().layout).toBe('hidden');
    expect(column.getSnapshot().expanded).toBe(false);

    column.setViewportWidth(1440);
    expect(column.getSnapshot().expanded).toBe(true);
  });
});

describe('the frame survives a rebuild', () => {
  it('restores the expand intent and the dragged width from storage', async () => {
    const storage = memoryStorage();
    const first = await columnHarness({ viewportWidth: 1440, storage });
    expect(first.column.getSnapshot().expanded).toBe(false);
    expect(first.column.getSnapshot().width).toBe(400);

    first.column.setExpanded(true);
    first.column.setWidth(520);
    expect(first.column.getSnapshot().expanded).toBe(true);
    expect(first.column.getSnapshot().width).toBe(520);

    const second = await columnHarness({ viewportWidth: 1440, storage });
    expect(second.column.getSnapshot().expanded).toBe(true);
    expect(second.column.getSnapshot().width).toBe(520);
  });

  it('clamps a dragged width into the readable range and stores it', async () => {
    const storage = memoryStorage();
    const { column } = await columnHarness({ viewportWidth: 1440, storage });
    column.setWidth(10);
    expect(column.getSnapshot().width).toBe(320);
    column.setWidth(10_000);
    expect(column.getSnapshot().width).toBe(720);
    expect(JSON.parse(storage.dump() ?? '{}')).toMatchObject({ width: 720 });
  });
});

describe('the header count', () => {
  it('is empty at 0, the number at 1, and 99+ at 100', async () => {
    const zero = await columnHarness({ cards: [] });
    expect(zero.column.getSnapshot().openCount).toBe(0);
    expect(zero.column.getSnapshot().badgeText).toBe('');

    const one = await columnHarness({ cards: [card('c1')] });
    expect(one.column.getSnapshot().openCount).toBe(1);
    expect(one.column.getSnapshot().badgeText).toBe('1');

    const hundred = await columnHarness({
      cards: Array.from({ length: 100 }, (_, index) => card(`c${index}`)),
    });
    expect(hundred.column.getSnapshot().openCount).toBe(100);
    expect(hundred.column.getSnapshot().badgeText).toBe('99+');
  });

  it('follows a re-read without a remount', async () => {
    let source = [card('c1')];
    const cards = createCockpitCardController({
      fetchCards: async () => source,
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
    expect(column.getSnapshot().openCount).toBe(1);

    source = [card('c1'), card('c2'), card('c3')];
    await cards.load();
    expect(column.getSnapshot().openCount).toBe(3);
  });
});

describe('a conversation link', () => {
  it('collapses the overlay layout after opening the conversation on the left', async () => {
    const { column, openedSessions } = await columnHarness({ viewportWidth: 1100 });
    column.setExpanded(true);
    expect(column.getSnapshot().expanded).toBe(true);

    column.openConversation('c1', 'session-1');

    expect(openedSessions).toEqual(['session-1']);
    expect(column.getSnapshot().expanded).toBe(false);
    expect(column.getSnapshot().openedCardId).toBe('c1');
    expect(column.getSnapshot().openedSessionId).toBe('session-1');
  });

  it('leaves the squeeze layout expanded for the conversation beside it', async () => {
    const { column, openedSessions } = await columnHarness({ viewportWidth: 1440 });
    column.setExpanded(true);

    column.openConversation('c1', 'session-1');

    expect(openedSessions).toEqual(['session-1']);
    expect(column.getSnapshot().expanded).toBe(true);
    expect(column.getSnapshot().openedCardId).toBe('c1');
  });
});

describe('keyboard ownership', () => {
  it('routes arrows, digits, E, Enter and Backspace to the column when no field has focus', async () => {
    const { column, cards } = await columnHarness({ viewportWidth: 1440 });
    column.setExpanded(true);

    // Loading selects the first card; one ArrowDown moves to the next and the next press wraps.
    expect(cards.getSnapshot().selectedCardId).toBe('c1');
    expect(column.handleKey('ArrowDown')).toBe(true);
    expect(cards.getSnapshot().selectedCardId).toBe('c2');
    expect(column.handleKey('ArrowDown')).toBe(true);
    expect(cards.getSnapshot().selectedCardId).toBe('c1');

    expect(column.handleKey('2')).toBe(true);
    expect(cards.getSnapshot().shown.c1).toEqual({ kind: 'option', optionId: 'two' });

    expect(column.handleKey('ArrowLeft')).toBe(true);
    expect(cards.getSnapshot().shown.c1).toEqual({ kind: 'option', optionId: 'one' });

    expect(column.handleKey('Enter')).toBe(true);
    expect(cards.getSnapshot().pendingConfirm?.cardId).toBe('c1');

    cards.cancelConfirm();
    expect(column.handleKey('e')).toBe(true);
    expect(cards.getSnapshot().shown.c1).toEqual({ kind: 'ownReply' });

    cards.openDetails('c1');
    expect(column.handleKey('Backspace')).toBe(true);
    expect(cards.getSnapshot().detailsStack).toEqual([]);
  });

  it('handles no key while the session textarea owns the focus', async () => {
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();
    // The production default reads `document.activeElement`; no override is supplied here.
    const { column, cards } = await columnHarness({ viewportWidth: 1440 });
    column.setExpanded(true);
    const before = cards.getSnapshot();
    expect(before.selectedCardId).toBe('c1');

    expect(column.handleKey('ArrowDown')).toBe(false);
    expect(column.handleKey('2')).toBe(false);
    expect(column.handleKey('e')).toBe(false);
    expect(column.handleKey('Enter')).toBe(false);
    const after = cards.getSnapshot();
    expect(after.selectedCardId).toBe(before.selectedCardId);
    expect(after.shown).toEqual(before.shown);
    expect(after.pendingConfirm).toBeNull();
  });

  it('never handles Escape', async () => {
    const { column } = await columnHarness({ viewportWidth: 1440 });
    column.setExpanded(true);
    expect(column.handleKey('Escape')).toBe(false);
  });

  it('handles nothing below 900 px, where the column is not mounted', async () => {
    const { column } = await columnHarness({ viewportWidth: 800 });
    expect(column.handleKey('ArrowDown')).toBe(false);
  });
});
