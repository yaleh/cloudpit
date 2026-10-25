import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The transcript selection that becomes the composer's quoted chip.
 *
 * A selection only counts when BOTH ends lie inside the transcript's content
 * column (`[data-transcript-content]`, the same marker the height model reads).
 * A selection in the textarea, the sidebar or a modal is therefore invisible here,
 * which is what keeps "select text to quote" from firing while someone edits their
 * own draft.
 *
 * A non-empty selection is recorded after it has held still for
 * {@link SELECTION_SETTLE_MS}: dragging across a long answer emits a stream of
 * `selectionchange` events, and each would otherwise re-render the strip. A
 * collapsed or out-of-transcript selection clears the state at once — there is no
 * cost to reacting to it, and a stale chip must disappear the moment the highlight
 * does. Repeated events that produce the same text do not update state at all.
 *
 * A pointer gesture that starts in the transcript holds the chip back until it ends.
 * The quoted chip can make the composer one line taller, which shrinks the
 * transcript and moves the text under a cursor that has not moved: the browser then
 * recomputes the selection endpoints and the passage the user dragged out changes.
 * So while the button is still down (`pointerdown` inside the transcript, until
 * `pointerup` / `pointercancel` / `blur`) a live selection is neither settled nor
 * committed; the release itself is the settle, so it is read at once. Empty,
 * collapsed and out-of-transcript selections still clear immediately, and the
 * keyboard path (no `pointerdown`) keeps the ordinary debounce.
 *
 * Consumers: `ChatInterface` (which owns the transcript) hands the text to the
 * composer as the quoted chip's source.
 */

/** A selection must start and end inside this element to count as transcript text. */
const TRANSCRIPT_SELECTOR = '[data-transcript-content]';

/** Shorter selections are a click or a drag artefact, not something worth quoting. */
const MIN_SELECTION_CHARS = 4;

/** The chip keeps the first this-many code points of a long passage. */
export const MAX_QUOTED_SELECTION_CHARS = 600;

/** How long a non-empty selection must hold still before it is recorded. */
export const SELECTION_SETTLE_MS = 200;

type UseTranscriptSelectionOptions = {
  /** Where the selection must lie. Overridable only so a criterion can shrink the region. */
  rootSelector?: string;
  /** The debounce for a non-empty selection, in milliseconds. */
  settleMs?: number;
};

export type UseTranscriptSelectionResult = {
  /** The recorded passage, or null when there is no eligible selection. */
  selectionText: string | null;
  /** Forgets the recorded passage without touching the browser's selection. */
  clear: () => void;
};

/** The element that owns a selection endpoint, or null when it is outside the document. */
function owningElement(node: Node | null): Element | null {
  if (!node) {
    return null;
  }
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}

/** Truncates by code point so a surrogate pair is never split mid-emoji. */
export function truncateQuotedSelection(text: string): string {
  const points = Array.from(text);
  return points.length <= MAX_QUOTED_SELECTION_CHARS
    ? text
    : points.slice(0, MAX_QUOTED_SELECTION_CHARS).join('');
}

export function useTranscriptSelection({
  rootSelector = TRANSCRIPT_SELECTOR,
  settleMs = SELECTION_SETTLE_MS,
}: UseTranscriptSelectionOptions = {}): UseTranscriptSelectionResult {
  // The quoted passage. State rather than a ref because the strip draws from it.
  const [selectionText, setSelectionText] = useState<string | null>(null);
  // What the last commit put in state, so a stream of identical `selectionchange`
  // events can be dropped before React is asked to re-render.
  const committedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True between a `pointerdown` inside the transcript and the end of that pointer
  // gesture. A live selection is not settled while it is true.
  const pointerGestureRef = useRef(false);

  const commit = useCallback((next: string | null) => {
    if (committedRef.current === next) {
      return;
    }
    committedRef.current = next;
    setSelectionText(next);
  }, []);

  const clear = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    commit(null);
  }, [commit]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const cancelTimer = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const readSelection = () => {
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        commit(null);
        return;
      }
      const anchor = owningElement(selection.anchorNode);
      const focus = owningElement(selection.focusNode);
      // Both ends must be transcript text: a selection that starts in the answer and
      // ends in the composer is not a passage anyone meant to quote.
      if (!anchor?.closest(rootSelector) || !focus?.closest(rootSelector)) {
        commit(null);
        return;
      }
      const text = selection.toString().trim();
      if (text.length < MIN_SELECTION_CHARS) {
        commit(null);
        return;
      }
      commit(truncateQuotedSelection(text));
    };

    const onSelectionChange = () => {
      // A collapsed/empty/foreign selection has no text to settle on: clear at once.
      const selection = window.getSelection?.();
      const hasLiveTranscriptSelection = Boolean(
        selection
        && selection.rangeCount > 0
        && !selection.isCollapsed
        && owningElement(selection.anchorNode)?.closest(rootSelector)
        && owningElement(selection.focusNode)?.closest(rootSelector)
        && selection.toString().trim().length >= MIN_SELECTION_CHARS,
      );
      if (!hasLiveTranscriptSelection) {
        cancelTimer();
        readSelection();
        return;
      }
      // The pointer is still down inside the transcript: do not settle yet. The chip
      // would resize the composer and the browser would recompute the selection
      // under the stationary cursor. The release below reads it instead.
      if (pointerGestureRef.current) {
        cancelTimer();
        return;
      }
      cancelTimer();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        readSelection();
      }, settleMs);
    };

    // Capture phase: the transcript's own handlers must not be able to swallow the
    // press that starts a gesture.
    const onPointerDown = (event: PointerEvent) => {
      if (!owningElement(event.target as Node | null)?.closest(rootSelector)) {
        return;
      }
      pointerGestureRef.current = true;
      // A settle scheduled before the press must not fire mid-gesture.
      cancelTimer();
    };

    // The gesture ending IS the settle: read the selection at once, without waiting
    // out SELECTION_SETTLE_MS. `blur` covers the lost-`pointerup` case so the state
    // can never stay stuck in "gesture in progress".
    const endPointerGesture = () => {
      if (!pointerGestureRef.current) {
        return;
      }
      pointerGestureRef.current = false;
      cancelTimer();
      readSelection();
    };

    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', endPointerGesture);
    window.addEventListener('pointercancel', endPointerGesture);
    window.addEventListener('blur', endPointerGesture);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', endPointerGesture);
      window.removeEventListener('pointercancel', endPointerGesture);
      window.removeEventListener('blur', endPointerGesture);
      cancelTimer();
    };
  }, [commit, rootSelector, settleMs]);

  return { selectionText, clear };
}
