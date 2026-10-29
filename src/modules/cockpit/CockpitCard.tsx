import { useTranslation } from 'react-i18next';

import type { CockpitCard as CockpitCardData } from '@/shared/types';
import { cn } from '@/shared/utils';
import { CockpitCardConfirmBar } from '@/modules/cockpit/CockpitCardConfirmBar';
import CockpitCardFacts from '@/modules/cockpit/CockpitCardFacts';
import CockpitCardHeader from '@/modules/cockpit/CockpitCardHeader';
import CockpitCardOptions from '@/modules/cockpit/CockpitCardOptions';
import {
  canResendFeedback,
  feedbackOptionGone,
  feedbackPhaseOf,
} from '@/modules/cockpit/cockpitCardFeedback';
import {
  COCKPIT_SOURCE_LABEL_KEY,
  cockpitCardAge,
  cockpitCardDescriptor,
  cockpitCardFactsBeyondSituation,
  cockpitCardSubjectName,
  cockpitCardTitle,
} from '@/modules/cockpit/cockpitCardDescriptors';
import CockpitCardSituation from '@/modules/cockpit/CockpitCardSituation';
import type {
  CockpitCardConfirmOutcome,
  CockpitCardConfirmTarget,
  CockpitCardDensity,
  CockpitCardDismissTarget,
  CockpitCardDuplicatesState,
  CockpitCardSendCountdown,
  CockpitCardShown,
} from '@/modules/cockpit/cockpitCardController';
import { shownOptionOf } from '@/modules/cockpit/cockpitCardController';

/**
 * One cockpit card, drawn as the three touch zones the design names:
 *
 *   A — header, question, situation, facts, viz: a tap opens the Details drawer. There is no
 *       separate Details button, because the whole upper body IS the affordance (the `›` is the
 *       hint).
 *   B — the option dropdown: the trigger names the currently shown option, its source and
 *       `k of n`; the open list explains every option in rich text and ends with the person's own
 *       reply editor.
 *   C — the one confirm bar: its label carries the shown option's name and it only opens the
 *       confirm card. Nothing is sent from here.
 *
 * THE HEADER IS THE CARD'S ANATOMY (INTERACTION-PRINCIPLES F.18): the coloured kind mark, the
 * project, the subject's name, its age, the three-cell load reading and the `›`. Every one of
 * those is data the provider stated; a field the card does not carry is simply not drawn, and the
 * component never branches on the provider or on the kind beyond the descriptor table.
 *
 * The component is presentational: every reading and every command comes from
 * `createCockpitCardController`, so "switching the shown option switches the confirm target" is
 * a property of the state, not of this file's event wiring.
 */

// The Details drawer draws the same own-reply editor and imports it from this file; the editor
// itself now lives with the options block that draws it on the card.
export { OwnReplyEditor } from '@/modules/cockpit/CockpitCardOptions';

