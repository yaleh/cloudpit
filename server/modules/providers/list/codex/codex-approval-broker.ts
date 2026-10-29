/**
 * The Codex app-server approval broker: the five server-request kinds the locked
 * 0.153.4 protocol asks a client to answer, mapped onto the same client protocol
 * Claude already speaks, plus the per-session state that makes the answer
 * deliverable.
 *
 * Two halves, both here because either alone is unreadable: the pure wire
 * mapping (method table and the exact JSON-RPC result each decision produces)
 * and the broker that owns every piece of per-session approval state — the run
 * writer the frames go to, the outstanding requests, the emitted notifications
 * and the last `thread/status/changed` reading.
 *
 * The client protocol itself is the shared `approval-requests.service.ts`; this
 * module supplies only Codex's method table, attention decision and response
 * shapes. A server request is never left unanswered: unattended requests and
 * auxiliary questions are answered synchronously.
 *
 * Consumed by `codex-host-driver.provider.ts`.
 */
import crypto from 'node:crypto';

import {
  approvalRequests as sharedApprovalRequests,
  TOOL_APPROVAL_TIMEOUT_MS,
  type ApprovalRequestsService,
} from '@/modules/providers/shared/base/approval-requests.service.js';
import { createNotificationEvent, notifyUserIfEnabled } from '@/modules/notifications/index.js';
import { isRecord } from '@/shared/utils.js';
import type { AnyRecord, ProviderRuntimeWriter } from '@/shared/types.js';
import type { CodexAppServerConnection } from '@/modules/providers/list/codex/codex-app-server.connection.js';
import type {
  CodexResidentSessionReading as BaseSessionReading,
  ResidentSession,
} from '@/modules/providers/list/codex/codex-host-driver.contract.js';

/* -------------------------------------------------------------------------- */
/* Wire mapping                                                               */
/* -------------------------------------------------------------------------- */

/** The five approval methods, named by the tool label the permission frame carries. */
export const CODEX_APPROVAL_METHODS = {
  commandExecution: 'item/commandExecution/requestApproval',
  fileChange: 'item/fileChange/requestApproval',
  permissions: 'item/permissions/requestApproval',
  mcpElicitation: 'mcpServer/elicitation/request',
  requestUserInput: 'item/tool/requestUserInput',
} as const;

export type CodexApprovalToolName = keyof typeof CODEX_APPROVAL_METHODS;

/** The `permission_request` frame's `toolName` for one server-request method. */
export function approvalToolForMethod(method: string): CodexApprovalToolName | null {
  for (const [toolName, candidate] of Object.entries(CODEX_APPROVAL_METHODS)) {
    if (candidate === method) {
      return toolName as CodexApprovalToolName;
    }
  }
  return null;
}

/**
 * The JSON-RPC result for one approval decision.
 *
 * `decision` is what `requestClientToolDecision` returns: `null` on timeout (a
 * refusal), `{ cancelled: true }` on an abort, or the client's own object
 * (`{ allow, updatedInput? }`). The protocol has no cancel word for permissions
 * or user input, so those two fall back to their refusal shape — the empty
 * grant / empty answer set — rather than inventing one.
 */
export function buildApprovalResponse(
  toolName: CodexApprovalToolName,
  decision: AnyRecord | null,
  params: unknown,
): AnyRecord {
  const allow = decision?.allow === true;
  const updatedInput = isRecord(decision?.updatedInput) ? decision.updatedInput : null;
  const cancelled = decision?.cancelled === true;

  switch (toolName) {
    case 'commandExecution':
    case 'fileChange':
      if (allow) {
        return { decision: 'accept' };
      }
      return { decision: cancelled ? 'cancel' : 'decline' };
    case 'mcpElicitation':
      if (allow) {
        return { action: 'accept', content: updatedInput?.content ?? null, _meta: null };
      }
      return cancelled
        ? { action: 'cancel', content: null, _meta: null }
        : { action: 'decline', content: null, _meta: null };
    case 'permissions': {
      if (!allow) {
        // No decline/cancel vocabulary: an empty grant is the only refusal shape.
        return { permissions: {}, scope: 'turn' };
      }
      const requested = isRecord(params) && isRecord(params.permissions) ? params.permissions : {};
      return {
        permissions: updatedInput?.permissions ?? requested,
        scope: updatedInput?.scope === 'session' ? 'session' : 'turn',
      };
    }
    case 'requestUserInput':
      return { answers: allow && isRecord(updatedInput?.answers) ? updatedInput.answers : {} };
    default:
      return {};
  }
}

