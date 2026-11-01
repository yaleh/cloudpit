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
 *  - `effective_config` keeps the layers apart and verifies FIELD BY FIELD
 *    against the operation's actual request. The stored row is what the app
 *    recorded; the live host is evidence that a process is running; the
 *    in-flight run (created under this boot, started before the observed
 *    response) is the only thing that names THIS operation; and the provider's
 *    own transcript is the only read-back of what the request asked for and
 *    what answered it. The reading is `verified` only when every one of those
 *    is evidence and every expected field matched — "the DB says so", "a
 *    process is alive" and "the next turn will use it" are deliberately not
 *    proof. A field the provider's transcript cannot carry (Claude's
 *    permission mode) is declared unavailable, never echoed from the row.
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
import { readFile } from 'node:fs/promises';

import {
  KNOWLEDGE_CONFIG_FIELDS,
  KNOWLEDGE_FACT_CONTRACT,
  KNOWLEDGE_FACT_CONTRACT_VERSION,
  KNOWLEDGE_FACT_PROJECT,
  actualCapabilitiesFor,
  actualCapabilityReason,
  buildConfigFieldVerdicts,
  hasActualRequestSource,
  knowledgeEvidence,
  knowledgeUnknown,
  readClaudeTranscriptTurns,
  selectClaudeTranscriptTurn,
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
  type KnowledgeUnknownField,
} from '@/shared/knowledge-facts.js';
import {
  KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON,
  readKnowledgeActivities,
  readKnowledgeActivityReply,
  deriveKnowledgeOperationId,
  type KnowledgeActivity,
  type KnowledgeActivityRead,
} from '@/modules/context-events/index.js';
import type { ISessionControlPeerDelivery } from '@/modules/session-control/index.js';

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
  /** The session's provider transcript, the read-back source for the actual request/response. */
  jsonl_path?: string | null;
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
  /** The process boot that created the run; a run from another boot is an old process. */
  bootId?: string | null;
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
  /** The cross-session delivery arm; absent means `capabilities` says unavailable. */
  sessionControl?: ISessionControlPeerDelivery;
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
    delivery: { deliveryId?: string; correlationId?: string } | undefined,
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
          deliveryId: string | null;
          correlationId: string | null;
        }>('there is no activity to correlate')
      : knowledgeEvidence(
          {
            askId: activity.askId,
            operationId: activity.operationId,
            sourceSessionId: activity.sessionId,
            targetSessionId,
            askingMessageId: activity.askingMessageId === '' ? null : activity.askingMessageId,
            answeredMessageId: activity.answeredMessageId,
            deliveryId: null,
            correlationId: null,
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

    const reading: KnowledgePeerResultReading = {
      kind: 'peer_result',
      operationId: resolvedOperationId,
      activity: activityEvidence,
      correlation,
      waiting,
      authorization,
      reply,
      deliveryCorrelation: null,
      capabilities: { deliveryCorrelation: deps.sessionControl?.capability ?? 'unavailable' },
      unknown,
      readErrors,
    };
    if (deps.sessionControl === undefined || delivery === undefined) return reading;
    return deps.sessionControl.augmentPeerResult(reading, {
      sourceSessionId: sessionId,
      ...(peerSession === undefined ? {} : { peerSession }),
      ...delivery,
    });
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

    // The in-flight operation this reading is about. A stored row, a next-turn
    // plan and a run created by an older boot are each explicitly NOT this
    // operation, and none of them is allowed to stand in for it.
    const sessionOperationId = deriveKnowledgeOperationId(`config:${sessionId}`);
    let operation: KnowledgeEffectiveConfigReading['operation'];
    if (run === null || runId === null) {
      operation = knowledgeUnknown('no run with an id is in flight for this session');
    } else if (operationId !== undefined && operationId !== runId && operationId !== sessionOperationId) {
      operation = knowledgeUnknown(
        `the caller named operation "${operationId}", but the session's in-flight run is "${runId}"`,
      );
    } else if (typeof run.bootId === 'string' && run.bootId !== '' && run.bootId !== deps.bootId) {
      operation = knowledgeUnknown(
        'the in-flight run was created under a different process boot, so it belongs to an old process',
      );
    } else {
      const at = toIso(run.startedAt);
      operation = at === null
        ? knowledgeUnknown('the in-flight run exposes no readable start instant')
        : knowledgeEvidence(
            { id: runId, at, bootId: typeof run.bootId === 'string' && run.bootId !== '' ? run.bootId : deps.bootId },
            'chat-runs',
            runId,
            at,
          );
    }

    const capabilities = actualCapabilitiesFor(row.provider);
    const hasSource = hasActualRequestSource(row.provider);
    const reasonFor = (half: 'request' | 'response', field: string): string =>
      actualCapabilityReason(capabilities, half, field);

    // The actual request and response of THIS operation, read from the
    // provider's own transcript. Every branch below that fails says which
    // attribution broke rather than falling back to the stored row.
    let actualRequest: KnowledgeEffectiveConfigReading['actualRequest'];
    let actualResponse: KnowledgeEffectiveConfigReading['actualResponse'];
    let responseAtMs: number | null = null;
    /** Sub-fields the chosen transcript turn leaves empty; surfaced in `unknown` below. */
    let transcriptGaps: KnowledgeUnknownField[] = [];

    if (!hasSource) {
      actualRequest = knowledgeUnknown(reasonFor('request', 'model'));
      actualResponse = knowledgeUnknown(reasonFor('response', 'model'));
    } else if (operation.state === 'unknown') {
      const reason = `no request or response can be attributed: ${operation.reason}`;
      actualRequest = knowledgeUnknown(reason);
      actualResponse = knowledgeUnknown(reason);
    } else if (row.jsonl_path === undefined || row.jsonl_path === null || row.jsonl_path === '') {
      const reason = 'the session row carries no transcript path, so the request and response cannot be read';
      actualRequest = knowledgeUnknown(reason);
      actualResponse = knowledgeUnknown(reason);
    } else {
      const transcriptPath = row.jsonl_path;
      let raw: string | null = null;
      try {
        raw = await readFile(transcriptPath, 'utf8');
      } catch (error) {
        readErrors.push({
          source: 'sessions.transcript',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      if (raw === null) {
        const reason = 'the transcript could not be read; see readErrors';
        actualRequest = knowledgeUnknown(reason);
        actualResponse = knowledgeUnknown(reason);
      } else {
        const { turn: chosen, sawOlder } = selectClaudeTranscriptTurn(readClaudeTranscriptTurns(raw), {
          startMs: Date.parse(operation.value.at),
          nowMs: now(),
          sessionIds: [row.session_id, row.provider_session_id],
        });
        if (chosen === null) {
          const reason = sawOlder
            ? 'the newest assistant turn predates this operation, so it belongs to an old one'
            : 'the transcript records no assistant turn for this operation';
          actualRequest = knowledgeUnknown(reason);
          actualResponse = knowledgeUnknown(reason);
        } else {
          responseAtMs = Date.parse(chosen.timestamp);
          const sourceRef = `${transcriptPath}#${chosen.uuid ?? chosen.requestRef ?? chosen.timestamp}`;
          actualResponse = knowledgeEvidence(
            { model: chosen.responseModel, responseId: chosen.responseId, at: chosen.timestamp },
            'sessions.transcript',
            sourceRef,
            chosen.timestamp,
          );
          actualRequest = knowledgeEvidence(
            {
              model: chosen.requestedModel,
              effort: chosen.effort,
              permissionMode: null,
              requestRef: chosen.requestRef,
            },
            'sessions.transcript',
            sourceRef,
            chosen.timestamp,
          );
          // A field this turn does not carry is a gap in the reading, not a
          // silent null: name it so a consumer need not infer it.
          transcriptGaps = [
            ...(chosen.requestedModel === null ? ['actualRequest.model'] : []),
            ...(chosen.effort === null ? ['actualRequest.effort'] : []),
            ...(chosen.requestRef === null ? ['actualRequest.requestRef'] : []),
            ...(chosen.responseModel === null ? ['actualResponse.model'] : []),
            ...(chosen.responseId === null ? ['actualResponse.responseId'] : []),
          ];
        }
      }
    }

    let actual: KnowledgeEffectiveConfigReading['actual'];
    let process: KnowledgeEffectiveConfigReading['layers']['process'];
    let liveStartedMs: number | null = null;
    if (deps.hosts === undefined) {
      unknown.push('actual', 'process');
      actual = knowledgeUnknown('no live-host source is wired into this fact reader');
      process = knowledgeUnknown('no live-host source is wired into this fact reader');
    } else {
      const host = deps.hosts.liveHostForSession(sessionId);
      const startedAt = toIso(host?.startedAt ?? null);
      liveStartedMs = startedAt === null ? null : Date.parse(startedAt);
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

    // A response the provider recorded before the live process (or the running
    // build) existed was produced by an older operation even if it sits in this
    // session's transcript file. The finding is about the RESPONSE, so only the
    // request/response layers are downgraded; the live process is still live.
    if (responseAtMs !== null && liveStartedMs !== null && responseAtMs < liveStartedMs) {
      const reason = 'the readable response predates the live process, so an older process produced it';
      actualRequest = knowledgeUnknown(reason);
      actualResponse = knowledgeUnknown(reason);
    }
    const builtAtMs = deps.builtAt === undefined || deps.builtAt === null ? null : Date.parse(deps.builtAt);
    if (responseAtMs !== null && builtAtMs !== null && Number.isFinite(builtAtMs) && responseAtMs < builtAtMs) {
      const reason = 'the readable response predates the running build, so an older operation produced it';
      actualRequest = knowledgeUnknown(reason);
      actualResponse = knowledgeUnknown(reason);
    }
    if (actualRequest.state === 'evidence' && actualResponse.state === 'evidence') {
      for (const gap of transcriptGaps) {
        if (unknown.includes(gap) === false) unknown.push(gap);
      }
    }

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

    // Field-by-field verification, against THIS operation's readable request.
    // An unstated expectation is not a gap in the reading, so it stays out of
    // `unknown`; a stated expectation that could not be verified is a gap and
    // does enter it.
    const fields = buildConfigFieldVerdicts({ expected: expectedLayer, actualRequest, capabilities });

    const statedFields = KNOWLEDGE_CONFIG_FIELDS.filter((field) => (expectedLayer?.[field] ?? null) !== null);
    if (statedFields.length === 0 && unknown.includes('expected') === false) unknown.push('expected');
    if (operation.state === 'unknown') unknown.push('operation');
    if (request.state === 'unknown') unknown.push('request');
    if (actualRequest.state === 'unknown') unknown.push('actualRequest');
    if (actualResponse.state === 'unknown') unknown.push('actualResponse');
    for (const field of statedFields) {
      if (fields[field].state !== 'verified') unknown.push(`fields.${field}`);
    }

    const verified =
      expected.state === 'evidence' &&
      statedFields.length > 0 &&
      stored.state === 'evidence' &&
      actual.state === 'evidence' &&
      process.state === 'evidence' &&
      build.state === 'evidence' &&
      request.state === 'evidence' &&
      operation.state === 'evidence' &&
      actualRequest.state === 'evidence' &&
      actualResponse.state === 'evidence' &&
      statedFields.every((field) => fields[field].state === 'verified');

    return {
      kind: 'effective_config',
      operationId: operationId ?? sessionOperationId,
      expected,
      stored,
      actual,
      layers: { process, build, request },
      operation,
      actualRequest,
      actualResponse,
      fields,
      capabilities,
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
      case 'peer_result': {
        const locator =
          query.deliveryId === undefined && query.correlationId === undefined
            ? undefined
            : { deliveryId: query.deliveryId, correlationId: query.correlationId };
        return readPeerResult(query.session, query.peerSession, query.operationId, locator);
      }
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