export type CockpitCardProps = {
  card: CockpitCardData;
  /** The controller's clock reading, for the waiting duration. */
  now: number;
  /** The option (or own reply) the card currently shows; `undefined` means the controller has no reading. */
  shown: CockpitCardShown | undefined;
  /** The current confirm target derived from `shown`; `null` when the card has nothing to confirm. */
  target: CockpitCardConfirmTarget | null;
  /**
   * The card-level 「忽略/丢弃」 target, offered BESIDE the shown option's confirm target on a
   * session-ask card. Absent/null means this card does not offer the third action.
   */
  dismissTarget?: CockpitCardDismissTarget | null;
  /** True when this card's dismiss confirmation is open (the first press has happened). */
  dismissPending?: boolean;
  /** True while this card's dismiss request is in flight. */
  dismissing?: boolean;
  ownReply: string;
  dropdownOpen: boolean;
  selected: boolean;
  density: CockpitCardDensity;
  /**
   * True when this card's over-long situation is expanded past the six-line preview. The
   * controller owns the state; the card only draws it, so a re-read's reset is one rule.
   */
  situationExpanded?: boolean;
  /** Toggles that expansion (the inline control); absent means the card draws no control. */
  onToggleSituationExpanded?: () => void;
  /**
   * The earlier cards folded behind THIS one (the kept card), or `null`/absent when nothing was
   * folded. The card states how many times the question was asked and offers the in-place
   * expansion; the folded cards themselves are drawn by the list at their original positions.
   */
  duplicates?: CockpitCardDuplicatesState | null;
  /**
   * True when the folded cards carry no question at all (a session's unanswered asks), so the
   * strip speaks about the session's count instead of naming a question.
   */
  duplicatesQuestionless?: boolean;
  /** Expands or collapses the folded cards; absent means the strip states the count only. */
  onToggleDuplicates?: () => void;
  onSelect: () => void;
  onOpenDetails: () => void;
  onToggleDropdown: () => void;
  onShowOption: (optionId: string) => void;
  onShowOwnReply: () => void;
  onOwnReplyChange: (text: string) => void;
  /** The first press: opens the in-place confirm state on this card's own bar. */
  onRequestConfirm: () => void;
  /** True when THIS card's confirmation is pending — the bar draws the confirm state. */
  confirmPending?: boolean;
  /** This card's running delayed send, or `null`; its seconds are read against `now`. */
  sendCountdown?: CockpitCardSendCountdown | null;
  /** True while that confirmation's request is in flight. */
  confirming?: boolean;
  /** The last confirmation answer for THIS card, drawn in its own bar. */
  outcome?: CockpitCardConfirmOutcome | null;
  /** The second press: sends the pending confirmation from the same button. */
  onConfirm?: () => void;
  /** Leaves the confirm state without sending. */
  onCancelConfirm?: () => void;
  /** The first press on 「忽略/丢弃」: opens the dismiss confirmation, sending nothing. */
  onRequestDismiss?: () => void;
  /** The dismiss confirmation's second press: discards the card without replying to it. */
  onConfirmDismiss?: () => void;
  /** Leaves the dismiss confirmation without sending. */
  onCancelDismiss?: () => void;
  /** Re-sends only the feedback after the 2-minute window (never the action). */
  onResendFeedback?: () => void;
  /** True while this card's feedback resend is in flight. */
  resendingFeedback?: boolean;
  /** The last failed resend for this card, drawn in its status block. */
  feedbackResendError?: string | null;
};