/**
 * The answer for a server request that is not one of the five approvals.
 *
 * A real app-server also asks smaller questions while a turn runs —
 * `currentTime/read` and `attestation/generate` were the two E7 observed, plus
 * anything a newer build adds. Every one must be answered or the server parks,
 * so the unknown branch is `{}` rather than silence.
 */
export function buildServerRequestFallbackResult(method: string, now: number = Date.now()): AnyRecord {
  if (method === 'currentTime/read') {
    return { currentTimeAt: Math.floor(now / 1000) };
  }
  if (method === 'attestation/generate') {
    return { token: '' };
  }
  return {};
}

/* -------------------------------------------------------------------------- */
/* Broker                                                                     */
/* -------------------------------------------------------------------------- */

/** The resident reading AC-438 extends: the base four fields plus approval state. */
export type CodexResidentSessionReading = BaseSessionReading & {
  /** `thread/status/changed`'s status type, or null before the first report. */
  threadStatus: 'idle' | 'active' | null;
  /** The status frame's `activeFlags` verbatim (`['waitingOnApproval']` while parked). */
  activeFlags: string[];
  /** True while the server says the thread waits for approval or a request is pending. */
  waitingOnApproval: boolean;
  /** The session's outstanding requests, in arrival order. */
  pendingApprovals: Array<{ requestId: string; method: string; toolName: string }>;
};

/**
 * The approval-facing options the driver adds to its shared contract.
 *
 * Declared here rather than in `codex-host-driver.contract.ts` so AC-435's
 * published option set stays as it was; the driver's constructor takes the
 * intersection.
 */
export type CodexApprovalDriverOptions = {
  /** Connected clients right now; 0 (the default) means every request is unattended. */
  connectedClientCount?: () => number;
  /** Client wait ceiling; defaults to the shared `TOOL_APPROVAL_TIMEOUT_MS`. */
  approvalTimeoutMs?: number;
};

/** The driver-side facts the broker needs; everything else it owns itself. */
export type CodexApprovalBrokerDeps = {
  /** The app session a server request's `params.threadId` belongs to. */
  sessionForThread(threadId: string): string | null;
  /** How many clients are connected right now; 0 means unattended. */
  connectedClientCount(): number;
  /** Client wait ceiling when somebody is connected but does not answer. */
  approvalTimeoutMs?: number;
  /** The shared pending registry; injectable for an isolated test owner. */
  approvalRequests?: ApprovalRequestsService;
};

/** One outstanding approval request, as the cleanup paths see it. */
export type PendingCodexApproval = {
  requestId: string;
  method: string;
  toolName: string;
  /** Settles once the JSON-RPC answer has been written (or dropped). */
  done: Promise<void>;
};

export class CodexApprovalBroker {
  private readonly deps: CodexApprovalBrokerDeps;
  private readonly approvalRequests: ApprovalRequestsService;
  private readonly approvalTimeoutMs: number;
  private readonly pendingBySession = new Map<string, Map<string, PendingCodexApproval>>();
  /**
   * The writer each session's last run used. Retained after the run ends: an
   * approval request can land while a turn winds down, and answering on the
   * writer that turn used beats reading the client as gone and refusing a
   * person who is right there.
   */
  private readonly sessionWriters = new Map<string, ProviderRuntimeWriter>();
  /** `action_required` events emitted per session, in order. */
  private readonly notifications = new Map<string, AnyRecord[]>();
  /** `thread/status/changed`'s last report per session. */
  private readonly threadStatuses = new Map<
    string,
    { threadStatus: 'idle' | 'active' | null; activeFlags: string[] }
  >();

  constructor(deps: CodexApprovalBrokerDeps) {
    this.deps = deps;
    this.approvalRequests = deps.approvalRequests ?? sharedApprovalRequests;
    this.approvalTimeoutMs = deps.approvalTimeoutMs ?? TOOL_APPROVAL_TIMEOUT_MS;
  }

  /** Remembers the writer the session's current run sends frames on. */
  recordWriter(appSessionId: string, writer: ProviderRuntimeWriter): void {
    this.sessionWriters.set(appSessionId, writer);
  }

