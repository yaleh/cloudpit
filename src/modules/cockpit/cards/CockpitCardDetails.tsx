import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CockpitCard as CockpitCardData } from '@/shared/types';
import { cn } from '@/shared/utils';
import {
  cockpitAssistantQuote,
  cockpitCardAge,
  cockpitCardDescriptor,
  cockpitCardFactsBeyondSituation,
  cockpitCardTitle,
} from '@/modules/cockpit/cockpitCardDescriptors';
import CockpitBriefView from '@/modules/cockpit/cards/CockpitBriefView';
import { OwnReplyEditor } from '@/modules/cockpit/cards/CockpitCard';
import { CockpitCardConfirmBar } from '@/modules/cockpit/cards/CockpitCardConfirmBar';
import { CockpitCardDismissBar } from '@/modules/cockpit/cards/CockpitCardDismissBar';
import { CockpitCardStartConversation } from '@/modules/cockpit/cards/CockpitCardStartConversationAction';
import type { CockpitStartConversationView } from '@/modules/cockpit/cards/CockpitCardStartConversationAction';
import type {
  CockpitBriefState,
  CockpitCardConfirmOutcome,
  CockpitCardConfirmTarget,
  CockpitCardDismissNotice,
  CockpitCardDismissTarget,
  CockpitCardSendCountdown,
  CockpitCardShown,
} from '@/modules/cockpit/cards/cockpitCardController';
import { defaultShownOption } from '@/modules/cockpit/cards/cockpitCardController';
import { COCKPIT_PATH, cockpitViewPath } from '@/modules/cockpit-contract';

/**
 * The Details drawer a tap on a card's A zone opens: the full question, the situation and its
 * facts, the brief, every option in rich text, and the conversation section.
 *
 * The brief section sits after the facts and before the options: the brief explains what the
 * options mean, so drawing it below them would ask the reader to choose before the reading.
 *
 * THE CONVERSATION SECTION IS THE DRAWER'S END. A card that belongs to a conversation links to
 * it; a card with only a project offers 「就此开一个会话」, which allocates an EMPTY session in
 * that project and opens it (the flow, its pending lock and its visible error live in
 * `CockpitCardStartConversation`). A card with neither states that, rather than drawing a dead
 * link.
 *
 * The drawer is presentational: the list owns the Details stack and passes the card to draw.
 */

