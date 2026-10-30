/**
 * The session-digest producer — turns one finished chat turn into one observation revision.
 *
 * It hangs off the run registry's terminal `complete` event (the same point the cockpit uses to
 * stop showing "Working…"). For the session that just finished it reads that session's own
 * transcript, builds the deterministic digest in `session-digest.ts`, and writes ONE revision
 * through the observation store.
 *
 * WHICH SESSIONS IT WRITES FOR. The wall only shows what someone is watching or what needs a
 * person, so the producer writes only for a session that is on somebody's watch list or whose
 * reading is `attention` (the turn ends by asking you) or `red` (the run failed). An idle
 * unwatched turn is not written at all — that is what keeps the observation layer smaller than
 * the sessions it observes.
 *
 * AN OBSERVATION FAILURE MUST NEVER BREAK A CHAT TURN. `handleTurnEnd` catches everything and
 * answers `null`; the registry calls it fire-and-forget from its terminal-event path.
 *
 * Consumers: `server/modules/websocket/services/chat-run-registry.service.ts` (calls it on every
 * terminal run event) and `server/modules/observation/tests/session-digest.test.ts`.
 */
import { readFile } from 'node:fs/promises';

import { readOpenSessionAsks } from '@/modules/context-events/index.js';
import type { OpenSessionAsk } from '@/modules/context-events/index.js';
import { observationDb, sessionsDb } from '@/modules/database/index.js';
import type { ISessionAskEventWriter } from '@/shared/interfaces.js';
import { readSessionAskEventWriterPort } from '@/shared/ports/session-ask-events.port.js';
import type { SessionUserTurnEvent } from '@/shared/ports/session-user-turn.port.js';
import type { SessionAskDecisionReading, SessionAskEvent } from '@/shared/types.js';

import { formatSessionUri, parseObservationUri } from './observation-uri.js';
import { createObservationStore, type ObservedObject, type ObservationStore } from './observation-store.js';
import { createSessionAskLedgerOwner } from './session-ask-ledger.js';
import { createSessionAskRecovery, type SessionAskSweepSummary } from './session-ask-recovery.js';
import { createSessionAskRetraction } from './session-ask-retraction.js';
import {
  carryAskDecisionHistory,
  createSessionAskDecisionDigest,
  readSessionAsk,
  readSessionAsks,
  rememberAskDecision,
  type SessionAskDecisionDigest,
} from './session-ask-decision-digest.js';
import { buildSessionDigest, type SessionDigest } from './session-digest.js';

export { readSessionAskEventLedger, SESSION_ASK_EVENTS_DIGEST_KEY } from './session-ask-ledger.js';
export type { SessionAskEventLedger } from './session-ask-ledger.js';
export type { SessionAskSweepSummary } from './session-ask-recovery.js';

/** The producer name every digest revision is stamped with. */
export const SESSION_DIGEST_PRODUCER = 'session-digest';

/**
 * One terminal run event, as the registry reports it.
 *
 * `error` is the last error frame the run forwarded, or `null` when it forwarded none — the
 * transcript alone cannot tell a failed turn from a quiet one.
 */
export type SessionTurnEndEvent = {
  appSessionId: string;
  runId: string;
  status: 'completed' | 'aborted';
  completedAt: number;
  error: string | null;
};

/** What the producer needs from the world; production supplies all of it by default. */
export type SessionDigestProducerDeps = {
  /** The observation store the revision is written through. */
  store: ObservationStore;
  /** Resolves a session's display title, project and transcript path. Defaults to `sessionsDb`. */
  resolveSession?: (appSessionId: string) => { title: string; projectPath: string; jsonlPath: string | null } | null;
  /**
   * The T1 ask decision digest. Absent means this build attaches no `askDecision` — the criterion
   * injects a summariser with a stub completion, and a deployment without the tier leaves it out.
   */
  summarizeAsk?: SessionAskDecisionDigest;
  /**
   * The `session.asking`/`session.answered` seam. Absent until quay-fleet's stream schema carries
   * those two kinds (待外部); criteria inject an in-memory writer.
   */
  eventWriter?: ISessionAskEventWriter;
  /** Reads a transcript file, answering `null` when it does not exist. Defaults to `fs.readFile`. */
  readTranscript?: (jsonlPath: string) => Promise<string | null>;
  /** Whether anyone pinned this object. Defaults to the observation watch entries. */
  isObserved?: (uri: string) => boolean;
  /**
   * The session ids a startup sweep may inspect. Defaults to every session object the observation
   * DB holds (`observationDb.listObjects()`), read once at sweep time.
   */
  listObservedSessionIds?: () => string[];
  /**
   * The asks this host stated and never answered, read back from the context-event stream.
   *
   * An absent seam means no rebuild: the sweep then sees only the ledger already persisted in
   * the observation DB. The process-wide sweeper supplies the stream reader; the criteria
   * supply their own (a unit test must never read the host's real stream).
   */
  readOpenSessionAsks?: () => Promise<readonly OpenSessionAsk[]>;
  /** How long the sweep pauses between sessions; a rate limit on a boot-time scan. Defaults to 25 ms. */
  sweepDelayMs?: number;
  /** Where the sweep states its counts. Defaults to `console.log`. */
  log?: (message: string) => void;
  /** The clock stamped onto the write. Defaults to `Date.now`. */
  now?: () => number;
};

