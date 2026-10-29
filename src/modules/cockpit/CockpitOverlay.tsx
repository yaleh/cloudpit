import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import type { CockpitCard as CockpitCardData } from '@/shared/types';
import { useServerFeatures } from '@/shared/hooks/useServerFeatures';
import CockpitCardList from '@/modules/cockpit/CockpitCardList';
import type { CockpitCardsBinding } from '@/modules/cockpit/hooks/useCockpitCards';

/**
 * The phone's cockpit layer: the cards view drawn OVER a live conversation instead of replacing
 * it.
 *
 * WHY A LAYER, NOT A PAGE. On a phone the PC right column does not exist, so the header's cockpit
 * entry used to navigate to `/cockpit?view=cards` and the session page unmounted with the route.
 * Coming back re-mounted the workspace, re-read the conversation and lost the composer draft —
 * the exact cost the PC column exists to avoid. Here the session page stays mounted underneath
 * and the layer is a history entry on the SAME path (see {@link cockpitOverlayHistoryState}), so
 * closing it only pops one entry. Nothing is reloaded.
 *
 * ONE LAYER, ONE STACK ENTRY. A card's 「Open conversation」 pushes the destination on top of the
 * layer's entry instead of replacing it, so the browser builds the stack a person expects:
 * session A → layer → session B. Back from B therefore returns to the layer (over A, with the
 * card controller's selection/filter/scroll still in place), and only the layer's own close pops
 * the last entry and lands back on A. Replacing the layer's entry — the pre-stack behaviour —
 * deleted that middle entry, so Back skipped straight to A and the card context was unreachable.
 *
 * WHICH SESSION IT COVERS. The layer only ever covers a session address (`/session/:id`); a
 * direct `/cockpit?view=cards` has no conversation underneath and stays the standalone page
 * `CockpitRoute` already mounts, with no back bar. The back bar's title is the conversation's own
 * title, carried in the history entry by the entry point — not looked up here, because this layer
 * is mounted above the workspace's project state, not inside it.
 *
 * NO SECOND CARD MODEL. The content is the shipped `CockpitCardList` page variant, so the type
 * chips, the project drawer, the selection/scroll memory and every card command are the same
 * controller the standalone cards page and the PC column use. The `binding` prop exists only so a
 * criterion can hand in a settled controller; production leaves it absent and the list binds its
 * own.
 */

/** The history-entry keys the layer lives under. */
const COCKPIT_OVERLAY_STATE_KEY = 'cockpitOverlay';
const COCKPIT_OVERLAY_TITLE_KEY = 'cockpitSessionTitle';

/** The address the layer may cover: a session page, never a sub-page of one. */
const SESSION_PATH = /^\/session\/([^/]+)\/?$/;

/**
 * The history state that opens the layer, on top of whatever the entry already carried.
 *
 * WHY HISTORY STATE RATHER THAN A SECOND PATH. A `/session/:id/cockpit` address would be a
 * different route match, and this app's session route owns the whole workspace state (project and
 * session reads, the busy-set, the composer). Keeping the path means the route match — and
 * therefore the mounted workspace — is untouched; only the history entry changes. The state also
 * survives a reload, so a phone reloaded while the layer is open comes back to the same layer,
 * while a copied URL (which never carries history state) opens the plain session.
 */
export function cockpitOverlayHistoryState(
  existing: unknown,
  sessionTitle: string | null,
): Record<string, unknown> {
  return {
    ...(typeof existing === 'object' && existing !== null ? existing : {}),
    [COCKPIT_OVERLAY_STATE_KEY]: true,
    [COCKPIT_OVERLAY_TITLE_KEY]: sessionTitle,
  };
}

/**
 * Reads the layer's entry, or `null` for every history state that did not open it.
 *
 * The title is null when absent or blank, so the back bar can fall back to its own sentence
 * instead of drawing an empty label.
 */
export function readCockpitOverlayState(
  state: unknown,
): { sessionTitle: string | null } | null {
  if (typeof state !== 'object' || state === null) return null;
  const record = state as Record<string, unknown>;
  if (record[COCKPIT_OVERLAY_STATE_KEY] !== true) return null;
  const title = record[COCKPIT_OVERLAY_TITLE_KEY];
  return { sessionTitle: typeof title === 'string' && title.trim() !== '' ? title : null };
}

