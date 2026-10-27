import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsSection from '@/modules/settings/ui/SettingsSection';
import SettingsToggle from '@/modules/settings/ui/SettingsToggle';
import {
  canonicalChord,
  chordFromKeyEvent,
  readStoredVoiceShortcuts,
  sameChord,
  shortcutConflictLevel,
  writeStoredVoiceShortcuts,
} from '@/shared/voiceShortcuts';
import type { VoiceShortcutChord, VoiceShortcuts } from '@/shared/voiceShortcuts';

const subtleButtonClass =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted';

/**
 * One key-capture control: shows the current binding, records the next chord the
 * user presses, and warns when that chord is one the browser or typing already
 * needs.
 *
 * The control only records while it is focused (`capturing`), so ordinary typing
 * elsewhere in Settings can never replace a binding. The key is read through
 * `event.code`, matching how the controller matches it later.
 */
function ShortcutCapture({
  label,
  chord,
  onChange,
  testId,
}: {
  label: string;
  chord: VoiceShortcutChord | null;
  onChange: (chord: VoiceShortcutChord | null) => void;
  testId: string;
}) {
  const { t } = useTranslation('settings');
  // Whether this box is waiting for a key. Essential: without it every keydown
  // on the focused control (including Tab away) would rewrite the binding.
  const [capturing, setCapturing] = useState(false);
  const level = chord === null ? 'none' : shortcutConflictLevel(chord);

  return (
    <div className="space-y-1" data-testid={testId}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid={`${testId}-capture`}
          aria-label={label}
          onFocus={() => setCapturing(true)}
          onBlur={() => setCapturing(false)}
          onKeyDown={(event) => {
            if (!capturing) return;
            // THIS PRESS IS THE BINDING'S. Stop it before a button's own
            // Space/Enter activation or another handler acts on it.
            event.preventDefault();
            event.stopPropagation();
            const next = chordFromKeyEvent(event);
            // A lone modifier starts a combination; keep waiting for the key.
            if (next === null) return;
            onChange(next);
            setCapturing(false);
          }}
          className="min-w-[11rem] rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-mono text-foreground hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {capturing
            ? t('voiceSettings.shortcutsPressKeys', { defaultValue: 'Press a key…' })
            : chord !== null
              ? canonicalChord(chord)
              : t('voiceSettings.shortcutsUnbound', { defaultValue: 'Not set' })}
        </button>
        {chord !== null && (
          <button
            type="button"
            data-testid={`${testId}-clear`}
            onClick={() => {
              onChange(null);
              setCapturing(false);
            }}
            className={subtleButtonClass}
          >
            {t('voiceSettings.shortcutsClear', { defaultValue: 'Clear' })}
          </button>
        )}
      </div>
      {level !== 'none' && (
        <p
          data-testid={`${testId}-conflict`}
          className={level === 'high' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}
        >
          {level === 'high'
            ? t('voiceSettings.shortcutsConflictHigh', {
                defaultValue: 'This key is reserved by the browser or would block typing. Choose another combination.',
              })
            : t('voiceSettings.shortcutsConflictWarning', {
                defaultValue: 'Some systems also use this key; check that it still reaches the page.',
              })}
        </p>
      )}
    </div>
  );
}

/**
 * The keyboard bindings for dictation and Live Voice.
 *
 * The capture controls write through the same preference store as the rest of
 * the UI preferences, and `ChatInterface`'s controller reads them per keydown,
 * so a binding is live as soon as it is captured. The copy uses inline
 * `defaultValue`s rather than new locale keys: this feature adds no translation
 * entries, so the locale files and their digest stay untouched.
 */