/** The producer's one verb. */
export type SessionDigestProducer = {
  handleTurnEnd(event: SessionTurnEndEvent): Promise<ObservedObject | null>;
  /**
   * States `session.answered` for every ask the session's ledger still names as unfinished,
   * without waiting for the assistant's turn to end and without reading the transcript. The send
   * is the answer's fact; the port's message id is carried when the sender knows it. Fire-and-
   * forget: never rejects.
   */
  handleUserTurn(event: SessionUserTurnEvent): Promise<void>;
};

/** A producer that can also run the boot-time backfill over every session with an open ask. */
export type SessionAskSweepableProducer = SessionDigestProducer & {
  /**
   * One pass over the observation DB's sessions: for each ledger that still names an unfinished
   * ask, state `session.answered` when the transcript shows a later user message. Rate-limited,
   * never rejects, and answers/logs how many sessions it inspected and how many answers it
   * stated.
   */
  sweepOpenAsks(): Promise<SessionAskSweepSummary>;
};

/**
 * The `questionText` a `session.asking` row states, or `null` when there is no text to state.
 *
 * The value is the asking assistant message VERBATIM — the WHOLE message, never an excerpt — and
 * there is deliberately NO length cap. quay-fleet keys the ask by
 * `projectId|session-ask|<sessionId>:<sha1(normalised questionText)[:16]>`, i.e. over exactly the
 * text this producer writes, and the user requires that key to cover the STRICT full text
 * (2026-10-29: the earlier 4000-character tail cap was revoked). Do NOT reintroduce a cap —
 * truncating would collapse two questions that differ only outside the kept window into one key.
 *
 * The same askId + revision replayed must yield the same string, so this is a straight
 * pass-through with no normalisation: fleet folds whitespace/punctuation/case itself. A
 * whitespace-only message answers `null` so the field is OMITTED instead of written as `""`: an
 * empty hash would make every blank ask share one key, while an omitted field makes fleet fall
 * back to the old askId key.
 *
 * Consumers: {@link buildSessionAskingData} and the criterion
 * `tests/session-ask-decision-digest.test.ts` (which pins the omission and the no-truncation rule).
 */
export function sessionAskQuestionText(assistantText: string): string | null {
  if (assistantText.trim() === '') return null;
  return assistantText;
}

/**
 * Assembles the `data` payload of one `session.asking` row.
 *
 * `askId`, `messageId`, `revision` and `contentRef` are the pre-existing shape and stay
 * unchanged. `questionText` is the one added member: the asking message's FULL text (see
 * {@link sessionAskQuestionText} — untruncated), which fleet hashes into its
 * 「session + normalised question text」 dedup key and falls back to `askId` when it is absent.
 * `data` is an OPEN object by contract, so this member needs no new enum.
 *
 * Consumers: `handleTurnEnd` below (the only write path) and the criterion
 * `tests/session-ask-decision-digest.test.ts`.
 */
export function buildSessionAskingData(
  sessionId: string,
  current: { askId: string; messageId: string; revision: number; assistantText: string },
): Record<string, unknown> {
  const questionText = sessionAskQuestionText(current.assistantText);
  return {
    askId: current.askId,
    messageId: current.messageId,
    revision: current.revision,
    ...(questionText === null ? {} : { questionText }),
    contentRef: {
      resolver: 'cloudcli.session-ask',
      sessionId,
      messageId: current.messageId,
    },
  };
}

