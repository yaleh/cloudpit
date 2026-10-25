import { useTranslation } from 'react-i18next';

import type {
  QuayInFlightPhase,
  QuaySessionMentionGoal,
  QuaySessionMentionTask,
} from '@/shared/types';
import {
  QUAY_DEFAULT_TASK_STATUS_BADGE_CLASS,
  QUAY_GOAL_STATUS_PERCENT,
  QUAY_IN_FLIGHT_PHASE_META,
  QUAY_TASK_BADGE_BASE_CLASS,
  QUAY_TASK_STATUS_BADGE_CLASSES,
} from '@/shared/constants';
import { cn, formatRelativeTime } from '@/shared/utils';

/**
 * The shared presentation of the session's mentioned goals and tasks.
 *
 * Consumed by both `SessionPulsePopover` (the title bar's popover) and `QuaySessionPanel` (the
 * Quay tab's session column), so the two surfaces draw the same rows and the same Goals / Tasks
 * sections instead of maintaining copies. Each consumer owns its own data read, empty/error
 * states and the folded-Done toggle state; this module owns only the row/section markup.
 *
 * The `testIdPrefix` lets each surface keep its own DOM vocabulary (`quay-pulse-*` in the
 * popover, `quay-session-*` in the panel) while the markup stays one implementation.
 */

export type SessionMentionsLabels = {
  goalsHeading: (count: number) => string;
  tasksHeading: (count: number) => string;
  done: (count: number) => string;
  viaTasks: (count: number) => string;
  mentionedInMessage: string;
  mentionedAt: (when: string) => string;
};

/** The task row's sort bucket: in-flight first, then work that needs a person, then the rest. */
export function taskRank(task: QuaySessionMentionTask, lanesUnavailable: boolean): number {
  if (!lanesUnavailable && task.phase !== null) {
    return 0;
  }
  if (task.status === 'needs-human') {
    return 1;
  }
  if (task.status === 'ready') {
    return 2;
  }
  return 3;
}

/** Whether a stored status is folded into the Done group. */
export function isFoldedStatus(status: string): boolean {
  return status === 'done' || status === 'superseded';
}

/**
 * The mention's relative reading ("5 minutes ago"), or `null` when the reading carries no
 * instant. A mention stamped slightly in the future (clock skew) is clamped to now, so the row
 * can never read "in 5 minutes" for something that has already happened.
 */
function mentionRelativeText(iso: string | null, locale: string): string | null {
  if (iso === null) {
    return null;
  }
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return null;
  }
  return formatRelativeTime(new Date(Math.min(at, Date.now())).toISOString(), locale);
}

/**
 * One task row. Kept separate so the active and folded groups draw the same row — the only
 * difference between them is which list they sit in. Used by `SessionPulsePopover` and
 * `QuaySessionPanel` through `SessionMentionsSections`.
 */
