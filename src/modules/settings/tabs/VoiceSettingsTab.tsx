import type { InputHTMLAttributes } from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { clientAsrProviderId } from '@shared/asr/asrRegistry';

import { useVoiceClientAsrStatus } from '@/shared/hooks/useVoiceClientAsrStatus';
import SettingsSection from '@/modules/settings/ui/SettingsSection';
import SettingsToggle from '@/modules/settings/ui/SettingsToggle';
import { api } from '@/shared/api';
import { cn } from '@/shared/utils';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useVoiceConfig } from '@/modules/settings/hooks/useVoiceConfig';
import { useVoiceProviderOptions } from '@/modules/settings/hooks/useVoiceProviderOptions';
import { useSpeakerModelStatus, type SpeakerModelStatus } from '@/modules/settings/hooks/useSpeakerModelStatus';
import {
  isVoiceConfigField,
  readVoiceConfigField,
  readVoiceFallbackPreference,
  writeVoiceFallbackPreference,
} from '@/shared/voiceConfig';
import {
  canonicalChord,
  chordFromKeyEvent,
  readStoredVoiceShortcuts,
  sameChord,
  shortcutConflictLevel,
  writeStoredVoiceShortcuts,
} from '@/shared/voiceShortcuts';
import type { VoiceShortcutChord, VoiceShortcuts } from '@/shared/voiceShortcuts';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/** The size floor the capacity box refuses to commit, mirroring the server's own bound. */
const MIN_VOICE_DATA_MAX_BYTES = 1024;

/** One decimal place of megabytes, from a byte count — the unit a 239 MB download is read in. */
function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** A whole number of kilobytes per second, from a bytes-per-second reading. */
function kilobytesPerSecond(bytesPerSec: number): number {
  return Math.max(0, Math.round(bytesPerSec / 1024));
}

const clearButtonClass =
  'rounded-md border border-destructive/50 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50';
const subtleButtonClass =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted';

/** The sentence for each server reading, as an i18n key. */
const SPEAKER_MODEL_STATE_KEYS: Record<SpeakerModelStatus['state'], string> = {
  missing: 'voiceSettings.speakerModelStateMissing',
  downloading: 'voiceSettings.speakerModelStateDownloading',
  installed: 'voiceSettings.speakerModelStateInstalled',
  invalid: 'voiceSettings.speakerModelStateInvalid',
  failed: 'voiceSettings.speakerModelStateFailed',
};

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

/** What one declared credential field is FOR, which is all this form knows about it. */
type DeclaredFieldRole = 'endpoint' | 'apiKey' | 'model';

/**
 * The inputs a provider's own declaration asks for, in the order its declaration names them.
 *
 * The three roles are the three halves of `AsrCredentialFields`, chosen from the declaration's
 * own slots rather than from the field's name — the form decides an input's type, label and
 * placeholder from the SLOT a field occupies, so a provider whose key field is named something
 * this module has never heard of still gets a password input and still gets the credential label.
 * No provider's name appears in this file at all, and that is deliberate: the names it renders
 * come from the payload, so a provider this build has never been told about is rendered the same
 * way, and a rename moves the UI with it instead of leaving a stale table behind.
 */
function declaredEntries(declaration: { endpointField: string; apiKeyField: string; modelField?: string }) {
  const entries: { field: string; role: DeclaredFieldRole }[] = [
    { field: declaration.endpointField, role: 'endpoint' },
    { field: declaration.apiKeyField, role: 'apiKey' },
  ];
  if (declaration.modelField) {
    entries.push({ field: declaration.modelField, role: 'model' });
  }
  // A name this build does not store is dropped rather than rendered: `updateVoiceConfig` accepts
  // only the fields this module knows, so an input bound to anything else would silently discard
  // what the user typed into it. See `isVoiceConfigField`.
  return entries.filter((entry) => isVoiceConfigField(entry.field));
}

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
function VoiceShortcutsSection() {
  const { t } = useTranslation('settings');
  // The form's working copy, so the capture controls repaint as they are edited.
  // The preference store remains the source of truth for every other reader.
  const [shortcuts, setShortcuts] = useState<VoiceShortcuts>(() => readStoredVoiceShortcuts());

  const commit = (next: VoiceShortcuts): void => {
    setShortcuts(next);
    writeStoredVoiceShortcuts(next);
  };

  // One key cannot drive two surfaces: the controller gives dictation the press,
  // so say that here instead of letting the second binding look functional.
  const duplicate = shortcuts.dictationChord !== null
    && shortcuts.liveVoiceChord !== null
    && sameChord(shortcuts.dictationChord, shortcuts.liveVoiceChord);
  const enabledLabel = t('voiceSettings.shortcutsEnable', { defaultValue: 'Enable voice shortcuts' });

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

        {duplicate && (
          <p data-testid="voice-shortcuts-duplicate" className="text-xs text-destructive">
            {t('voiceSettings.shortcutsDuplicate', {
              defaultValue: 'Dictation and Live Voice use the same keys. Dictation wins, so change one of them.',
            })}
          </p>
        )}
      </div>
    </SettingsSection>
  );
}

