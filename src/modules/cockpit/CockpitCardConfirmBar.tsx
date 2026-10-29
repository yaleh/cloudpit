import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/utils';
import type {
  CockpitCardConfirmOutcome,
  CockpitCardConfirmTarget,
  CockpitCardSendCountdown,
} from '@/modules/cockpit/cockpitCardController';

/**
 * The one confirm bar, used by the card's C zone and by `CockpitCardDetails`' persistent bottom
 * bar — the drawer repeats the card's action, so it must draw the same control, not a lookalike.
 *
 * WHY THIS IS ITS OWN FILE. `CockpitCard.tsx` sits just under the 800-line oversize floor and this
 * bar is a self-contained control; extracting it keeps the card's file about the card. Nothing
 * outside the cockpit module imports it, so the boundary rule still has one cross-module path.
 *
 * TWO GESTURES, ONE BUTTON, NO EXPLANATION ROWS. A reversible option's first press starts a five
 * second countdown drawn ON this button (label + fill) and the same button cancels it; an
 * irreversible option's first press turns the button into its send state and floats the warning
 * caption ABOVE it (`absolute bottom-full`), so neither flow moves the button between presses. The
 * idle state draws no hint row at all: the former 「press once, five seconds to cancel」 caption was
 * redundant with the button itself.
 *
 * The confirm state is declared on the bar (`data-confirm-pending` + `data-card-id`), which is the
 * reading the scenario surface joins — there is deliberately no confirm panel anywhere else.
 */
export type CockpitCardConfirmBarProps = {
  /** The bar container's testid; it carries `data-confirm-pending`/`data-card-id` for the reader. */
  barTestId: string;
  /** The action button's testid — the SAME element in the idle, countdown and confirm states. */
  testId: string;
  /** The card this bar confirms; published on the bar for the scenario surface's reading. */
  cardId: string;
  target: CockpitCardConfirmTarget;
  /**
   * True when the shown choice is the person's own reply rather than a listed option. The idle
   * label does not repeat the choice: the option trigger and the Details highlight already show
   * it, so both callers word their idle button through this one derivation.
   */
  showingOwnReply?: boolean;
  /** The compact density's bar: keeps the idle state to one line. */
  compact?: boolean;
  /** True when this card is the controller's irreversible pending confirmation. */
  pending?: boolean;
  /**
   * The running delayed send for this card, or `null`. Its deadline and start are read against
   * `now` (the controller's injected clock) — this component never runs a timer of its own.
   */
  countdown?: CockpitCardSendCountdown | null;
  /** True while THIS card's confirmation request is in flight; the button is then disabled. */
  confirming?: boolean;
  /** The controller's clock reading; the countdown's seconds and fill are derived from it. */
  now: number;
  /** The last answer for this card, drawn inside this bar; `null` when there is none. */
  outcome?: CockpitCardConfirmOutcome | null;
  /** Extra classes for the bar's own frame (the drawer's sticky bottom bar). */
  className?: string;
  onRequestConfirm: () => void;
  onConfirm?: () => void;
  onCancelConfirm?: () => void;
};

/**
 * The whole seconds left, rounded UP: the button says 「5 s」 the instant it is pressed and
 * 「1 s」 during the last second, never 「0 s」 while the send has not happened yet.
 */
export function countdownSecondsOf(countdown: CockpitCardSendCountdown, now: number): number {
  return Math.max(0, Math.ceil((countdown.firesAt - now) / 1000));
}

/** How much of the countdown has elapsed, clamped to 0…1; the fill's width. */
export function countdownProgressOf(countdown: CockpitCardSendCountdown, now: number): number {
  const span = countdown.firesAt - countdown.startedAt;
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, (now - countdown.startedAt) / span));
}

