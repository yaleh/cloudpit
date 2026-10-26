/**
 * The manual ArchGuard re-analysis job — one single-flight child per project root.
 *
 * WHY THIS EXISTS. The architecture tab reads `.archguard/query/**`, and until now
 * nothing in the UI could refresh it: `service.ts` only reads, and `cache.ts` treats
 * the manifest content as the invalidation key. This module is the write half — a
 * manual, whole-project re-analysis triggered from the tab's footer — plus the
 * coalescing that keeps several tabs or sessions from spawning the same multi-second
 * CLI run at once.
 *
 * THE THREE HALVES THIS FILE ORCHESTRATES.
 *   - `refresh-settings.ts` reads the `architecture.refresh` block (CLI entry,
 *     timeout, memory cap, the criterion's fault lever) and re-reads it when the
 *     file's mtime changes.
 *   - `refresh-spawn.ts` resolves the CLI and the source scopes, then spawns the
 *     analysis detached, optionally behind a `systemd-run --user --scope` memory cap.
 *   - `refresh-publish.ts` owns the staging directory and the staged rename that
 *     publishes a successful run; a failed or timed-out run leaves the live
 *     `.archguard/query` byte-for-byte untouched.
 *   - `refresh-duplicates.ts` recomputes the per-scope duplicate report after the
 *     publish, through the ArchGuard MCP stdio server; its failure is recorded in
 *     the stderr tail but does not fail the refresh.
 * This file owns only the job records: single-flight/coalescing, the stage machine,
 * the stderr tail, the timeout/kill path, and the shutdown hook. Splitting the other
 * three concerns out is what keeps each of them independently testable and this file
 * readable.
 *
 * Consumers: `routes.ts` (the two HTTP verbs), `module.ts` (the process-wide instance
 * plus the shutdown hook), and `tests/refreshJob.test.ts` / `tests/refreshRoutes.test.ts`.
 */
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

import type {
  ArchitectureRefreshStage,
  ArchitectureRefreshStartResult,
  ArchitectureRefreshStatus,
} from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { createRefreshPublisher } from './refresh-publish.js';
import { createRefreshDuplicates, type RefreshDuplicates } from './refresh-duplicates.js';
import {
  createRefreshSettingsSource,
  SERVER_SETTINGS_PATH_ENV,
  type ArchitectureRefreshDefect,
  type RefreshSettings,
} from './refresh-settings.js';
import { createRefreshSpawner, type RefreshSpawn } from './refresh-spawn.js';

// The module's public surface stays on this file so consumers never import the
// concern files directly (AC-415/AC-418). Consumers: `tests/refreshJob.test.ts`
// (`RefreshSpawn`), `routes.ts` (`ArchguardRefreshJob`).
export type { ArchitectureRefreshDefect, RefreshDuplicates, RefreshSettings, RefreshSpawn };
export { SERVER_SETTINGS_PATH_ENV };

/** How many trailing stderr lines a status reading carries. */
const STDERR_TAIL_LINES = 40;

/** How long a child gets to exit after SIGTERM before the group is SIGKILLed. */
const KILL_GRACE_MS = 5_000;

/**
 * The status/start surface `routes.ts` consumes.
 *
 * `start` never throws for a runtime failure (unresolvable CLI, spawn error, non-zero
 * exit): those are the job's `failed` reading, which the tab shows with a reason and a
 * Retry. It DOES throw `PROJECT_NOT_FOUND` for an unknown project id, like every other
 * architecture read.
 *
 * Consumers: `routes.ts` (the two HTTP verbs); `module.ts` builds the process-wide
 * instance.
 */
export type ArchguardRefreshJob = {
  start(projectId: string): ArchitectureRefreshStartResult;
  status(projectId: string): ArchitectureRefreshStatus;
  /** Kills a running child and waits for its close (the shutdown hook). */
  shutdown(): Promise<void>;
  /** The process-exit variant: SIGKILL the group synchronously, never await. */
  shutdownSync(): void;
};

/** What one job record holds; the map is keyed by the resolved project root. */
type JobRecord = {
  readonly jobId: string;
  readonly projectPath: string;
  state: 'running' | 'succeeded' | 'failed';
  stage: ArchitectureRefreshStage;
  readonly startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  readonly stderr: string[];
  error: string | null;
  child: ChildProcess | null;
  killTimer: NodeJS.Timeout | null;
  /** Resolves when the record reaches a terminal state (status is live). */
  finished: Promise<void>;
  resolveFinished: () => void;
  /** Resolves when the child's `close` event has been processed. */
  closed: Promise<void>;
  resolveClosed: () => void;
};

function errorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** The key a record is stored under: one job per real path, never per symlink alias. */
function realpathOrSelf(filePath: string): string {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return filePath;
  }
}

