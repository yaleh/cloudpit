import { describe, expect, it } from 'vitest';

import type { CockpitCard } from '@/shared/types';
import {
  cockpitCardDuplicateGroups,
  cockpitCardQuestionOf,
  normalizeCockpitCardQuestion,
} from '@/modules/cockpit/cockpitCardDuplicates';

/**
 * Folding cards that ask the same question in the same session.
 *
 * The rule has three parts, and each is one case below: what makes two cards the same question
 * (the session and the normalized ask), which card stays (the latest surfacing), and what a group
 * of cards with no wording at all means (one session, one card that states the count). The
 * grouping is a pure function over a list, so there is no React and no clock in the loop.
 */

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
    subject: { uri: `cloudcli://test/${id}`, project: 'p1', sessionId: 's1' },
    facts: [],
    options: [],
    ask: 'Delete the staging directory?',
    ...overrides,
  };
}

describe('the same question in the same session folds into one card', () => {
  it('keeps the later surfacedAt and folds the earlier card', () => {
    const ids = cockpitCardDuplicateGroups([
      card('early', { surfacedAt: '2026-10-27T00:00:01.000Z' }),
      card('late', { surfacedAt: '2026-10-27T00:10:00.000Z' }),
    ]);

    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatchObject({
      keep: 'late',
      hidden: ['early'],
      count: 2,
      question: 'Delete the staging directory',
    });
  });

  it('a tie in surfacedAt keeps the card earlier in provider order', () => {
    const groups = cockpitCardDuplicateGroups([card('first'), card('second')]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ keep: 'first', hidden: ['second'] });
  });

  it('different sessions never fold, even with identical wording', () => {
    const groups = cockpitCardDuplicateGroups([
      card('a', { subject: { uri: 'cloudcli://test/a', sessionId: 's1' } }),
      card('b', { subject: { uri: 'cloudcli://test/b', sessionId: 's2' } }),
    ]);

    expect(groups).toEqual([]);
  });

  it('different questions in one session never fold', () => {
    const groups = cockpitCardDuplicateGroups([
      card('a', { ask: 'Delete the staging directory?' }),
      card('b', { ask: 'Keep the transcript?' }),
    ]);

    expect(groups).toEqual([]);
  });

  it('trailing punctuation and whitespace runs do not make a different question', () => {
    const groups = cockpitCardDuplicateGroups([
      card('a', { ask: '  Delete   the staging\ndirectory?  ' }),
      card('b', {
        ask: 'Delete the staging directory',
        surfacedAt: '2026-10-27T00:00:02.000Z',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ keep: 'b', hidden: ['a'] });
  });

  it('falls back to the situation when the ask was never resolved', () => {
    const groups = cockpitCardDuplicateGroups([
      card('a', { ask: undefined, situation: 'The run left 1.2 GB in staging.' }),
      card('b', {
        ask: undefined,
        situation: 'The run left 1.2 GB in staging',
        surfacedAt: '2026-10-27T00:00:02.000Z',
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      keep: 'b',
      hidden: ['a'],
      question: 'The run left 1.2 GB in staging',
    });
  });

  it('keeps the folded cards in provider order and counts all three', () => {
    const groups = cockpitCardDuplicateGroups([
      card('a', { surfacedAt: '2026-10-27T00:03:00.000Z' }),
      card('b', { surfacedAt: '2026-10-27T00:01:00.000Z' }),
      card('c', { surfacedAt: '2026-10-27T00:02:00.000Z' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      keep: 'a',
      hidden: ['b', 'c'],
      count: 3,
    });
  });

  it('normalizes the question text for comparison', () => {
    expect(normalizeCockpitCardQuestion('  Two   lines\nhere!  ')).toBe('Two lines here');
    expect(normalizeCockpitCardQuestion('中文问句？')).toBe('中文问句');
    expect(normalizeCockpitCardQuestion('   ')).toBe('');
    expect(cockpitCardQuestionOf(card('a', { ask: undefined, situation: undefined }))).toBeNull();
  });
});

describe('cards with no question at all fold by session', () => {
  it('folds the same session’s empty cards into one group of three', () => {
    const groups = cockpitCardDuplicateGroups([
      card('a', { ask: undefined, situation: undefined }),
      card('b', { ask: undefined, situation: undefined }),
      card('c', { ask: undefined, situation: undefined }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      keep: 'a',
      hidden: ['b', 'c'],
      count: 3,
      question: null,
    });
  });

  it('does not fold an empty card together with a card that states a question', () => {
    const groups = cockpitCardDuplicateGroups([
      card('empty', { ask: undefined, situation: undefined }),
      card('asked', { ask: 'Delete the staging directory?' }),
    ]);

    expect(groups).toEqual([]);
  });

  it('does not fold empty cards from different sessions', () => {
    const groups = cockpitCardDuplicateGroups([
      card('a', { ask: undefined, situation: undefined, subject: { uri: 'x', sessionId: 's1' } }),
      card('b', { ask: undefined, situation: undefined, subject: { uri: 'y', sessionId: 's2' } }),
    ]);

    expect(groups).toEqual([]);
  });

  it('never folds cards that name no session', () => {
    const groups = cockpitCardDuplicateGroups([
      card('a', { subject: { uri: 'x' } }),
      card('b', { subject: { uri: 'y' } }),
    ]);

    expect(groups).toEqual([]);
  });
});
