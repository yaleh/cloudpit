import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import type { AppTab, Project, ProjectSession } from '@/shared/types';
import { cn } from '@/shared/utils';
import { SessionPulse } from '@/modules/quay';
import { CockpitHeaderButton } from '@/modules/cockpit';
import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';
import WorkspaceTabs, { CollapsedWorkspaceSelector } from '@/modules/project-workspace/WorkspaceTabs';
import { planWorkspaceTabs, TAB_LABEL_GAP_PX } from '@/modules/project-workspace/utils/workspaceTabPlan';
import type { WorkspaceTabMeasure, WorkspaceTabPlan } from '@/modules/project-workspace/utils/workspaceTabPlan';
import WorkspaceMenu from '@/modules/project-workspace/WorkspaceMenu';
import WorkspaceTitle from '@/modules/project-workspace/WorkspaceTitle';

type WorkspaceHeaderProps = {
  activeTab: AppTab;
  setActiveTab: Dispatch<SetStateAction<AppTab>>;
  selectedProject: Project;
  selectedSession: ProjectSession | null;
  shouldShowTasksTab: boolean;
  /** Optional so a caller that only knows about Tasks/Browser keeps compiling; absent means "no Quay tab". */
  shouldShowQuayTab?: boolean;
  /** Optional, absent means "no architecture tab", the same contract as `shouldShowQuayTab`. */
  shouldShowArchitectureTab?: boolean;
  shouldShowBrowserTab: boolean;
  /**
   * The selected session's stored lifecycle mode, resolved by WorkspaceMain.
   * Optional with `false` as the meaning of absent, so that a header rendered
   * without a mode reading keeps offering Shell rather than closing it by default.
   */
  isResidentSession?: boolean;
  isMobile: boolean;
  onMenuClick: () => void;
};

/**
 * Rendered by WorkspaceMain. Desktop shows the workspace title beside the tab strip
 * (names degrade by priority, then tabs move to an overflow menu); mobile keeps the same three elements on one row — menu, title, and a
 * selector for the active workspace — and moves the rest of the tab bar into that
 * selector's dialog.
 */
