/**
 * The `cloudcli.knowledge-application.fact` contract, version 1.
 *
 * Three kinds of fact a fleet agent must be able to read back from THIS host
 * without guessing — each one a question the host can answer from its own
 * stored state plus its own event stream, and each one required to say which
 * fields it could NOT answer instead of filling them with a plausible value:
 *
 *  - `peer_result`      — the ask this session stated and the reply that
 *                         settled it, correlated by one operation id and
 *                         re-read from the transcript before it is reported;
 *  - `effective_config` — the expected / stored / actual model, effort and
 *                         permission mode, with the process, build and request
 *                         identity that makes the "actual" layer meaningful;
 *  - `inventory`        — a bounded session listing that keeps its scope,
 *                         pagination and truncation, and never turns "this
 *                         page was empty" into "the host has none".
 *
 * THE CONTRACT IS THE SHAPE OF AN ANSWER, NOT A PROMISE THAT EVERY FIELD IS
 * KNOWN. {@link KnowledgeEvidence} is a discriminated union: a field is either
 * an `evidence` reading (value + which source produced it + when that source
 * observed it) or an `unknown` reading carrying a reason. There is no third
 * "probably" state and no nullable value standing in for "I did not look": a
 * reader that could not establish a layer must say so, because the consumer
 * (quay-fleet's knowledge-application run) has to be able to distinguish
 * "verified" from "not verified" without inferring it from an absent field.
 *
 * WHY THIS FILE IS ITS OWN LEAF. `server/shared/interfaces.ts` is already past
 * the repository's 800-line ceiling and this vocabulary is consumed from two
 * directions (the MCP gateway's tool module and the composition-root wiring).
 * It imports nothing and is safe to depend on from either.
 *
 * The fleet-side document this mirrors (`quay-fleet`'s
 * `docs/specs/knowledge-application-contract.md`) was not delivered when this
 * version was written, so the host states its own version and does not claim
 * compatibility with a fleet schema version it has not read.
 */

// --------------------------- identity ---------------------------

/** The contract name every reading carries. */
export const KNOWLEDGE_FACT_CONTRACT = 'cloudcli.knowledge-application.fact';

/** The version of {@link KNOWLEDGE_FACT_CONTRACT} this host implements. */
export const KNOWLEDGE_FACT_CONTRACT_VERSION = 1;

/** The project this host is, as the contract reports it. */
export const KNOWLEDGE_FACT_PROJECT = 'claudecodeui';

/** The three fact kinds this version can answer. */
export const KNOWLEDGE_FACT_KINDS = ['peer_result', 'effective_config', 'inventory'] as const;

/** One fact kind name. */
export type KnowledgeFactKind = (typeof KNOWLEDGE_FACT_KINDS)[number];

/** The ask states the activity stream can report for one ask. */
export const KNOWLEDGE_ASK_STATES = ['asking', 'answered', 'retracted'] as const;

/** One ask state name. */
export type KnowledgeAskState = (typeof KNOWLEDGE_ASK_STATES)[number];

/**
 * Which code, build and process produced a reading.
 *
 * `buildId` / `gitSha` / `builtAt` identify the CODE, `bootId` identifies the
 * PROCESS, and `serverVersion` is the package version captured at startup (not
 * re-read from disk, so a deployment that replaced the files under a running
 * process cannot relabel it). A reading whose build identity is absent cannot
 * prove which version answered it, which is why the type states each field
 * rather than folding them into one opaque string.
 */
export type KnowledgeFactIdentity = {
  contract: string;
  version: number;
  project: string;
  buildId: string;
  bootId: string;
  serverVersion: string | null;
  gitSha: string | null;
  builtAt: string | null;
  /** When this process assembled the reading. */
  observedAt: string;
};

// --------------------------- evidence ---------------------------

/** A fact's value, the source that produced it, and when that source observed it. */
export type KnowledgeEvidenceValue<T> = {
  state: 'evidence';
  value: T;
  /** The reader that produced the value (e.g. `sessions.db`, `sessions.transcript`). */
  source: string;
  /** A stable pointer into that source (a row id, a file#row, a session#message). */
  sourceRef: string;
  /** The instant the SOURCE observed the value, not the instant it was asked. */
  observedAt: string;
};

/** A field this reader could not establish, with the reason it could not. */
export type KnowledgeEvidenceUnknown = {
  state: 'unknown';
  reason: string;
};

/** One fact field: evidence, or an explicit unknown. Never a fabricated default. */
export type KnowledgeEvidence<T> = KnowledgeEvidenceValue<T> | KnowledgeEvidenceUnknown;

/** Wraps a value as an evidence reading. */
export function knowledgeEvidence<T>(
  value: T,
  source: string,
  sourceRef: string,
  observedAt: string,
): KnowledgeEvidence<T> {
  return { state: 'evidence', value, source, sourceRef, observedAt };
}

/** Wraps a reason as an unknown reading. */
export function knowledgeUnknown<T>(reason: string): KnowledgeEvidence<T> {
  return { state: 'unknown', reason };
}

/** One source that failed while the reading was assembled. Never silently dropped. */
export type KnowledgeReadError = {
  source: string;
  message: string;
};

/** A field name the reader could not establish, in addition to the evidence reason. */
export type KnowledgeUnknownField = string;

// --------------------------- peer_result ---------------------------

/** The ask/reply correlation this reading is about. */
export type KnowledgePeerCorrelation = {
  askId: string;
  /** The operation both the activity and the authoritative re-read carry. */
  operationId: string;
  sourceSessionId: string;
  /** The peer session, when the caller named one AND the store confirmed it. */
  targetSessionId: string | null;
  askingMessageId: string | null;
  answeredMessageId: string | null;
};

