import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';
import {
  canonicalChord,
  chordFromKeyEvent,
  DEFAULT_VOICE_SHORTCUTS,
  matchesChord,
  normalizeVoiceShortcuts,
  readStoredVoiceShortcuts,
  shortcutConflictLevel,
  writeStoredVoiceShortcuts,
} from '@/shared/voiceShortcuts';
import type { VoiceShortcutChord } from '@/shared/voiceShortcuts';

/**
 * The stored shape of the voice keyboard bindings, the physical-key matcher, and
 * the conflict table the settings form warns from.
 *
 * The first group is about what survives a round trip through the preference
 * store: a blob written by an older build, a hand-edited row, or a value of the
 * wrong type must never make a keystroke throw. The second is the match itself:
 * exact modifier state, never "at least these modifiers". The third is advisory
 * only — `high` does not forbid a binding, it tells the form to warn.
 */

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one case's write into the next.
  resetUserPreferences();
});

const chord = (overrides: Partial<VoiceShortcutChord> = {}): VoiceShortcutChord => ({
  code: 'KeyD',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  ...overrides,
});

const keyEvent = (overrides: Partial<Parameters<typeof chordFromKeyEvent>[0]> = {}) => ({
  code: 'KeyD',
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...overrides,
});

test('a fresh install starts with the feature off and nothing bound', () => {
  assert.deepEqual(readStoredVoiceShortcuts(), {
    enabled: false,
    dictationChord: null,
    liveVoiceChord: null,
  });
  assert.deepEqual(DEFAULT_VOICE_SHORTCUTS, readStoredVoiceShortcuts());
});

test('a stored blob is normalized: booleans coerced, unknown fields dropped', () => {
  writeUserPreference('voiceShortcuts' as never, {
    enabled: 'true',
    dictationChord: { code: 'KeyD', ctrl: true, alt: false, shift: false, meta: false },
    liveVoiceChord: { code: 'KeyL', ctrl: false, alt: true, shift: false, meta: false, extra: 1 },
    surprise: 'ignored',
  });

  assert.deepEqual(readStoredVoiceShortcuts(), {
    enabled: true,
    dictationChord: { code: 'KeyD', ctrl: true, alt: false, shift: false, meta: false },
    liveVoiceChord: { code: 'KeyL', ctrl: false, alt: true, shift: false, meta: false },
  });
});

test('a malformed value cannot escape normalization', () => {
  assert.deepEqual(normalizeVoiceShortcuts(null), DEFAULT_VOICE_SHORTCUTS);
  assert.deepEqual(normalizeVoiceShortcuts('nope'), DEFAULT_VOICE_SHORTCUTS);
  assert.deepEqual(normalizeVoiceShortcuts([1, 2]), DEFAULT_VOICE_SHORTCUTS);

  const invalid = normalizeVoiceShortcuts({
    enabled: false,
    dictationChord: { code: 'ControlLeft', ctrl: true },
    liveVoiceChord: { ctrl: true },
  });
  assert.equal(invalid.dictationChord, null, 'a modifier cannot be the binding key on its own');
  assert.equal(invalid.liveVoiceChord, null, 'a chord without a code is dropped');
});

test('writing through the store reads back the same blob', () => {
  const shortcuts = {
    enabled: true,
    dictationChord: chord({ ctrl: true }),
    liveVoiceChord: chord({ code: 'F13' }),
  };
  writeStoredVoiceShortcuts(shortcuts);
  assert.deepEqual(readStoredVoiceShortcuts(), shortcuts);
});

test('canonicalChord renders the modifiers in a stable order and names common keys', () => {
  assert.equal(canonicalChord(chord({ ctrl: true, alt: true })), 'Ctrl+Alt+D');
  assert.equal(canonicalChord(chord({ meta: true, shift: true, code: 'Digit1' })), 'Shift+Meta+1');
  assert.equal(canonicalChord(chord({ code: 'F13' })), 'F13');
  assert.equal(canonicalChord(chord({ code: 'Space' })), 'Space');
  assert.equal(canonicalChord(chord({ code: 'Numpad4', ctrl: true })), 'Ctrl+Num4');
  assert.equal(canonicalChord(chord({ code: 'ArrowUp' })), 'Up');
});

test('matchesChord requires the code and every modifier to agree', () => {
  const binding = chord({ ctrl: true, shift: true });
  assert.equal(matchesChord(keyEvent({ ctrlKey: true, shiftKey: true }), binding), true);
  assert.equal(matchesChord(keyEvent({ ctrlKey: true }), binding), false, 'missing Shift is a different key');
  assert.equal(
    matchesChord(keyEvent({ ctrlKey: true, shiftKey: true, altKey: true }), binding),
    false,
    'an extra modifier is a different key',
  );
  assert.equal(
    matchesChord(keyEvent({ code: 'KeyL', ctrlKey: true, shiftKey: true }), binding),
    false,
  );
});

test('chordFromKeyEvent waits through a lone modifier and captures the real key', () => {
  assert.equal(chordFromKeyEvent(keyEvent({ code: 'ControlLeft', ctrlKey: true })), null);
  assert.equal(chordFromKeyEvent(keyEvent({ code: 'ShiftRight', shiftKey: true })), null);
  assert.deepEqual(
    chordFromKeyEvent(keyEvent({ code: 'KeyD', ctrlKey: true, altKey: true })),
    chord({ ctrl: true, alt: true }),
  );
});

test('the conflict table marks keys the browser or typing already needs', () => {
  // Bare keys would swallow what the user types.
  assert.equal(shortcutConflictLevel(chord({ code: 'KeyV' })), 'high');
  assert.equal(shortcutConflictLevel(chord({ code: 'Escape' })), 'high');
  assert.equal(shortcutConflictLevel(chord({ code: 'Space' })), 'high');

  // The browser's own Ctrl/Meta commands.
  assert.equal(shortcutConflictLevel(chord({ code: 'KeyW', ctrl: true })), 'high');
  assert.equal(shortcutConflictLevel(chord({ code: 'Tab', meta: true })), 'high');
  assert.equal(shortcutConflictLevel(chord({ code: 'Space', ctrl: true })), 'high');

  // The function row separates the browser's keys from the remapping row.
  assert.equal(shortcutConflictLevel(chord({ code: 'F5' })), 'high');
  assert.equal(shortcutConflictLevel(chord({ code: 'F13' })), 'warning');
  assert.equal(shortcutConflictLevel(chord({ code: 'MediaPlayPause' })), 'warning');

  // Ordinary combinations are free, including the recommended shape.
  assert.equal(shortcutConflictLevel(chord({ code: 'KeyD', ctrl: true, alt: true })), 'none');
  assert.equal(shortcutConflictLevel(chord({ code: 'KeyV', ctrl: true, shift: true })), 'high');
});
