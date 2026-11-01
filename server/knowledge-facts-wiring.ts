/**
 * The composition-root adapter that makes the knowledge-application fact
 * contract real for THIS process.
 *
 * The gateway's `knowledge_facts` tool and the contract leaves know only the
 * port in `@/shared/knowledge-facts.js` ({@link IKnowledgeFactSource}); this file
 * is where the port is bound to the process's own services. It is a composition
 * helper, not a module: it lives at `server/` beside `index.ts` because it reads
 * across the database, session-hosts, chat-run and context-event modules and
 * none of them may depend on the others' internals. Every source is INJECTED, so
 * a criterion drives the same logic over a temp database and a temp event
 * directory.
 *
 * WHAT EACH KIND PROMISES, AND WHAT IT REFUSES TO PRETEND:
 *
 *  - `peer_result` reports the ask the stream stated and the reply the
 *    TRANSCRIPT confirms. The stream does not record a peer session or an
 *    authorization scope, so both are `unknown` unless the caller names a peer
 *    that the store can confirm. An answer row that names no message stays an
 *    unverified reply.
 *  - `effective_config` keeps the three layers apart. The stored row is what the
 *    app recorded; the live host is the only evidence of what is actually
 *    running; a run in flight is the only evidence of the request identity. The
 *    reading is `verified` only when the caller's expected layer, the stored
 *    layer, the live layer and all three identity layers are evidence. "The DB
 *    says so" and "the next turn will use it" are deliberately not proof.
 *  - `inventory` is a bounded query over stored session rows. `total` and
 *    `truncated` are computed from the whole filtered set, so an empty page is
 *    never reported as an empty host. Both optional filters are applied in this
 *    process, and `filtersApplied` states which ones ran.
 *
 * Failures are contained per source and reported in `readErrors`; nothing here
 * throws for a source that is merely unavailable, and nothing turns a failed
 * read into an empty evidence value.
 */
import path from 'node:path';
import os from 'node:os';

import {
  KNOWLEDGE_FACT_CONTRACT,
  KNOWLEDGE_FACT_CONTRACT_VERSION,
  KNOWLEDGE_FACT_PROJECT,
  knowledgeEvidence,
  knowledgeUnknown,
  type IKnowledgeFactSource,
  type KnowledgeConfigLayer,
  type KnowledgeEffectiveConfigReading,
  type KnowledgeFactIdentity,
  type KnowledgeFactQuery,
  type KnowledgeFactReading,
  type KnowledgeInventoryItem,
  type KnowledgeInventoryReading,
  type KnowledgePeerResultReading,
  type KnowledgeReadError,
} from '@/shared/knowledge-facts.js';
import {
  KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON,
  readKnowledgeActivities,
  readKnowledgeActivityReply,
  deriveKnowledgeOperationId,
  type KnowledgeActivity,
  type KnowledgeActivityRead,
} from '@/modules/context-events/index.js';

/** The default page size for `inventory`. */
export const KNOWLEDGE_INVENTORY_DEFAULT_LIMIT = 20;

/** The largest page `inventory` will answer; a caller asking for more is clamped, not refused. */
export const KNOWLEDGE_INVENTORY_MAX_LIMIT = 200;

/** Why the authorization layer is unknown: this stream does not state one. */
export const KNOWLEDGE_AUTHORIZATION_UNKNOWN_REASON =
  'the session.asking row carries no authorization scope, and the fact reader does not infer one from an answer';

/**
 * The slice of one stored session row the fact source reads.
 *
 * Structurally satisfied by the session repository's `SessionRow`; declared here
 * so the adapter does not import a repository type into the composition root's
 * port.
 */
export type KnowledgeSessionRow = {
  session_id: string;
  provider: string;
  provider_session_id: string | null;
  project_path: string | null;
  model: string | null;
  effort: string | null;
  permission_mode: string | null;
  lifecycle_mode?: string;
  created_at: string | null;
  updated_at: string | null;
  isArchived: number;
};

/** One live run as the fact source reads it (structurally satisfied by `chatRunRegistry`). */
export type KnowledgeRunningRun = {
  /** Absent on a row returned by `getRun`, which is already addressed by session. */
  sessionId?: string;
  startedAt: number;
  runId?: string | null;
  id?: string | null;
  providerSessionId?: string | null;
  /** `running` / `completed` / `aborted`; absent is read as running for a by-session lookup. */
  status?: string;
};

