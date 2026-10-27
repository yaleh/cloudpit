import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type {
  CockpitCard as CockpitCardData,
  CockpitCardOption,
  CockpitCardOptionSource,
} from '@/shared/types';
import { cn } from '@/shared/utils';
import { cockpitCardDescriptor } from '@/modules/cockpit/cockpitCardDescriptors';
import CockpitCardViz from '@/modules/cockpit/CockpitCardViz';
import type {
  CockpitCardConfirmTarget,
  CockpitCardDensity,
  CockpitCardShown,
} from '@/modules/cockpit/cockpitCardController';
import { shownOptionOf } from '@/modules/cockpit/cockpitCardController';

/**
 * One cockpit card, drawn as the three touch zones the design names:
 *
 *   A — header, question, situation, facts: a tap opens the Details drawer. There is no separate
 *       Details button, because the whole upper body IS the affordance (the `›` is the hint).
 *   B — the option dropdown: the trigger names the currently shown option, its source and
 *       `k of n`; the open list explains every option in rich text and ends with the person's own
 *       reply editor.
 *   C — the one confirm bar: its label carries the shown option's name and it only opens the
 *       confirm card. Nothing is sent from here.
 *
 * The component is presentational: every reading and every command comes from
 * `createCockpitCardController`, so "switching the shown option switches the confirm target" is
 * a property of the state, not of this file's event wiring.
 */

const SOURCE_LABEL_KEY: Record<CockpitCardOptionSource, string> = {
  assistant: 'cockpit.cardSourceAssistant',
  judge: 'cockpit.cardSourceJudge',
  provider: 'cockpit.cardSourceProvider',
};

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
  onSelect: () => void;
  onOpenDetails: () => void;
  onToggleDropdown: () => void;
  onShowOption: (optionId: string) => void;
  onShowOwnReply: () => void;
  onOwnReplyChange: (text: string) => void;
  onRequestConfirm: () => void;
};

/** `waiting 12m` — the card's age, read through the cockpit's existing relative-time copy. */
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

/** The consequence tags of one option, warning tags drawn in the irreversible colour. */
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
            tag.kind === 'warn'
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
              : 'bg-muted text-muted-foreground',
          )}
        >
          {tag.text}
        </span>
      ))}
    </span>
  );
}

/** The full explanation of the option a card currently shows, outside the open dropdown. */
function ShownOptionExplanation({ option }: { option: CockpitCardOption }) {
  return (
    <div data-testid="cockpit-card-shown-option" className="mt-1.5 rounded-md bg-muted/50 px-2 py-1.5">
      <p className="text-xs text-foreground">{option.does}</p>
      {option.why !== undefined && (
        <p className="mt-1 text-[11px] text-muted-foreground">{option.why}</p>
      )}
      {option.warn !== undefined && (
        <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{option.warn}</p>
      )}
      <OptionTags option={option} />
      {option.undo !== undefined && (
        <p className="mt-1 text-[11px] text-muted-foreground">{option.undo}</p>
      )}
    </div>
  );
}

