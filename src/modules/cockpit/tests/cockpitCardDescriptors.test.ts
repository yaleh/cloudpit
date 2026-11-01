import { describe, expect, it } from 'vitest';

import { cockpitAssistantQuote } from '@/modules/cockpit/cockpitCardDescriptors';
import type { CockpitCard } from '@/shared/types';

/**
 * The assistant-quote fallback: the one place a card's summary can carry the assistant's own
 * words, and the mechanical kinds whose brackets wrap a task title instead. The fixture is
 * minimal because `cockpitAssistantQuote` reads only `kind`, `situation` and `ask`.
 */

const BASE: CockpitCard = {
  id: 'fixture',
  provider: 'fixture',
  revision: 1,
  kind: 'ask',
  group: 'rescue',
  rank: 0,
  state: 'open',
  waitingSince: '2026-11-01T00:00:00.000Z',
  surfacedAt: '2026-11-01T00:00:00.000Z',
  subject: { uri: 'quay://quay-fleet/task/gap-fixture' },
  facts: [],
  options: [],
};

function cardOf(overrides: Partial<CockpitCard>): CockpitCard {
  return { ...BASE, ...overrides };
}

describe('cockpitAssistantQuote', () => {
  it('extracts the first quoted sentence from a session-ask summary', () => {
    const card = cardOf({ situation: '对话里只有“继续”，没有 diff 内容。' });
    expect(cockpitAssistantQuote(card)).toBe('继续');
  });

  it('falls back to the ask when the situation quotes nothing', () => {
    const card = cardOf({ ask: '你选「先不合并」还是「合并」？' });
    expect(cockpitAssistantQuote(card)).toBe('先不合并');
  });

  it('returns null when an ask card quotes nothing', () => {
    const card = cardOf({ ask: '要合并吗？', situation: '没有引语。' });
    expect(cockpitAssistantQuote(card)).toBeNull();
  });

  it('returns null for a mechanical need card whose ask wraps the task title in 『』', () => {
    const card = cardOf({
      kind: 'need',
      ask: '任务『GOAL-010 补一个非空退出条件节』是一份待裁定的提案，需要你决定是否采纳。',
    });
    expect(cockpitAssistantQuote(card)).toBeNull();
  });

  it('returns null for a mechanical need card whose situation quotes a fact in 「」', () => {
    const card = cardOf({
      kind: 'need',
      situation: '结论：不是「AC 集缺一条」，而是左操作数没写下来。',
    });
    expect(cockpitAssistantQuote(card)).toBeNull();
  });

  it('returns null for every other mechanical kind and unknown kinds', () => {
    const ask = '任务『标题』需要你决定。';
    for (const kind of ['need', 'fix', 'stuck', 'decision', 'multi', 'knowledge', 'unknown']) {
      const card = cardOf({ kind, ask });
      expect(cockpitAssistantQuote(card)).toBeNull();
    }
  });
});
