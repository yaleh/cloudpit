/**
 * The activity half of the knowledge-application fact contract: turns the
 * context-event stream's three session-ask kinds into ONE correlated activity
 * per ask, with a deterministic operation id.
 *
 * WHY THE STREAM AND NOT A SECOND LEDGER. Every `session.asking` row is this
 * host's own statement that a question was asked, and every `session.answered`
 * / `session.asking.retracted` row is its own statement that the ask settled.
 * The stream is therefore a fact source a consumer can re-read, not a digest
 * that may or may not have been written. This module projects those rows; it
 * never writes one, never consults the observation store, and never invents a
 * row that the stream does not carry.
 *
 * CORRELATION. `operationId` is derived from the ask's own dedup key
 * (`<sessionId>:<assistantMessageId>`) with SHA-256. Two reads of the same ask —
 * the activity read and the authoritative re-read the fact source performs —
 * therefore produce the SAME id without either one storing it, and a consumer
 * can tell a re-read of one ask from a re-read of another. It is opaque on
 * purpose: the id is a correlation handle, not a second copy of the ask key.
 *
 * MISSING IS EXPLICIT. The stream records the ASKING session; it does not record
 * which peer session the ask targeted, nor an authorization scope. Those fields
 * are named in `unknown` instead of being filled from the caller's belief or
 * from a default. An answer row that omits `messageId` likewise reports
 * `answeredMessageId` as unknown rather than reading the ask as unanswered.
 *
 * Consumers: `server/knowledge-facts-wiring.ts` (the `peer_result` reading and
 * its transcript re-read) and `tests/knowledge-activity-events.test.ts`.
 */
import { createHash } from 'node:crypto';

import {
  knowledgeEvidence,
  knowledgeUnknown,
  type KnowledgeAskState,
  type KnowledgeEvidence,
  type KnowledgeReadError,
} from '@/shared/knowledge-facts.js';

import {
  readCloudCliSessionAskRows,
  type CloudCliSessionAskRow,
  type ReadOpenSessionAsksOptions,
} from './session-ask-stream-reader.js';

/** How far back the activity projection looks; matches the ask rebuild's window. */
export const DEFAULT_KNOWLEDGE_ACTIVITY_LOOKBACK_DAYS = 7;

/** The `data` members an ask row must carry; anything else is somebody else's fact. */
const ASK_ID_FIELD = 'askId';
const MESSAGE_ID_FIELD = 'messageId';

/** One ask as the stream currently shows it. */
export type KnowledgeActivity = {
  /** `op-<12 hex>` derived from {@link askId}; stable across every re-read. */
  operationId: string;
  /** `<sessionId>:<assistantMessageId>` — the fleet's own dedup key. */
  askId: string;
  /** The session that STATED the ask. */
  sessionId: string;
  /** The project the asking row carried, or `null` when it carried none. */
  project: string | null;
  /** The assistant message the question came from; `''` when the row omitted it. */
  askingMessageId: string;
  /** The user message that settled the ask, when the answered row named one. */
  answeredMessageId: string | null;
  state: KnowledgeAskState;
  /** The first asking row's instant. */
  at: string;
  /** The newest row for this ask (an answer, a retraction, or a re-ask). */
  lastAt: string;
  /** `file#rowId` of the newest row — the pointer a re-read can be checked against. */
  sourceRef: string;
  /** Fields the stream cannot answer. Never silently guessed. */
  unknown: string[];
};

/** What one projection of the stream found. */
export type KnowledgeActivityRead = {
  activities: KnowledgeActivity[];
  readErrors: KnowledgeReadError[];
  /** The number of raw ask rows the projection scanned (non-vacuity reading). */
  scannedRows: number;
};

/** What one authoritative re-read of a single operation found. */
export type KnowledgeActivityReRead = {
  operationId: string;
  activity: KnowledgeActivity | null;
  /** How many activities carried this operation id; `> 1` would be a correlation bug. */
  matches: number;
  scannedActivities: number;
  readErrors: KnowledgeReadError[];
};

/** One message as the transcript reader returns it; only the fields this module reads. */
export type KnowledgeTranscriptMessage = {
  id: string;
  /** The provider's role string; optional because a transcript row may omit it. */
  role?: string;
  timestamp?: string | null;
};

