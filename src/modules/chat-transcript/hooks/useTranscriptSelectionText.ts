import { useSyncExternalStore } from 'react';

import { transcriptSelectionStore } from '@/modules/chat-transcript/utils/transcript/transcriptSelectionStore';

/**
 * Subscribes one surface to the live transcript selection without rendering the
 * transcript that produced it.
 *
 * Used by chat's floating selection action and by the composer's suggestion
 * strip: both must follow the selection as it settles, but the message rows must
 * not re-render — a render can replace the text nodes the native Selection still
 * points at.
 */
export function useTranscriptSelectionText(): string | null {
  return useSyncExternalStore(
    transcriptSelectionStore.subscribe,
    () => transcriptSelectionStore.getSnapshot().text,
  );
}
