import { describe, expect, it } from 'vitest';

import type { CockpitCard, CockpitCardOption } from '@/shared/types';
import { FEEDBACK_LOCKED_REASON } from '@/modules/cockpit/cards/cockpitCardFeedback';
import {
  cockpitCardStateKey,
  confirmTargetOf,
  defaultShownOption,
  dismissTargetOf,
  dismissTargetsOf,
  isIrreversibleOption,
  matchesProjectFilters,
  normalizeProjectFilters,
  projectCountsOf,
  projectsOf,
  shownOptionOf,
  startedSessionIdOf,
  targetsOf,
  typeCountsOf,
  visibleCardsOf,
} from '@/modules/cockpit/cards/cockpitCardDerived';

/**
 * The cockpit's pure derivations, proven from their arguments alone.
 *
 * Every case here calls one function with plain data. Nothing in this file mounts React, reads
 * the DOM, advances a timer or constructs a store: a derivation that only transforms its inputs
 * is stated as a function of those inputs, so a failing rule names the argument that broke it.
 * The controller's side of the same reading (that its public snapshot carries exactly these
 * values) is proven in `cockpitCardController.test.ts`.
 */

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

describe('shownOptionOf', () => {
  it('resolves an option reading to the card’s own option object', () => {
    const sample = card('c1');
    expect(shownOptionOf(sample, { kind: 'option', optionId: 'two' })).toBe(sample.options[1]);
  });

  it('is null when nothing is shown or the reading is the person’s own reply', () => {
    const sample = card('c1');
    expect(shownOptionOf(sample, undefined)).toBeNull();
    expect(shownOptionOf(sample, { kind: 'ownReply' })).toBeNull();
  });

  it('is null when the named option no longer exists (a replaced revision)', () => {
    expect(shownOptionOf(card('c1'), { kind: 'option', optionId: 'gone' })).toBeNull();
  });
});

describe('cockpitCardStateKey', () => {
  it('joins the provider revision and the local content revision', () => {
    expect(cockpitCardStateKey(card('c1', { revision: 4, contentRevision: 7 }))).toBe('4:7');
  });

  it('leaves the second half empty when the card carries no resolved content', () => {
    expect(cockpitCardStateKey(card('c1', { revision: 4 }))).toBe('4:');
  });

  it('differs when either half moves and matches when both are equal', () => {
    const base = card('c1', { revision: 4, contentRevision: 7 });
    expect(cockpitCardStateKey({ ...base, revision: 5 })).not.toBe(cockpitCardStateKey(base));
    expect(cockpitCardStateKey({ ...base, contentRevision: 8 })).not.toBe(
      cockpitCardStateKey(base),
    );
    expect(cockpitCardStateKey(card('c2', { revision: 4, contentRevision: 7 }))).toBe(
      cockpitCardStateKey(base),
    );
  });
});

describe('defaultShownOption', () => {
  it('names the suggested option regardless of its position or source', () => {
    expect(
      defaultShownOption(
        card('c1', {
          options: [
            option('one', 'One'),
            option('judge', 'Judge pick', { suggested: true, source: 'judge' }),
          ],
        }),
      ),
    ).toEqual({ kind: 'option', optionId: 'judge' });
  });

  it('is null when no option is suggested — the first option is never promoted', () => {
    expect(
      defaultShownOption(
        card('c1', { options: [option('one', 'One'), option('two', 'Two')] }),
      ),
    ).toBeNull();
  });

  it('is null for a card with no options at all', () => {
    expect(defaultShownOption(card('c1', { options: [] }))).toBeNull();
  });
});

describe('isIrreversibleOption', () => {
  it('reads the warn sentence and both consequence-tag names', () => {
    expect(isIrreversibleOption(option('a', 'A', { warn: 'cannot be undone' }))).toBe(true);
    expect(
      isIrreversibleOption(option('b', 'B', { tags: [{ kind: 'irreversible', text: 'x' }] })),
    ).toBe(true);
    expect(isIrreversibleOption(option('c', 'C', { tags: [{ kind: 'warn', text: 'x' }] }))).toBe(
      true,
    );
  });

  it('is false for an option with no warn and no consequence tag', () => {
    expect(isIrreversibleOption(option('a', 'A'))).toBe(false);
    expect(isIrreversibleOption(option('a', 'A', { tags: [] }))).toBe(false);
  });

  it('ignores unrelated tag kinds', () => {
    expect(
      isIrreversibleOption(option('a', 'A', { tags: [{ kind: 'reversible', text: 'undoable' }] })),
    ).toBe(false);
  });
});

