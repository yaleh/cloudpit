/**
 * The ask recovery walks — the startup backfill and the user-turn answers.
 *
 * Extracted from `session-ask-retraction.ts` (gap-observation-ask-ledger-owner). What lives here
 * is the part that RECOVERS the ledger's open asks: one boot-time pass over every session the
 * observation DB holds (plus every session the shared stream still shows an open ask for), and
 * the per-send walk that turns the user's message into `session.answered` rows.
 *
 * The ledger state and its write path belong to `session-ask-ledger.ts`; the verdicts and
 * withdrawals belong to `session-ask-retraction.ts`. This module composes the two and never
 * reads or writes the store directly except through the ledger owner's `persist`.
 *
 * Consumers: `server/modules/observation/session-digest/session-digest.producer.ts` (both walks) and the
 * criterion `tests/session-ask-recovery.test.ts`.
 */
import type { OpenSessionAsk } from '@/modules/context-events/index.js';

import { readSessionAsks } from './session-ask-decision-digest.js';
import {
  formatSessionUri,
  type ObservationStore,
} from '../core/index.js';
import type { SessionAskEventLedger, SessionAskLedgerOwner } from './session-ask-ledger.js';
import type { SessionAskRetraction } from './session-ask-retraction.js';

/** What one startup sweep did: sessions that still named an unfinished ask, and answers stated. */
export type SessionAskSweepSummary = {
  /** Sessions whose ledger still carried at least one unfinished ask when the sweep reached them. */
  sessions: number;
  /** `session.answered` rows this pass stated. */
  answered: number;
  /**
   * AskIds the event stream named as still open and that the persisted ledger did not carry.
   * These are the asks whose digest revision was never written — the rebuild's own reading.
   */
  rebuilt: number;
};

/** Everything the two recovery walks need; the producer supplies its own closure seams. */
export type SessionAskRecoveryDeps = {
  store: ObservationStore;
  resolveSession: (appSessionId: string) => { title: string; projectPath: string; jsonlPath: string | null } | null;
  readTranscript: (jsonlPath: string) => Promise<string | null>;
  listObservedSessionIds: () => string[];
  readOpenSessionAsks?: () => Promise<readonly OpenSessionAsk[]>;
  retraction: SessionAskRetraction;
  ledger: SessionAskLedgerOwner;
  now: () => number;
  log: (message: string) => void;
  sweepDelayMs?: number;
};

/** One user turn as the recovery walk sees it: the send is the answer's fact. */
export type SessionAskUserTurn = {
  /** The transcript used ONLY to judge the old asking message, never to learn the answer. */
  raw: string | null;
  sessionId: string;
  sessionTitle: string;
  projectPath: string;
  at: string;
  /** The send's message id; the empty string when the adapter does not know one. */
  answerMessageId: string;
  ledger: SessionAskEventLedger;
};

/** What one user turn did to the ledger. */
export type SessionAskUserTurnOutcome = {
  /** Mis-stated asks withdrawn by the replay. */
  retracted: number;
  /** `session.answered` rows stated. */
  stated: number;
};

/** The two recovery walks, bound to the producer's seams. */
export type SessionAskRecovery = {
  /**
   * One pass over the observation DB's sessions: for each ledger that still names an unfinished
   * ask, state `session.answered` when the transcript shows a later user message, and withdraw
   * the asks an older detector mis-stated. Rate-limited, never rejects.
   */
  sweepOpenAsks(): Promise<SessionAskSweepSummary>;
  /**
   * Applies one user send to the ledger: replays the retraction verdict over the unfinished
   * asks, then states `session.answered` for every ask still open. The caller persists the
   * ledger; this walk only states events and marks the ledger.
   */
  stateUserTurnAnswers(input: SessionAskUserTurn): Promise<SessionAskUserTurnOutcome>;
};

/** The boot-time sweep's pause between sessions: enough to keep a large DB from a hot loop. */
const DEFAULT_SWEEP_DELAY_MS = 25;

