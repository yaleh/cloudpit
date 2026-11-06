import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sessionBindingService, sessionsDb } from '@/modules/database/index.js';
import type { NormalizedMessage, ProviderRuntimeWriter } from '@/shared/types.js';
import { createCompleteMessage, createNormalizedMessage, isRecord } from '@/shared/utils.js';

/**
 * Event normalization for the resident Codex app-server (gap-codex-resident-
 * normalize-app-server-frames).
 *
 * `CodexHostDriver.run()` used to hand every connection notification straight
 * to the run writer as `{ method, params }`. The writer only forwards
 * kind-carrying normalized messages, so all of a resident Codex turn's output
 * — `item/agentMessage/delta`, `item/completed` and the terminal turn frames —
 * was logged as `Dropping non-normalized outbound payload` and never reached
 * the browser. This module is the missing translation layer between the
 * app-server's raw notification dialect and the app's `NormalizedMessage`
 * wire vocabulary.
 *
 * Consumed by `codex-host-driver.provider.ts`. Approval, queue and background
 * traffic is deliberately NOT translated here: `codex-approval-broker.ts` and
 * `codex-resident-queue.ts` already emit their own kind-carrying frames, and
 * translating the same notification twice would duplicate it.
 */

const PROVIDER = 'codex' as const;

/**
 * Whether another seam of the driver already consumes this notification.
 *
 * These reach the run's subscription because the connection broadcasts every
 * notification to every listener, but the driver's own `handleNotification`
 * and the approval broker already act on them (and the broker writes its own
 * normalized frames). Dropping them here without a log keeps that ownership
 * single: they are not "unmapped", they are consumed elsewhere.
 */
function isHandledElsewhere(method: string): boolean {
  switch (method) {
    case 'turn/started':
    case 'thread/status/changed':
    case 'thread/queue/changed':
    case 'thread/settings/updated':
    case 'process/exited':
    case 'serverRequest/resolved':
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
    case 'item/permissions/requestApproval':
    case 'item/tool/requestUserInput':
      return true;
    default:
      return false;
  }
}

/** Reads a non-empty string property without widening the value to `any`. */
function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value ? value : null;
}

/** The turn a frame belongs to (`turn: { id }`, `turnId`, or neither). */
function readFrameTurnId(params: Record<string, unknown>): string | null {
  const turn = isRecord(params.turn) ? params.turn : null;
  return (turn ? readString(turn, 'id') : null) ?? readString(params, 'turnId');
}

/** The app-server item id a delta or completed item is about. */
function readItemId(params: Record<string, unknown>): string | null {
  const item = isRecord(params.item) ? params.item : null;
  return (item ? readString(item, 'id') : null) ?? readString(params, 'itemId');
}

/** Envelope fields shared by every translated frame. */
function baseFields(params: Record<string, unknown>) {
  return {
    provider: PROVIDER,
    sessionId: readString(params, 'threadId') ?? '',
    threadId: readString(params, 'threadId') ?? undefined,
    turnId: readFrameTurnId(params) ?? undefined,
  };
}

export type CodexResidentNormalizeOptions = {
  /**
   * Called for every notification this layer cannot map (and that no other
   * seam owns). The driver leaves this at the default, which records the drop
   * in the server log; criteria pass a collector so they can assert the drop
   * happened without polluting the test output.
   */
  onDropped?: (method: string) => void;
};

/**
 * Turns one app-server notification into the normalized messages the run
 * writer understands.
 *
 * Returns an empty array for notifications that carry no client-facing content
 * (lifecycle frames consumed elsewhere, empty deltas) and for frames this
 * layer cannot map; the latter are reported through `onDropped` so a silent
 * drop cannot hide a protocol change.
 */
export function normalizeResidentNotification(
  method: string,
  params: Record<string, unknown>,
  options: CodexResidentNormalizeOptions = {},
): NormalizedMessage[] {
  if (method === 'item/agentMessage/delta') {
    const delta = readString(params, 'delta');
    if (!delta) {
      return [];
    }
    const itemId = readItemId(params);
    return [createNormalizedMessage({
      ...baseFields(params),
      id: itemId ?? undefined,
      // Deltas accumulate into the block `item/completed` later settles; the
      // item id is that block's identity on both frames.
      blockKey: itemId ?? undefined,
      kind: 'stream_delta',
      content: delta,
    })];
  }

  if (method === 'item/completed') {
    const item = isRecord(params.item) ? params.item : null;
    if (!item || item.type !== 'agentMessage') {
      return [];
    }
    const text = readString(item, 'text');
    if (!text) {
      return [];
    }
    const itemId = readItemId(params);
    return [createNormalizedMessage({
      ...baseFields(params),
      id: itemId ?? undefined,
      // Same block key as the deltas, so the client settles the streamed row
      // in place instead of drawing a second copy of the answer.
      blockKey: itemId ?? undefined,
      kind: 'text',
      role: 'assistant',
      content: text,
    })];
  }

  if (method === 'turn/completed' || method === 'turn/failed' || method === 'turn/interrupted') {
    return normalizeTurnTerminal(method, params);
  }

  if (!isHandledElsewhere(method)) {
    (options.onDropped ?? ((dropped: string) => {
      console.debug('[CodexResidentNormalize] Dropping unmapped notification', dropped);
    }))(method);
  }
  return [];
}

