import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { CockpitCard as CockpitCardData, CockpitCardOption } from '@/shared/types';
import { cn } from '@/shared/utils';
import { CockpitCardConfirmBar } from '@/modules/cockpit/CockpitCardConfirmBar';
import {
  canResendFeedback,
  feedbackOptionGone,
  feedbackPhaseOf,
} from '@/modules/cockpit/cockpitCardFeedback';
import {
  COCKPIT_SOURCE_LABEL_KEY,
  cockpitCardDescriptor,
  cockpitCardFactsBeyondSituation,
  cockpitCardSubjectName,
  cockpitCardTitle,
  cockpitCardToneClass,
  cockpitFactShortForm,
  cockpitTagIcon,
} from '@/modules/cockpit/cockpitCardDescriptors';
import CockpitCardSituation from '@/modules/cockpit/CockpitCardSituation';
import CockpitCardViz from '@/modules/cockpit/CockpitCardViz';
import type {
  CockpitCardConfirmOutcome,
  CockpitCardConfirmTarget,
  CockpitCardDensity,
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

/** `9h` / `18m` / `3d` — the header's compact age, read through the cockpit's own copy. */
function ageText(t: TFunction, now: number, waitingSince: string): string {
  const since = Date.parse(waitingSince);
  const milliseconds = Number.isNaN(since) ? 0 : Math.max(0, now - since);
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return t('cockpit.cardAgeNow');
  if (minutes < 60) return t('cockpit.cardAgeMinutes', { n: minutes });
  const hours = minutes / 60;
  if (hours < 24) {
    const rounded = Math.round(hours * 10) / 10;
    return t('cockpit.cardAgeHours', {
      n: Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1),
    });
  }
  return t('cockpit.cardAgeDays', { n: Math.floor(hours / 24) });
}

/**
 * The three-cell decision-weight reading. Only the provider's own `load` fills it; the reading is
 * a count of filled cells out of three, and `0` draws three empty cells because the provider DID
 * state a weight (absence is the only "draw nothing").
 */
function LoadCells({ level, label }: { level: number; label: string }) {
  const filled = Math.min(3, Math.max(0, Math.floor(level)));
  return (
    <span
      data-testid="cockpit-card-load"
      data-load={filled}
      aria-label={label}
      className="flex shrink-0 items-center gap-[3px]"
    >
      {[1, 2, 3].map((cell) => (
        <span
          key={cell}
          data-load-cell={cell}
          data-filled={cell <= filled ? 'true' : 'false'}
          aria-hidden
          className={cn(
            'h-2.5 w-[3px] rounded-sm',
            cell <= filled ? 'bg-foreground' : 'bg-muted-foreground/25',
          )}
        />
      ))}
    </span>
  );
}

/** The consequence tags of one option: the descriptor's glyph plus the provider's words. */
function OptionTags({ option }: { option: CockpitCardOption }) {
  const tags = option.tags ?? [];
  if (tags.length === 0) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span
          key={`${tag.kind}:${tag.text}`}
          data-tag-kind={tag.kind}
          className={cn(
            'rounded-full px-1.5 py-0.5 text-[11px]',
            cockpitTagIcon(tag.kind) === '⚠'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {cockpitTagIcon(tag.kind) !== null && (
            <span aria-hidden>{cockpitTagIcon(tag.kind)} </span>
          )}
          {tag.text}
        </span>
      ))}
    </span>
  );
}

/** The full explanation of the option a card currently shows, outside the open dropdown. */
function ShownOptionExplanation({ option }: { option: CockpitCardOption }) {
  return (
    <div
      data-testid="cockpit-card-shown-option"
      data-source={option.source}
      data-suggested={option.suggested ? 'true' : 'false'}
      className="border-t border-border bg-muted/50 px-2 py-1.5"
    >
      <p className="text-xs text-foreground">{option.does}</p>
      {option.why !== undefined && (
        <p data-testid="cockpit-card-shown-option-why" className="mt-1 text-[11px] text-muted-foreground">
          {option.why}
        </p>
      )}
      {option.warn !== undefined && (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{option.warn}</p>
      )}
      <OptionTags option={option} />
      {option.undo !== undefined && (
        <p className="mt-1 text-[11px] text-muted-foreground">{option.undo}</p>
      )}
      {option.when !== undefined && (
        <p className="mt-1 text-[11px] text-muted-foreground">{option.when}</p>
      )}
    </div>
  );
}

