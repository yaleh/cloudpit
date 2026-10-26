import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { CockpitCard as CockpitCardData, CockpitCardKind } from '@/shared/types';
import { cn } from '@/shared/utils';
import { cockpitCardDescriptor } from '@/modules/cockpit/cockpitCardDescriptors';
import type { CockpitCardTypeFilter } from '@/modules/cockpit/cockpitCardController';
import { cockpitCardsReading } from '@/modules/cockpit/cockpitCardController';
import CockpitCard from '@/modules/cockpit/CockpitCard';
import CockpitCardDetails from '@/modules/cockpit/CockpitCardDetails';
import { useCockpitCards } from '@/modules/cockpit/hooks/useCockpitCards';

/**
 * The cards view's container: filters and density at the top, the card list, the one confirm
 * card and the Details drawer.
 *
 * IT IS A CONTAINER, NOT A SECOND MODEL. Every reading comes from `useCockpitCards` (which binds
 * `createCockpitCardController`), and every command is one of the controller's. The root
 * publishes `data-cockpit-cards` — the same reading a scenario runner would otherwise infer from
 * the DOM — so visible order, selection, each card's shown option and confirm target, and
 * whether Details is open are all machine-readable.
 */

/** Every known card kind, in the order the type filter lists them. */
const KNOWN_KINDS: readonly CockpitCardKind[] = ['need', 'stuck', 'fix', 'ask', 'multi', 'decision'];

export default function CockpitCardList() {
  const { t } = useTranslation();
  const { snapshot, controller } = useCockpitCards();
  const [startIntentProject, setStartIntentProject] = useState<string | null>(null);

  // Number keys select options; Escape is deliberately absent (it aborts a running turn
  // elsewhere in the app, and the cockpit must never swallow it). Keys typed into a field belong
  // to that field, so an editable target ends the handler.
  useEffect(() => {
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
  }, [controller]);

  const reading = cockpitCardsReading(snapshot);
  const detailsCardId = reading.detailsOpenCardId;
  const detailsCard =
    detailsCardId === null ? null : snapshot.cards.find((card) => card.id === detailsCardId) ?? null;
  const pending = snapshot.pendingConfirm;

  return (
    <section
      data-testid="cockpit-card-list"
      data-cockpit-cards={JSON.stringify(reading)}
      className="flex min-h-0 flex-1 flex-col overflow-auto p-2"
    >
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

      {detailsCard !== null && (
        <div
          data-testid="cockpit-card-details-layer"
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-2 sm:items-center"
        >
          <CockpitCardDetails
            card={detailsCard}
            now={snapshot.now}
            onClose={() => controller.closeDetails()}
            onStartConversation={(card: CockpitCardData) =>
              setStartIntentProject(card.conversation?.startInProject ?? card.subject.project ?? '')
            }
          />
        </div>
      )}
    </section>
  );
}