  /** The session's outstanding requests, in arrival order. */
  pendingFor(appSessionId: string): PendingCodexApproval[] {
    return [...(this.pendingBySession.get(appSessionId)?.values() ?? [])];
  }

  /** The `action_required` events emitted for the session, in order. */
  notificationsFor(appSessionId: string): AnyRecord[] {
    return [...(this.notifications.get(appSessionId) ?? [])];
  }

  /** Stores one `thread/status/changed` frame's status and flags. */
  observeThreadStatus(appSessionId: string, params: Record<string, unknown>): void {
    const status = isRecord(params.status) ? params.status : {};
    this.threadStatuses.set(appSessionId, {
      threadStatus: status.type === 'idle' || status.type === 'active' ? status.type : null,
      activeFlags: Array.isArray(status.activeFlags)
        ? status.activeFlags.filter((flag): flag is string => typeof flag === 'string')
        : [],
    });
  }

  /** Routes one thread notification the broker owns; false leaves it to the driver. */
  observeNotification(appSessionId: string, method: string, params: Record<string, unknown>): boolean {
    if (method !== 'thread/status/changed') {
      return false;
    }
    this.observeThreadStatus(appSessionId, params);
    return true;
  }

  /** The base reading widened with this session's approval state. */
  readingFor(session: ResidentSession, appSessionId: string): CodexResidentSessionReading {
    const threadStatus = this.threadStatuses.get(appSessionId);
    const activeFlags = threadStatus?.activeFlags ?? [];
    const pendingApprovals = this.pendingFor(appSessionId).map((record) => ({
      requestId: record.requestId,
      method: record.method,
      toolName: record.toolName,
    }));
    return {
      threadId: session.threadId,
      activeTurnId: session.activeTurnId,
      turnStatus: session.turnStatus,
      lastResumeError: session.lastResumeError,
      threadStatus: threadStatus?.threadStatus ?? null,
      activeFlags,
      // The server's own flag OR a request this driver still holds: a request
      // parked between the frame and the status notification must already read
      // as waiting.
      waitingOnApproval: activeFlags.includes('waitingOnApproval') || pendingApprovals.length > 0,
      pendingApprovals,
    };
  }

  /** Registers this broker on a freshly created connection. */
  attach(connection: CodexAppServerConnection): void {
    connection.onServerRequest((id, method, params) => {
      this.handleServerRequest(connection, id, method, params);
    });
  }

  /**
   * Dispatches one server-initiated request.
   *
   * Synchronous from the connection's point of view: the answer is either
   * written here (unattended, non-approval) or scheduled after the client
   * answers. A subscriber throw must not stop the read loop, so the async half
   * catches and answers with the refusal shape instead.
   */
  handleServerRequest(
    connection: CodexAppServerConnection,
    id: number | string,
    method: string,
    params: unknown,
  ): void {
    const toolName = approvalToolForMethod(method);
    if (!toolName || !isRecord(params) || typeof params.threadId !== 'string') {
      connection.respond(id, buildServerRequestFallbackResult(method));
      return;
    }
    const appSessionId = this.deps.sessionForThread(params.threadId);
    if (!appSessionId) {
      // Nobody owns this thread any more; the request must still be answered.
      connection.respond(id, buildApprovalResponse(toolName, null, params));
      return;
    }

    const requestId = crypto.randomUUID();
    const writer = this.sessionWriters.get(appSessionId);
    if (!writer || this.deps.connectedClientCount() <= 0) {
      this.recordUnattended(appSessionId, requestId, method);
      connection.respond(id, buildApprovalResponse(toolName, null, params));
      return;
    }

    const record: PendingCodexApproval = {
      requestId,
      method,
      toolName,
      done: Promise.resolve(),
    };
    const sessionPending = this.pendingBySession.get(appSessionId) ?? new Map<string, PendingCodexApproval>();
    this.pendingBySession.set(appSessionId, sessionPending);
    sessionPending.set(requestId, record);

    record.done = this.awaitDecision(connection, id, method, toolName, params, appSessionId, requestId, writer)
      .finally(() => {
        sessionPending.delete(requestId);
        if (sessionPending.size === 0) {
          this.pendingBySession.delete(appSessionId);
        }
      });
  }