export type CockpitOverlayProps = {
  /** The conversation underneath, drawn in the back bar; null falls back to a generic label. */
  sessionTitle: string | null;
  /** Pops the history entry that opened the layer (the session page is never reloaded). */
  onClose: () => void;
  /**
   * A card's 「Open conversation」. Its host pushes one entry above the layer's, so Back returns
   * to this layer before the conversation it covers; the cards controller's own memory keeps the
   * selection/filter/scroll while the layer is off screen.
   */
  onOpenConversation?: (card: CockpitCardData, sessionId: string) => void;
  /** A criterion's settled card binding; production leaves this absent (the list binds its own). */
  binding?: CockpitCardsBinding;
};

/** Rendered by {@link CockpitOverlayHost}. Used inside the cockpit module only. */
export default function CockpitOverlay({
  sessionTitle,
  onClose,
  onOpenConversation,
  binding,
}: CockpitOverlayProps) {
  const { t } = useTranslation();
  const title = sessionTitle?.trim() ?? '';
  const backLabel =
    title === '' ? t('cockpit.overlayBack') : t('cockpit.overlayBackToSession', { title });

  return (
    <div
      data-testid="cockpit-overlay"
      data-cockpit-overlay-title={title}
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
    >
      {/* ONE row: the way back, named by the conversation it returns to. The back arrow is the
          visual affordance; the title is the label, so a person reads where they will land before
          pressing. */}
      <div
        data-testid="cockpit-overlay-backbar"
        className="flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-background px-2 py-1"
      >
        <button
          type="button"
          data-testid="cockpit-overlay-close"
          aria-label={backLabel}
          title={backLabel}
          onClick={onClose}
          className="flex min-h-11 min-w-11 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 md:min-h-8 md:min-w-8"
        >
          <ArrowLeft className="h-4 w-4 flex-shrink-0" aria-hidden />
          <span data-testid="cockpit-overlay-title" className="min-w-0 truncate">
            {title === '' ? t('cockpit.overlayBack') : title}
          </span>
        </button>
        <span className="ml-auto flex-shrink-0 text-xs text-muted-foreground">
          {t('cockpit.cardsView')}
        </span>
      </div>
      <CockpitCardList
        variant="page"
        binding={binding}
        onOpenConversation={onOpenConversation}
      />
    </div>
  );
}

/**
 * The layer's router binding, mounted once by `App` as a sibling of `<Routes>`.
 *
 * WHY IT LIVES ABOVE THE ROUTES. It must not be a route of its own: a second route match would
 * re-render (or, with a different element, remount) the workspace the layer is supposed to keep
 * alive. As a sibling it reads the current location and draws over whatever the routes matched.
 *
 * IT DRAWS ONLY WHEN ALL THREE FACTS HOLD: the entry is the layer's, the address is a session (a
 * deep link to `/cockpit?view=cards` stays the standalone page), and the cockpit switch is on (a
 * reload can carry a stale entry from before an operator turned it off). Any other state renders
 * nothing, which is also what keeps the standalone cards page free of a back bar.
 */
export function CockpitOverlayHost({ binding }: { binding?: CockpitCardsBinding } = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { cockpitEnabled } = useServerFeatures();
  const overlay = readCockpitOverlayState(location.state);
  if (overlay === null || SESSION_PATH.exec(location.pathname) === null || !cockpitEnabled) {
    return null;
  }

  return (
    <CockpitOverlay
      sessionTitle={overlay.sessionTitle}
      binding={binding}
      // Closing pops the entry the opener pushed. The session page below is the same route match
      // with the same params, so React keeps it mounted; nothing re-reads the conversation.
      onClose={() => navigate(-1)}
      // The card's own door to a conversation: PUSH the destination on top of the layer's entry.
      // The stack is then A → layer → B, so the browser's Back (and the layer's own close after
      // it) walks back exactly the way the person came: B → layer (cards, selection and scroll
      // intact) → A. Replacing the layer's entry here would delete the middle step and make the
      // card context unreachable.
      onOpenConversation={(_card, sessionId) =>
        navigate(`/session/${encodeURIComponent(sessionId)}`)
      }
    />
  );
}
