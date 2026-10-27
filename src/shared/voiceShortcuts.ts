import { readUserPreference, writeUserPreference } from '@/shared/userSettings';
import type { UserPreferenceKey } from '@/shared/userSettings';

/**
 * The user's keyboard bindings for the two voice surfaces: dictation (the
 * composer's microphone) and Live Voice (the continuous realtime conversation).
 *
 * The bindings are matched on `KeyboardEvent.code` — the PHYSICAL key — plus the
 * four modifier booleans, so the same finger position keeps working across
 * keyboard layouts instead of following the letter a layout happens to print.
 *
 * Both surfaces toggle: the same keys start and stop the microphone, which is
 * what lets an OS or headset utility remap its gesture to an ordinary key and
 * have the page answer it without any media-session placeholder audio.
 *
 * Consumers: `voiceShortcutController` (the keydown rules), `useVoiceShortcuts`
 * (the React binding), the Voice settings tab (the key-capture form), and their
 * criteria.
 */

/** One physical key plus the exact modifier state that must accompany it. */
export type VoiceShortcutChord = {
  /** `KeyboardEvent.code` of the non-modifier key, e.g. `KeyD`, `F13`, `Space`. */
  code: string;
  /** Whether Ctrl must be down. */
  ctrl: boolean;
  /** Whether Alt must be down. */
  alt: boolean;
  /** Whether Shift must be down. */
  shift: boolean;
  /** Whether Meta (Cmd on macOS, Super on Linux) must be down. */
  meta: boolean;
};

/** The stored blob: the master switch and one binding per voice surface. */
export type VoiceShortcuts = {
  /** Whether any binding may fire. Off by default so no key is taken silently. */
  enabled: boolean;
  /** Toggles dictation in the composer; null while the user has not bound one. */
  dictationChord: VoiceShortcutChord | null;
  /** Toggles Live Voice; null while the user has not bound one. */
  liveVoiceChord: VoiceShortcutChord | null;
};

/** How risky a binding is: a reserved key, a merely awkward one, or neither. */
export type VoiceShortcutConflictLevel = 'none' | 'warning' | 'high';

/** What a fresh install starts with: the feature off and nothing bound. */
export const DEFAULT_VOICE_SHORTCUTS: VoiceShortcuts = {
  enabled: false,
  dictationChord: null,
  liveVoiceChord: null,
};

/**
 * The preference key the blob is stored under.
 *
 * THE CAST IS DELIBERATE. `UserPreferenceKey` is the client's list of keys it
 * knows how to migrate from legacy localStorage, not the set of keys the server
 * accepts: `/api/user/preferences` stores an open key/value map and the
 * preference store reads and writes any key in it. Adding a migration entry for
 * a brand-new setting would seed it from a legacy location that never existed,
 * so this key stays out of that union instead.
 */
const VOICE_SHORTCUTS_PREFERENCE_KEY = 'voiceShortcuts' as unknown as UserPreferenceKey;

/** The keys that only ever act as modifiers, so they cannot end a chord themselves. */
const MODIFIER_CODES = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
]);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

/** Values were historically stored as both real booleans and their strings. */
const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};

/**
 * Reads one stored chord, or null when the value cannot describe a physical key.
 *
 * A payload is accepted only when it names a `code` that is not itself a modifier;
 * the four booleans default to false rather than making the whole binding
 * unreadable, because a partially written blob is still a key the user chose.
 */
function normalizeChord(value: unknown): VoiceShortcutChord | null {
  if (!isRecord(value)) return null;

  const code = typeof value.code === 'string' ? value.code.trim() : '';
  if (!code || MODIFIER_CODES.has(code)) return null;

  return {
    code,
    ctrl: parseBoolean(value.ctrl, false),
    alt: parseBoolean(value.alt, false),
    shift: parseBoolean(value.shift, false),
    meta: parseBoolean(value.meta, false),
  };
}

/**
 * Turns any stored value into a usable blob, dropping what it cannot understand.
 *
 * This is the one read point for the shape, so a hand-edited database row, an
 * older build's payload, or a value stored as the string `"true"` cannot make
 * the controller throw on a keystroke.
 */
export function normalizeVoiceShortcuts(value: unknown): VoiceShortcuts {
  if (!isRecord(value)) return { ...DEFAULT_VOICE_SHORTCUTS };

  return {
    enabled: parseBoolean(value.enabled, DEFAULT_VOICE_SHORTCUTS.enabled),
    dictationChord: normalizeChord(value.dictationChord),
    liveVoiceChord: normalizeChord(value.liveVoiceChord),
  };
}

/** Reads the user's bindings synchronously, from the same store as the UI preferences. */
export function readStoredVoiceShortcuts(): VoiceShortcuts {
  return normalizeVoiceShortcuts(
    readUserPreference<unknown>(VOICE_SHORTCUTS_PREFERENCE_KEY, null),
  );
}

/** Writes the blob through the preference store (localStorage mirror, then the server). */
export function writeStoredVoiceShortcuts(shortcuts: VoiceShortcuts): void {
  writeUserPreference(VOICE_SHORTCUTS_PREFERENCE_KEY, normalizeVoiceShortcuts(shortcuts));
}

