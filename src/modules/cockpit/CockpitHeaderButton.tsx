import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Gauge } from 'lucide-react';

import { cn } from '@/shared/utils';
import { useCockpitColumnContext } from '@/modules/cockpit/hooks/useCockpitColumn';
import type { CockpitColumnBinding } from '@/modules/cockpit/hooks/useCockpitColumn';

/**
 * The session header's cockpit button: one gauge, the open-card count as a red badge, and a
 * pressed state while the column is open.
 *
 * IT IS THE COCKPIT'S ONLY ENTRY POINT IN THE SESSION HEADER. The design replaced the narrow
 * collapsed strip with a count in the header, so this button both announces 「有 N 件事在等你」
 * and opens the surface. It draws at the header's `⋯` size and border because it sits beside that
 * menu; a differently sized control would read as a different class of action.
 *
 * TWO SURFACES, ONE READING. At 900 px and wider the button opens/closes the PC column. Below
 * that the column does not exist (the phone model owns the width), so the same button is the door
 * to `/cockpit?view=cards` and keeps reading the same controller's count — the phone header is not
 * a second instrument with a second number.
 *
 * NO PROVIDER, NO BUTTON. The header also renders in isolation in tests and on screens where
 * the cockpit is switched off; with no surrounding column binding there is nothing to open, so
 * drawing a dead button would be worse than drawing none.
 */
export type CockpitHeaderButtonVariant = 'column' | 'page';

export default function CockpitHeaderButton({
  variant = 'column',
}: {
  /**
   * `column` (the default) is the PC entry point and keeps the pre-phone behaviour exactly: no
   * column at this width means no button. `page` is what the phone header asks for — the cards
   * page at `/cockpit?view=cards`.
   */
  variant?: CockpitHeaderButtonVariant;
} = {}) {
  const { t } = useTranslation();
  const column = useCockpitColumnContext();

  if (column === null) return null;
  if (variant === 'page') return <CockpitPageButton column={column} />;
  // Below 900 px the column does not exist; the desktop header draws no cockpit entry there.
  if (column.snapshot.layout === 'hidden') return null;

  const { snapshot, controller } = column;
  const label = snapshot.expanded
    ? t('cockpit.columnCollapse')
    : t('cockpit.columnExpand');

  return (
    <CockpitButton
      count={snapshot.openCount}
      label={label}
      pressed={snapshot.expanded}
      onClick={() => controller.toggle()}
    />
  );
}

/**
 * The phone's variant of the same control: no column to toggle, so it navigates to the cards page.
 * It reads the count from the same column binding, which keeps the card controller alive for
 * exactly this reading (see `useCockpitColumn`).
 */
function CockpitPageButton({ column }: { column: CockpitColumnBinding }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const label = t('cockpit.cardsView');

  return (
    <CockpitButton
      count={column.snapshot.openCount}
      label={label}
      pressed={false}
      onClick={() => navigate('/cockpit?view=cards')}
    />
  );
}

type CockpitButtonProps = {
  count: number;
  label: string;
  pressed: boolean;
  onClick: () => void;
};

/**
 * The one control both surfaces draw, so size, border, badge and the zero reading cannot drift
 * between the column entry and the phone entry.
 */
function CockpitButton({ count, label, pressed, onClick }: CockpitButtonProps) {
  const badgeText = count === 0 ? '' : count > 99 ? '99+' : String(count);

  return (
    <button
      type="button"
      data-testid="cockpit-header-button"
      data-cockpit-column-expanded={pressed ? 'true' : 'false'}
      data-cockpit-column-count={count}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border/50 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        pressed ? 'bg-accent text-foreground' : 'text-muted-foreground',
        // Zero open cards is a reading, not an error: the button recedes instead of shouting a
        // "0" badge at someone who has nothing waiting.
        count === 0 && !pressed && 'opacity-60',
      )}
    >
      <Gauge className="h-5 w-5" aria-hidden />
      {badgeText !== '' && (
        <span
          data-testid="cockpit-header-badge"
          aria-hidden
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold leading-none text-white shadow-sm ring-1 ring-background"
        >
          {badgeText}
        </span>
      )}
    </button>
  );
}