/** Every service the fact source answers from; production supplies all of them. */
export type KnowledgeFactSourceDeps = {
  sessions: {
    getSessionById(sessionId: string): KnowledgeSessionRow | null;
    /** Visible rows only; the inventory filter re-checks `isArchived`. */
    getAllSessions(): KnowledgeSessionRow[];
    fetchHistory(
      sessionId: string,
      options?: { limit?: number | null },
    ): Promise<{ messages: ReadonlyArray<{ id: string; role?: string; timestamp?: string | null }> }>;
  };
  /** The process host manager; absent means "live state is unknown", never "not live". */
  hosts?: {
    liveHostForSession(sessionId: string): { pid: number | null; startedAt: number | string | null } | null;
  };
  /** The run registry; absent means the request-identity layer is unknown. */
  runs?: {
    listRunningRuns(): ReadonlyArray<KnowledgeRunningRun>;
    /**
     * The session's current run, when the registry exposes a by-session
     * lookup. This is the only source of a RUN ID: `listRunningRuns` projects a
     * row without one, so a reader that needs the run identity must take it from
     * here rather than inventing an id from the start instant.
     */
    getRun?(sessionId: string): KnowledgeRunningRun | null | undefined;
  };
  /** The project lookup; absent means a `projectId` filter cannot be applied. */
  projects?: { getProjectIdByPath(projectPath: string): string | null };
  /** The context-event projection; defaults to the real reader over the default fleet directory. */
  events?: {
    readActivities(options?: { eventsDir?: string; lookbackDays?: number; nowMs?: number }): Promise<KnowledgeActivityRead>;
  };
  /** The build/commit the running code came from. */
  buildId: string;
  gitSha?: string | null;
  builtAt?: string | null;
  serverVersion?: string | null;
  /** The running process identity. */
  bootId: string;
  now?: () => number;
  eventsDir?: string;
  lookbackDays?: number;
};

/** The reason text an announced-but-missing peer session carries. */
function missingPeerReason(peerSession: string): string {
  return `the caller named peer session "${peerSession}", but the session store holds no such session`;
}