/** Maps the three terminal turn notifications onto the run's terminal frames. */
function normalizeTurnTerminal(method: string, params: Record<string, unknown>): NormalizedMessage[] {
  const turn = isRecord(params.turn) ? params.turn : {};
  const status = readString(turn, 'status') ?? (method === 'turn/completed' ? 'completed' : 'failed');
  const fields = baseFields(params);
  const abortOptions = { provider: PROVIDER, sessionId: fields.sessionId, exitCode: 0, aborted: true };

  if (method === 'turn/interrupted' || status === 'interrupted') {
    return [createCompleteMessage(abortOptions)];
  }
  if (method === 'turn/failed' || status === 'failed') {
    const error = isRecord(turn.error) ? turn.error : isRecord(params.error) ? params.error : null;
    const message = (error ? readString(error, 'message') : null) ?? 'Codex turn failed';
    return [
      createNormalizedMessage({ ...fields, kind: 'error', content: message }),
      createCompleteMessage({ provider: PROVIDER, sessionId: fields.sessionId, exitCode: 1 }),
    ];
  }
  return [createCompleteMessage({ provider: PROVIDER, sessionId: fields.sessionId, exitCode: 0 })];
}

/**
 * Where a resident thread's transcript is persisted.
 *
 * Deliberately OUTSIDE `~/.codex/sessions`: `CodexSessionSynchronizer` indexes
 * every rollout under that tree as a per-run session, so a file written there
 * would create a second sidebar row for a conversation that already has one.
 * `~/.cloudcli` is the app's own state root (the same directory the database and
 * attachments live under), so nothing else claims this path.
 */
const RESIDENT_TRANSCRIPT_DIRECTORY = path.join('.cloudcli', 'codex-resident-transcripts');

/** The transcript file one resident thread's turns are appended to. */
function residentTranscriptPath(threadId: string): string {
  // Thread ids are server-generated (`01a…`, `thread-1`), but the value becomes a
  // file name, so anything that is not path-safe is folded rather than trusted.
  return path.join(
    os.homedir(),
    RESIDENT_TRANSCRIPT_DIRECTORY,
    `${threadId.replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`,
  );
}

/**
 * The options that make a resident run persist its turn into the session's
 * transcript row.
 *
 * The app session id names the row whose `jsonl_path` is written; the prompt is
 * this run's user turn, which the app-server's own notifications do not carry
 * back (they only carry the assistant side).
 */
export type CodexResidentTranscriptOptions = {
  appSessionId: string;
  prompt: string;
};

type ResidentTranscriptRecorder = {
  /** Records one forwarded notification and the messages it normalized to. */
  observe: (params: Record<string, unknown>, messages: NormalizedMessage[]) => void;
};

/**
 * Appends a resident turn to a rollout-shaped transcript file.
 *
 * The resident app-server keeps the thread's history inside its process, so
 * `session_read` — which reads the row's `jsonl_path` — has nothing to open for
 * a resident session. This recorder writes the turn in the same JSONL dialect a
 * per-run rollout uses (`session_meta`, `event_msg`/`user_message`,
 * `response_item`/assistant message, `task_started`/`task_complete`) and points
 * the session row at the file, so the existing reader covers resident
 * conversations without a second parser.
 *
 * Recording starts on the first frame that carries the thread id. Before it
 * writes anything it resolves the session row and refuses a host whose thread is
 * not the one the row claims: a stale host must not repoint someone else's
 * conversation. Every failure is logged and disables recording for that run —
 * losing the transcript must never fail the turn itself.
 */