describe('confirmTargetOf', () => {
  it('targets the shown option with its label and consequence reading', () => {
    const sample = card('c1', {
      options: [option('one', 'One', { suggested: true, tags: [{ kind: 'warn', text: 'x' }] })],
    });
    expect(confirmTargetOf(sample, { kind: 'option', optionId: 'one' }, undefined)).toEqual({
      cardId: 'c1',
      revision: 1,
      optionId: 'one',
      replyText: null,
      label: 'One',
      irreversible: true,
      disabled: false,
      disabledReason: null,
    });
  });

  it('is null when nothing is shown or the shown option vanished', () => {
    expect(confirmTargetOf(card('c1'), undefined, undefined)).toBeNull();
    expect(
      confirmTargetOf(card('c1'), { kind: 'option', optionId: 'gone' }, undefined),
    ).toBeNull();
  });

  it('disables an own reply that is empty or only whitespace, and trims the label', () => {
    const sample = card('c1');
    expect(confirmTargetOf(sample, { kind: 'ownReply' }, undefined)).toMatchObject({
      optionId: null,
      replyText: '',
      label: '',
      disabled: true,
      disabledReason: null,
    });
    expect(confirmTargetOf(sample, { kind: 'ownReply' }, '   \n\t ')).toMatchObject({
      disabled: true,
    });
    expect(confirmTargetOf(sample, { kind: 'ownReply' }, '  approve  ')).toMatchObject({
      replyText: '  approve  ',
      label: 'approve',
      disabled: false,
      irreversible: false,
    });
  });

  it('disables an option the provider marked unconfirmable and states its reason', () => {
    const sample = card('c1', {
      options: [
        option('one', 'One', {
          suggested: true,
          confirmable: false,
          confirmableReason: '未声明的执行器',
        }),
      ],
    });
    expect(confirmTargetOf(sample, { kind: 'option', optionId: 'one' }, undefined)).toMatchObject(
      { disabled: true, disabledReason: '未声明的执行器' },
    );
  });

  it('falls back to the executor id when an unconfirmable option states no reason', () => {
    const sample = card('c1', {
      options: [option('one', 'One', { suggested: true, confirmable: false })],
    });
    expect(
      confirmTargetOf(sample, { kind: 'option', optionId: 'one' }, undefined)?.disabledReason,
    ).toBe('test.exec');
  });

  it('locks both the option path and the own-reply path while a receipt is outstanding', () => {
    const locked = card('c1', {
      feedback: {
        cardId: 'c1',
        revision: 1,
        feedbackId: 'f1',
        optionId: 'one',
        label: 'One',
        sentAt: '2026-10-27T00:00:00.000Z',
        outcome: { executor: 'test.exec', ok: true },
        canResend: true,
      },
    });
    expect(confirmTargetOf(locked, { kind: 'option', optionId: 'one' }, undefined)).toMatchObject(
      { disabled: true, disabledReason: FEEDBACK_LOCKED_REASON },
    );
    expect(confirmTargetOf(locked, { kind: 'ownReply' }, 'ship it')).toMatchObject({
      disabled: true,
      disabledReason: FEEDBACK_LOCKED_REASON,
    });
  });
});

describe('dismissTargetOf', () => {
  it('offers a target on a session-ask card', () => {
    expect(dismissTargetOf(card('c1'))).toEqual({
      cardId: 'c1',
      revision: 1,
      disabled: false,
      disabledReason: null,
    });
  });

  it('offers nothing on any other kind', () => {
    expect(dismissTargetOf(card('c1', { kind: 'need' }))).toBeNull();
    expect(dismissTargetOf(card('c1', { kind: 'fix' }))).toBeNull();
  });

  it('locks the target while a sent action awaits its receipt', () => {
    const locked = card('c1', {
      feedback: {
        cardId: 'c1',
        revision: 1,
        feedbackId: 'f1',
        optionId: null,
        label: 'reply',
        sentAt: '2026-10-27T00:00:00.000Z',
        outcome: { executor: 'test.exec', ok: true },
        canResend: true,
      },
    });
    expect(dismissTargetOf(locked)).toMatchObject({
      disabled: true,
      disabledReason: FEEDBACK_LOCKED_REASON,
    });
  });
});