/** Milliseconds/ISO input to an ISO instant, or null when it does not parse. */
function toIso(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const millis = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

/** The run id a registry row exposes, under either name it has used. */
function runIdOf(run: KnowledgeRunningRun): string | null {
  if (typeof run.runId === 'string' && run.runId !== '') return run.runId;
  if (typeof run.id === 'string' && run.id !== '') return run.id;
  return null;
}

/** Clamp an inventory page size into the contract's range. */
function clampLimit(limit: number | undefined): number {
  const requested = limit ?? KNOWLEDGE_INVENTORY_DEFAULT_LIMIT;
  return Math.min(KNOWLEDGE_INVENTORY_MAX_LIMIT, Math.max(1, Math.floor(requested)));
}

/**
 * Builds the fact source over injected services.
 *
 * The returned object holds no mutable state of its own: every reading is
 * assembled from the sources at call time, so a re-read sees the same world the
 * caller would have seen had it called the services directly.
 */
export function createKnowledgeFactSource(deps: KnowledgeFactSourceDeps): IKnowledgeFactSource {
  const now = deps.now ?? Date.now;
  const nowIso = (): string => new Date(now()).toISOString();

  const eventOptions = (): { eventsDir?: string; lookbackDays?: number; nowMs: number } => ({
    ...(deps.eventsDir === undefined ? {} : { eventsDir: deps.eventsDir }),
    ...(deps.lookbackDays === undefined ? {} : { lookbackDays: deps.lookbackDays }),
    nowMs: now(),
  });

  const readActivities = deps.events?.readActivities ?? readKnowledgeActivities;

  const identify = (): KnowledgeFactIdentity => ({
    contract: KNOWLEDGE_FACT_CONTRACT,
    version: KNOWLEDGE_FACT_CONTRACT_VERSION,
    project: KNOWLEDGE_FACT_PROJECT,
    buildId: deps.buildId,
    bootId: deps.bootId,
    serverVersion: deps.serverVersion ?? null,
    gitSha: deps.gitSha ?? null,
    builtAt: deps.builtAt ?? null,
    observedAt: nowIso(),
  });

  /** The activity for one ask, found by its operation id or as the newest ask of a session. */
  const locateActivity = (
    activities: ReadonlyArray<KnowledgeActivity>,
    sessionId: string,
    operationId: string | undefined,
  ): KnowledgeActivity | null => {
    const candidates = activities.filter((activity) => activity.sessionId === sessionId);
    if (operationId !== undefined) {
      return candidates.find((activity) => activity.operationId === operationId) ?? null;
    }
    return candidates.length === 0 ? null : candidates[candidates.length - 1];
  };

  const readPeerResult = async (
    sessionId: string,
    peerSession: string | undefined,
    operationId: string | undefined,
  ): Promise<KnowledgePeerResultReading | null> => {
    const row = deps.sessions.getSessionById(sessionId);
    if (row === null) return null;

    const unknown: string[] = [];
    const readErrors: KnowledgeReadError[] = [];

    let stream: KnowledgeActivityRead;
    try {
      stream = await readActivities(eventOptions());
    } catch (error) {
      stream = {
        activities: [],
        readErrors: [
          {
            source: 'context-events',
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        scannedRows: 0,
      };
    }
    readErrors.push(...stream.readErrors);

    const activity = locateActivity(stream.activities, sessionId, operationId);
    if (activity === null) unknown.push('activity');

    let targetSessionId: string | null = null;
    if (peerSession !== undefined) {
      const peer = deps.sessions.getSessionById(peerSession);
      if (peer === null) {
        const reason = missingPeerReason(peerSession);
        unknown.push('targetSessionId');
        readErrors.push({ source: 'sessions.db', message: reason });
      } else {
        targetSessionId = peer.session_id;
      }
    } else {
      unknown.push('targetSessionId');
    }
    unknown.push('authorization');

    const resolvedOperationId = activity?.operationId ?? operationId ?? null;
    const observedAt = nowIso();

    const activityEvidence = activity === null
      ? knowledgeUnknown<{
          askId: string;
          state: KnowledgeActivity['state'];
          at: string;
          lastAt: string;
          sourceRef: string;
        }>('no session.asking activity for this session is inside the stream window')
      : knowledgeEvidence(
          {
            askId: activity.askId,
            state: activity.state,
            at: activity.at,
            lastAt: activity.lastAt,
            sourceRef: activity.sourceRef,
          },
          'context-events',
          activity.sourceRef,
          activity.lastAt,
        );

    const correlation = activity === null
      ? knowledgeUnknown<{
          askId: string;
          operationId: string;
          sourceSessionId: string;
          targetSessionId: string | null;
          askingMessageId: string | null;
          answeredMessageId: string | null;
        }>('there is no activity to correlate')
      : knowledgeEvidence(
          {
            askId: activity.askId,
            operationId: activity.operationId,
            sourceSessionId: activity.sessionId,
            targetSessionId,
            askingMessageId: activity.askingMessageId === '' ? null : activity.askingMessageId,
            answeredMessageId: activity.answeredMessageId,
          },
          'context-events',
          activity.sourceRef,
          activity.lastAt,
        );

    const waiting = activity === null
      ? knowledgeUnknown<{ state: KnowledgeActivity['state']; since: string }>(
          'there is no activity, so the wait cannot be read',
        )
      : knowledgeEvidence(
          { state: activity.state, since: activity.at },
          'context-events',
          activity.sourceRef,
          activity.lastAt,
        );

    const authorization = knowledgeUnknown<{ scope: string }>(KNOWLEDGE_AUTHORIZATION_UNKNOWN_REASON);

    let reply: KnowledgePeerResultReading['reply'];
    if (activity === null) {
      unknown.push('reply');
      reply = knowledgeUnknown('there is no activity, so there is no settled message to verify');
    } else if (activity.answeredMessageId === null) {
      unknown.push('reply');
      reply = knowledgeUnknown(KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON);
    } else {
      const reRead = await readKnowledgeActivityReply({
        activity,
        readHistory: (readSessionId, limit) => deps.sessions.fetchHistory(readSessionId, { limit }),
      });
      reply = reRead.reply;
      readErrors.push(...reRead.readErrors);
      for (const field of reRead.unknown) if (unknown.includes(field) === false) unknown.push(field);
    }

    // The activity's own unknowns (a missing asking message, a settlement whose
    // asking row aged out) are real gaps in this reading, so carry them up — with
    // ONE exception: the projection says "the stream does not name the target
    // session", but when the caller named a peer and the store confirmed it this
    // reading DID establish that field. `unknown` describes what THIS reading
    // could not answer, not what the raw source omitted.
    if (activity !== null) {
      for (const field of activity.unknown) {
        if (field === 'targetSessionId' && targetSessionId !== null) continue;
        if (unknown.includes(field) === false) unknown.push(field);
      }
    }

    return {
      kind: 'peer_result',
      operationId: resolvedOperationId,
      activity: activityEvidence,
      correlation,
      waiting,
      authorization,
      reply,
      unknown,
      readErrors,
    };
  };

  const readEffectiveConfig = async (
    sessionId: string,
    operationId: string | undefined,
    expectedLayer: Partial<KnowledgeConfigLayer> | undefined,
  ): Promise<KnowledgeEffectiveConfigReading | null> => {
    const row = deps.sessions.getSessionById(sessionId);
    if (row === null) return null;

    const unknown: string[] = [];
    const readErrors: KnowledgeReadError[] = [];
    const observedAt = nowIso();

    const expected = expectedLayer === undefined
      ? knowledgeUnknown<KnowledgeConfigLayer>('the caller supplied no expected configuration layer')
      : knowledgeEvidence<KnowledgeConfigLayer>(
          {
            model: expectedLayer.model ?? null,
            effort: expectedLayer.effort ?? null,
            permissionMode: expectedLayer.permissionMode ?? null,
          },
          'caller',
          `expectation:${sessionId}`,
          observedAt,
        );
    if (expectedLayer === undefined) unknown.push('expected');

    const storedLayer: KnowledgeConfigLayer = {
      model: row.model,
      effort: row.effort,
      permissionMode: row.permission_mode,
    };
    const stored = knowledgeEvidence(
      storedLayer,
      'sessions.db',
      row.session_id,
      row.updated_at ?? row.created_at ?? observedAt,
    );
    for (const field of ['model', 'effort', 'permissionMode'] as const) {
      if (storedLayer[field] === null) unknown.push(`stored.${field}`);
    }

    const runningRuns = deps.runs?.listRunningRuns() ?? [];
    const bySession = deps.runs?.getRun?.(sessionId) ?? null;
    const current =
      bySession !== null && bySession !== undefined && (bySession.status === undefined || bySession.status === 'running')
        ? bySession
        : null;
    const run =
      current ??
      runningRuns.find((candidate) => candidate.sessionId === sessionId) ??
      null;
    const runId = run === null ? null : runIdOf(run);

    let actual: KnowledgeEffectiveConfigReading['actual'];
    let process: KnowledgeEffectiveConfigReading['layers']['process'];
    if (deps.hosts === undefined) {
      unknown.push('actual', 'process');
      actual = knowledgeUnknown('no live-host source is wired into this fact reader');
      process = knowledgeUnknown('no live-host source is wired into this fact reader');
    } else {
      const host = deps.hosts.liveHostForSession(sessionId);
      const startedAt = toIso(host?.startedAt ?? null);
      actual = knowledgeEvidence(
        {
          live: host !== null,
          pid: host?.pid ?? null,
          startedAt,
          runId,
        },
        'session-hosts',
        sessionId,
        observedAt,
      );
      process = host === null
        ? knowledgeUnknown('no process is alive for this session')
        : knowledgeEvidence(
            { pid: host.pid ?? null, startedAt, bootId: deps.bootId },
            'session-hosts',
            sessionId,
            observedAt,
          );
      if (host === null) unknown.push('process');
    }

    const build = knowledgeEvidence({ buildId: deps.buildId }, 'build-info', deps.buildId, observedAt);

    const request = run === null || runId === null
      ? knowledgeUnknown<{ sessionId: string; runId: string; providerSessionId: string | null }>(
          'no run with an id is in flight for this session',
        )
      : knowledgeEvidence(
          { sessionId, runId, providerSessionId: row.provider_session_id },
          'chat-runs',
          runId,
          observedAt,
        );
    if (request.state === 'unknown') unknown.push('request');

    const verified =
      expected.state === 'evidence' &&
      stored.state === 'evidence' &&
      actual.state === 'evidence' &&
      process.state === 'evidence' &&
      build.state === 'evidence' &&
      request.state === 'evidence';

    return {
      kind: 'effective_config',
      operationId: operationId ?? deriveKnowledgeOperationId(`config:${sessionId}`),
      expected,
      stored,
      actual,
      layers: { process, build, request },
      verified,
      unknown,
      readErrors,
    };
  };

  const readInventory = (
    projectId: string | undefined,
    provider: string | undefined,
    requestedLimit: number | undefined,
    requestedOffset: number | undefined,
  ): KnowledgeInventoryReading => {
    const limit = clampLimit(requestedLimit);
    const offset = Math.max(0, Math.floor(requestedOffset ?? 0));
    const unknown: string[] = [];
    const readErrors: KnowledgeReadError[] = [];
    const filtersApplied: string[] = [];

    let rows: KnowledgeSessionRow[];
    try {
      rows = deps.sessions.getAllSessions().filter((row) => row.isArchived === 0);
    } catch (error) {
      readErrors.push({
        source: 'sessions.db',
        message: error instanceof Error ? error.message : String(error),
      });
      rows = [];
      unknown.push('items', 'total');
    }

    if (provider !== undefined) {
      rows = rows.filter((row) => row.provider === provider);
      filtersApplied.push('provider');
    }
    if (projectId !== undefined) {
      if (deps.projects === undefined) {
        unknown.push('scope.projectId');
        readErrors.push({
          source: 'projects.db',
          message: 'a projectId filter was requested, but no project lookup is wired into this fact reader',
        });
      } else {
        const lookup = deps.projects;
        rows = rows.filter(
          (row) => row.project_path !== null && lookup.getProjectIdByPath(row.project_path) === projectId,
        );
        filtersApplied.push('projectId');
      }
    }

    rows.sort((left, right) => {
      const leftAt = left.updated_at ?? left.created_at ?? '';
      const rightAt = right.updated_at ?? right.created_at ?? '';
      if (leftAt !== rightAt) return rightAt.localeCompare(leftAt);
      return right.session_id.localeCompare(left.session_id);
    });

    const total = rows.length;
    const page = rows.slice(offset, offset + limit);
    if (deps.hosts === undefined && page.length > 0) unknown.push('lifecycle.live');

    const items: KnowledgeInventoryItem[] = page.map((row) => ({
      sessionId: row.session_id,
      provider: row.provider,
      providerSessionId: row.provider_session_id,
      projectId:
        row.project_path === null ? null : deps.projects?.getProjectIdByPath(row.project_path) ?? null,
      lifecycle: {
        stored: row.lifecycle_mode ?? null,
        live: deps.hosts === undefined ? null : deps.hosts.liveHostForSession(row.session_id) !== null,
      },
      lastActivity: row.updated_at ?? row.created_at ?? null,
    }));

    return {
      kind: 'inventory',
      operationId: deriveKnowledgeOperationId(
        `inventory:${projectId ?? '*'}:${provider ?? '*'}:${limit}:${offset}`,
      ),
      scope: {
        projectId: projectId ?? null,
        provider: provider ?? null,
        limit,
        offset,
        filtersApplied,
      },
      items,
      total,
      truncated: offset + items.length < total,
      providers: [...new Set(rows.map((row) => row.provider))].sort(),
      unknown,
      readErrors,
    };
  };

  const read = async (query: KnowledgeFactQuery): Promise<KnowledgeFactReading | null> => {
    switch (query.kind) {
      case 'peer_result':
        return readPeerResult(query.session, query.peerSession, query.operationId);
      case 'effective_config':
        return readEffectiveConfig(query.session, query.operationId, query.expected);
      case 'inventory':
        return readInventory(query.projectId, query.provider, query.limit, query.offset);
    }
  };

  return { identify, read };
}

/**
 * The default fleet event directory, resolved exactly as the writer resolves it.
 * Exported so `server/index.ts` and a criterion name the same path instead of
 * each spelling `~/.quay-fleet/context/events`.
 */
export function defaultKnowledgeEventsDir(): string {
  return path.join(os.homedir(), '.quay-fleet', 'context', 'events');
}
