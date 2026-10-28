import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { errorMessage, isEditableTarget, isRecord } from '@/shared/utils';

/**
 * The shared helpers the architecture, settings and cockpit modules now import
 * instead of carrying their own copy.
 *
 * The readings below are the ones the copies disagreed about: `isRecord` must
 * reject arrays and `null` (both answer `typeof === 'object'`), and
 * `errorMessage` must keep an `Error`'s own message — including an empty one —
 * while a caller-supplied fallback is what blank messages and non-`Error`
 * throws resolve to. `isEditableTarget` is the predicate the cockpit page and
 * its push-to-talk hook each carried byte-identically — it must stay true only
 * for elements that own keyboard input.
 */

describe('isEditableTarget', () => {
  test('accepts only elements that own keyboard input', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const contentEditable = document.createElement('div');
    // jsdom does not implement `isContentEditable`, so the branch the predicate actually reads
    // is stubbed here; a real browser derives it from the contenteditable attribute.
    Object.defineProperty(contentEditable, 'isContentEditable', { value: true });

    assert.equal(isEditableTarget(input), true);
    assert.equal(isEditableTarget(textarea), true);
    assert.equal(isEditableTarget(select), true);
    assert.equal(isEditableTarget(contentEditable), true);

    assert.equal(isEditableTarget(document.createElement('button')), false);
    assert.equal(isEditableTarget(document.createElement('div')), false);
    assert.equal(isEditableTarget(null), false);
    assert.equal(isEditableTarget(new EventTarget()), false, 'a non-element target cannot own a field');
  });
});

describe('isRecord', () => {
  test('accepts object-shaped values and rejects arrays, null and primitives', () => {
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
});

describe('errorMessage', () => {
  test('keeps an Error message and stringifies other throws', () => {
    assert.equal(errorMessage(new Error('boom')), 'boom');
    assert.equal(errorMessage('boom'), 'boom');
    assert.equal(errorMessage(7), '7');

    assert.equal(errorMessage(new Error('')), '', 'without a fallback the raw reading is kept');
    assert.equal(errorMessage(new Error('   ')), '   ', 'whitespace is not rewritten without a fallback');
  });

  test('uses the caller fallback for blank messages and non-Error throws', () => {
    assert.equal(errorMessage(new Error('boom'), 'fallback'), 'boom', 'a real message still wins');
    assert.equal(errorMessage(new Error(''), 'fallback'), 'fallback');
    assert.equal(errorMessage(new Error('   '), 'fallback'), 'fallback', 'a whitespace-only message is blank');
    assert.equal(errorMessage('boom', 'fallback'), 'fallback', 'a non-Error throw uses the fallback');
    assert.equal(errorMessage(null, 'fallback'), 'fallback');
  });
});
