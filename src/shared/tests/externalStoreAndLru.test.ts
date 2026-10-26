import assert from 'node:assert/strict';

import { describe, test } from 'vitest';

import { createBoundedLru, createExternalStore } from '@/shared/utils';

/**
 * The two shared primitives the frontend stores and caches are built on.
 *
 * These are the rules every consumer relies on: a store notifies only on an
 * identity change, its lifecycle hooks fire on the 0↔1 subscriber edges, and an
 * LRU treats a read as a use so the least recently *used* key is the one that
 * leaves. Nothing here reaches into a feature module, which is why one file can
 * pin the behaviour for all of them.
 */

describe('createExternalStore', () => {
  test('notifies subscribers on set and update, and stops after unsubscribe', () => {
    const store = createExternalStore(0);
    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => seen.push(store.getSnapshot()));

    store.set(1);
    store.update((current) => current + 1);
    assert.deepEqual(seen, [1, 2]);

    unsubscribe();
    store.set(3);
    assert.deepEqual(seen, [1, 2], 'an unsubscribed listener is never called again');
    assert.equal(store.getSnapshot(), 3);
  });

  test('does not notify when the value identity did not change', () => {
    const value = { count: 0 };
    const store = createExternalStore(value);
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.set(value);
    store.update((current) => current);
    assert.equal(notifications, 0, 'same identity is not a change');

    store.set({ count: 0 });
    assert.equal(notifications, 1, 'a new object is a change even with equal fields');
  });

  test('update receives the newest value, and one listener may unsubscribe during notification', () => {
    const store = createExternalStore<string[]>([]);
    const calls: string[] = [];
    const unsubscribeFirst = store.subscribe(() => {
      calls.push('first');
      unsubscribeFirst();
    });
    store.subscribe(() => calls.push('second'));

    store.update((current) => [...current, 'a']);
    assert.deepEqual(calls, ['first', 'second']);
    assert.deepEqual(store.getSnapshot(), ['a']);

    calls.length = 0;
    store.set(['b']);
    assert.deepEqual(calls, ['second'], 'the listener that left is not called again');
  });

  test('lifecycle hooks fire on the first subscriber and the last unsubscribe only', () => {
    let starts = 0;
    let stops = 0;
    const store = createExternalStore(0, {
      onFirstSubscriber: () => {
        starts += 1;
      },
      onLastUnsubscriber: () => {
        stops += 1;
      },
    });

    const first = store.subscribe(() => {});
    const second = store.subscribe(() => {});
    assert.deepEqual([starts, stops], [1, 0], 'the second subscriber starts nothing');

    first();
    assert.deepEqual([starts, stops], [1, 0], 'one reader still remains');
    second();
    assert.deepEqual([starts, stops], [1, 1]);

    // Running an unsubscribe twice must not report the last reader leaving twice.
    second();
    assert.deepEqual([starts, stops], [1, 1]);
  });
});

describe('createBoundedLru', () => {
  test('get refreshes recency, so the least recently used key is evicted first', () => {
    const cache = createBoundedLru<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);

    // Reading `a` makes `b` the least recently used key.
    assert.equal(cache.get('a'), 1);
    cache.set('c', 3);

    assert.equal(cache.get('a'), 1, 'a was read, so it stayed');
    assert.equal(cache.get('b'), undefined, 'b was the least recently used and left');
    assert.equal(cache.get('c'), 3);
    assert.equal(cache.size, 2);
  });

  test('evicts in insertion order when nothing is read', () => {
    const cache = createBoundedLru<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4);

    assert.equal(cache.get('a'), undefined);
    assert.deepEqual(
      ['b', 'c', 'd'].map((key) => cache.get(key)),
      [2, 3, 4],
    );
  });

  test('set reports the evicted value so a caller can release its resource', () => {
    const cache = createBoundedLru<string, string>(1);
    assert.equal(cache.set('a', 'url-a'), undefined);
    assert.equal(cache.set('b', 'url-b'), 'url-a');
    assert.equal(cache.get('a'), undefined);
  });

  test('delete, clear and size reflect the held keys', () => {
    const cache = createBoundedLru<string, number>(4);
    cache.set('a', 1);
    cache.set('b', 2);
    assert.equal(cache.delete('a'), true);
    assert.equal(cache.delete('a'), false);
    assert.equal(cache.size, 1);
    cache.clear();
    assert.equal(cache.size, 0);
    assert.equal(cache.get('b'), undefined);
  });

  test('rejects a capacity that could never hold a key', () => {
    assert.throws(() => createBoundedLru(0), RangeError);
    assert.throws(() => createBoundedLru(-1), RangeError);
    assert.throws(() => createBoundedLru(1.5), RangeError);
  });
});
