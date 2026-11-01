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

/** Whether this build has a read-back source for one actual-config field. */
export type KnowledgeActualFieldCapability = 'readable' | 'unavailable';

/**
 * What a provider's own record can and cannot answer about a request it made.
 *
 * This is a CAPABILITY DECLARATION, not a value: a provider whose transcript
 * carries no permission mode says so here instead of leaving the field looking
 * like a reading that happened to come back empty. `reasons` is keyed
 * `request.<field>` / `response.<field>`; a provider may also state one
 * `request` / `response` reason that covers every unavailable field of that
 * half.
 */
export type KnowledgeActualCapabilities = {
  provider: string;
  request: Record<'model' | 'effort' | 'permissionMode', KnowledgeActualFieldCapability>;
  response: Record<'model' | 'effort', KnowledgeActualFieldCapability>;
  reasons: Record<string, string>;
};

/**
 * What one operation's request actually asked for, read from the provider's own
 * record of the turn (for v1: the Claude CLI's transcript line).
 *
 * `permissionMode` is present in the shape but is `null` for Claude: its
 * transcript carries no such field, and the stored session row is NOT a
 * read-back of the request. A `null` here therefore means "this source cannot
 * answer it", which {@link KnowledgeActualCapabilities} states explicitly.
 */
export type KnowledgeActualRequest = {
  model: string | null;
  effort: string | null;
  permissionMode: string | null;
  /** The provider's own identity for the request (Claude's `requestRef`). */
  requestRef: string | null;
};

/** What the provider actually answered, read from the same transcript line. */
export type KnowledgeActualResponse = {
  /** The model that produced the response — the answering side, not the asked side. */
  model: string | null;
  /** The provider's own identity for the response message. */
  responseId: string | null;
  /** When the provider recorded the response. */
  at: string;
};

/** The configuration fields an `effective_config` reading verifies one by one. */
export const KNOWLEDGE_CONFIG_FIELDS = ['model', 'effort', 'permissionMode'] as const;

/** One configuration field name. */
export type KnowledgeConfigField = (typeof KNOWLEDGE_CONFIG_FIELDS)[number];

/**
 * The verdict for one expected field against THIS operation's readable actual.
 *
 * Only `verified` counts toward `effective_config.verified`; `mismatch` is a
 * real reading that contradicts the expectation, while `unknown` says this
 * source (or this provider) cannot answer the field at all.
 */
export type KnowledgeConfigFieldVerdict =
  | {
      state: 'verified';
      expected: string;
      actual: string;
      source: string;
      sourceRef: string;
      observedAt: string;
    }
  | {
      state: 'mismatch';
      expected: string;
      actual: string;
      source: string;
      sourceRef: string;
      observedAt: string;
    }
  | { state: 'unknown'; reason: string };

/**
 * Which providers' own records this build can read, and what each one answers.
 *
 * A DATA table, not a provider-id branch: adding a provider is a new entry, and
 * a provider absent from it is honestly reported as having no read-back source
 * rather than falling through to the Claude shape. The Claude transcript
 * carries the request side (`requestedModel`, `effort`, `requestRef`) and the
 * response side (`message.model`, `message.id`), but no permission mode — the
 * stored session row records the intent, not the request that was actually
 * made, so `permissionMode` is declared unavailable instead of being echoed
 * from the row.
 */
export const ACTUAL_REQUEST_CAPABILITIES: Readonly<Record<string, KnowledgeActualCapabilities>> = {
  claude: {
    provider: 'claude',
    request: { model: 'readable', effort: 'readable', permissionMode: 'unavailable' },
    response: { model: 'readable', effort: 'unavailable' },
    reasons: {
      'request.permissionMode':
        'the Claude transcript records no permission mode, and the stored session row is not a read-back of the request',
      'response.effort': 'the Claude transcript records effort on the request side only',
    },
  },
};

/** Whether this build has any request/response read-back source for a provider. */
export function hasActualRequestSource(provider: string): boolean {
  return Object.hasOwn(ACTUAL_REQUEST_CAPABILITIES, provider);
}