function defaultResolveSession(
  appSessionId: string,
): { title: string; projectPath: string; jsonlPath: string | null } | null {
  const row = sessionsDb.getSessionById(appSessionId);
  if (row === null) return null;
  return {
    title: (row.custom_name ?? '').trim() || appSessionId,
    projectPath: row.project_path ?? '',
    jsonlPath: row.jsonl_path ?? null,
  };
}

async function defaultReadTranscript(jsonlPath: string): Promise<string | null> {
  try {
    return await readFile(jsonlPath, 'utf8');
  } catch {
    return null;
  }
}

/**
 * The process-wide event writer, read through the port on every write.
 *
 * The producer is constructed at module load, before `server/index.ts` installs the fleet
 * adapter, so the writer cannot be captured. An uninstalled port writes nothing — the correct
 * reading for a process with no evidence stream.
 */
const portEventWriter: ISessionAskEventWriter = {
  write(event) {
    readSessionAskEventWriterPort()?.write(event);
  },
};

/** Every session object the observation DB currently holds, as app session ids. */
function defaultListObservedSessionIds(): string[] {
  const ids: string[] = [];
  for (const row of observationDb.listObjects()) {
    if (row.kind !== 'session') continue;
    const parsed = parseObservationUri(row.uri);
    if (parsed !== null && parsed.kind === 'session') ids.push(parsed.id);
  }
  return ids;
}