export function SessionTaskRow({
  task,
  lanesUnavailable,
  onOpen,
  labels,
  testIdPrefix,
}: {
  task: QuaySessionMentionTask;
  lanesUnavailable: boolean;
  onOpen: () => void;
  labels: SessionMentionsLabels;
  testIdPrefix: string;
}) {
  const { i18n } = useTranslation();
  // The lane reading is authoritative for "in flight"; when it is unreadable the row falls back
  // to the task store's own status and claims no phase (a stale phase would be a guess).
  const phaseMeta = !lanesUnavailable && task.phase !== null
    && Object.prototype.hasOwnProperty.call(QUAY_IN_FLIGHT_PHASE_META, task.phase)
    ? QUAY_IN_FLIGHT_PHASE_META[task.phase as QuayInFlightPhase]
    : null;
  // Same base + colour composition as the Quay tab's in-flight card, so the two badges for one
  // phase are byte-identical.
  const badgeClass = cn(
    QUAY_TASK_BADGE_BASE_CLASS,
    phaseMeta?.className
      ?? QUAY_TASK_STATUS_BADGE_CLASSES[task.status]
      ?? QUAY_DEFAULT_TASK_STATUS_BADGE_CLASS,
  );
  const mentionWhen = mentionRelativeText(task.lastMentionAt, i18n.language);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`${testIdPrefix}-task-row`}
      data-task-id={task.taskId}
      className="flex w-full flex-col gap-0.5 rounded border border-border/40 px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <span className="flex items-start justify-between gap-2">
        {/* Ids may be long and are the row's identity: wrap them rather than truncating. */}
        <span className="min-w-0 whitespace-normal break-words font-mono text-[11px] text-foreground">
          {task.taskId}
        </span>
        <span className={badgeClass} data-testid={`${testIdPrefix}-task-badge`}>
          {phaseMeta?.label ?? task.status}
        </span>
      </span>
      <span className="line-clamp-2 text-[11px] text-muted-foreground">{task.title}</span>
      {(task.goalId !== null || mentionWhen !== null) && (
        <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          {task.goalId !== null && <span className="font-mono">{task.goalId}</span>}
          {mentionWhen !== null && (
            <span data-testid={`${testIdPrefix}-mentioned-ago`}>
              {labels.mentionedAt(mentionWhen)}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

/**
 * One goal row, drawn in the Stage goals card's shape: id, status, title, progress bar (never
 * for an achieved goal) and how the session reached it.
 */
export function SessionGoalRow({
  goal,
  onOpen,
  labels,
  testIdPrefix,
}: {
  goal: QuaySessionMentionGoal;
  onOpen: () => void;
  labels: SessionMentionsLabels;
  testIdPrefix: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid={`${testIdPrefix}-goal-row`}
        data-goal-id={goal.goalId}
        className="flex w-full flex-col gap-0.5 rounded border border-border/40 px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
      >
        <span className="flex items-center justify-between gap-2 text-xs">
          <span className="shrink-0 font-mono text-[11px] text-foreground">{goal.goalId}</span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{goal.status}</span>
        </span>
        <span className="line-clamp-2 text-[11px] text-muted-foreground md:line-clamp-1" title={goal.title}>
          {goal.title}
        </span>
        {/* An achieved goal has nothing left to complete, so its bar would be a full-width wall
            of colour saying the same thing in every row. The status text stays authoritative. */}
        {goal.status !== 'achieved' && (
          <span className="mt-1 block h-1.5 w-full overflow-hidden rounded bg-muted" data-testid={`${testIdPrefix}-goal-bar`}>
            <span
              className="block h-full rounded bg-primary"
              style={{ width: `${QUAY_GOAL_STATUS_PERCENT[goal.status] ?? 0}%` }}
            />
          </span>
        )}
        <span className="text-[10px] text-muted-foreground">
          {goal.viaTaskCount > 0
            ? labels.viaTasks(goal.viaTaskCount)
            : labels.mentionedInMessage}
        </span>
      </button>
    </li>
  );
}

/**
 * The Goals and Tasks sections, including the folded Done group.
 *
 * The Done group's expansion is a PROP, not internal state: the popover measures its own panel
 * height from the list's scrollHeight and must re-measure when the group opens, so the toggle has
 * to remain observable to that consumer.
 */
export function SessionMentionsSections({
  goals,
  tasks,
  lanesUnavailable,
  onOpen,
  labels,
  testIdPrefix,
  doneExpanded,
  onDoneExpandedChange,
  headingClassName = 'sticky top-0 z-10 bg-popover py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground',
}: {
  goals: QuaySessionMentionGoal[];
  tasks: QuaySessionMentionTask[];
  lanesUnavailable: boolean;
  onOpen: () => void;
  labels: SessionMentionsLabels;
  testIdPrefix: string;
  doneExpanded: boolean;
  onDoneExpandedChange: (expanded: boolean) => void;
  headingClassName?: string;
}) {
  const activeTasks = tasks
    .filter((task) => !isFoldedStatus(task.status))
    .map((task) => task)
    .sort((left, right) => taskRank(left, lanesUnavailable) - taskRank(right, lanesUnavailable));
  const foldedTasks = tasks.filter((task) => isFoldedStatus(task.status));

  return (
    <>
      {goals.length > 0 && (
        <section className="px-3 pb-2" data-testid={`${testIdPrefix}-goals`}>
          <h3 className={headingClassName}>
            {labels.goalsHeading(goals.length)}
          </h3>
          <ul className="space-y-1.5">
            {goals.map((goal) => (
              <SessionGoalRow
                key={goal.goalId}
                goal={goal}
                onOpen={onOpen}
                labels={labels}
                testIdPrefix={testIdPrefix}
              />
            ))}
          </ul>
        </section>
      )}

      {tasks.length > 0 && (
        <section className="px-3 pb-2" data-testid={`${testIdPrefix}-tasks`}>
          <h3 className={headingClassName}>
            {labels.tasksHeading(tasks.length)}
          </h3>
          <ul className="space-y-1.5">
            {activeTasks.map((task) => (
              <li key={task.taskId}>
                <SessionTaskRow
                  task={task}
                  lanesUnavailable={lanesUnavailable}
                  onOpen={onOpen}
                  labels={labels}
                  testIdPrefix={testIdPrefix}
                />
              </li>
            ))}
          </ul>

          {foldedTasks.length > 0 && (
            <div className="mt-1.5">
              <button
                type="button"
                onClick={() => onDoneExpandedChange(!doneExpanded)}
                aria-expanded={doneExpanded}
                data-testid={`${testIdPrefix}-done-toggle`}
                className="w-full rounded px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {labels.done(foldedTasks.length)}
              </button>
              {doneExpanded && (
                <ul className="space-y-1.5">
                  {foldedTasks.map((task) => (
                    <li key={task.taskId}>
                      <SessionTaskRow
                        task={task}
                        lanesUnavailable={lanesUnavailable}
                        onOpen={onOpen}
                        labels={labels}
                        testIdPrefix={testIdPrefix}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </>
  );
}
