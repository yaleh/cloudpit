/**
 * The session ask ledger — the cross-process record of what this host stated.
 *
 * A session digest carries `digest.askEvents`: which asks were STATED (`asking`), which were
 * ANSWERED (`answered`), which are still WAITING (`pending`), and which the semantic gate
 * WITHDREW (`retracted`). That record has to survive a process restart, so it rides with the
 * digest through the observation store and is read back at the top of every turn.
 *
 * THIS FILE OWNS THE STATE. The free helpers below are the pure ledger transitions; the owner
 * built by {@link createSessionAskLedgerOwner} is the ONE write path — it reads the ledger out
 * of a digest, records/answers/withdraws entries, and persists the result without touching any
 * other digest field. `session-digest.producer.ts` composes it and no longer keeps these write
 * details itself.
 *
 * Consumers: `server/modules/observation/session-digest/session-digest.producer.ts` (turn end, user turn and
 * the sweep composition), `session-ask-retraction.ts` ({@link withdrawAskFromLedger}) and
 * `session-ask-recovery.ts` (startup sweep and user-turn answers).
 */
import type { SessionAskEvent } from '@/shared/types.js';

import type { SessionAskTranscriptScan } from './session-ask-decision-digest.js';
import type { ObservedObject, ObservationStore } from '../core/index.js';

/**
 * The ask-event ledger carried in a session digest (`digest.askEvents`).
 *
 * It is the persistence the old in-memory set lacked. `answered` is the set of askIds whose
 * `session.answered` was already stated, `asking` the `<askId>:<revision>` keys already stated,
 * `pending` the asks stated but not yet answered, and `retracted` the askIds this host has
 * WITHDRAWN (the semantic gate read the asking message and it never asked a question). The next
 * process reads it back from the store, so a restart neither re-states an old answer nor loses a
 * pending ask, and a withdrawn ask is never re-stated. A re-ask before the answer keeps one
 * `pending` entry (its askId is stable) and bumps `revision`.
 */
export type SessionAskEventLedger = {
  answered: string[];
  asking: string[];
  pending: Array<{ askId: string; messageId: string }>;
  /** AskIds withdrawn as mis-detections; stated once, never re-stated. */
  retracted: string[];
};

/** The digest key carrying {@link SessionAskEventLedger}; opaquely ignored by card readers. */
export const SESSION_ASK_EVENTS_DIGEST_KEY = 'askEvents';

/** Reads the ledger out of a stored digest, tolerating anything older or malformed. */
export function readSessionAskEventLedger(digest: unknown): SessionAskEventLedger {
  const empty: SessionAskEventLedger = { answered: [], asking: [], pending: [], retracted: [] };
  if (digest === null || typeof digest !== 'object' || Array.isArray(digest)) return empty;
  const raw = (digest as Record<string, unknown>)[SESSION_ASK_EVENTS_DIGEST_KEY];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const record = raw as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
  const pending: Array<{ askId: string; messageId: string }> = [];
  if (Array.isArray(record.pending)) {
    for (const entry of record.pending) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const item = entry as Record<string, unknown>;
      if (typeof item.askId === 'string' && item.askId !== '' && typeof item.messageId === 'string') {
        pending.push({ askId: item.askId, messageId: item.messageId });
      }
    }
  }
  return {
    answered: strings(record.answered),
    asking: strings(record.asking),
    pending,
    retracted: strings(record.retracted),
  };
}

/**
 * The pending entries that are still genuinely open: neither answered nor withdrawn.
 *
 * This is the ONLY candidate set a backfill may look at. A transcript with dozens of old
 * answered rounds must state nothing for them; the ledger, not the transcript, is the gate.
 */
export function unfinishedAskEntries(
  ledger: SessionAskEventLedger,
): Array<{ askId: string; messageId: string }> {
  return ledger.pending.filter(
    (entry) => ledger.answered.includes(entry.askId) === false && ledger.retracted.includes(entry.askId) === false,
  );
}

/** Whether one askId is already settled — answered or withdrawn — and must never be restated. */
export function isAskResolved(ledger: SessionAskEventLedger, askId: string): boolean {
  return ledger.answered.includes(askId) || ledger.retracted.includes(askId);
}

/**
 * Withdraws one ask from the ledger: remembers the askId and removes it from both open sets.
 *
 * Idempotent (`ledger.retracted` is the record); the caller states the event through its own
 * once-per-process guard. A re-ask of the same askId is never recorded again.
 */
export function withdrawAskFromLedger(ledger: SessionAskEventLedger, askId: string): void {
  if (ledger.retracted.includes(askId) === false) ledger.retracted.push(askId);
  // Both the pending entry and every `<askId>:<revision>` asking key are withdrawn.
  ledger.asking = ledger.asking.filter((key) => key !== askId && key.startsWith(`${askId}:`) === false);
  ledger.pending = ledger.pending.filter((entry) => entry.askId !== askId);
}

/** Drops answered entries so the persisted "unfinished" set means exactly that. */
export function dropAnsweredPending(ledger: SessionAskEventLedger): void {
  ledger.pending = ledger.pending.filter((entry) => ledger.answered.includes(entry.askId) === false);
}

/** The digest fragment that carries `ledger` under the ask-events key. */
export function ledgerDigest(ledger: SessionAskEventLedger): Record<string, unknown> {
  return { [SESSION_ASK_EVENTS_DIGEST_KEY]: ledger };
}

/** Where one stated event points: the session, its project, and the ISO timestamp. */
export type SessionAskEventTarget = {
  sessionId: string;
  projectPath: string;
  at: string;
};

/** One ask the current turn states; `data` is the event payload the producer builds. */
export type RecordAskingInput = SessionAskEventTarget & {
  askId: string;
  messageId: string;
  revision: number;
  data: Record<string, unknown>;
};

