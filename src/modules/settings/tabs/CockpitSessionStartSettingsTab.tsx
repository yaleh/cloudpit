import { useTranslation } from 'react-i18next';

import SettingsSection from '@/modules/settings/ui/SettingsSection';
import { useCockpitSessionStartSettings } from '@/modules/settings/hooks/useCockpitSessionStartSettings';
import type { LLMProvider } from '@/shared/types';

/**
 * Settings → Cockpit: the model (and optional reasoning effort) a NEW conversation opens with
 * when it is started from a cockpit card. This is the same server settings field
 * (`cockpit.sessionStart`) the card `session.start` executor reads, so a value saved here is
 * what an action/`ownReply` start uses after the next restart.
 *
 * The form is deliberately explicit about the difference the settings file makes: a save writes
 * the NEXT boot's reading, so the page shows the SAVED values beside the ones the running
 * process is still using and says 「restart the server for this to take effect」 while they
 * differ. The pickers come from the provider's model catalog, and a save carries the version it
 * was read at — a second editor's stale write is reported as a conflict instead of overwriting.
 */

/** The provider a card-started conversation runs on; the cockpit's own shipped default. */
const COCKPIT_CARD_SESSION_PROVIDER: LLMProvider = 'claude';

/**
 * The `data-cockpit-session-start*` attributes are the page's own declaration of this form's
 * state — the same shape the cockpit draws for the scenario surface. A scenario reads them
 * instead of inferring "a save is pending" from a sentence, and its drive verbs press the same
 * selects/buttons a person does.
 */

const selectClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';
const buttonClass =
  'rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50';
const primaryButtonClass =
  'rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/20 disabled:opacity-50';

export default function CockpitSessionStartSettingsTab() {
  const { t } = useTranslation('settings');
  const { snapshot, load, setDraftModel, setDraftEffort, save } =
    useCockpitSessionStartSettings(COCKPIT_CARD_SESSION_PROVIDER);

  const reading = snapshot.reading;
  const busy = snapshot.status === 'loading' || snapshot.status === 'saving';
  const effectiveEffort = reading?.effectiveEffort ?? '';
  const savedEffort = reading?.effort ?? '';

  return (
    <SettingsSection
      title={t('cockpitSessionStart.title')}
      description={t('cockpitSessionStart.description')}
    >
      <div
        className="space-y-4"
        data-cockpit-session-start={snapshot.status}
        data-cockpit-session-start-error={snapshot.error?.kind ?? ''}
        data-cockpit-session-start-draft-model={snapshot.draftModel}
        data-cockpit-session-start-draft-effort={snapshot.draftEffort}
        data-cockpit-session-start-saved-model={reading?.model ?? ''}
        data-cockpit-session-start-saved-effort={reading?.effort ?? ''}
        data-cockpit-session-start-effective-model={reading?.effectiveModel ?? ''}
        data-cockpit-session-start-effective-effort={reading?.effectiveEffort ?? ''}
        data-cockpit-session-start-restart={reading === null ? '' : String(reading.restartRequired)}
      >
      {snapshot.status === 'loading' && (
        <p className="text-sm text-muted-foreground">{t('cockpitSessionStart.loading')}</p>
      )}

      {snapshot.error?.kind === 'load' && (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {t('cockpitSessionStart.loadFailed')}: {snapshot.error.message}
          </p>
          <button type="button" className={buttonClass} onClick={() => void load()}>
            {t('cockpitSessionStart.retry')}
          </button>
        </div>
      )}

      {reading && (
        <div className="space-y-4" data-cockpit-session-start-form>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t('cockpitSessionStart.modelLabel')}
              </span>
              <select
                className={selectClass}
                aria-label={t('cockpitSessionStart.modelLabel')}
                data-cockpit-session-start-model-select
                value={snapshot.draftModel}
                disabled={busy}
                onChange={(event) => setDraftModel(event.target.value)}
              >
                {snapshot.modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-sm font-medium text-foreground">
                {t('cockpitSessionStart.effortLabel')}
              </span>
              <select
                className={selectClass}
                aria-label={t('cockpitSessionStart.effortLabel')}
                data-cockpit-session-start-effort-select
                value={snapshot.draftEffort}
                disabled={busy}
                onChange={(event) => setDraftEffort(event.target.value)}
              >
                <option value="">{t('cockpitSessionStart.effortDefault')}</option>
                {snapshot.effortOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.value}</option>
                ))}
              </select>
            </label>
          </div>

          <dl className="grid gap-2 rounded-md border border-border bg-muted/30 p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('cockpitSessionStart.effectiveTitle')}
              </dt>
              <dd className="font-mono text-foreground">
                {reading.effectiveModel || t('cockpitSessionStart.providerDefault')}
                {effectiveEffort === '' ? '' : ` / ${effectiveEffort}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('cockpitSessionStart.savedTitle')}
              </dt>
              <dd className="font-mono text-foreground">
                {reading.model || t('cockpitSessionStart.providerDefault')}
                {savedEffort === '' ? '' : ` / ${savedEffort}`}
              </dd>
            </div>
          </dl>

          {reading.restartRequired && (
            <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              {t('cockpitSessionStart.restartRequired')}
            </p>
          )}

          {snapshot.error?.kind === 'conflict' && (
            <p role="alert" className="text-sm text-destructive">
              {t('cockpitSessionStart.versionConflict')}
            </p>
          )}
          {snapshot.error?.kind === 'save' && (
            <p role="alert" className="text-sm text-destructive">
              {t('cockpitSessionStart.saveFailed')}: {snapshot.error.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              data-cockpit-session-start-save
              disabled={busy}
              onClick={() => void save()}
            >
              {t('cockpitSessionStart.save')}
            </button>
            <button
              type="button"
              className={buttonClass}
              data-cockpit-session-start-reload
              disabled={busy}
              onClick={() => void load()}
            >
              {t('cockpitSessionStart.reload')}
            </button>
          </div>
        </div>
      )}
      </div>
    </SettingsSection>
  );
}
