import assert from 'node:assert/strict';

import { afterEach, beforeEach, describe, test, vi } from 'vitest';

import { enterCockpit } from '@/modules/cockpit/cockpitEntry';

/**
 * The one action every route into the cockpit goes through.
 *
 * The record it writes is what the cockpit page's 「会话」 segment navigates back to, so the
 * cases here are the two facts that can silently regress: entering from somewhere OTHER than
 * the cockpit records that route (and only then), and a blocked storage area still lets the
 * trip happen instead of making the door throw.
 */

const CARDS_PAGE = '/cockpit?view=cards';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

const storedReturnPath = (): string | null =>
  window.sessionStorage.getItem('cockpit.returnPath');

describe('enterCockpit', () => {
  test('records the session route it was entered from, then navigates to the target once', () => {
    const navigate = vi.fn();

    enterCockpit({
      navigate,
      target: CARDS_PAGE,
      location: { pathname: '/session/abc123', search: '?tab=chat' },
    });

    assert.equal(
      storedReturnPath(),
      '/session/abc123?tab=chat',
      'the whole address, query included, is what the 「会话」 segment returns to',
    );
    assert.equal(navigate.mock.calls.length, 1, 'the target is navigated exactly once');
    assert.deepEqual(navigate.mock.calls[0], [CARDS_PAGE], 'and it is the requested target');
  });

  test('entering from the workspace root records `/`, the cockpit’s home fallback', () => {
    const navigate = vi.fn();

    enterCockpit({ navigate, target: CARDS_PAGE, location: { pathname: '/', search: '' } });

    assert.equal(storedReturnPath(), '/');
    assert.equal(navigate.mock.calls.length, 1);
  });

  test('does not overwrite the record when already inside the cockpit', () => {
    window.sessionStorage.setItem('cockpit.returnPath', '/session/before');
    const navigate = vi.fn();

    enterCockpit({
      navigate,
      target: '/cockpit?view=wall',
      location: { pathname: '/cockpit', search: '?view=cards' },
    });

    assert.equal(
      storedReturnPath(),
      '/session/before',
      'the cockpit is where the person already is; it must not become their way back',
    );
    assert.equal(navigate.mock.calls.length, 1);

    // The remote sub-page belongs to the cockpit too.
    enterCockpit({
      navigate,
      target: '/cockpit?view=wall',
      location: { pathname: '/cockpit/remote', search: '' },
    });
    assert.equal(storedReturnPath(), '/session/before');
  });

  test('a blocked storage area does not stop the navigation', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('storage disabled', 'SecurityError');
    });
    const navigate = vi.fn();

    assert.doesNotThrow(() =>
      enterCockpit({
        navigate,
        target: CARDS_PAGE,
        location: { pathname: '/session/abc123', search: '' },
      }),
    );
    assert.equal(navigate.mock.calls.length, 1, 'the door still opens without a record');

    setItem.mockRestore();
  });

  test('a modified click records the return path without navigating this tab', () => {
    enterCockpit({
      navigate: null,
      target: CARDS_PAGE,
      location: { pathname: '/session/abc123', search: '' },
    });

    assert.equal(
      storedReturnPath(),
      '/session/abc123',
      'the cockpit opened in another tab still knows where the person was',
    );
  });
});