function createResidentTranscriptRecorder(
  options: CodexResidentTranscriptOptions,
): ResidentTranscriptRecorder {
  let filePath: string | null = null;
  let active = true;
  let promptWritten = false;
  let currentTurnId: string | null = null;
  let lastAssistantText: string | null = null;

  const append = (entry: Record<string, unknown>): void => {
    if (!filePath) {
      return;
    }
    try {
      fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (error) {
      active = false;
      console.warn('[CodexResidentTranscript] Could not append to the resident transcript', error);
    }
  };

  /** Resolves the thread, creates the file and links the session row on first use. */
  const begin = (params: Record<string, unknown>): boolean => {
    if (!active) {
      return false;
    }
    if (filePath) {
      return true;
    }
    const threadId = readString(params, 'threadId');
    if (!threadId) {
      return false;
    }
    let row;
    try {
      row = sessionsDb.getSessionById(options.appSessionId);
    } catch (error) {
      // Without a database (a focused driver criterion, a process with no
      // composition root) there is no row to link, so recording is off.
      active = false;
      console.debug('[CodexResidentTranscript] No session row to link', error);
      return false;
    }
    if (!row) {
      active = false;
      return false;
    }
    if (row.provider_session_id && row.provider_session_id !== threadId) {
      // A host still running the thread this session was edited away from. Its
      // late frames must not point the row back at its own file.
      active = false;
      return false;
    }

    const target = residentTranscriptPath(threadId);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) {
        fs.writeFileSync(target, `${JSON.stringify({
          timestamp: new Date().toISOString(),
          type: 'session_meta',
          payload: { id: threadId, cwd: row.project_path ?? '' },
        })}\n`, 'utf8');
      }
      sessionBindingService.replaceBinding({
        sessionId: options.appSessionId,
        providerSessionId: threadId,
        jsonlPath: target,
      });
    } catch (error) {
      active = false;
      console.warn('[CodexResidentTranscript] Could not link the resident transcript', error);
      return false;
    }

    filePath = target;
    return true;
  };

  return {
    observe(params, messages): void {
      if (!begin(params)) {
        return;
      }
      const turnId = readFrameTurnId(params);
      if (turnId) {
        currentTurnId = turnId;
      }
      if (!promptWritten) {
        append({
          timestamp: new Date().toISOString(),
          type: 'event_msg',
          payload: {
            type: 'task_started',
            ...(currentTurnId ? { turn_id: currentTurnId } : {}),
          },
        });
        append({
          timestamp: new Date().toISOString(),
          type: 'event_msg',
          payload: { type: 'user_message', kind: 'plain', message: options.prompt },
        });
        promptWritten = true;
      }

      for (const message of messages) {
        if (
          message.kind === 'text'
          && message.role === 'assistant'
          && typeof message.content === 'string'
          && message.content.trim()
        ) {
          lastAssistantText = message.content;
          append({
            timestamp: message.timestamp || new Date().toISOString(),
            type: 'response_item',
            payload: {
              type: 'message',
              role: 'assistant',
              content: [{ type: 'output_text', text: message.content }],
            },
          });
          continue;
        }
        if (message.kind === 'error' && typeof message.content === 'string' && message.content) {
          append({
            timestamp: message.timestamp || new Date().toISOString(),
            type: 'event_msg',
            payload: { type: 'turn_aborted', reason: message.content },
          });
          continue;
        }
        if (message.kind === 'complete') {
          append({
            timestamp: new Date().toISOString(),
            type: 'event_msg',
            payload: {
              type: 'task_complete',
              ...(currentTurnId ? { turn_id: currentTurnId } : {}),
              ...(lastAssistantText ? { last_agent_message: lastAssistantText } : {}),
            },
          });
        }
      }
    },
  };
}

/**
 * One resident turn's frame relay.
 *
 * A connection broadcasts a notification to every run currently subscribed for
 * the thread; without a per-run turn filter a run queued behind another would
 * receive the earlier turn's deltas (duplicating the visible answer) and its
 * terminal `complete`. The relay keeps the turn this run owns and drops frames
 * of any other turn. The queued state is explicit because a queued run owns no
 * turn at all until the process starts it.
 */
export type CodexResidentFrameRelay = {
  /** Marks the run as queued behind another turn; nothing is forwarded yet. */
  queue: () => void;
  /** Binds the turn the process started for this run (direct or queued). */
  bindTurn: (turnId: string | null) => void;
  /** Normalizes and forwards one notification belonging to this run. */
  forward: (method: string, params: Record<string, unknown>) => void;
};

/** What the relay may be told to do besides normalizing: persist this run's turn. */
export type CodexResidentRelayOptions = CodexResidentNormalizeOptions & {
  transcript?: CodexResidentTranscriptOptions;
};

/**
 * Builds the relay for one dispatched turn.
 *
 * `writer` is the run's writer; every frame forwarded here goes through the
 * normalizer first, so no raw `{ method, params }` can reach it. With
 * `options.transcript` the same normalized turn is also appended to the
 * session's transcript file, which is what makes `session_read` able to answer
 * for a resident conversation.
 */
export function createCodexResidentFrameRelay(
  writer: ProviderRuntimeWriter,
  options: CodexResidentRelayOptions = {},
): CodexResidentFrameRelay {
  const recorder = options.transcript
    ? createResidentTranscriptRecorder(options.transcript)
    : null;
  let queued = false;
  let turnId: string | null = null;
  return {
    queue(): void {
      queued = true;
      turnId = null;
    },
    bindTurn(nextTurnId: string | null): void {
      queued = false;
      turnId = nextTurnId;
    },
    forward(method: string, params: Record<string, unknown>): void {
      if (queued) {
        return;
      }
      const frameTurnId = readFrameTurnId(params);
      // The first frame of a turn may arrive before `turn/start` answers; adopt
      // it rather than dropping the turn's opening output.
      if (turnId === null && frameTurnId) {
        turnId = frameTurnId;
      }
      if (frameTurnId && turnId && frameTurnId !== turnId) {
        return;
      }
      const messages = normalizeResidentNotification(method, params, options);
      recorder?.observe(params, messages);
      for (const message of messages) {
        writer.send(message);
      }
    },
  };
}
