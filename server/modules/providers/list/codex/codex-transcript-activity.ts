import { isRecord, readLastTranscriptRecord } from '@/shared/utils.js';

/**
 * Which Codex rollout rows describe activity, and which are bookkeeping.
 *
 * A Codex rollout is one JSONL stream of `{ timestamp, type, payload }` rows,
 * and not every row with a `timestamp` is a thing the user did. Turns are
 * bracketed by `task_started` / `task_complete`, conversation rows are
 * `event_msg` and `response_item` records, and the rest is machinery:
 *
 * - `session_meta` — written when the thread is created (and again, sparser,
 *   when a rollout is resumed). It is a birth record, not a turn.
 * - `turn_context` — restates the turn's model/settings at its start.
 * - `token_usage_record`, `event_msg`/`token_count` — accounting snapshots.
 * - `event_msg`/`thread_settings_applied` — a settings write, not conversation.
 * - `world_state` — a periodic state snapshot.
 *
 * Reading "last activity" from any of those would reintroduce the defect this
 * module exists to fix in a subtler form: a file touched or re-flushed while
 * idle would look active because machinery rows carry timestamps too. So the
 * last row that represents a person or the agent actually doing something is
 * the answer, and the bookkeeping rows behind it are skipped.
 *
 * `response_item` rows are messages, reasoning, and tool calls/outputs — all
 * conversation activity — so every one of them counts. For `event_msg` the
 * payload type is the discriminator; the three bookkeeping payloads above are
 * excluded and everything else (user_message, task_started, task_complete,
 * item_completed, exec/patch/MCP/web events, aborts, rollbacks) counts.
 */
const NON_ACTIVITY_EVENT_MESSAGE_TYPES = new Set([
  'token_count',
  'thread_settings_applied',
]);

const NON_ACTIVITY_RECORD_TYPES = new Set([
  'session_meta',
  'turn_context',
  'token_usage_record',
  'world_state',
]);

/**
 * Whether one rollout row is evidence of conversation/turn activity.
 *
 * Unknown top-level types are not activity: this reader answers what Codex
 * itself recorded as a turn or a message, and guessing that a new record type
 * means activity would let machinery append rows silently move last activity
 * again. When Codex adds a conversation-bearing record type, it needs a line
 * here — the alternative is a reading that is accidentally true.
 */
export function isCodexActivityRecord(record: unknown): boolean {
  if (!isRecord(record)) {
    return false;
  }

  const type = record.type;
  if (typeof type !== 'string' || NON_ACTIVITY_RECORD_TYPES.has(type)) {
    return false;
  }

  if (type === 'response_item') {
    return true;
  }

  if (type === 'event_msg') {
    const payload = record.payload;
    const payloadType = isRecord(payload) && typeof payload.type === 'string'
      ? payload.type
      : undefined;
    return payloadType !== undefined && !NON_ACTIVITY_EVENT_MESSAGE_TYPES.has(payloadType);
  }

  return false;
}

/**
 * The timestamp one rollout row contributes, or `null` when it contributes none.
 *
 * A row that is not activity contributes nothing even when it carries a
 * timestamp. A timestamp the database cannot parse is treated as absent, for
 * the same reason `readRecordedTimestamp` does: `createSession` would normalize
 * an unparseable value to `CURRENT_TIMESTAMP`, i.e. "active just now".
 */
export function readCodexActivityTimestamp(record: unknown): string | null {
  if (!isCodexActivityRecord(record) || !isRecord(record)) {
    return null;
  }

  const value = record.timestamp;
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  return Number.isNaN(new Date(value).getTime()) ? null : value;
}

/**
 * Reads the newest conversation activity time a Codex rollout records.
 *
 * Uses the shared bounded tail walk rather than reading the whole file: the
 * newest row is at the end, and rollouts grow with every turn. Returns the
 * record's timestamp string exactly as stored, or `null` when the scanned
 * window holds no activity row — the synchronizer then falls back to the file's
 * mtime, because a rollout that was just created has only a `session_meta` row
 * and still needs an activity time to appear in a sidebar sorted by activity.
 */
export async function readCodexTranscriptLastActivity(filePath: string): Promise<string | null> {
  return readLastTranscriptRecord(filePath, readCodexActivityTimestamp);
}