/**
 * The own-reply editor: the last item of the dropdown, the card body's form when shown, and the
 * Details drawer's last option row.
 *
 * ONE HEADING PER EDITOR. The dropdown's last item already heads the reply with 「Write your
 * own」 and its radio circle, so the editor inside it draws `ariaLabel` only; the card body, which
 * has no such heading, draws the visible `label`. Either way the textarea's accessible name is the
 * same string. Consumers: `CockpitCard` (the dropdown and the body form) and `CockpitCardDetails`
 * (the drawer's own-reply row).
 */
export function OwnReplyEditor({
  value,
  onChange,
  placeholder,
  label,
  ariaLabel,
  testId = 'cockpit-card-own-reply-input',
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  /** The visible heading; omitted where a sibling already heads the reply. */
  label?: string;
  ariaLabel: string;
  /** The reading hook. The drawer names its own copy so both editors can coexist on the page. */
  testId?: string;
}) {
  return (
    <div className="mt-1.5">
      <label className="block">
        {label !== undefined && (
          <span className="text-[11px] font-medium text-foreground">{label}</span>
        )}
        <textarea
          data-testid={testId}
          aria-label={ariaLabel}
          value={value}
          placeholder={placeholder}
          rows={2}
          onChange={(event) => onChange(event.target.value)}
          className="mt-1 w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </label>
    </div>
  );
}