/** Builds the producer over its injected world. */
export function createSessionDigestProducer(deps: SessionDigestProducerDeps): SessionAskSweepableProducer {
  const store = deps.store;
  const resolveSession = deps.resolveSession ?? defaultResolveSession;
  const readTranscript = deps.readTranscript ?? defaultReadTranscript;
  const isObserved = deps.isObserved ?? ((uri: string) => observationDb.listWatchUserIds(uri).length > 0);
  const listObservedSessionIds = deps.listObservedSessionIds ?? defaultListObservedSessionIds;
  const readOpenAsksFromStream = deps.readOpenSessionAsks;
  const sweepDelayMs = deps.sweepDelayMs;
  const log = deps.log ?? ((message: string) => console.log(message));
  const now = deps.now ?? (() => Date.now());
  const summarizeAsk = deps.summarizeAsk;
  // The port bridge is the default so the process-wide sweep (built here, not by the LLM tier)
  // reaches the installed evidence stream without a second composition seam.
  const eventWriter = deps.eventWriter ?? portEventWriter;

  /**
   * The asks/answers already stated in this process, so a repeated turn-end does not re-emit.
   *
   * Keyed by askId (an answer) and askId+revision (an ask): a new turn has a new first-asking
   * message id, so its key differs and it is never suppressed by an older turn. In-process only;
   * the CROSS-process record is the digest's ask ledger ({@link SessionAskEventLedger}), which is
   * what survives a restart.
   */
  const emittedEvents = new Set<string>();
  /** States one event once per process; answers whether it was actually written. */
  const emitOnce = (key: string, event: SessionAskEvent): boolean => {
    if (emittedEvents.has(key)) return false;
    emittedEvents.add(key);
    try {
      // The chat path must not learn that the evidence stream failed.
      eventWriter.write(event);
    } catch {
      // A rejected event is the writer's reading to publish, not the turn's failure.
    }
    return true;
  };

  // THE ASK LEDGER AND THE RECOVERY WALKS LIVE IN THEIR OWN OWNERS. The producer composes
  // them with the event seam and the turn's writing order; it keeps no ledger write details.
  const askLedger = createSessionAskLedgerOwner({
    store,
    now,
    producer: SESSION_DIGEST_PRODUCER,
    emitOnce,
  });
  // The retraction walks (verdict, one withdrawal, the three replays) live in their own module:
  // the producer supplies the seams they state events through.
  const retraction = createSessionAskRetraction({
    summarizeAsk,
    emitOnce,
    readOpenSessionAsks: readOpenAsksFromStream,
  });
  const recovery = createSessionAskRecovery({
    store,
    resolveSession,
    readTranscript,
    listObservedSessionIds,
    readOpenSessionAsks: readOpenAsksFromStream,
    retraction,
    ledger: askLedger,
    now,
    log,
    sweepDelayMs,
  });
  /**
   * The delta the wall shows after this revision.
   *
   * Only facts that changed against the object's OWN previous revision are claimed: a first
   * write says "新增 N 轮" from zero, and 「测试 由绿转红」 appears only when the previous
   * reading was fully green and this one has a failure.
   */
  const deltaItemsFor = (uri: string, digest: SessionDigest | null): string[] => {
    const previous = store.getObject(uri)?.digest;
    const previousDigest = previous as Partial<SessionDigest> | undefined;
    const previousTurns = typeof previousDigest?.turnCount === 'number' ? previousDigest.turnCount : 0;
    const items: string[] = [];

    if (digest !== null) {
      const newTurns = Math.max(1, digest.turnCount - previousTurns);
      items.push(`新增 ${newTurns} 轮`);
      if (digest.changedFiles.length > 0) {
        items.push(`改动 ${digest.changedFiles.length} 个文件`);
      }
      const previousTests = previousDigest?.tests;
      if (
        previousTests?.state === 'evaluated' &&
        previousTests.failed === 0 &&
        digest.tests.state === 'evaluated' &&
        digest.tests.failed > 0
      ) {
        items.push('测试 由绿转红');
      }
    }

    return items;
  };

  return {
    async handleUserTurn(event) {
      try {
        const resolved = resolveSession(event.appSessionId);
        if (resolved === null) return;
        const uri = formatSessionUri(event.appSessionId);
        const at = new Date(now()).toISOString();
        // The send path knows no transcript id; an adapter that does supplies it. An absent id is
        // stated as the empty string rather than inventing one.
        const answerMessageId = event.messageId ?? '';

        // THE SEND IS THE ANSWER'S FACT. The transcript is read ONLY to judge the OLD asking
        // message — a statement mis-read as a question must be withdrawn, never answered — never
        // to learn the answer itself: the provider process has been told to append the user's
        // row, but that write is asynchronous and demonstrably lags the send (the live 07:10
        // answer was dropped for exactly this reason).
        const raw = resolved.jsonlPath === null ? null : await readTranscript(resolved.jsonlPath);

        const previous = store.getObject(uri);
        if (previous === null) {
          // No revision means no LEDGER — which is not the same as no ask. The asking row this
          // session stated lives in the shared stream, and the send answers it there. The
          // transcript gates the scan: a session that never asked cannot have an open ask, so a
          // plain chat never pays for a stream read.
          const transcriptAsks = raw === null ? null : readSessionAsks(raw, event.appSessionId);
          if (transcriptAsks !== null && (transcriptAsks.settled.length > 0 || transcriptAsks.current !== null)) {
            await retraction.stateStreamOnlyAnswers(event.appSessionId, resolved.title, resolved.projectPath, raw, at, answerMessageId);
          }
          return;
        }

        // The ledger names the asks that are still open; the new message ends every one of them
        // that is really a question. That walk lives in the recovery helper, which replays the
        // retraction verdict and states the answer.
        const ledger = askLedger.read(previous.digest);
        const outcome = await recovery.stateUserTurnAnswers({
          raw,
          sessionId: event.appSessionId,
          sessionTitle: resolved.title,
          projectPath: resolved.projectPath,
          at,
          answerMessageId,
          ledger,
        });
        if (outcome.retracted === 0 && outcome.stated === 0) return;

        askLedger.dropAnsweredPending(ledger);
        // Persist the answer now: a restart between this send and the next turn-end must not
        // re-state it, and the resolved asks must never be backfilled again. The same write
        // carries the withdrawal, so a restart does not re-state that either.
        askLedger.persist(uri, previous, ledger);
      } catch {
        // A user message must never fail because the observation layer could not read it.
      }
    },

    async handleTurnEnd(event) {
      try {
        const resolved = resolveSession(event.appSessionId);
        if (resolved === null) return null;

        const uri = formatSessionUri(event.appSessionId);
        const raw = resolved.jsonlPath === null ? null : await readTranscript(resolved.jsonlPath);
        const result =
          raw === null
            ? {
                state: 'unevaluated' as const,
                reason:
                  resolved.jsonlPath === null
                    ? '会话没有 transcript 路径'
                    : `transcript 不存在或不可读: ${resolved.jsonlPath}`,
              }
            : buildSessionDigest(raw, { error: event.error !== null });

        if (result.state === 'evaluated') {
          let digest = result.digest;
          const ask = readSessionAsk(raw ?? '', event.appSessionId);
          const scan = readSessionAsks(raw ?? '', event.appSessionId);
          // The per-ask history is carried from the PREVIOUS revision, read before this turn's
          // deterministic write replaces the object: a turn that does not ask must not erase the
          // asks that are still open on other cards.
          const previousDigest = store.getObject(uri)?.digest;
          const ledger = askLedger.read(previousDigest);
          const at = new Date(event.completedAt || now()).toISOString();

          // ---- THE SEMANTIC GATE ----------------------------------------------------------
          // `readSessionAsk` answers a MECHANICAL CANDIDATE (the wide prefilter), not a verdict:
          // a decision in a middle paragraph and a long report containing a numbered list both
          // pass it. The T1 summary is what decides. It is awaited BEFORE any write, so a
          // definitive `isAsking:false` produces neither the `session.asking` event nor the
          // observation object. When the summary is unavailable or fails, the documented
          // fallback applies: the candidate is shown, and its reading's reason is what the card
          // displays (better briefly visible than silently dropped).
          const candidate = ask.current;
          let current = candidate;
          let askDecision: SessionAskDecisionReading | undefined;
          if (candidate !== null) {
            if (summarizeAsk === undefined) {
              // No tier in this build: state the fallback ON the deterministic revision itself,
              // so the wall keeps its one-write-per-turn contract and the card still shows why
              // it is showing a candidate.
              askDecision = {
                state: 'skipped',
                reason: '提问语义判定不可用（未启用 observation.sessionDigest）：已按机械预筛显示候选',
                originalAsk: candidate.assistantText,
              };
              digest = { ...digest, askDecision };
            } else {
              try {
                askDecision = await summarizeAsk.summarize({
                  sessionId: event.appSessionId,
                  sessionTitle: resolved.title,
                  askId: candidate.askId,
                  revision: candidate.revision,
                  assistantText: candidate.assistantText,
                  context: ask.context,
                });
              } catch (failure) {
                askDecision = {
                  state: 'unevaluated',
                  reason: `提问摘要生成失败：${failure instanceof Error ? failure.message : String(failure)}`,
                  originalAsk: candidate.assistantText,
                };
              }
            }
            if (askDecision.isAsking === false) {
              // A definitive non-ask writes nothing — except an errored turn still writes its
              // red reading (the ask is simply dropped from it).
              if (digest.activity !== 'error') return null;
              current = null;
            } else {
              // Confirmed asking, or the candidate fallback: the wall waits on this turn.
              digest = { ...digest, activity: 'waiting' };
            }
          }

          // Every ask this session's ledger still names as UNFINISHED and the transcript now
          // shows a later user message for is stated. The pending set is the gate, not the
          // transcript: a transcript carrying dozens of old answered rounds must not backfill
          // them again (the live bug wrote ~70 duplicate `session.answered` rows for exactly
          // that reason). The persisted ledger keeps the gate stable across restarts.
          askLedger.stateSettledPending(scan, ledger, {
            sessionId: event.appSessionId,
            projectPath: resolved.projectPath,
            at,
          });

          // The ask is RECORDED in the ledger before the object is written and STATED after it:
          // an asking event whose message has no observation object is exactly the pair this
          // task removes. A current ask the ledger already withdrew is not recorded again.
          const askingToState =
            current === null
              ? null
              : askLedger.recordAsking(ledger, {
                  askId: current.askId,
                  messageId: current.messageId,
                  revision: current.revision,
                  sessionId: event.appSessionId,
                  projectPath: resolved.projectPath,
                  at,
                  data: buildSessionAskingData(event.appSessionId, current),
                });

          // An answered ask is no longer pending, and the ledger rides with the digest so the
          // NEXT process (after a restart) reads it back instead of re-emitting.
          askLedger.dropAnsweredPending(ledger);
          digest = {
            ...digest,
            ...askLedger.withLedger(ledger),
            ...carryAskDecisionHistory(previousDigest),
          } as SessionDigest;

          const observed = isObserved(uri);
          // An idle, unwatched turn is exactly the traffic the wall does not need. A turn that
          // ASKS is never that traffic: its asking row is about to reach the shared stream, and
          // a card built from that row resolves through this object. Only the silent idle turn
          // is skipped.
          if (!observed && digest.activity === 'idle' && current === null) return null;

          const status =
            digest.activity === 'error'
              ? { state: 'red' as const, reason: event.error ?? '本轮运行报错' }
              : digest.activity === 'waiting'
                ? { state: 'attention' as const, reason: '本轮以提问结束，等你回复' }
                : { state: 'ok' as const };

          // THE LEDGER IS THE TURN'S OWN FACT, so it is written in the deterministic revision
          // BEFORE the summary ENRICHES it. The gate above already decided this turn asks; the
          // summary's own revision is a second, delta-less write, and if it never lands (the
          // process was restarted while it was in flight — the live 09:43 ask whose answered
          // event never appeared) the ledger still says 「this session asked and nobody has
          // answered」.
          const written = store.writeRevision({
            uri,
            kind: 'session',
            title: resolved.title,
            status,
            digest,
            deltaItems: deltaItemsFor(uri, digest),
            provenance: {
              producer: SESSION_DIGEST_PRODUCER,
              tier: 'deterministic',
              evaluatedAt: event.completedAt || now(),
            },
          });

          // THE EVENT FOLLOWS THE OBJECT. The asking row is stated only once the digest revision
          // carrying its ledger (and thus the object a card resolves against) has landed.
          if (askingToState !== null) emitOnce(askingToState.key, askingToState.event);

          if (current === null || askDecision === undefined || summarizeAsk === undefined) return written;

          // Only the digest is enriched: the turn's delta was stated by the revision above, so
          // this one carries none (a second 「新增 1 轮」 would be a lie the wall shows twice).
          //
          // The decision goes into the per-ask history under `current.askId`, with the asking
          // message indexed so that card resolves to it. The legacy `askDecision` slot still
          // names this turn's ask (readers that ask the session keep working), while a card
          // about ANY ask resolves through the history and never borrows this slot.
          return store.writeRevision({
            uri,
            kind: 'session',
            title: resolved.title,
            status,
            digest: {
              ...written.digest,
              askDecision,
              ...rememberAskDecision(written.digest, {
                askId: current.askId,
                messageId: current.messageId,
                reading: askDecision,
                originalAsk: current.assistantText,
              }),
            },
            deltaItems: [],
            provenance: {
              producer: SESSION_DIGEST_PRODUCER,
              tier: 'deterministic',
              evaluatedAt: event.completedAt || now(),
            },
          });
        }

        // Unreadable transcript: an unevaluated object is only worth a slot when someone pinned
        // it — a session nobody watches and cannot read does not need a tile saying so.
        if (!isObserved(uri)) return null;
        return store.writeRevision({
          uri,
          kind: 'session',
          title: resolved.title,
          status: { state: 'unevaluated', reason: result.reason },
          digest: { activity: 'idle', unevaluatedReason: result.reason },
          deltaItems: [],
          provenance: {
            producer: SESSION_DIGEST_PRODUCER,
            tier: 'deterministic',
            evaluatedAt: event.completedAt || now(),
          },
        });
      } catch {
        // The chat path must not learn that observation failed.
        return null;
      }
    },

    async sweepOpenAsks() {
      return recovery.sweepOpenAsks();
    },
  };
}

