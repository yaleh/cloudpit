import assert from 'node:assert/strict';

import { render, screen } from '@testing-library/react';
import { describe, it } from 'vitest';

import {
  buildCacheUsageBreakdown,
  CostContent,
  formatCacheHitRatio,
} from '@/modules/chat-support/modals/CostContent';
import type { CostCommandData, TokenUsageCounts } from '@/shared/types';

/**
 * The `/cost` panel's cache accounting.
 *
 * Two kinds of reading:
 *  · the derivation (`buildCacheUsageBreakdown`) is a pure function, asserted
 *    directly on the quantities the proposal names;
 *  · the rendering is asserted through the same `data-cost-*` declarations a
 *    scenario surface reads, so "the row is drawn" is a structural fact rather
 *    than a string match on translated prose.
 *
 * "Not reported" is never "zero": a missing `cacheWriteTokens` draws no row and
 * no bar segment, which is why the absent-field leg is its own case.
 */

/** A structured (cumulative provider, e.g. Codex) `/cost` payload. */
const structuredCost = (cumulative: TokenUsageCounts): CostCommandData => ({
  provider: 'codex',
  model: 'gpt-5.6-sol',
  tokenUsage: {
    used: 120,
    total: 258400,
    scope: 'session-cumulative',
    cumulative,
  },
});

describe('buildCacheUsageBreakdown', () => {
  it('derives ratio 0.30, fresh 50 and 50/30/20 segments for 100/30/20', () => {
    const breakdown = buildCacheUsageBreakdown({ input: 100, cacheRead: 30, cacheWrite: 20 });

    assert.ok(breakdown, 'a positive input must produce a breakdown');
    assert.equal(breakdown.ratio, 0.3);
    assert.equal(breakdown.fresh, 50);
    assert.deepEqual(breakdown.segments, { fresh: 50, cacheRead: 30, cacheWrite: 20 });
    assert.equal(formatCacheHitRatio(breakdown.ratio), '30%');
  });

  it('subtracts only cache read when the source did not report a cache write', () => {
    const breakdown = buildCacheUsageBreakdown({ input: 100, cacheRead: 30 });

    assert.ok(breakdown);
    assert.equal(breakdown.fresh, 70);
    assert.equal(breakdown.cacheWriteReported, false);
    assert.deepEqual(breakdown.segments, { fresh: 70, cacheRead: 30, cacheWrite: 0 });
  });

  it('claims no ratio without a positive input denominator', () => {
    assert.equal(buildCacheUsageBreakdown(undefined), null);
    assert.equal(buildCacheUsageBreakdown({ input: 0, cacheRead: 30 }), null);
    assert.equal(buildCacheUsageBreakdown({ cacheRead: 30 }), null);
  });
});

describe('CostContent cache rendering', () => {
  it('renders a cache-write row with the subset hint when the block reports one', () => {
    render(
      <CostContent
        data={structuredCost({
          inputTokens: 100,
          outputTokens: 40,
          cacheReadTokens: 30,
          cacheWriteTokens: 20,
        })}
      />,
    );

    assert.ok(screen.getByText('Cached write tokens'), 'the cache-write row must render');
    // Both cache rows carry the subset hint: they are detail reads, not addends.
    assert.equal(screen.getAllByText('subset of input — not added again').length, 2);
  });

  it('renders no cache-write row or segment when the block did not report the quantity', () => {
    render(
      <CostContent
        data={structuredCost({ inputTokens: 100, outputTokens: 40, cacheReadTokens: 30 })}
      />,
    );

    assert.equal(screen.queryByText('Cached write tokens'), null);
    assert.equal(screen.getAllByText('subset of input — not added again').length, 1);
    const bar = screen.getByTestId('cost-cache-usage-bar');
    assert.equal(bar.querySelectorAll('[data-cost-segment]').length, 2);
    assert.equal(bar.querySelector('[data-cost-segment="cacheWrite"]'), null);
  });

  it('renders the hit-rate row and the three-segment bar from the cumulative block', () => {
    render(
      <CostContent
        data={structuredCost({
          inputTokens: 100,
          outputTokens: 40,
          cacheReadTokens: 30,
          cacheWriteTokens: 20,
        })}
      />,
    );

    const ratioRow = screen
      .getAllByTestId('cost-usage-row')
      .find((row) => row.getAttribute('data-cost-role') === 'cache-hit-ratio');
    assert.ok(ratioRow, 'the cache hit rate is its own row');
    assert.equal(ratioRow.getAttribute('data-cost-value'), '30%');

    const bar = screen.getByTestId('cost-cache-usage-bar');
    const segments = [...bar.querySelectorAll<HTMLElement>('[data-cost-segment]')];
    assert.deepEqual(
      segments.map((segment) => segment.getAttribute('data-cost-segment')),
      ['fresh', 'cacheRead', 'cacheWrite'],
    );
    assert.deepEqual(
      segments.map((segment) => Number(segment.getAttribute('data-cost-percent'))),
      [50, 30, 20],
    );
  });

  it('states the provider-specific cache accounting in the meta card', () => {
    render(
      <CostContent
        data={structuredCost({ inputTokens: 100, outputTokens: 40, cacheReadTokens: 30 })}
      />,
    );

    const note = screen.getByTestId('cost-cache-accounting-note');
    assert.match(note.textContent ?? '', /Input already includes cached input tokens/);
  });
});
