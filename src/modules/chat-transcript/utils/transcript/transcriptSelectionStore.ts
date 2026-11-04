/**
 * The one live transcript selection, and the two surfaces that read it.
 *
 * The selection belongs to the transcript, but drawing it must not re-render the
 * transcript. A commit used to live in `ChatInterface` state, so releasing the
 * mouse re-rendered the whole chat: the pane, every mounted message row, and the
 * markdown inside them. That render could replace the very text nodes the native
 * Selection pointed at. Keeping the value in a small external store lets the
 * floating action and the composer subscribe on their own, while the transcript
 * that produced the selection is not rendered at all.
 *
 * Written by `useTranscriptSelection` on settle (pointer release or keyboard
 * idle); read through `useTranscriptSelectionText`.
 */

import { createExternalStore } from '@/shared/utils';

/** The live transcript selection that the floating action and the composer read. */
export type TranscriptSelectionSnapshot = {
  /** The passage recorded from the transcript, or null when there is none. */
  text: string | null;
};

/** One page-wide selection: one transcript is on screen at a time. */
export const transcriptSelectionStore = createExternalStore<TranscriptSelectionSnapshot>({
  text: null,
});

/** Records a new passage, or clears the recorded one. */
export const setTranscriptSelection = (text: string | null): void => {
  transcriptSelectionStore.set({ text });
};