/** One peer-result reading. */
export type KnowledgePeerResultReading = {
  kind: 'peer_result';
  operationId: string | null;
  /** The stream row this reading came from. */
  activity: KnowledgeEvidence<{
    askId: string;
    state: KnowledgeAskState;
    at: string;
    lastAt: string;
    sourceRef: string;
  }>;
  correlation: KnowledgeEvidence<KnowledgePeerCorrelation>;
  /** Whether the ask is still waiting, and since when. */
  waiting: KnowledgeEvidence<{ state: KnowledgeAskState; since: string }>;
  /**
   * The authorization scope the ask was stated under. This stream does not
   * carry one, so the field is `unknown` unless a future producer adds it —
   * never inferred from the fact that an answer exists.
   */
  authorization: KnowledgeEvidence<{ scope: string }>;
  /** The answering message, re-read from the transcript rather than trusted from the stream. */
  reply: KnowledgeEvidence<{
    messageId: string;
    /** The transcript role, or null when the message carried none (reported in `unknown`). */
    role: string | null;
    at: string | null;
    verifiedAgainstTranscript: true;
  }>;
  unknown: KnowledgeUnknownField[];
  readErrors: KnowledgeReadError[];
};

// --------------------------- effective_config ---------------------------

/** One configuration layer: the three settings the host stores per session. */
export type KnowledgeConfigLayer = {
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
};

/**
 * One `effective_config` reading.
 *
 * `verified` requires every layer to be evidence: an expected layer supplied by
 * the caller, a stored layer from the session row, an actual layer from the
 * live host, and process / build / request identity. A missing expected layer
 * alone is enough to make the reading unverified, which is the honest answer —
 * the host cannot say a configuration was "effective" when nobody stated what
 * was expected.
 */
export type KnowledgeEffectiveConfigReading = {
  kind: 'effective_config';
  operationId: string | null;
  expected: KnowledgeEvidence<KnowledgeConfigLayer>;
  stored: KnowledgeEvidence<KnowledgeConfigLayer>;
  actual: KnowledgeEvidence<{
    live: boolean;
    pid: number | null;
    startedAt: string | null;
    runId: string | null;
  }>;
  layers: {
    process: KnowledgeEvidence<{ pid: number | null; startedAt: string | null; bootId: string }>;
    build: KnowledgeEvidence<{ buildId: string }>;
    request: KnowledgeEvidence<{ sessionId: string; runId: string; providerSessionId: string | null }>;
  };
  verified: boolean;
  unknown: KnowledgeUnknownField[];
  readErrors: KnowledgeReadError[];
};

// --------------------------- inventory ---------------------------

/** One session row an inventory page reports. */
export type KnowledgeInventoryItem = {
  sessionId: string;
  provider: string;
  providerSessionId: string | null;
  projectId: string | null;
  lifecycle: {
    /** The stored preference (`per-run` / `resident`). */
    stored: string | null;
    /** Whether a process is alive for it right now; `null` when no host source was wired. */
    live: boolean | null;
  };
  lastActivity: string | null;
};

/**
 * One `inventory` reading.
 *
 * `scope` echoes exactly the filters that were APPLIED, `total` counts the rows
 * inside that scope before pagination, and `truncated` says whether this page
 * left rows behind. An empty `items` next to `total: 0` therefore answers "the
 * bounded query found none", never "the host has no sessions".
 */
export type KnowledgeInventoryReading = {
  kind: 'inventory';
  operationId: string | null;
  scope: {
    projectId: string | null;
    provider: string | null;
    limit: number;
    offset: number;
    /** Which optional filters this reader actually applied. */
    filtersApplied: string[];
  };
  items: KnowledgeInventoryItem[];
  total: number;
  truncated: boolean;
  /** The providers present in the filtered scope, not just on this page. */
  providers: string[];
  unknown: KnowledgeUnknownField[];
  readErrors: KnowledgeReadError[];
};

/** One reading of any kind. */
export type KnowledgeFactReading =
  | KnowledgePeerResultReading
  | KnowledgeEffectiveConfigReading
  | KnowledgeInventoryReading;

// --------------------------- queries ---------------------------

/** The query for one ask→reply correlation. */
export type KnowledgePeerResultQuery = {
  kind: 'peer_result';
  /** The session that STATED the ask. */
  session: string;
  /** The peer session the caller believes the ask targeted, if it knows. */
  peerSession?: string;
  /** The operation id a previous reading returned, to re-read the same fact. */
  operationId?: string;
};

/** The query for one session's effective configuration. */
export type KnowledgeEffectiveConfigQuery = {
  kind: 'effective_config';
  session: string;
  operationId?: string;
  /** The layer the caller expected; absent means the reading cannot be verified. */
  expected?: Partial<KnowledgeConfigLayer>;
};

/** The query for one bounded inventory page. */
export type KnowledgeInventoryQuery = {
  kind: 'inventory';
  projectId?: string;
  provider?: string;
  limit?: number;
  offset?: number;
};

/** Any fact query. */
export type KnowledgeFactQuery =
  | KnowledgePeerResultQuery
  | KnowledgeEffectiveConfigQuery
  | KnowledgeInventoryQuery;

/**
 * The injected fact source. The composition root builds the one implementation
 * over the process's real services; the gateway and any criterion see only this
 * port.
 *
 * `read` answers `null` when the query addresses a session the store does not
 * hold. That is not an "unknown field": the ADDRESS itself did not resolve, and
 * the caller must surface it as a not-found refusal rather than as a fact with
 * every field unknown.
 */
export interface IKnowledgeFactSource {
  identify(): KnowledgeFactIdentity;
  read(query: KnowledgeFactQuery): Promise<KnowledgeFactReading | null>;
}