/** One `session.answered` fact: the ask it settles and the message that is the answer. */
export type AnswerOnceInput = SessionAskEventTarget & {
  askId: string;
  messageId: string;
};

/** What the ledger owner needs from the world. */
export type SessionAskLedgerOwnerDeps = {
  /** The observation store the ledger-only revision is written through. */
  store: ObservationStore;
  /** The clock stamped onto a ledger-only revision. */
  now: () => number;
  /** The provenance name stamped onto a ledger-only revision. */
  producer: string;
  /** States one event once per process; answers whether it was actually written. */
  emitOnce: (key: string, event: SessionAskEvent) => boolean;
};

/** The one write path over the ask ledger. */
export type SessionAskLedgerOwner = {
  /** Reads the ledger out of a stored digest (or an empty one). */
  read(digest: unknown): SessionAskEventLedger;
  /** The pending entries still genuinely open. */
  unfinished(ledger: SessionAskEventLedger): Array<{ askId: string; messageId: string }>;
  /** Whether one askId is already answered or withdrawn. */
  isResolved(ledger: SessionAskEventLedger, askId: string): boolean;
  /**
   * Records this turn's ask in the ledger and answers the `session.asking` event to state
   * AFTER the object write. Answers `null` when the ledger already stated this revision (or
   * withdrew the ask), so a replay never double-writes.
   */
  recordAsking(ledger: SessionAskEventLedger, input: RecordAskingInput): { key: string; event: SessionAskEvent } | null;
  /** States one answer once per process and marks it answered; answers whether it was stated. */
  answerOnce(ledger: SessionAskEventLedger, input: AnswerOnceInput): boolean;
  /**
   * States `session.answered` for every pending entry the transcript now shows an answer for.
   * The ledger's pending set is the ONLY candidate set — see {@link unfinishedAskEntries}.
   * Answers how many rows were stated.
   */
  stateSettledPending(
    scan: SessionAskTranscriptScan,
    ledger: SessionAskEventLedger,
    event: SessionAskEventTarget,
  ): number;
  /** Drops answered entries so the persisted "unfinished" set means exactly that. */
  dropAnsweredPending(ledger: SessionAskEventLedger): void;
  /** The digest fragment carrying the ledger. */
  withLedger(ledger: SessionAskEventLedger): Record<string, unknown>;
  /** Persists the ledger without touching any other digest field. */
  persist(uri: string, previous: ObservedObject, ledger: SessionAskEventLedger): void;
};

/** Builds the ledger owner over its injected world. */
export function createSessionAskLedgerOwner(deps: SessionAskLedgerOwnerDeps): SessionAskLedgerOwner {
  const { store, now, producer, emitOnce } = deps;

  /**
   * Persists the ledger without touching any other digest field.
   *
   * This is the cross-process record: a restart between stating an answer and the next turn-end
   * must not state it again, and the "unfinished" set must survive so the startup sweep can find
   * it. A revision with no delta keeps the wall's "what changed" reading quiet.
   */
  const persist = (uri: string, previous: ObservedObject, ledger: SessionAskEventLedger): void => {
    store.writeRevision({
      uri,
      kind: 'session',
      title: previous.title,
      status: previous.status,
      digest: { ...previous.digest, ...ledgerDigest(ledger) },
      deltaItems: [],
      provenance: {
        producer,
        tier: 'deterministic',
        evaluatedAt: now(),
      },
    });
  };

  const answerOnce = (ledger: SessionAskEventLedger, input: AnswerOnceInput): boolean => {
    const stated = emitOnce(`answered:${input.askId}`, {
      kind: 'session.answered',
      session: input.sessionId,
      project: input.projectPath,
      at: input.at,
      data: { askId: input.askId, messageId: input.messageId },
    });
    if (stated === false) return false;
    if (ledger.answered.includes(input.askId) === false) ledger.answered.push(input.askId);
    return true;
  };

  const stateSettledPending = (
    scan: SessionAskTranscriptScan,
    ledger: SessionAskEventLedger,
    event: SessionAskEventTarget,
  ): number => {
    const pendingIds = new Set(ledger.pending.map((entry) => entry.askId));
    let stated = 0;
    for (const settled of scan.settled) {
      if (pendingIds.has(settled.askId) === false) continue;
      if (ledger.answered.includes(settled.askId)) continue;
      if (
        answerOnce(ledger, {
          askId: settled.askId,
          messageId: settled.answerMessageId,
          ...event,
        })
      ) {
        stated += 1;
      }
    }
    return stated;
  };

  const recordAsking = (
    ledger: SessionAskEventLedger,
    input: RecordAskingInput,
  ): { key: string; event: SessionAskEvent } | null => {
    if (ledger.retracted.includes(input.askId)) return null;
    const askingKey = `${input.askId}:${input.revision}`;
    const newlyStated = ledger.asking.includes(askingKey) === false;
    if (newlyStated) ledger.asking.push(askingKey);
    if (ledger.answered.includes(input.askId) === false && ledger.pending.some((entry) => entry.askId === input.askId) === false) {
      ledger.pending.push({ askId: input.askId, messageId: input.messageId });
    }
    if (newlyStated === false) return null;
    return {
      key: `asking:${askingKey}`,
      event: {
        kind: 'session.asking',
        session: input.sessionId,
        project: input.projectPath,
        at: input.at,
        refs: [input.messageId],
        data: input.data,
      },
    };
  };

  return {
    read: readSessionAskEventLedger,
    unfinished: unfinishedAskEntries,
    isResolved: isAskResolved,
    recordAsking,
    answerOnce,
    stateSettledPending,
    dropAnsweredPending,
    withLedger: ledgerDigest,
    persist,
  };
}
