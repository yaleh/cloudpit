import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type {
  QuayGanttLanes,
  QuayGanttUnavailableReason,
} from '@/shared/types';
import {
  QUAY_DEFAULT_TASK_STATUS_BADGE_CLASS,
  QUAY_IN_FLIGHT_PHASE_META,
  QUAY_TASK_BADGE_BASE_CLASS,
  QUAY_TASK_STATUS_BADGE_CLASSES,
} from '@/shared/constants';
import { cn } from '@/shared/utils';
import LoopPulseGantt from '@/modules/quay/LoopPulseGantt';
import {
  SessionMentionsSections,
  type SessionMentionsLabels,
} from '@/modules/quay/SessionTaskRows';
import {
  useSessionMentions,
  useSessionSnapshot,
  type SessionSnapshotState,
} from '@/modules/quay/hooks/useSessionPulse';

/**
 * The title bar's Loop pulse popover: the big gantt plus the tasks and goals this session's own
 * prose names.
 *
 * Rendered by `SessionPulse` only while the trigger's popover is open. It owns two things:
 * fetching the session's mentions ONCE for that opening (never polling), and the list's local
 * presentation state (the folded Done group, the bottom fade). Everything about quay itself is
 * handed in — the window value and the lanes are the trigger's own reading, so the mini chart
 * and this chart can never disagree.
 */

/** 54.25rem — the transcript column's max width, which the popover aligns with on desktop. */
const DESKTOP_MAX_WIDTH_PX = 868;
/** Gap between the popover and the viewport edge / the header's bottom. */
const VIEWPORT_MARGIN_PX = 8;
const HEADER_GAP_PX = 4;
const DESKTOP_MAX_HEIGHT_PX = 760;

type PopoverGeometry = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

/**
 * Computes the dialog's fixed position from the header's live rect.
 *
 * Desktop: as wide as the transcript column (or the header minus its 8 px side margins), centred
 * under the header. Mobile: the viewport minus the same margins, so the panel never touches an
 * edge. Height is capped below the header and the bottom of the viewport.
 */
function computeGeometry(anchor: HTMLElement | null, isMobile: boolean): PopoverGeometry {
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
  const header = anchor?.closest('header[data-app-header]') as HTMLElement | null;
  const headerRect = header?.getBoundingClientRect() ?? null;
  const headerWidth = headerRect?.width ?? viewportWidth;

  const width = isMobile
    ? Math.max(0, viewportWidth - 2 * VIEWPORT_MARGIN_PX)
    : Math.max(0, Math.min(DESKTOP_MAX_WIDTH_PX, headerWidth - 2 * VIEWPORT_MARGIN_PX));
  const left = isMobile
    ? VIEWPORT_MARGIN_PX
    : (headerRect?.left ?? 0) + (headerWidth - width) / 2;
  const top = (headerRect?.bottom ?? 0) + HEADER_GAP_PX;
  const maxHeight = isMobile
    ? Math.max(0, viewportHeight - top - VIEWPORT_MARGIN_PX)
    : Math.min(viewportHeight * 0.85, DESKTOP_MAX_HEIGHT_PX);

  return { left, top, width, maxHeight };
}

type SessionPulsePopoverProps = {
  projectId: string;
  sessionId: string | null;
  gantt: QuayGanttLanes | null;
  ganttUnavailable: QuayGanttUnavailableReason | null;
  /**
   * True when the lanes read has settled without a lane set. The list still renders — the
   * mention reading is independent — but its rows claim no phase, and the amber note states why.
   */
  lanesUnavailable: boolean;
  windowHours: number;
  onWindowChange: (hours: number) => void;
  refreshing: boolean;
  isMobile: boolean;
  /** The trigger, used for geometry, outside-click exclusion and focus return. */
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  onOpenQuayPanel: () => void;
};

/** The shared badge pair: the Quay panel's in-flight card draws its statuses the same way. */
function statusBadgeClass(status: string): string {
  return cn(
    QUAY_TASK_BADGE_BASE_CLASS,
    QUAY_TASK_STATUS_BADGE_CLASSES[status] ?? QUAY_DEFAULT_TASK_STATUS_BADGE_CLASS,
  );
}

