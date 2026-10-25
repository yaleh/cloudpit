import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { SessionTaskChainStage } from '@/shared/types';
import { QUAY_TASK_BADGE_BASE_CLASS } from '@/shared/constants';
import { cn } from '@/shared/utils';
import {
  SessionMentionsSections,
  type SessionMentionsLabels,
} from '@/modules/quay/SessionTaskRows';
import { useSessionQuay } from '@/modules/quay/hooks/useSessionQuay';

/**
 * The Quay tab's session column: what THIS conversation mentioned and which tasks it started.
 *
 * Consumed by `QuayPanel` only. The two blocks are read independently (`useSessionQuay`) and
 * each states its own failure: a mention-list failure never hides the started-task list, and a
 * `503`/`404` from the task-chain endpoint hides only that block, with the reason.
 *
 * The rows and section layout are the SAME component the title-bar popover uses
 * (`SessionTaskRows`), so the two surfaces cannot drift into two different row designs.
 */

/** Stage-badge colours, matching the panel's task/phase palette. */
const STAGE_BADGE_CLASSES: Record<SessionTaskChainStage, string> = {
  filed: 'bg-muted text-muted-foreground',
  ready: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'in-progress': 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  landed: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  built: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
  running: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  blocked: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  'needs-human': 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  superseded: 'bg-muted text-muted-foreground',
  unknown: 'bg-muted text-muted-foreground',
};

/** The i18n key for a stage label, reusing the chain's existing translated vocabulary. */
const STAGE_LABEL_KEYS: Record<SessionTaskChainStage, string> = {
  filed: 'sessionTaskChain.stageFiled',
  ready: 'sessionTaskChain.stageReady',
  'in-progress': 'sessionTaskChain.stageInProgress',
  landed: 'sessionTaskChain.stageLanded',
  built: 'sessionTaskChain.stageBuilt',
  running: 'sessionTaskChain.stageRunning',
  blocked: 'sessionTaskChain.stageBlocked',
  'needs-human': 'sessionTaskChain.stageNeedsHuman',
  superseded: 'sessionTaskChain.stageSuperseded',
  unknown: 'sessionTaskChain.stageUnknown',
};

export type QuaySessionPanelProps = {
  projectId: string;
  /** The selected conversation, or `null` when the workspace has none. */
  sessionId: string | null;
  /** Bumped by the panel's Refresh button; a change re-reads both blocks in place. */
  refreshSignal?: number;
};

/** The Quay tab's 「本会话」 panel. Consumed by `QuayPanel`. */
/** Rows are display-only inside the Quay tab: the task says not to add in-tab task navigation. */
const NOOP = () => {};