export type CockpitCardProps = {
  card: CockpitCardData;
  /** The controller's clock reading, for the waiting duration. */
  now: number;
  /** The option (or own reply) the card currently shows; `undefined` means the controller has no reading. */
  shown: CockpitCardShown | undefined;
  /** The current confirm target derived from `shown`; `null` when the card has nothing to confirm. */
  target: CockpitCardConfirmTarget | null;
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
  ownReply,
  dropdownOpen,
  selected,
  density,
  situationExpanded = false,
  onToggleSituationExpanded,
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
        <div
          data-testid="cockpit-card-zone-a-header"
          className="flex items-center gap-1.5"
        >
          <span
            data-testid="cockpit-card-kind-badge"
            data-kind={card.kind}
            data-tone={descriptor.tone}
            title={t(descriptor.labelKey)}
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
              cockpitCardToneClass(descriptor.tone),
            )}
          >
            {t(descriptor.badgeKey)}
          </span>
          {project !== '' && (
            <span
              data-testid="cockpit-card-project"
              className="shrink-0 text-[12px] font-medium text-foreground"
            >
              {project}
            </span>
          )}
          {subjectName !== null && (
            <span
              data-testid="cockpit-card-subject"
              className="min-w-0 truncate text-[12px] text-muted-foreground"
            >
              <span aria-hidden>· </span>
              {subjectName}
            </span>
          )}
          <span
            data-testid="cockpit-card-age"
            className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground"
          >
            {ageText(t, now, card.waitingSince)}
          </span>
          {card.load !== undefined && (
            <LoadCells
              level={card.load}
              label={t('cockpit.cardLoadLabel', { n: Math.min(3, Math.max(0, Math.floor(card.load))) })}
            />
          )}
          <span aria-hidden className="shrink-0 text-muted-foreground">›</span>
        </div>

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
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {facts.length > 0 && (
              <div
                data-testid="cockpit-card-zone-a-facts"
                className="flex min-w-0 flex-wrap items-center gap-1"
              >
                {facts.map((fact, index) => (
                  <span
                    key={`${fact.text}:${index}`}
                    data-testid="cockpit-card-fact"
                    data-mechanical={fact.mechanical ? 'true' : 'false'}
                    data-full-text={fact.text}
                    title={fact.text}
                    className="max-w-[16rem] truncate rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    <span aria-hidden className="mr-0.5">{fact.mechanical ? '●' : '○'}</span>
                    {cockpitFactShortForm(fact.text)}
                  </span>
                ))}
              </div>
            )}
            <span className="ml-auto shrink-0">
              <CockpitCardViz card={card} />
            </span>
          </div>
        )}
      </div>

      <div
        data-testid="cockpit-card-controls"
        className={cn(compact ? 'mt-1.5 flex items-start gap-2' : 'mt-2 space-y-2')}
      >
        {/* B zone: one dropdown whose last item is the person's own reply. A card with no
            resolved options draws neither the dropdown nor its trigger; see `emptyAskContent`. */}
        <div className={cn('min-w-0', compact ? 'flex-1' : '')} data-testid="cockpit-card-options">
          {emptyAskContent ? (
            <div
              data-testid="cockpit-card-empty-ask"
              className="overflow-hidden rounded-md border border-dashed border-border"
            >
              {/* The two answers this card really has. The question and the reason are already
                  drawn above (zone A and the situation line), so this strip adds no third copy. */}
              {conversationSessionId !== '' && (
                <a
                  data-testid="cockpit-card-open-conversation"
                  href={`/session/${encodeURIComponent(conversationSessionId)}`}
                  className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-primary hover:underline"
                >
                  <span className="truncate">
                    {t('cockpit.cardDetailsOpenConversation', { sessionId: conversationSessionId })}
                  </span>
                  <span aria-hidden className="shrink-0">›</span>
                </a>
              )}
              {ownReplyAvailable && (
                <button
                  type="button"
                  data-testid="cockpit-card-own-reply-trigger"
                  data-selected={showingOwnReply ? 'true' : 'false'}
                  aria-pressed={showingOwnReply}
                  onClick={onShowOwnReply}
                  className={cn(
                    'flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium text-foreground hover:bg-accent',
                    conversationSessionId !== '' && 'border-t border-border',
                  )}
                >
                  <span aria-hidden>✎</span>
                  <span className="truncate">{t('cockpit.cardWriteOwn')}</span>
                </button>
              )}
              {/* The trigger above IS this editor's one heading, the same rule the dropdown's
                  last item follows. */}
              {showingOwnReply && ownReplyAvailable && (
                <div className="border-t border-border px-2 py-1.5">
                  <OwnReplyEditor
                    value={ownReply}
                    onChange={onOwnReplyChange}
                    ariaLabel={t('cockpit.cardWriteOwn')}
                    placeholder={t('cockpit.cardOwnReplyPlaceholder')}
                  />
                </div>
              )}
            </div>
          ) : (
            <>
          {/* The trigger and the shown option's explanation are ONE bordered box: the frame owns
              the only border and rounding, so the explanation reads as part of the selected
              option rather than as a second, parallel option. */}
          <div
            data-testid="cockpit-card-option-frame"
            className="overflow-hidden rounded-md border border-border"
          >
            <button
              type="button"
              data-testid="cockpit-card-option-trigger"
              data-source={shownOption?.source ?? null}
              data-suggested={shownOption?.suggested === true ? 'true' : 'false'}
              data-locked={feedbackLocked ? 'true' : 'false'}
              aria-expanded={!feedbackLocked && dropdownOpen}
              disabled={feedbackLocked}
              onClick={feedbackLocked ? undefined : onToggleDropdown}
              className="flex w-full items-center justify-between gap-2 bg-background px-2 py-1.5 text-left text-xs hover:bg-accent disabled:cursor-default"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium text-foreground">{shownLabel}</span>
                {shownOption?.suggested === true && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                    {t('cockpit.cardSuggested')}
                  </span>
                )}
                {shownSource !== null && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{shownSource}</span>
                )}
                {shownPosition !== null && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{shownPosition}</span>
                )}
              </span>
              <span aria-hidden className="shrink-0 text-muted-foreground">▾</span>
            </button>

            {/* The full explanation belongs to the Cards density; Compact stays three lines, so
                the description lives only in the open dropdown and in Details. */}
            {!compact && !dropdownOpen && shownOption !== null && (
              <ShownOptionExplanation option={shownOption} />
            )}
          </div>
          {!compact && !dropdownOpen && !feedbackLocked && showingOwnReply && ownReplyAvailable && (
            <OwnReplyEditor
              value={ownReply}
              onChange={onOwnReplyChange}
              label={t('cockpit.cardWriteOwn')}
              ariaLabel={t('cockpit.cardWriteOwn')}
              placeholder={t('cockpit.cardOwnReplyPlaceholder')}
            />
          )}

          {dropdownOpen && !feedbackLocked && (
            <div
              data-testid="cockpit-card-option-list"
              // The rows are a RADIO GROUP, not a list of independent toggles: exactly one of
              // them — an option or the person's own reply — is the card's shown reading, and
              // the filled circle says which. The group is the list itself so the own-reply item
              // stays the list's last child (the dropdown's own ordering contract).
              role="radiogroup"
              aria-label={t('cockpit.cardDetailsOptions')}
              className="mt-1 max-h-80 space-y-1 overflow-auto rounded-md border border-border bg-popover p-1.5 shadow-lg"
            >
                {card.options.map((option, index) => {
                  const isShown = shownOption?.id === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={isShown}
                      data-testid={`cockpit-card-option-${option.id}`}
                      data-selected={isShown ? 'true' : 'false'}
                      onClick={() => onShowOption(option.id)}
                      className={cn(
                        'block w-full rounded-md px-2 py-1.5 text-left hover:bg-accent',
                        isShown && 'bg-accent/70 ring-1 ring-primary/40',
                      )}
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span
                          data-testid="cockpit-card-option-radio"
                          data-selected={isShown ? 'true' : 'false'}
                          aria-hidden
                          className={cn(
                            'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                            isShown ? 'border-primary' : 'border-muted-foreground/40',
                          )}
                        >
                          {isShown && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                        </span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                        <span className="text-xs font-medium text-foreground">{option.label}</span>
                        {option.suggested && (
                          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                            {t('cockpit.cardSuggested')}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {t(COCKPIT_SOURCE_LABEL_KEY[option.source] ?? 'cockpit.cardSourceProvider')}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.does}</span>
                      {option.why !== undefined && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.why}</span>
                      )}
                      {option.warn !== undefined && (
                        <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-300">
                          ⚠ {option.warn}
                        </span>
                      )}
                      <OptionTags option={option} />
                      {option.undo !== undefined && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.undo}</span>
                      )}
                    </button>
                  );
                })}

                {ownReplyAvailable && (
                  <div
                    data-testid="cockpit-card-own-reply-item"
                    className="rounded-md border-t border-border px-2 py-1.5"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={showingOwnReply}
                      data-testid="cockpit-card-own-reply-trigger"
                      data-selected={showingOwnReply ? 'true' : 'false'}
                      onClick={onShowOwnReply}
                      className="flex w-full items-center gap-1.5 rounded-md text-left text-xs font-medium text-foreground hover:underline"
                    >
                      <span
                        data-testid="cockpit-card-option-radio"
                        data-selected={showingOwnReply ? 'true' : 'false'}
                        aria-hidden
                        className={cn(
                          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border',
                          showingOwnReply ? 'border-primary' : 'border-muted-foreground/40',
                        )}
                      >
                        {showingOwnReply && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                      </span>
                      <span className="truncate">✎ {t('cockpit.cardWriteOwn')}</span>
                    </button>
                    {/* The trigger above IS this editor's one heading; the editor itself draws
                        only its accessible name, so 「Write your own」 appears exactly once. */}
                    <OwnReplyEditor
                      value={ownReply}
                      onChange={onOwnReplyChange}
                      ariaLabel={t('cockpit.cardWriteOwn')}
                      placeholder={t('cockpit.cardOwnReplyPlaceholder')}
                    />
                  </div>
                )}
            </div>
          )}
            </>
          )}
        </div>

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
        </div>
      </div>
    </article>
  );
}
