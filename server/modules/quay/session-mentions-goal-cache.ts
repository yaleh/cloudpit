/**
 * The in-process `quay goal list --json` cache behind the session mention reading.
 *
 * Goal status and AC → goal ownership move slowly: a goal is written by hand, a criterion's
 * `goal` field changes only when somebody re-files it. Reading 1.28 MB through a CLI spawn on
 * every popover open bought freshness nobody needed, at about 790 ms per open. This cache holds
 * one project's successful reading for {@link SESSION_MENTIONS_GOAL_CACHE_TTL_MS} and shares a
 * single spawn between concurrent readers (single-flight), so a burst of opens costs one child.
 *
 * FAILED READS ARE NOT CACHED. `readGoalRows` answers `null` when the CLI failed or its output
 * was not a goal array; that answer is returned to the caller (which degrades exactly as it did
 * before this cache existed) and is NOT stored — otherwise a transient failure would be pinned
 * as "this project has no goals" for a whole TTL. The next request spawns again immediately.
 *
 * A successful EMPTY array is a reading and is cached like any other: it says the store really
 * holds no goals, which is different from "the read failed".
 *
 * Consumers: `session-mentions.service.ts` (its one verb) and
 * `server/modules/quay/tests/session-mentions.test.ts` (the TTL / single-flight / failure cases).
 */

/** How long one project's successful `goal list --json` reading stays fresh in-process. */
export const SESSION_MENTIONS_GOAL_CACHE_TTL_MS = 60_000;

/** Where one goal reading came from: the TTL cache, or a CLI spawn this request took part in. */
export type SessionMentionsGoalSource = 'cache' | 'cli';

/** One goal reading, with the provenance the session mention response reports. */
export type SessionMentionsGoalCacheReading<T> = {
  /** The rows, or `null` when this request's CLI read failed (never a cached failure). */
  rows: readonly T[] | null;
  source: SessionMentionsGoalSource;
};

/** The two boundaries the cache needs: the project's goal reader and the clock. */
export type SessionMentionsGoalCacheDependencies<T> = {
  /** Reads one project's goal rows; `null` means the read failed. */
  readGoalRows(projectPath: string): Promise<readonly T[] | null>;
  now(): number;
};

/** The cache's one verb: read a project's goal rows through the cache. */
export type SessionMentionsGoalCache<T> = {
  read(projectPath: string): Promise<SessionMentionsGoalCacheReading<T>>;
};

/** One cached successful reading. */
type CachedGoalRows<T> = {
  rows: readonly T[];
  observedAtMs: number;
};

/**
 * Creates the per-project goal cache. Keyed by project PATH (the value the underlying reader
 * takes), so two project ids resolving to the same root share one reading — and one spawn.
 */
export function createSessionMentionsGoalCache<T>(
  dependencies: SessionMentionsGoalCacheDependencies<T>,
): SessionMentionsGoalCache<T> {
  const cached = new Map<string, CachedGoalRows<T>>();
  /** The spawn a request is currently waiting on, so concurrent requests join it. */
  const inFlight = new Map<string, Promise<readonly T[] | null>>();

  const read = async (projectPath: string): Promise<SessionMentionsGoalCacheReading<T>> => {
    const entry = cached.get(projectPath);
    if (entry !== undefined && dependencies.now() - entry.observedAtMs < SESSION_MENTIONS_GOAL_CACHE_TTL_MS) {
      return { rows: entry.rows, source: 'cache' };
    }

    const pending = inFlight.get(projectPath);
    if (pending !== undefined) {
      // This request shared another request's spawn; the data is fresh from the CLI, not cache.
      return { rows: await pending, source: 'cli' };
    }

    const spawn = dependencies.readGoalRows(projectPath);
    inFlight.set(projectPath, spawn);
    try {
      const rows = await spawn;
      // Only a successful read is remembered; a `null` must be retried, never cached as empty.
      if (rows !== null) {
        cached.set(projectPath, { rows, observedAtMs: dependencies.now() });
      }
      return { rows, source: 'cli' };
    } finally {
      inFlight.delete(projectPath);
    }
  };

  return { read };
}
