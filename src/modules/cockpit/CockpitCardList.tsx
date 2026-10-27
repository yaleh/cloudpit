import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';

import type { CockpitCard as CockpitCardData, CockpitCardKind } from '@/shared/types';
import { cn } from '@/shared/utils';
import { cockpitCardDescriptor } from '@/modules/cockpit/cockpitCardDescriptors';
import type { CockpitCardTypeFilter } from '@/modules/cockpit/cockpitCardController';
import { cockpitCardsReading } from '@/modules/cockpit/cockpitCardController';
import CockpitCard from '@/modules/cockpit/CockpitCard';
import CockpitCardDetails from '@/modules/cockpit/CockpitCardDetails';
import { useCockpitCards } from '@/modules/cockpit/hooks/useCockpitCards';
import type { CockpitCardsBinding } from '@/modules/cockpit/hooks/useCockpitCards';

/**
 * The cards view's container: filters and density at the top, the card list, the one confirm
 * card and the Details drawer.
 *
 * IT IS A CONTAINER, NOT A SECOND MODEL. Every reading comes from a card binding (the page's own
 * `useCockpitCards`, or the column's shared one), and every command is one of that controller's.
 * The root publishes `data-cockpit-cards` — the same reading a scenario runner would otherwise
 * infer from the DOM — so visible order, selection, each card's shown option and confirm target,
 * and whether Details is open are all machine-readable.
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
  onBack,
}: CockpitCardListProps & { binding: CockpitCardsBinding }) {
  const { t } = useTranslation();
  const { snapshot, controller } = binding;
  const [startIntentProject, setStartIntentProject] = useState<string | null>(null);
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
  const pending = snapshot.pendingConfirm;
  const detailsInsideColumn = variant === 'column' && detailsCard !== null;
  const closeDetails = (): void => {
    if (onBack !== undefined) {
      onBack();
      return;
    }
    controller.closeDetails();
  };

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
            openedInSession={openedCardId === detailsCard.id}
            onOpenConversation={(sessionId: string) => onOpenConversation?.(detailsCard, sessionId)}
            onStartConversation={(card: CockpitCardData) =>
              setStartIntentProject(card.conversation?.startInProject ?? card.subject.project ?? '')
            }
          />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>{t('cockpit.cardFilterType')}</span>
              <select
                data-testid="cockpit-card-filter-type"
                value={snapshot.typeFilter}
                onChange={(event) =>
                  controller.setTypeFilter(event.target.value as CockpitCardTypeFilter)
                }
                className="rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
              >
                <option value="all">{t('cockpit.cardFilterAll')}</option>
                {KNOWN_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {t(cockpitCardDescriptor(kind).labelKey)}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>{t('cockpit.cardFilterProject')}</span>
              <select
                data-testid="cockpit-card-filter-project"
                value={snapshot.projectFilter ?? ''}
                onChange={(event) =>
                  controller.setProjectFilter(event.target.value === '' ? null : event.target.value)
                }
                className="max-w-40 rounded-md border border-border bg-background px-1.5 py-1 text-xs text-foreground"
              >
                <option value="">{t('cockpit.cardFilterAllProjects')}</option>
                {snapshot.projects.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </select>
            </label>

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

          {snapshot.status === 'error' && snapshot.error !== null && (
            <p role="alert" data-testid="cockpit-card-error" className="pb-2 text-xs text-destructive">
              {t('cockpit.cardError', { reason: snapshot.error })}
            </p>
          )}

          {snapshot.lastOutcome !== null && (
            <p
              role={snapshot.lastOutcome.ok ? 'status' : 'alert'}
              data-testid="cockpit-card-outcome"
              data-ok={snapshot.lastOutcome.ok ? 'true' : 'false'}
              className={cn(
                'pb-2 text-xs',
                snapshot.lastOutcome.ok ? 'text-muted-foreground' : 'text-destructive',
              )}
            >
              {snapshot.lastOutcome.ok
                ? t('cockpit.cardConfirmDone', { executor: snapshot.lastOutcome.executor })
                : t('cockpit.cardConfirmFailed', { reason: snapshot.lastOutcome.message })}
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
                onSelect={() => controller.selectCard(card.id)}
                onOpenDetails={() => controller.openDetails(card.id)}
                onToggleDropdown={() =>
                  controller.openDropdown(snapshot.openDropdownCardId === card.id ? null : card.id)
                }
                onShowOption={(optionId) => controller.showOption(card.id, optionId)}
                onShowOwnReply={() => controller.showOwnReply(card.id)}
                onOwnReplyChange={(text) => controller.setOwnReply(card.id, text)}
                onRequestConfirm={() => controller.requestConfirm(card.id)}
              />
            ))}
          </div>

          {/* The page variant's Details drawer: a floating layer over the cards. The column
              variant never reaches this branch — its Details is pushed in above. */}
          {detailsCard !== null && (
            <div
              data-testid="cockpit-card-details-layer"
              className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-2 sm:items-center"
            >
              <CockpitCardDetails
                card={detailsCard}
                now={snapshot.now}
                brief={snapshot.briefs[detailsCard.id]}
                onRetryBrief={() => controller.loadBrief(detailsCard.id)}
                onClose={() => controller.closeDetails()}
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

      {pending !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cockpit-card-confirm-title"
          data-testid="cockpit-card-confirm-panel"
          data-card-id={pending.cardId}
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-border bg-card p-3 text-card-foreground shadow-xl"
        >
          <p id="cockpit-card-confirm-title" className="text-sm font-semibold text-foreground">
            {t('cockpit.cardConfirmTitle')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('cockpit.cardConfirmBody', { label: pending.label })}
          </p>
          {pending.irreversible && (
            <p data-testid="cockpit-card-confirm-warning" className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              ⚠ {t('cockpit.cardConfirmIrreversible')}
            </p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              data-testid="cockpit-card-confirm-cancel"
              onClick={() => controller.cancelConfirm()}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
            >
              {t('cockpit.cardConfirmCancel')}
            </button>
            <button
              type="button"
              data-testid="cockpit-card-confirm-send"
              disabled={snapshot.confirming}
              onClick={() => void controller.confirm()}
              className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {t('cockpit.cardConfirmSend')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
