/**
 * The retraction verdicts and withdrawals for session asks.
 *
 * Extracted from `session-digest.producer.ts` when the retraction arm pushed that file past the
 * architecture ratchet's 800-line ceiling. What lives here is exactly the part that decides what
 * to WITHDRAW — the verdict (`readSessionAsk`'s mechanical prefilter plus the T1 summary's
 * `isAsking`), the ledger bookkeeping around one withdrawal, and the three walks that apply the
 * verdict (turn end, user turn, startup sweep). The ledger state it mutates is owned by
 * `session-ask-ledger.ts`; the startup sweep itself belongs to `session-ask-recovery.ts`.
 *
 * The producer still owns the event seam (`emitOnce`) and injects it; nothing here touches the
 * store directly.
 *
 * Consumers: `session-digest.producer.ts` (the three walks) and the criteria
 * `tests/session-digest.test.ts` / `tests/session-ask-decision-digest.test.ts` (indirectly,
 * through the producer's re-exports).
 */
import { SESSION_ASK_RETRACTED_KIND } from '@/modules/context-events/index.js';
import type { OpenSessionAsk } from '@/modules/context-events/index.js';
import type { SessionAskDecisionReading, SessionAskEvent } from '@/shared/types.js';

import { readSessionAsk, type SessionAskDecisionDigest } from './session-ask-decision-digest.js';
import {
  readSessionAskEventLedger,
  withdrawAskFromLedger,
  type SessionAskEventLedger,
} from './session-ask-ledger.js';

/** The closure seams the retraction walks need from the producer. */
export type SessionAskRetractionDeps = {
  /** The T1 ask decision digest; absent means a candidate can never be withdrawn. */
  summarizeAsk?: SessionAskDecisionDigest;
  /** States one event once per process; answers whether it was actually written. */
  emitOnce: (key: string, event: SessionAskEvent) => boolean;
  /** The asks the stream still shows open; absent means the stream-only arm is skipped. */
  readOpenSessionAsks?: () => Promise<readonly OpenSessionAsk[]>;
};

/** The retraction walks, bound to the producer's seams. */
export type SessionAskRetraction = {
  /** The `asking`/`not-asking`/`unreadable` verdict for one NAMED asking message. */
  askVerdict(
    raw: string | null,
    sessionId: string,
    sessionTitle: string,
    messageId: string,
  ): Promise<'asking' | 'not-asking' | 'unreadable'>;
  /** Withdraws one ask once; answers whether a retraction row was newly written. */
  retractOnce(input: {
    askId: string;
    messageId: string;
    sessionId: string;
    projectPath: string;
    at: string;
    ledger: SessionAskEventLedger;
  }): boolean;
  /** Withdraws every entry whose named message reads as a statement; answers how many. */
  retractMisStated(
    entries: ReadonlyArray<{ askId: string; messageId: string }>,
    raw: string | null,
    sessionId: string,
    sessionTitle: string,
    ledger: SessionAskEventLedger,
    event: { projectPath: string; at: string },
  ): Promise<number>;
  /** Replays the ledger's unfinished asks against the transcript; answers how many were withdrawn. */
  replayRetractions(
    raw: string | null,
    sessionId: string,
    sessionTitle: string,
    ledger: SessionAskEventLedger,
    event: { projectPath: string; at: string },
  ): Promise<number>;
  /** Answers the stream's open asks for a session that holds NO observation object. */
  stateStreamOnlyAnswers(
    sessionId: string,
    sessionTitle: string,
    projectPath: string,
    raw: string | null,
    at: string,
    answerMessageId: string,
  ): Promise<number>;
};

