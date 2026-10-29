/**
 * The client-owned background processes of one Codex resident driver (AC-439).
 *
 * `process/spawn` is the *client's* process API: the caller supplies
 * `processHandle`, the server reports the end as `process/exited`, and only that
 * notification releases the `background-task` hold. The bookkeeping itself lives
 * in `codex-background-lease-ledger.ts`; this module is the protocol face the
 * driver delegates to, so the driver keeps only its turn/queue state machine.
 */

import type { CodexAppServerConnection } from '@/modules/providers/list/codex/codex-app-server.connection.js';
import {
  createCodexBackgroundLeaseLedger,
  type CodexBackgroundLease,
  type CodexBackgroundLeaseLedger,
} from '@/modules/providers/list/codex/codex-background-lease-ledger.js';
import {
  backgroundSpawnParams,
  type CodexBackgroundProcessSpec,
} from '@/modules/providers/list/codex/codex-host-driver.contract.js';
import type { IProviderHostDriverSink } from '@/shared/interfaces.js';
import { isRecord } from '@/shared/utils.js';

/** What the background-process verbs need from the driver that owns them. */
export type CodexBackgroundProcessDeps = {
  /** The live connection; throws when the host was never started. */
  connection: () => CodexAppServerConnection;
  /** Throws when the session is not bound, as a turn would. */
  requireSession: (appSessionId: string) => void;
  /** Every bound app session, for mapping an exited handle back to its owner. */
  boundSessions: () => Iterable<string>;
  /** The manager's sink; null before `startHost`. */
  sink: () => IProviderHostDriverSink | null;
  /** Clock for a hold's `since`; the criterion injects a deterministic one. */
  now?: () => number;
};

/**
 * The `process/*` verbs and the lease reports they produce.
 *
 * One instance belongs to one driver: the ledger's maps live in its closure, so
 * two drivers cannot see each other's handles.
 */
export class CodexBackgroundProcesses {
  private readonly ledger: CodexBackgroundLeaseLedger;
  private handleSerial = 0;

  constructor(private readonly deps: CodexBackgroundProcessDeps) {
    this.ledger = createCodexBackgroundLeaseLedger({ now: deps.now });
  }

  /**
   * Spawns one process and reports the `background-task` hold it creates.
   *
   * The lease carries the handle the caller chose (or this driver's `bg-<n>`),
   * which is exactly what `process/exited` names when the process ends.
   */
  async spawn(appSessionId: string, spec: CodexBackgroundProcessSpec): Promise<CodexBackgroundLease> {
    this.deps.requireSession(appSessionId);
    const processHandle = spec.processHandle ?? `bg-${++this.handleSerial}`;
    await this.deps.connection().request('process/spawn', backgroundSpawnParams(processHandle, spec));
    const lease = this.ledger.add(appSessionId, processHandle);
    this.reportAdded(appSessionId, lease);
    return lease;
  }

  /**
   * Asks the server to kill one background process.
   *
   * The reply is not the end of the process: only `process/exited` releases the
   * hold, so dropping the lease here would read "kill sent" as "process gone".
   */
  async kill(appSessionId: string, processHandle: string): Promise<void> {
    this.deps.requireSession(appSessionId);
    await this.deps.connection().request('process/kill', { processHandle });
  }

  /** The session's `background-task` holds, ordered by handle. */
  list(appSessionId: string): CodexBackgroundLease[] {
    return this.ledger.list(appSessionId);
  }

  /**
   * One `process/exited`: drop exactly that handle, then re-report the survivors.
   *
   * The manager drops a lease *by kind*, so the only way to remove one handle
   * without losing its siblings is: remove the kind, then re-add every survivor
   * with its original `since`. Both steps run in this synchronous turn.
   */
  handleExited(params: unknown): void {
    if (!isRecord(params) || typeof params.processHandle !== 'string') {
      return;
    }
    const appSessionId = this.sessionForHandle(params.processHandle);
    if (!appSessionId) {
      return;
    }
    const { released, remaining } = this.ledger.release(appSessionId, params.processHandle);
    if (!released) {
      // An exit for a handle this session never held: say nothing, because
      // `leaseRemoved` would clear a sibling process's live lease.
      return;
    }
    this.deps.sink()?.leaseRemoved(appSessionId, 'background-task');
    for (const lease of remaining) {
      this.reportAdded(appSessionId, lease);
    }
  }

  /** Drops one session's holds, reporting the kind once when anything was held. */
  releaseSession(appSessionId: string): void {
    if (this.ledger.releaseAll(appSessionId).length > 0) {
      this.deps.sink()?.leaseRemoved(appSessionId, 'background-task');
    }
  }

  /** Reports one `background-task` hold, carrying the ledger's `since` verbatim. */
  private reportAdded(appSessionId: string, lease: CodexBackgroundLease): void {
    this.deps.sink()?.leaseAdded(appSessionId, {
      kind: 'background-task',
      id: lease.processHandle,
      since: lease.since,
    });
  }

  /** Which bound session holds this process handle, if any. */
  private sessionForHandle(processHandle: string): string | null {
    for (const appSessionId of this.deps.boundSessions()) {
      const held = this.ledger.list(appSessionId).some((lease) => lease.processHandle === processHandle);
      if (held) {
        return appSessionId;
      }
    }
    return null;
  }
}
