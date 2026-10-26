import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { CockpitCard as CockpitCardData } from '@/shared/types';
import { cn } from '@/shared/utils';
import { cockpitCardDescriptor } from '@/modules/cockpit/cockpitCardDescriptors';

/**
 * The Details drawer a tap on a card's A zone opens: the full question, the situation and its
 * facts, every option in rich text, and the conversation section.
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
};

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
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-3">
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
}: CockpitCardDetailsProps) {
  const { t } = useTranslation();
  const descriptor = cockpitCardDescriptor(card.kind);
  const sessionId = card.conversation?.sessionId;
  const startProject = card.conversation?.startInProject ?? card.subject.project;

  return (
    <aside
      data-testid="cockpit-card-details"
      data-cockpit-card-details-id={card.id}
      className="flex max-h-[90vh] w-full flex-col overflow-auto rounded-xl border border-border bg-card p-3 text-card-foreground shadow-xl"
    >
      <div className="flex items-center justify-between gap-2">
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
        <button
          type="button"
          data-testid="cockpit-card-details-close"
          onClick={onClose}
          className="shrink-0 rounded-md border border-border px-2 py-0.5 text-xs hover:bg-accent"
        >
          {t('cockpit.cardDetailsClose')}
        </button>
      </div>

      <p className="mt-2 text-sm font-medium text-foreground">
        {card.ask ?? card.situation ?? card.subject.uri}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {[card.subject.project, card.subject.taskId, card.subject.sessionId]
          .filter((part): part is string => part !== undefined && part !== '')
          .join(' · ')}
      </p>

      {card.situation !== undefined && (
        <Section title={t('cockpit.cardDetailsSituation')}>
          <p className="text-xs text-foreground">{card.situation}</p>
        </Section>
      )}

      {card.facts.length > 0 && (
        <Section title={t('cockpit.cardDetailsFacts')}>
          <ul className="space-y-0.5" data-testid="cockpit-card-details-facts">
            {card.facts.map((fact, index) => (
              <li key={`${fact.text}:${index}`} className="flex items-start gap-1 text-xs text-foreground">
                <span aria-hidden className={cn('mt-1.5 h-1 w-1 shrink-0 rounded-full', fact.mechanical ? 'bg-primary' : 'bg-muted-foreground')} />
                <span className={fact.mechanical ? '' : 'italic'}>{fact.text}</span>
              </li>
            ))}
          </ul>
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
        {sessionId !== undefined ? (
          <a
            data-testid="cockpit-card-conversation-link"
            href={`/session/${encodeURIComponent(sessionId)}`}
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
    </aside>
  );
}
