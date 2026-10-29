import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Gauge } from 'lucide-react';

import { cn } from '@/shared/utils';
import { cockpitOverlayHistoryState } from '@/modules/cockpit/CockpitOverlay';
import { enterCockpit } from '@/modules/cockpit/cockpitEntry';
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
 * to the cockpit's cards view and keeps reading the same controller's count — the phone header is
 * not a second instrument with a second number.
 *
 * ON A SESSION THE PHONE DOOR OPENS A LAYER, NOT A PAGE. It pushes one history entry carrying the
 * conversation's title ({@link cockpitOverlayHistoryState}); `CockpitOverlayHost` draws the cards
 * over the still-mounted session, and closing it pops that entry. With no session underfoot
 * (`/`) the same control still falls back to the standalone `/cockpit?view=cards` page, which is
 * also what a deep link opens.
 *
 * NO PROVIDER, NO BUTTON. The header also renders in isolation in tests and on screens where
 * the cockpit is switched off; with no surrounding column binding there is nothing to open, so
 * drawing a dead button would be worse than drawing none.
 */
export type CockpitHeaderButtonVariant = 'column' | 'page';

export default function CockpitHeaderButton({
  variant = 'column',
  sessionTitle = null,
}: {
  /**
   * `column` (the default) is the PC entry point: it toggles the column when the column exists,
   * and becomes the phone layer's door when the layout is `hidden` (the column has no place to
   * draw there). `page` is what the phone header asks for explicitly.
   */
  variant?: CockpitHeaderButtonVariant;
  /**
   * The selected conversation's title, carried into the layer's history entry so its back bar
   * names where the person returns to. Absent/null on a header with no session (or in an
   * isolated render), where the button falls back to the standalone page.
   */
  sessionTitle?: string | null;
} = {}) {
  const { t } = useTranslation();
  const column = useCockpitColumnContext();

  if (column === null) return null;
  if (variant === 'page' || column.snapshot.layout === 'hidden') {
    // The phone model owns a `hidden` layout: there is no column to toggle, so the same control
    // is the layer's door (or the standalone page when no conversation is selected).
    return <CockpitPageButton column={column} sessionTitle={sessionTitle} />;
  }

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
 * The phone's variant of the same control: no column to toggle, so it opens the cards layer over
 * the live conversation. It reads the count from the same column binding, which keeps the card
 * controller alive for exactly this reading (see `useCockpitColumn`).
 *
 * THE FALLBACK IS THE OLD BEHAVIOUR, KEPT ON PURPOSE. With no `/session/:id` underfoot (the
 * workspace root) there is no conversation to cover, so `/cockpit?view=cards` is still the right
 * destination — and a deep link there must keep rendering the standalone page.
 *
 * BOTH DOORS RECORD THE RETURN PATH. Whether the gauge opens the layer or the standalone page,
 * the trip goes through {@link enterCockpit}, so a later visit to the cockpit's 「会话」 segment
 * leads back to this conversation instead of home. The layer itself is a history entry on the
 * session address, so recording the address is exactly what closing it walks back to.
 */
function CockpitPageButton({
  column,
  sessionTitle,
}: {
  column: CockpitColumnBinding;
  sessionTitle: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId } = useParams<{ sessionId?: string }>();
  const label = t('cockpit.cardsView');

  const openCockpit = (): void => {
    if (sessionId === undefined || sessionId === '') {
      enterCockpit({ navigate, target: '/cockpit?view=cards', location });
      return;
    }
    // One history entry on the SAME address: the route match (and with it the mounted workspace,
    // its draft and its scroll position) does not change. Back, and the back bar, pop this entry.
    // The entry action records this address before pushing it, so the cockpit's 「会话」 segment
    // returns here when the standalone page is opened later.
    enterCockpit({
      navigate: (target) =>
        navigate(target, {
          state: cockpitOverlayHistoryState(location.state, sessionTitle),
        }),
      target: `${location.pathname}${location.search}`,
      location,
    });
  };

  return (
    <CockpitButton
      count={column.snapshot.openCount}
      label={label}
      pressed={false}
      onClick={openCockpit}
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
