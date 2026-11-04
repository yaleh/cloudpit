import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';

/**
 * The floating action for a live transcript selection.
 *
 * A selection only shows this button; it no longer makes the composer draw a
 * quoted chip. The button therefore has to do the quoting itself: a press keeps
 * the browser's own selection alive (the passage a click accepts is that live
 * selection), and a click hands the passage to the composer's quoted acceptance
 * entry, which fills the draft, clears the page selection and focuses the caret —
 * it never sends.
 *
 * The box is fixed, not in flow, so it can neither resize the composer nor be
 * clipped by the transcript's scroll container. It is anchored to the selection's
 * own `Range` rectangle and re-read on transcript scroll, viewport resize and DOM
 * removal; when the anchor collapses, scrolls out of the pane or unmounts, the
 * action disappears rather than pointing at nothing.
 *
 * Used by `ChatMessagesPane`, which owns the transcript viewport.
 */

/** Both selection ends must lie inside this element to anchor the action. */
const TRANSCRIPT_SELECTOR = '[data-transcript-content]';

/**
 * The button's box never depends on the copy or the passage: every locale and
 * every selection length read the same width. The copy is the existing
 * `input.suggestions.suggestForSelection` key — no new i18n key is introduced and
 * the full passage is carried in `title` instead of in the visible label.
 */
const ACTION_WIDTH_PX = 160;

/** The fixed height keeps the clamp arithmetic independent of the copy. */
const ACTION_HEIGHT_PX = 32;

/** Space between the button and the passage it belongs to. */
const ACTION_GAP_PX = 8;

/** The button never touches the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

type SelectionActionPosition = {
  left: number;
  top: number;
};

/** The parts of a measured rectangle this module reads. */
type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** The element that owns a selection endpoint, or null when it is outside the document. */
function owningElement(node: Node | null): Element | null {
  if (!node) {
    return null;
  }
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/**
 * The live selection's range while BOTH ends still lie inside a transcript
 * column, or null when there is no usable anchor: collapsed, outside the
 * transcript, or belonging to a node that has left the document.
 */
function readTranscriptRange(): Range | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const start = owningElement(range.startContainer);
  const end = owningElement(range.endContainer);
  if (!start?.isConnected || !end?.isConnected) {
    return null;
  }
  if (!start.closest(TRANSCRIPT_SELECTOR) || !end.closest(TRANSCRIPT_SELECTOR)) {
    return null;
  }
  return range;
}

/**
 * Where the action sits for a measured selection, or null when it must stay
 * hidden: an unmeasurable anchor, a selection scrolled out of the transcript
 * pane, or one entirely outside the viewport.
 *
 * The button prefers the line above the passage and drops below it when there is
 * no room at the top, so it never covers the words it quotes. Both axes are
 * clamped into the viewport, which is what keeps it visible on a narrow screen.
 */
function resolveSelectionActionPosition(
  selection: RectLike,
  pane: RectLike | null,
  viewportWidth: number,
  viewportHeight: number,
): SelectionActionPosition | null {
  // A zero-area rectangle cannot be anchored: the node may be hidden, or the
  // selection may no longer correspond to anything laid out.
  if (selection.width <= 0 || selection.height <= 0) {
    return null;
  }
  if (pane !== null && (
    selection.bottom <= pane.top
    || selection.top >= pane.bottom
    || selection.right <= pane.left
    || selection.left >= pane.right
  )) {
    return null;
  }
  if (
    selection.bottom < 0
    || selection.top > viewportHeight
    || selection.right < 0
    || selection.left > viewportWidth
  ) {
    return null;
  }

  const maxLeft = Math.max(VIEWPORT_MARGIN_PX, viewportWidth - ACTION_WIDTH_PX - VIEWPORT_MARGIN_PX);
  const centered = selection.left + selection.width / 2 - ACTION_WIDTH_PX / 2;
  const left = Math.min(Math.max(centered, VIEWPORT_MARGIN_PX), maxLeft);

  let top = selection.top - ACTION_HEIGHT_PX - ACTION_GAP_PX;
  if (top < VIEWPORT_MARGIN_PX) {
    top = selection.bottom + ACTION_GAP_PX;
  }
  const maxTop = Math.max(VIEWPORT_MARGIN_PX, viewportHeight - ACTION_HEIGHT_PX - VIEWPORT_MARGIN_PX);
  top = Math.min(Math.max(top, VIEWPORT_MARGIN_PX), maxTop);

  return { left, top };
}