  /**
   * Answers every request the session still has with the abort/refusal shape and
   * waits for the frames to be written.
   *
   * `requestClientToolDecision` resolves on this settle, and the frame is
   * written in its continuation, so the returned promise is what makes
   * "drained" observable to the caller instead of a race with a microtask.
   */
  async settleSession(appSessionId: string): Promise<void> {
    const pending = this.pendingBySession.get(appSessionId);
    if (!pending || pending.size === 0) {
      return;
    }
    const records = [...pending.values()];
    for (const record of records) {
      this.approvalRequests.resolveToolApproval(record.requestId, { cancelled: true });
    }
    await Promise.allSettled(records.map((record) => record.done));
    this.pendingBySession.delete(appSessionId);
  }

  /** Settles every session's requests; the connection is going away. */
  async settleAll(): Promise<void> {
    await Promise.allSettled([...this.pendingBySession.keys()].map((sessionId) => this.settleSession(sessionId)));
  }

  /** Settles and forgets one session; its binding is going away. */
  async detachSession(appSessionId: string): Promise<void> {
    await this.settleSession(appSessionId);
    this.forgetSession(appSessionId);
  }

  /** Settles the listed sessions while the socket is open, then forgets all state. */
  async drainAndForget(appSessionIds: Iterable<string>): Promise<void> {
    for (const appSessionId of appSessionIds) {
      await this.settleSession(appSessionId);
    }
    this.forgetAll();
  }

  /** Settles every wait with no socket left to answer on, then forgets all state. */
  discardAll(): void {
    void this.settleAll();
    this.forgetAll();
  }

  /** Drops a detached session's writer and status; notifications stay readable. */
  forgetSession(appSessionId: string): void {
    this.sessionWriters.delete(appSessionId);
    this.threadStatuses.delete(appSessionId);
  }

  /** Drops every session's writer and status (the process is gone). */
  forgetAll(): void {
    this.sessionWriters.clear();
    this.threadStatuses.clear();
  }

  /** Asks the client and maps its answer back onto the protocol. */
  private async awaitDecision(
    connection: CodexAppServerConnection,
    id: number | string,
    method: string,
    toolName: CodexApprovalToolName,
    params: unknown,
    appSessionId: string,
    requestId: string,
    writer: ProviderRuntimeWriter,
  ): Promise<void> {
    let decision: AnyRecord | null = null;
    try {
      decision = await this.approvalRequests.requestClientToolDecision({
        provider: 'codex',
        toolName,
        input: { method, params },
        // Every one of the five is a human decision; the explicit deadline below
        // is what keeps "connected but silent" bounded rather than unbounded.
        requiresInteraction: true,
        requestId,
        ws: writer,
        emitNotification: (event) => this.recordNotification(appSessionId, event),
        sessionId: appSessionId,
        sessionSummary: null,
        timeoutMs: this.approvalTimeoutMs,
      });
    } catch {
      // A write that failed (the client went away) is a refusal, not a hang.
      decision = null;
    }
    connection.respond(id, buildApprovalResponse(toolName, decision, params));
  }

  /** Records the refusal a request gets when nobody is connected to answer it. */
  private recordUnattended(appSessionId: string, requestId: string, method: string): void {
    this.recordNotification(appSessionId, createNotificationEvent({
      provider: 'codex',
      sessionId: appSessionId,
      kind: 'action_required',
      code: 'permission.unattended_refused',
      meta: { method, reason: 'unattended' },
      severity: 'warning',
      requiresUserAction: true,
      dedupeKey: `codex:permission:unattended:${appSessionId}:${requestId}`,
    } as unknown as Parameters<typeof createNotificationEvent>[0]));
  }

  /**
   * Records one notification and hands it to the user-notification channels.
   *
   * `notifyUserIfEnabled` no-ops without a userId (the criterion's writer has
   * none), so the recorded list is what makes the event observable in a
   * hermetic test while production still delivers it.
   */
  private recordNotification(appSessionId: string, event: AnyRecord): void {
    const recorded = this.notifications.get(appSessionId) ?? [];
    recorded.push(event);
    this.notifications.set(appSessionId, recorded);
    notifyUserIfEnabled({ userId: this.sessionWriters.get(appSessionId)?.userId ?? null, event });
  }
}

/** Builds one broker; the driver owns it for the life of the instance. */
export function createCodexApprovalBroker(deps: CodexApprovalBrokerDeps): CodexApprovalBroker {
  return new CodexApprovalBroker(deps);
}
