/**
 * The retraction walks and the boot-time backfill for session asks.
 *
 * Extracted from `session-digest.producer.ts` when the retraction arm pushed that file past the
 * architecture ratchet's 800-line ceiling. What lives here is exactly the part that decides what
 * to WITHDRAW and what to ANSWER — the verdict (`readSessionAsk`'s mechanical prefilter plus the
 * T1 summary's `isAsking`), the ledger bookkeeping around one withdrawal, the three walks that
 * apply the verdict (turn end, user turn, startup sweep), and the sweep itself.
 *
 * The producer still owns the write path and injects its closure seams (`emitOnce`,
 * `persistLedger`, the ledger reader's settle/answer helper); nothing here touches the store
 * directly except the sweep, which receives it.
 *
 * Consumers: `session-digest.producer.ts` (all four walks) and the criteria
 * `tests/session-digest.test.ts` / `tests/session-ask-decision-digest.test.ts` (indirectly,
 * through the producer's re-exports).
 */
import { SESSION_ASK_RETRACTED_KIND } from '@/modules/context-events/index.js';
import type { OpenSessionAsk } from '@/modules/context-events/index.js';
import type { SessionAskDecisionReading, SessionAskEvent } from '@/shared/types.js';

import { formatSessionUri } from './observation-uri.js';
import type { ObservedObject, ObservationStore } from './observation-store.js';
import { readSessionAsk, readSessionAsks, type SessionAskDecisionDigest } from './session-ask-decision-digest.js';

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
    ledger.retracted.push(askId);
    // Both the pending entry and every `<askId>:<revision>` asking key are withdrawn.
    ledger.asking = ledger.asking.filter((key) => key !== askId && key.startsWith(`${askId}:`) === false);
    ledger.pending = ledger.pending.filter((entry) => entry.askId !== askId);
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

/** The boot-time sweep's pause between sessions: enough to keep a large DB from a hot loop. */
const DEFAULT_SWEEP_DELAY_MS = 25;

/** Waits `ms`; `0` resolves on the next tick so a test sweep still yields. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Everything the sweep needs; the producer supplies its own closure seams. */
export type SessionAskSweepDeps = {
  store: ObservationStore;
  resolveSession: (appSessionId: string) => { title: string; projectPath: string; jsonlPath: string | null } | null;
  readTranscript: (jsonlPath: string) => Promise<string | null>;
  listObservedSessionIds: () => string[];
  readOpenSessionAsks?: () => Promise<readonly OpenSessionAsk[]>;
  retraction: SessionAskRetraction;
  /** States one event once per process; answers whether it was actually written. */
  emitOnce: (key: string, event: SessionAskEvent) => boolean;
  /** Persists the ledger without touching any other digest field. */
  persistLedger: (uri: string, previous: ObservedObject, ledger: SessionAskEventLedger) => void;
  /** States `session.answered` for the ledger's unfinished entries the transcript settled. */
  stateSettledPending: (
    scan: ReturnType<typeof readSessionAsks>,
    ledger: SessionAskEventLedger,
    pendingIds: Set<string>,
    event: { sessionId: string; projectPath: string; at: string },
  ) => number;
  /** Drops answer-resolved pending entries so the persisted "unfinished" set means exactly that. */
  dropAnsweredPending: (ledger: SessionAskEventLedger) => void;
  now: () => number;
  log: (message: string) => void;
  sweepDelayMs?: number;
};

/**
 * One pass over the observation DB's sessions: for each ledger that still names an unfinished
 * ask, state `session.answered` when the transcript shows a later user message, and withdraw the
 * asks an older detector mis-stated. Rate-limited, never rejects, and answers/logs how many
 * sessions it inspected and how many answers/retractions it stated.
 */
export async function runAskSweep(deps: SessionAskSweepDeps): Promise<SessionAskSweepSummary> {
  const {
    store,
    resolveSession,
    readTranscript,
    listObservedSessionIds,
    readOpenSessionAsks,
    retraction,
    emitOnce,
    persistLedger,
    stateSettledPending,
    dropAnsweredPending,
    now,
    log,
  } = deps;
  const sweepDelayMs = deps.sweepDelayMs ?? DEFAULT_SWEEP_DELAY_MS;
  const summary: SessionAskSweepSummary = { sessions: 0, answered: 0, rebuilt: 0 };

  // THE STREAM IS THE ASK'S OWN RECORD. A session whose asking row was stated while its digest
  // revision was never written (the T1 summary was in flight, or the ask predates the ledger) has
  // no `pending` entry in the store at all, so the transcript pass below would never look at it.
  // Rebuild those entries first, keyed by the session the stream names, and only for sessions
  // this host already observes (the rebuild enriches a ledger, it does not invent session objects).
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
      const ledger = readSessionAskEventLedger(previous?.digest);
      const streamAsks = openBySession.get(sessionId) ?? [];

      // A ledger is REBUILT, never invented: the rebuild only enriches a session this host
      // already holds an object for, so a session with no object keeps its record in the stream
      // (see the `previous === null` arm below).
      let rebuiltHere = 0;
      if (previous !== null) {
        for (const ask of streamAsks) {
          if (ledger.answered.includes(ask.askId) || ledger.retracted.includes(ask.askId)) continue;
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
      for (const entry of ledger.pending) {
        if (ledger.answered.includes(entry.askId) || ledger.retracted.includes(entry.askId)) continue;
        candidates.set(entry.askId, entry);
      }
      for (const ask of streamAsks) {
        if (ledger.answered.includes(ask.askId) || ledger.retracted.includes(ask.askId)) continue;
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
        if (rebuiltHere > 0 && previous !== null) persistLedger(uri, previous, ledger);
        continue;
      }
      const raw = resolved.jsonlPath === null ? null : await readTranscript(resolved.jsonlPath);
      if (raw === null) {
        if (rebuiltHere > 0 && previous !== null) persistLedger(uri, previous, ledger);
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
        const pendingIds = new Set(ledger.pending.map((entry) => entry.askId));
        stated = stateSettledPending(scan, ledger, pendingIds, {
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
            emitOnce(`answered:${ask.askId}`, {
              kind: 'session.answered',
              session: sessionId,
              project: resolved.projectPath,
              at,
              data: { askId: ask.askId, messageId: settled.answerMessageId },
            })
          ) {
            stated += 1;
          }
        }
      }

      if (previous !== null) {
        if (stated === 0 && rebuiltHere === 0 && retracted === 0) continue;
        dropAnsweredPending(ledger);
        persistLedger(uri, previous, ledger);
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
}