/** The own-reply editor: the last item of the dropdown and the card body's form when shown. */
function OwnReplyEditor({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <div className="mt-1.5">
      <label className="block">
        <span className="text-[11px] font-medium text-foreground">{label}</span>
        <textarea
          data-testid="cockpit-card-own-reply-input"
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

export default function CockpitCard({
  card,
  now,
  shown,
  target,
  ownReply,
  dropdownOpen,
  selected,
  density,
  onSelect,
  onOpenDetails,
  onToggleDropdown,
  onShowOption,
  onShowOwnReply,
  onOwnReplyChange,
  onRequestConfirm,
}: CockpitCardProps) {
  const { t } = useTranslation();
  const descriptor = cockpitCardDescriptor(card.kind);
  const shownOption = shownOptionOf(card, shown);
  const showingOwnReply = shown?.kind === 'ownReply';
  const compact = density === 'compact';
  const ownReplyAvailable = card.ownReply !== undefined;
  const question = card.ask ?? card.situation ?? card.subject.uri;

  const shownLabel = showingOwnReply
    ? t('cockpit.cardWriteOwn')
    : (shownOption?.label ?? t('cockpit.cardChooseOption'));
  const shownSource = shownOption === null ? null : t(SOURCE_LABEL_KEY[shownOption.source] ?? 'cockpit.cardSourceProvider');
  const shownPosition =
    shownOption === null
      ? null
      : t('cockpit.cardOptionPosition', {
          k: card.options.findIndex((option) => option.id === shownOption.id) + 1,
          n: card.options.length,
        });
  const confirmLabel =
    target === null || (showingOwnReply && target.label === '')
      ? t('cockpit.cardConfirmNoOption')
      : t(showingOwnReply ? 'cockpit.cardConfirmOwnReply' : 'cockpit.cardConfirm', {
          label: target.label || shownLabel,
        });

  return (
    <article
      data-testid={`cockpit-card-${card.id}`}
      data-cockpit-card-id={card.id}
      data-card-kind={card.kind}
      data-selected={selected ? 'true' : 'false'}
      className={cn(
        'rounded-xl border bg-card text-card-foreground shadow-sm',
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
        <div
          data-testid="cockpit-card-zone-a-header"
          className="flex items-center justify-between gap-2"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
              {t(descriptor.labelKey)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {t('cockpit.cardWaitingFor', { duration: waitingText(t, now, card.waitingSince) })}
            </span>
          </span>
          <span aria-hidden className="shrink-0 text-muted-foreground">›</span>
        </div>

        {/* The known kind's one small reading, drawn only when the descriptor allows it. */}
        <CockpitCardViz card={card} />

        <p
          data-testid="cockpit-card-zone-a-question"
          className={cn('mt-1 text-sm font-medium text-foreground', compact && 'line-clamp-2')}
        >
          {question}
        </p>

        {card.situation !== undefined && card.situation !== card.ask && (
          <p
            data-testid="cockpit-card-zone-a-situation"
            className={cn('mt-0.5 text-xs text-muted-foreground', compact ? 'line-clamp-1' : 'line-clamp-2')}
          >
            {card.situation}
          </p>
        )}

        {!compact && card.facts.length > 0 && (
          <ul data-testid="cockpit-card-zone-a-facts" className="mt-1 space-y-0.5">
            {card.facts.map((fact, index) => (
              <li
                key={`${fact.text}:${index}`}
                className="flex items-start gap-1 text-[11px] text-muted-foreground"
              >
                <span aria-hidden className="mt-1 h-1 w-1 shrink-0 rounded-full bg-current" />
                <span className={cn(fact.mechanical ? '' : 'italic')}>{fact.text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cn(compact ? 'mt-1.5 flex items-start gap-2' : 'mt-2 space-y-2')}>
        {/* B zone: one dropdown whose last item is the person's own reply. */}
        <div className={cn('min-w-0', compact ? 'flex-1' : '')} data-testid="cockpit-card-options">
          <button
            type="button"
            data-testid="cockpit-card-option-trigger"
            aria-expanded={dropdownOpen}
            onClick={onToggleDropdown}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1.5 text-left text-xs hover:bg-accent"
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

          {!dropdownOpen && shownOption !== null && <ShownOptionExplanation option={shownOption} />}
          {!dropdownOpen && showingOwnReply && ownReplyAvailable && (
            <OwnReplyEditor
              value={ownReply}
              onChange={onOwnReplyChange}
              label={t('cockpit.cardWriteOwn')}
              placeholder={t('cockpit.cardOwnReplyPlaceholder')}
            />
          )}

          {dropdownOpen && (
            <div
              data-testid="cockpit-card-option-list"
              className="mt-1 max-h-80 space-y-1 overflow-auto rounded-md border border-border bg-popover p-1.5 shadow-lg"
            >
              {card.options.map((option, index) => {
                const isShown = shownOption?.id === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    data-testid={`cockpit-card-option-${option.id}`}
                    aria-pressed={isShown}
                    onClick={() => onShowOption(option.id)}
                    className={cn(
                      'block w-full rounded-md px-2 py-1.5 text-left hover:bg-accent',
                      isShown && 'bg-accent/70',
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] tabular-nums text-muted-foreground">{index + 1}</span>
                      <span className="text-xs font-medium text-foreground">{option.label}</span>
                      {option.suggested && (
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          {t('cockpit.cardSuggested')}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground">
                        {t(SOURCE_LABEL_KEY[option.source] ?? 'cockpit.cardSourceProvider')}
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
                    data-testid="cockpit-card-own-reply-trigger"
                    onClick={onShowOwnReply}
                    className="text-xs font-medium text-foreground hover:underline"
                  >
                    ✎ {t('cockpit.cardWriteOwn')}
                  </button>
                  <OwnReplyEditor
                    value={ownReply}
                    onChange={onOwnReplyChange}
                    label={t('cockpit.cardWriteOwn')}
                    placeholder={t('cockpit.cardOwnReplyPlaceholder')}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* C zone: one confirm bar, bound to the shown option, opening the confirm card only. */}
        <div className={cn(compact ? 'shrink-0' : '')}>
          <button
            type="button"
            data-testid="cockpit-card-confirm"
            data-irreversible={target?.irreversible === true ? 'true' : 'false'}
            disabled={target === null || target.disabled}
            onClick={onRequestConfirm}
            className={cn(
              'flex w-full items-center justify-center gap-1 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50',
              target?.irreversible === true
                ? 'border border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                : 'bg-primary text-primary-foreground',
            )}
          >
            {target?.irreversible === true && <span aria-hidden>⚠</span>}
            <span className="truncate">{confirmLabel}</span>
          </button>
          {target?.irreversible === true && (
            <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">
              {t('cockpit.cardIrreversible')}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
