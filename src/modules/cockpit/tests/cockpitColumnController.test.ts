import { afterEach, describe, expect, it } from 'vitest';

import type { Clock, CockpitCard, CockpitCardOption } from '@/shared/types';
import { createCockpitCardController } from '@/modules/cockpit/cockpitCardController';
import type { CockpitCardController } from '@/modules/cockpit/cockpitCardController';
import { cockpitColumnCoversSession } from '@/modules/cockpit/contract';
import { createCockpitColumnController } from '@/modules/cockpit/cockpitColumnController';
import type {
  CockpitColumnController,
  CockpitColumnStorage,
} from '@/modules/cockpit/cockpitColumnController';

/**
 * The PC column's frame rules, proven without React.
 *
 * Each case is one criterion leg: the three layout boundaries and their exact edges on the
 * WORKSPACE axis, the width the auto frame picks so the session keeps its 640 px floor, the
 * expand intent and the dragged width surviving a rebuild, the header count at 0 / 1 / 100, the
 * overlay collapsing after a conversation link while the squeeze layout does not, keys landing in
 * the column when no field owns the keyboard, a focused session textarea ending the handler, and
 * Escape never consumed.
 *
 * THE AXIS IS THE WORKSPACE, DELIBERATELY. `cockpit-pc-right-column` pinned this file to window
 * widths (899/900/1279/1280) because the column's layout was read off the window. That reading
 * is wrong once the sidebar and the editor take their share of the window: a 1280 px window with
 * a 289 px sidebar leaves a 991 px workspace, where a 400 px column squeezed the session to
 * 591 px — below the 640 px the design calls readable. The boundary cases below are the same
 * design intent stated in the unit the column actually has, and they supersede that pin.
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
  workspaceWidth?: number;
  storage?: CockpitColumnStorage | null;
  isEditableFocused?: () => boolean;
} = {}): Promise<ColumnHarness> {
  const cards = await cardsWith(options.cards ?? [card('c1'), card('c2')]);
  const openedSessions: string[] = [];
  const column = createCockpitColumnController({
    cards,
    readWorkspaceWidth: () => options.workspaceWidth ?? 1151,
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

describe('the three layouts and their exact edges on the workspace axis', () => {
  it('does not mount below 600 of workspace, overlays to 959, and squeezes from 960', async () => {
    // 960 is where the 320 px minimum column still leaves the session its 640 px. These replace
    // the viewport 899/900/1279/1280 pin of `cockpit-pc-right-column`: the window was the wrong
    // unit (a 1280 window leaves a 991 workspace with the sidebar open).
    const cases: Array<[number, 'hidden' | 'overlay' | 'squeeze']> = [
      [599, 'hidden'],
      [600, 'overlay'],
      [959, 'overlay'],
      [960, 'squeeze'],
    ];
    for (const [workspaceWidth, layout] of cases) {
      const { column } = await columnHarness({ workspaceWidth, storage: null });
      expect(column.getSnapshot().layout, `workspace ${workspaceWidth}`).toBe(layout);
    }
  });

  it('derives the column width from the workspace so the session keeps 640 px', async () => {
    // The three workspaces the real shell hands the column at 1440 / 1280 / 1024 windows with
    // the 289 px sidebar open. The old viewport rule gave 400 + 591 at the middle one; the floor
    // now steps the auto width down to the readable minimum instead.
    const wide = await columnHarness({ workspaceWidth: 1151, storage: null });
    wide.column.setExpanded(true);
    expect(wide.column.getSnapshot().layout).toBe('squeeze');
    expect(wide.column.getSnapshot().width).toBe(400);
    expect(wide.column.getSnapshot().workspaceWidth - wide.column.getSnapshot().width).toBe(751);
    expect(wide.column.getSnapshot().workspaceWidth - wide.column.getSnapshot().width)
      .toBeGreaterThanOrEqual(640);

    const middle = await columnHarness({ workspaceWidth: 991, storage: null });
    middle.column.setExpanded(true);
    expect(middle.column.getSnapshot().layout).toBe('squeeze');
    expect(middle.column.getSnapshot().width).toBe(320);
    expect(991 - middle.column.getSnapshot().width).toBe(671);
    expect(middle.column.getSnapshot().workspaceWidth - middle.column.getSnapshot().width)
      .toBeGreaterThanOrEqual(640);

    const narrow = await columnHarness({ workspaceWidth: 735, storage: null });
    narrow.column.setExpanded(true);
    expect(narrow.column.getSnapshot().layout).toBe('overlay');
  });

  it('re-derives the layout when the workspace changes, and never shows the column when hidden', async () => {
    const { column } = await columnHarness({ workspaceWidth: 1151 });
    column.setExpanded(true);
    expect(column.getSnapshot().layout).toBe('squeeze');
    expect(column.getSnapshot().expanded).toBe(true);

    column.setWorkspaceWidth(735);
    expect(column.getSnapshot().layout).toBe('overlay');
    expect(column.getSnapshot().expanded).toBe(true);

    column.setWorkspaceWidth(500);
    expect(column.getSnapshot().layout).toBe('hidden');
    expect(column.getSnapshot().expanded).toBe(false);

    column.setWorkspaceWidth(1151);
    expect(column.getSnapshot().expanded).toBe(true);
  });

  it('never reads window.innerWidth: the injected workspace reader is the only width source', async () => {
    const reads: string[] = [];
    const original = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      get() {
        reads.push('innerWidth');
        throw new Error('the column controller must not read window.innerWidth');
      },
    });
    try {
      const { column } = await columnHarness({ workspaceWidth: 991, storage: null });
      expect(column.getSnapshot().workspaceWidth).toBe(991);
      expect(column.getSnapshot().layout).toBe('squeeze');
      expect(column.getSnapshot().width).toBe(320);
      column.setExpanded(true);
      column.setWorkspaceWidth(1151);
      expect(column.getSnapshot().width).toBe(400);

      // The default reader (no injection) must not fall back to the window either: an
      // unmeasured workspace is 0, which is `hidden`, not a guess from the viewport.
      const bare = createCockpitColumnController({
        cards: await cardsWith([card('c1')]),
        storage: null,
      });
      expect(bare.getSnapshot().workspaceWidth).toBe(0);
      expect(bare.getSnapshot().layout).toBe('hidden');
    } finally {
      if (original === undefined) {
        delete (window as unknown as { innerWidth?: number }).innerWidth;
      } else {
        Object.defineProperty(window, 'innerWidth', original);
      }
    }
    expect(reads).toEqual([]);
  });
});

describe('yielding the session edge to an open overlay column', () => {
  // The chat module's input-outline handle yields only while the column COVERS the session area.
  // Fed from the controller's own snapshot, so this is the reading the drawer consumes — not a
  // second derivation of the layout boundaries.
  it('reads true only for an expanded overlay, never for squeeze, hidden or closed', async () => {
    const overlay = await columnHarness({ workspaceWidth: 735, storage: null });
    expect(cockpitColumnCoversSession(overlay.column.getSnapshot())).toBe(false);
    overlay.column.setExpanded(true);
    expect(cockpitColumnCoversSession(overlay.column.getSnapshot())).toBe(true);

    const squeeze = await columnHarness({ workspaceWidth: 1151, storage: null });
    squeeze.column.setExpanded(true);
    expect(cockpitColumnCoversSession(squeeze.column.getSnapshot())).toBe(false);

    const hidden = await columnHarness({ workspaceWidth: 500, storage: null });
    hidden.column.setExpanded(true);
    expect(cockpitColumnCoversSession(hidden.column.getSnapshot())).toBe(false);

    // No provider (a chat surface rendered alone) shows the handle: absence is not "covered".
    expect(cockpitColumnCoversSession(null)).toBe(false);
  });
});

describe('the frame survives a rebuild', () => {
  it('restores the expand intent and the dragged width from storage', async () => {
    const storage = memoryStorage();
    // A workspace wide enough that the 640 px floor does not clamp the remembered 520 px.
    const first = await columnHarness({ workspaceWidth: 1440, storage });
    expect(first.column.getSnapshot().expanded).toBe(false);
    expect(first.column.getSnapshot().width).toBe(400);

    first.column.setExpanded(true);
    first.column.setWidth(520);
    expect(first.column.getSnapshot().expanded).toBe(true);
    expect(first.column.getSnapshot().width).toBe(520);
    // The memory is the person's width, not the drawn one: the frame may clamp it, the store
    // must not.
    expect(JSON.parse(storage.dump() ?? '{}')).toMatchObject({ width: 520 });

    const second = await columnHarness({ workspaceWidth: 1440, storage });
    expect(second.column.getSnapshot().expanded).toBe(true);
    expect(second.column.getSnapshot().width).toBe(520);
  });

  it('clamps a dragged width into the readable range and stores it', async () => {
    const storage = memoryStorage();
    const { column } = await columnHarness({ workspaceWidth: 1440, storage });
    column.setWidth(10);
    expect(column.getSnapshot().width).toBe(320);
    column.setWidth(10_000);
    expect(column.getSnapshot().width).toBe(720);
    expect(JSON.parse(storage.dump() ?? '{}')).toMatchObject({ width: 720 });
  });

  it('clamps the DRAWN width to the 640 px floor without rewriting the remembered width', async () => {
    // A drag to 720 px at a 991 px workspace would leave the session 271 px. The frame keeps the
    // session at its floor by drawing 351 px, while `cockpit.column.v1` keeps 720 px so the
    // column returns to the person's width on a wider workspace.
    const storage = memoryStorage();
    const { column } = await columnHarness({ workspaceWidth: 991, storage });
    column.setExpanded(true);
    column.setWidth(720);

    const snapshot = column.getSnapshot();
    expect(snapshot.layout).toBe('squeeze');
    expect(snapshot.preferredWidth).toBe(720);
    expect(snapshot.width).toBe(351);
    expect(snapshot.workspaceWidth - snapshot.width).toBe(640);
    expect(JSON.parse(storage.dump() ?? '{}')).toMatchObject({ width: 720 });

    column.setWorkspaceWidth(1440);
    expect(column.getSnapshot().width).toBe(720);
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
      readWorkspaceWidth: () => 1151,
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
    const { column, openedSessions } = await columnHarness({ workspaceWidth: 735 });
    column.setExpanded(true);
    expect(column.getSnapshot().expanded).toBe(true);

    column.openConversation('c1', 'session-1');

    expect(openedSessions).toEqual(['session-1']);
    expect(column.getSnapshot().expanded).toBe(false);
    expect(column.getSnapshot().openedCardId).toBe('c1');
    expect(column.getSnapshot().openedSessionId).toBe('session-1');
  });

  it('leaves the squeeze layout expanded for the conversation beside it', async () => {
    const { column, openedSessions } = await columnHarness({ workspaceWidth: 1151 });
    column.setExpanded(true);

    column.openConversation('c1', 'session-1');

    expect(openedSessions).toEqual(['session-1']);
    expect(column.getSnapshot().expanded).toBe(true);
    expect(column.getSnapshot().openedCardId).toBe('c1');
  });
});

describe('keyboard ownership', () => {
  it('routes arrows, digits, E, Enter and Backspace to the column when no field has focus', async () => {
    const { column, cards } = await columnHarness({ workspaceWidth: 1151 });
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
    // A reversible option's Enter starts the delayed send, so the reading is the countdown.
    expect(cards.getSnapshot().sendCountdown?.cardId).toBe('c1');

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
    const { column, cards } = await columnHarness({ workspaceWidth: 1151 });
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
    const { column } = await columnHarness({ workspaceWidth: 1151 });
    column.setExpanded(true);
    expect(column.handleKey('Escape')).toBe(false);
  });

  it('handles nothing below 600 px of workspace, where the column is not mounted', async () => {
    const { column } = await columnHarness({ workspaceWidth: 500 });
    expect(column.handleKey('ArrowDown')).toBe(false);
  });
});