describe('startedSessionIdOf', () => {
  it('reads the minted id from a session.start answer', () => {
    expect(startedSessionIdOf('session.start', { sessionId: 's-1' })).toBe('s-1');
  });

  it('is null for any other executor, whatever the answer says', () => {
    expect(startedSessionIdOf('session.send', { sessionId: 's-1' })).toBeNull();
  });

  it('is null when the answer is not an object or names no usable id', () => {
    expect(startedSessionIdOf('session.start', null)).toBeNull();
    expect(startedSessionIdOf('session.start', 's-1')).toBeNull();
    expect(startedSessionIdOf('session.start', {})).toBeNull();
    expect(startedSessionIdOf('session.start', { sessionId: 17 })).toBeNull();
    expect(startedSessionIdOf('session.start', { sessionId: '   ' })).toBeNull();
  });

  it('returns the stated id verbatim, without rewriting it', () => {
    expect(startedSessionIdOf('session.start', { sessionId: ' s-1 ' })).toBe(' s-1 ');
  });
});

describe('matchesProjectFilters', () => {
  it('matches every card when the selection is empty, including one with no project', () => {
    expect(matchesProjectFilters(card('c1'), [])).toBe(true);
    expect(matchesProjectFilters(card('c1', { subject: { uri: 'u' } }), [])).toBe(true);
  });

  it('matches a card that names one of the selected projects', () => {
    expect(matchesProjectFilters(card('c1'), ['p1'])).toBe(true);
    expect(matchesProjectFilters(card('c1'), ['p0', 'p1'])).toBe(true);
  });

  it('does not match a card naming another project or no project at all', () => {
    expect(matchesProjectFilters(card('c1'), ['p2'])).toBe(false);
    expect(matchesProjectFilters(card('c1', { subject: { uri: 'u' } }), ['p1'])).toBe(false);
  });
});

