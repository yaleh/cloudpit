

//----------------- ARCHITECTURE REFRESH JOB TYPES ------------
/**
 * The lifecycle state of one project's manual ArchGuard re-analysis.
 *
 * `idle` means no refresh has been started in this server process (or the
 * project has none recorded); `running` is the single in-flight job; `succeeded`
 * and `failed` are the two terminal readings of the most recent job and stay
 * readable until the next `start`. A fresh server process always begins at
 * `idle` — the state is in memory, not persisted, because the artifacts on disk
 * are the durable reading.
 */
export type ArchitectureRefreshState = 'idle' | 'running' | 'succeeded' | 'failed';

/**
 * Where a running refresh is: preparing means the CLI is resolved and the
 * scopes are being read; analyzing is the child's lifetime; installing is the
 * short atomic swap of the staged `query` directory into `.archguard`. The two
 * terminal stages mirror {@link ArchitectureRefreshState}.
 */
export type ArchitectureRefreshStage =
  | 'idle'
  | 'preparing'
  | 'analyzing'
  | 'installing'
  | 'succeeded'
  | 'failed';

/**
 * The full status document `GET /api/architecture/refresh/status` answers and
 * `POST /api/architecture/refresh` carries inside its 202 body.
 *
 * `jobId` is null only in the `idle` reading. `startedAt`/`finishedAt` are ISO
 * instants so the tab can render them with the same formatters the provenance
 * footer already uses; `elapsedMs` is the server's own reading of the same
 * interval, so a client with a skewed clock still shows the honest duration.
 * `stderrTail` is the last few lines of the child's stderr (bounded server-side)
 * and is empty on success and on an idle reading. `error` is a readable reason
 * and is non-null exactly for `failed`.
 */
export type ArchitectureRefreshStatus = {
  state: ArchitectureRefreshState;
  jobId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  stage: ArchitectureRefreshStage;
  elapsedMs: number;
  exitCode: number | null;
  stderrTail: readonly string[];
  error: string | null;
};

/**
 * The `POST /api/architecture/refresh` answer: the job the caller now owns or
 * joined.
 *
 * `coalesced` is true when the request found a running job for the same
 * project root and returned it instead of spawning a second analysis — the
 * multi-session / multi-tab merge the criterion measures. A first start answers
 * false. `status` is the job's current status snapshot.
 */
export type ArchitectureRefreshStartResult = {
  jobId: string;
  coalesced: boolean;
  status: ArchitectureRefreshStatus;
};

