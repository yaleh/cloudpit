import assert from 'node:assert/strict';

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import React from 'react';
import { initReactI18next } from 'react-i18next';
import { afterEach, beforeEach, test, vi } from 'vitest';

import enChat from '@/modules/i18n/locales/en/chat.json';
import enCommon from '@/modules/i18n/locales/en/common.json';
import enSettings from '@/modules/i18n/locales/en/settings.json';
import { WorkspaceMenu } from '@/modules/project-workspace';
import VoiceSettingsTab from '@/modules/settings/tabs/VoiceSettingsTab';
import { ThemeProvider } from '@/shared/context/ThemeContext';
import { UiPreferencesProvider } from '@/shared/context/UiPreferencesContext';
import { readUserPreference, resetUserPreferences, writeUserPreference } from '@/shared/settings/userSettings';

/**
 * AC-3: the Settings page's VAD switch is the SAME preference the workspace menu toggles.
 *
 * BOTH ENTRY POINTS RENDER AT ONCE, inside one `UiPreferencesProvider`, so "they agree" is read as
 * one store serving two surfaces rather than as two copies happening to match. A change made on
 * either surface must repaint the other without a reload, and it must reach the stored blob — the
 * value a refresh reads back. The Settings tab's recogniser/back-end hooks are stubbed at their
 * endpoints; the switch under test and the shared preference store are the real ones.
 */

const voice = vi.hoisted(() => ({
  health: vi.fn(),
  config: vi.fn(),
  saveConfig: vi.fn(),
  clearData: vi.fn(),
  savePreferences: vi.fn(),
}));

vi.mock('@/shared/api/client', () => ({
  api: {
    voice,
    voiceRealtime: {
      speakerModelStatus: vi.fn(async () => ({ ok: false })),
      speakerModelDownload: vi.fn(async () => ({ ok: false })),
    },
    user: { savePreferences: voice.savePreferences },
  },
  authenticatedFetch: vi.fn(),
}));

await i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'chat', 'settings'],
  defaultNS: 'chat',
  resources: { en: { chat: enChat, common: enCommon, settings: enSettings } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => data });
const EMPTY_SERVER_DOCUMENT = {
  baseUrl: '',
  apiKey: '',
  sttModel: '',
  ttsModel: '',
  ttsVoice: '',
  ttsFormat: '',
};

const TRIGGER = '[data-workspace-menu-trigger]';
const MENU_ROW = '[data-workspace-menu-item="voiceVadEnabled"]';
const LABEL = enSettings.quickSettings.voiceVadEnabled;

const menuRow = (): HTMLElement | null => document.querySelector(MENU_ROW);

/** Renders the menu and the Voice settings tab over ONE preference provider, menu open. */
const renderBothSurfaces = () => {
  const view = render(
    React.createElement(
      ThemeProvider,
      null,
      React.createElement(
        UiPreferencesProvider,
        null,
        React.createElement(WorkspaceMenu),
        React.createElement(VoiceSettingsTab),
      ),
    ),
  );
  fireEvent.click(document.querySelector(TRIGGER) as HTMLElement);
  return view;
};

/** The Settings page's switch, named by its accessible label. */
const settingsSwitch = (): HTMLElement => {
  const found = Array.from(document.querySelectorAll('[role="switch"]'))
    .find((element) => element.getAttribute('aria-label') === LABEL);
  assert.ok(found, 'the Voice → Input tab must render the VAD switch');
  return found as HTMLElement;
};

beforeEach(() => {
  localStorage.clear();
  resetUserPreferences();
  voice.health.mockReset();
  voice.config.mockReset();
  voice.saveConfig.mockReset();
  voice.clearData.mockReset();
  voice.savePreferences.mockReset();
  voice.health.mockImplementation(() => ok({ configured: true, provider: 'alpha-asr', providers: [] }));
  voice.config.mockImplementation(() => ok({ ...EMPTY_SERVER_DOCUMENT }));
  voice.saveConfig.mockImplementation(() => ok({ ...EMPTY_SERVER_DOCUMENT }));
  voice.clearData.mockImplementation(() => ok({ deleted: 0 }));
  voice.savePreferences.mockImplementation(() => ok({}));
  writeUserPreference('uiPreferences', { voiceEnabled: true });
});

afterEach(() => {
  cleanup();
});

test('the Settings switch writes the same key the menu reads', () => {
  renderBothSurfaces();

  assert.equal(settingsSwitch().getAttribute('aria-checked'), 'true', 'the setting starts on');
  assert.equal(menuRow()?.getAttribute('aria-checked'), 'true', 'the menu shows the same state');

  act(() => {
    fireEvent.click(settingsSwitch());
  });

  assert.equal(settingsSwitch().getAttribute('aria-checked'), 'false', 'the Settings switch must flip');
  assert.equal(
    menuRow()?.getAttribute('aria-checked'),
    'false',
    'the menu must follow the same store without a reload',
  );
  assert.equal(
    readUserPreference<Record<string, unknown>>('uiPreferences', {}).voiceVadEnabled,
    false,
    'the change must reach the stored blob a refresh reads back',
  );
});

test('the menu row writes the same key the Settings page reads', () => {
  renderBothSurfaces();

  act(() => {
    fireEvent.click(menuRow() as HTMLElement);
  });

  assert.equal(menuRow()?.getAttribute('aria-checked'), 'false');
  assert.equal(settingsSwitch().getAttribute('aria-checked'), 'false', 'Settings follows the menu');
  assert.equal(
    readUserPreference<Record<string, unknown>>('uiPreferences', {}).voiceVadEnabled,
    false,
  );
});
