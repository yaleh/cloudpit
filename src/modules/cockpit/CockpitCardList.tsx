import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';

import type { CockpitCard as CockpitCardData, CockpitCardKind } from '@/shared/types';
import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import { cn } from '@/shared/utils';
import { cockpitCardDescriptor } from '@/modules/cockpit/cockpitCardDescriptors';
import type { CockpitCardTypeFilter } from '@/modules/cockpit/cockpitCardController';
import { cockpitCardsReading } from '@/modules/cockpit/cockpitCardController';
import CockpitCard from '@/modules/cockpit/CockpitCard';
import CockpitCardDetails from '@/modules/cockpit/CockpitCardDetails';
import { useCockpitCards } from '@/modules/cockpit/hooks/useCockpitCards';
import type { CockpitCardsBinding } from '@/modules/cockpit/hooks/useCockpitCards';

/**
 * The cards view's container: filters and density at the top, the card list and the Details
 * drawer. The confirmation is NOT drawn here: a pending confirmation turns the card's own bar
 * (or the drawer's) into its confirm state in place, so no dialog is mounted at the list level.
 *
 * IT IS A CONTAINER, NOT A SECOND MODEL. Every reading comes from a card binding (the page's own
 * `useCockpitCards`, or the column's shared one), and every command is one of that controller's.
 * The root publishes `data-cockpit-cards` — the same reading a scenario runner would otherwise
 * infer from the DOM — so visible order, selection, each card's shown option and confirm target,
 * and whether Details is open are all machine-readable. The pending confirm state is published
 * by the bar that draws it (`data-confirm-pending` + `data-card-id`), not by this container.
 *
 * TWO VARIANTS, ONE LIST. `page` is `/cockpit?view=cards`: the Details drawer floats over the
 * page and the list owns the global number keys. `column` is the PC right column: Details is
 * PUSHED INSIDE the list (with a back button, so the left session is never covered), and the
 * list owns no global keys — the column's own controller owns them, because it must also decide
 * whether the keyboard belongs to either input box.
 */

/** Every known card kind, in the order the type filter lists them. */
const KNOWN_KINDS: readonly CockpitCardKind[] = ['need', 'stuck', 'fix', 'ask', 'multi', 'decision'];

export type CockpitCardListVariant = 'page' | 'column';

export type CockpitCardListProps = {
  /**
   * The card binding to draw. Absent means "bind the page's own controller" — the `/cockpit`
   * cards view. The column passes its shared binding so the header count and the list are one
   * reading and one poll.
   */
  binding?: CockpitCardsBinding;
  /** `page` floats Details; `column` pushes it inside and leaves the keys to the column. */
  variant?: CockpitCardListVariant;
  /** The column's conversation link: open on the left, recording which card was opened. */
  onOpenConversation?: (card: CockpitCardData, sessionId: string) => void;
  /** The card currently opened on the left (the column marks it; the page passes nothing). */
  openedCardId?: string | null;
  /**
   * The session the left pane currently shows, read from the route by the column. Details marks
   * a card whose `conversation.sessionId` equals it as already open. Passed only by the column:
   * the phone/page variant leaves it null, so its link is unchanged.
   */
  currentSessionId?: string | null;
  /** The column's back button; defaults to closing the Details stack entry. */
  onBack?: () => void;
};

export default function CockpitCardList(props: CockpitCardListProps) {
  // Two components, not an if after a hook: the page's variant binds its own controller only
  // when no binding was handed in, so the column never starts a second poll for the same cards.
  return props.binding === undefined ? (
    <CockpitCardListWithOwnController {...props} />
  ) : (
    <CockpitCardListBound binding={props.binding} {...props} />
  );
}

function CockpitCardListWithOwnController(props: Omit<CockpitCardListProps, 'binding'>) {
  const binding = useCockpitCards();
  return <CockpitCardListBound binding={binding} {...props} />;
}