export default function WorkspaceHeader({
  activeTab,
  setActiveTab,
  selectedProject,
  selectedSession,
  shouldShowTasksTab,
  shouldShowQuayTab = false,
  shouldShowArchitectureTab = false,
  shouldShowBrowserTab,
  isResidentSession,
  isMobile,
  onMenuClick,
}: WorkspaceHeaderProps) {
  // Read here rather than taken as a prop beside `isMobile`, which arrives threaded through
  // ProjectWorkspaceShell, ProjectMainRegion and WorkspaceMain: this header is the only consumer on
  // that path, so a prop would widen three signatures to carry one padding decision.
  const { isShortTouchViewport } = useDeviceSettings({ trackPWA: false });
  const scrollRef = useRef<HTMLDivElement>(null);
  // The strip's layout as last decided from the measured room: which tabs spell their name and
  // which sit behind the overflow menu. It is state, not derived, because the decision reads the
  // DOM and its own previous value (the upgrade hysteresis), and null means "not measured yet".
  const [tabPlan, setTabPlan] = useState<WorkspaceTabPlan | null>(null);

  /**
   * Re-plans the strip from two measurements that do not depend on each other.
   *
   * The strip's room is split in two flex children: an empty grow cell
   * (`data-workspace-tabs-spacer`) that takes every pixel the header is not using, and the
   * content-sized tab container (`data-workspace-tabs-room`) next to the pulse trigger. Their
   * SUM is the leftover the strip may use: when a narrower layout shrinks the container, the
   * spacer grows by exactly that amount, so the reading cannot feed the decision back into its
   * input. Measuring the container alone would lock the narrow layout in place.
   *
   * The tab widths come from the off-screen full-label copy `WorkspaceTabs` draws at every
   * layout, so they change only with the tab set and the language, never with the layout on
   * screen; a switch cannot shrink them and flip itself back.
   */
  const measureTabPlan = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const room = scroll.closest<HTMLElement>('[data-workspace-tabs-room]');
    const spacer = room?.parentElement?.querySelector<HTMLElement>('[data-workspace-tabs-spacer]') ?? null;
    const available = (room?.clientWidth ?? 0) + (spacer?.clientWidth ?? 0);
    const tabs: WorkspaceTabMeasure[] = Array.from(
      scroll.querySelectorAll<HTMLElement>('[data-workspace-tab-measure]'),
    ).map((pill) => {
      const id = pill.getAttribute('data-workspace-tab-measure') ?? '';
      const label = pill.querySelector<HTMLElement>('[data-workspace-tab-measure-label]');
      const fullWidth = pill.offsetWidth;
      return { id, fullWidth, iconWidth: Math.max(0, fullWidth - (label?.offsetWidth ?? 0) - TAB_LABEL_GAP_PX) };
    });
    setTabPlan((previous) => {
      const next = planWorkspaceTabs({ tabs, activeId: activeTab, available }, previous);
      const unchanged = previous !== null
        && previous.level === next.level
        && previous.labelledIds.join('|') === next.labelledIds.join('|')
        && previous.overflowIds.join('|') === next.overflowIds.join('|');
      return unchanged ? previous : next;
    });
  }, [activeTab]);

  // `useLayoutEffect` rather than `useEffect`: the plan has to be settled before the browser
  // paints, or the header draws every label and then snaps to the narrower layout.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    measureTabPlan();

    const observer = new ResizeObserver(measureTabPlan);
    observer.observe(scroll);
    const room = scroll.closest<HTMLElement>('[data-workspace-tabs-room]');
    if (room) observer.observe(room);
    // Both halves of the room reading are observed: the spacer is what grows when the container
    // shrinks, so a viewport resize that only moves pixels between the two still re-plans.
    const spacer = room?.parentElement?.querySelector<HTMLElement>('[data-workspace-tabs-spacer]');
    if (spacer) observer.observe(spacer);
    const measure = scroll.querySelector<HTMLElement>('[data-workspace-tabs-measure]');
    if (measure) observer.observe(measure);

    return () => observer.disconnect();
  }, [measureTabPlan]);

  // Stable identity so the memoized pulse subtree is not re-rendered by an unrelated header
  // render (the trigger's own 30 s poll already never reaches this component).
  const openQuayPanel = useCallback(() => setActiveTab('quay'), [setActiveTab]);
  // ONE trigger, two placements: the desktop right row keeps the popover-bearing control, and
  // the phone's title block draws the same control as a 64×14 in-flight thumbnail. Placement and
  // size differ; the press opens the same popover in both, whose footer button is the way into
  // the full Quay view.
  const sessionPulse = shouldShowQuayTab ? (
    <SessionPulse
      projectId={selectedProject.projectId}
      sessionId={selectedSession?.id ?? null}
      isMobile={isMobile}
      compact={isMobile}
      onOpenQuayPanel={openQuayPanel}
    />
  ) : null;

  return (
    <header
      data-app-header
      className={cn(
        'pwa-header-safe flex flex-shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 backdrop-blur-sm',
        // The short tier is a touch-only device with the width of a desktop and the height of a
        // phone, so `md:py-2` would spend 16px of a 330px screen on padding alone. It is read here
        // rather than threaded down as a prop, because the four components between the route and
        // this header have no other use for it.
        isShortTouchViewport ? 'px-2 py-1' : 'px-3 py-1.5 md:gap-3 md:px-4 md:py-2',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 md:max-w-[min(34%,16rem)] md:flex-[1_1_16rem]">
        {isMobile && <MobileMenuButton onMenuClick={onMenuClick} />}
        <WorkspaceTitle
          activeTab={activeTab}
          selectedProject={selectedProject}
          selectedSession={selectedSession}
          shouldShowTasksTab={shouldShowTasksTab}
          shouldShowQuayTab={shouldShowQuayTab}
          shouldShowArchitectureTab={shouldShowArchitectureTab}
          isMobile={isMobile}
          quayPulse={isMobile ? sessionPulse : null}
        />
      </div>

      {isMobile ? (
        // The phone row's order is fixed and its width is a budget: the workspace picker, the
        // `⋯` menu, then the cockpit entry (the same 32×32 box and border as the menu). The Quay
        // thumbnail that used to lead this row now sits under the title, after the project name.
        <div className="flex flex-shrink-0 items-center gap-1">
          <CollapsedWorkspaceSelector
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            shouldShowTasksTab={shouldShowTasksTab}
            shouldShowQuayTab={shouldShowQuayTab}
            shouldShowArchitectureTab={shouldShowArchitectureTab}
            shouldShowBrowserTab={shouldShowBrowserTab}
            isResidentSession={isResidentSession}
          />
          <WorkspaceMenu />
          <CockpitHeaderButton variant="page" />
        </div>
      ) : (
        <>
        {/* The header's own grow cell. It takes the slack the old `flex-1` tab container used to
            take, so the container can shrink to the strip's own width and the Loop Pulse trigger
            ends up immediately before the tabs. Empty and `aria-hidden`: it carries no content
            and no meaning, only the leftover width the measurement below adds to the container's
            own width. */}
        <div className="min-w-0 flex-1" data-workspace-tabs-spacer="" aria-hidden="true" />
        {sessionPulse}
        {/* Shrink-to-content, not `flex-1`: when the full strip fits, this box is exactly as wide
            as the tab strip (the scroll container has no resting padding), so the header gap is
            the whole distance from the pulse trigger to the tabs. When it does not fit, `flex-shrink`
            gives it the available width and the existing scroll/arrow behaviour takes over. */}
        <div className="min-w-0 shrink" data-workspace-tabs-room="">
          <div className="relative ml-auto w-fit max-w-full">
            {/* No scrolling: a tab that does not fit leaves for the strip's overflow menu, where
                it keeps its name. The container only has to be a stable thing to measure. */}
            <div ref={scrollRef} className="max-w-full px-3 md:px-0">
              <WorkspaceTabs
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                plan={tabPlan ?? undefined}
                shouldShowTasksTab={shouldShowTasksTab}
                shouldShowQuayTab={shouldShowQuayTab}
                shouldShowArchitectureTab={shouldShowArchitectureTab}
                shouldShowBrowserTab={shouldShowBrowserTab}
                isResidentSession={isResidentSession}
              />
            </div>
          </div>
        </div>
        {/* The cockpit column's entry point, in the same control size and border as the
            `⋯` menu it sits beside. It draws nothing below 900 px or without a column
            binding, so the phone header and isolated header tests are unchanged. */}
        <CockpitHeaderButton />
        <WorkspaceMenu />
        </>
      )}
    </header>
  );
}