export function QuaySessionPanel({ projectId, sessionId, refreshSignal = 0 }: QuaySessionPanelProps) {
  const { t } = useTranslation();
  const { mentions, taskChain } = useSessionQuay(projectId, sessionId, true, refreshSignal);
  // The folded Done group is panel-local presentation state; the popover keeps its own copy.
  const [doneExpanded, setDoneExpanded] = useState(false);

  const labels: SessionMentionsLabels = {
    goalsHeading: (count) => t('quayTab.goalsHeading', { count }),
    tasksHeading: (count) => t('quayTab.tasksHeading', { count }),
    done: (count) => t('quayTab.done', { count }),
    viaTasks: (count) => t('quayTab.viaTasks', { count }),
    mentionedInMessage: t('quayTab.mentionedInMessage'),
    mentionedAt: (when) => t('quayTab.mentionedAt', { when }),
  };

  const renderMentions = () => {
    if (mentions.status === 'idle' || mentions.status === 'loading') {
      return (
        <p className="px-1 py-1 text-xs text-muted-foreground" data-testid="quay-session-mentions-loading">
          {t('quayTab.loadingMentions')}
        </p>
      );
    }
    if (mentions.status === 'error') {
      return (
        <p className="px-1 py-1 text-xs text-amber-700 dark:text-amber-300" data-testid="quay-session-mentions-error">
          {t('quayTab.mentionsError')}
        </p>
      );
    }
    const { tasks, goals } = mentions.reading;
    if (tasks.length === 0 && goals.length === 0) {
      return (
        <p className="px-1 py-1 text-xs text-muted-foreground" data-testid="quay-session-mentions-empty">
          {t('quayTab.noMentions')}
        </p>
      );
    }
    return (
      <SessionMentionsSections
        goals={goals}
        tasks={tasks}
        lanesUnavailable={false}
        onOpen={NOOP}
        labels={labels}
        testIdPrefix="quay-session"
        doneExpanded={doneExpanded}
        onDoneExpandedChange={setDoneExpanded}
        headingClassName="sticky top-0 z-10 bg-background py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      />
    );
  };

  const renderTaskChain = () => {
    if (taskChain.status === 'idle' || taskChain.status === 'loading') {
      return (
        <p className="px-1 py-1 text-xs text-muted-foreground" data-testid="quay-session-chain-loading">
          {t('quayTab.loadingChain')}
        </p>
      );
    }
    if (taskChain.status === 'unavailable') {
      // Only this block is hidden: the endpoint (or the project/session) is not available, and
      // the reason is stated here rather than blanking the whole panel.
      return (
        <p className="px-1 py-1 text-xs text-amber-700 dark:text-amber-300" data-testid="quay-session-chain-unavailable">
          {t('quayTab.chainUnavailable', { reason: taskChain.reason })}
        </p>
      );
    }
    if (taskChain.status === 'error') {
      return (
        <p className="px-1 py-1 text-xs text-amber-700 dark:text-amber-300" data-testid="quay-session-chain-error">
          {t('quayTab.chainError')}
        </p>
      );
    }

    const { tasks } = taskChain.reading;
    if (tasks.length === 0) {
      return (
        <p className="px-1 py-1 text-xs text-muted-foreground" data-testid="quay-session-chain-empty">
          {t('quayTab.createdEmpty')}
        </p>
      );
    }

    return (
      <ul className="space-y-1.5" data-testid="quay-session-chain-list">
        {tasks.map((task) => (
          <li
            key={task.taskId}
            className="rounded border border-border/40 px-2 py-1.5"
            data-testid="quay-session-chain-row"
            data-task-id={task.taskId}
            data-stage={task.stage}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 whitespace-normal break-words font-mono text-[11px] text-foreground">
                {task.taskId}
              </span>
              <span
                className={cn(QUAY_TASK_BADGE_BASE_CLASS, STAGE_BADGE_CLASSES[task.stage])}
                data-testid="quay-session-chain-stage"
              >
                {t(STAGE_LABEL_KEYS[task.stage])}
              </span>
            </div>
            <div className="line-clamp-2 text-[11px] text-muted-foreground" title={task.title}>
              {task.title}
            </div>
            {task.stage === 'blocked' && task.blockedReason !== null && (
              <div
                className="mt-0.5 line-clamp-1 text-[10px] text-amber-700 dark:text-amber-300"
                title={task.blockedReason}
                data-testid="quay-session-chain-blocked-reason"
              >
                {t('quayTab.blockedReason', { reason: task.blockedReason.split('\n')[0] })}
              </div>
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <section
      data-testid="quay-session-panel"
      className="flex min-w-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border/60 bg-muted/10 p-3 lg:max-h-[calc(100vh-10rem)]"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('quayTab.sessionPanelTitle')}
      </h2>

      {sessionId === null ? (
        <p className="text-xs text-muted-foreground" data-testid="quay-session-no-session">
          {t('quayTab.noSession')}
        </p>
      ) : (
        <>
          <div data-testid="quay-session-mentions">
            {renderMentions()}
          </div>

          <div className="border-t border-border/60 pt-2" data-testid="quay-session-created">
            {taskChain.status === 'loaded' && (
              <h3 className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t('quayTab.createdHeading', { count: taskChain.reading.tasks.length })}
              </h3>
            )}
            {renderTaskChain()}
          </div>
        </>
      )}
    </section>
  );
}
