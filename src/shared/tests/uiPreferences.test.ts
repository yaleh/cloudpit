import assert from 'node:assert/strict';

import { beforeEach, test } from 'vitest';

import {
  readStoredUiPreferences,
  uiPreferencesReducer,
} from '@/shared/settings/uiPreferences';
import type { UiPreferences } from '@/shared/settings/uiPreferences';
import { writeUserPreference, resetUserPreferences } from '@/shared/settings/userSettings';

/**
 * These preferences were previously held by four independent useReducer
 * instances that reconciled through a CustomEvent, then by one localStorage
 * blob, and now by the server-backed preference store. Consolidating them has
 * to preserve the stored shape and the string/boolean coercion, or users lose
 * settings on upgrade.
 */

beforeEach(() => {
  localStorage.clear();
  // The preference store is a module-level singleton, so its in-memory copy
  // outlives localStorage.clear() and would leak one test's writes into the next.
  resetUserPreferences();
});

const storeUiPreferences = (value: unknown) => {
  writeUserPreference('uiPreferences', value);
};

const baseline = (): UiPreferences => readStoredUiPreferences();

test('a fresh install gets the documented defaults', () => {
  assert.deepEqual(readStoredUiPreferences(), {
    showRawParameters: false,
    showThinking: true,
    sendByCtrlEnter: false,
    sidebarVisible: true,
    voiceEnabled: false,
    voiceVadEnabled: true,
  });
});

/**
 * AC-1: the user's VAD switch is on by default, a written `false` reads back, and a blob recorded
 * before the key existed keeps the default rather than reading as off.
 *
 * The third arm is the upgrade path, and it is the one a naive `stored[key] ?? false` would get
 * wrong: the absence of a key means "never toggled", not "turned off", so the fallback has to be
 * the documented default.
 */
test('the VAD switch defaults on, reads back off, and a legacy blob keeps the default', () => {
  assert.equal(readStoredUiPreferences().voiceVadEnabled, true, 'a fresh install must ship VAD on');

  storeUiPreferences({ voiceVadEnabled: false });
  assert.equal(readStoredUiPreferences().voiceVadEnabled, false, 'a written false must read back');

  // A blob from before this key existed: everything else is stored, the key is not.
  storeUiPreferences({ showThinking: false, voiceEnabled: true });
  assert.equal(
    readStoredUiPreferences().voiceVadEnabled,
    true,
    'a missing key must fall back to the default (on), not to off',
  );
});

test('the stored blob is read back', () => {
  storeUiPreferences({ showThinking: false, voiceEnabled: true });

  const preferences = readStoredUiPreferences();
  assert.equal(preferences.showThinking, false);
  assert.equal(preferences.voiceEnabled, true);
  assert.equal(preferences.sidebarVisible, true, 'unlisted keys keep their default');
});

test('values stored as strings are coerced, as older versions wrote them', () => {
  storeUiPreferences({ showThinking: 'false', voiceEnabled: 'true' });

  const preferences = readStoredUiPreferences();
  assert.equal(preferences.showThinking, false);
  assert.equal(preferences.voiceEnabled, true);
});

test('a stored value of the wrong type falls back instead of throwing', () => {
  storeUiPreferences('not an object');

  assert.equal(readStoredUiPreferences().showThinking, true);
});

test('setting a preference changes only that key', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, { type: 'set', key: 'showThinking', value: false });

  assert.equal(next.showThinking, false);
  assert.equal(next.sidebarVisible, state.sidebarVisible);
});

test('setting a preference to its current value keeps the same object', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, { type: 'set', key: 'showThinking', value: true });

  assert.equal(next, state, 'a no-op must not wake consumers');
});

test('an unknown key is ignored', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, {
    type: 'set',
    key: 'notAPreference' as never,
    value: true,
  });

  assert.equal(next, state);
});

test('a cross-tab update applies every changed key at once', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, {
    type: 'set_many',
    value: { showThinking: false, voiceEnabled: true },
  });

  assert.equal(next.showThinking, false);
  assert.equal(next.voiceEnabled, true);
});

test('a cross-tab update with nothing new keeps the same object', () => {
  const state = baseline();
  const next = uiPreferencesReducer(state, {
    type: 'set_many',
    value: { showThinking: state.showThinking },
  });

  assert.equal(next, state);
});