/** The keys whose display name is not derivable from their code. */
const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Escape: 'Esc',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
};

/** The readable name of one physical key, without its modifiers. */
function keyLabel(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];

  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];

  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return `Num${numpad[1]}`;

  return NAMED_KEYS[code] ?? code;
}

/** The user-facing form of a chord, e.g. `Ctrl+Alt+D`; the settings box shows this. */
export function canonicalChord(chord: VoiceShortcutChord): string {
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  if (chord.meta) parts.push('Meta');
  parts.push(keyLabel(chord.code));
  return parts.join('+');
}

/** The keyboard fields a chord is matched against, so a test can pass a plain object. */
export type VoiceShortcutKeyEvent = Pick<
  KeyboardEvent,
  'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;

/**
 * Builds the chord a keydown describes, or null when the press was only a modifier.
 *
 * A modifier press is how a user starts a combination, not a binding of its own:
 * returning null lets the capture form keep waiting for the real key.
 */
export function chordFromKeyEvent(event: VoiceShortcutKeyEvent): VoiceShortcutChord | null {
  if (!event.code || MODIFIER_CODES.has(event.code)) return null;
  return {
    code: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}

/**
 * Exact match on the physical key AND all four modifier booleans.
 *
 * Exact rather than "at least": a binding on Ctrl+D must not also fire for
 * Ctrl+Shift+D, because the two are different keys to the user and the browser.
 */
export function matchesChord(event: VoiceShortcutKeyEvent, chord: VoiceShortcutChord): boolean {
  return (
    event.code === chord.code
    && event.ctrlKey === chord.ctrl
    && event.altKey === chord.alt
    && event.shiftKey === chord.shift
    && event.metaKey === chord.meta
  );
}

/** Whether two bindings describe the same press. */
export function sameChord(a: VoiceShortcutChord, b: VoiceShortcutChord): boolean {
  return matchesChord(
    { code: a.code, ctrlKey: a.ctrl, altKey: a.alt, shiftKey: a.shift, metaKey: a.meta },
    b,
  );
}

const TYPING_KEY = /^(Key[A-Z]|Digit\d|Numpad\d)$/;
const FUNCTION_KEY = /^F(\d{1,2})$/;

/** Keys that already mean something to the page or the browser on their own. */
const BARE_RESERVED_CODES = new Set([
  'Escape',
  'Tab',
  'Enter',
  'Space',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/**
 * The keys a Ctrl/Meta combination already claims.
 *
 * These are the browser's own shortcuts (tabs, reload, find, save, print, the
 * clipboard, devtools) — taking one leaves the user unable to do something they
 * could do before, so the settings form warns instead of silently rebinding it.
 */
const CTRL_RESERVED_CODES = new Set([
  'KeyA',
  'KeyC',
  'KeyD',
  'KeyF',
  'KeyJ',
  'KeyL',
  'KeyN',
  'KeyP',
  'KeyQ',
  'KeyR',
  'KeyS',
  'KeyT',
  'KeyV',
  'KeyW',
  'KeyX',
  'KeyY',
  'KeyZ',
  'Tab',
  'Space',
  'Escape',
  'F5',
  'F11',
  'F12',
]);

/**
 * How risky a binding is, for the warning the settings form draws under it.
 *
 * `high` is a key the browser, the OS, or ordinary typing already needs: a bare
 * letter would swallow that letter everywhere, and Ctrl+W would close the tab.
 * `warning` is a key that is usually free but that some system may still claim
 * (the F13–F24 row and media keys are the conventional landing spots for
 * headset and macro remapping). `none` is an ordinary modifier combination.
 */
export function shortcutConflictLevel(chord: VoiceShortcutChord): VoiceShortcutConflictLevel {
  const bare = !chord.ctrl && !chord.alt && !chord.meta;

  if (bare) {
    if (TYPING_KEY.test(chord.code) || BARE_RESERVED_CODES.has(chord.code)) return 'high';
    const fn = FUNCTION_KEY.exec(chord.code);
    if (fn !== null) {
      const number = Number(fn[1]);
      // F1–F12 belong to the browser/OS; F13–F24 exist mostly to be remapped.
      return number <= 12 ? 'high' : 'warning';
    }
    return 'warning';
  }

  if (chord.ctrl || chord.meta) {
    // AltGr arrives as Ctrl+Alt on Windows, so a Ctrl+Alt chord is ordinary
    // character input rather than one of the browser's own commands — the
    // recommended shape for a binding. Only the OS-level window close is
    // reserved there.
    if (chord.alt) {
      return chord.code === 'F4' ? 'high' : 'none';
    }
    if (CTRL_RESERVED_CODES.has(chord.code)) return 'high';
    // The input-method switch and the OS launcher both live here.
    if (chord.code === 'Space') return 'high';
    return 'none';
  }

  // Alt+letter is a menu accelerator on Windows/Linux, so it is awkward rather
  // than free — but it is also how macOS users type special characters.
  return chord.alt && TYPING_KEY.test(chord.code) ? 'warning' : 'none';
}
