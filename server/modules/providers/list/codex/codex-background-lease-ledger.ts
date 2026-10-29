/**
 * The ledger of client-owned background processes for Codex resident mode.
 *
 * `process/spawn` is the *client's* process API: the caller supplies
 * `processHandle` in the request, and the server reports the end as
 * `process/exited {processHandle, exitCode}`. The agent-owned terminal listing
 * is different bookkeeping, and the locked 0.153.4 reading (REPORT E5) shows it
 * stays `{data:[]}` while a client-spawned process is running. A
 * `background-task` hold therefore has to be maintained here, keyed by the
 * handle the caller chose, not read off that listing.
 *
 * One ledger belongs to one host driver instance and keeps one map per app
 * session. The state lives in this factory's closure rather than at module
 * scope, so two drivers (two hosts, two criteria) cannot see each other's
 * handles, and there is no process-wide cache to reset between tests.
 *
 * Consumed by `codex-host-driver.provider.ts` (`spawnBackgroundProcess`,
 * `readBackgroundLeases`, the `process/exited` dispatch, `handleExit`,
 * `unbind` and `closeHost`) and by
 * `tests/codex-resident-background-leases.test.ts`.
 */

/** One client-owned background process the driver is holding a lease for. */
export type CodexBackgroundLease = {
  /** The handle the client passed to `process/spawn`; the server echoes it on exit. */
  processHandle: string;
  /** When this hold began, from the injected clock; preserved across re-reports. */
  since: number;
};

/** The outcome of releasing one handle from one session's ledger. */
export type CodexBackgroundLeaseRelease = {
  /** The lease that was dropped, or null when that session never held the handle. */
  released: CodexBackgroundLease | null;
  /** What the session still holds, ordered by handle so two readings are comparable. */
  remaining: CodexBackgroundLease[];
};

export type CodexBackgroundLeaseLedgerOptions = {
  /** Millisecond clock used to stamp a new hold; defaults to `Date.now`. */
  now?: () => number;
};

/**
 * The per-session handle ledger.
 *
 * `release` deletes exactly one handle: the server's `process/exited` names one
 * process, and clearing a sibling's hold would drop a lease the process still
 * needs. `releaseAll` is the process-death / host-close path and returns what
 * it removed so the caller can report it.
 */
export type CodexBackgroundLeaseLedger = {
  /**
   * Records one hold. The same handle is idempotent and keeps the first `since`,
   * so re-spawning or re-reporting a handle never restarts the manager's clock.
   */
  add(appSessionId: string, processHandle: string): CodexBackgroundLease;
  /** Drops exactly one handle and reports the survivors. */
  release(appSessionId: string, processHandle: string): CodexBackgroundLeaseRelease;
  /** Drops every handle of one session and returns them; used on exit/close. */
  releaseAll(appSessionId: string): CodexBackgroundLease[];
  /** The session's holds, ordered by handle. */
  list(appSessionId: string): CodexBackgroundLease[];
};

/** Orders leases by handle so every reading of the same set is identical. */
function byHandle(left: CodexBackgroundLease, right: CodexBackgroundLease): number {
  if (left.processHandle < right.processHandle) {
    return -1;
  }
  return left.processHandle > right.processHandle ? 1 : 0;
}

/**
 * Builds one host driver's background lease ledger over its own closed-over maps.
 *
 * `now` is injectable so a criterion can read a deterministic `since` without
 * touching the wall clock.
 */
export function createCodexBackgroundLeaseLedger(
  options: CodexBackgroundLeaseLedgerOptions = {},
): CodexBackgroundLeaseLedger {
  const now = options.now ?? Date.now;
  const bySession = new Map<string, Map<string, CodexBackgroundLease>>();

  /** The session's map, created on first use. */
  function leasesFor(appSessionId: string): Map<string, CodexBackgroundLease> {
    let leases = bySession.get(appSessionId);
    if (!leases) {
      leases = new Map<string, CodexBackgroundLease>();
      bySession.set(appSessionId, leases);
    }
    return leases;
  }

  function ordered(leases: Map<string, CodexBackgroundLease>): CodexBackgroundLease[] {
    return [...leases.values()].sort(byHandle);
  }

  return {
    add(appSessionId, processHandle) {
      const leases = leasesFor(appSessionId);
      const existing = leases.get(processHandle);
      if (existing) {
        return existing;
      }
      const lease: CodexBackgroundLease = { processHandle, since: now() };
      leases.set(processHandle, lease);
      return lease;
    },

    release(appSessionId, processHandle) {
      const leases = bySession.get(appSessionId);
      const released = leases?.get(processHandle) ?? null;
      if (leases && released) {
        leases.delete(processHandle);
      }
      return { released, remaining: leases ? ordered(leases) : [] };
    },

    releaseAll(appSessionId) {
      const leases = bySession.get(appSessionId);
      if (!leases) {
        return [];
      }
      const released = ordered(leases);
      bySession.delete(appSessionId);
      return released;
    },

    list(appSessionId) {
      const leases = bySession.get(appSessionId);
      return leases ? ordered(leases) : [];
    },
  };
}