/** The reply re-read against the session's own transcript. */
export type KnowledgeReplyReRead = {
  operationId: string;
  reply: KnowledgeEvidence<{
    messageId: string;
    role: string | null;
    at: string | null;
    verifiedAgainstTranscript: true;
  }>;
  unknown: string[];
  readErrors: KnowledgeReadError[];
};

/** The clock/file fence {@link readKnowledgeActivities} accepts. */
export type ReadKnowledgeActivitiesOptions = ReadOpenSessionAsksOptions;

/** The reason text a field carries when the stream simply does not record it. */
export const KNOWLEDGE_TARGET_UNKNOWN_REASON =
  'the context-event stream records the asking session, not which peer session the ask targeted';

/** The reason text for an answered row with no message id. */
export const KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON =
  'the session.answered row carries no messageId, so the settling message cannot be named';

/** A field is a non-empty string, or the empty string. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A parsed JSON object, or null. */
function recordOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * The operation id for one ask.
 *
 * Deterministic by construction: the same askId always yields the same handle,
 * and the handle contains no session id or message id of its own. SHA-256 is
 * used rather than a counter so a re-read in a LATER process (no in-memory
 * counter to inherit) still agrees with the first reading.
 */
export function deriveKnowledgeOperationId(askId: string): string {
  return `op-${createHash('sha256').update(askId).digest('hex').slice(0, 12)}`;
}

/** `file#rowId` when the row has an id, else `file#at`. */
function sourceRefOf(file: string, row: Record<string, unknown>, at: number): string {
  const id = textOf(row.id);
  return `${file}#${id === '' ? String(at) : id}`;
}

/**
 * Projects every ask row in the window into one activity per ask.
 *
 * An answer or retraction row whose asking row is NOT in the window still
 * produces an activity — the fact exists, and hiding it would make a settlement
 * look like nothing happened. It is marked `askingRow` unknown, which is exactly
 * the distinction a consumer needs between "this ask was never asked" and "the
 * asking row aged out of my lookback".
 */
export async function readKnowledgeActivities(
  options: ReadKnowledgeActivitiesOptions = {},
): Promise<KnowledgeActivityRead> {
  const readErrors: KnowledgeReadError[] = [];
  let rows: CloudCliSessionAskRow[] = [];
  try {
    rows = await readCloudCliSessionAskRows(options);
  } catch (error) {
    readErrors.push({
      source: 'context-events',
      message: error instanceof Error ? error.message : String(error),
    });
  }

  const byAskId = new Map<string, KnowledgeActivity>();
  for (const { file, row, at } of rows) {
    const data = recordOf(row.data);
    if (data === null) continue;
    const askId = textOf(data[ASK_ID_FIELD]);
    if (askId === '') continue;
    const kind = row.kind;
    const atIso = new Date(at).toISOString();
    const messageId = textOf(data[MESSAGE_ID_FIELD]);
    const sourceRef = sourceRefOf(file, row, at);
    const existing = byAskId.get(askId);

    if (kind === 'session.asking') {
      const sessionId = textOf(row.session);
      if (sessionId === '') continue;
      if (existing === undefined) {
        byAskId.set(askId, {
          operationId: deriveKnowledgeOperationId(askId),
          askId,
          sessionId,
          project: textOf(row.project) === '' ? null : textOf(row.project),
          askingMessageId: messageId,
          answeredMessageId: null,
          state: 'asking',
          at: atIso,
          lastAt: atIso,
          sourceRef,
          unknown: ['targetSessionId', 'authorization'],
        });
        continue;
      }
      if (at >= Date.parse(existing.lastAt)) {
        existing.state = 'asking';
        existing.lastAt = atIso;
        existing.sourceRef = sourceRef;
        if (messageId !== '') existing.askingMessageId = messageId;
      }
      continue;
    }

    if (kind !== 'session.answered' && kind !== 'session.asking.retracted') continue;
    const settling: KnowledgeAskState = kind === 'session.answered' ? 'answered' : 'retracted';

    if (existing === undefined) {
      // The asking row is outside the window (or was never written): keep the
      // settlement, and name the row this projection could not see.
      byAskId.set(askId, {
        operationId: deriveKnowledgeOperationId(askId),
        askId,
        sessionId: textOf(row.session),
        project: textOf(row.project) === '' ? null : textOf(row.project),
        askingMessageId: '',
        answeredMessageId: settling === 'answered' && messageId !== '' ? messageId : null,
        state: settling,
        at: atIso,
        lastAt: atIso,
        sourceRef,
        unknown: ['askingRow', 'targetSessionId', 'authorization'],
      });
      continue;
    }

    if (at >= Date.parse(existing.lastAt)) {
      existing.state = settling;
      existing.lastAt = atIso;
      existing.sourceRef = sourceRef;
      if (settling === 'answered') {
        existing.answeredMessageId = messageId === '' ? null : messageId;
      }
    }
  }

  for (const activity of byAskId.values()) {
    if (activity.askingMessageId === '') activity.unknown.push('askingMessageId');
    if (activity.state === 'answered' && activity.answeredMessageId === null) {
      activity.unknown.push('answeredMessageId');
    }
  }

  return {
    activities: [...byAskId.values()].sort((left, right) => left.at.localeCompare(right.at)),
    readErrors,
    scannedRows: rows.length,
  };
}

