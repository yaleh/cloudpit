import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { cn } from '@/shared/utils';
import { useCockpitColumnContext } from '@/modules/cockpit/hooks/useCockpitColumn';

/**
 * The session header's cockpit button: one gauge, the open-card count as a red badge, and a
 * pressed state while the column is open.
 *
 * IT IS THE COLUMN'S ONLY ENTRY POINT. The design replaced the narrow collapsed strip with a
 * count in the header, so this button both announces 「有 N 件事在等你」 and opens the column.
 * It draws at the header's `⋯` size and border because it sits beside that menu; a differently
 * sized control would read as a different class of action.
 *
 * NO PROVIDER, NO BUTTON. The header also renders in isolation in tests and on screens where
 * the cockpit is switched off; with no surrounding column binding there is nothing to open, so
 * drawing a dead button would be worse than drawing none.
 */
export default function CockpitHeaderButton() {
  const { t } = useTranslation();
  const column = useCockpitColumnContext();

  if (column === null) return null;
  const { snapshot, controller } = column;
  // Below 900 px the column does not exist (the phone model owns that width), so neither does
  // its header entry point.
  if (snapshot.layout === 'hidden') return null;

  const label = snapshot.expanded
    ? t('cockpit.columnCollapse')
    : t('cockpit.columnExpand');

  return (
    <button
      type="button"
      data-testid="cockpit-header-button"
      data-cockpit-column-expanded={snapshot.expanded ? 'true' : 'false'}
      data-cockpit-column-count={snapshot.openCount}
      aria-pressed={snapshot.expanded}
      aria-label={label}
      title={label}
      onClick={() => controller.toggle()}
      className={cn(
        'relative inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border/50 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        snapshot.expanded ? 'bg-accent text-foreground' : 'text-muted-foreground',
        // Zero open cards is a reading, not an error: the button recedes instead of shouting a
        // "0" badge at someone who has nothing waiting.
        snapshot.openCount === 0 && !snapshot.expanded && 'opacity-60',
      )}
    >
      <Gauge className="h-5 w-5" aria-hidden />
      {snapshot.badgeText !== '' && (
        <span
          data-testid="cockpit-header-badge"
          aria-hidden
          className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold leading-none text-white shadow-sm ring-1 ring-background"
        >
          {snapshot.badgeText}
        </span>
      )}
    </button>
  );
}