export type CockpitCardDetailsProps = {
  card: CockpitCardData;
  now: number;
  onClose: () => void;
  /**
   * 「就此开一个会话」's live reading: the attempt's status, its visible failure and the one
   * command that allocates the session. Absent draws no start control (a standalone drawer in a
   * criterion renders without the flow wired).
   */
  startConversation?: CockpitStartConversationView | null;
  /** The card's brief reading; absent or idle means the drawer draws no brief section. */
  brief?: CockpitBriefState;
  /** Re-reads a failed brief; the drawer's retry button calls it. */
  onRetryBrief?: () => void;
  /**
   * The card's confirm target (what its SHOWN option resolves to), drawn as the persistent bottom
   * bar. Absent or `null` means the card offers nothing to confirm, so no bar is drawn.
   */
  target?: CockpitCardConfirmTarget | null;
  /** The bar's first press: opens the in-place confirm state the card's own bar opens. */
  onRequestConfirm?: () => void;
  /** True when this card's confirmation is pending — the bar draws the confirm state in place. */
  confirmPending?: boolean;
  /** This card's running delayed send, or `null`; the bar reads its seconds against `now`. */
  sendCountdown?: CockpitCardSendCountdown | null;
  /** True while that confirmation's request is in flight. */
  confirming?: boolean;
  /** The last confirmation answer for this card, drawn inside this bar. */
  confirmOutcome?: CockpitCardConfirmOutcome | null;
  /** The second press: sends the pending confirmation from the same button. */
  onConfirm?: () => void;
  /** Leaves the confirm state without sending. */
  onCancelConfirm?: () => void;
  /**
   * The card-level 「忽略/丢弃」 target, drawn as a SECONDARY control in the same persistent
   * footer bar. It is a separate closing choice from the shown option — discarding answers
   * nothing — so the drawer must offer it even when the card has no confirm target. Absent or
   * `null` means this card offers no dismiss action.
   */
  dismissTarget?: CockpitCardDismissTarget | null;
  /** True when this card's dismiss confirmation is open (the first press has happened). */
  dismissPending?: boolean;
  /** True while this card's dismiss request is in flight. */
  dismissing?: boolean;
  /** The first press: opens the dismiss confirmation, sending nothing. */
  onRequestDismiss?: () => void;
  /** The dismiss confirmation's second press: discards the card without replying. */
  onConfirmDismiss?: () => void;
  /** Leaves the dismiss confirmation without sending. */
  onCancelDismiss?: () => void;
  /**
   * The last dismiss answer for THIS card. A failure is drawn inside the drawer: the card stays
   * on the list, so the reason must be readable where the person pressed and where the retry is.
   */
  dismissNotice?: CockpitCardDismissNotice | null;
  /**
   * The card's current shown reading — the option, or the person's own reply — which is the SAME
   * reading the card row draws. Absent falls back to the provider's suggested option, exactly what
   * the controller stores on its first read, so a standalone drawer highlights the row the list
   * would.
   */
  shown?: CockpitCardShown;
  /** The person's own-reply draft; the SAME draft the card row shows, never a second copy. */
  ownReply?: string;
  /** Chooses one option — the command the card row's dropdown issues, so both stay in sync. */
  onShowOption?: (optionId: string) => void;
  /** Chooses the person's own reply — the dropdown's last row issues the same command. */
  onShowOwnReply?: () => void;
  /** Writes the own-reply draft; absent draws no editor. */
  onOwnReplyChange?: (text: string) => void;
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

/**
 * The fallback reasons that are diagnostics, not readings: `disabled` says the feature is off, and
 * `unsupported-content` says the card does not point at a conversation question — both are
 * judgements about the card or the build, not something the person deciding can use. Every other
 * fallback names why a brief the feature DOES offer is missing (a spent budget, an unreadable
 * transcript), so it keeps its section.
 */
const SILENT_FALLBACK_REASONS: readonly string[] = [
  'disabled',
  'unsupported-content',
];

/**
 * The cockpit page owns the Enter key on `window` (it zooms the stage), and it calls
 * `preventDefault()` there even when a button has focus — so a plain button's native Enter
 * activation never fires inside the cockpit. The rows therefore activate themselves on
 * Enter/Space and stop the event before it reaches the page handler: one press selects the row,
 * it never also zooms the stage behind the drawer.
 */
function activateRowOnKey(
  action: (() => void) | undefined,
): (event: ReactKeyboardEvent<HTMLButtonElement>) => void {
  return (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    event.stopPropagation();
    action?.();
  };
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
  startConversation = null,
  brief,
  onRetryBrief,
  target,
  onRequestConfirm,
  confirmPending = false,
  sendCountdown = null,
  confirming = false,
  confirmOutcome = null,
  onConfirm,
  onCancelConfirm,
  dismissTarget = null,
  dismissPending = false,
  dismissing = false,
  onRequestDismiss,
  onConfirmDismiss,
  onCancelDismiss,
  dismissNotice = null,
  shown,
  ownReply = '',
  onShowOption,
  onShowOwnReply,
  onOwnReplyChange,
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
  // 「✎ 编辑」 IS THE ONLY PATH THAT FOCUSES THE DRAFT. Pressing an option's edit button copies the
  // option's sent text into the own-reply draft and asks the effect below to put the caret at the
  // END; pressing the ordinary own-reply row just opens the editor and leaves focus alone. A
  // one-shot flag (cleared once the focus lands) is what keeps those two paths distinct.
  // The drawer's own options list. Its own-reply editor is the list's one textarea, so scoping
  // the focus lookup here is what keeps the card row's editor out of reach — both can share a page.
  const optionsListRef = useRef<HTMLUListElement | null>(null);
  const [focusOwnReplyPending, setFocusOwnReplyPending] = useState(false);
  // The same rule the card body uses: a fact the situation already states is not a second
  // reading. Details is where the facts keep their FULL text, so only the repetition is dropped.
  const facts = cockpitCardFactsBeyondSituation(card);
  // The assistant's own words, only where the design asks for them (the phone drawer's quote).
  // The digest's verbatim fragment wins; older cards (or providers that state only the restated
  // question) fall back to the quoted phrase inside `situation`/`ask`.
  const assistantQuote = drawer ? (card.assistantQuote ?? cockpitAssistantQuote(card)) : null;
  // The option rows read the SAME shown reading the card row draws. A drawer rendered without
  // one (a unit fixture, an older caller) falls back to the provider's suggested option — what
  // the controller stores on its first read — so the highlighted row always matches the list.
  const shownReading = shown ?? defaultShownOption(card) ?? undefined;
  const shownOptionId = shownReading?.kind === 'option' ? shownReading.optionId : null;
  const showingOwnReply = shownReading?.kind === 'ownReply';
  // The controller's own guard: a card with no own-reply executor would produce a confirmation
  // the server refuses, so its row is only drawn where selecting it can send.
  const ownReplyAvailable = card.ownReply !== undefined && onShowOwnReply !== undefined;
  // A card awaiting a feedback receipt has already run its action; the list locks the options
  // and so does the drawer — the two read one card, so they must lock together.
  const optionsLocked = card.feedback !== undefined;
  // Land the 「✎ 编辑」 focus only once BOTH the flag and the shown reading agree: whichever of the
  // two state updates renders first, the effect re-runs when the other arrives. Focus is put at
  // the end because the point of the shortcut is to append a few words to the copied text.
  useEffect(() => {
    if (!focusOwnReplyPending || !showingOwnReply) return;
    const input = optionsListRef.current?.querySelector('textarea') ?? null;
    if (input === null) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
    setFocusOwnReplyPending(false);
  }, [focusOwnReplyPending, showingOwnReply]);
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
  // NO BRIEF AREA WHEN THERE IS NOTHING TO READ. Idle/absent means the drawer never asked, and a
  // silent fallback (see `SILENT_FALLBACK_REASONS`) produced no reading — only a diagnostic about
  // the card or the build. Both hide the whole section, title included. Loading, a failed read and
  // a fallback that names a missing brief stay: they are states of a brief the feature DOES offer.
  const briefVisible =
    brief !== undefined
    && brief.status !== 'idle'
    && !(
      brief.status === 'ready'
      && brief.response.status === 'fallback'
      && brief.response.reason !== null
      && SILENT_FALLBACK_REASONS.includes(brief.response.reason)
    );

  // THE DETAILS DRAWER IS WHERE THE KNOWLEDGE ENTRY IS READ IN FULL. The list card draws the
  // provider's title and statement verbatim but clamps the statement to two lines (its whole
  // text lives on the element's `title`), so the entry's body is only readable here. The two
  // fields are drawn exactly as the provider stated them — `whitespace-pre-line` keeps the
  // revision's paragraphs, and NO line-clamp is applied. A card that states neither field (or
  // is not a knowledge card at all) draws no section, rather than an empty one.
  const knowledge = card.knowledge;
  const knowledgeVisible =
    knowledge !== undefined
    && (knowledge.title !== undefined || knowledge.statement !== undefined);

  // THE FOOTER IS NOT ONLY THE SEND BAR. A session-ask card offers the third choice —
  // 「忽略/丢弃」 — and the drawer must keep it reachable even when the card has no confirm
  // target at all: the old footer was bound to the send target alone, which removed the only
  // discard entry from the drawer. A card whose feedback already ran draws neither control, but
  // a dismiss answer (a failure, or the success line before the re-read removes the card) is
  // still drawn there.
  const confirmVisible =
    target !== undefined && target !== null && card.feedback === undefined;
  const dismissVisible =
    dismissTarget !== undefined && dismissTarget !== null && card.feedback === undefined;
  const footerVisible = confirmVisible || dismissVisible || dismissNotice !== null;

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
        <span
          data-testid="cockpit-card-details-age"
          className="shrink-0 text-[11px] text-muted-foreground"
        >
          {t('cockpit.cardWaitingFor', { duration: cockpitCardAge(t, now, card.waitingSince) })}
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
        'flex flex-col overflow-hidden text-card-foreground',
        inline
          ? 'min-h-0 flex-1'
          : drawer
            ? 'h-[90vh] max-h-[90vh] w-full rounded-t-2xl border border-b-0 border-border bg-card shadow-xl'
            : 'mx-auto max-h-[90vh] w-full max-w-3xl rounded-xl border border-border bg-card shadow-xl',
      )}
    >
      {/*
        TWO REGIONS, ONE DRAWER. The body scrolls; the confirm bar is a SIBLING of that scroller,
        so the bar can never sit on top of the last option or the conversation link. `min-h-0` is
        what lets the flex child actually shrink below its content and scroll.
      */}
      <div
        data-testid="cockpit-card-details-scroll"
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div
          data-testid="cockpit-card-details-inner"
          className={cn(
            'mx-auto flex w-full max-w-3xl flex-col',
            drawer ? 'px-3 pb-3' : inline ? '' : 'px-3 pb-3 pt-3',
          )}
        >
          {drawer ? (
            <div
              data-testid="cockpit-card-details-header"
              className="sticky top-0 z-10 -mx-3 bg-card"
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

          {/* The knowledge entry the suggestion was derived from, before the facts: what the
              entry SAYS is the context the facts are weighed against. The section title stays a
              literal, like the list card's own knowledge state labels, because the knowledge
              vocabulary in this module is not routed through the i18n bundle yet. */}
          {knowledgeVisible && knowledge !== undefined && (
            <Section title="知识" testId="cockpit-card-details-knowledge">
              {knowledge.title !== undefined && (
                <p
                  data-testid="cockpit-card-details-knowledge-title"
                  className="whitespace-pre-line text-xs font-medium text-foreground"
                >
                  {knowledge.title}
                </p>
              )}
              {knowledge.statement !== undefined && (
                <p
                  data-testid="cockpit-card-details-knowledge-statement"
                  className="mt-1 whitespace-pre-line text-xs text-foreground"
                >
                  {knowledge.statement}
                </p>
              )}
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

          {(card.options.length > 0 || ownReplyAvailable) && (
            <Section title={t('cockpit.cardDetailsOptions')}>
              {/*
                EVERY ROW IS ONE PRESS TARGET. The whole row is a button (not a radio: the person's
                choice is a reading, and the drawer shows it as a highlighted frame). `aria-pressed`
                states the selection for assistive technology, `border-primary` + a ring is the main
                signal, and the faint `bg-primary/5` only supports it. The last row is always the
                person's own reply, carrying the same state and expanding the shared draft editor.
              */}
              <ul ref={optionsListRef} className="space-y-1.5" data-testid="cockpit-card-details-options">
                {card.options.map((option) => {
                  const isShown = shownOptionId === option.id;
                  // The text this option would actually send, for the 「✎ 编辑」 shortcut. An option
                  // that states none (every fleet disposal option) has nothing to copy, so it offers
                  // no shortcut. The other three conditions mirror the own-reply row: the card must
                  // have an own-reply action, this drawer must be able to write its draft, and the
                  // card must not be locked behind an already-sent feedback.
                  const editableText = option.sendText;
                  const editAvailable =
                    editableText !== undefined && ownReplyAvailable && onOwnReplyChange !== undefined;
                  return (
                    <li key={option.id} className="relative">
                      <button
                        type="button"
                        data-testid={`cockpit-card-details-option-${option.id}`}
                        data-selected={isShown ? 'true' : 'false'}
                        aria-pressed={isShown}
                        disabled={optionsLocked}
                        onClick={optionsLocked ? undefined : () => onShowOption?.(option.id)}
                        onKeyDown={activateRowOnKey(
                          optionsLocked ? undefined : () => onShowOption?.(option.id),
                        )}
                        className={cn(
                          'block w-full rounded-md border px-2 py-1.5 text-left transition-colors',
                          'hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          isShown ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border',
                          optionsLocked && 'cursor-default opacity-70',
                          // Room for the shortcut in the corner, so the two never overlap.
                          editAvailable && !optionsLocked && 'pr-14',
                        )}
                      >
                        <span className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-foreground">
                          <span>{option.label}</span>
                          {option.suggested && (
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                              {t('cockpit.cardSuggested')}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.does}</span>
                        {option.why !== undefined && (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.why}</span>
                        )}
                        {option.warn !== undefined && (
                          <span className="mt-0.5 block text-[11px] text-amber-700 dark:text-amber-300">⚠ {option.warn}</span>
                        )}
                        {(option.tags ?? []).length > 0 && (
                          <span className="mt-1 flex flex-wrap gap-1">
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
                          </span>
                        )}
                        {option.undo !== undefined && (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.undo}</span>
                        )}
                      </button>
                      {/* A SIBLING of the row button, never a child: HTML cannot nest buttons. The
                          shortcut copies the option's sent text into the shared draft and asks for
                          the caret at its end; it does not confirm anything. */}
                      {editAvailable && !optionsLocked && (
                        <button
                          type="button"
                          data-testid={`cockpit-card-details-option-edit-${option.id}`}
                          onClick={() => {
                            setFocusOwnReplyPending(true);
                            onOwnReplyChange?.(editableText);
                          }}
                          className="absolute right-1 top-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <span aria-hidden>✎ </span>
                          {t('cockpit.cardEditOption')}
                        </button>
                      )}
                    </li>
                  );
                })}
                {ownReplyAvailable && (
                  <li>
                    <button
                      type="button"
                      data-testid="cockpit-card-details-own-reply"
                      data-selected={showingOwnReply ? 'true' : 'false'}
                      aria-pressed={showingOwnReply}
                      disabled={optionsLocked}
                      onClick={optionsLocked ? undefined : onShowOwnReply}
                      onKeyDown={activateRowOnKey(optionsLocked ? undefined : onShowOwnReply)}
                      className={cn(
                        'block w-full rounded-md border border-dashed px-2 py-1.5 text-left text-xs font-medium text-foreground transition-colors',
                        'hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        showingOwnReply
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/40'
                          : 'border-border',
                        optionsLocked && 'cursor-default opacity-70',
                      )}
                    >
                      <span aria-hidden>✎ </span>
                      {t('cockpit.cardWriteOwn')}
                    </button>
                    {/* The SAME draft the card row edits; selecting the row is the only way in. */}
                    {showingOwnReply && !optionsLocked && onOwnReplyChange !== undefined && (
                      <OwnReplyEditor
                        testId="cockpit-card-details-own-reply-input"
                        value={ownReply}
                        onChange={onOwnReplyChange}
                        ariaLabel={t('cockpit.cardWriteOwn')}
                        placeholder={t('cockpit.cardOwnReplyPlaceholder')}
                      />
                    )}
                  </li>
                )}
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
              startConversation !== null ? (
                <CockpitCardStartConversation view={startConversation} />
              ) : null
            ) : (
              <p className="text-xs text-muted-foreground">{t('cockpit.cardDetailsNoConversation')}</p>
            )}
          </Section>

        </div>
      </div>

      {/*
        THE PERSISTENT FOOTER BAR. Its send control is bound to the SAME target the card's own bar
        is bound to (the card's currently shown option), and its press opens the same in-place
        confirm state — Details is a longer reading of one card, not a second confirmation path.
        Beside it sits the card-level 「忽略/丢弃」 control, drawn by the SAME shared
        `CockpitCardDismissBar` the card row uses: one card, one controller state, one control.
        It is a SIBLING of the scrolling body (never inside it), so the bar cannot cover the
        reading's last lines. A card whose feedback is already sent draws NO send bar here either:
        its action ran, and the only live control is the resend the card row offers after the
        window. A dismiss answer for THIS card is drawn inside the bar: a failure keeps the card
        on the list and its reason must be readable beside the retry.
      */}
      {footerVisible && (
        <div
          data-testid="cockpit-card-details-footer"
          className="shrink-0 border-t border-border bg-card px-3 py-2"
        >
          <div className="mx-auto w-full max-w-3xl space-y-1">
            {dismissNotice !== null && (
              <p
                role={dismissNotice.ok ? 'status' : 'alert'}
                data-testid="cockpit-card-details-dismiss-notice"
                data-ok={dismissNotice.ok ? 'true' : 'false'}
                className={cn(
                  'text-[11px]',
                  dismissNotice.ok ? 'text-muted-foreground' : 'text-destructive',
                )}
              >
                {dismissNotice.message}
              </p>
            )}
            {confirmVisible && (
              <CockpitCardConfirmBar
                barTestId="cockpit-card-details-confirm-bar"
                testId="cockpit-card-details-confirm"
                cardId={card.id}
                target={target}
                showingOwnReply={showingOwnReply}
                pending={confirmPending}
                countdown={sendCountdown}
                confirming={confirming}
                now={now}
                outcome={confirmOutcome}
                onRequestConfirm={() => onRequestConfirm?.()}
                onConfirm={onConfirm}
                onCancelConfirm={onCancelConfirm}
              />
            )}
            {dismissVisible && (
              <CockpitCardDismissBar
                cardId={card.id}
                barTestId="cockpit-card-details-dismiss-bar"
                testId="cockpit-card-details-dismiss"
                pending={dismissPending}
                dismissing={dismissing}
                onRequestDismiss={onRequestDismiss}
                onConfirmDismiss={onConfirmDismiss}
                onCancelDismiss={onCancelDismiss}
                className="mt-0"
              />
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
