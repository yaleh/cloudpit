import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';

/**
 * The card-level 「忽略/丢弃」 control, drawn identically by the card row and by the Details
 * drawer so one card never offers two different discard controls.
 *
 * Used by the cockpit cards list (`CockpitCard`) and the Details drawer (`CockpitCardDetails`):
 * both read the SAME controller state (`dismissTarget` / `pendingDismiss` / `dismissingCardId`),
 * so opening the confirmation in one place draws it in the other, and a request refuses a second
 * one whichever surface pressed it.
 *
 * It is presentational: the first press opens the in-place confirmation, the second sends, and
 * cancel closes it — the controller owns every rule. The bar only exists on a card that offers a
 * dismiss target; a card with no target draws nothing here.
 */

export type CockpitCardDismissBarProps = {
  /** The card this bar acts on; published so a scenario joins the bar to its card. */
  cardId: string;
  /** The bar's own root hook, e.g. `cockpit-card-dismiss-bar` on the card row. */
  barTestId: string;
  /**
   * Test-id prefix for the three buttons: the trigger is this id, its confirmation appends
   * `-confirm` and its cancel `-cancel`.
   */
  testId: string;
  /** True when this card's dismiss confirmation is open (the first press has happened). */
  pending: boolean;
  /** True while this card's dismiss request is in flight; both buttons are disabled. */
  dismissing: boolean;
  /** The first press: opens the dismiss confirmation, sending nothing. */
  onRequestDismiss?: () => void;
  /** The confirmation's second press: discards the card without replying to it. */
  onConfirmDismiss?: () => void;
  /** Leaves the dismiss confirmation without sending. */
  onCancelDismiss?: () => void;
  /** Layout from the host (the card row adds its own top margin; the drawer's footer stacks). */
  className?: string;
};

export function CockpitCardDismissBar({
  cardId,
  barTestId,
  testId,
  pending,
  dismissing,
  onRequestDismiss,
  onConfirmDismiss,
  onCancelDismiss,
  className,
}: CockpitCardDismissBarProps) {
  const { t } = useTranslation();
  return (
    <div
      data-testid={barTestId}
      data-card-id={cardId}
      data-dismiss-pending={pending ? 'true' : 'false'}
      className={cn('mt-1', className)}
    >
      {pending ? (
        <div className="flex items-center gap-1">
          {/* A SIBLING of the option's confirm bar, never inside it: opening the dismiss
              confirmation leaves the shown option and its buttons exactly as they were, and
              pressing the confirm here never sends the option. */}
          <button
            type="button"
            data-testid={`${testId}-confirm`}
            disabled={dismissing}
            onClick={onConfirmDismiss}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
          >
            {dismissing ? t('cockpit.cardDismissing') : t('cockpit.cardDismissConfirm')}
          </button>
          <button
            type="button"
            data-testid={`${testId}-cancel`}
            disabled={dismissing}
            onClick={onCancelDismiss}
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t('cockpit.cardConfirmCancel')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid={testId}
          onClick={onRequestDismiss}
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {t('cockpit.cardDismiss')}
        </button>
      )}
    </div>
  );
}