/** Rendered by Settings for the "voice" tab, covering speech-to-text provider credentials. */
export default function VoiceSettingsTab() {
  const { t } = useTranslation('settings');
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const { config, update } = useVoiceConfig();
  const { providers } = useVoiceProviderOptions();
  const voiceEnabled = preferences.voiceEnabled;

  // THE ON-DEVICE RECOGNISER'S OWN STATE: how far its first download has come, and the reason a clip
  // had to leave the device. It is asked for here rather than inside the block that renders it because
  // the preload effect below needs the same reader, and because the hook's subscription must outlive
  // the block — a download that finishes while the fallback row is not rendered is still a download
  // whose progress was reported.
  const clientAsr = useVoiceClientAsrStatus();
  const { preload } = clientAsr;

  // THE SPEAKER TRACKER'S CAM++ MODEL. The reading is the SERVER's — whether the bytes at the
  // settings-file path hash to the pinned checkpoint — and the hook polls it only while a download
  // runs. Asked for here rather than inside the Live Voice section so the subscription outlives the
  // section's re-renders and a finished download is observed even if the user tabs away.
  const speakerModel = useSpeakerModelStatus();
  const modelStatus = speakerModel.status;
  const modelDownloading = modelStatus?.state === 'downloading';
  const modelTotal = modelStatus?.totalBytes ?? modelStatus?.expectedBytes ?? 0;
  const modelReceived = modelStatus?.receivedBytes ?? 0;
  const modelProgressPercent = modelDownloading && modelTotal > 0
    ? Math.min(100, Math.round((modelReceived / modelTotal) * 100))
    : 0;

  // WHICH RECOGNISER TAKES A CLIP THIS DEVICE CANNOT, as this browser's own preference. It is not part
  // of the stored config document on purpose: the fallback is chosen for THIS browser — the one whose
  // device recognition gave up — and putting it in the shared document would make one browser's choice
  // the deployment's, which no server could honour for anyone else. An empty value means "whichever the
  // deployment offers first", which is what the resolver answers when no choice has been made.
  const [fallbackChoice, setFallbackChoice] = useState(() => readVoiceFallbackPreference() ?? '');
  /**
   * Which half of the Voice settings is on screen: the speech-to-text / read-aloud backend
   * (Voice Input), or the Live Voice realtime credential. Kept as local UI state because it is a
   * view choice, not a stored preference — reopening Settings starts on the input half.
   */
  const [voiceTab, setVoiceTab] = useState<'input' | 'live'>('input');

  // THE CAPACITY BOX'S DRAFT. `voiceDataMaxBytes` is a bounded whole number the store enforces, but
  // the box the user types in is text: binding it straight to the committed number would rewrite the
  // field under the cursor on every keystroke and push half-typed values through the server's
  // validation. So the text lives here until it parses to a whole number at or above the floor, and
  // the effect below re-seeds it whenever the committed figure changes from elsewhere — a hydration
  // landing after mount, or an edit made in another tab.
  const [capacityDraft, setCapacityDraft] = useState(() => String(config.voiceDataMaxBytes));
  useEffect(() => {
    setCapacityDraft(String(config.voiceDataMaxBytes));
  }, [config.voiceDataMaxBytes]);

  // WHETHER THE CLEAR BUTTON IS ASKING TO CONFIRM. Deleting every recording is irreversible here, so
  // the first click only arms the button and the second — after the user has read what it does —
  // sends it. `clearing` disables both during the round trip so a double click cannot send twice.
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  // The count the server answered the last clear with, or `null` before the first one (and after one
  // that failed, where leaving the button armed is the retry).
  const [clearedCount, setClearedCount] = useState<number | null>(null);

  const runClear = async (): Promise<void> => {
    setClearing(true);
    try {
      const response = await api.voice.clearData();
      const body: unknown = response.ok ? await response.json().catch(() => null) : null;
      const deleted = body && typeof body === 'object' && typeof (body as { deleted?: unknown }).deleted === 'number'
        ? (body as { deleted: number }).deleted
        : 0;
      setClearedCount(deleted);
    } catch {
      // The store is the server's to reach; a request that never landed changed nothing, so no count
      // is shown and the confirm button stays for a retry.
      setClearedCount(null);
    } finally {
      setClearing(false);
      setConfirmingClear(false);
    }
  };

  // WHICH PROVIDER THE FORM IS ABOUT: the user's stored choice, or — before they have made one —
  // the first row the server would fall back to. The stored value is never second-guessed: an id
  // the payload does not list still selects the row `providerId` already holds, because a form
  // that quietly re-pointed the user at another service is the failure this precedence exists to
  // avoid. The server refuses an id no adapter claims, so it is not this form's job to guess.
  const selectedId = config.providerId || providers[0]?.id || '';
  const selected = providers.find((provider) => provider.id === selectedId) ?? null;
  const options = providers.length > 0
    ? providers
    : (selectedId ? [{ id: selectedId, label: selectedId, configured: false, credentialFields: null, runtime: null }] : []);

  const declaration = selected?.credentialFields ?? null;
  const declared = declaration ? declaredEntries(declaration) : [];
  const providerLabel = selected?.label ?? selectedId;

  // Whether the form is about the recogniser that runs in this browser. Named through the registry
  // rather than compared against a string, so a build that renames it moves this with it.
  const clientSelected = selectedId === clientAsrProviderId();
  // THE ROWS A CLIP COULD BE HANDED TO: every recogniser this deployment lists EXCEPT the on-device one,
  // which is the recogniser being fallen back FROM — offering it back would be offering the machine that
  // just gave up. Whether a row can really serve an upload is the resolver's judgement (it reads each
  // row's own declaration); this list is what a user may pick, and a pick it cannot honour is not a
  // silent failure — the resolver answers with the deployment's own first choice instead.
  const fallbackOptions = providers.filter((provider) => provider.id !== clientAsrProviderId());
  const progress = clientAsr.progress;
  const progressPercent = progress && progress.totalBytes > 0
    ? Math.min(100, Math.round((progress.receivedBytes / progress.totalBytes) * 100))
    : 0;
  const remainingText = progress === null || progress.remainingMs === null
    ? t('voiceSettings.clientAsrRemainingUnknown')
    : t('voiceSettings.clientAsrRemaining', { minutes: Math.max(1, Math.round(progress.remainingMs / 60_000)) });

  // THE SELECTION IS THE REASON TO DOWNLOAD, and this is where it is acted on. Asking for the load the
  // moment the on-device recogniser is chosen is what keeps 239 MB out of the first segment — a download
  // that takes longer than any per-segment deadline can cover, so a fresh browser would fall back on its
  // first clip every time without this. The memo behind `preload` makes the effect idempotent: a
  // re-render, a reopened modal, or selecting the same row twice all join the one load, and selecting
  // anything else never starts one.
  useEffect(() => {
    if (selectedId !== clientAsrProviderId()) return;
    void preload();
  }, [selectedId, preload]);

  return (
    <div className="space-y-8">
      <SettingsSection title={t('voiceSettings.title')} description={t('voiceSettings.description')}>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="pr-3">
            <div className="text-sm font-medium text-foreground">{t('voiceSettings.enable')}</div>
            <div className="text-xs text-muted-foreground">{t('voiceSettings.enableDescription')}</div>
          </div>
          <SettingsToggle
            checked={voiceEnabled}
            onChange={(v) => setPreference('voiceEnabled', v)}
            ariaLabel={t('voiceSettings.enable')}
          />
        </div>
      </SettingsSection>

      {/* The key bindings belong to both halves of Voice, so they sit above the
          tab split rather than inside one of them. */}
      {voiceEnabled && <VoiceShortcutsSection />}

      {voiceEnabled && (
        // Two halves with different owners: Voice Input configures the recogniser/read-aloud backend,
        // Live Voice its own realtime credential. Same `role=tablist` pattern as the Agents settings.
        <div className="flex-shrink-0 border-b border-border">
          <div role="tablist" className="flex overflow-x-auto">
            <button
              role="tab"
              aria-selected={voiceTab === 'input'}
              data-testid="voice-settings-tab-input"
              onClick={() => setVoiceTab('input')}
              className={cn(
                'whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium touch-manipulation transition-colors duration-150',
                voiceTab === 'input'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t('voiceSettings.tabInput')}
            </button>
            <button
              role="tab"
              aria-selected={voiceTab === 'live'}
              data-testid="voice-settings-tab-live"
              onClick={() => setVoiceTab('live')}
              className={cn(
                'whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium touch-manipulation transition-colors duration-150',
                voiceTab === 'live'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {t('voiceSettings.tabLiveVoice')}
            </button>
          </div>
        </div>
      )}

      {voiceEnabled && voiceTab === 'input' && (
        <SettingsSection title={t('voiceSettings.backendTitle')} description={t('voiceSettings.backendDescription')}>
          <div className="space-y-4">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{t('voiceSettings.provider')}</span>
              <select
                name="providerId"
                className={inputClass}
                value={selectedId}
                onChange={(e) => update({ providerId: e.target.value })}
              >
                {options.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
              <span className="block text-xs text-muted-foreground">{t('voiceSettings.providerDescription')}</span>
            </label>

            {/* THE ON-DEVICE RECOGNISER'S OWN PANEL. It is keyed on the selection rather than on a
                runtime reading, and it has to be: this is the one provider whose engine lives in the
                browser, so it is the one provider the block below — which renders a reading the SERVER
                took — says nothing about. What a user needs here is exactly what that block cannot
                give: whether the model has arrived, and where a clip went when it did not. Both are
                read from the worker that runs the recogniser, through the chat module's barrel. */}
            {clientSelected && (
              <div className="space-y-3 rounded-lg border border-border p-3" data-testid="voice-client-asr">
                <div className="text-sm font-medium text-foreground">
                  {t('voiceSettings.clientAsrTitle', { provider: providerLabel })}
                </div>
                <p className="text-xs text-muted-foreground">{t('voiceSettings.clientAsrNotice')}</p>

                {/* THE FIRST DOWNLOAD, as it happens. Rendered only once the worker has reported a
                    chunk of it, so a page that never started one shows no empty bar. */}
                {progress && (
                  <div className="space-y-1" data-testid="voice-client-asr-progress">
                    <div className="text-xs text-muted-foreground">
                      {t('voiceSettings.clientAsrProgress', {
                        received: megabytes(progress.receivedBytes),
                        total: megabytes(progress.totalBytes),
                      })}
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${progressPercent}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground" data-testid="voice-client-asr-rate">
                      {t('voiceSettings.clientAsrRate', {
                        rate: kilobytesPerSecond(progress.bytesPerSec),
                        remaining: remainingText,
                      })}
                    </div>
                  </div>
                )}

                {/* HOW THE LOAD ENDED, in the engine's own words. A ready load says so, because the
                    progress bar above is a record of the download rather than its state; a failed one
                    shows the reason, which is the sentence an operator needs to fix it. */}
                {clientAsr.engine !== null && !clientAsr.engine.available && (
                  <p className="text-xs text-destructive" data-testid="voice-client-asr-engine">
                    {t('voiceSettings.clientAsrUnavailable', { reason: clientAsr.engine.reason })}
                  </p>
                )}
                {clientAsr.engine?.available === true && clientAsr.engine.state === 'ready' && (
                  <p className="text-xs text-muted-foreground" data-testid="voice-client-asr-engine">
                    {t('voiceSettings.clientAsrReady')}
                  </p>
                )}

                {/* WHERE A CLIP GOES UNTIL THE MODEL IS THERE — and after it, for the clips the device
                    still cannot take. The empty row is the deployment's own first choice, which is what
                    an unanswered question means. */}
                <label className="block space-y-1">
                  <span className="text-sm font-medium text-foreground">{t('voiceSettings.clientAsrFallback')}</span>
                  <select
                    name="fallbackProviderId"
                    className={inputClass}
                    value={fallbackChoice}
                    onChange={(e) => {
                      setFallbackChoice(e.target.value);
                      writeVoiceFallbackPreference(e.target.value);
                    }}
                  >
                    <option value="">{t('voiceSettings.clientAsrFallbackAuto')}</option>
                    {fallbackOptions.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.label}</option>
                    ))}
                  </select>
                  <span className="block text-xs text-muted-foreground">{t('voiceSettings.clientAsrFallbackDescription')}</span>
                </label>

                {/* THE GIVE-UP ITSELF, IN WORDS: the worker's own sentence, not a status code — which is
                    the whole point of surfacing it, since the code names nothing a user could act on. */}
                {clientAsr.fallback && (
                  <p className="text-xs text-destructive" data-testid="voice-client-asr-fallback">
                    {t('voiceSettings.clientAsrFallbackReason', { reason: clientAsr.fallback.message })}
                  </p>
                )}
              </div>
            )}

            {/* WHAT THIS PROVIDER IS, for the ones that answer, and whether it can run.
                The rows above and below are all about something the user types; this block is the
                only place the form says anything about the deployment. It is rendered for exactly
                the providers that carry a runtime reading — the ones that run on the machine hosting
                this server — and it is where a user learns that the credential boxes below are not
                theirs to fill in, and where an operator learns why the selection cannot serve a
                request right now. A provider that declares no runtime renders nothing here, so the
                page for every remote recogniser is the page it always was. */}
            {selected?.runtime && (
              <div className="space-y-1 rounded-lg border border-border p-3" data-testid="voice-provider-runtime">
                <div className="text-sm font-medium text-foreground">
                  {t('voiceSettings.providerLocalTitle', { provider: providerLabel })}
                </div>
                <p className="text-xs text-muted-foreground">{t('voiceSettings.providerLocalNotice')}</p>
                {selected.runtime.available ? (
                  <p className="text-xs text-muted-foreground">
                    {t('voiceSettings.providerBuild', { buildId: selected.runtime.buildId })}
                  </p>
                ) : (
                  <p className="text-xs text-destructive">
                    {t('voiceSettings.providerUnavailable', { reason: selected.runtime.reason })}
                  </p>
                )}
              </div>
            )}

            {declared.length > 0 && (
              <div className="space-y-4 rounded-lg border border-border p-3" data-testid="voice-provider-fields">
                <div className="text-sm font-medium text-foreground">
                  {t('voiceSettings.providerCredentials', { provider: providerLabel })}
                </div>
                {declared.map(({ field, role }) => (
                  <Field
                    key={field}
                    // The declaration's own name, on the element: it is what ties a rendered
                    // input to the slot the server will read it from, and it is what lets a
                    // reader of the page (a test, an accessibility tool) say which stored
                    // setting a box edits.
                    name={field}
                    type={role === 'apiKey' ? 'password' : undefined}
                    autoComplete={role === 'apiKey' ? 'off' : undefined}
                    // An empty model field is not "nothing": it resolves to the provider's declared default,
                    // so that name — when the payload carries one — is what the box shows.
                    placeholder={role === 'model'
                      ? declaration?.defaultModel || t('voiceSettings.providerModelPlaceholder')
                      : undefined}
                    label={t(
                      role === 'apiKey'
                        ? 'voiceSettings.providerApiKey'
                        : role === 'model'
                          ? 'voiceSettings.providerModel'
                          : 'voiceSettings.providerEndpoint',
                    )}
                    value={readVoiceConfigField(config, field)}
                    onChange={(e) => update({ [field]: e.target.value })}
                  />
                ))}
                {declaration?.modelField && (
                  <p className="text-xs text-muted-foreground">{t('voiceSettings.providerModelHelp')}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t('voiceSettings.providerNotice', { provider: providerLabel })}
                </p>
              </div>
            )}

            <div className="space-y-4">
              <div className="text-sm font-medium text-foreground">{t('voiceSettings.sharedFields')}</div>
              <Field
                name="baseUrl"
                label={t('voiceSettings.baseUrl')}
                placeholder="https://api.openai.com/v1"
                value={config.baseUrl}
                onChange={(e) => update({ baseUrl: e.target.value })}
              />
              <Field
                name="apiKey"
                label={t('voiceSettings.apiKey')}
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                value={config.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <Field
                  name="sttModel"
                  label={t('voiceSettings.sttModel')}
                  placeholder="whisper-1"
                  value={config.sttModel}
                  onChange={(e) => update({ sttModel: e.target.value })}
                />
                <Field
                  name="ttsModel"
                  label={t('voiceSettings.ttsModel')}
                  placeholder="tts-1"
                  value={config.ttsModel}
                  onChange={(e) => update({ ttsModel: e.target.value })}
                />
                <Field
                  name="ttsVoice"
                  label={t('voiceSettings.voice')}
                  placeholder="alloy"
                  value={config.ttsVoice}
                  onChange={(e) => update({ ttsVoice: e.target.value })}
                />
                <Field
                  name="ttsFormat"
                  label={t('voiceSettings.format')}
                  placeholder="mp3"
                  value={config.ttsFormat}
                  onChange={(e) => update({ ttsFormat: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('voiceSettings.note')}</p>
          </div>
        </SettingsSection>
      )}

      {voiceEnabled && voiceTab === 'live' && (
        <>
          {/* Live Voice 的独立设置：realtime relay 用自己的 DashScope key，不复用上面 voice-input
              的 `dashscopeApiKey`。两者是不同的服务（一个是识别器，一个是实时语音对话模型）。 */}
          <SettingsSection title={t('voiceSettings.liveVoiceTitle')} description={t('voiceSettings.liveVoiceDescription')}>
            <div className="space-y-4">
              <Field
                name="liveVoiceDashscopeApiKey"
                label={t('voiceSettings.liveVoiceApiKey')}
                type="password"
                autoComplete="off"
                placeholder="sk-…"
                value={config.liveVoiceDashscopeApiKey}
                onChange={(e) => update({ liveVoiceDashscopeApiKey: e.target.value })}
              />
            </div>
          </SettingsSection>

          {/* THE SPEAKER TRACKER'S MODEL. The weights are a runtime artifact the SERVER installs
              from one fixed source: this panel shows the resolved path and the verified state, and
              the one button asks the server to fetch it. The browser names neither the URL nor the
              directory, which is what keeps the download from becoming a client-controlled write.
              The progress bar reuses the on-device recogniser's shape above. */}
          <SettingsSection
            title={t('voiceSettings.speakerModelTitle')}
            description={t('voiceSettings.speakerModelDescription')}
          >
            <div className="space-y-3 rounded-lg border border-border p-3" data-testid="voice-speaker-model">
              <div className="text-sm font-medium text-foreground" data-testid="voice-speaker-model-state">
                {modelStatus === null
                  ? t('voiceSettings.speakerModelLoading')
                  : t(SPEAKER_MODEL_STATE_KEYS[modelStatus.state])}
              </div>

              {modelStatus !== null && (
                <>
                  <p className="break-all text-xs text-muted-foreground" data-testid="voice-speaker-model-path">
                    {t('voiceSettings.speakerModelPath', { path: modelStatus.path ?? '—' })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('voiceSettings.speakerModelSource', { url: modelStatus.sourceUrl })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('voiceSettings.speakerModelLicense', {
                      license: modelStatus.license,
                      attribution: modelStatus.attribution,
                    })}
                  </p>
                </>
              )}

              {/* THE DOWNLOAD, AS IT HAPPENS. Rendered only while the server reports one, so a
                  page that never started one shows no empty bar; received/total/rate are the
                  server's own counters, not a browser estimate. */}
              {modelDownloading && (
                <div className="space-y-1" data-testid="voice-speaker-model-progress">
                  <div className="text-xs text-muted-foreground">
                    {t('voiceSettings.speakerModelProgress', {
                      received: megabytes(modelReceived),
                      total: megabytes(modelTotal),
                    })}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${modelProgressPercent}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground" data-testid="voice-speaker-model-rate">
                    {t('voiceSettings.speakerModelRate', {
                      rate: kilobytesPerSecond(modelStatus?.bytesPerSec ?? 0),
                    })}
                  </div>
                </div>
              )}

              {/* THE SERVICE'S OWN SENTENCE, when a path was refused or a download failed. It is
                  what an operator needs to fix the cause; the state label above only names it. */}
              {(speakerModel.error ?? modelStatus?.error ?? null) !== null && (
                <p className="text-xs text-destructive" data-testid="voice-speaker-model-error">
                  {t('voiceSettings.speakerModelError', {
                    reason: speakerModel.error ?? modelStatus?.error ?? '',
                  })}
                </p>
              )}

              {modelStatus?.state !== 'installed' && (
                <button
                  type="button"
                  className={subtleButtonClass}
                  data-testid="voice-speaker-model-download"
                  onClick={() => void speakerModel.download()}
                  disabled={modelDownloading || speakerModel.loading}
                >
                  {modelDownloading
                    ? t('voiceSettings.speakerModelDownloading')
                    : t('voiceSettings.speakerModelDownload')}
                </button>
              )}

              <p className="text-xs text-muted-foreground">{t('voiceSettings.speakerModelNote')}</p>
            </div>
          </SettingsSection>
        </>
      )}

      {voiceEnabled && voiceTab === 'input' && (
        // D1: THE USER'S OWN KEPT RECORDINGS. On by default, stored on the machine that runs the
        // server, and clearable in one confirmed action — the promise this section puts on screen.
        // It is its own section rather than a field among the backend's, because nothing here
        // configures a recogniser: the switch decides whether a transcription is kept at all.
        <SettingsSection title={t('voiceSettings.dataTitle')} description={t('voiceSettings.dataDescription')}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="pr-3">
                <div className="text-sm font-medium text-foreground">{t('voiceSettings.dataRecording')}</div>
                <div className="text-xs text-muted-foreground">{t('voiceSettings.dataRecordingDescription')}</div>
              </div>
              <SettingsToggle
                checked={config.voiceDataRecording}
                onChange={(v) => update({ voiceDataRecording: v })}
                ariaLabel={t('voiceSettings.dataRecording')}
              />
            </div>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">{t('voiceSettings.dataCapacity')}</span>
              <input
                name="voiceDataMaxBytes"
                type="number"
                min={MIN_VOICE_DATA_MAX_BYTES}
                className={inputClass}
                value={capacityDraft}
                onChange={(e) => {
                  const text = e.target.value;
                  setCapacityDraft(text);
                  const parsed = Number(text);
                  // Committed only once it is a whole number of bytes at or above the floor, so a
                  // half-typed figure stays a draft rather than a request the server would refuse.
                  if (Number.isInteger(parsed) && parsed >= MIN_VOICE_DATA_MAX_BYTES) {
                    update({ voiceDataMaxBytes: parsed });
                  }
                }}
              />
              <span className="block text-xs text-muted-foreground">{t('voiceSettings.dataCapacityDescription')}</span>
            </label>

            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="text-sm font-medium text-foreground">{t('voiceSettings.dataClearTitle')}</div>
              <p className="text-xs text-muted-foreground">{t('voiceSettings.dataClearDescription')}</p>
              {confirmingClear ? (
                // THE SECOND STEP. The button above only armed this row; the destructive request is
                // sent by the confirm button the user reaches after reading what it removes.
                <div className="flex gap-2">
                  <button type="button" className={clearButtonClass} onClick={() => void runClear()} disabled={clearing}>
                    {t('voiceSettings.dataClearConfirm')}
                  </button>
                  <button type="button" className={subtleButtonClass} onClick={() => setConfirmingClear(false)} disabled={clearing}>
                    {t('voiceSettings.dataClearCancel')}
                  </button>
                </div>
              ) : (
                <button type="button" className={clearButtonClass} onClick={() => setConfirmingClear(true)}>
                  {t('voiceSettings.dataClear')}
                </button>
              )}
              {clearedCount !== null && (
                <p className="text-xs text-muted-foreground">{t('voiceSettings.dataCleared', { count: clearedCount })}</p>
              )}
            </div>
          </div>
        </SettingsSection>
      )}
    </div>
  );
}