/**
 * Authoritative re-read of ONE operation: run the same projection again and
 * return the activity carrying `operationId`.
 *
 * This is the fact contract's "re-read" half: the first read produced an
 * activity; this read re-derives it from the files rather than from anything
 * the first read kept in memory, so a consumer can confirm the correlation
 * still holds.
 */
export async function readKnowledgeActivity(
  operationId: string,
  options: ReadKnowledgeActivitiesOptions = {},
): Promise<KnowledgeActivityReRead> {
  const read = await readKnowledgeActivities(options);
  const matching = read.activities.filter((activity) => activity.operationId === operationId);
  return {
    operationId,
    activity: matching[0] ?? null,
    matches: matching.length,
    scannedActivities: read.activities.length,
    readErrors: read.readErrors,
  };
}

/**
 * Re-reads the settling message from the session's transcript.
 *
 * The stream says an ask was answered; the transcript says whether the message
 * it names really exists. Only the second reading is called
 * `verifiedAgainstTranscript: true`. When the stream omitted the message id, or
 * the transcript read fails, or the message is not in the window, the reply is
 * `unknown` with the reason — never the answered row's own claim dressed up as
 * a verified reply.
 */
export async function readKnowledgeActivityReply(options: {
  activity: KnowledgeActivity;
  readHistory: (
    sessionId: string,
    limit: number,
  ) => Promise<{ messages: ReadonlyArray<KnowledgeTranscriptMessage> }>;
  limit?: number;
}): Promise<KnowledgeReplyReRead> {
  const { activity } = options;
  const unknown: string[] = [];
  const readErrors: KnowledgeReadError[] = [];

  if (activity.answeredMessageId === null) {
    unknown.push('reply');
    return {
      operationId: activity.operationId,
      reply: knowledgeUnknown(KNOWLEDGE_ANSWERED_MESSAGE_UNKNOWN_REASON),
      unknown,
      readErrors,
    };
  }

  let messages: ReadonlyArray<KnowledgeTranscriptMessage>;
  try {
    const page = await options.readHistory(activity.sessionId, options.limit ?? 200);
    messages = page.messages;
  } catch (error) {
    readErrors.push({
      source: 'sessions.transcript',
      message: error instanceof Error ? error.message : String(error),
    });
    unknown.push('reply');
    return {
      operationId: activity.operationId,
      reply: knowledgeUnknown('the session transcript could not be read, so the reply is unverified'),
      unknown,
      readErrors,
    };
  }

  const match = messages.find((message) => message.id === activity.answeredMessageId);
  if (match === undefined) {
    unknown.push('reply');
    return {
      operationId: activity.operationId,
      reply: knowledgeUnknown('the answered message is not inside the transcript window that was read'),
      unknown,
      readErrors,
    };
  }

  const role = match.role ?? null;
  if (role === null) unknown.push('reply.role');

  return {
    operationId: activity.operationId,
    reply: knowledgeEvidence(
      {
        messageId: match.id,
        role,
        at: match.timestamp ?? null,
        verifiedAgainstTranscript: true as const,
      },
      'sessions.transcript',
      `${activity.sessionId}#${match.id}`,
      activity.lastAt,
    ),
    unknown,
    readErrors,
  };
}
