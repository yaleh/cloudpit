/**
 * The transcript half of the cross-session delivery arm.
 *
 * Given the tail of the TARGET session's history, find the delivered message
 * whose row id IS the delivery id, then the FIRST assistant turn after it. The
 * two identities are structural, not inferred:
 *
 *  - the delivered row's id equals the `deliveryId` the send answered with —
 *    that is what makes the transcript row the same message the server accepted;
 *  - the reply must come AFTER that row. Assistant turns from an earlier ask can
 *    sit in the same transcript, so the newest assistant message is never
 *    borrowed: "the peer answered something earlier" would otherwise be read as
 *    "the peer answered THIS".
 *
 * A missing row, an unreadable transcript and a missing following turn each
 * return an explicit `unknown` with a reason, never an empty evidence value.
 */
import {
  knowledgeEvidence,
  knowledgeUnknown,
  type KnowledgeEvidence,
  type KnowledgePeerOriginalMessage,
  type KnowledgePeerReply,
  type KnowledgeReadError,
  type KnowledgeUnknownField,
} from '@/shared/knowledge-facts.js';
import { pushUnknownOnce } from './unknown-fields.js';

/** Why the delivered message is unverified when no assistant turn follows it. */
export const KNOWLEDGE_REPLY_NOT_AFTER_DELIVERY_REASON =
  'no assistant turn in the target transcript follows the delivered message; an assistant turn that predates it is not borrowed as the answer';

/** Why the delivered message is unverified when the transcript read failed. */
export const KNOWLEDGE_TARGET_TRANSCRIPT_UNREADABLE_REASON =
  'the target session transcript could not be read, so the delivered message and its reply are unverified';

/** One transcript row, reduced to the fields this reader needs. */
export type SessionControlTranscriptMessage = {
  id: string;
  /** The provider's role string; optional because a row may omit it. */
  role?: string;
  timestamp?: string | null;
};

/** What the target transcript says about the delivered message and its reply. */
export type DeliveredMessageReading = {
  originalMessage: KnowledgeEvidence<KnowledgePeerOriginalMessage>;
  reply: KnowledgeEvidence<KnowledgePeerReply>;
  /** A chain is verified only when BOTH the row and a following assistant turn were found. */
  verified: boolean;
  unknown: KnowledgeUnknownField[];
  readErrors: KnowledgeReadError[];
};

/** A non-empty string, else null. */
function textOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The instant a row carries, or null when it does not parse. */
function instantOf(message: SessionControlTranscriptMessage): number | null {
  const at = textOrNull(message.timestamp);
  if (at === null) return null;
  const millis = Date.parse(at);
  return Number.isFinite(millis) ? millis : null;
}

/**
 * Reads one delivered message and the assistant turn that follows it.
 *
 * `limit` is the tail page size the caller asks for; a delivery older than that
 * window is reported as an unknown row, not searched for outside the page.
 */
export async function readDeliveredMessage(options: {
  deliveryId: string;
  targetSessionId: string;
  recordedAt: string;
  limit: number;
  readHistory: (
    sessionId: string,
    options: { limit: number },
  ) => Promise<{ messages: ReadonlyArray<SessionControlTranscriptMessage> }>;
}): Promise<DeliveredMessageReading> {
  const unknown: KnowledgeUnknownField[] = [];
  const readErrors: KnowledgeReadError[] = [];

  let messages: ReadonlyArray<SessionControlTranscriptMessage>;
  try {
    const page = await options.readHistory(options.targetSessionId, { limit: options.limit });
    messages = page.messages;
  } catch (error) {
    readErrors.push({
      source: 'sessions.transcript',
      message: error instanceof Error ? error.message : String(error),
    });
    unknown.push('delivery.originalMessage', 'delivery.reply');
    return {
      originalMessage: knowledgeUnknown(KNOWLEDGE_TARGET_TRANSCRIPT_UNREADABLE_REASON),
      reply: knowledgeUnknown(KNOWLEDGE_TARGET_TRANSCRIPT_UNREADABLE_REASON),
      verified: false,
      unknown,
      readErrors,
    };
  }

  const originalIndex = messages.findIndex((message) => message.id === options.deliveryId);
  if (originalIndex === -1) {
    unknown.push('delivery.originalMessage', 'delivery.reply');
    return {
      originalMessage: knowledgeUnknown(
        `the target transcript window does not hold a message with id "${options.deliveryId}", so the delivery cannot be tied to a row`,
      ),
      reply: knowledgeUnknown('there is no delivered message to follow'),
      verified: false,
      unknown,
      readErrors,
    };
  }

  const originalRow = messages[originalIndex]!;
  const originalAt = textOrNull(originalRow.timestamp);
  const originalMillis = instantOf(originalRow);
  if (originalRow.role === undefined) pushUnknownOnce(unknown, 'delivery.originalMessage.role');
  if (originalAt === null) pushUnknownOnce(unknown, 'delivery.originalMessage.at');

  const originalMessage: KnowledgeEvidence<KnowledgePeerOriginalMessage> = knowledgeEvidence(
    {
      messageId: originalRow.id,
      role: originalRow.role ?? null,
      at: originalAt,
      verifiedAgainstTranscript: true as const,
    },
    'sessions.transcript',
    `${options.targetSessionId}#${originalRow.id}`,
    originalAt ?? options.recordedAt,
  );

  let replyIndex = -1;
  for (let index = originalIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]!;
    if (message.role !== 'assistant') continue;
    if (originalMillis !== null) {
      const millis = instantOf(message);
      if (millis !== null && millis <= originalMillis) continue;
    }
    replyIndex = index;
    break;
  }

  if (replyIndex === -1) {
    pushUnknownOnce(unknown, 'delivery.reply');
    return {
      originalMessage,
      reply: knowledgeUnknown(KNOWLEDGE_REPLY_NOT_AFTER_DELIVERY_REASON),
      verified: false,
      unknown,
      readErrors,
    };
  }

  const replyRow = messages[replyIndex]!;
  const replyAt = textOrNull(replyRow.timestamp);
  if (replyRow.role === undefined) pushUnknownOnce(unknown, 'delivery.reply.role');
  if (replyAt === null) pushUnknownOnce(unknown, 'delivery.reply.at');

  const reply: KnowledgeEvidence<KnowledgePeerReply> = knowledgeEvidence(
    {
      messageId: replyRow.id,
      role: replyRow.role ?? null,
      at: replyAt,
      afterMessageId: options.deliveryId,
      verifiedAgainstTranscript: true as const,
    },
    'sessions.transcript',
    `${options.targetSessionId}#${replyRow.id}`,
    replyAt ?? options.recordedAt,
  );

  return { originalMessage, reply, verified: true, unknown, readErrors };
}
