import { Edit2, LayoutDashboard, ListFilter, MoreHorizontal, Star, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useInRouterContext, useNavigate } from 'react-router-dom';

import { ActionMenu } from '@/shared/ui';
import type { ActionMenuItem } from '@/shared/ui/ActionMenu';
import type { Project } from '@/shared/types';
import { cockpitViewPath, formatProjectUri, useObservationPin } from '@/modules/cockpit/contract';

export type SidebarProjectActionsMenuProps = {
  project: Project;
  /** The server's boot-time cockpit switch; both cockpit actions are withheld when it is off. */
  cockpitEnabled: boolean;
  /** The project's quay-fleet registry id; an unregistered project has no addressable board. */
  fleetProjectId: string | null;
  onStartEditingProject: (project: Project) => void;
  /** Withheld where the row has no session-filter editor to open. */
  onEditSessionFilter?: (project: Project, seedSessionName?: string) => void;
  onDeleteProject: (project: Project) => void;
  t: TFunction;
};

type MenuBodyProps = SidebarProjectActionsMenuProps & {
  /** How this tree opens the cockpit board: routed navigation or a plain document load. */
  onOpenCockpit: (href: string) => void;
};

/**
 * The mobile project row's 「⋯」 menu.
 *
 * The row used to carry every project action inline — watch pin, board link, delete, session
 * filter, rename — which made its height depend on how many of them a project happened to show
 * (and on how many digits its task counts had, once the controls wrapped). The actions are all
 * configuration or destructive; the row's one high-frequency interaction is tapping it to expand.
 * So the row keeps the favorite star, this trigger and the expand indicator, and everything else
 * lives here, in a fixed two-line card that cannot change height with the controls it offers.
 *
 * The items reuse the existing callbacks rather than restating their logic: the watch item is the
 * same shared pin hook `WatchPinToggle` renders on the desktop row, and the board item mints its
 * address with the same `cockpitViewPath` the old inline link used. `ActionMenu` is the shared
 * primitive the session row already uses, portalled so the card's overflow cannot clip it.
 */
function SidebarProjectActionsMenuBody({
  project,
  cockpitEnabled,
  fleetProjectId,
  onStartEditingProject,
  onEditSessionFilter,
  onDeleteProject,
  onOpenCockpit,
  t,
}: MenuBodyProps) {
  // A project the fleet does not register has no addressable board, and the pin addresses the
  // object the board shows; both cockpit items therefore share one condition.
  const cockpitUri = cockpitEnabled && fleetProjectId !== null
    ? formatProjectUri(fleetProjectId)
    : null;
  // The same shared pin cache the desktop row's `WatchPinToggle` reads. Mounting reads the cache
  // only — no request per row — and toggling writes through the shared route.
  const watch = useObservationPin(cockpitUri ?? '');

  const items: ActionMenuItem[] = [
    {
      key: 'rename',
      label: t('tooltips.renameProject'),
      icon: Edit2,
      onSelect: () => onStartEditingProject(project),
    },
    ...(onEditSessionFilter
      ? [{
          key: 'session-filter',
          label: t('sessionFilter.menuItem'),
          icon: ListFilter,
          onSelect: () => onEditSessionFilter(project),
        }]
      : []),
    ...(cockpitUri !== null && fleetProjectId !== null
      ? [{
          key: 'cockpit',
          label: t('common:cockpit.openProject', 'View in cockpit'),
          icon: LayoutDashboard,
          onSelect: () => onOpenCockpit(cockpitViewPath({ type: 'board', project: fleetProjectId })),
        }]
      : []),
    ...(cockpitUri !== null
      ? [{
          key: 'watch',
          label: watch.pinned
            ? t('common:cockpit.observationUnpin')
            : t('common:cockpit.observationPin'),
          icon: Star,
          disabled: watch.pending,
          onSelect: () => { void watch.toggle(); },
        }]
      : []),
    {
      key: 'delete',
      label: t('tooltips.deleteProject'),
      icon: Trash2,
      isDanger: true,
      showDividerBefore: true,
      onSelect: () => onDeleteProject(project),
    },
  ];

  return (
    <ActionMenu
      label="Project options"
      ariaLabel={`Project options for ${project.displayName}`}
      icon={MoreHorizontal}
      iconOnly
      portal
      variant="ghost"
      size="icon"
      triggerClassName="h-8 w-8 text-muted-foreground hover:bg-muted"
      menuClassName="w-[240px] rounded-xl p-1.5 shadow-xl"
      items={items}
    />
  );
}

/** The routed arm: the board item moves the app to `/cockpit?view=board&project=…` in place. */
function RoutedSidebarProjectActionsMenu(props: SidebarProjectActionsMenuProps) {
  const navigate = useNavigate();
  return (
    <SidebarProjectActionsMenuBody
      {...props}
      onOpenCockpit={(href) => navigate(href)}
    />
  );
}

/**
 * `useNavigate` throws outside a router, and the project row is also rendered by unit tests that
 * mount none (the task-count criterion among them). Split the arm the same way the desktop board
 * link is split, so a router-less mount still draws the menu.
 */
export default function SidebarProjectActionsMenu(props: SidebarProjectActionsMenuProps) {
  const inRouter = useInRouterContext();
  return inRouter ? (
    <RoutedSidebarProjectActionsMenu {...props} />
  ) : (
    <SidebarProjectActionsMenuBody
      {...props}
      onOpenCockpit={(href) => { window.location.assign(href); }}
    />
  );
}
