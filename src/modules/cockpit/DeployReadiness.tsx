import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { api } from '@/shared/api';

/**
 * The deployment strip: the cockpit's persistent answer to 「当前运行的版本包括驾驶舱的变更吗」
 * and 「重启成功了吗」, plus the one click that builds and restarts.
 *
 * It is deliberately a READ of the server's readiness service with a single confirmed write
 * (`POST /api/system/deploy`). The confirmation panel is a discrete human action — the design
 * explicitly refuses a voice 「是」 for a restart — so clicking the action only opens the panel;
 * only its confirm button sends the request.
 *
 * The chat page no longer mounts this component's old `compact` form: the notices module's
 * `NoticeSlot` replaces it and reuses `DeployConfirmDialog` below, so the confirm panel and the
 * write it gates exist once. The cockpit page keeps the full strip permanently.
 */

export type DeployCommitReading = {
  sha: string;
  subject: string;
  taskId: string | null;
};

export type DeployCheckReading = {
  name: string;
  ok: boolean;
  status: number | null;
  detail: string;
};

export type DeployLastDeployReading = {
  targetSha: string;
  ok: boolean;
  checks: DeployCheckReading[];
  at: string;
};

export type DeployFailureReading = {
  step: 'build' | 'restart';
  outputTail: string;
  at: string;
};

export type DeployStatus =
  | 'fresh'
  | 'pending-build'
  | 'built-pending-restart'
  | 'building'
  | 'restarting'
  | 'unknown';

export type DeployReadinessReading = {
  status: DeployStatus;
  runningSha: string | null;
  builtSha: string | null;
  clientBuiltSha: string | null;
  headSha: string | null;
  /**
   * The browser bundle and the server build on disk name different commits. A restart applies
   * both, so this is shown on its own line instead of being folded into the pending-build count.
   */
  buildSkew: boolean;
  pendingCommits: DeployCommitReading[];
  lastDeploy: DeployLastDeployReading | null;
  failure: DeployFailureReading | null;
  checkedAt: string;
};

/** Reads the current readiness; the default talks to `/api/system/deploy-readiness`. */
export type DeployReadinessPort = () => Promise<DeployReadinessReading>;

/** Sends the one confirmed build+restart request. */
export type DeployExecutePort = () => Promise<{ ok: boolean }>;

/**
 * One project's queue reading, summed by the page from the fleet summary it already holds.
 * `ready + todo` is the queue: the tasks the driver can still pick up. The strip shows that
 * sum as `todo N`, from the SAME project reading the cockpit's cards are drawn from — not a
 * second task-store read.
 */
export type DeployQueueReading = {
  readonly ready: number;
  readonly todo: number;
};

/** The strip's `todo N` number: the queue the cards view and the driver share. */
function queueTodoCount(queue: DeployQueueReading): number {
  return queue.ready + queue.todo;
}

/**
 * The strip's one build-truth judgment. It reads the three fingerprints `build-skew-check`
 * compares (`dist-server/build-info.json`, `dist/build-info.json`) plus the sha of the process
 * that is actually RUNNING, and never a historical deploy record:
 *
 *   - `unavailable` — at least one fingerprint is absent/unreadable. The strip says so and
 *     draws no sha at all; it must not fall back to the last deploy's target sha.
 *   - `pending` with `skew` — the browser and server builds on disk name different commits
 *     (exactly `build-skew-check`'s `skew` verdict); a restart would pair two builds.
 *   - `pending` — the running process is not the build on disk (one build step behind), or
 *     the server reported source commits between the built sha and HEAD. `count` is the
 *     reading the strip prints as 「N changes not yet built」.
 *   - `current` — the running process IS the build on disk and no source commit is pending.
 */
type DeployBuildTruth =
  | { kind: 'unavailable' }
  | { kind: 'current'; runningSha: string }
  | {
      kind: 'pending';
      runningSha: string;
      builtSha: string;
      count: number;
      skew: boolean;
    };

/**
 * The one comparison rule. Kept as a free function so the criterion exercises exactly the
 * production decision rather than a re-implementation. The server's `status` field is
 * deliberately not an input: it may be stale, and the sha readings are the facts this strip
 * is about.
 */
