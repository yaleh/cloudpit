import { randomUUID } from 'node:crypto';

import type { CodexAppServerConnection } from '@/modules/providers/list/codex/codex-app-server.connection.js';
import type { HostPendingQueuedInputs, HostQueuedInputCancelResult, ProviderRuntimeWriter } from '@/shared/types.js';
import { AppError, isRecord } from '@/shared/utils.js';

/**
 * The busy-input queue of one Codex resident session (AC-436).
 *
 * The queue belongs to the app-server process, not to this driver: `thread/queue/add`
 * writes a submission into the process's own FIFO, `thread/queue/list` is the depth
 * truth, and `thread/queue/delete`/`thread/queue/start` name a submission by the id the
 * process assigned it. `CodexHostDriver` owns one instance per bound session and routes
 * the protocol frames to it; the turn state machine itself stays in the driver.
 *
 * The mirror is refreshed on every `thread/queue/changed` and after every add, so a
 * submission deleted by someone else is reflected even though this driver sent no delete.
 */

/** One submission accepted by `thread/queue/add` while a turn was in flight. */
export type QueuedEntry = {
  clientUserMessageId: string;
  queuedSubmissionId: string;
  text: string;
  /** Set when a `turn/started` bound this submission to the turn in flight. */
  started: boolean;
  /**
   * The run writer of the send that queued this submission, when it had one.
   *
   * It is where this submission's `command_lifecycle` frames go: the client's
   * pending row is drawn from them (uuid, then `cancelled`/`completed`), and the
   * queue is the only place that knows when the process moved the submission.
   * Null for a submission this queue only mirrors, such as one another instance
   * wrote.
   */
  writer: ProviderRuntimeWriter | null;
  promise: Promise<void>;
  resolve: () => void;
};

/**
 * One row of the `thread/queue/list` mirror — the depth truth this driver reads
 * instead of counting its own deliveries.
 */
type QueuedMirrorEntry = {
  queuedSubmissionId: string;
  clientUserMessageId: string | null;
  text: string;
};

/** What the queue needs from its owning session; closures keep it off the session type. */
export type CodexResidentQueueDeps = {
  connection: () => CodexAppServerConnection | null;
  threadId: () => string | null;
  closed: () => boolean;
  /** Reports traffic to the host manager's activity stamp. */
  activity: () => void;
};

/** Reads the text of one `thread/queue/list` input array (the first text element). */
function readQueuedText(input: unknown): string {
  if (!Array.isArray(input)) {
    return '';
  }
  for (const part of input) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      return part.text;
    }
  }
  return '';
}

/** Reads `{ queuedSubmission: { id, clientUserMessageId } }` from a queue/add result. */
function readQueuedSubmission(result: unknown): { id: string; clientUserMessageId: string | null } | null {
  if (!isRecord(result) || !isRecord(result.queuedSubmission)) {
    return null;
  }
  const submission = result.queuedSubmission;
  if (typeof submission.id !== 'string' || !submission.id) {
    return null;
  }
  return {
    id: submission.id,
    clientUserMessageId: typeof submission.clientUserMessageId === 'string'
      ? submission.clientUserMessageId
      : null,
  };
}

/**
 * Reads `{ data: [...] }` from a `thread/queue/list` result.
 *
 * `null` means "the reply did not carry a list": the caller keeps its previous
 * reading rather than replacing a known depth with zero, because a malformed
 * reply is not an empty queue.
 */
function readQueueList(result: unknown): QueuedMirrorEntry[] | null {
  if (!isRecord(result) || !Array.isArray(result.data)) {
    return null;
  }
  const entries: QueuedMirrorEntry[] = [];
  for (const row of result.data) {
    if (!isRecord(row) || typeof row.id !== 'string' || !row.id) {
      continue;
    }
    entries.push({
      queuedSubmissionId: row.id,
      clientUserMessageId: typeof row.clientUserMessageId === 'string' ? row.clientUserMessageId : null,
      text: readQueuedText(row.input),
    });
  }
  return entries;
}