export function CockpitCardConfirmBar({
  barTestId,
  testId,
  cardId,
  target,
  showingOwnReply = false,
  compact = false,
  pending = false,
  countdown = null,
  confirming = false,
  now,
  outcome = null,
  className,
  onRequestConfirm,
  onConfirm,
  onCancelConfirm,
}: CockpitCardConfirmBarProps) {
  const { t } = useTranslation();
  const counting = countdown !== null;
  const irreversiblePending = pending && target.irreversible === true;
  // A countdown that expired (its deadline passed before the controller's next tick) still counts
  // as counting: the send is about to leave and the button must not flash back to its idle label.
  const mode = confirming ? 'send' : counting ? 'cancel' : pending ? 'send' : 'open';
  // The idle button never repeats the chosen option: the option trigger (card) and the highlighted
  // rows (Details) already carry it, so one short label serves both densities and both callers.
  // The one exception is an own reply that is still empty — there is nothing to send yet.
  const idleLabel =
    showingOwnReply && target.label === ''
      ? t('cockpit.cardConfirmNoOption')
      : t(showingOwnReply ? 'cockpit.cardConfirmOwnReply' : 'cockpit.cardConfirm');
  const label = confirming
    ? t('cockpit.cardConfirmSending')
    : counting
      ? t('cockpit.cardConfirmCountdown', { seconds: countdownSecondsOf(countdown, now) })
      : pending
        ? t('cockpit.cardConfirmSend')
        : idleLabel;
  const progress = counting ? countdownProgressOf(countdown, now) : 0;

  return (
    <div
      data-testid={barTestId}
      data-card-id={cardId}
      data-confirm-pending={pending || counting || confirming ? 'true' : 'false'}
      className={cn('relative', className)}
    >
      {/* The irreversible option's warning caption. It FLOATS above the button rather than
          entering the flow, so the second press lands on the pixel the first one did. Nothing is
          drawn for a reversible option: its whole state lives on the button's label and fill. */}
      {irreversiblePending && (
        <div className="absolute bottom-full left-0 right-0 z-10 flex h-5 items-center justify-between gap-2 bg-card text-[10px] leading-none text-muted-foreground">
          <span data-testid={`${testId}-message`} className="min-w-0 flex-1 truncate text-left">
            {t('cockpit.cardConfirmBody', { label: target.label })}
            <span data-testid={`${testId}-warning`} className="text-amber-700 dark:text-amber-300">
              {' '}⚠ {t('cockpit.cardConfirmIrreversible')}
            </span>
          </span>
          <button
            type="button"
            data-testid={`${testId}-cancel`}
            onClick={() => onCancelConfirm?.()}
            className="h-5 shrink-0 rounded px-1 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
          >
            {t('cockpit.cardConfirmCancel')}
          </button>
        </div>
      )}

      <button
        type="button"
        data-testid={testId}
        data-irreversible={target.irreversible === true ? 'true' : 'false'}
        data-confirm-mode={mode}
        data-confirm-seconds={counting ? countdownSecondsOf(countdown, now) : undefined}
        disabled={target.disabled || confirming}
        onClick={
          confirming
            ? undefined
            : counting
              ? () => onCancelConfirm?.()
              : pending
                ? () => onConfirm?.()
                : onRequestConfirm
        }
        className={cn(
          'relative flex items-center justify-center gap-1 overflow-hidden rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50',
          compact ? 'w-auto' : 'w-full',
          target.irreversible === true
            ? 'border border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-200'
            : counting
              ? 'border border-border bg-background text-foreground hover:bg-accent'
              : // The idle button carries an invisible border too: the countdown state swaps it
                // for a visible one, and a border that appears between the two presses would move
                // the button by its own width. Same box, only the colours change.
                'border border-transparent bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
        )}
      >
        {/* The five-second fill: it grows left-to-right under the label, which is the only
            progress the countdown needs (the seconds in the label are the exact reading). */}
        {counting && (
          <span
            aria-hidden
            data-testid={`${testId}-progress`}
            data-progress={progress.toFixed(3)}
            className="absolute inset-y-0 left-0 bg-primary/20"
            style={{ width: `${Math.round(progress * 1000) / 10}%` }}
          />
        )}
        {target.irreversible === true && <span aria-hidden>⚠</span>}
        <span className="relative truncate">{label}</span>
      </button>

      {outcome !== null && (
        <p
          role={outcome.ok ? 'status' : 'alert'}
          data-testid={`${testId}-outcome`}
          data-ok={outcome.ok ? 'true' : 'false'}
          className={cn(
            'mt-1 text-[10px]',
            outcome.ok ? 'text-muted-foreground' : 'text-destructive',
          )}
        >
          {outcome.ok
            ? t('cockpit.cardConfirmSent')
            : t('cockpit.cardConfirmFailed', { reason: outcome.message })}
        </p>
      )}

      {target.disabled && target.disabledReason !== null && (
        <p
          data-testid={`${testId}-disabled-reason`}
          className="mt-0.5 text-[10px] text-muted-foreground"
        >
          {target.disabledReason}
        </p>
      )}
    </div>
  );
}