function classifyDeployBuild(
  reading: Pick<
    DeployReadinessReading,
    'runningSha' | 'builtSha' | 'clientBuiltSha' | 'pendingCommits'
  >,
): DeployBuildTruth {
  const { runningSha, builtSha, clientBuiltSha } = reading;
  // A process that cannot name its own build, or a missing build record, is an unreadable
  // reading — never a licence to substitute the last deploy's sha.
  if (runningSha === null || builtSha === null || clientBuiltSha === null) {
    return { kind: 'unavailable' };
  }
  // build-skew-check's rule: both records are readable, and they disagree.
  const skew = builtSha !== clientBuiltSha;
  if (skew) {
    return { kind: 'pending', runningSha, builtSha, count: 1, skew: true };
  }
  if (runningSha !== builtSha) {
    // The build on disk is one build ahead of the running process: restarting is what makes
    // the built sha live, so the reading is 「1 change not yet built」, naming both shas.
    return { kind: 'pending', runningSha, builtSha, count: 1, skew: false };
  }
  if (reading.pendingCommits.length > 0) {
    // Both builds and the running process agree, but HEAD has source commits the build does
    // not contain. That is the one case where the server's commit list is the count.
    return {
      kind: 'pending',
      runningSha,
      builtSha,
      count: reading.pendingCommits.length,
      skew: false,
    };
  }
  return { kind: 'current', runningSha };
}

type DeployReadinessProps = {
  read?: DeployReadinessPort;
  deploy?: DeployExecutePort;
  /** Injected in tests so the relative 「2 分钟前」 is deterministic. */
  now?: () => number;
  /**
   * The project queue the cockpit already holds (`ready + todo`, summed by `CockpitPage` over
   * the same fleet reading the cards are built from). `null` means the fleet reading is not
   * available; the strip then draws no todo number rather than a false zero.
   */
  queue?: DeployQueueReading | null;
};

/** What the shared confirmation panel draws: the commits that would take effect, and the one
 * confirmed write. The panel itself never opens itself; the caller owns that state. */
export type DeployConfirmDialogProps = {
  pendingCommits: DeployCommitReading[];
  /** The confirmed write; defaults to `POST /api/system/deploy`. Injected in tests. */
  deploy?: DeployExecutePort;
  /** Closes the panel without sending anything. */
  onCancel: () => void;
  /** Called after a confirmed write succeeds, with the server's answer. */
  onDeployed?: (result: { ok: boolean }) => void;
  /** Called when the write throws, with the error's message. */
  onError?: (message: string) => void;
};

const POLL_INTERVAL_MS = 15_000;

const defaultRead: DeployReadinessPort = async () => {
  const response = await api.system.deployReadiness();
  return (await response.json()) as DeployReadinessReading;
};

const defaultDeploy: DeployExecutePort = async () => {
  const response = await api.system.deploy();
  return (await response.json()) as { ok: boolean };
};

/** The first seven characters of a sha are enough to identify a build by eye. */
function shortSha(sha: string | null): string {
  return sha === null ? '—' : sha.slice(0, 7);
}

/**
 * The confirmation panel shared by the cockpit strip and the notices slot. It is the only place
 * a deploy request is sent from a notice: the notice's primary action merely opens it, and the
 * confirm button is a discrete human action — the design deliberately refuses a voice 「是」 for a
 * restart. Rendering it in both surfaces keeps that contract in one implementation.
 *
 * Consumers: `DeployReadiness` (the cockpit's persistent strip) and the notices module's
 * `NoticeSlot` (through this module's barrel).
 */
