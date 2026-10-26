import assert from 'node:assert/strict';
import test from 'node:test';

import { errorMessage, isRecord } from '@/shared/utils.js';

/**
 * The two shared helpers the observation, architecture, quay, liaison, settings,
 * session-hosts and voice-realtime modules now import instead of carrying their
 * own copy.
 *
 * The readings below are the ones the copies disagreed about: `isRecord` must
 * reject arrays and `null` (both answer `typeof === 'object'`), and
 * `errorMessage` must keep an `Error`'s own message — including an empty one —
 * while a caller-supplied fallback is what blank messages and non-`Error`
 * throws resolve to.
 */

test('isRecord accepts object-shaped values and rejects arrays, null and primitives', () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord({ nested: { ok: true } }), true);

  assert.equal(isRecord([]), false, 'an array is not a record');
  assert.equal(isRecord(['x']), false, 'a populated array is not a record');
  assert.equal(isRecord(null), false);
  assert.equal(isRecord(undefined), false);
  assert.equal(isRecord('text'), false);
  assert.equal(isRecord(42), false);
  assert.equal(isRecord(true), false);

  class Thing {
    readonly kind = 'thing';
  }
  assert.equal(isRecord(new Thing()), true, 'a class instance is object-shaped');
});

test('errorMessage keeps an Error message and stringifies other throws', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage('boom'), 'boom');
  assert.equal(errorMessage(7), '7');

  assert.equal(errorMessage(new Error('')), '', 'without a fallback the raw reading is kept');
  assert.equal(errorMessage(new Error('   ')), '   ', 'whitespace is not rewritten without a fallback');
});

test('errorMessage uses the caller fallback for blank messages and non-Error throws', () => {
  assert.equal(errorMessage(new Error('boom'), 'fallback'), 'boom', 'a real message still wins');
  assert.equal(errorMessage(new Error(''), 'fallback'), 'fallback');
  assert.equal(errorMessage(new Error('   '), 'fallback'), 'fallback', 'a whitespace-only message is blank');
  assert.equal(errorMessage('boom', 'fallback'), 'fallback', 'a non-Error throw uses the fallback');
  assert.equal(errorMessage(null, 'fallback'), 'fallback');
});
