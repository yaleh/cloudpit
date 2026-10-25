import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { MAX_QUOTED_SELECTION_CHARS, useTranscriptSelection } from '@/modules/chat/hooks/useTranscriptSelection';

/**
 * The quoted-chip source, one rule per case.
 *
 * jsdom implements `Range` and `Selection`, so the cases build a real transcript
 * region and a real selection over its text nodes, then dispatch the same
 * `selectionchange` event a browser would. Nothing here re-derives what the hook
 * reads: the DOM selection IS the input.
 */

const SETTLE_MS = 50;

const makeRegion = (text: string, marker = true) => {
  const region = document.createElement('div');
  if (marker) {
    region.setAttribute('data-transcript-content', '');
  }
  const paragraph = document.createElement('p');
  const textNode = document.createTextNode(text);
  paragraph.appendChild(textNode);
  region.appendChild(paragraph);
  document.body.appendChild(region);
  return { region, textNode };
};

const selectRange = (node: Node, start: number, end: number) => {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const selection = window.getSelection();
  assert.ok(selection, 'jsdom must expose a Selection');
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
};

const clearSelection = () => {
  window.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
};

const settle = () => act(() => {
  vi.advanceTimersByTime(SETTLE_MS + 1);
});

const renderSelection = () => renderHook(() => useTranscriptSelection({ settleMs: SETTLE_MS }));

/**
 * Dispatch a pointer event. The hook only reads `target` (to decide whether a press
 * started inside the transcript), so a plain bubbling `Event` reaches the same
 * capture-phase listener a real `PointerEvent` would. jsdom ships no `PointerEvent`.
 */
const pointer = (target: EventTarget, type: string) => {
  target.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
});

