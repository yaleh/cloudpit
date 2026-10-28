import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import type { CockpitCard as CockpitCardData } from '@/shared/types';
import { cn } from '@/shared/utils';
import {
  cockpitAssistantQuote,
  cockpitCardDescriptor,
  cockpitCardFactsBeyondSituation,
  cockpitCardTitle,
} from '@/modules/cockpit/cockpitCardDescriptors';
import CockpitBriefView from '@/modules/cockpit/CockpitBriefView';
import type {
  CockpitBriefState,
  CockpitCardConfirmTarget,
} from '@/modules/cockpit/cockpitCardController';
import { COCKPIT_PATH, cockpitViewPath } from '@/modules/cockpit/contract';

/**
 * The Details drawer a tap on a card's A zone opens: the full question, the situation and its
 * facts, the brief, every option in rich text, and the conversation section.
 *
 * The brief section sits after the facts and before the options: the brief explains what the
 * options mean, so drawing it below them would ask the reader to choose before the reading.
 *
 * THE CONVERSATION SECTION IS THE DRAWER'S END. A card that belongs to a conversation links to
 * it; a card with only a project offers 「就此开一个会话」, which issues an intent callback and
 * does NOT open anything — opening it is a later task's job. A card with neither states that,
 * rather than drawing a dead link.
 *
 * The drawer is presentational: the list owns the Details stack and passes the card to draw.
 */

export type CockpitCardDetailsProps = {
  card: CockpitCardData;
  now: number;
  onClose: () => void;
  /** 「就此开一个会话」 — the intent only; no conversation is created here. */
  onStartConversation?: (card: CockpitCardData) => void;
  /** The card's brief reading; absent or idle means the drawer draws no brief section. */
  brief?: CockpitBriefState;
  /** Re-reads a failed brief; the drawer's retry button calls it. */
  onRetryBrief?: () => void;
  /**
   * The card's confirm target (what its SHOWN option resolves to), drawn as the persistent bottom
   * bar. Absent or `null` means the card offers nothing to confirm, so no bar is drawn.
   */
  target?: CockpitCardConfirmTarget | null;
  /** The bar's press: opens the same confirm card the card's own bar opens. */
  onRequestConfirm?: () => void;
  /**
   * The PC column's conversation link: open the conversation on the LEFT (in place of the
   * anchor's default full-page navigation) so the column decides whether it must also collapse.
   * Absent keeps the page variant's plain link.
   */
  onOpenConversation?: (sessionId: string) => void;
  /** The card whose conversation is already open on the left; draw the marker instead of the link. */
  openedInSession?: boolean;
  /**
   * The session the left pane currently shows, supplied by the PC column from the route. When it
   * equals the card's own conversation session, the card is already open on the left even though
   * it was not opened from this card — draw the same marker instead of the link. The page/phone
   * variant passes nothing, so its link never changes.
   */
  currentSessionId?: string | null;
  /**
   * Pushed inside the column instead of floating over the page: fills its host, drops the card
   * chrome and the close button (the list's back button returns).
   */
  inline?: boolean;
  /**
   * The phone's bottom sheet: a full-width panel rising to ~90% of the viewport with a drag
   * handle at its top. The layer that hosts it pins it to the bottom edge; this component only
   * draws the sheet's own shape and the swipe-down gesture. The sheet has NO Escape handler — a
   * phone has no Escape key, and a stray Escape must not close the drawer mid-read.
   */
  drawer?: boolean;
};

/** How far a downward swipe on the drawer's handle must travel before the sheet closes. */
const DRAWER_CLOSE_SWIPE_PX = 60;

