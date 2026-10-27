import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { CockpitCard as CockpitCardData, CockpitCardOption } from '@/shared/types';
import { cn } from '@/shared/utils';
import {
  COCKPIT_SOURCE_LABEL_KEY,
  cockpitCardDescriptor,
  cockpitCardSubjectName,
  cockpitCardTitle,
  cockpitCardToneClass,
  cockpitTagIcon,
} from '@/modules/cockpit/cockpitCardDescriptors';
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
      className="mt-1.5 rounded-md bg-muted/50 px-2 py-1.5"
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

        {/* Why the local content resolver could not fill this card: drawn where the missing
            situation would have been, so the card never reads as an unexplained blank. */}
        {card.contentUnavailable !== undefined && (
          <p
            data-testid="cockpit-card-content-unavailable"
            className={cn(
              'mt-0.5 text-xs text-muted-foreground',
              compact ? 'line-clamp-1' : 'line-clamp-2',
            )}
          >
            {card.contentUnavailable}
          </p>
        )}

        {card.situation !== undefined && card.situation !== card.ask && (
          <p
            data-testid="cockpit-card-zone-a-situation"
            className={cn('mt-0.5 text-xs text-muted-foreground', compact ? 'line-clamp-1' : 'line-clamp-2')}
          >
            {card.situation}
          </p>
        )}

        {/* Facts as pills (● mechanical / ○ judgement) with the small viz on the right. The full
            fact text is always in Details. Compact mode keeps the card to three lines, so it
            draws neither. */}
        {!compact && (card.facts.length > 0 || card.viz !== undefined) && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {card.facts.length > 0 && (
              <div
                data-testid="cockpit-card-zone-a-facts"
                className="flex min-w-0 flex-wrap items-center gap-1"
              >
                {card.facts.map((fact, index) => (
                  <span
                    key={`${fact.text}:${index}`}
                    data-testid="cockpit-card-fact"
                    data-mechanical={fact.mechanical ? 'true' : 'false'}
                    title={fact.text}
                    className="max-w-[16rem] truncate rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                  >
                    <span aria-hidden className="mr-0.5">{fact.mechanical ? '●' : '○'}</span>
                    {fact.text}
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
        {/* B zone: one dropdown whose last item is the person's own reply. */}
        <div className={cn('min-w-0', compact ? 'flex-1' : '')} data-testid="cockpit-card-options">
          <button
            type="button"
            data-testid="cockpit-card-option-trigger"
            data-source={shownOption?.source ?? null}
            data-suggested={shownOption?.suggested === true ? 'true' : 'false'}
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

          {/* The full explanation belongs to the Cards density; Compact stays three lines, so the
              description lives only in the open dropdown and in Details. */}
          {!compact && !dropdownOpen && shownOption !== null && (
            <ShownOptionExplanation option={shownOption} />
          )}
          {!compact && !dropdownOpen && showingOwnReply && ownReplyAvailable && (
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

        {/* C zone: one confirm bar, bound to the shown option, opening the confirm card only.
            With no recommendation there is nothing to bind, so the card draws one quiet line
            instead of a full-width button that looks pressable and does nothing. */}
        <div className={cn(compact ? 'shrink-0' : '')}>
          {target === null ? (
            <p
              data-testid="cockpit-card-confirm-empty"
              className={cn(
                'text-[11px] text-muted-foreground',
                compact ? 'w-20 self-center text-center leading-tight' : 'rounded-md border border-dashed border-border px-2 py-2 text-center',
              )}
            >
              {t('cockpit.cardChooseThenConfirm')}
            </p>
          ) : (
            <>
              <button
                type="button"
                data-testid="cockpit-card-confirm"
                data-irreversible={target.irreversible === true ? 'true' : 'false'}
                disabled={target.disabled}
                onClick={onRequestConfirm}
                className={cn(
                  'flex items-center justify-center gap-1 rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50',
                  compact ? 'w-auto' : 'w-full',
                  target.irreversible === true
                    ? 'border border-amber-500 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                    : 'bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200',
                )}
              >
                {target.irreversible === true && <span aria-hidden>⚠</span>}
                <span className="truncate">
                  {compact ? t('cockpit.cardConfirmShort') : confirmLabel}
                </span>
              </button>
              {!compact && (
                <p
                  data-testid="cockpit-card-confirm-hint"
                  className="mt-1 text-center text-[10px] text-muted-foreground"
                >
                  {t('cockpit.cardConfirmHint')}
                </p>
              )}
              {target.disabledReason !== null && (
                <p
                  data-testid="cockpit-card-confirm-disabled-reason"
                  className="mt-0.5 text-[10px] text-muted-foreground"
                >
                  {target.disabledReason}
                </p>
              )}
              {target.irreversible === true && (
                <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-300">
                  {t('cockpit.cardIrreversible')}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </article>
  );
}