/**
 * The process-wide producer the run registry calls.
 *
 * The store is the DB-backed default one; the push seam is not bound here because this writer
 * is reached from the websocket module's completion path rather than from `server/index.ts`'s
 * composition. The wall reads revisions from the database, so the write is complete without it.
 */
export const sessionDigestProducer = createSessionDigestProducer({
  store: createObservationStore(),
  // The live user-turn path reads this host's own stream for the sessions that hold no ledger:
  // their asking row is the only record that they asked. Gated by the transcript, so a session
  // that never asked never triggers the read.
  readOpenSessionAsks: () => readOpenSessionAsks(),
});

/**
 * The process-wide boot-time sweeper.
 *
 * A separate instance from {@link sessionDigestProducer} on purpose: the LLM tier wraps that one
 * and the sweep runs the answered backfill plus the mis-stated-ask retraction as one pass. The
 * answered backfill needs no model call; the retraction does — the T1 summary's `isAsking:false`
 * is the verdict that withdraws the asks an older detector stated. The store is the same DB, so
 * the ledger the sweep writes is the one the live producer reads.
 *
 * Consumers: `server/index.ts`, which starts one pass after `initializeDatabase()` and does not
 * await it.
 */
export const sessionAskSweeper: SessionAskSweepableProducer = createSessionDigestProducer({
  store: createObservationStore(),
  // The retraction verdict is the T1 semantic gate; without it the sweep only backfills answers.
  summarizeAsk: createSessionAskDecisionDigest(),
  // The one seam a unit test must not inherit: the sweep reads this host's own stream.
  readOpenSessionAsks: () => readOpenSessionAsks(),
});
