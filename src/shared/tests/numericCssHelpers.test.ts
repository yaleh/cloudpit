import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { clamp, parseCssPx } from '@/shared/utils';

/**
 * The two numeric helpers the architecture, chat and shell modules now import
 * instead of carrying their own copies.
 *
 * `clamp` must agree with every copy it replaces — the copies differed only in
 * a non-finite guard, which the shared version takes from the minimap — and
 * `parseCssPx` must read computed padding the way the graph and viewport code
 * did: a parsed number when there is one, 0 when the length is absent or not
 * numeric.
 */

describe('clamp', () => {
  test('returns the value when it is already inside the range', () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(0, 0, 10), 0, 'the lower bound is inclusive');
    assert.equal(clamp(10, 0, 10), 10, 'the upper bound is inclusive');
    assert.equal(clamp(-3, -10, -1), -3);
  });

  test('stops outside values at the nearest bound', () => {
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(11, 0, 10), 10);
    assert.equal(clamp(-20, -10, -1), -10);
  });

  test('falls back to the minimum for NaN and both infinities', () => {
    assert.equal(clamp(Number.NaN, 2, 8), 2, 'NaN previously leaked through every copy');
    assert.equal(clamp(Number.POSITIVE_INFINITY, 2, 8), 2, 'the shared contract treats +Infinity as non-finite');
    assert.equal(clamp(Number.NEGATIVE_INFINITY, 2, 8), 2, 'the shared contract treats -Infinity as non-finite');
  });
});

describe('parseCssPx', () => {
  test('reads a px length as its number', () => {
    assert.equal(parseCssPx('12px'), 12);
    assert.equal(parseCssPx('0'), 0);
    assert.equal(parseCssPx('12.5px'), 12.5);
    assert.equal(parseCssPx('-4px'), -4);
  });

  test('returns 0 for absent and non-numeric lengths', () => {
    assert.equal(parseCssPx(''), 0, 'an absent value is not a number');
    assert.equal(parseCssPx('auto'), 0, 'a keyword has no px reading');
    assert.equal(parseCssPx('  '), 0);
  });
});