function CockpitCardListBound({
  binding,
  variant = 'page',
  onOpenConversation,
  openedCardId = null,
  currentSessionId = null,
  onBack,
}: CockpitCardListProps & { binding: CockpitCardsBinding }) {
  const { t } = useTranslation();
  // The page's Details is a bottom sheet on a phone and a centred card on a wide screen. The
  // column variant pushes its Details inside instead, so it never asks this question.
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const { snapshot, controller } = binding;
  const [startIntentProject, setStartIntentProject] = useState<string | null>(null);
  // The project drawer is open/closed state, not a filter: it is a transient overlay the person
  // dismisses, so it has no reason to outlive the visit (the selection itself is persisted).
  const [projectDrawerOpen, setProjectDrawerOpen] = useState(false);
  // The page's own scroll container. Only the `page` variant owns the offset: the column keeps
  // its own layout (and its Details is pushed inside), so reporting its scroll there would write
  // the column's position into the reading the phone page restores.
  const scrollRef = useRef<HTMLElement>(null);
  // Restored once, and only after the first successful read: before the cards exist the section
  // has no height to scroll, so an earlier write would be clamped to 0.
  const scrollRestoredRef = useRef(false);

  useEffect(() => {
    if (variant !== 'page' || scrollRestoredRef.current) return;
    if (snapshot.status !== 'loaded') return;
    const element = scrollRef.current;
    if (element === null) return;
    scrollRestoredRef.current = true;
    if (snapshot.scrollPosition > 0) element.scrollTop = snapshot.scrollPosition;
  }, [snapshot.scrollPosition, snapshot.status, variant]);

  /** Every scroll event persists the offset in the controller's memory (see `CockpitCardMemory`). */
  const handleScroll = (): void => {
    if (variant !== 'page') return;
    const element = scrollRef.current;
    if (element !== null) controller.setScrollPosition(element.scrollTop);
  };

  // Number keys select options; Escape is deliberately absent (it aborts a running turn
  // elsewhere in the app, and the cockpit must never swallow it). Keys typed into a field belong
  // to that field, so an editable target ends the handler.
  //
  // THE COLUMN VARIANT DOES NOT REGISTER THIS. There the column controller owns the keyboard:
  // it is the one that knows whether either input box has focus, and it routes the same digits
  // here. Two window listeners would apply one press twice.
  useEffect(() => {
    if (variant !== 'page') return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
          return;
        }
        // Enter on a focused control belongs to that control's own activation (the confirm
        // button turns its own state, a card's zone opens Details). Consuming it here as well
        // would make one press do two things — and the second press would send what the first
        // had just opened.
        if (
          event.key === 'Enter'
          && target.closest('button, a[href], [role="button"], [role="radio"]') !== null
        ) {
          return;
        }
      }
      if (controller.handleKey(event.key)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, variant]);

  const reading = cockpitCardsReading(snapshot);
  const detailsCardId = reading.detailsOpenCardId;
  const detailsCard =
    detailsCardId === null ? null : snapshot.cards.find((card) => card.id === detailsCardId) ?? null;
  const detailsInsideColumn = variant === 'column' && detailsCard !== null;
  // The confirm state belongs to ONE card, and every bar that card has (the card's own, and the
  // Details drawer's — a longer reading of the same card) draws it. A bar of another card stays
  // in its idle state, and the outcome is drawn only by the card that asked.
  const pendingCardId = snapshot.pendingConfirm?.cardId ?? null;
  const outcomeFor = (cardId: string) =>
    snapshot.lastOutcome !== null && snapshot.lastOutcome.cardId === cardId
      ? snapshot.lastOutcome
      : null;
  const closeDetails = (): void => {
    if (onBack !== undefined) {
      onBack();
      return;
    }
    controller.closeDetails();
  };

  // The type chips, in the order the list draws them. Each carries the count of cards that would
  // remain under the CURRENT PROJECT selection, so pressing a chip never promises a number the
  // list then does not show.
  const typeChips: { value: CockpitCardTypeFilter; label: string }[] = [
    { value: 'all', label: t('cockpit.cardFilterAll') },
    ...KNOWN_KINDS.map((kind) => ({
      value: kind as CockpitCardTypeFilter,
      label: t(cockpitCardDescriptor(kind).labelKey),
    })),
  ];
  // The project chip names the selection: one project by name, a count when several, or
  // 「All projects」 when none. The drawer, not the chip, is where the set is changed.
  const projectChipLabel =
    snapshot.projectFilters.length === 0
      ? t('cockpit.cardFilterAllProjects')
      : snapshot.projectFilters.length === 1
        ? snapshot.projectFilters[0]!
        : t('cockpit.cardFilterSelectedCount', { n: snapshot.projectFilters.length });

  return (
    <section
      ref={scrollRef}
      onScroll={handleScroll}
      data-testid="cockpit-card-list"
      data-cockpit-cards={JSON.stringify(reading)}
      data-cockpit-card-list-variant={variant}
      className={cn(
        'flex min-h-0 flex-1 flex-col p-2',
        detailsInsideColumn ? 'overflow-hidden' : 'overflow-auto',
      )}
    >
      {detailsInsideColumn && detailsCard !== null ? (
        <div
          data-testid="cockpit-column-details"
          data-card-id={detailsCard.id}
          className="flex min-h-0 flex-1 flex-col"
        >
          <button
            type="button"
            data-testid="cockpit-column-back"
            onClick={closeDetails}
            className="mb-2 flex flex-shrink-0 items-center gap-1 self-start rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t('cockpit.columnBack')}
          </button>
          <CockpitCardDetails
            inline
            card={detailsCard}
            now={snapshot.now}
            brief={snapshot.briefs[detailsCard.id]}
            onRetryBrief={() => controller.loadBrief(detailsCard.id)}
            onClose={closeDetails}
            target={snapshot.targets[detailsCard.id] ?? null}
            onRequestConfirm={() => controller.requestConfirm(detailsCard.id)}
            confirmPending={pendingCardId === detailsCard.id}
            confirming={snapshot.confirming}
            confirmOutcome={outcomeFor(detailsCard.id)}
            onConfirm={() => void controller.confirm()}
            onCancelConfirm={() => controller.cancelConfirm()}
            openedInSession={openedCardId === detailsCard.id}
            currentSessionId={currentSessionId}
            onOpenConversation={(sessionId: string) => onOpenConversation?.(detailsCard, sessionId)}
            onStartConversation={(card: CockpitCardData) =>
              setStartIntentProject(card.conversation?.startInProject ?? card.subject.project ?? '')
            }
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 pb-2">
            {/*
              THE TYPE CHIPS. A horizontally scrollable row rather than a dropdown: the counts are
              the point (a person reads what is waiting per type before choosing), and a closed
              select shows none of them. The chip carries the count as its own number, so it is
              readable both by eye and by a test that reads the chip.
            */}
            <div
              role="group"
              aria-label={t('cockpit.cardFilterType')}
              data-testid="cockpit-card-filter-types"
              className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto"
            >
              {typeChips.map((chip) => {
                const active = snapshot.typeFilter === chip.value;
                const count = snapshot.typeCounts[chip.value] ?? 0;
                return (
                  <button
                    key={chip.value}
                    type="button"
                    data-testid={`cockpit-card-filter-type-${chip.value}`}
                    data-count={count}
                    aria-pressed={active}
                    onClick={() => controller.setTypeFilter(chip.value)}
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent',
                    )}
                  >
                    <span>{chip.label}</span>
                    <span
                      data-testid={`cockpit-card-filter-count-${chip.value}`}
                      className="tabular-nums text-[11px] opacity-80"
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* The project chip opens the multi-select drawer; it never filters on its own. */}
            <button
              type="button"
              data-testid="cockpit-card-filter-project"
              aria-haspopup="dialog"
              aria-expanded={projectDrawerOpen}
              onClick={() => setProjectDrawerOpen((open) => !open)}
              className={cn(
                'flex min-w-0 max-w-44 shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-xs',
                snapshot.projectFilters.length > 0
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-accent',
              )}
            >
              <span className="truncate">{projectChipLabel}</span>
              <span aria-hidden className="text-[10px]">
                ▾
              </span>
            </button>

            <div className="ml-auto flex items-center gap-1" role="group" aria-label={t('cockpit.cardsView')}>
              <button
                type="button"
                data-testid="cockpit-card-density-cards"
                aria-pressed={snapshot.density === 'cards'}
                onClick={() => controller.setDensity('cards')}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  snapshot.density === 'cards'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {t('cockpit.cardDensityCards')}
              </button>
              <button
                type="button"
                data-testid="cockpit-card-density-compact"
                aria-pressed={snapshot.density === 'compact'}
                onClick={() => controller.setDensity('compact')}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs',
                  snapshot.density === 'compact'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {t('cockpit.cardDensityCompact')}
              </button>
            </div>
          </div>

          {/*
            THE PROJECT DRAWER. A bottom sheet on a phone and a centred card on a wide screen:
            one dialog, positioned by breakpoint. Each row is a checkbox, so the set is built
            without closing the sheet, and the count beside a project is what the TYPE filter
            would leave there. 「Show N items」 states what the list behind it will draw.
          */}
          {projectDrawerOpen && (
            <div
              data-testid="cockpit-card-project-drawer"
              role="dialog"
              aria-modal="true"
              aria-label={t('cockpit.cardFilterProjectsTitle')}
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-2 sm:items-center"
            >
              <div className="flex max-h-[80vh] w-full max-w-sm flex-col rounded-xl border border-border bg-card p-3 text-card-foreground shadow-xl">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-foreground">
                    {t('cockpit.cardFilterProjectsTitle')}
                  </p>
                  <button
                    type="button"
                    data-testid="cockpit-card-project-clear"
                    onClick={() => controller.clearProjectFilters()}
                    className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
                  >
                    {t('cockpit.cardFilterClear')}
                  </button>
                </div>
                <ul className="mt-2 min-h-0 flex-1 overflow-y-auto">
                  {snapshot.projects.map((project) => (
                    <li key={project}>
                      <label className="flex items-center gap-2 rounded-md px-1 py-1.5 text-xs hover:bg-accent">
                        <input
                          type="checkbox"
                          data-testid={`cockpit-card-project-option-${project}`}
                          checked={snapshot.projectFilters.includes(project)}
                          onChange={() => controller.toggleProjectFilter(project)}
                          className="h-4 w-4"
                        />
                        <span className="min-w-0 flex-1 truncate text-foreground">{project}</span>
                        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                          {snapshot.projectCounts[project] ?? 0}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  data-testid="cockpit-card-project-done"
                  onClick={() => setProjectDrawerOpen(false)}
                  className="mt-2 rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  {t('cockpit.cardFilterShow', { n: snapshot.visibleCards.length })}
                </button>
              </div>
            </div>
          )}

          {snapshot.status === 'error' && snapshot.error !== null && (
            <p role="alert" data-testid="cockpit-card-error" className="pb-2 text-xs text-destructive">
              {t('cockpit.cardError', { reason: snapshot.error })}
            </p>
          )}

          {startIntentProject !== null && (
            <p
              role="status"
              data-testid="cockpit-card-start-intent"
              className="pb-2 text-xs text-muted-foreground"
            >
              {t('cockpit.cardStartConversationEcho', { project: startIntentProject })}
            </p>
          )}

          {snapshot.visibleCards.length === 0 && snapshot.status === 'loaded' && (
            <p data-testid="cockpit-card-empty" className="text-xs text-muted-foreground">
              {t('cockpit.cardEmpty')}
            </p>
          )}

          <div className="flex flex-col gap-2">
            {snapshot.visibleCards.map((card) => (
              <CockpitCard
                key={card.id}
                card={card}
                now={snapshot.now}
                shown={snapshot.shown[card.id]}
                target={snapshot.targets[card.id] ?? null}
                ownReply={snapshot.ownReplies[card.id] ?? ''}
                dropdownOpen={snapshot.openDropdownCardId === card.id}
                selected={snapshot.selectedCardId === card.id}
                density={snapshot.density}
                situationExpanded={snapshot.situationExpanded[card.id] === card.revision}
                onToggleSituationExpanded={() => controller.toggleSituationExpanded(card.id)}
                onSelect={() => controller.selectCard(card.id)}
                onOpenDetails={() => controller.openDetails(card.id)}
                onToggleDropdown={() =>
                  controller.openDropdown(snapshot.openDropdownCardId === card.id ? null : card.id)
                }
                onShowOption={(optionId) => controller.showOption(card.id, optionId)}
                onShowOwnReply={() => controller.showOwnReply(card.id)}
                onOwnReplyChange={(text) => controller.setOwnReply(card.id, text)}
                onRequestConfirm={() => controller.requestConfirm(card.id)}
                confirmPending={pendingCardId === card.id}
                confirming={snapshot.confirming}
                outcome={outcomeFor(card.id)}
                onConfirm={() => void controller.confirm()}
                onCancelConfirm={() => controller.cancelConfirm()}
              />
            ))}
          </div>

          {/* The page variant's Details drawer: a floating layer over the cards — a bottom sheet
              pinned to the phone's bottom edge, a centred card on a wide screen. The column
              variant never reaches this branch — its Details is pushed in above. */}
          {detailsCard !== null && (
            <div
              data-testid="cockpit-card-details-layer"
              data-drawer={isMobile ? 'true' : 'false'}
              className={cn(
                'fixed inset-0 z-40 flex justify-center bg-black/30',
                isMobile ? 'items-end p-0' : 'items-center p-2',
              )}
            >
              <CockpitCardDetails
                drawer={isMobile}
                card={detailsCard}
                now={snapshot.now}
                brief={snapshot.briefs[detailsCard.id]}
                onRetryBrief={() => controller.loadBrief(detailsCard.id)}
                onClose={() => controller.closeDetails()}
                target={snapshot.targets[detailsCard.id] ?? null}
                onRequestConfirm={() => controller.requestConfirm(detailsCard.id)}
                confirmPending={pendingCardId === detailsCard.id}
                confirming={snapshot.confirming}
                confirmOutcome={outcomeFor(detailsCard.id)}
                onConfirm={() => void controller.confirm()}
                onCancelConfirm={() => controller.cancelConfirm()}
                onOpenConversation={
                  onOpenConversation === undefined
                    ? undefined
                    : (sessionId: string) => onOpenConversation(detailsCard, sessionId)
                }
                openedInSession={openedCardId === detailsCard.id}
                onStartConversation={(card: CockpitCardData) =>
                  setStartIntentProject(card.conversation?.startInProject ?? card.subject.project ?? '')
                }
              />
            </div>
          )}
        </>
      )}

    </section>
  );
}