export function VoiceShortcutsSection() {
  const { t } = useTranslation('settings');
  // The form's working copy, so the capture controls repaint as they are edited.
  // The preference store remains the source of truth for every other reader.
  const [shortcuts, setShortcuts] = useState<VoiceShortcuts>(() => readStoredVoiceShortcuts());

  const commit = (next: VoiceShortcuts): void => {
    setShortcuts(next);
    writeStoredVoiceShortcuts(next);
  };

  // One key cannot drive two routes: the controller routes a press in a fixed
  // priority, so say that here instead of letting the later binding look
  // functional.
  const boundChords = [shortcuts.dictationChord, shortcuts.liveVoiceChord, shortcuts.clearInputChord]
    .filter((chord): chord is VoiceShortcutChord => chord !== null);
  const duplicate = boundChords.some((chord, index) => (
    boundChords.slice(index + 1).some((other) => sameChord(chord, other))
  ));
  const enabledLabel = t('voiceSettings.shortcutsEnable', { defaultValue: 'Enable voice shortcuts' });
  const sendOnStopLabel = t('voiceSettings.shortcutsSendOnStop', {
    defaultValue: 'Send when stopped by shortcut',
  });
  const crossCancelLabel = t('voiceSettings.shortcutsCrossCancel', {
    defaultValue: 'Other voice key cancels',
  });

  return (
    <SettingsSection
      title={t('voiceSettings.shortcutsTitle', { defaultValue: 'Keyboard shortcuts' })}
      description={t('voiceSettings.shortcutsDescription', {
        defaultValue: 'Toggle dictation or Live Voice with a key combination. Click a box and press the keys — the binding follows the physical key, so it survives a keyboard-layout change.',
      })}
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <div className="text-sm font-medium text-foreground">{enabledLabel}</div>
            <div className="text-xs text-muted-foreground">
              {t('voiceSettings.shortcutsEnableDescription', {
                defaultValue: 'Shortcuts fire only while no dialog is open.',
              })}
            </div>
          </div>
          <SettingsToggle
            checked={shortcuts.enabled}
            onChange={(enabled) => commit({ ...shortcuts, enabled })}
            ariaLabel={enabledLabel}
          />
        </div>

        <ShortcutCapture
          label={t('voiceSettings.shortcutsDictation', { defaultValue: 'Toggle dictation' })}
          chord={shortcuts.dictationChord}
          onChange={(dictationChord) => commit({ ...shortcuts, dictationChord })}
          testId="voice-shortcut-dictation"
        />
        <ShortcutCapture
          label={t('voiceSettings.shortcutsLiveVoice', { defaultValue: 'Toggle Live Voice' })}
          chord={shortcuts.liveVoiceChord}
          onChange={(liveVoiceChord) => commit({ ...shortcuts, liveVoiceChord })}
          testId="voice-shortcut-live-voice"
        />
        <ShortcutCapture
          label={t('voiceSettings.shortcutsClearInput', { defaultValue: 'Clear the composer' })}
          chord={shortcuts.clearInputChord}
          onChange={(clearInputChord) => commit({ ...shortcuts, clearInputChord })}
          testId="voice-shortcut-clear-input"
        />

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <div className="text-sm font-medium text-foreground">{sendOnStopLabel}</div>
            <div className="text-xs text-muted-foreground">
              {t('voiceSettings.shortcutsSendOnStopDescription', {
                defaultValue: 'Stopping dictation with its key sends what was heard. The microphone button still only stops.',
              })}
            </div>
          </div>
          <SettingsToggle
            checked={shortcuts.dictationSendOnStop}
            onChange={(dictationSendOnStop) => commit({ ...shortcuts, dictationSendOnStop })}
            ariaLabel={sendOnStopLabel}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <div className="text-sm font-medium text-foreground">{crossCancelLabel}</div>
            <div className="text-xs text-muted-foreground">
              {t('voiceSettings.shortcutsCrossCancelDescription', {
                defaultValue: 'While dictating, the Live Voice key stops recording without sending; in Live Voice, the dictation key leaves it.',
              })}
            </div>
          </div>
          <SettingsToggle
            checked={shortcuts.crossSurfaceCancel}
            onChange={(crossSurfaceCancel) => commit({ ...shortcuts, crossSurfaceCancel })}
            ariaLabel={crossCancelLabel}
          />
        </div>

        {duplicate && (
          <p data-testid="voice-shortcuts-duplicate" className="text-xs text-destructive">
            {t('voiceSettings.shortcutsDuplicate', {
              defaultValue: 'Two shortcuts use the same keys. Only Dictation, then Live Voice, then Clear can fire — change one of them.',
            })}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}
