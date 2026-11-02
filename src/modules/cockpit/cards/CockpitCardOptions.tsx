import { useTranslation } from 'react-i18next';

import {
  COCKPIT_SOURCE_LABEL_KEY,
  cockpitTagIcon,
} from '@/modules/cockpit/cockpitCardDescriptors';
import type { CockpitCard as CockpitCardData, CockpitCardOption } from '@/shared/types';
import { cn } from '@/shared/utils';

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
 * same string. Consumers: `CockpitCardOptions` (the dropdown and the body form) and
 * `CockpitCardDetails` (the drawer's own-reply row, through `CockpitCard`'s re-export).
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

export type CockpitCardOptionsProps = {
  /** The card whose options and own reply are drawn. */
  card: CockpitCardData;
  /** Compact keeps three lines: no full explanation and no body editor. */
  compact: boolean;
  dropdownOpen: boolean;
  /** True while a feedback overlay exists: the trigger is locked and the list is not drawn. */
  feedbackLocked: boolean;
  /** True when the card states no readable content and no options: draws its two real answers. */
  emptyAskContent: boolean;
  /** The conversation an empty card belongs to, already resolved by `CockpitCard`. */
  conversationSessionId: string;
  /** The person's in-progress own reply. */
  ownReply: string;
  /** True when the card declares an own-reply executor. */
  ownReplyAvailable: boolean;
  /** The option the controller currently shows, or `null` when it has no reading. */
  shownOption: CockpitCardOption | null;
  /** True when the shown reading is the person's own reply rather than one option. */
  showingOwnReply: boolean;
  /** The trigger's label, already translated by `CockpitCard`. */
  shownLabel: string;
  /** The trigger's source label, already translated; `null` when nothing is shown. */
  shownSource: string | null;
  /** The trigger's `k of n` reading, already translated; `null` when nothing is shown. */
  shownPosition: string | null;
  onToggleDropdown: () => void;
  onShowOption: (optionId: string) => void;
  onShowOwnReply: () => void;
  onOwnReplyChange: (text: string) => void;
};

/**
 * The B zone: one dropdown whose last item is the person's own reply, and the full explanation
 * of the option the card currently shows.
 *
 * It is a pure presentational block: `CockpitCard` owns every reading and forwards every event,
 * so "switching the shown option" is a controller state change, never this file's decision. A
 * card with no readable content and no options draws neither the dropdown nor its trigger; it
 * offers only the conversation it belongs to and the person's own reply. Used by `CockpitCard`
 * only.
 */
export default function CockpitCardOptions({
  card,
  compact,
  dropdownOpen,
  feedbackLocked,
  emptyAskContent,
  conversationSessionId,
  ownReply,
  ownReplyAvailable,
  shownOption,
  showingOwnReply,
  shownLabel,
  shownSource,
  shownPosition,
  onToggleDropdown,
  onShowOption,
  onShowOwnReply,
  onOwnReplyChange,
}: CockpitCardOptionsProps) {
  const { t } = useTranslation();
  return (
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
  );
}