/** Builds the retraction walks over the producer's seams. */
export function createSessionAskRetraction(deps: SessionAskRetractionDeps): SessionAskRetraction {
  const { summarizeAsk, emitOnce, readOpenSessionAsks } = deps;

  /**
   * The retraction verdict for one NAMED asking message.
   *
   * It is the FULL-TEXT mechanical prefilter plus the T1 semantic verdict — never a position
   * heuristic (a decision in a middle paragraph with a caveat as the last paragraph must still
   * read as asking; the live 62d case). `readSessionAsk` locates the named message and answers
   * the prefilter candidate: when it is no candidate at all (`current === null`) the message
   * carries no ask marker and reads `not-asking` without a model call. A candidate is then handed
   * to the summary; its `isAsking === false` is the definitive non-ask (a long review containing
   * a numbered list — the 5b/fea61b arm). An unreadable transcript, a summary that is absent, or
   * a summary that fails answer `unreadable`/`asking`: a withdrawal is a verdict and is never
   * made without evidence.
   */
  const askVerdict = async (
    raw: string | null,
    sessionId: string,
    sessionTitle: string,
    messageId: string,
  ): Promise<'asking' | 'not-asking' | 'unreadable'> => {
    if (raw === null || messageId === '') return 'unreadable';
    const reading = readSessionAsk(raw, sessionId, messageId);
    if (!reading.namedMessageFound) return 'unreadable';
    const candidate = reading.current;
    if (candidate === null) return 'not-asking';
    if (summarizeAsk === undefined) return 'asking';
    try {
      const verdict = await summarizeAsk.summarize({
        sessionId,
        sessionTitle,
        askId: candidate.askId,
        revision: candidate.revision,
        assistantText: candidate.assistantText,
        context: reading.context,
      });
      return verdict.isAsking === false ? 'not-asking' : 'asking';
    } catch {
      return 'unreadable';
    }
  };

  /**
   * Withdraws one ask: states `session.asking.retracted` once and removes the ask from the
   * ledger's open sets. Idempotent across restarts (`ledger.retracted`) and within one process
   * (`emitOnce`). Answers whether the event was newly written to the stream.
   */
  const retractOnce = (input: {
    askId: string;
    messageId: string;
    sessionId: string;
    projectPath: string;
    at: string;
    ledger: SessionAskEventLedger;
  }): boolean => {
    const { askId, messageId, ledger } = input;
    if (ledger.retracted.includes(askId)) return false;
    const stated = emitOnce(`retracted:${askId}`, {
      kind: SESSION_ASK_RETRACTED_KIND,
      session: input.sessionId,
      project: input.projectPath,
      at: input.at,
      data: { askId, messageId },
    });
    withdrawAskFromLedger(ledger, askId);
    return stated;
  };

  /**
   * Withdraws every ask in `entries` whose named message reads as a statement.
   *
   * Shared by the three walks (turn end, user turn, startup sweep) so one verdict decides all
   * three. Real questions, unreadable transcripts and asks the ledger already answered or
   * withdrew are left exactly as they were. Returns how many asks were newly withdrawn.
   */
  const retractMisStated = async (
    entries: ReadonlyArray<{ askId: string; messageId: string }>,
    raw: string | null,
    sessionId: string,
    sessionTitle: string,
    ledger: SessionAskEventLedger,
    event: { projectPath: string; at: string },
  ): Promise<number> => {
    let retracted = 0;
    for (const entry of [...entries]) {
      if (ledger.answered.includes(entry.askId)) continue;
      if (ledger.retracted.includes(entry.askId)) continue;
      if ((await askVerdict(raw, sessionId, sessionTitle, entry.messageId)) !== 'not-asking') continue;
      if (retractOnce({ ...entry, sessionId, ...event, ledger })) retracted += 1;
    }
    return retracted;
  };

  /**
   * Replays the ledger's unfinished asks against the transcript with the CURRENT verdict.
   *
   * The ledger (and the shared stream) was written by an older detector; correcting the detector
   * does not retract what it already stated. This walk is that retraction: every still-unfinished
   * ask whose named message is readable and reads as a statement is withdrawn. Real questions and
   * unreadable transcripts are left exactly as they were.
   *
   * Returns how many asks were newly withdrawn.
   */
  const replayRetractions = (
    raw: string | null,
    sessionId: string,
    sessionTitle: string,
    ledger: SessionAskEventLedger,
    event: { projectPath: string; at: string },
  ): Promise<number> => retractMisStated(ledger.pending, raw, sessionId, sessionTitle, ledger, event);

  /**
   * Answers the stream's open asks for a session that holds NO observation object.
   *
   * The ledger lives inside the digest, so such a session has no persisted record of its open ask
   * at all — its `session.asking` row in the shared stream is the only evidence it ever asked,
   * and the old `previous === null ⇒ return` in the producer's user-turn handler dropped exactly
   * that answer on the floor. A send answers every ask the stream still shows open for this
   * session; a mis-stated one is withdrawn instead, by the same verdict as everywhere else.
   *
   * Nothing is persisted: there is no revision to persist into. The stream's own rows are the
   * cross-process dedup — an `session.answered`/`session.asking.retracted` row closes the ask for
   * `readOpenSessionAsks`, so the next process does not see it as open.
   */
  const stateStreamOnlyAnswers = async (
    sessionId: string,
    sessionTitle: string,
    projectPath: string,
    raw: string | null,
    at: string,
    answerMessageId: string,
  ): Promise<number> => {
    if (readOpenSessionAsks === undefined) return 0;
    let open: readonly OpenSessionAsk[] = [];
    try {
      open = await readOpenSessionAsks();
    } catch {
      return 0;
    }
    const own = open.filter((ask) => ask.sessionId === sessionId);
    if (own.length === 0) return 0;

    // A scratch ledger: `retractOnce` records into it, so the answer loop below can skip an ask
    // this same call just withdrew without reading the stream twice.
    const scratch = readSessionAskEventLedger(null);
    await retractMisStated(own, raw, sessionId, sessionTitle, scratch, { projectPath, at });

    let stated = 0;
    for (const ask of own) {
      if (scratch.retracted.includes(ask.askId)) continue;
      if (
        emitOnce(`answered:${ask.askId}`, {
          kind: 'session.answered',
          session: sessionId,
          project: projectPath,
          at,
          data: { askId: ask.askId, messageId: answerMessageId },
        })
      ) {
        stated += 1;
      }
    }
    return stated;
  };

  return { askVerdict, retractOnce, retractMisStated, replayRetractions, stateStreamOnlyAnswers };
}