/** The declaration for a provider whose transcript this build cannot read. */
function unavailableActualCapabilities(provider: string): KnowledgeActualCapabilities {
  const reason = `this build has no request/response read-back source for provider "${provider}"`;
  return {
    provider,
    request: { model: 'unavailable', effort: 'unavailable', permissionMode: 'unavailable' },
    response: { model: 'unavailable', effort: 'unavailable' },
    reasons: { request: reason, response: reason },
  };
}

/** What this build can read back for one provider; absent providers are declared, not guessed. */
export function actualCapabilitiesFor(provider: string): KnowledgeActualCapabilities {
  return ACTUAL_REQUEST_CAPABILITIES[provider] ?? unavailableActualCapabilities(provider);
}

/** The declared reason a provider cannot answer one request/response field. */
export function actualCapabilityReason(
  capabilities: KnowledgeActualCapabilities,
  half: 'request' | 'response',
  field: string,
): string {
  return (
    capabilities.reasons[`${half}.${field}`] ??
    capabilities.reasons[half] ??
    `this build has no read-back source for ${half}.${field}`
  );
}

/**
 * Builds the per-field verdicts from the expected layer and the actual request.
 *
 * An unstated expectation is not a gap in the reading, so its verdict is an
 * `unknown` that the caller does NOT list in `unknown`; a stated expectation
 * that cannot be read (capability gap, unknown request, missing sub-field) or
 * that contradicts the actual (mismatch) is a gap and does. The verdict is pure
 * so the composition root and the criteria apply the same rule.
 */
export function buildConfigFieldVerdicts(args: {
  expected: Partial<KnowledgeConfigLayer> | undefined;
  actualRequest: KnowledgeEvidence<KnowledgeActualRequest>;
  capabilities: KnowledgeActualCapabilities;
}): Record<KnowledgeConfigField, KnowledgeConfigFieldVerdict> {
  const verdicts = {} as Record<KnowledgeConfigField, KnowledgeConfigFieldVerdict>;
  for (const field of KNOWLEDGE_CONFIG_FIELDS) {
    const expectedValue = args.expected?.[field] ?? null;
    if (expectedValue === null) {
      verdicts[field] = { state: 'unknown', reason: `the caller stated no expected ${field}` };
      continue;
    }
    if (args.capabilities.request[field] === 'unavailable') {
      verdicts[field] = {
        state: 'unknown',
        reason: actualCapabilityReason(args.capabilities, 'request', field),
      };
      continue;
    }
    if (args.actualRequest.state === 'unknown') {
      verdicts[field] = {
        state: 'unknown',
        reason: `the actual request is unknown: ${args.actualRequest.reason}`,
      };
      continue;
    }
    const actualValue = args.actualRequest.value[field];
    if (actualValue === null) {
      verdicts[field] = { state: 'unknown', reason: `the transcript turn records no ${field}` };
      continue;
    }
    const shared = {
      expected: expectedValue,
      actual: actualValue,
      source: args.actualRequest.source,
      sourceRef: args.actualRequest.sourceRef,
      observedAt: args.actualRequest.observedAt,
    };
    verdicts[field] = actualValue === expectedValue
      ? { state: 'verified', ...shared }
      : { state: 'mismatch', ...shared };
  }
  return verdicts;
}

/**
 * One `effective_config` reading.
 *
 * `verified` is no longer a count of populated layers. It is true only when the
 * caller's expected layer, the in-flight OPERATION, the actual request and
 * response of that operation, the process, the build and the request identity
 * are all evidence AND every field the caller expected was `verified` against
 * the actual. A stored row, a live process, a next-turn plan or a response that
 * belongs to an older operation is never enough on its own.
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
  /** The in-flight operation (run) this reading is about; unknown when none is current. */
  operation: KnowledgeEvidence<{ id: string; at: string; bootId: string }>;
  /** What the request of THIS operation actually asked for. */
  actualRequest: KnowledgeEvidence<KnowledgeActualRequest>;
  /** What the provider actually answered for that request. */
  actualResponse: KnowledgeEvidence<KnowledgeActualResponse>;
  /** Per-field verification; an unstated expected field stays `unknown`. */
  fields: Record<KnowledgeConfigField, KnowledgeConfigFieldVerdict>;
  /** What this provider can read back at all; a missing field is declared, never guessed. */
  capabilities: KnowledgeActualCapabilities;
  verified: boolean;
  unknown: KnowledgeUnknownField[];
  readErrors: KnowledgeReadError[];
};