export class CodexResidentQueue {
  /** Submissions accepted by `thread/queue/add` and not yet terminal, in queue order. */
  private entries: QueuedEntry[] = [];
  /** The last `thread/queue/list` reading. This is the depth truth, never a counter. */
  private mirror: QueuedMirrorEntry[] = [];
  /** Every app uuid this driver queued, so "already started" is distinguishable from "never existed". */
  private readonly known = new Set<string>();
  /** App uuids a turn has picked up off the queue. */
  private readonly started = new Set<string>();
  /** App uuids withdrawn through this driver; a second withdrawal is `unknown`. */
  private readonly withdrawn = new Set<string>();
  /** Set by a `thread/queue/changed` (or an explicit caller) and cleared by the refresh loop. */
  private refreshRequested = false;
  /** The serialized refresh loop; concurrent requests coalesce into it. */
  private refreshLoop: Promise<void> | null = null;
  /** The entry a `turn/started` bound to the in-flight turn, until that turn settles. */
  private bound: QueuedEntry | null = null;

  constructor(private readonly deps: CodexResidentQueueDeps) {}

  /**
   * Writes one submission into the app-server's own queue.
   *
   * `thread/queue/add` returns the server's handle; the entry joins the FIFO that
   * `turn/started` binds, and the returned entry's promise settles when that turn
   * settles (or when the submission is withdrawn).
   */
  async add(
    connection: CodexAppServerConnection,
    text: string,
    writer: ProviderRuntimeWriter | null = null,
  ): Promise<QueuedEntry> {
    const threadId = this.deps.threadId();
    if (!threadId) {
      throw new AppError('Codex app-server has no thread to queue a turn on.', {
        code: 'CODEX_APP_SERVER_PROTOCOL',
        statusCode: 502,
      });
    }
    const clientUserMessageId = randomUUID();
    const added = await connection.request('thread/queue/add', {
      threadId,
      input: [{ type: 'text', text, text_elements: [] }],
      clientUserMessageId,
    });
    const submission = readQueuedSubmission(added);
    if (!submission) {
      throw new AppError('Codex app-server accepted a queued turn without a submission id.', {
        code: 'CODEX_APP_SERVER_PROTOCOL',
        statusCode: 502,
      });
    }
    let resolve!: () => void;
    const promise = new Promise<void>((settle) => {
      resolve = settle;
    });
    // The server echoes the uuid it stored (E2), and that echo is what
    // `thread/queue/list` reports. Prefer it so the reading this driver hands
    // back names exactly the row the queue truth names.
    const appUuid = submission.clientUserMessageId ?? clientUserMessageId;
    const entry: QueuedEntry = {
      clientUserMessageId: appUuid,
      queuedSubmissionId: submission.id,
      text,
      started: false,
      writer,
      promise,
      resolve,
    };
    this.entries.push(entry);
    this.known.add(appUuid);
    this.deps.activity();
    // Take the depth reading from the process's own list, not from the adds
    // this driver just made: the two only agree while nothing else churns.
    await this.requestRefresh();
    // The client's own pending row picks up its uuid here — the frame's
    // `commandUuid` is the id the queue answers to, which is the id a
    // withdrawal names. Emitted after the refresh so the state is the queue's
    // truth rather than this call's optimism.
    this.emitLifecycle(entry, 'queued');
    return entry;
  }

  /**
   * The app uuid of the most recent submission still in the server's queue.
   *
   * Read off the `thread/queue/list` mirror, so a submission a turn has already
   * picked up is never named. `null` when the queue is empty.
   */
  latestInputUuid(): string | null {
    for (let index = this.mirror.length - 1; index >= 0; index -= 1) {
      const entry = this.mirror[index];
      if (entry.clientUserMessageId) {
        return entry.clientUserMessageId;
      }
    }
    return null;
  }

  /**
   * How much the app-server's own queue is still holding, from the mirror.
   *
   * Never a counter this driver keeps: the queue belongs to the process, and the
   * only entity that knows when a turn boundary drains it is that process.
   */
  pending(): HostPendingQueuedInputs {
    const items = this.mirror.length;
    const bytes = this.mirror.reduce((sum, entry) => sum + Buffer.byteLength(entry.text, 'utf8'), 0);
    return { items, bytes };
  }