/**
 * How long an in-flight task has been running, in the Quay panel's own units.
 *
 * Mirrors the in-flight card's reading (`elapsedSince` against the snapshot's `generatedAt`)
 * rather than calling `Date.now()` here: the two surfaces compare the same two instants, so the
 * popover's row and the panel's row cannot disagree about how long a task has run. A missing or
 * unparseable start reads as the shared em-dash placeholder, never as `0s`.
 */
function formatElapsedRun(startedAt: string | null, generatedAt: string): string {
  if (startedAt === null) {
    return '—';
  }
  const start = Date.parse(startedAt);
  const now = Date.parse(generatedAt);
  if (Number.isNaN(start) || Number.isNaN(now)) {
    return '—';
  }
  const durationMs = Math.max(0, now - start);
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * Project-level counts: one badge per task status and per goal status, then the session's own
 * two counts.
 *
 * The snapshot is the PROJECT's reading, so the band says 「Project」 above it — the session line
 * beneath is the only part computed from this conversation's mentions. A `null` group is an
 * UNREAD reading and says so; it never draws `0`, because "could not read the task store" and
 * "the store has no tasks" are different facts.
 */
function ProjectCounts({
  snapshot,
  sessionTaskCount,
  sessionGoalCount,
}: {
  snapshot: SessionSnapshotState;
  /** The mention list's counts, or `null` while that independent read is not loaded. */
  sessionTaskCount: number | null;
  sessionGoalCount: number | null;
}) {
  const { t } = useTranslation();

  if (snapshot.status === 'error') {
    return (
      <p className="px-3 pb-1 pt-2 text-[11px] text-amber-700 dark:text-amber-300" data-testid="quay-pulse-counts-error">
        {t('quayPulse.snapshotError')}
      </p>
    );
  }

  if (snapshot.status !== 'loaded') {
    return (
      <p className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground" data-testid="quay-pulse-counts-loading">
        {t('quayPulse.snapshotLoading')}
      </p>
    );
  }

  const tasks = snapshot.snapshot.tasks;
  const goals = snapshot.snapshot.goals;
  const taskStatuses = Object.entries(tasks?.byStatus ?? {}).sort((a, b) => b[1] - a[1]);
  const goalStatuses = Object.entries(goals?.breakdown.byStatus ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <section className="px-3 pb-1 pt-2" data-testid="quay-pulse-counts">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('quayPulse.projectCounts')}
      </p>
      <div className="flex flex-wrap items-center gap-1" data-testid="quay-pulse-task-counts">
        <span className="text-[10px] text-muted-foreground">{t('quayPulse.tasksCountLabel')}</span>
        {tasks === null ? (
          <span className="text-[10px] text-amber-700 dark:text-amber-300" data-testid="quay-pulse-task-counts-unavailable">
            {t('quayPulse.notRead')}
          </span>
        ) : (
          taskStatuses.map(([status, count]) => (
            <span
              key={`task-${status}`}
              className={statusBadgeClass(status)}
              data-testid={`quay-pulse-task-count-${status}`}
              data-status={status}
              data-count={count}
            >
              {status} {count}
            </span>
          ))
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1" data-testid="quay-pulse-goal-counts">
        <span className="text-[10px] text-muted-foreground">{t('quayPulse.goalsCountLabel')}</span>
        {goals === null ? (
          <span className="text-[10px] text-amber-700 dark:text-amber-300" data-testid="quay-pulse-goal-counts-unavailable">
            {t('quayPulse.notRead')}
          </span>
        ) : (
          goalStatuses.map(([status, count]) => (
            <span
              key={`goal-${status}`}
              className={statusBadgeClass(status)}
              data-testid={`quay-pulse-goal-count-${status}`}
              data-status={status}
              data-count={count}
            >
              {status} {count}
            </span>
          ))
        )}
      </div>
      {sessionTaskCount !== null && sessionGoalCount !== null && (
        <p className="mt-1 text-[10px] text-muted-foreground" data-testid="quay-pulse-session-counts">
          {t('quayPulse.sessionCounts', { tasks: sessionTaskCount, goals: sessionGoalCount })}
        </p>
      )}
    </section>
  );
}

/**
 * The project's in-flight tasks, one row each: id, phase badge, elapsed run time, and a marker
 * when this conversation itself mentioned the task.
 *
 * `inFlight: null` (no lane reading) and `[]` (read, nothing running) render DIFFERENT text: an
 * unread set must never be shown as an empty one.
 */
function InFlightList({
  snapshot,
  mentionedTaskIds,
}: {
  snapshot: SessionSnapshotState;
  mentionedTaskIds: ReadonlySet<string>;
}) {
  const { t } = useTranslation();

  if (snapshot.status === 'error') {
    return (
      <p className="px-3 pb-1 pt-2 text-[11px] text-amber-700 dark:text-amber-300" data-testid="quay-pulse-inflight-error">
        {t('quayPulse.snapshotError')}
      </p>
    );
  }

  if (snapshot.status !== 'loaded') {
    return (
      <p className="px-3 pb-1 pt-2 text-[11px] text-muted-foreground" data-testid="quay-pulse-inflight-loading">
        {t('quayPulse.snapshotLoading')}
      </p>
    );
  }

  const { inFlight, generatedAt } = snapshot.snapshot;

  return (
    <section className="px-3 pb-1 pt-2" data-testid="quay-pulse-inflight">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('quayPulse.inFlightHeading')}
      </p>
      {inFlight === null ? (
        <p className="text-[11px] text-amber-700 dark:text-amber-300" data-testid="quay-pulse-inflight-unavailable">
          {t('quayPulse.notRead')}
        </p>
      ) : inFlight.length === 0 ? (
        <p className="text-[11px] text-muted-foreground" data-testid="quay-pulse-inflight-empty">
          {t('quayPulse.inFlightEmpty')}
        </p>
      ) : (
        <ul className="space-y-1">
          {inFlight.map((task) => {
            const phase = (QUAY_IN_FLIGHT_PHASE_META as Record<string, { label: string; className: string } | undefined>)[task.phase];
            const mentioned = mentionedTaskIds.has(task.taskId);
            return (
              <li
                key={task.taskId}
                className="flex items-center gap-2 text-xs"
                data-testid="quay-pulse-inflight-row"
                data-task-id={task.taskId}
                data-mentioned={mentioned ? 'true' : 'false'}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={task.taskId}>
                  {task.taskId}
                </span>
                <span
                  className={cn(QUAY_TASK_BADGE_BASE_CLASS, phase?.className ?? QUAY_DEFAULT_TASK_STATUS_BADGE_CLASS)}
                  data-testid={`quay-pulse-inflight-phase-${task.phase}`}
                >
                  {phase?.label ?? task.phase}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground" data-testid="quay-pulse-inflight-elapsed">
                  {formatElapsedRun(task.startedAt, generatedAt)}
                </span>
                {mentioned && (
                  <span
                    className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    data-testid="quay-pulse-inflight-mentioned"
                  >
                    {t('quayPulse.inFlightMentioned')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The title-bar popover. Used by `SessionPulse`; not exported from the module barrel. */
export default function SessionPulsePopover({
  projectId,
  sessionId,
  gantt,
  ganttUnavailable,
  lanesUnavailable,
  windowHours,
  onWindowChange,
  refreshing,
  isMobile,
  anchorRef,
  onClose,
  onOpenQuayPanel,
}: SessionPulsePopoverProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const upperRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  // The dialog's fixed rect; derived from the live header, so it is state rather than a render
  // computation (a resize must move the panel without a re-open).
  const [geometry, setGeometry] = useState<PopoverGeometry>(() => computeGeometry(anchorRef.current, isMobile));
  // Whether the list still has content below the fold, which is the only state in which the
  // bottom fade is shown (no top fade: nothing scrolls above the first heading).
  const [showBottomFade, setShowBottomFade] = useState(false);
  // Whether the folded Done group is expanded. Default collapsed, as the task asks.
  const [doneExpanded, setDoneExpanded] = useState(false);
  // The panel's rendered height: the content's natural height, capped at the geometry's max.
  // `max-height` alone cannot make the list scroll — a flex child with no definite container
  // height grows to its content and the panel clips it — so the height is measured and set.
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const mentions = useSessionMentions(projectId, sessionId, true);
  // The project's counts and in-flight rows. Read once per opening, like the mention list and
  // independently of it: one failed read must not blank the other.
  const snapshot = useSessionSnapshot(projectId, windowHours, true);

  useEffect(() => {
    const update = () => setGeometry(computeGeometry(anchorRef.current, isMobile));
    update();

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', update);
    }
    const header = anchorRef.current?.closest('header[data-app-header]') ?? null;
    const observer = header !== null && typeof ResizeObserver === 'function'
      ? new ResizeObserver(update)
      : null;
    observer?.observe(header as Element);

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', update);
      }
      observer?.disconnect();
    };
  }, [anchorRef, isMobile]);

  /*
   * Size the panel to its content, up to the geometry's cap. The natural height is the sum of
   * the fixed block, the list's OWN scrollHeight (its full content, whether or not it is
   * currently clipped) and the fixed footer; once the height is set, that sum is unchanged, so
   * this settles after one pass and re-runs only when the content changes.
   */
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    const natural = (upperRef.current?.offsetHeight ?? 0)
      + list.scrollHeight
      + (footerRef.current?.offsetHeight ?? 0);
    const next = Math.min(geometry.maxHeight, Math.max(0, natural));
    setPanelHeight((previous) => (previous === next ? previous : next));
  }, [geometry.maxHeight, mentions, snapshot, doneExpanded]);

  /*
   * Escape closes the popover. This is the topmost layer, so it claims the key on `window`'s
   * capture phase — ahead of the composer's React handlers, which preventDefault/stopPropagation
   * an Escape they think hides their suggestion chips, and ahead of the chat page's
   * document-capture abort guard. A bubbling document listener used to lose the key to the
   * composer. When another floating layer is open (a menu or a listbox), that layer owns Escape
   * and this one stays out of the way.
   */
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }
      if (document.querySelector('[role="menu"], [role="listbox"]') !== null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target === null) {
        return;
      }
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return;
      }
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [anchorRef, onClose]);

  const updateBottomFade = useCallback(() => {
    const element = listRef.current;
    if (element === null) {
      setShowBottomFade(false);
      return;
    }
    setShowBottomFade(element.scrollHeight - element.scrollTop - element.clientHeight > 1);
  }, []);

  // Re-measure whenever the list's content or the panel height changes (fetch settles, Done
  // group expands, the measured height is applied).
  useEffect(() => {
    updateBottomFade();
  }, [updateBottomFade, mentions, snapshot, doneExpanded, panelHeight]);

  const hasSession = sessionId !== null;
  const goals = mentions.status === 'loaded' ? mentions.reading.goals : [];
  const tasks = mentions.status === 'loaded' ? mentions.reading.tasks : [];
  const sessionTaskCount = mentions.status === 'loaded' ? mentions.reading.tasks.length : null;
  const sessionGoalCount = mentions.status === 'loaded' ? mentions.reading.goals.length : null;
  // A small, stable set: the in-flight rows only need membership, and deriving it here keeps the
  // marker on exactly the tasks this session's own prose named.
  const mentionedTaskIds: ReadonlySet<string> = new Set(tasks.map((task) => task.taskId));
  const labels: SessionMentionsLabels = {
    goalsHeading: (count) => t('quayPulse.goalsHeading', { count }),
    tasksHeading: (count) => t('quayPulse.tasksHeading', { count }),
    done: (count) => t('quayPulse.done', { count }),
    viaTasks: (count) => t('quayPulse.viaTasks', { count }),
    mentionedInMessage: t('quayPulse.mentionedInMessage'),
    mentionedAt: (when) => t('quayPulse.mentionedAt', { when }),
  };

  const renderListBody = () => {
    // A workspace without a conversation has nothing to mention; say so rather than rendering a
    // perpetual spinner for a request that will never be sent.
    if (!hasSession) {
      return (
        <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="quay-pulse-empty">
          {t('quayPulse.empty')}
        </p>
      );
    }

    if (mentions.status === 'idle' || mentions.status === 'loading') {
      return (
        <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="quay-pulse-loading">
          {t('quayPulse.loading')}
        </p>
      );
    }

    if (mentions.status === 'error') {
      // The gantt above is unaffected: the lanes reading and the mention list fail
      // independently, and one failed read must not blank the other.
      return (
        <p className="px-3 py-2 text-xs text-amber-700 dark:text-amber-300" data-testid="quay-pulse-list-error">
          {t('quayPulse.listError')}
        </p>
      );
    }

    if (tasks.length === 0 && goals.length === 0) {
      return (
        <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="quay-pulse-empty">
          {t('quayPulse.empty')}
        </p>
      );
    }

    return (
      <SessionMentionsSections
        goals={goals}
        tasks={tasks}
        lanesUnavailable={lanesUnavailable}
        onOpen={onOpenQuayPanel}
        labels={labels}
        testIdPrefix="quay-pulse"
        doneExpanded={doneExpanded}
        onDoneExpandedChange={setDoneExpanded}
      />
    );
  };

  /*
   * Rendered into `document.body`, not inside the header. The workspace's main region carries a
   * transform (its sidebar slide), and a `position: fixed` box inside a transformed ancestor is
   * positioned against THAT ancestor rather than the viewport — which shifted this dialog by the
   * sidebar's width. A portal puts it back in the viewport coordinate space the geometry above
   * computes in, and leaves the header's own flex layout untouched.
   */
  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t('quayPulse.title')}
      data-testid="quay-pulse-popover"
      style={{
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        maxHeight: geometry.maxHeight,
        height: panelHeight ?? undefined,
      }}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <div ref={upperRef} className="shrink-0 px-3 pb-1 pt-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t('quayPulse.title')}
        </p>
        <LoopPulseGantt
          gantt={gantt}
          windowHours={windowHours}
          onWindowChange={onWindowChange}
          refreshing={refreshing}
          unavailableReason={ganttUnavailable}
        />
      </div>

      <div className="relative min-h-0 flex-1">
        {lanesUnavailable && (
          <p className="px-3 pb-1 text-[11px] text-amber-700 dark:text-amber-300" data-testid="quay-pulse-lanes-note">
            {t('quayPulse.lanesNote')}
          </p>
        )}
        {/*
          No padding on the scroller itself: padding here would show above the first sticky
          heading as a gap. Each section carries its own horizontal padding instead.
        */}
        <div
          ref={listRef}
          onScroll={updateBottomFade}
          className="h-full overflow-y-auto overscroll-contain"
          data-testid="quay-pulse-list"
        >
          {/*
            Order is the task's own: chart (above), project counts, in-flight rows, then the
            session's mentioned goals and tasks. The first two read the project snapshot and the
            last reads the session; all three are independent, so a failure in one leaves the
            others standing.
          */}
          <ProjectCounts
            snapshot={snapshot}
            sessionTaskCount={sessionTaskCount}
            sessionGoalCount={sessionGoalCount}
          />
          <InFlightList snapshot={snapshot} mentionedTaskIds={mentionedTaskIds} />
          {renderListBody()}
        </div>
        {showBottomFade && (
          <div
            aria-hidden="true"
            data-testid="quay-pulse-bottom-fade"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[hsl(var(--popover))] to-transparent"
          />
        )}
      </div>

      <div ref={footerRef} className="shrink-0 border-t border-border/60 p-2">
        <button
          type="button"
          onClick={onOpenQuayPanel}
          data-testid="quay-pulse-open-panel"
          className="w-full rounded-lg bg-muted px-3 py-1.5 text-xs font-medium text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          {t('quayPulse.openQuayPanel')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