describe('useTranscriptSelection', () => {
  it('reads a selection whose ends both lie in the transcript region', () => {
    const { textNode } = makeRegion('这是助手回答里的一段话');
    const { result } = renderSelection();

    selectRange(textNode, 0, 8);
    settle();

    assert.equal(result.current.selectionText, '这是助手回答里的一段话'.slice(0, 8));
  });

  it('ignores a selection made in the composer or a sidebar', () => {
    const transcript = makeRegion('助手回答的文字');
    const composer = makeRegion('输入框里的字', false);
    makeRegion('侧栏里的字', false);
    const { result } = renderSelection();

    // A transcript selection first, so "ignored" is a transition, not a no-op on empty state.
    selectRange(transcript.textNode, 0, 6);
    settle();
    assert.ok(result.current.selectionText);

    act(() => selectRange(composer.textNode, 0, 5));
    assert.equal(result.current.selectionText, null, 'a selection outside the transcript clears at once');
  });

  it('ignores a selection that starts inside the transcript and ends outside it', () => {
    const transcript = makeRegion('助手回答的文字');
    const outside = makeRegion('输入框里的字', false);
    const { result } = renderSelection();

    const range = document.createRange();
    range.setStart(transcript.textNode, 0);
    range.setEnd(outside.textNode, 4);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    settle();

    assert.equal(result.current.selectionText, null);
  });

  it('clears the state on an empty or collapsed selection, at once', () => {
    const { textNode } = makeRegion('助手回答的文字');
    const { result } = renderSelection();

    selectRange(textNode, 0, 6);
    settle();
    assert.ok(result.current.selectionText);

    // A collapsed caret: same start and end.
    act(() => selectRange(textNode, 3, 3));
    assert.equal(result.current.selectionText, null, 'a collapsed selection clears without waiting');

    selectRange(textNode, 0, 6);
    settle();
    assert.ok(result.current.selectionText);
    act(() => clearSelection());
    assert.equal(result.current.selectionText, null, 'an emptied selection clears immediately');
  });

  it('drops a selection shorter than four characters', () => {
    const { textNode } = makeRegion('助手回答的文字');
    const { result } = renderSelection();

    selectRange(textNode, 0, 3);
    settle();

    assert.equal(result.current.selectionText, null);
  });

  it('truncates a very long selection to 600 code points', () => {
    const longText = '甲'.repeat(MAX_QUOTED_SELECTION_CHARS + 400);
    const { textNode } = makeRegion(longText);
    const { result } = renderSelection();

    selectRange(textNode, 0, longText.length);
    settle();

    assert.equal(result.current.selectionText?.length, MAX_QUOTED_SELECTION_CHARS);
    assert.equal(result.current.selectionText, longText.slice(0, MAX_QUOTED_SELECTION_CHARS));
  });

  it('coalesces a burst of selectionchange events into one state update', () => {
    const { textNode } = makeRegion('助手回答的文字，足够长可以反复选择');
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useTranscriptSelection({ settleMs: SETTLE_MS });
    });

    // Three changes in one frame, all with the same text.
    selectRange(textNode, 0, 10);
    selectRange(textNode, 0, 10);
    selectRange(textNode, 0, 10);
    settle();

    const afterFirstSettle = renders;
    assert.equal(result.current.selectionText, '助手回答的文字，足够长'.slice(0, 10));

    // The same text again: the committed value did not change, so no re-render.
    selectRange(textNode, 0, 10);
    settle();
    assert.equal(renders, afterFirstSettle, 'an unchanged selection must not update state again');
  });

  it('holds a non-empty selection back while the pointer gesture is still down', () => {
    const { region, textNode } = makeRegion('这是一段足够长的助手回答文字');
    const { result } = renderSelection();

    act(() => {
      pointer(region, 'pointerdown');
      selectRange(textNode, 0, 8);
    });
    // Many settle windows later the button is still down: nothing may be committed,
    // because a chip now would reflow the transcript under the stationary cursor.
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS * 5);
    });
    assert.equal(result.current.selectionText, null, 'no chip appears mid-gesture');

    // The release is the settle: the selection is read at once, with no further clock.
    act(() => pointer(window, 'pointerup'));
    assert.equal(result.current.selectionText, '这是一段足够长的');
  });

  it('clears a collapsed selection at once mid-gesture, and never flushes it on release', () => {
    const { region, textNode } = makeRegion('这是一段足够长的助手回答文字');
    const { result } = renderSelection();

    // A recorded passage first, so "cleared" is a transition rather than the initial null.
    selectRange(textNode, 0, 8);
    settle();
    assert.equal(result.current.selectionText, '这是一段足够长的');

    act(() => {
      pointer(region, 'pointerdown');
      selectRange(textNode, 2, 10);
    });
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS * 5);
    });
    assert.equal(result.current.selectionText, '这是一段足够长的', 'the mid-gesture selection is not committed');

    // Collapsing the selection clears the old chip immediately — pointer still down.
    act(() => selectRange(textNode, 3, 3));
    assert.equal(result.current.selectionText, null, 'a collapsed selection clears without waiting for release');

    act(() => pointer(window, 'pointerup'));
    assert.equal(result.current.selectionText, null, 'releasing a collapsed selection stays null');
  });

  it('ends the gesture and flushes the selection on pointercancel and on window blur', () => {
    const { region, textNode } = makeRegion('这是一段足够长的助手回答文字');
    const { result } = renderSelection();

    act(() => {
      pointer(region, 'pointerdown');
      selectRange(textNode, 0, 8);
    });
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS * 5);
    });
    assert.equal(result.current.selectionText, null);

    act(() => pointer(window, 'pointercancel'));
    assert.equal(result.current.selectionText, '这是一段足够长的', 'cancel ends the gesture and flushes');

    // A second gesture, then the window loses focus with no pointerup at all.
    act(() => {
      pointer(region, 'pointerdown');
      selectRange(textNode, 2, 10);
    });
    act(() => {
      vi.advanceTimersByTime(SETTLE_MS * 5);
    });
    assert.equal(result.current.selectionText, '这是一段足够长的', 'still the previous passage mid-gesture');

    act(() => pointer(window, 'blur'));
    assert.equal(result.current.selectionText, '一段足够长的助手', 'blur ends the gesture and flushes');
  });

  it('keeps the ordinary settle window on the keyboard path (no pointerdown)', () => {
    const { textNode } = makeRegion('这是一段足够长的助手回答文字');
    const { result } = renderSelection();

    act(() => selectRange(textNode, 0, 8));
    assert.equal(result.current.selectionText, null, 'not recorded before the settle window elapses');

    settle();
    assert.equal(result.current.selectionText, '这是一段足够长的');
  });

  it('does not enter the gesture when the pointerdown lands outside the transcript', () => {
    const transcript = makeRegion('这是一段足够长的助手回答文字');
    const composer = makeRegion('输入框里的字', false);
    const { result } = renderSelection();

    act(() => {
      pointer(composer.region, 'pointerdown');
      selectRange(transcript.textNode, 0, 8);
    });
    settle();
    assert.equal(result.current.selectionText, '这是一段足够长的', 'a press outside the transcript leaves the debounce alone');

    // The release for that outside press must not clear or change anything.
    act(() => pointer(window, 'pointerup'));
    assert.equal(result.current.selectionText, '这是一段足够长的');
  });
});