  /**
   * Withdraws one queued submission by the app uuid it was queued with.
   *
   * The verdict is the protocol's, not a local guess: the submission id is looked
   * up in the `thread/queue/list` truth, `thread/queue/delete` is called for it, and
   * only `{deleted:true}` is `withdrawn`. A uuid this driver queued that is no longer
   * in the queue has been picked up by a turn (`already-started`); one it never saw
   * is `unknown` — the two are kept apart because "we know it is too late" and "we
   * cannot say" are different facts.
   */
  async cancel(messageUuid: string): Promise<HostQueuedInputCancelResult> {
    if (this.deps.closed()) {
      return 'unknown';
    }
    const connection = this.deps.connection();
    const threadId = this.deps.threadId();
    if (!connection || !threadId) {
      return 'unknown';
    }
    // Read the queue's current truth before deciding: an entry that left the
    // queue a moment ago must not be reported as withdrawn.
    await this.requestRefresh();
    const truth = this.mirror.find((entry) => entry.clientUserMessageId === messageUuid);
    if (truth) {
      let reply: unknown;
      try {
        reply = await connection.request('thread/queue/delete', {
          threadId,
          queuedSubmissionId: truth.queuedSubmissionId,
        });
      } catch {
        return 'unknown';
      }
      if (!isRecord(reply) || reply.deleted !== true) {
        return 'unknown';
      }
      this.dropMirror(truth.queuedSubmissionId);
      this.withdrawn.add(messageUuid);
      const queued = this.entries.find((entry) => entry.clientUserMessageId === messageUuid);
      if (queued) {
        this.remove(queued);
        // The message will never run, so its run must not stay pending: settle
        // it as finished rather than leaving a promise that can only leak.
        queued.resolve();
        // The process's answer is the withdrawal's evidence, so the row is told
        // AFTER the delete was accepted — never from the request's own timing.
        this.emitLifecycle(queued, 'cancelled');
      }
      return 'withdrawn';
    }
    if (this.withdrawn.has(messageUuid)) {
      return 'unknown';
    }
    if (this.started.has(messageUuid) || this.known.has(messageUuid)) {
      return 'already-started';
    }
    return 'unknown';
  }

  /**
   * The queue's next submission, in the order the app-server will start it.
   *
   * Membership is read from the mirror, so a submission that left the queue without
   * this driver sending a delete (an external `thread/queue/delete`, or the process's
   * own drain) is never bound to a turn it is not running. The FIFO fallback applies
   * only when there is no mirror at all — a connection whose `thread/queue/list` never
   * answered still has to be able to bind the turn the protocol started, or every
   * queued run would hang.
   */
  next(): QueuedEntry | null {
    const waiting = this.entries.filter((entry) => !entry.started);
    if (waiting.length === 0) {
      return null;
    }
    const inMirror = waiting.find((entry) => this.mirror.some(
      (row) => row.queuedSubmissionId === entry.queuedSubmissionId
        || (row.clientUserMessageId !== null && row.clientUserMessageId === entry.clientUserMessageId),
    ));
    if (inMirror) {
      return inMirror;
    }
    return this.mirror.length === 0 ? waiting[0] : null;
  }

  /** Binds one entry to the `turn/started` that is now running it. */
  bind(entry: QueuedEntry): void {
    entry.started = true;
    this.bound = entry;
    this.started.add(entry.clientUserMessageId);
    this.dropMirror(entry.queuedSubmissionId);
    // The process drained this submission into its turn. The transcript keeps the
    // row (and its text) until the turn's own rows arrive, which is why this is
    // `started` and not a retirement.
    this.emitLifecycle(entry, 'started');
  }

  /**
   * Writes a turn into the app-server's queue and waits for its turn.
   *
   * The caller's run stays pending exactly as long as the submission has no
   * terminal turn: the entry joins the FIFO that `turn/started` binds, and the
   * run settles when that turn settles (or when the submission is withdrawn).
   */
  async enqueueAndWait(
    connection: CodexAppServerConnection,
    text: string,
    writer: ProviderRuntimeWriter | null = null,
  ): Promise<void> {
    const entry = await this.add(connection, text, writer);
    await entry.promise;
  }

  /** Takes and binds the submission a `turn/started` nobody dispatched is running. */
  takeForTurnStarted(): QueuedEntry | null {
    const entry = this.next();
    if (entry) {
      this.bind(entry);
    }
    return entry;
  }