export function DeployConfirmDialog({
  pendingCommits,
  deploy = defaultDeploy,
  onCancel,
  onDeployed,
  onError,
}: DeployConfirmDialogProps) {
  const { t } = useTranslation();
  // Whether the confirmed request is in flight. Essential: it turns the confirm button
  // non-repeatable while the same deploy is already running.
  const [submitting, setSubmitting] = useState(false);

  const confirmAndDeploy = useCallback(async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const result = await deploy();
      onDeployed?.(result);
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [deploy, onDeployed, onError, submitting]);

  return (
    <div
      data-testid="deploy-confirm-panel"
      role="dialog"
      aria-modal="true"
      aria-label={t('cockpit.deployConfirmTitle')}
      className="absolute inset-x-0 top-full z-30 mt-2 rounded-lg border border-border bg-card p-3 shadow-lg"
    >
      <p className="text-sm font-medium">{t('cockpit.deployConfirmTitle')}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t('cockpit.deployConfirmBody')}</p>
      {pendingCommits.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground" data-testid="deploy-no-commits">
          {t('cockpit.deployNoCommits')}
        </p>
      ) : (
        <ul className="mt-1 max-h-40 space-y-1 overflow-auto" data-testid="deploy-commits">
          {pendingCommits.map((commit) => (
            <li key={commit.sha} data-testid="deploy-commit" className="text-xs">
              <code className="rounded bg-muted px-1">{shortSha(commit.sha)}</code>{' '}
              {commit.subject}
              {commit.taskId !== null && (
                <span className="ml-1 text-muted-foreground">
                  {t('cockpit.deployCommitTask', { task: commit.taskId })}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{t('cockpit.deployConfirmRestartHint')}</p>
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          data-testid="deploy-cancel"
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          onClick={onCancel}
        >
          {t('cockpit.deployCancel')}
        </button>
        <button
          type="button"
          data-testid="deploy-confirm"
          disabled={submitting}
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50"
          onClick={() => void confirmAndDeploy()}
        >
          {t('cockpit.deployConfirm')}
        </button>
      </div>
    </div>
  );
}

/**
 * The cockpit's persistent deployment strip: the answer to 「当前运行的版本包括驾驶舱的变更吗」
 * and 「重启成功了吗」, plus the one click that opens the confirmation panel. The chat page's
 * interrupt slot lives in the notices module and reuses `DeployConfirmDialog` from here.
 *
 * Used by `CockpitPage`.
 */
export default function DeployReadiness({
  read = defaultRead,
  deploy = defaultDeploy,
  now = () => Date.now(),
  queue = null,
}: DeployReadinessProps) {
  const { t } = useTranslation();
  // The server's current reading. Essential: every sentence and button below is a projection
  // of it, and it is refreshed on a timer so a build started elsewhere shows up here.
  const [reading, setReading] = useState<DeployReadinessReading | null>(null);
  // Why no reading could be produced. Essential: hiding a failed poll would make the strip
  // look deliberately absent rather than unable to answer.
  const [error, setError] = useState<string | null>(null);
  // Whether the confirmation panel is open. Essential: it is the gate between one click and a
  // restart, and it must be explicit rather than inferred from a pending request.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await read();
      setReading(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [read]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (error !== null) {
    return (
      <p role="status" data-testid="deploy-readiness" data-status="unavailable" className="text-xs text-muted-foreground">
        {t('cockpit.deployUnavailable', { reason: error })}
      </p>
    );
  }

  if (reading === null) {
    return null;
  }

  // The one derived judgment. A build/restart the server is running right now overrides it:
  // the disk fingerprints are expected to disagree while a build runs, so blaming a skew there
  // would report the deploy's own transient state as a defect.
  const truth = classifyDeployBuild(reading);
  const inFlightStatus =
    reading.status === 'building' || reading.status === 'restarting' ? reading.status : null;

  const statusLabel = (() => {
    if (inFlightStatus === 'building') {
      return t('cockpit.deployBuilding');
    }
    if (inFlightStatus === 'restarting') {
      return t('cockpit.deployRestarting');
    }
    switch (truth.kind) {
      case 'unavailable':
        // 「Unknown」 is the whole answer: the strip must not fall back to the last deploy's
        // sha, which is a historical materialisation and not the running build.
        return t('cockpit.deployUnknown');
      case 'current':
        return t('cockpit.deployFresh');
      case 'pending':
        // A skewed pair is two builds that disagree, not a pending build — say which sides
        // disagree (the same verdict `build-skew-check --json` prints).
        if (truth.skew) {
          return t('cockpit.deployBuildSkew', {
            client: shortSha(reading.clientBuiltSha),
            server: shortSha(truth.builtSha),
          });
        }
        return truth.count === 1
          ? t('cockpit.deployPendingBuildOne', { n: 1 })
          : t('cockpit.deployPendingBuild', { n: truth.count });
      default:
        return t('cockpit.deployUnknown');
    }
  })();

  // A skew is fixable by the same one action (the deploy path runs the full `npm run build`),
  // so the strip must offer it whenever the running process is not the build on disk.
  const canDeploy = inFlightStatus === null
    && (truth.kind === 'pending');

  // The last deploy line reports the RUNNING process. `lastDeploy` is a persisted record of a
  // past verification; it may only add its verdict and timestamp when it verified the sha that
  // is running now. Otherwise the line is the bare running sha — never another deploy's sha.
  const lastDeployMatchesRunning = reading.lastDeploy !== null
    && reading.runningSha !== null
    && reading.lastDeploy.targetSha === reading.runningSha;
  const lastDeployLine = (() => {
    if (reading.runningSha === null) {
      return null;
    }
    if (!lastDeployMatchesRunning) {
      // No verdict to claim: the persisted record describes a different deploy.
      return <code data-testid="deploy-running-sha">{shortSha(reading.runningSha)}</code>;
    }
    return reading.lastDeploy?.ok
      ? t('cockpit.deployLastOk', {
          sha: shortSha(reading.runningSha),
          time: relativeTime(reading.lastDeploy.at, now(), t),
        })
      : t('cockpit.deployLastFailed', { sha: shortSha(reading.runningSha) });
  })();

  const failedCheck = lastDeployMatchesRunning && reading.lastDeploy?.ok === false
    ? reading.lastDeploy.checks.find((check) => !check.ok)?.name ?? null
    : null;

  // The machine reading follows the derived truth, not the possibly-stale server status.
  const derivedStatus = inFlightStatus
    ?? (truth.kind === 'unavailable' ? 'unknown' : truth.kind === 'pending' ? 'pending-build' : 'fresh');

  const queueTodo = queue === null ? null : queueTodoCount(queue);

  return (
    <section
      data-testid="deploy-readiness"
      data-status={derivedStatus}
      data-build-truth={truth.kind}
      data-build-skew={truth.kind === 'pending' && truth.skew ? 'true' : 'false'}
      className="relative flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs"
      aria-label={t('cockpit.deployStatus')}
    >
      <span data-testid="deploy-status" className="text-foreground">
        {statusLabel}
      </span>

      {/* The two fingerprints behind the count, named on the strip itself: the running
          process's sha and the sha of the build on disk. */}
      {truth.kind === 'pending' && (
        <span data-testid="deploy-build-readings" className="text-muted-foreground">
          <code data-testid="deploy-running-build">{shortSha(truth.runningSha)}</code>
          {' · '}
          <code data-testid="deploy-built-build">{shortSha(truth.builtSha)}</code>
        </span>
      )}

      {queueTodo !== null && (
        <span
          data-testid="deploy-queue"
          data-queue-todo={queueTodo}
          data-queue-ready={queue?.ready}
          data-queue-pending={queue?.todo}
          // The number is the whole queue: ready + todo, from the same project reading the
          // cockpit's cards are built from.
          title={`${t('cockpit.phoneStatusTodo', { n: queueTodo })} · ${t('cockpit.readyCount', { n: queue?.ready ?? 0 })}`}
          className="text-muted-foreground"
        >
          {t('cockpit.phoneStatusTodo', { n: queueTodo })}
        </span>
      )}

      {reading.failure !== null && (
        <span data-testid="deploy-failure" className="text-destructive">
          {t('cockpit.deployFailingStep', { step: reading.failure.step })}
          <code className="ml-1 rounded bg-muted px-1 py-0.5 text-[11px]" data-testid="deploy-failure-output">
            {lastLine(reading.failure.outputTail)}
          </code>
        </span>
      )}

      {canDeploy && (
        <button
          type="button"
          data-testid="deploy-action"
          className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
          onClick={() => setConfirmOpen(true)}
        >
          {t('cockpit.deployAction')}
        </button>
      )}

      {lastDeployLine !== null && (
        <span data-testid="deploy-last" data-verified={lastDeployMatchesRunning ? 'true' : 'false'} className="text-muted-foreground">
          {lastDeployLine}
          {failedCheck !== null && ` · ${t('cockpit.deployLastFailedCheck', { check: failedCheck })}`}
        </span>
      )}

      {confirmOpen && (
        <DeployConfirmDialog
          pendingCommits={reading.pendingCommits}
          deploy={deploy}
          onCancel={() => setConfirmOpen(false)}
          onDeployed={() => {
            setConfirmOpen(false);
            void load();
          }}
          onError={setError}
        />
      )}
    </section>
  );
}

/** The last non-empty line of a failure transcript: the tail without flooding the strip. */
function lastLine(outputTail: string): string {
  const lines = outputTail.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  return lines.at(-1) ?? '';
}

/**
 * A relative timestamp for the last verified deploy. The translation function is passed in so
 * the unit choices stay in the locale bundle rather than in this file.
 */
function relativeTime(
  at: string,
  now: number,
  t: TFunction,
): string {
  const elapsedMs = Math.max(0, now - Date.parse(at));
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) {
    return t('cockpit.deployJustNow');
  }
  if (minutes < 60) {
    return t('cockpit.deployMinutesAgo', { n: minutes });
  }
  return t('cockpit.deployHoursAgo', { n: Math.floor(minutes / 60) });
}