function waitingText(t: TFunction, now: number, waitingSince: string): string {
  const since = Date.parse(waitingSince);
  const milliseconds = Number.isNaN(since) ? 0 : Math.max(0, now - since);
  const minutes = Math.floor(milliseconds / 60_000);
  if (minutes < 1) return t('cockpit.observationJustNow');
  if (minutes < 60) return t('cockpit.observationMinutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('cockpit.observationHoursAgo', { n: hours });
  return t('cockpit.observationDaysAgo', { n: Math.floor(hours / 24) });
}

/** One titled section; empty sections are not drawn at all. */
function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  /** The section's own reading hook, for a section a criterion names. */
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="mt-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}

export default function CockpitCardDetails({
  card,
  now,
  onClose,
  onStartConversation,
  brief,
  onRetryBrief,
  target,
  onRequestConfirm,
  onOpenConversation,
  openedInSession = false,
  currentSessionId = null,
  inline = false,
  drawer = false,
}: CockpitCardDetailsProps) {
  const { t } = useTranslation();
  const descriptor = cockpitCardDescriptor(card.kind);
  // The drawer's swipe-down gesture: the pointer's y where the handle was pressed. A number
  // rather than a boolean, because the closing distance is measured, not just "dragged at all".
  const swipeStartY = useRef<number | null>(null);
  // The same rule the card body uses: a fact the situation already states is not a second
  // reading. Details is where the facts keep their FULL text, so only the repetition is dropped.
  const facts = cockpitCardFactsBeyondSituation(card);
  // The assistant's own words, only where the design asks for them (the phone drawer's quote).
  // The digest's verbatim fragment wins; older cards (or providers that state only the restated
  // question) fall back to the quoted phrase inside `situation`/`ask`.
  const assistantQuote = drawer ? (card.assistantQuote ?? cockpitAssistantQuote(card)) : null;
  // The server projection fills `conversation` from the subject; the fallback keeps the link
  // for a card read before that projection ran (and for a criterion that states only the subject).
  // A provider that states `conversation` itself stays authoritative: the subject is only used
  // when the provider said nothing.
  const sessionId =
    card.conversation === undefined ? card.subject.sessionId : card.conversation.sessionId;
  const startProject = card.conversation?.startInProject ?? card.subject.project;
  // Two ways a card's conversation is "already on the left": it was opened from this card, or
  // the page is already parked on that session (for example it was opened from the sidebar).
  // The second reading is the column's route param; nothing is marked when it is absent.
  const conversationOnLeft =
    openedInSession || (currentSessionId !== null && currentSessionId === sessionId);
  // 「在 Quay 中打开该任务」. The cockpit has no deep link that also selects one task, so the
  // honest destination is the project's board — the page where the task is listed. Without a
  // project there is no board to name, and the cockpit's own cards list is the fallback.
  const quayHref =
    card.subject.taskId === undefined
      ? null
      : card.subject.project !== undefined && card.subject.project.trim() !== ''
        ? cockpitViewPath({ type: 'board', project: card.subject.project })
        : COCKPIT_PATH;
  // NO BRIEF AREA WHEN THERE IS NOTHING TO READ: idle/absent means the drawer never asked, and a
  // `disabled` fallback means the brief feature is off — a titled 「Brief」 section whose body is
  // "this is disabled" is chrome, not a reading. Other fallbacks (a gateway that is down, say)
  // stay: they explain why a brief the feature DOES offer is missing.
  const briefVisible =
    brief !== undefined
    && brief.status !== 'idle'
    && !(brief.status === 'ready' && brief.response.status === 'fallback' && brief.response.reason === 'disabled');

  // The title row. On the phone it lives INSIDE the same sticky header as the drag handle, so
  // the handle can never scroll over and cover it: the two move together as one block.
  const titleRow = (
    <div
      data-testid="cockpit-card-details-title-row"
      className={cn('flex items-center justify-between gap-2', drawer ? 'px-3 pb-1 pt-1' : '')}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
          {t(descriptor.labelKey)}
        </span>
        <span className="truncate text-xs font-semibold text-foreground">
          {t('cockpit.cardDetailsTitle')}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {t('cockpit.cardWaitingFor', { duration: waitingText(t, now, card.waitingSince) })}
        </span>
      </span>
      {/* The phone's sheet carries no Close button: its title bar is the drag handle, and a
          downward swipe is the dismissal the mockup shows. */}
      {!inline && !drawer && (
        <button
          type="button"
          data-testid="cockpit-card-details-close"
          onClick={onClose}
          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent"
        >
          {t('cockpit.cardDetailsClose')}
        </button>
      )}
    </div>
  );

  return (
    <aside
      data-testid="cockpit-card-details"
      data-cockpit-card-details-id={card.id}
      data-cockpit-card-details-inline={inline ? 'true' : 'false'}
      data-drawer={drawer ? 'true' : 'false'}
      className={cn(
        'flex flex-col overflow-auto text-card-foreground',
        inline
          ? 'min-h-0 flex-1'
          : drawer
            ? 'h-[90vh] max-h-[90vh] w-full rounded-t-2xl border border-b-0 border-border bg-card p-3 shadow-xl'
            : 'max-h-[90vh] w-full rounded-xl border border-border bg-card p-3 shadow-xl',
      )}
    >
      {drawer ? (
        <div
          data-testid="cockpit-card-details-header"
          className="sticky top-0 z-10 -mx-3 -mt-3 mb-1 bg-card"
        >
          <button
            type="button"
            data-testid="cockpit-card-details-drag-handle"
            aria-label={t('cockpit.cardDetailsClose')}
            // A tap on the handle is the same dismissal as a downward swipe: the handle is the
            // sheet's only chrome, so it must not be an inert strip.
            onClick={onClose}
            onPointerDown={(event) => {
              swipeStartY.current = event.clientY;
            }}
            onPointerUp={(event) => {
              const start = swipeStartY.current;
              swipeStartY.current = null;
              if (start !== null && event.clientY - start >= DRAWER_CLOSE_SWIPE_PX) onClose();
            }}
            onPointerCancel={() => {
              swipeStartY.current = null;
            }}
            className="flex w-full touch-none justify-center rounded-t-2xl bg-card pb-1 pt-1.5"
          >
            <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/40" />
          </button>
          {titleRow}
        </div>
      ) : (
        titleRow
      )}

      <p className="mt-2 text-sm font-medium text-foreground">{cockpitCardTitle(card, t)}</p>
      {card.contentUnavailable !== undefined && (
        <p
          data-testid="cockpit-card-details-content-unavailable"
          className="mt-1 text-xs text-muted-foreground"
        >
          {card.contentUnavailable}
        </p>
      )}
      <p className="mt-1 text-[11px] text-muted-foreground">
        {[card.subject.project, card.subject.taskId, card.subject.sessionId]
          .filter((part): part is string => part !== undefined && part !== '')
          .join(' · ')}
      </p>

      {quayHref !== null && (
        <a
          data-testid="cockpit-card-open-in-quay"
          data-task-id={card.subject.taskId}
          href={quayHref}
          className="mt-1 self-start text-xs font-medium text-primary hover:underline"
        >
          {t('cockpit.cardDetailsOpenInQuay')}
        </a>
      )}

      {card.situation !== undefined && (
        <Section title={t('cockpit.cardDetailsSituation')}>
          <p className="text-xs text-foreground">{card.situation}</p>
        </Section>
      )}

      {/* The assistant's own words, quoted, with the way back into the session they came from.
          Only the phone drawer draws this: a card whose summary quotes the assistant gets the
          quote where the mockup puts it, and the session link is the one exit. */}
      {assistantQuote !== null && (
        <Section
          title={t('cockpit.cardDetailsAssistantQuote')}
          testId="cockpit-card-details-quote"
        >
          <blockquote
            data-testid="cockpit-card-assistant-quote"
            className="border-l-2 border-primary/40 pl-2 text-xs italic text-foreground"
          >
            {assistantQuote}
          </blockquote>
          {sessionId !== undefined && (
            <a
              data-testid="cockpit-card-quote-session-link"
              href={`/session/${encodeURIComponent(sessionId)}`}
              onClick={
                onOpenConversation === undefined
                  ? undefined
                  : (event) => {
                      event.preventDefault();
                      onOpenConversation(sessionId);
                    }
              }
              className="mt-1 inline-block text-[11px] font-medium text-primary hover:underline"
            >
              {t('cockpit.cardDetailsInSession')}
            </a>
          )}
        </Section>
      )}

      {facts.length > 0 && (
        <Section title={t('cockpit.cardDetailsFacts')}>
          <ul className="space-y-0.5" data-testid="cockpit-card-details-facts">
            {facts.map((fact, index) => (
              <li key={`${fact.text}:${index}`} className="flex items-start gap-1 text-xs text-foreground">
                <span aria-hidden className={cn('mt-1.5 h-1 w-1 shrink-0 rounded-full', fact.mechanical ? 'bg-primary' : 'bg-muted-foreground')} />
                <span className={fact.mechanical ? '' : 'italic'}>{fact.text}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {briefVisible && brief !== undefined && (
        <Section title={t('cockpit.briefTitle')} testId="cockpit-card-details-brief">
          <CockpitBriefView state={brief} onRetry={onRetryBrief} />
        </Section>
      )}

      {card.options.length > 0 && (
        <Section title={t('cockpit.cardDetailsOptions')}>
          <ul className="space-y-1.5" data-testid="cockpit-card-details-options">
            {card.options.map((option) => (
              <li key={option.id} className="rounded-md border border-border px-2 py-1.5">
                <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground">
                  <span>{option.label}</span>
                  {option.suggested && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      {t('cockpit.cardSuggested')}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{option.does}</p>
                {option.why !== undefined && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{option.why}</p>
                )}
                {option.warn !== undefined && (
                  <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">⚠ {option.warn}</p>
                )}
                {(option.tags ?? []).length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {(option.tags ?? []).map((tag) => (
                      <span
                        key={`${tag.kind}:${tag.text}`}
                        className={cn(
                          'rounded-full px-1.5 py-0.5 text-[10px]',
                          tag.kind === 'warn'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                            : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {tag.text}
                      </span>
                    ))}
                  </p>
                )}
                {option.undo !== undefined && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{option.undo}</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('cockpit.cardDetailsConversation')}>
        {sessionId !== undefined && conversationOnLeft ? (
          <p
            data-testid="cockpit-card-opened-in-session"
            className="text-xs font-medium text-muted-foreground"
          >
            {t('cockpit.columnOpenedInSession')}
          </p>
        ) : sessionId !== undefined ? (
          <a
            data-testid="cockpit-card-conversation-link"
            href={`/session/${encodeURIComponent(sessionId)}`}
            onClick={
              onOpenConversation === undefined
                ? undefined
                : (event) => {
                    // The column opens the conversation in place (left side) and owns what
                    // happens to the column afterwards; a full page load would lose that.
                    event.preventDefault();
                    onOpenConversation(sessionId);
                  }
            }
            className="text-xs font-medium text-primary hover:underline"
          >
            {t('cockpit.cardDetailsOpenConversation', { sessionId })}
          </a>
        ) : startProject !== undefined ? (
          <button
            type="button"
            data-testid="cockpit-card-start-conversation"
            onClick={() => onStartConversation?.(card)}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            {t('cockpit.cardDetailsStartConversation')}
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">{t('cockpit.cardDetailsNoConversation')}</p>
        )}
      </Section>

      {/*
        THE PERSISTENT CONFIRM BAR. It is bound to the SAME target the card's own bar is bound to
        (the card's currently shown option), and its press opens the same confirm card — Details
        is a longer reading of one card, not a second confirmation path. `sticky bottom-0` keeps
        it in view while the drawer's body scrolls.
      */}
      {target !== undefined && target !== null && (
        <div
          data-testid="cockpit-card-details-confirm-bar"
          className="sticky bottom-0 mt-3 border-t border-border bg-card pt-2"
        >
          <button
            type="button"
            data-testid="cockpit-card-details-confirm"
            data-irreversible={target.irreversible ? 'true' : 'false'}
            disabled={target.disabled || onRequestConfirm === undefined}
            onClick={() => onRequestConfirm?.()}
            className={cn(
              // THE SAME BUTTON as the card's own bar: the drawer repeats the card's action, so
              // it must not restyle it. Irreversible stays the amber warning arm; the ordinary
              // arm is the black solid both the mockup and the card use (`bg-primary` was the
              // blue outlier this parity test pins out).
              'flex items-center justify-center gap-1 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50',
              'w-full',
              target.irreversible
                ? 'border border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                : 'bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
            )}
          >
            {t('cockpit.cardConfirm', { label: target.label })}
          </button>
          <p className="mt-1 text-[11px] text-muted-foreground">{t('cockpit.cardConfirmHint')}</p>
          {target.disabled && target.disabledReason !== null && (
            <p
              data-testid="cockpit-card-details-confirm-disabled-reason"
              className="mt-1 text-[11px] text-destructive"
            >
              {target.disabledReason}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
