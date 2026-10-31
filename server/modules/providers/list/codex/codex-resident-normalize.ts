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

/**
 * Builds the relay for one dispatched turn.
 *
 * `writer` is the run's writer; every frame forwarded here goes through the
 * normalizer first, so no raw `{ method, params }` can reach it.
 */
export function createCodexResidentFrameRelay(
  writer: ProviderRuntimeWriter,
  options: CodexResidentNormalizeOptions = {},
): CodexResidentFrameRelay {
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
      for (const message of normalizeResidentNotification(method, params, options)) {
        writer.send(message);
      }
    },
  };
}
