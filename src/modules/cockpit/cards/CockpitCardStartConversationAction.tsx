import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type {
  CockpitStartConversationError,
  CockpitStartConversationSnapshot,
} from '@/modules/cockpit/cards/cockpitCardStartConversation';

/** What the drawer's start control reads: the attempt's state, its failure, and its one command. */
export type CockpitStartConversationView = {
  status: CockpitStartConversationSnapshot['status'];
  error: CockpitStartConversationError | null;
  onStart: () => void;
};

function errorText(t: TFunction, error: CockpitStartConversationError): string {
  switch (error.kind) {
    case 'no-project':
      return t('cockpit.cardStartConversationNoProject');
    case 'unregistered':
      return t('cockpit.cardStartConversationUnregistered', { project: error.project });
    case 'failed':
      return t('cockpit.cardStartConversationFailed', { reason: error.reason });
  }
}

/**
 * 「就此开一个会话」: the Details drawer's real action — it asks the controller to allocate an
 * empty session in the card's project and open it.
 *
 * Used by `CockpitCardDetails` (the phone drawer, the page's floating drawer and the PC column's
 * pushed Details all draw this one control) so the three surfaces cannot drift: the same pending
 * lock, the same visible error, and the same retry are drawn everywhere.
 *
 * The button is the retry: a failed attempt leaves the error above it and the same control
 * pressable again — a second control beside it would be two ways to say one thing.
 */
export function CockpitCardStartConversation({ view }: { view: CockpitStartConversationView }) {
  const { t } = useTranslation();
  const starting = view.status === 'starting';
  const failed = view.status === 'failed';
  return (
    <div data-testid="cockpit-card-start-conversation-action" data-status={view.status}>
      <button
        type="button"
        data-testid="cockpit-card-start-conversation"
        disabled={starting}
        aria-busy={starting}
        onClick={() => view.onStart()}
        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:cursor-default disabled:opacity-60"
      >
        {starting
          ? t('cockpit.cardStartConversationStarting')
          : failed
            ? t('cockpit.retry')
            : t('cockpit.cardDetailsStartConversation')}
      </button>
      {view.error !== null && (
        <p
          role="alert"
          data-testid="cockpit-card-start-conversation-error"
          data-error-kind={view.error.kind}
          className="mt-1 text-xs text-destructive"
        >
          {errorText(t, view.error)}
        </p>
      )}
    </div>
  );
}