export type TranscriptSelectionActionProps = {
  /** The passage `useTranscriptSelection` recorded, or null when there is none. */
  selectionText: string | null;
  /** The transcript's scrolling box; the action hides when the anchor leaves it. */
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** The composer's quoted acceptance entry, called exactly once with the passage. */
  onAccept: (selectionText: string) => void;
};

export function TranscriptSelectionAction({
  selectionText,
  scrollContainerRef,
  onAccept,
}: TranscriptSelectionActionProps) {
  const { t } = useTranslation('chat');
  // Where the button currently floats; null means "do not draw it". It is state
  // rather than a render-time value because scroll, resize and node removal
  // re-anchor it between renders.
  const [position, setPosition] = useState<SelectionActionPosition | null>(null);

  const update = useCallback(() => {
    const range = selectionText === null ? null : readTranscriptRange();
    if (range === null) {
      setPosition(null);
      return;
    }
    const pane = scrollContainerRef.current?.getBoundingClientRect() ?? null;
    const next = resolveSelectionActionPosition(
      range.getBoundingClientRect(),
      pane,
      window.innerWidth,
      window.innerHeight,
    );
    setPosition((previous) => (
      previous !== null
      && next !== null
      && Math.abs(previous.left - next.left) < 0.5
      && Math.abs(previous.top - next.top) < 0.5
        ? previous
        : next
    ));
  }, [scrollContainerRef, selectionText]);

  // A new recorded passage is a new anchor: measure it before the frame paints,
  // so the button never appears at a stale position first.
  useLayoutEffect(() => {
    update();
  }, [update]);

  useEffect(() => {
    if (selectionText === null) {
      return undefined;
    }
    // Capture phase: the transcript's own scrolling box is the target, and its
    // `scroll` event does not bubble to `window`.
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    document.addEventListener('selectionchange', update);
    // A soft keyboard moves the visual viewport without a window resize.
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', update);
    visualViewport?.addEventListener('scroll', update);
    // A message row can unmount under the held anchor; not every engine fires a
    // selectionchange for that, so the DOM is watched while the selection lives.
    const pane = scrollContainerRef.current;
    const observer = typeof MutationObserver === 'undefined' || pane === null
      ? null
      : new MutationObserver(update);
    observer?.observe(pane ?? document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      document.removeEventListener('selectionchange', update);
      visualViewport?.removeEventListener('resize', update);
      visualViewport?.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [scrollContainerRef, selectionText, update]);

  if (selectionText === null || position === null) {
    return null;
  }

  return (
    <button
      type="button"
      data-slot="transcript-selection-action"
      data-selection-action-width="fixed"
      // The visible label is the accessible name; the complete passage lives in
      // the tooltip so the fixed width can stay independent of its length.
      title={selectionText}
      // Cancelling the press is what keeps the native selection alive until the
      // click lands: otherwise the browser collapses it on pointerdown and the
      // passage this click is meant to quote is already gone.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onAccept(selectionText)}
      style={{
        left: position.left,
        top: position.top,
        width: ACTION_WIDTH_PX,
        height: ACTION_HEIGHT_PX,
      }}
      className={cn(
        // Fixed, so the transcript's scroll container cannot clip it and the
        // composer cannot be resized by it.
        'fixed z-30 inline-flex items-center justify-center truncate rounded-full border border-primary/60 bg-card px-3 text-xs font-medium text-foreground shadow-md transition-colors',
        'hover:border-primary hover:bg-primary/10',
      )}
    >
      {t('input.suggestions.suggestForSelection', { defaultValue: 'Suggest from selection' })}
    </button>
  );
}
