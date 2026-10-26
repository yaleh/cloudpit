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

import { observationDb, sessionsDb } from '@/modules/database/index.js';
import type { ISessionAskEventWriter } from '@/shared/interfaces.js';
import type { SessionAskDecisionReading, SessionAskEvent } from '@/shared/types.js';

import { formatSessionUri } from './observation-uri.js';
import { createObservationStore, type ObservedObject, type ObservationStore } from './observation-store.js';
import { readSessionAsk, type SessionAskDecisionDigest } from './session-ask-decision-digest.js';
import { buildSessionDigest, type SessionDigest } from './session-digest.js';

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
  /** The clock stamped onto the write. Defaults to `Date.now`. */
  now?: () => number;
};

/** The producer's one verb. */
export type SessionDigestProducer = {
  handleTurnEnd(event: SessionTurnEndEvent): Promise<ObservedObject | null>;
};

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

/** Builds the producer over its injected world. */
export function createSessionDigestProducer(deps: SessionDigestProducerDeps): SessionDigestProducer {
  const store = deps.store;
  const resolveSession = deps.resolveSession ?? defaultResolveSession;
  const readTranscript = deps.readTranscript ?? defaultReadTranscript;
  const isObserved = deps.isObserved ?? ((uri: string) => observationDb.listWatchUserIds(uri).length > 0);
  const now = deps.now ?? (() => Date.now());
  const summarizeAsk = deps.summarizeAsk;
  const eventWriter = deps.eventWriter;

  /**
   * The asks/answers already stated in this process, so a repeated turn-end does not re-emit.
   *
   * Keyed by askId+revision (an ask) and askId+user message id (an answer): a new turn has a new
   * first-asking message id, so its key differs and it is never suppressed by an older turn.
   * In-process only — the stream is at-least-once, and the fleet dedups by its own dedupKey.
   */
  const emittedEvents = new Set<string>();
  const emitOnce = (key: string, event: SessionAskEvent): void => {
    if (eventWriter === undefined || emittedEvents.has(key)) return;
    emittedEvents.add(key);
    try {
      // The chat path must not learn that the evidence stream failed.
      eventWriter.write(event);
    } catch {
      // A rejected event is the writer's reading to publish, not the turn's failure.
    }
  };

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
          const at = new Date(event.completedAt || now()).toISOString();

          // The answer precedes the question chronologically, so it is stated first.
          if (ask.answered !== null) {
            emitOnce(`answered:${ask.answered.askId}:${ask.answered.messageId}`, {
              kind: 'session.answered',
              session: event.appSessionId,
              project: resolved.projectPath,
              at,
              data: { askId: ask.answered.askId, messageId: ask.answered.messageId },
            });
          }
          if (ask.current !== null) {
            emitOnce(`asking:${ask.current.askId}:${ask.current.revision}`, {
              kind: 'session.asking',
              session: event.appSessionId,
              project: resolved.projectPath,
              at,
              refs: [ask.current.messageId],
              data: {
                askId: ask.current.askId,
                messageId: ask.current.messageId,
                revision: ask.current.revision,
                contentRef: {
                  resolver: 'cloudcli.session-ask',
                  sessionId: event.appSessionId,
                  messageId: ask.current.messageId,
                },
              },
            });

            if (summarizeAsk !== undefined) {
              try {
                digest = {
                  ...digest,
                  askDecision: await summarizeAsk.summarize({
                    sessionId: event.appSessionId,
                    sessionTitle: resolved.title,
                    askId: ask.current.askId,
                    revision: ask.current.revision,
                    assistantText: ask.current.assistantText,
                    context: ask.context,
                  }),
                };
              } catch (failure) {
                digest = {
                  ...digest,
                  askDecision: {
                    state: 'unevaluated',
                    reason: `提问摘要生成失败：${failure instanceof Error ? failure.message : String(failure)}`,
                  } satisfies SessionAskDecisionReading,
                };
              }
            }
          }

          const observed = isObserved(uri);
          // An idle, unwatched turn is exactly the traffic the wall does not need.
          if (!observed && digest.activity === 'idle') return null;

          const status =
            digest.activity === 'error'
              ? { state: 'red' as const, reason: event.error ?? '本轮运行报错' }
              : digest.activity === 'waiting'
                ? { state: 'attention' as const, reason: '本轮以提问结束，等你回复' }
                : { state: 'ok' as const };

          return store.writeRevision({
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
});