describe('visibleCardsOf', () => {
  const cards = [
    card('a', { kind: 'ask', subject: { uri: 'u/a', project: 'p1' } }),
    card('b', { kind: 'need', subject: { uri: 'u/b', project: 'p2' } }),
    card('c', { kind: 'ask', subject: { uri: 'u/c', project: 'p2' } }),
    card('d', { kind: 'fix', subject: { uri: 'u/d' } }),
  ];

  it('returns every card in provider order when nothing is filtered', () => {
    expect(visibleCardsOf(cards, 'all', []).map((entry) => entry.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('applies the type filter and the project filter together', () => {
    expect(visibleCardsOf(cards, 'ask', []).map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(visibleCardsOf(cards, 'all', ['p2']).map((entry) => entry.id)).toEqual(['b', 'c']);
    expect(visibleCardsOf(cards, 'ask', ['p2']).map((entry) => entry.id)).toEqual(['c']);
  });

  it('preserves provider order and leaves the input untouched', () => {
    const before = cards.map((entry) => entry.id);
    expect(visibleCardsOf(cards, 'all', []).map((entry) => entry.id)).toEqual(before);
    expect(cards.map((entry) => entry.id)).toEqual(before);
  });

  it('is empty when no card survives the combination', () => {
    expect(visibleCardsOf(cards, 'decision', [])).toEqual([]);
    expect(visibleCardsOf([], 'all', [])).toEqual([]);
  });
});

describe('typeCountsOf', () => {
  const cards = [
    card('a', { kind: 'ask', subject: { uri: 'u/a', project: 'p1' } }),
    card('b', { kind: 'need', subject: { uri: 'u/b', project: 'p2' } }),
    card('c', { kind: 'ask', subject: { uri: 'u/c', project: 'p2' } }),
  ];

  it('counts every surviving card by kind and states the total under `all`', () => {
    expect(typeCountsOf(cards, [])).toEqual({ all: 3, ask: 2, need: 1 });
  });

  it('counts only the cards that survive the project filter', () => {
    expect(typeCountsOf(cards, ['p2'])).toEqual({ all: 2, need: 1, ask: 1 });
  });

  it('states `all: 0` for an empty list and keeps the kind sum equal to `all`', () => {
    expect(typeCountsOf([], [])).toEqual({ all: 0 });
    const counts = typeCountsOf(cards, []);
    const kinds = Object.entries(counts).filter(([kind]) => kind !== 'all');
    expect(kinds.reduce((sum, [, value]) => sum + value, 0)).toBe(counts.all);
  });
});

describe('projectCountsOf', () => {
  const cards = [
    card('a', { kind: 'ask', subject: { uri: 'u/a', project: 'p1' } }),
    card('b', { kind: 'need', subject: { uri: 'u/b', project: 'p1' } }),
    card('c', { kind: 'need', subject: { uri: 'u/c', project: 'p2' } }),
    card('d', { kind: 'need', subject: { uri: 'u/d' } }),
    card('e', { kind: 'need', subject: { uri: 'u/e', project: '   ' } }),
  ];

  it('counts surviving cards by project', () => {
    expect(projectCountsOf(cards, 'all')).toEqual({ p1: 2, p2: 1 });
  });

  it('applies the type filter before counting', () => {
    expect(projectCountsOf(cards, 'need')).toEqual({ p1: 1, p2: 1 });
  });

  it('omits cards that name no project (absent or blank) and starts empty', () => {
    expect(projectCountsOf(cards, 'ask')).toEqual({ p1: 1 });
    expect(projectCountsOf([], 'all')).toEqual({});
  });
});

describe('normalizeProjectFilters', () => {
  it('trims, drops empties and non-strings, and deduplicates in the person’s order', () => {
    expect(
      normalizeProjectFilters([' p2 ', 'p1', 'p2', '', '   ', 17, null, 'p1']),
    ).toEqual(['p2', 'p1']);
  });

  it('is empty for a non-array or an entirely unusable array', () => {
    expect(normalizeProjectFilters(undefined)).toEqual([]);
    expect(normalizeProjectFilters('p1')).toEqual([]);
    expect(normalizeProjectFilters({ 0: 'p1' })).toEqual([]);
    expect(normalizeProjectFilters([42, null])).toEqual([]);
  });
});

describe('projectsOf', () => {
  it('lists each distinct project once, sorted', () => {
    expect(
      projectsOf([
        card('a', { subject: { uri: 'u/a', project: 'zeta' } }),
        card('b', { subject: { uri: 'u/b', project: 'alpha' } }),
        card('c', { subject: { uri: 'u/c', project: 'zeta' } }),
      ]),
    ).toEqual(['alpha', 'zeta']);
  });

  it('ignores cards with no project and returns an empty list for no cards', () => {
    expect(projectsOf([card('a', { subject: { uri: 'u/a' } })])).toEqual([]);
    expect(projectsOf([])).toEqual([]);
  });

  it('sorts by locale comparison and never repeats a project', () => {
    const projects = projectsOf([
      card('a', { subject: { uri: 'u/a', project: 'b' } }),
      card('b', { subject: { uri: 'u/b', project: 'A' } }),
    ]);
    expect(projects).toEqual(['A', 'b']);
    expect(new Set(projects).size).toBe(projects.length);
  });
});

describe('targetsOf', () => {
  it('returns one target per card that has a shown reading', () => {
    const targets = targetsOf(
      [card('c1'), card('c2')],
      { c1: { kind: 'option', optionId: 'one' }, c2: { kind: 'option', optionId: 'two' } },
      {},
    );
    expect(Object.keys(targets).sort()).toEqual(['c1', 'c2']);
    expect(targets.c1).toMatchObject({ optionId: 'one', label: 'One' });
    expect(targets.c2).toMatchObject({ optionId: 'two', label: 'Two' });
  });

  it('omits a card with no shown reading and a reading that no longer resolves', () => {
    expect(targetsOf([card('c1')], {}, {})).toEqual({});
    expect(
      targetsOf([card('c1')], { c1: { kind: 'option', optionId: 'gone' } }, {}),
    ).toEqual({});
  });

  it('carries the person’s own reply through the own-reply path', () => {
    expect(targetsOf([card('c1')], { c1: { kind: 'ownReply' } }, { c1: 'ship it' })).toMatchObject(
      { c1: { optionId: null, replyText: 'ship it', label: 'ship it' } },
    );
  });

  it('keys the result only by cards that produced a target', () => {
    const targets = targetsOf(
      [card('c1'), card('c2')],
      { c1: { kind: 'option', optionId: 'one' } },
      {},
    );
    expect(Object.keys(targets)).toEqual(['c1']);
  });
});

describe('dismissTargetsOf', () => {
  it('returns targets only for session-ask cards', () => {
    const targets = dismissTargetsOf([
      card('ask-1'),
      card('need-1', { kind: 'need' }),
      card('ask-2', { revision: 9 }),
    ]);
    expect(Object.keys(targets)).toEqual(['ask-1', 'ask-2']);
    expect(targets['ask-2']).toMatchObject({ revision: 9, disabled: false });
  });

  it('is empty for a list with no ask card and for an empty list', () => {
    expect(dismissTargetsOf([card('need-1', { kind: 'need' })])).toEqual({});
    expect(dismissTargetsOf([])).toEqual({});
  });

  it('never keys the result by a card that offers no dismiss', () => {
    const cards = [card('ask-1'), card('fix-1', { kind: 'fix' })];
    const targets = dismissTargetsOf(cards);
    for (const id of Object.keys(targets)) {
      expect(cards.some((entry) => entry.id === id && entry.kind === 'ask')).toBe(true);
    }
  });
});
