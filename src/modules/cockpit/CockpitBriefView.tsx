import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { CockpitBriefResponse } from '@/shared/types';
import type { CockpitBriefState } from '@/modules/cockpit/cockpitCardController';
import { CockpitBriefBlockView } from '@/modules/cockpit/cockpitBriefBlocks';

/**
 * The Details drawer's brief section: the read's four states and the block list.
 *
 * THE FALLBACK DRAWS NO CHART. A fallback answer still carries a valid (empty) document, so
 * rendering its blocks would show an empty radar frame while the reason — the one thing the
 * person needs — sat underneath. The fallback arm therefore draws the reason and stops.
 *
 * THE REASON IS MAPPED, NOT PRINTED. The server's reason codes are protocol, not sentences; a
 * table names the sentence for each, and an unknown code is shown with the code itself so a new
 * reason is readable without a client release.
 *
 * Consumers: `CockpitCardDetails.tsx` (the drawer's brief section).
 */

/** The server's fallback reason codes → their sentence keys. */
const BRIEF_REASON_KEYS: Readonly<Record<string, string>> = {
  disabled: 'cockpit.briefReasonDisabled',
  'gateway-unavailable': 'cockpit.briefReasonGatewayUnavailable',
  unconfigured: 'cockpit.briefReasonUnconfigured',
  'session-not-found': 'cockpit.briefReasonSessionNotFound',
  'transcript-unreadable': 'cockpit.briefReasonTranscriptUnreadable',
  'no-asking-message': 'cockpit.briefReasonNoAskingMessage',
  'daily-token-cap-reached': 'cockpit.briefReasonDailyTokenCap',
  'per-brief-token-cap-reached': 'cockpit.briefReasonPerBriefTokenCap',
  'model-call-failed': 'cockpit.briefReasonModelCallFailed',
  'check-failed-after-3-rounds': 'cockpit.briefReasonCheckFailed',
  'unsupported-content': 'cockpit.briefReasonUnsupportedContent',
};

/** The sentence for one fallback reason; an unmapped code is named rather than dropped. */
function reasonSentence(t: TFunction, reason: string | null): string {
  const key = reason === null ? undefined : BRIEF_REASON_KEYS[reason];
  if (key !== undefined) return t(key);
  return t('cockpit.briefReasonUnknown', { reason: reason ?? 'unknown' });
}

/**
 * Draws one generated brief: headline, the recommendation, then every block through the preset
 * table. An empty block list states that rather than drawing an empty section.
 */
function GeneratedBrief({ response }: { response: CockpitBriefResponse }) {
  const { t } = useTranslation();
  const optionLabels: Record<string, string> = {};
  for (const option of response.options) optionLabels[option.id] = option.label;
  const recommended =
    response.recommendation === null
      ? null
      : (optionLabels[response.recommendation.optionId] ?? response.recommendation.optionId);

  return (
    <div data-testid="cockpit-brief" data-brief-status="generated">
      {response.headline !== '' && (
        <p data-testid="cockpit-brief-headline" className="text-xs font-medium text-foreground">
          {response.headline}
        </p>
      )}
      {recommended !== null && (
        <p data-testid="cockpit-brief-recommended" className="mt-0.5 text-[11px] text-primary">
          {t('cockpit.briefRecommended', { label: recommended })}
        </p>
      )}
      {response.blocks.length === 0 ? (
        <p data-testid="cockpit-brief-empty" className="mt-1 text-[11px] text-muted-foreground">
          {t('cockpit.briefNoBlocks')}
        </p>
      ) : (
        response.blocks.map((block, index) => (
          <CockpitBriefBlockView
            key={`${block.id}:${index}`}
            block={block}
            context={{ t, optionLabels }}
          />
        ))
      )}
    </div>
  );
}

/** Draws one brief reading; `undefined`/`idle` means the drawer has not asked (nothing to draw). */
export default function CockpitBriefView({
  state,
  onRetry,
}: {
  state: CockpitBriefState | undefined;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();

  if (state === undefined || state.status === 'idle') return null;

  if (state.status === 'loading') {
    return (
      <p data-testid="cockpit-brief-loading" className="text-[11px] text-muted-foreground">
        {t('cockpit.briefLoading')}
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div data-testid="cockpit-brief-error" className="space-y-1">
        <p className="text-[11px] text-rose-700 dark:text-rose-300">
          {t('cockpit.briefError', { reason: state.message })}
        </p>
        {onRetry !== undefined && (
          <button
            type="button"
            data-testid="cockpit-brief-retry"
            onClick={onRetry}
            className="rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-accent"
          >
            {t('cockpit.briefRetry')}
          </button>
        )}
      </div>
    );
  }

  const { response } = state;
  if (response.status === 'fallback') {
    return (
      <div data-testid="cockpit-brief-fallback" data-brief-status="fallback" className="space-y-0.5">
        <p className="text-[11px] text-muted-foreground">{t('cockpit.briefUnavailable')}</p>
        <p data-testid="cockpit-brief-fallback-reason" className="text-[11px] text-foreground">
          {reasonSentence(t, response.reason)}
        </p>
      </div>
    );
  }

  return <GeneratedBrief response={response} />;
}
