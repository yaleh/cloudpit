import { createExternalStore } from '@/shared/utils';
import { matchesChord, type VoiceShortcuts } from '@/shared/voiceShortcuts';

/**
 * The voice shortcut controller: every rule about WHEN a bound key acts, kept
 * in one React-free object.
 *
 * The rules are deliberately small and all in one place:
 *
 * - A key is ignored when the browser says it is an auto-repeat, when an earlier
 *   handler already claimed it (`defaultPrevented`), and when the feature is off.
 * - A key is ignored while a floating layer is open. The selector is the one
 *   `ChatInterface`'s Escape guard reads, plus the settings modal's own backdrop
 *   class — Settings is the one full-screen modal in this app that does not set
 *   `role="dialog"`, and a binding must never fire while the user is capturing it.
 * - The two bindings are matched exactly on `KeyboardEvent.code` and all four
 *   modifiers, so a chord with the wrong modifier state does nothing.
 * - A matched binding is routed to its own command, and only when that surface is
 *   available; the event is prevented only when something was actually done.
 *
 * Dictation is checked before Live Voice. If a user binds the same keys to both,
 * dictation wins and the settings form shows the duplicate warning — silently
 * firing two microphone modes from one key would be worse than a stated tie.
 *
 * Consumers: `useVoiceShortcuts` (the React binding) and its criterion.
 */

/** The composer's live dictation entry point, registered with the pane that owns the binding. */
export type DictationToggleRegistration = {
  /** The composer's current toggle; it reads the draft and the caret at press time. */
  toggle: () => void;
  /** Whether the voice input surface is on and reachable right now. */
  available: boolean;
};

/** The commands and availability readings a keydown may use. */
export type VoiceShortcutCommands = {
  /** Toggles the composer's dictation microphone. */
  toggleDictation: () => void;
  /** Enters Live Voice, or leaves it when it is the mode on screen. */
  toggleLiveVoice: () => void;
  /** Whether dictation may start or stop right now. */
  isDictationAvailable: () => boolean;
  /** Whether Live Voice may be entered or left right now. */
  isLiveVoiceAvailable: () => boolean;
};

/** What the React binding renders from. */
export type VoiceShortcutSnapshot = {
  /** True when the feature is on and at least one surface is bound. */
  active: boolean;
};

/** Injected seams: the listener registration and the stored bindings. */
export type VoiceShortcutControllerDeps = {
  /** Registers a document-level keydown handler and returns its remover. */
  addKeydown: (handler: (event: KeyboardEvent) => void) => () => void;
  /** Reads the user's current bindings; called per keydown so a settings change takes effect at once. */
  readShortcuts: () => VoiceShortcuts;
};

/**
 * The layers a global key must not jump over.
 *
 * The first three roles are `ChatInterface`'s Escape guard contract. The last two
 * cover the app's Settings dialog, whose root is a `.modal-backdrop` without a
 * `dialog` role — the exact layer in which the key-capture form lives.
 */
const OPEN_LAYER_SELECTOR =
  '[role="dialog"],[role="menu"],[role="listbox"],[aria-modal="true"],.modal-backdrop';

/** True while any of the app's floating layers is mounted. */
function floatingLayerIsOpen(): boolean {
  return typeof document !== 'undefined' && document.querySelector(OPEN_LAYER_SELECTOR) !== null;
}

/** The commands in force before the React binding hands over its first set. */
const NO_COMMANDS: VoiceShortcutCommands = {
  toggleDictation: () => undefined,
  toggleLiveVoice: () => undefined,
  isDictationAvailable: () => false,
  isLiveVoiceAvailable: () => false,
};

/**
 * Creates the controller. The listener is not attached until `start`, and
 * `dispose`-free by design: the hook owns one `stop` per `start`.
 */
export function createVoiceShortcutController(deps: VoiceShortcutControllerDeps) {
  let commands: VoiceShortcutCommands = NO_COMMANDS;
  let detach: (() => void) | null = null;

  const activeNow = (): boolean => {
    const shortcuts = deps.readShortcuts();
    return shortcuts.enabled && (shortcuts.dictationChord !== null || shortcuts.liveVoiceChord !== null);
  };

  const store = createExternalStore<VoiceShortcutSnapshot>({ active: activeNow() });

  /** Re-reads the stored bindings and publishes only a real change. */
  const refresh = (): void => {
    const active = activeNow();
    if (active !== store.getSnapshot().active) {
      store.set({ active });
    }
  };

  const handleKeydown = (event: KeyboardEvent): void => {
    // A held key repeats; one gesture must toggle once. A key an earlier handler
    // already consumed is not ours to act on.
    if (event.repeat || event.defaultPrevented) return;

    const shortcuts = deps.readShortcuts();
    if (!shortcuts.enabled) return;
    if (floatingLayerIsOpen()) return;

    const { dictationChord, liveVoiceChord } = shortcuts;

    if (dictationChord !== null && matchesChord(event, dictationChord)) {
      if (!commands.isDictationAvailable()) return;
      event.preventDefault();
      commands.toggleDictation();
      return;
    }

    if (liveVoiceChord !== null && matchesChord(event, liveVoiceChord)) {
      if (!commands.isLiveVoiceAvailable()) return;
      event.preventDefault();
      commands.toggleLiveVoice();
    }
  };

  return {
    /** Attaches the one document listener; a second call is a no-op. */
    start: (): void => {
      if (detach !== null) return;
      detach = deps.addKeydown(handleKeydown);
    },
    /** Detaches the listener; safe when it was never started or already stopped. */
    stop: (): void => {
      if (detach === null) return;
      detach();
      detach = null;
    },
    /** Hands over the current callbacks; the hook calls this whenever the pane re-renders them. */
    setCommands: (next: VoiceShortcutCommands): void => {
      commands = next;
    },
    /** Re-reads the bindings after the preference store reports a change. */
    refresh,
    subscribe: store.subscribe,
    getSnapshot: store.getSnapshot,
  };
}
