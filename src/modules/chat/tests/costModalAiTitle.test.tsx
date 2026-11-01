import assert from 'node:assert/strict';

import { render } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { initReactI18next } from 'react-i18next';
import { test } from 'vitest';

import { CommandResultModal } from '@/modules/chat-support';
import { TokenUsageSummary } from '@/modules/chat-composer';
import enChat from '@/modules/i18n/locales/en/chat.json';
import type { CommandModalPayload, CostCommandData } from '@/shared/types';

/**
 * The `/cost` modal's meta card listed the provider and the model, and nothing
 * about what the session is actually called.
 *
 * The title shown has to be the one Claude generated — not the session's name,
 * which a rename or a first-message fallback can have replaced — and the server
 * omits it entirely for every session whose transcript has none, so the modal
 * has to render nothing at all in that case rather than an "Unknown" row.
 *
 * Real translations rather than a stub `t`, and the real modal rather than
 * `CostContent` in isolation: the label has to reach the rendered output
 * through the dialog, and the ordering assertion below is about where it lands
 * inside the meta card.
 */

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['chat'],
  defaultNS: 'chat',
  resources: { en: { chat: enChat } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const costPayload = (data: CostCommandData): CommandModalPayload => ({ kind: 'cost', data });

const renderCostModal = (data: CostCommandData) =>
  render(
    <CommandResultModal
      payload={costPayload(data)}
      onClose={() => {}}
      providerModelCatalog={{}}
      providerModelActions={{} as never}
      activeProvider="claude"
      activeProviderModel="sonnet"
      currentSessionId="session-1"
      onSelectProviderModel={async () => ({ scope: 'default', model: 'sonnet' })}
    />,
  );

/** Offset of the last element whose exact text is `text`, or -1. */
const positionOf = (text: string): number => {
  const matches = Array.from(document.querySelectorAll('p')).filter(
    (element) => element.textContent === text,
  );
  const last = matches[matches.length - 1];
  if (!last) {
    return -1;
  }

  return Array.from(document.querySelectorAll('p')).indexOf(last);
};

test('the meta card shows the generated ai-title under the provider and model', () => {
  renderCostModal({
    cost: {
      context: { used: 1_200, window: 4_000 },
      accountingNote: 'Input already includes cache reads and cache writes.',
    },
    provider: 'claude',
    model: 'claude-sonnet-4-5',
    aiTitle: 'Generated From The Chat',
  });

  assert.equal(positionOf('AI title') >= 0, true, 'the AI title label must be rendered');
  assert.equal(positionOf('Generated From The Chat') >= 0, true, 'the generated title must be rendered');

  const providerAt = positionOf('Provider');
  const modelAt = positionOf('Model');
  const labelAt = positionOf('AI title');
  assert.equal(providerAt >= 0 && modelAt >= 0, true, 'the existing rows must still be there');
  assert.equal(
    labelAt > modelAt && labelAt > providerAt,
    true,
    'the generated title belongs after the provider and model it describes',
  );
});

test('the meta card renders no AI title row when the field is absent', () => {
  renderCostModal({
    cost: {
      context: { used: 1_200, window: 4_000 },
      accountingNote: 'Input already includes cache reads and cache writes.',
    },
    provider: 'claude',
    model: 'claude-sonnet-4-5',
  });

  assert.equal(positionOf('AI title'), -1, 'no title must mean no row, not a placeholder');
  assert.equal(positionOf('Unknown') >= 0, false, 'and no "Unknown" standing in for it');
  assert.equal(positionOf('Provider') >= 0, true, 'the rest of the meta card is untouched');
  assert.equal(positionOf('claude-sonnet-4-5') >= 0, true);
});

test('the meta card renders no AI title row for a blank title', () => {
  renderCostModal({
    cost: {
      context: { used: 1_200, window: 4_000 },
      accountingNote: 'Input already includes cache reads and cache writes.',
    },
    provider: 'claude',
    model: 'claude-sonnet-4-5',
    aiTitle: '   ',
  });

  assert.equal(positionOf('AI title'), -1, 'a whitespace-only title is as absent as a missing one');
});

/**
 * The server-derived `/cost` view for a cumulative provider. The three readings
 * are separate facts: whole-session spend, the latest request as a context
 * estimate, and the window capacity. The modal renders them without treating
 * the window as a denominator or adding detail to its parent.
 */
const cumulativeCost = (overrides: Partial<NonNullable<CostCommandData['cost']>> = {}) => ({
  session: {
    total: 1_500,
    input: 1_200,
    output: 300,
    cacheRead: 900,
    reasoningOutput: 120,
    cacheHitRatio: 0.75,
    fresh: 300,
  },
  context: { window: 258_400 },
  lastRequest: {
    inputTokens: 800,
    outputTokens: 90,
    cacheReadTokens: 600,
    reasoningOutputTokens: 40,
    totalTokens: 890,
  },
  accountingNote: 'Input already includes cached input tokens (cached_input_tokens).',
  ...overrides,
});

test('the cost modal groups cumulative, latest request and window as separate readings', () => {
  renderCostModal({
    cost: cumulativeCost(),
    provider: 'codex',
    model: 'gpt-5-codex',
  });

  const text = document.body.textContent ?? '';
  assert.ok(text.includes('Session cumulative'));
  assert.ok(text.includes('Latest request (context estimate)'));
  assert.ok(text.includes('Context window'));
  // Subsets are labelled as subsets so they are not read as additional rows.
  assert.ok(text.includes('subset of input — not added again'));
  assert.ok(text.includes('subset of output — not added again'));
  // The displayed total is the source's own total, not the sum of its detail.
  assert.ok(text.includes((1_500).toLocaleString()));
  assert.equal(text.includes((1_200 + 900 + 300 + 120).toLocaleString()), false);
  // The window is shown as capacity, not as a derived fraction of the total.
  assert.ok(text.includes((258_400).toLocaleString()));
  // The cache-hit-rate row is the one percentage this layout renders
  // (cacheRead/input = 900/1200); a window/total fraction would add another.
  assert.deepEqual(text.match(/\d+(?:\.\d+)?%/g) ?? [], ['75%']);
});

test('the grouped layout omits unreported quantities and keeps an explicit zero', () => {
  renderCostModal({
    cost: {
      session: { total: 10, input: 10, output: 0 },
      accountingNote: 'Input already includes cached input tokens (cached_input_tokens).',
    },
    provider: 'codex',
    model: 'gpt-5-codex',
  });

  const text = document.body.textContent ?? '';
  assert.ok(text.includes('Session cumulative'));
  // Missing detail is absent, not a zero row and not an empty section.
  assert.equal(text.includes('Cached input tokens'), false);
  assert.equal(text.includes('Reasoning output tokens'), false);
  assert.equal(text.includes('Latest request'), false);
  assert.equal(text.includes('Context window'), false);
  // The explicitly reported zero survives.
  const labels = Array.from(document.querySelectorAll('span')).map((element) => element.textContent);
  assert.ok(labels.includes('Output tokens'));
  assert.equal(labels.filter((label) => label === '0').length, 1);
});

test('a context-only reading renders the context block alone', () => {
  renderCostModal({
    cost: {
      context: { used: 1_200, window: 4_000 },
      accountingNote: 'Input already includes cache reads and cache writes.',
    },
    provider: 'claude',
    model: 'claude-sonnet-4-5',
  });

  const text = document.body.textContent ?? '';
  assert.ok(text.includes('Context used'));
  assert.ok(text.includes('Window capacity'));
  // No session or latest-request additions leak into a context-only reading.
  assert.equal(text.includes('Session cumulative'), false);
  assert.equal(text.includes('Latest request'), false);
  assert.equal(text.includes('subset of input'), false);
});

test('the compact counter names the cumulative scope it is showing', () => {
  const { container } = render(
    <TokenUsageSummary usage={{ used: 1_500, usageScope: 'session-cumulative' }} />,
  );

  // The number is a whole-session total, not current context occupancy; the
  // chip has to say so instead of leaving the reader to assume a window ratio.
  assert.ok((container.textContent ?? '').includes('session total'));
  assert.ok((container.textContent ?? '').includes('1.5K'));
});

test('the compact counter keeps the legacy context reading unchanged', () => {
  const { container } = render(<TokenUsageSummary usage={{ used: 1_500 }} />);

  assert.equal((container.textContent ?? '').includes('session total'), false);
  assert.ok((container.textContent ?? '').includes('1.5K'));
});