// --------------------------- claude transcript turns ---------------------------

/**
 * One assistant turn as a Claude CLI transcript line records it.
 *
 * The line carries BOTH sides of one request: `requestedModel` / `effort` /
 * `requestRef` are what the request asked for, and `message.model` /
 * `message.id` are what answered. That is why the effective-config reader can
 * report a request and a response with the same stable `sourceRef` instead of
 * inferring either from the session row.
 */
export type KnowledgeClaudeTranscriptTurn = {
  /** The instant the provider recorded the turn (`ISO`). Required to place it in one operation. */
  timestamp: string;
  /** The provider session the line belongs to, when the line states it. */
  sessionId: string | null;
  /** The provider's request identity (`requestRef`). */
  requestRef: string | null;
  /** The transcript's own line identity. */
  uuid: string | null;
  /** The model the request asked for. */
  requestedModel: string | null;
  /** The reasoning effort the request was made at. */
  effort: string | null;
  /** The model that actually produced the response. */
  responseModel: string | null;
  /** The response message identity. */
  responseId: string | null;
};

/** A non-empty trimmed string, or null. */
function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Parses every assistant turn out of one Claude transcript's raw JSONL text.
 *
 * A turn is kept only when it is a JSON object of `type: "assistant"` with a
 * `message` object and a readable `timestamp`: without an observation instant
 * the line cannot be attributed to one operation, and a line that does not
 * parse is skipped exactly as the other transcript readers skip a half-written
 * trailing line. The function is pure (it imports nothing) so the composition
 * root and the criteria read the same rows off the same bytes.
 */
export function readClaudeTranscriptTurns(raw: string): KnowledgeClaudeTranscriptTurn[] {
  const turns: KnowledgeClaudeTranscriptTurn[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
    const row = parsed as Record<string, unknown>;
    if (row.type !== 'assistant') continue;
    const message = row.message;
    if (typeof message !== 'object' || message === null || Array.isArray(message)) continue;
    const answer = message as Record<string, unknown>;
    const timestamp = nonEmptyString(row.timestamp);
    if (timestamp === null) continue;
    turns.push({
      timestamp,
      sessionId: nonEmptyString(row.sessionId),
      requestRef: nonEmptyString(row.requestRef) ?? nonEmptyString(row.requestId),
      uuid: nonEmptyString(row.uuid),
      requestedModel: nonEmptyString(row.requestedModel),
      effort: nonEmptyString(row.effort),
      responseModel: nonEmptyString(answer.model),
      responseId: nonEmptyString(answer.id),
    });
  }
  return turns;
}

/**
 * Picks the newest assistant turn that belongs to ONE operation.
 *
 * A turn belongs to the operation only when its instant is readable and inside
 * `[startMs, nowMs]`, and when it names no session or names one of this
 * session's ids. `sawOlder` distinguishes "the transcript has a turn, but it
 * predates this operation" from "the transcript has no turn at all": the first
 * is an old operation's response, the second is no response. Both are unknown
 * for THIS operation, but the reason the caller prints must not conflate them.
 */
export function selectClaudeTranscriptTurn(
  turns: ReadonlyArray<KnowledgeClaudeTranscriptTurn>,
  options: { startMs: number; nowMs: number; sessionIds: ReadonlyArray<string | null> },
): { turn: KnowledgeClaudeTranscriptTurn | null; sawOlder: boolean } {
  const inOperation = turns.filter((turn) => {
    const at = Date.parse(turn.timestamp);
    if (!Number.isFinite(at) || at < options.startMs || at > options.nowMs) return false;
    return turn.sessionId === null || options.sessionIds.includes(turn.sessionId);
  });
  const sawOlder = turns.some((turn) => {
    const at = Date.parse(turn.timestamp);
    return Number.isFinite(at) && at < options.startMs;
  });
  return {
    turn: inOperation.length === 0 ? null : inOperation[inOperation.length - 1]!,
    sawOlder,
  };
}

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
