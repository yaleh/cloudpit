import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { useDeviceSettings } from '@/shared/hooks/useDeviceSettings';
import type { AppTab, Project, ProjectSession } from '@/shared/types';
import { cn } from '@/shared/utils';
import { SessionPulse } from '@/modules/quay';
import MobileMenuButton from '@/modules/project-workspace/MobileMenuButton';
import WorkspaceTabs, { CollapsedWorkspaceSelector } from '@/modules/project-workspace/WorkspaceTabs';
import type { WorkspaceTabLabelMode } from '@/modules/project-workspace/WorkspaceTabs';
import WorkspaceMenu from '@/modules/project-workspace/WorkspaceMenu';
import WorkspaceTitle from '@/modules/project-workspace/WorkspaceTitle';

/**
 * Room the scroll container's own horizontal padding takes out of the measured flex item.
 *
 * The strip's resting padding is `md:pl-3` (12 px on the left, none on the right), so 12 px is
 * the exact reservation and this adds a small rounding allowance. Overflow padding
 * (`md:px-9`) is deliberately not reserved: the strip is already icon-only by the time it can
 * overflow, and reserving it would push the full mode out of headers that only just fit.
 */
const TAB_STRIP_INLINE_PADDING_PX = 16;

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
 * Rendered by WorkspaceMain. Desktop shows the workspace title beside the scrollable
 * tab bar; mobile keeps the same three elements on one row — menu, title, and a
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
  const { t } = useTranslation();
  // Read here rather than taken as a prop beside `isMobile`, which arrives threaded through
  // ProjectWorkspaceShell, ProjectMainRegion and WorkspaceMain: this header is the only consumer on
  // that path, so a prop would widen three signatures to carry one padding decision.
  const { isShortTouchViewport } = useDeviceSettings({ trackPWA: false });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const hasOverflow = canScrollLeft || canScrollRight;
  const [labelMode, setLabelMode] = useState<WorkspaceTabLabelMode>('full');

  /**
   * Picks the strip's label mode from two measurements that do not depend on each other.
   *
   * `room` is the flex item that holds the strip: `flex-1` with `min-w-0`, so its width is the
   * space the header gave the strip, not the width the strip's own content happens to take.
   * Measuring the strip itself here would feed the decision back into its input — icon mode
   * makes the strip narrow, which would keep choosing icon mode at every viewport.
   *
   * `natural` is the off-screen full-label copy's width, which `WorkspaceTabs` draws at every
   * label mode. Its width therefore changes only with the tab set and the language, never with
   * the mode on screen; a switch cannot shrink it and flip itself back.
   */
  const measureLabelMode = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const room = scroll.closest<HTMLElement>('[data-workspace-tabs-room]');
    const measure = scroll.querySelector<HTMLElement>('[data-workspace-tabs-measure]');
    const available = room?.clientWidth ?? 0;
    const natural = measure?.scrollWidth ?? 0;
    // 0 is "not measured yet" (jsdom, or before layout), never "no room": treating it as no
    // room would open the header icon-only and flash to full labels once layout landed.
    const next: WorkspaceTabLabelMode =
      available <= 0 || natural <= 0 || available - TAB_STRIP_INLINE_PADDING_PX >= natural ? 'full' : 'icon';
    setLabelMode((previous) => (previous === next ? previous : next));
  }, []);

  // `useLayoutEffect` rather than `useEffect`: the mode has to be settled before the browser
  // paints, or the header draws full labels and then snaps to icons.
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    measureLabelMode();

    const observer = new ResizeObserver(measureLabelMode);
    observer.observe(scroll);
    const room = scroll.closest<HTMLElement>('[data-workspace-tabs-room]');
    if (room) observer.observe(room);
    const measure = scroll.querySelector<HTMLElement>('[data-workspace-tabs-measure]');
    if (measure) observer.observe(measure);

    return () => observer.disconnect();
  }, [measureLabelMode]);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();

    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);

    return () => observer.disconnect();
  }, [updateScrollState]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

      const maxScrollLeft = el.scrollWidth - el.clientWidth;
      const canMove = event.deltaY < 0 ? el.scrollLeft > 0 : el.scrollLeft < maxScrollLeft;
      if (!canMove) return;

      event.preventDefault();
      const lineMultiplier = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 20 : 1;
      el.scrollBy({ left: event.deltaY * lineMultiplier, behavior: 'auto' });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const activeTabElement = scrollRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      activeTabElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      updateScrollState();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, updateScrollState]);

  const scrollTabs = (direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(180, el.clientWidth * 0.65), behavior: 'smooth' });
  };

  // Stable identity so the memoized pulse subtree is not re-rendered by an unrelated header
  // render (the trigger's own 30 s poll already never reaches this component).
  const openQuayPanel = useCallback(() => setActiveTab('quay'), [setActiveTab]);
  const sessionPulse = shouldShowQuayTab ? (
    <SessionPulse
      projectId={selectedProject.projectId}
      sessionId={selectedSession?.id ?? null}
      isMobile={isMobile}
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
        />
      </div>

      {isMobile ? (
        <div className="flex flex-shrink-0 items-center gap-1">
          {sessionPulse}
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
        </div>
      ) : (
        <>
        {/* Between the title block and the tab strip, as the header's own flex child: putting
            it inside the tab container would leave that container's `max-w-full` no room to
            give. */}
        {sessionPulse}
        <div className="min-w-0 flex-1" data-workspace-tabs-room="">
          <div className="relative ml-auto w-fit max-w-full">
            {canScrollLeft && (
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-background via-background/90 to-transparent" />
            )}
            <div
              ref={scrollRef}
              onScroll={updateScrollState}
              className={cn(
                'scrollbar-hide max-w-full scroll-smooth overflow-x-auto overscroll-x-contain px-3 [-webkit-overflow-scrolling:touch]',
                hasOverflow ? 'md:px-9' : 'md:pl-3 md:pr-0',
              )}
            >
              <WorkspaceTabs
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                labelMode={labelMode}
                shouldShowTasksTab={shouldShowTasksTab}
                shouldShowQuayTab={shouldShowQuayTab}
                shouldShowArchitectureTab={shouldShowArchitectureTab}
                shouldShowBrowserTab={shouldShowBrowserTab}
                isResidentSession={isResidentSession}
              />
            </div>
            {canScrollRight && (
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-background via-background/90 to-transparent" />
            )}

            {canScrollLeft && (
              <button
                type="button"
                onClick={() => scrollTabs(-1)}
                aria-label={t('navigation.scrollTabsLeft', { defaultValue: 'Scroll tabs left' })}
                className="absolute left-1 top-1/2 z-20 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-border/70 bg-background/95 text-muted-foreground shadow-sm outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 md:flex"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {canScrollRight && (
              <button
                type="button"
                onClick={() => scrollTabs(1)}
                aria-label={t('navigation.scrollTabsRight', { defaultValue: 'Scroll tabs right' })}
                className="absolute right-1 top-1/2 z-20 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border border-border/70 bg-background/95 text-muted-foreground shadow-sm outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 md:flex"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <WorkspaceMenu />
        </>
      )}
    </header>
  );
}