export default function CockpitCard({
  card,
  now,
  shown,
  target,
  dismissTarget = null,
  dismissPending = false,
  dismissing = false,
  ownReply,
  dropdownOpen,
  selected,
  density,
  situationExpanded = false,
  onToggleSituationExpanded,
  duplicates = null,
  duplicatesQuestionless = false,
  onToggleDuplicates,
  onSelect,
  onOpenDetails,
  onToggleDropdown,
  onShowOption,
  onShowOwnReply,
  onOwnReplyChange,
  onRequestConfirm,
  confirmPending = false,
  sendCountdown = null,
  confirming = false,
  outcome = null,
  onConfirm,
  onCancelConfirm,
  onRequestDismiss,
  onConfirmDismiss,
  onCancelDismiss,
  onResendFeedback,
  resendingFeedback = false,
  feedbackResendError = null,
}: CockpitCardProps) {
  const { t } = useTranslation();
  const descriptor = cockpitCardDescriptor(card.kind);
  const shownOption = shownOptionOf(card, shown);
  const showingOwnReply = shown?.kind === 'ownReply';
  const compact = density === 'compact';
  const situation = card.situation !== card.ask ? card.situation ?? null : null;
  const ownReplyAvailable = card.ownReply !== undefined;
  /**
   * A card whose own ask has no summary yet: the reason is stated and NO options exist.
   *
   * The dropdown and the confirm bar are hidden for this card. With `options === []` the trigger
   * could only say 「Choose an option」 over an empty list, and the confirm bar's empty state
   * would promise 「Choose an option, then confirm」 for a choice the card does not have — the
   * exact unreadable confirmation surface this reading exists to remove. What remains is what the
   * card can honestly offer: the fallback question (zone A), the one-line reason (the situation
   * line), the conversation it belongs to, and the person's own reply.
   */
  const emptyAskContent = card.contentUnavailable !== undefined && card.options.length === 0;
  /** The conversation the empty card belongs to, read like the Details drawer reads it. */
  const conversationSessionId =
    (card.conversation?.sessionId ?? card.subject.sessionId ?? '').trim();
  // A fact already stated by the situation is not drawn twice; Details still lists every fact.
  const facts = cockpitCardFactsBeyondSituation(card);
  const question = cockpitCardTitle(card, t);
  const subjectName = cockpitCardSubjectName(card);
  const project = card.subject.project?.trim() ?? '';
  // The header draws the provider's weight; the accessible label is formatted here so the
  // presentational block receives one already-resolved reading.
  const loadLabel =
    card.load === undefined
      ? ''
      : t('cockpit.cardLoadLabel', { n: Math.min(3, Math.max(0, Math.floor(card.load))) });

  const shownLabel = showingOwnReply
    ? t('cockpit.cardWriteOwn')
    : (shownOption?.label ?? t('cockpit.cardChooseOption'));
  const shownSource =
    shownOption === null ? null : t(COCKPIT_SOURCE_LABEL_KEY[shownOption.source] ?? 'cockpit.cardSourceProvider');
  const shownPosition =
    shownOption === null
      ? null
      : t('cockpit.cardOptionPosition', {
          k: card.options.findIndex((option) => option.id === shownOption.id) + 1,
          n: card.options.length,
        });
  // The feedback lifecycle: while an overlay exists the card keeps its place (dimmed), its
  // options and confirm bar are locked, and the only live control is the resend after 2 minutes.
  const feedback = card.feedback;
  const feedbackPhase = feedback === undefined ? null : feedbackPhaseOf(feedback, now);
  const feedbackLocked = feedback !== undefined;
  const feedbackResendable = feedback !== undefined && canResendFeedback(card, now);
  const feedbackFailed = feedback?.lastError !== undefined;
  // The option the receipt names is the one from the moment of the choice; a recomputed summary
  // may have dropped it. The sent line then says so — the old label is HISTORY, never the card's
  // current selection — and the resend is refused with its own reason.
  const feedbackOptionMissing = feedbackOptionGone(card);
  const feedbackLabel =
    feedback === undefined
      ? ''
      : feedbackOptionMissing
        ? `${feedback.label}${t('cockpit.cardFeedbackOptionGone')}`
        : feedback.label;
  // The right side of the sent line: a card whose outcome names a conversation draws the short
  // 「打开会话 ›」 label; otherwise it keeps the pre-existing delivery/accepted reading.
  const feedbackOutcomeLine =
    feedback?.outcome.deliveryId !== undefined
      ? t('cockpit.cardFeedbackOutcomeDelivery')
      : t('cockpit.cardFeedbackOutcomeAccepted');

  return (
    <article
      data-testid={`cockpit-card-${card.id}`}
      data-cockpit-card-id={card.id}
      data-card-kind={card.kind}
      data-selected={selected ? 'true' : 'false'}
      data-feedback-phase={feedbackPhase ?? undefined}
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-sm',
        // A sent card keeps its place and stays fully readable: only its controls are locked, so
        // the whole card must not be dimmed (the status row states the lifecycle instead).
        selected ? 'border-primary/60 ring-1 ring-primary/30' : 'border-border',
        compact ? 'px-3 py-2' : 'px-3 py-2.5',
      )}
      onFocus={onSelect}
      onPointerDown={onSelect}
    >
      {/*
        THE FOLDED DUPLICATES ARE STATED ON THE KEPT CARD, not in a second list. The provider's
        dedup key is the message id, so asking one question twice draws two identical cards; the
        kept one says how many times it was asked and offers the earlier cards in place. The
        folded cards themselves are rendered by the list (at their original positions) once this
        control expands them, so this strip never doubles as a second reading of their content.
      */}
      {duplicates !== null && duplicates.hiddenIds.length > 0 && (
        <div
          data-testid="cockpit-card-duplicates"
          data-count={duplicates.hiddenIds.length + 1}
          data-expanded={duplicates.expanded ? 'true' : 'false'}
          className="mb-1.5 flex items-center justify-between gap-2 rounded border border-dashed border-border bg-muted/50 px-1.5 py-1 text-[11px] text-muted-foreground"
        >
          <span className="min-w-0 truncate">
            <span aria-hidden>⧉ </span>
            {duplicatesQuestionless
              ? t('cockpit.cardDuplicatesSession', { n: duplicates.hiddenIds.length + 1 })
              : duplicates.expanded
                ? t('cockpit.cardDuplicatesExpanded', {
                    n: duplicates.hiddenIds.length + 1,
                    hidden: duplicates.hiddenIds.length,
                  })
                : t('cockpit.cardDuplicates', {
                    n: duplicates.hiddenIds.length + 1,
                    hidden: duplicates.hiddenIds.length,
                  })}
          </span>
          {onToggleDuplicates !== undefined && (
            <button
              type="button"
              data-testid="cockpit-card-duplicates-toggle"
              data-expanded={duplicates.expanded ? 'true' : 'false'}
              onClick={onToggleDuplicates}
              className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-foreground hover:bg-accent"
            >
              {duplicates.expanded
                ? t('cockpit.cardDuplicatesCollapse')
                : t('cockpit.cardDuplicatesExpand')}
            </button>
          )}
        </div>
      )}

      {/* A zone: the whole upper body opens Details. No independent Details/Alternatives button. */}
      <div
        role="button"
        tabIndex={0}
        data-testid="cockpit-card-zone-a"
        onClick={onOpenDetails}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpenDetails();
          }
        }}
        className="block w-full rounded-md text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {/* The header row: kind mark · project · subject name · age · load · ›. */}
        <CockpitCardHeader
          kind={card.kind}
          descriptor={descriptor}
          project={project}
          subjectName={subjectName}
          age={cockpitCardAge(t, now, card.waitingSince)}
          load={card.load}
          loadLabel={loadLabel}
        />

        <p
          data-testid="cockpit-card-zone-a-question"
          className={cn('mt-1 text-sm font-medium text-foreground', compact && 'line-clamp-2')}
        >
          {question}
        </p>

        {/* The situation is the card's decision evidence, so Cards draws all of it (with an
            in-place expand control for one that runs long); Compact keeps its one-line shape. */}
        <CockpitCardSituation
          situation={situation}
          contentUnavailable={card.contentUnavailable}
          compact={compact}
          expanded={situationExpanded}
          onToggleExpanded={onToggleSituationExpanded}
        />

        {/* Facts as pills (● mechanical / ○ judgement) with the small viz on the right. A pill is
            a SHORT FORM: the sentence it abbreviates stays in `title` and, untruncated, in Details;
            a fact the situation already states is not repeated here at all. Compact mode keeps the
            card to three lines, so it draws neither. */}
        {!compact && (facts.length > 0 || card.viz !== undefined) && (
          <CockpitCardFacts card={card} facts={facts} />
        )}
      </div>

      <div
        data-testid="cockpit-card-controls"
        className={cn(compact ? 'mt-1.5 flex items-start gap-2' : 'mt-2 space-y-2')}
      >
        {/* B zone: one dropdown whose last item is the person's own reply. A card with no
            resolved options draws neither the dropdown nor its trigger; see `emptyAskContent`. */}
        <CockpitCardOptions
          card={card}
          compact={compact}
          dropdownOpen={dropdownOpen}
          feedbackLocked={feedbackLocked}
          emptyAskContent={emptyAskContent}
          conversationSessionId={conversationSessionId}
          ownReply={ownReply}
          ownReplyAvailable={ownReplyAvailable}
          shownOption={shownOption}
          showingOwnReply={showingOwnReply}
          shownLabel={shownLabel}
          shownSource={shownSource}
          shownPosition={shownPosition}
          onToggleDropdown={onToggleDropdown}
          onShowOption={onShowOption}
          onShowOwnReply={onShowOwnReply}
          onOwnReplyChange={onOwnReplyChange}
        />

        {/* C zone: one confirm bar, bound to the shown option. Its first press turns the SAME
            button into 「确认发送」 in place (see `CockpitCardConfirmBar`); nothing is drawn in a
            dialog. With no recommendation there is nothing to bind, so the card draws one quiet
            line instead of a full-width button that looks pressable and does nothing. */}
        <div className={cn(compact ? 'shrink-0' : '')}>
          {/* A kept/rejected receipt returned the card to the person; the notice says which and
              (for a refusal) why, while the ordinary options and confirm bar are live again. */}
          {card.feedbackNotice !== undefined && (
            <p
              data-testid="cockpit-card-feedback-notice"
              data-kind={card.feedbackNotice.kind}
              className={cn(
                'mb-1 text-[10px]',
                card.feedbackNotice.kind === 'rejected'
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {card.feedbackNotice.kind === 'kept'
                ? t('cockpit.cardFeedbackKept')
                : t('cockpit.cardFeedbackRejected', {
                    reason: card.feedbackNotice.reason ?? '',
                  })}
            </p>
          )}
          {/* THE SENT STATE IS ONE LINE. A sent card already ran its action, so the confirm bar is
              not drawn at all: the only live control is 「重发」 after the two-minute window, and it
              lives in the status row's second line. The first line carries the dot, 「已发出」, the
              chosen option and ONE phase suffix — waiting (neutral) or 「2 分钟无回执」. Amber is
              reserved for a REAL failure: when the feedback call itself threw, `lastError` says why
              and the row turns amber; ordinary waiting never does. */}
          {feedback !== undefined && (
            <div
              data-testid="cockpit-card-feedback-status"
              data-phase={feedbackPhase ?? undefined}
              data-last-error={feedbackFailed ? 'true' : 'false'}
              className={cn(
                'mb-1 text-[11px]',
                feedbackFailed
                  ? 'rounded-md border border-amber-500/60 bg-amber-500/10 px-2 py-1.5 text-amber-800 dark:text-amber-200'
                  : 'text-muted-foreground',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p data-testid="cockpit-card-feedback-sent" className="flex min-w-0 items-center gap-1">
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span className="truncate">
                    {t(
                      feedbackPhase === 'unconfirmed'
                        ? 'cockpit.cardFeedbackUnconfirmed'
                        : 'cockpit.cardFeedbackSent',
                      { label: feedbackLabel },
                    )}
                  </span>
                </p>
                <span
                  data-testid="cockpit-card-feedback-outcome"
                  className="shrink-0 text-primary"
                >
                  {feedback.outcome.sessionId === undefined
                    ? feedbackOutcomeLine
                    : t('cockpit.cardFeedbackOpenConversation')}
                </span>
              </div>
              {feedbackFailed && (
                <p data-testid="cockpit-card-feedback-error" className="mt-0.5 text-[10px]">
                  {feedback.lastError}
                </p>
              )}
              {feedbackPhase === 'unconfirmed' && (
                <>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p
                      data-testid="cockpit-card-feedback-resend-hint"
                      className="min-w-0 text-[10px] opacity-80"
                    >
                      {t('cockpit.cardFeedbackResendHint')}
                    </p>
                    <button
                      type="button"
                      data-testid="cockpit-card-feedback-resend"
                      data-resendable={feedbackResendable ? 'true' : 'false'}
                      disabled={!feedbackResendable || resendingFeedback}
                      onClick={onResendFeedback}
                      className="shrink-0 rounded border border-current px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
                    >
                      {resendingFeedback
                        ? t('cockpit.cardFeedbackResending')
                        : t('cockpit.cardFeedbackResend')}
                    </button>
                  </div>
                  {feedbackOptionMissing ? (
                    <p data-testid="cockpit-card-feedback-resend-unavailable" className="mt-1">
                      {t('cockpit.cardFeedbackResendUnavailable', {
                        reason: t('cockpit.cardFeedbackOptionGoneReason'),
                      })}
                    </p>
                  ) : (
                    !feedback.canResend &&
                    feedback.resendUnavailableReason !== undefined && (
                      <p data-testid="cockpit-card-feedback-resend-unavailable" className="mt-1">
                        {t('cockpit.cardFeedbackResendUnavailable', {
                          reason: feedback.resendUnavailableReason,
                        })}
                      </p>
                    )
                  )}
                </>
              )}
              {feedbackResendError !== null && (
                <p
                  role="alert"
                  data-testid="cockpit-card-feedback-resend-error"
                  className="mt-1 text-destructive"
                >
                  {feedbackResendError}
                </p>
              )}
            </div>
          )}
          {/* The confirm control belongs to a card that can still act. A sent card's action
              already ran, so drawing a full-width disabled bar would put a dead control where the
              live 「重发」 belongs. An ask whose content is unreadable draws no empty prompt either. */}
          {!feedbackLocked && (target === null ? (
            !emptyAskContent && (
              <p
                data-testid="cockpit-card-confirm-empty"
                className={cn(
                  'text-[11px] text-muted-foreground',
                  compact ? 'w-20 self-center text-center leading-tight' : 'rounded-md border border-dashed border-border px-2 py-2 text-center',
                )}
              >
                {t('cockpit.cardChooseThenConfirm')}
              </p>
            )
          ) : (
            <>
              <CockpitCardConfirmBar
                barTestId="cockpit-card-confirm-bar"
                testId="cockpit-card-confirm"
                cardId={card.id}
                target={target}
                showingOwnReply={showingOwnReply}
                compact={compact}
                pending={confirmPending}
                countdown={sendCountdown}
                confirming={confirming}
                now={now}
                outcome={outcome}
                className={compact ? 'max-w-[12rem]' : undefined}
                onRequestConfirm={onRequestConfirm}
                onConfirm={onConfirm}
                onCancelConfirm={onCancelConfirm}
              />
              {target.irreversible === true && (
                <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                  {t('cockpit.cardIrreversible')}
                </p>
              )}
            </>
          ))}
          {/* The third choice on a session-ask card: discard the card WITHOUT answering it. It
              sits beside the option's confirm bar, never inside it, so opening the dismiss
              confirmation leaves the shown option and its buttons exactly as they were. The
              first press only opens that confirmation; nothing is sent from here. */}
          {!feedbackLocked && dismissTarget !== null && (
            <div
              data-testid="cockpit-card-dismiss-bar"
              data-card-id={card.id}
              data-dismiss-pending={dismissPending ? 'true' : 'false'}
              className="mt-1"
            >
              {dismissPending ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    data-testid="cockpit-card-dismiss-confirm"
                    disabled={dismissing}
                    onClick={onConfirmDismiss}
                    className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {dismissing ? t('cockpit.cardDismissing') : t('cockpit.cardDismissConfirm')}
                  </button>
                  <button
                    type="button"
                    data-testid="cockpit-card-dismiss-cancel"
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
                  data-testid="cockpit-card-dismiss"
                  onClick={onRequestDismiss}
                  className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {t('cockpit.cardDismiss')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
