import assert from 'node:assert/strict';

import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, test, vi } from 'vitest';

import VoiceSettingsTab from '@/modules/settings/tabs/VoiceSettingsTab';
import { readStoredVoiceShortcuts } from '@/shared/voiceShortcuts';
import { resetUserPreferences } from '@/shared/userSettings';

/**
 * Settings → Voice → Keyboard shortcuts, read as the user experiences it: enable the
 * master switch, capture a key for each surface, clear one, and see the warning for a
 * key the browser or typing already needs.
 *
 * Everything below the section — the recogniser config, the provider list, the model
 * download — is a seam this criterion is not about, so it is fixed in one settled
 * shape. What is real is the preference store: the case reads the binding back
 * through the same reader the chat controller consults per keydown, and reads the
 * persistence off the request the store really makes, not off local state.
 */

const savePreferences = vi.hoisted(() => vi.fn(async (_updates: Record<string, unknown>) => ({})));

vi.mock('@/shared/api', () => ({
  api: { user: { savePreferences } },
  authenticatedFetch: vi.fn(),
}));

// The copy is not under test: answer each key with the inline default the component
// passed, so an assertion can name what a user would read rather than a locale key.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => (options?.defaultValue as string | undefined) ?? key,
  }),
}));

vi.mock('@/shared/context/UiPreferencesContext', () => ({
  useUiPreferences: () => ({ voiceEnabled: true }),
  useSetUiPreference: () => () => {},
}));

vi.mock('@/modules/settings/hooks/useVoiceConfig', () => ({
  useVoiceConfig: () => ({ config: { providerId: '', voiceDataMaxBytes: 1024 }, update: async () => {} }),
}));

vi.mock('@/modules/settings/hooks/useVoiceProviderOptions', () => ({
  useVoiceProviderOptions: () => ({ providers: [] }),
}));

vi.mock('@/modules/settings/hooks/useSpeakerModelStatus', () => ({
  useSpeakerModelStatus: () => ({ status: null, loading: false, error: null, download: async () => {}, refresh: async () => {} }),
}));

vi.mock('@/shared/hooks/useVoiceClientAsrStatus', () => ({
  useVoiceClientAsrStatus: () => ({ engine: null, progress: null, fallback: null, preload: async () => ({}) }),
}));

beforeEach(() => {
  savePreferences.mockClear();
  localStorage.clear();
  // The preference store is a module-level singleton; without this its in-memory
  // copy would carry one case's binding into the next.
  resetUserPreferences();
});

const masterSwitch = (view: ReturnType<typeof render>): HTMLButtonElement =>
  view.getByRole('switch', { name: 'Enable voice shortcuts' }) as HTMLButtonElement;

/** Bind a key to one control the way a user does: focus it, then press the chord. */
const capture = (
  view: ReturnType<typeof render>,
  testId: string,
  keyDown: Record<string, unknown>,
): void => {
  const control = view.getByTestId(`${testId}-capture`);
  fireEvent.focus(control);
  fireEvent.keyDown(control, keyDown);
};

test('the master switch persists the setting and its bindings through the preference store', async () => {
  const view = render(<VoiceSettingsTab />);

  const toggle = masterSwitch(view);
  assert.equal(toggle.getAttribute('aria-checked'), 'false', 'shortcuts start off');
  assert.equal(readStoredVoiceShortcuts().enabled, false);

  fireEvent.click(toggle);

  assert.equal(masterSwitch(view).getAttribute('aria-checked'), 'true');
  assert.equal(readStoredVoiceShortcuts().enabled, true, 'the reader the controller uses sees it immediately');

  // The mirror is written synchronously; the server copy is debounced, so the case
  // waits for the request rather than assuming it already happened.
  await waitFor(
    () => assert.ok(savePreferences.mock.calls.length > 0, 'the setting was never sent to the server'),
    { timeout: 4_000 },
  );
  const sent = savePreferences.mock.calls[savePreferences.mock.calls.length - 1][0] as Record<string, unknown>;
  assert.equal((sent.voiceShortcuts as { enabled: boolean }).enabled, true);
});

test('a captured chord is displayed in canonical form and read back by the shared reader', () => {
  const view = render(<VoiceSettingsTab />);

  const control = view.getByTestId('voice-shortcut-dictation-capture');
  assert.equal(control.textContent, 'Not set');
  assert.equal(view.queryByTestId('voice-shortcut-dictation-clear'), null);

  fireEvent.focus(control);
  assert.equal(control.textContent, 'Press a key…', 'a focused control announces that it is listening');

  fireEvent.keyDown(control, { code: 'KeyD', ctrlKey: true, altKey: true });

  assert.equal(view.getByTestId('voice-shortcut-dictation-capture').textContent, 'Ctrl+Alt+D');
  assert.deepEqual(readStoredVoiceShortcuts().dictationChord, {
    code: 'KeyD',
    ctrl: true,
    alt: true,
    shift: false,
    meta: false,
  });
});

test('clearing a binding removes it from both the control and the store', () => {
  const view = render(<VoiceSettingsTab />);
  capture(view, 'voice-shortcut-live-voice', { code: 'KeyL', ctrlKey: true, altKey: true });
  assert.equal(view.getByTestId('voice-shortcut-live-voice-capture').textContent, 'Ctrl+Alt+L');
  assert.ok(readStoredVoiceShortcuts().liveVoiceChord);

  fireEvent.click(view.getByTestId('voice-shortcut-live-voice-clear'));

  assert.equal(view.getByTestId('voice-shortcut-live-voice-capture').textContent, 'Not set');
  assert.equal(view.queryByTestId('voice-shortcut-live-voice-clear'), null);
  assert.equal(readStoredVoiceShortcuts().liveVoiceChord, null);
});

test('a key the browser or typing needs is shown with the high-risk warning', () => {
  const view = render(<VoiceSettingsTab />);

  // A bare letter would swallow the user's typing, which is the warning this case reads.
  capture(view, 'voice-shortcut-dictation', { code: 'KeyV' });

  const warning = view.getByTestId('voice-shortcut-dictation-conflict');
  assert.match(warning.textContent ?? '', /reserved by the browser or would block typing/);
  // It warns rather than refuses: the binding the user asked for is still recorded.
  assert.deepEqual(readStoredVoiceShortcuts().dictationChord, {
    code: 'KeyV',
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  });
});

test('an ordinary combination carries no warning', () => {
  const view = render(<VoiceSettingsTab />);
  capture(view, 'voice-shortcut-dictation', { code: 'KeyD', ctrlKey: true, altKey: true });
  assert.equal(view.queryByTestId('voice-shortcut-dictation-conflict'), null);
});