/** Waits `ms`; `0` resolves on the next tick so a test sweep still yields. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Builds the recovery walks over the ledger owner and the retraction verdicts. */
export function createSessionAskRecovery(deps: SessionAskRecoveryDeps): SessionAskRecovery {
  const {
    store,
    resolveSession,
    readTranscript,
    listObservedSessionIds,
    readOpenSessionAsks,
    retraction,
    ledger: ledgerOwner,
    now,
    log,
  } = deps;
  const sweepDelayMs = deps.sweepDelayMs ?? DEFAULT_SWEEP_DELAY_MS;

  /**
   * Answers every still-unfinished ask in ONE ledger, after withdrawing the mis-stated ones.
   *
   * Shared by the user turn (the send is the fact) and the startup sweep (the transcript's
   * settled set is the fact). Answers how many rows were stated.
   */
  const answerUnfinished = (
    ledger: SessionAskEventLedger,
    event: { sessionId: string; projectPath: string; at: string; answerMessageId: string },
  ): number => {
    let stated = 0;
    for (const entry of ledgerOwner.unfinished(ledger)) {
      if (
        ledgerOwner.answerOnce(ledger, {
          askId: entry.askId,
          messageId: event.answerMessageId,
          sessionId: event.sessionId,
          projectPath: event.projectPath,
          at: event.at,
        })
      ) {
        stated += 1;
      }
    }
    return stated;
  };

  const stateUserTurnAnswers = async (input: SessionAskUserTurn): Promise<SessionAskUserTurnOutcome> => {
    // No unfinished ask: nothing to replay and nothing to answer. Checked before the verdicts
    // so a quiet send never pays for a model call.
    if (ledgerOwner.unfinished(input.ledger).length === 0) return { retracted: 0, stated: 0 };

    // THE SEND IS THE ANSWER'S FACT. The transcript is read ONLY to judge the OLD asking
    // message — a statement mis-read as a question must be withdrawn, never answered.
    const retracted = await retraction.replayRetractions(
      input.raw,
      input.sessionId,
      input.sessionTitle,
      input.ledger,
      { projectPath: input.projectPath, at: input.at },
    );
    const stated = answerUnfinished(input.ledger, {
      sessionId: input.sessionId,
      projectPath: input.projectPath,
      at: input.at,
      answerMessageId: input.answerMessageId,
    });
    return { retracted, stated };
  };

  const sweepOpenAsks = async (): Promise<SessionAskSweepSummary> => {
    const summary: SessionAskSweepSummary = { sessions: 0, answered: 0, rebuilt: 0 };

    // THE STREAM IS THE ASK'S OWN RECORD. A session whose asking row was stated while its digest
    // revision was never written (the T1 summary was in flight, or the ask predates the ledger)
    // has no `pending` entry in the store at all, so the transcript pass below would never look
    // at it. Rebuild those entries first, keyed by the session the stream names, and only for
    // sessions this host already observes (the rebuild enriches a ledger, it does not invent
    // session objects).
    const openBySession = new Map<string, OpenSessionAsk[]>();
    if (readOpenSessionAsks !== undefined) {
      let open: readonly OpenSessionAsk[] = [];
      try {
        open = await readOpenSessionAsks();
      } catch {
        // An unreadable stream must not keep the transcript backfill from running.
        open = [];
      }
      for (const ask of open) {
        const list = openBySession.get(ask.sessionId);
        if (list === undefined) openBySession.set(ask.sessionId, [ask]);
        else list.push(ask);
      }
    }

    let observedSessionIds: string[];
    try {
      observedSessionIds = listObservedSessionIds();
    } catch {
      return summary;
    }

    // The stream can also name a session this host holds NO object for: its digest revision never
    // landed, so `listObservedSessionIds` cannot see it, yet its asking row was stated. Those
    // sessions are swept too — the answer must not depend on a write that never happened.
    const sessionIds = [...observedSessionIds];
    for (const sessionId of openBySession.keys()) {
      if (sessionIds.includes(sessionId) === false) sessionIds.push(sessionId);
    }

    let retractedTotal = 0;
    for (const sessionId of sessionIds) {
      try {
        const uri = formatSessionUri(sessionId);
        const previous = store.getObject(uri);
        const ledger = ledgerOwner.read(previous?.digest);
        const streamAsks = openBySession.get(sessionId) ?? [];

        // A ledger is REBUILT, never invented: the rebuild only enriches a session this host
        // already holds an object for, so a session with no object keeps its record in the stream
        // (see the `previous === null` arm below).
        let rebuiltHere = 0;
        if (previous !== null) {
          for (const ask of streamAsks) {
            if (ledgerOwner.isResolved(ledger, ask.askId)) continue;
            const askingKey = `${ask.askId}:${ask.revision}`;
            if (ledger.asking.includes(askingKey) === false) {
              ledger.asking.push(askingKey);
              rebuiltHere += 1;
            }
            if (ledger.pending.some((entry) => entry.askId === ask.askId) === false) {
              ledger.pending.push({ askId: ask.askId, messageId: ask.messageId });
            }
          }
        }

        // The candidates are the ledger's unfinished asks PLUS every ask the stream still shows
        // open. An ask the ledger already resolved or withdrew is not a candidate, which is what
        // keeps a static stream snapshot from re-counting an answered session on a second pass.
        const candidates = new Map<string, { askId: string; messageId: string }>();
        for (const entry of ledgerOwner.unfinished(ledger)) {
          candidates.set(entry.askId, entry);
        }
        for (const ask of streamAsks) {
          if (ledgerOwner.isResolved(ledger, ask.askId)) continue;
          if (candidates.has(ask.askId) === false) {
            candidates.set(ask.askId, { askId: ask.askId, messageId: ask.messageId });
          }
        }

        // Only a session that still names an unfinished ask is swept; a quiet session with a long
        // resolved history costs nothing.
        if (candidates.size === 0) continue;
        summary.sessions += 1;
        summary.rebuilt += rebuiltHere;

        const resolved = resolveSession(sessionId);
        if (resolved === null) {
          if (rebuiltHere > 0 && previous !== null) ledgerOwner.persist(uri, previous, ledger);
          continue;
        }
        const raw = resolved.jsonlPath === null ? null : await readTranscript(resolved.jsonlPath);
        if (raw === null) {
          if (rebuiltHere > 0 && previous !== null) ledgerOwner.persist(uri, previous, ledger);
          continue;
        }

        const at = new Date(now()).toISOString();

        // 1. Withdraw the mis-stated candidates. This is the startup leniency: the asks an old
        //    detector stated before the correction shipped are retracted here, not re-answered.
        const retracted = await retraction.retractMisStated(
          [...candidates.values()],
          raw,
          sessionId,
          resolved.title,
          ledger,
          { projectPath: resolved.projectPath, at },
        );
        retractedTotal += retracted;

        // 2. Answer the settled ones.
        const scan = readSessionAsks(raw, sessionId);
        let stated = 0;
        if (previous !== null) {
          stated = ledgerOwner.stateSettledPending(scan, ledger, {
            sessionId,
            projectPath: resolved.projectPath,
            at,
          });
        } else {
          // No object, no ledger: the stream's asks are answered from the transcript's own settled
          // set, once (the emit dedup is in-process; after a restart the stream's own
          // `session.answered` row closes the ask so it is no longer open at all).
          for (const ask of streamAsks) {
            if (ledger.retracted.includes(ask.askId)) continue;
            const settled = scan.settled.find((entry) => entry.askId === ask.askId);
            if (settled === undefined) continue;
            if (
              ledgerOwner.answerOnce(ledger, {
                askId: ask.askId,
                messageId: settled.answerMessageId,
                sessionId,
                projectPath: resolved.projectPath,
                at,
              })
            ) {
              stated += 1;
            }
          }
        }

        if (previous !== null) {
          if (stated === 0 && rebuiltHere === 0 && retracted === 0) continue;
          ledgerOwner.dropAnsweredPending(ledger);
          ledgerOwner.persist(uri, previous, ledger);
        }
        summary.answered += stated;
      } catch {
        // One unreadable session never aborts the boot-time pass.
      }
      if (sweepDelayMs > 0) await sleep(sweepDelayMs);
    }

    // The count is the DoD's reading: how many old askIds the stream rebuilt into the ledger, how
    // many sessions still had an open ask, how many answers this pass stated, and how many
    // mis-stated asks it withdrew.
    log(
      `[observation.sessionDigest] 启动补扫: 从事件流补进 ${summary.rebuilt} 个旧 askId，检查 ${summary.sessions} 个有未结束提问的会话，补发 ${summary.answered} 条 session.answered，撤回 ${retractedTotal} 条误发提问`,
    );
    return summary;
  };

  return { sweepOpenAsks, stateUserTurnAnswers };
}
