import { useEffect, useMemo, useSyncExternalStore } from 'react';

import { subscribeToUserPreferences } from '@/shared/userSettings';
import { readStoredVoiceShortcuts } from '@/shared/voiceShortcuts';
import { createVoiceShortcutController } from '@/modules/chat/utils/voiceShortcutController';
import type { VoiceShortcutSnapshot } from '@/modules/chat/utils/voiceShortcutController';

/**
 * The pane's binding for the voice keyboard shortcuts.
 *
 * Every decision lives in `createVoiceShortcutController`; this hook only creates
 * one controller for the mount, subscribes to its snapshot through
 * `useSyncExternalStore`, hands it the pane's current commands on each render,
 * and starts/stops the one document listener.
 *
 * The stored bindings are read per keydown rather than captured here, so a change
 * made in Settings — in this tab or another one — takes effect on the next press
 * without remounting anything. The preference subscription exists for the
 * snapshot (`active`), not for the matching.
 *
 * Consumers: chat's `ChatInterface`.
 */

export type UseVoiceShortcutsOptions = {
  /** Toggles the composer's dictation microphone. */
  toggleDictation: () => void;
  /** Enters Live Voice, or leaves it when it is the mode on screen. */
  toggleLiveVoice: () => void;
  /** Stops the running dictation and submits what was heard. */
  stopAndSendDictation: () => void;
  /** Clears the composer's draft, behind the same guard Escape uses. */
  clearInput: () => void;
  /** Whether dictation is available right now. */
  isDictationAvailable: () => boolean;
  /** Whether Live Voice is available right now. */
  isLiveVoiceAvailable: () => boolean;
  /** Whether dictation is listening right now. */
  isDictationRecording: () => boolean;
  /** Whether Live Voice is the mode on screen right now. */
  isLiveVoiceActive: () => boolean;
  /** Whether clearing the draft is allowed right now. */
  isClearAvailable: () => boolean;
};

export function useVoiceShortcuts({
  toggleDictation,
  toggleLiveVoice,
  stopAndSendDictation,
  clearInput,
  isDictationAvailable,
  isLiveVoiceAvailable,
  isDictationRecording,
  isLiveVoiceActive,
  isClearAvailable,
}: UseVoiceShortcutsOptions): VoiceShortcutSnapshot {
  const controller = useMemo(
    () => createVoiceShortcutController({
      addKeydown: (handler) => {
        if (typeof document === 'undefined') return () => undefined;
        // Capture phase, like the Escape guard: a composer or transcript handler
        // must not be able to hide a global binding by stopping propagation.
        document.addEventListener('keydown', handler, { capture: true });
        return () => document.removeEventListener('keydown', handler, { capture: true });
      },
      readShortcuts: readStoredVoiceShortcuts,
    }),
    [],
  );

  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  // The pane's callbacks close over this render's state; the controller keeps the
  // latest ones so a keystroke never reaches a stale draft or session.
  useEffect(() => {
    controller.setCommands({
      toggleDictation,
      toggleLiveVoice,
      stopAndSendDictation,
      clearInput,
      isDictationAvailable,
      isLiveVoiceAvailable,
      isDictationRecording,
      isLiveVoiceActive,
      isClearAvailable,
    });
  }, [
    controller,
    clearInput,
    isClearAvailable,
    isDictationAvailable,
    isDictationRecording,
    isLiveVoiceActive,
    isLiveVoiceAvailable,
    stopAndSendDictation,
    toggleDictation,
    toggleLiveVoice,
  ]);

  // One document listener for the life of the pane; unmounting it ends the binding.
  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  // The snapshot follows the stored switch even when it is changed elsewhere.
  useEffect(
    () => subscribeToUserPreferences(() => controller.refresh()),
    [controller],
  );

  return snapshot;
}