function newJobId(): string {
  return `archguard-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Creates the process-wide refresh job.
 *
 * Consumers: `module.ts` (the production instance) and `tests/refreshJob.test.ts`,
 * which injects its own spawn and points the settings reader at files it owns.
 */
export function createArchguardRefreshJob(options: {
  readonly resolveProjectPath: (projectId: string) => string | null;
  /** `undefined` = env-or-default resolution, `null` = no settings file at all. */
  readonly settingsPath?: string | null;
  readonly env?: Record<string, string | undefined>;
  readonly homeDir?: string;
  readonly spawnImpl?: RefreshSpawn;
  readonly hasSystemdRun?: () => boolean;
  readonly now?: () => number;
  readonly createJobId?: () => string;
  readonly nodePath?: string;
  /** The post-publish duplicate step; injectable so criteria can fake the MCP child. */
  readonly duplicatesRefresh?: RefreshDuplicates;
}): ArchguardRefreshJob {
  const now = options.now ?? Date.now;
  const homeDir = options.homeDir ?? os.homedir();
  const createJobId = options.createJobId ?? newJobId;
  const settings = createRefreshSettingsSource({
    ...(options.settingsPath === undefined ? {} : { settingsPath: options.settingsPath }),
    ...(options.env === undefined ? {} : { env: options.env }),
    homeDir,
  });
  const spawner = createRefreshSpawner({
    ...(options.spawnImpl === undefined ? {} : { spawnImpl: options.spawnImpl }),
    ...(options.hasSystemdRun === undefined ? {} : { hasSystemdRun: options.hasSystemdRun }),
    ...(options.nodePath === undefined ? {} : { nodePath: options.nodePath }),
    homeDir,
  });
  const publisher = createRefreshPublisher();
  const duplicatesRefresh = options.duplicatesRefresh ?? createRefreshDuplicates({
    ...(options.spawnImpl === undefined ? {} : { spawnImpl: options.spawnImpl }),
    ...(options.nodePath === undefined ? {} : { nodePath: options.nodePath }),
  });

  /** One record per resolved project root; terminal records stay readable. */
  const jobs = new Map<string, JobRecord>();

  function resolveProject(projectId: string): string {
    const projectPath = options.resolveProjectPath(projectId);
    if (projectPath === null) {
      throw new AppError(`Project "${projectId}" was not found.`, {
        code: 'PROJECT_NOT_FOUND',
        statusCode: 404,
      });
    }
    return realpathOrSelf(projectPath);
  }

  function statusOf(record: JobRecord): ArchitectureRefreshStatus {
    const finishedAt = record.finishedAt;
    const end = finishedAt ?? now();
    return {
      state: record.state,
      jobId: record.jobId,
      startedAt: new Date(record.startedAt).toISOString(),
      finishedAt: finishedAt === null ? null : new Date(finishedAt).toISOString(),
      stage: record.stage,
      elapsedMs: Math.max(0, end - record.startedAt),
      exitCode: record.exitCode,
      stderrTail: [...record.stderr],
      error: record.error,
    };
  }

  const IDLE_STATUS: ArchitectureRefreshStatus = {
    state: 'idle',
    jobId: null,
    startedAt: null,
    finishedAt: null,
    stage: 'idle',
    elapsedMs: 0,
    exitCode: null,
    stderrTail: [],
    error: null,
  };

  function makeRecord(projectPath: string, jobId: string, finished = false): JobRecord {
    let resolveFinished = (): void => {};
    const finishedPromise = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    let resolveClosed = (): void => {};
    const closedPromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const stamp = now();
    return {
      jobId,
      projectPath,
      state: finished ? 'failed' : 'running',
      stage: finished ? 'failed' : 'preparing',
      startedAt: stamp,
      finishedAt: finished ? stamp : null,
      exitCode: null,
      stderr: [],
      error: finished ? '' : null,
      child: null,
      killTimer: null,
      finished: finishedPromise,
      resolveFinished,
      closed: closedPromise,
      resolveClosed,
    };
  }

  function appendStderr(record: JobRecord, chunk: Buffer | string): void {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trimEnd();
      if (trimmed === '') continue;
      record.stderr.push(trimmed);
    }
    if (record.stderr.length > STDERR_TAIL_LINES) {
      record.stderr.splice(0, record.stderr.length - STDERR_TAIL_LINES);
    }
  }

  function finish(record: JobRecord, state: 'succeeded' | 'failed', error: string | null): void {
    if (record.state !== 'running') return;
    record.state = state;
    record.stage = state;
    record.error = error;
    record.finishedAt = now();
    record.child = null;
    if (record.killTimer !== null) {
      clearTimeout(record.killTimer);
      record.killTimer = null;
    }
    record.resolveFinished();
  }

  function killRunningChild(record: JobRecord, signal: NodeJS.Signals): void {
    const child = record.child;
    if (child === null) return;
    spawner.killGroup(child, signal);
  }

  async function runJob(
    record: JobRecord,
    cliPath: string,
    reading: RefreshSettings,
  ): Promise<void> {
    const projectPath = record.projectPath;
    const defect = reading.defect;
    const workDir = publisher.stagingDir(projectPath, record.jobId, defect);
    const discardStaging = (): Promise<void> => publisher.discardStaging(workDir, defect);

    try {
      const { sources, language } = await spawner.resolveSources(projectPath);
      await publisher.prepareStaging(workDir, defect);

      if (record.state !== 'running') {
        await discardStaging();
        return;
      }
      record.stage = 'analyzing';
      const child = spawner.spawnAnalysis({
        projectPath,
        cliPath,
        sources,
        language,
        workDir,
        memoryLimitMb: reading.memoryLimitMb,
      });
      record.child = child;
      child.stderr?.on('data', (chunk: Buffer) => appendStderr(record, chunk));
      child.on('error', (failure) => {
        void (async () => {
          finish(record, 'failed', `Could not start the ArchGuard CLI: ${errorMessage(failure)}`);
          record.resolveClosed();
          await discardStaging();
        })();
      });
      child.on('close', (code) => {
        void (async () => {
          record.exitCode = code;
          record.child = null;
          record.resolveClosed();
          if (record.state !== 'running') {
            // A timed-out or shut-down job: the record is already terminal.
            await discardStaging();
            return;
          }
          if (code !== 0) {
            const detail = record.stderr.at(-1);
            finish(
              record,
              'failed',
              `ArchGuard exited with code ${code ?? 'null'}${detail === undefined ? '' : `: ${detail}`}`,
            );
            await discardStaging();
            return;
          }
          record.stage = 'installing';
          try {
            if (defect !== 'no-preserve') {
              await publisher.installStagedQuery(projectPath, workDir, record.jobId);
            }
          } catch (failure) {
            finish(record, 'failed', errorMessage(failure));
            await discardStaging();
            return;
          }

          // The published analysis is now the live one; recompute the per-scope
          // duplicate report. A failure here is recorded, never promoted to a
          // failed refresh: the analysis itself succeeded.
          let duplicatesError: string | null = null;
          try {
            const duplicates = await duplicatesRefresh.refresh(projectPath, cliPath);
            if (!duplicates.ok) duplicatesError = duplicates.error;
          } catch (failure) {
            duplicatesError = errorMessage(failure);
          }
          if (duplicatesError !== null) {
            appendStderr(record, `duplicates refresh failed: ${duplicatesError}`);
            console.warn(`[architecture] duplicate detection failed for ${projectPath}: ${duplicatesError}`);
          }
          finish(record, 'succeeded', null);
          await discardStaging();
        })();
      });

      const timeout = setTimeout(() => {
        if (record.state !== 'running') return;
        record.error = `ArchGuard did not finish within ${reading.timeoutMs} ms`;
        record.state = 'failed';
        record.stage = 'failed';
        record.finishedAt = now();
        record.resolveFinished();
        killRunningChild(record, 'SIGTERM');
        record.killTimer = setTimeout(() => {
          killRunningChild(record, 'SIGKILL');
        }, KILL_GRACE_MS);
      }, reading.timeoutMs);
      timeout.unref();
      child.once('close', () => clearTimeout(timeout));
    } catch (failure) {
      finish(record, 'failed', errorMessage(failure));
      await discardStaging();
    }
  }

  return {
    start(projectId: string): ArchitectureRefreshStartResult {
      const projectPath = resolveProject(projectId);
      const reading = settings.read();
      const existing = jobs.get(projectPath);
      if (
        reading.defect !== 'no-coalesce'
        && existing !== undefined
        && existing.state === 'running'
      ) {
        return {
          jobId: existing.jobId,
          coalesced: true,
          status: statusOf(existing),
        };
      }

      const jobId = createJobId();
      const resolved = spawner.resolveCli(projectPath, reading.cliPath);
      if ('error' in resolved) {
        const record = makeRecord(projectPath, jobId, true);
        record.error = resolved.error;
        record.finishedAt = now();
        jobs.set(projectPath, record);
        return { jobId, coalesced: false, status: statusOf(record) };
      }

      const record = makeRecord(projectPath, jobId);
      jobs.set(projectPath, record);
      void runJob(record, resolved.cliPath, reading);
      return { jobId, coalesced: false, status: statusOf(record) };
    },

    status(projectId: string): ArchitectureRefreshStatus {
      const projectPath = resolveProject(projectId);
      const record = jobs.get(projectPath);
      return record === undefined ? IDLE_STATUS : statusOf(record);
    },

    async shutdown(): Promise<void> {
      const running = [...jobs.values()].filter((record) => record.state === 'running');
      for (const record of running) {
        record.error = 'the server shut down while the analysis was running';
        record.state = 'failed';
        record.stage = 'failed';
        record.finishedAt = now();
        record.resolveFinished();
        killRunningChild(record, 'SIGTERM');
      }
      await Promise.all(running.map(async (record) => {
        if (record.child === null) {
          // Still preparing (the spawn has not happened yet); the state guard in
          // `runJob` stops it from spawning.
          return;
        }
        await Promise.race([
          record.closed,
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, KILL_GRACE_MS);
            timer.unref();
          }),
        ]);
        if (record.child !== null) killRunningChild(record, 'SIGKILL');
      }));
    },

    shutdownSync(): void {
      for (const record of jobs.values()) {
        if (record.state === 'running') killRunningChild(record, 'SIGKILL');
      }
    },
  };
}