  /** Drops the entry the in-flight turn came from once that turn is terminal. */
  settleBoundTurn(): void {
    const entry = this.bound;
    if (!entry) {
      return;
    }
    this.bound = null;
    this.remove(entry);
    // The turn that ran this submission is over; its row retires. `completed`
    // is what removes the client's pending row (a `started` row stays until the
    // turn's own transcript replaces it).
    this.emitLifecycle(entry, 'completed');
  }

  /**
   * Pushes the queue's head after an interrupt.
   *
   * `thread/queue/start` is the ONLY thing that moves an interrupted thread's
   * queue: the app-server's automatic drain is a normal-completion behaviour and
   * E3 measured it absent for 15s after an interrupt. A refusal is deliberately
   * not retried here; the entry stays queued and the mirror keeps saying so.
   */
  startNextAfterInterrupt(): void {
    if (this.deps.closed()) {
      return;
    }
    const connection = this.deps.connection();
    const threadId = this.deps.threadId();
    if (!connection || !threadId) {
      return;
    }
    const next = this.next();
    if (!next) {
      return;
    }
    void connection.request('thread/queue/start', {
      threadId,
      queuedSubmissionId: next.queuedSubmissionId,
    }).catch(() => {
      // Keep the queue as it is: the reading must not claim a turn that never started.
    });
  }

  /** Drops one settled entry from the queue and the mirror. */
  remove(entry: QueuedEntry): void {
    this.entries = this.entries.filter((candidate) => candidate !== entry);
    this.dropMirror(entry.queuedSubmissionId);
  }

  /**
   * Requests one `thread/queue/list` read, serialized with every other request.
   *
   * Concurrent notifications coalesce: the flag is set first, and the running loop
   * picks it up before it exits, so a burst of `thread/queue/changed` costs at most
   * one extra read rather than one per notification. The returned promise is the
   * loop's, so a caller that needs the fresh reading can await it.
   */
  requestRefresh(): Promise<void> {
    this.refreshRequested = true;
    if (!this.refreshLoop) {
      this.refreshLoop = (async () => {
        try {
          while (this.refreshRequested) {
            this.refreshRequested = false;
            await this.refreshOnce();
          }
        } finally {
          this.refreshLoop = null;
        }
      })();
    }
    return this.refreshLoop;
  }

  /**
   * Settles every still-queued run without touching the process (unbind/exit/close).
   *
   * A queued run has no turn to observe and the process is going away (or this
   * session is leaving the driver), so the run has to end here: leaving its promise
   * pending would leak every caller waiting on it.
   */
  settleAll(): void {
    for (const entry of this.entries.splice(0)) {
      entry.resolve();
      // The host is going away, so the row must not outlive it as a pending
      // command nobody is holding any more.
      this.emitLifecycle(entry, 'completed');
    }
    this.bound = null;
    this.mirror = [];
    this.refreshRequested = false;
  }

  /**
   * Publishes one state of a submission to the run that queued it.
   *
   * A frame is an observation, never a precondition: a writer whose socket has
   * gone away must not turn the queue operation itself into a failure, so any
   * throw from `send` is swallowed here.
   */
  private emitLifecycle(entry: QueuedEntry, state: 'queued' | 'started' | 'cancelled' | 'completed'): void {
    if (!entry.writer) {
      return;
    }
    try {
      entry.writer.send({
        kind: 'command_lifecycle',
        commandUuid: entry.clientUserMessageId,
        commandState: state,
      });
    } catch {
      // The queue did what it was asked; the client simply did not hear about it.
    }
  }

  private dropMirror(queuedSubmissionId: string): void {
    this.mirror = this.mirror.filter((row) => row.queuedSubmissionId !== queuedSubmissionId);
  }

  /** One `thread/queue/list` round trip; a failure keeps the previous reading. */
  private async refreshOnce(): Promise<void> {
    const connection = this.deps.connection();
    const threadId = this.deps.threadId();
    if (!connection || !threadId) {
      return;
    }
    try {
      const reply = await connection.request('thread/queue/list', { threadId });
      const entries = readQueueList(reply);
      if (entries) {
        this.mirror = entries;
      }
    } catch {
      // A failed read is not an empty queue: keep the last truthful sample.
    }
  }
}
