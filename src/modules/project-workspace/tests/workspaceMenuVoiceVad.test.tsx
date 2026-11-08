import assert from 'node:assert/strict';

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, test } from 'vitest';

import enChat from '@/modules/i18n/locales/en/chat.json';
import enCommon from '@/modules/i18n/locales/en/common.json';
import enSettings from '@/modules/i18n/locales/en/settings.json';
import WorkspaceMenu from '@/modules/project-workspace/WorkspaceMenu';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import {
  readUserPreference,
  resetUserPreferences,
  writeUserPreference,
} from '@/shared/settings/userSettings';

/**
 * AC-2: the workspace menu's VAD row.
 *
 * THREE READINGS, all taken off the rendered menu rather than off a component's props. The row is
 * present exactly when dictation is enabled — a VAD switch with voice off would be a control for
 * something the user has not turned on. Its checked state is the shared preference (not local
 * state), and clicking it flips BOTH the painted state and the stored blob the Settings page reads.
 * The stored-blob assertion is the one that separates a real preference from a menu-local toggle:
 * a row that only flipped its own copy would repaint here and lose the value on the next load.
 */

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'chat', 'settings'],
  defaultNS: 'chat',
  resources: { en: { chat: enChat, common: enCommon, settings: enSettings } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const TRIGGER = '[data-workspace-menu-trigger]';
const ROW = '[data-workspace-menu-item="voiceVadEnabled"]';

const row = (): HTMLElement | null => document.querySelector(ROW);

/** Renders the menu under the real preferences provider and opens the dropdown. */
const openMenu = () => {
  const view = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(UiPreferencesProvider, null, React.createElement(WorkspaceMenu)),
    ),
  );
  fireEvent.click(document.querySelector(TRIGGER) as HTMLElement);
  return view;
};

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
});

afterEach(() => {
  cleanup();
});

test('the VAD row is absent while dictation is disabled', () => {
  writeUserPreference('uiPreferences', { voiceEnabled: false });

  openMenu();

  assert.equal(row(), null, 'a VAD switch under a disabled voice toggle would configure nothing');
});

test('the VAD row renders when dictation is on, reflects the preference, and writes it back', () => {
  writeUserPreference('uiPreferences', { voiceEnabled: true });

  openMenu();

  const rendered = row();
  assert.ok(rendered, 'the VAD row must render once dictation is enabled');
  assert.equal(rendered.getAttribute('role'), 'menuitemcheckbox');
  assert.equal(
    rendered.getAttribute('aria-checked'),
    'true',
    'a fresh install ships VAD on, so the row starts checked',
  );
  assert.ok(
    (rendered.getAttribute('title') ?? '').length > 0,
    'the row must carry the full explanation in its title',
  );

  act(() => {
    fireEvent.click(rendered);
  });

  assert.equal(row()?.getAttribute('aria-checked'), 'false', 'the click must repaint the row');
  assert.equal(
    readUserPreference<Record<string, unknown>>('uiPreferences', {}).voiceVadEnabled,
    false,
    'the click must reach the stored preference, not only the menu',
  );
});
