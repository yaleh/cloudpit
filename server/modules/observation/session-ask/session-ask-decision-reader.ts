/**
 * The cockpit's read path into one session's T1 ask digest — and the repair of a digest that
 * was stored before the current suggestion rules held.
 *
 * SIX STALE SHAPES ARE REPAIRED ON READ, through one mechanism:
 *   1. A digest stored while the tier was still switched off (`{ state: 'skipped', reason:
 *      '未启用 …' }`). Only that session's NEXT turn recomputes it, so a person who enables the
 *      setting keeps reading 「提问决策摘要未启用」 on cards that are still open.
 *   2. A digest evaluated under the old rule that only the assistant's own recommendation may be
 *      suggested. An `evaluated` reading with options, `incomplete: false` and NO suggested
 *      option is recomputed ONCE so the same call's judge can supply the missing default; the
 *      recompute carries the judge's reason onto the suggested option.
 *   3. A digest failed with 「模型输出不可用」 before the output ceiling was raised. The stored
 *      failure is recomputed once, so the fix reaches readings that already exist instead of
 *      only the next asking turn.
 *   4. An `evaluated` digest stored before the assistant's verbatim `quote` field existed. It is
 *      recomputed once so the phone's Details drawer can show the original words.
 *   5. A stored 「转写里找不到这次提问」 failure. That sentence was written by the OLD reader from
 *      a transient miss (the provider had not appended the row yet) or from a stored-digest/card
 *      ask mismatch, and remembered forever; the transcript may well carry the card's ask now.
 *      Recomputed under the same bounded rules, so a session left with the wrong verdict heals
 *      without waiting for its next asking turn.
 *   6. A stored 「重算失败：找不到会话转写」 failure (a session row or transcript that was missing
 *      when the old reader computed it). The transcript may have been recreated since; the same
 *      bounded recompute runs, so the failure is not remembered forever.
 *
 * A MISSING OBJECT IS REBUILT FROM THE TRANSCRIPT. A `session.asking` card can name a session
 * whose observation object was never written (the digest write for that turn lost the race, or
 * the object was pruned) while the `sessions` row and the transcript are both there. Returning
 * `null` before consulting the transcript — the old read did exactly that — draws 「尚未生成」
 * forever, because the repair that could resolve the session is started from the object it never
 * reads. When `getObject` answers null, the read therefore starts the SAME bounded repair through
 * `resolveSession` (app id, then provider id, then the projects scan by the card's own id) and
 * answers a 「尚未生成的」 reading for that frame; the next poll reads the object the repair wrote.
 * With neither a session nor a transcript the read still answers `null`.
 *
 * IT IS A REPAIR, NOT A SECOND PRODUCER. The read itself stays synchronous (the card projection
 * calls it in a loop), so the recompute is started in the background and the caller keeps the
 * stored reading for that frame; the repaired reading is what the next read answers. Nothing here
 * ever throws into the read path.
 *
 * CALLS ARE BOUNDED. One attempt per `<sessionId>:<askId>` — a failed attempt is remembered too,
 * so a broken gateway is not retried on every poll. ONE EXCEPTION IS TEMPORAL: a card that names
 * an assistant message the transcript does not carry YET (the row is appended by the provider
 * process, which lags the turn) is 「暂不可判定」, retried at most
 * {@link SESSION_ASK_DECISION_ASK_RETRY_LIMIT} times with a widening interval; only after that
 * cap is the missing-ask reason written. Collapsing that timing fact into a permanent failure —
 * and conflating it with 「the stored digest is about a different ask」 — is exactly what left
 * 「转写里找不到这次提问」 on a live card whose transcript did contain the message. The per-process
 * sliding hour honours the tier's own `maxPerHour`; once it is spent the stale reading is left
 * untouched and the read answers 「本轮未生成（限额）」 (the disabled-tier shape) or keeps the stored
 * reading (a digest that is complete but has no default).
 *
 * FAILURE IS VISIBLE. Every recompute that cannot reach the model writes an `unevaluated`
 * reading naming WHY (no transcript, no ask in the transcript, the transcript read threw), so
 * the card says 「提问决策摘要不可用：重算失败…」 instead of keeping the stale line forever. The
 * failure and the hourly-limit readings carry different sentences on purpose.
 *
 * THE ASK IS LOCATED BY THE CARD'S MESSAGE ID. `read()` passes the fleet's `contentRef.messageId`
 * through to `readSessionAsk`, so a card whose conversation moved on (the live quay card named a
 * message twenty turns behind the transcript's end) still recomputes. A transcript stored under
 * ANOTHER project's encoded directory is found by provider session id when the stored
 * `jsonl_path` is missing or unreadable.
 *
 * A CARD READS ITS OWN ASK, NEVER THE SESSION'S LATEST SLOT. The digest keeps a bounded per-ask
 * history (`askDecisions`, indexed by `askDecisionMessages`); a read with a message id resolves
 * that message to its askId and answers THAT decision. When the history has no entry the answer
 * is 「这条提问的摘要尚未生成」 plus the asking message's verbatim words (the fallback question),
 * and a repair fills the entry — the session slot is deliberately not consulted, because it
 * belongs to whichever ask came last (the live defect showed an older card the newer ask's
 * options). Reads without a message id keep the historical slot behaviour.
 *
 * Consumers: `server/cockpit-fleet-wiring.ts` (the card provider's `readSessionAsk` seam) and
 * `tests/session-ask-decision-digest.test.ts` (which drives the repair over a memory store).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { SessionAskDecisionReading } from '@/shared/types.js';
import { isRecord, resolveClaudeConfigDir } from '@/shared/utils.js';

import {
  formatSessionUri,
  createSessionDigestLlmSettingsSource,
  type ObservationStore,
  type SessionDigestLlmSettings,
} from '../core/index.js';
import {
  createSessionAskDecisionDigest,
  readSessionAsk,
  rememberAskDecision,
  SESSION_ASK_OUTPUT_UNUSABLE_REASON,
  type SessionAskDecisionDigest,
} from './session-ask-decision-digest.js';

/** The stated reason on a read whose recompute was refused by the hourly ceiling. */
export const SESSION_ASK_DECISION_LIMIT_REASON = '本轮未生成（限额）';

/** The stated reason when neither the stored path nor the cross-project lookup found a file. */
export const SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON = '重算失败：找不到会话转写';

/** The stated reason when the transcript exists but does not carry the card's asking message. */
export const SESSION_ASK_DECISION_ASK_MISSING_REASON = '重算失败：转写里找不到这次提问';

/**
 * The reason a card carries while the digest holds NO decision for ITS OWN ask.
 *
 * A session's `askDecision` slot may hold a decision for a later ask; that is not this card's
 * summary, so the reader answers with this sentence (plus the asking message's own words when
 * they are readable) instead of borrowing the slot. A background repair fills the ask's history
 * entry, and the next read answers with it.
 */
export const SESSION_ASK_DECISION_NOT_GENERATED_REASON = '这条提问的摘要尚未生成';

/**
 * How many times a named message that the transcript does not carry yet is retried before the
 * missing-ask reason is written. The transcript is appended by another process, so 「not there
 * yet」 is a fact about timing: one read must not make it permanent.
 */
export const SESSION_ASK_DECISION_ASK_RETRY_LIMIT = 3;

/** The first retry interval; each further attempt doubles it (2 s, then 4 s). */
const ASK_RETRY_BACKOFF_MS = 2_000;

/** The producer stamped on a repaired revision, so the repair is distinguishable from a turn. */
const SESSION_ASK_DECISION_READER_PRODUCER = 'session-ask-decision-reader';

/**
 * The status of an object the reader itself creates. The normal producer writes the session
 * object with this reading while it waits for a reply; a self-heal that recovers the object from
 * the transcript has no other status to carry, and `attention` is what the waiting session is.
 */
const SELF_HEAL_STATUS = { state: 'attention', reason: '本轮以提问结束，等你回复' } as const;

/** The token every disabled-tier skip reason carries (`未启用 observation.sessionDigest…`). */
const DISABLED_REASON_TOKEN = '未启用';

/** One hour, the window `maxPerHour` is counted over. */
const ONE_HOUR_MS = 60 * 60 * 1000;

/** What a session read needs from the world; production supplies every default. */
export type SessionAskDecisionReaderDeps = {
  /** The store holding the digest this reader repairs. */
  store: ObservationStore;
  /** The summariser; defaults to the tier's own gateway client and settings reader. */
  summarize?: SessionAskDecisionDigest;
  /** The tier settings, re-read on every call so enabling the switch is seen immediately. */
  readSettings?: () => SessionDigestLlmSettings;
  /** Resolves a session's title and transcript path. Defaults to `sessionsDb`. */
  resolveSession?: (sessionId: string) => {
    title: string;
    jsonlPath: string | null;
    /** The provider's own id for the conversation; enables the cross-project lookup. */
    providerSessionId?: string | null;
  } | null;
  /** Reads a transcript file, answering `null` when it cannot be read. Defaults to `fs.readFile`. */
  readTranscript?: (jsonlPath: string) => Promise<string | null>;
  /**
   * Finds a transcript by provider session id across EVERY encoded project directory, for a
   * session whose stored path is missing or unreadable. Defaults to scanning
   * `<claude config dir>/projects`.
   */
  findTranscript?: (providerSessionId: string) => Promise<string | null>;
  /** The root the default `findTranscript` scans; a test points it at a temporary tree. */
  claudeProjectsRoot?: string;
  /** The clock. Defaults to `Date.now`. */
  now?: () => number;
};

/** The read surface the cockpit's content seam consumes. */
export type SessionAskDecisionReader = {
  /**
   * The stored reading, or null; starts a bounded background repair when the stored reading is
   * one of the stale shapes this module describes. `messageId` is the asking message the card
   * names; without it the repair follows the transcript's last assistant message.
   */
  read(sessionId: string, messageId?: string): SessionAskDecisionReading | null;
  /** Resolves once every repair started so far has settled (used by the criterion and the DoD). */
  settled(): Promise<void>;
};

/** The stored reading when it is one of the union's three states, otherwise null. */
function storedReading(object: ReturnType<ObservationStore['getObject']>): SessionAskDecisionReading | null {
  const raw = object?.digest.askDecision;
  if (!isRecord(raw)) return null;
  if (raw.state === 'evaluated' || raw.state === 'skipped' || raw.state === 'unevaluated') {
    return raw as unknown as SessionAskDecisionReading;
  }
  return null;
}

/**
 * The digest's per-ask history entry for `askId`, when it is a readable reading.
 *
 * A digest written before the per-ask history existed carries only the legacy slot. That slot is
 * this ask's own reading — not a borrow from another ask — exactly when it NAMES this askId
 * (`askId` is `<sessionId>:<firstAskingMessageId>`), so the slot is read as the fallback for that
 * one askId. A slot naming a different ask is never returned here: that is the live defect this
 * reader exists to stop.
 */
function storedAskReading(digest: Record<string, unknown>, askId: string): SessionAskDecisionReading | null {
  const decisions = isRecord(digest.askDecisions) ? digest.askDecisions : null;
  const raw = decisions === null ? undefined : decisions[askId];
  if (isRecord(raw) && (raw.state === 'evaluated' || raw.state === 'skipped' || raw.state === 'unevaluated')) {
    return raw as unknown as SessionAskDecisionReading;
  }
  const slot = digest.askDecision;
  if (
    isRecord(slot) &&
    (slot.state === 'evaluated' || slot.state === 'skipped' || slot.state === 'unevaluated') &&
    slot.askId === askId
  ) {
    return slot as unknown as SessionAskDecisionReading;
  }
  return null;
}

/**
 * The askId a card's `contentRef.messageId` belongs to, read from the digest alone.
 *
 * The producer indexes each ask under the asking message its event named, so this is a map
 * lookup. The `<sessionId>:<messageId>` shape is checked too: it is the askId of a session's
 * first asking message, which is also what an un-re-asked ask uses, and it covers a digest whose
 * index entry was pruned with an older history slot.
 */
function askIdOfMessage(
  digest: Record<string, unknown>,
  sessionId: string,
  messageId: string,
): string | undefined {
  if (isRecord(digest.askDecisionMessages)) {
    const indexed = digest.askDecisionMessages[messageId];
    if (typeof indexed === 'string' && indexed !== '') return indexed;
  }
  const direct = `${sessionId}:${messageId}`;
  return storedAskReading(digest, direct) === null ? undefined : direct;
}

/**
 * The stale shapes repaired on read. `missing` is the per-ask case: the digest carries no
 * decision for the card's own ask, so the repair computes one (and, before that, records the
 * asking message's verbatim words so the card can state the question meanwhile).
 */
type StaleShape = 'missing' | 'disabled' | 'output' | 'ask-missing' | 'transcript-missing' | 'quote' | 'default';

/** Which repair, if any, this reading needs. `null` means it is a usable answer as it stands. */
function staleShapeOf(reading: SessionAskDecisionReading): StaleShape | null {
  const disabledSkip = reading.state === 'skipped' && reading.reason.includes(DISABLED_REASON_TOKEN);
  const missingDefault =
    reading.state === 'evaluated' &&
    reading.options.length > 0 &&
    reading.incomplete === false &&
    !reading.options.some((option) => option.suggested);
  const missingQuote =
    reading.state === 'evaluated' && (typeof reading.quote !== 'string' || reading.quote.trim() === '');
  const failedOutput =
    reading.state === 'unevaluated' && reading.reason.startsWith(SESSION_ASK_OUTPUT_UNUSABLE_REASON);
  const missingAsk =
    reading.state === 'unevaluated' && reading.reason === SESSION_ASK_DECISION_ASK_MISSING_REASON;
  // A missing session row or transcript was a fact about THAT moment. The row can be restored
  // and the transcript recreated, so the failure is recomputed instead of remembered forever.
  const missingTranscript =
    reading.state === 'unevaluated' && reading.reason === SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON;
  if (missingTranscript) return 'transcript-missing';
  if (disabledSkip) return 'disabled';
  if (failedOutput) return 'output';
  if (missingAsk) return 'ask-missing';
  if (missingQuote) return 'quote';
  if (missingDefault) return 'default';
  return null;
}

function defaultResolveSession(sessionId: string): {
  title: string;
  jsonlPath: string | null;
  providerSessionId: string | null;
} | null {
  // The card names the app's `session_id`; a fleet envelope naming the PROVIDER's id finds the
  // same row through the second key. Either way the row carries the transcript path and the
  // provider id the projects scan needs.
  const row = sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
  if (row === null) return null;
  return {
    title: (row.custom_name ?? '').trim() || sessionId,
    jsonlPath: row.jsonl_path ?? null,
    providerSessionId: row.provider_session_id ?? null,
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
 * Finds one session's transcript across every encoded project directory.
 *
 * The session's project is not this server's project: a card about a quay conversation is read
 * by the claudecodeui process, and the transcript lives under the quay repository's encoded
 * directory (`~/.claude/projects/-data-home-yale-work-quay/<provider-id>.jsonl`). The stored
 * `jsonl_path` normally answers correctly; this lookup is the fallback for a row whose path is
 * absent or stale, and it never guesses by session title.
 */
async function defaultFindTranscript(
  projectsRoot: string,
  providerSessionId: string,
): Promise<string | null> {
  const fileName = `${providerSessionId}.jsonl`;
  let entries;
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      return await readFile(join(projectsRoot, entry.name, fileName), 'utf8');
    } catch {
      // Not in this project's directory; keep looking.
    }
  }
  return null;
}

/**
 * Builds the reader over its injected world. The in-flight map, the attempted set and the
 * sliding hour belong to this instance's closure — module-level mutable state is not used.
 */
export function createSessionAskDecisionReader(deps: SessionAskDecisionReaderDeps): SessionAskDecisionReader {
  const store = deps.store;
  const settingsSource = createSessionDigestLlmSettingsSource();
  const readSettings = deps.readSettings ?? (() => settingsSource.read());
  const summarize = deps.summarize ?? createSessionAskDecisionDigest({ readSettings });
  const resolveSession = deps.resolveSession ?? defaultResolveSession;
  const readTranscript = deps.readTranscript ?? defaultReadTranscript;
  const projectsRoot = deps.claudeProjectsRoot ?? join(resolveClaudeConfigDir(), 'projects');
  const findTranscript =
    deps.findTranscript ?? ((providerSessionId: string) => defaultFindTranscript(projectsRoot, providerSessionId));
  const now = deps.now ?? (() => Date.now());

  const inflight = new Map<string, Promise<void>>();
  const attempted = new Set<string>();
  /** Temporal misses, keyed like the attempt: how many, and when the next try is allowed. */
  const retries = new Map<string, { count: number; nextAt: number }>();
  const callTimes: number[] = [];
  /**
   * The asking message's own words, learned from the transcript each time a repair reads it.
   *
   * A card whose digest has no decision still has to state WHAT is being asked. The digest's
   * `originalAsk` covers asks the producer summarized; this cache covers the window before a
   * repair has written one, so the fallback question appears on the poll that follows.
   */
  const originals = new Map<string, string>();
  const originalKey = (sessionId: string, messageId: string): string => `${sessionId}\u0000${messageId}`;

  /**
   * Counts one temporal miss (the transcript does not carry the card's message yet) and answers
   * whether the retry cap has been reached. Below the cap NOTHING is written: 「暂不可判定」 is the
   * absence of a reading, and the stored one stays on the card.
   */
  const countTemporalMiss = (attemptKey: string): boolean => {
    const count = (retries.get(attemptKey)?.count ?? 0) + 1;
    retries.set(attemptKey, { count, nextAt: now() + ASK_RETRY_BACKOFF_MS * 2 ** (count - 1) });
    return count >= SESSION_ASK_DECISION_ASK_RETRY_LIMIT;
  };

  /** Prunes the sliding hour and answers how many calls it still holds. */
  const callsInTheLastHour = (at: number): number => {
    while (callTimes.length > 0 && at - (callTimes[0] ?? at) >= ONE_HOUR_MS) callTimes.shift();
    return callTimes.length;
  };

  /**
   * Writes the honest failure reading over the stale disabled-tier skip, so the card names why
   * the recompute produced nothing. A failure and the hourly limit therefore look different.
   *
   * A failure found by the missing-object self-heal has no stored object to write over; there
   * `create` supplies the session's title and the store creates the object, so the failure is a
   * reading the next poll can answer (and the transcript-missing shape can retry) instead of
   * silence.
   */
  const writeFailure = (
    sessionId: string,
    reason: string,
    options: { create?: boolean; title?: string } = {},
  ): void => {
    const uri = formatSessionUri(sessionId);
    const object = store.getObject(uri);
    if (object === null && options.create !== true) return;
    store.writeRevision({
      uri,
      kind: 'session',
      title: object?.title ?? options.title ?? sessionId,
      status: object?.status ?? SELF_HEAL_STATUS,
      digest: { ...(object?.digest ?? {}), askDecision: { state: 'unevaluated', reason } },
      deltaItems: [],
      provenance: {
        producer: SESSION_ASK_DECISION_READER_PRODUCER,
        tier: 'deterministic',
        evaluatedAt: now(),
      },
    });
  };

  /**
   * Recomputes one stale reading and writes the result back; never rejects.
   *
   * `attemptKey` is the once-per-ask guard: an askId when the stored reading names one, else the
   * session+message+shape key (a `模型输出不可用` reading carries no askId until the transcript is
   * read). `expectedAskId` is set when the stored reading already names the ask: a transcript
   * that no longer carries THAT ask may not overwrite a valid digest with a different turn.
   * `createObject` is set by the missing-object self-heal: the repair then writes the object it
   * rebuilt instead of returning because there was nothing to overwrite.
   */
  const repair = async (
    sessionId: string,
    messageId: string,
    options: { attemptKey: string; expectedAskId?: string; createObject?: boolean },
  ): Promise<void> => {
    const { attemptKey, expectedAskId, createObject = false } = options;
    /** Records the attempt so the next poll does not pay for the same stale reading again. */
    const remember = (): void => {
      attempted.add(attemptKey);
      if (expectedAskId !== undefined) attempted.add(expectedAskId);
    };
    try {
      const resolved = resolveSession(sessionId);
      let raw: string | null = null;
      let sessionTitle = sessionId;
      if (resolved === null) {
        // The row is gone (or was never visible to this process). The transcript may still be
        // found by the id the card names across the projects directories; that scan is the last
        // resort before this read gives up.
        raw = await findTranscript(sessionId);
        if (raw === null || raw.trim() === '') {
          remember();
          writeFailure(sessionId, SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON, {
            create: createObject,
            title: sessionId,
          });
          return;
        }
      } else {
        sessionTitle = resolved.title;
        raw = resolved.jsonlPath === null || resolved.jsonlPath === ''
          ? null
          : await readTranscript(resolved.jsonlPath);
        if ((raw === null || raw.trim() === '') && resolved.providerSessionId !== null && resolved.providerSessionId !== undefined) {
          raw = await findTranscript(resolved.providerSessionId);
        }
        if (raw === null || raw.trim() === '') {
          remember();
          writeFailure(sessionId, SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON, {
            create: createObject,
            title: resolved.title,
          });
          return;
        }
      }

      const askReading = readSessionAsk(raw, sessionId, messageId);
      const ask = askReading.current;
      if (ask === null) {
        // A card that names a message the transcript does not carry YET is a timing reading,
        // not a verdict. The transcript is appended by the provider process; a recompute that
        // runs first must leave the card alone and try again, not remember a failure forever.
        if (messageId !== '' && askReading.namedMessageFound === false) {
          if (countTemporalMiss(attemptKey) === false) return;
        }
        remember();
        writeFailure(sessionId, SESSION_ASK_DECISION_ASK_MISSING_REASON);
        return;
      }
      if (expectedAskId !== undefined && ask.askId !== expectedAskId) {
        if (messageId === '') {
          // No card message was named and the transcript's current ask is another turn: the
          // stored reading is valid for ITS OWN ask, so there is nothing to repair. Bound the
          // check, but do not claim the transcript lacks an ask it plainly carries.
          remember();
          return;
        }
        // The card DID name this message, and the ask it belongs to is not the stored reading's
        // (the digest write for that turn never happened, or the conversation moved on). The
        // ask the card names is the one to recompute — 「转写里找不到这次提问」 would be false.
      }
      // A new turn has a new askId, so a repaired session is still eligible for its next ask.
      if (attempted.has(ask.askId)) return;
      attempted.add(ask.askId);
      // The stored ask's own key is consumed only when it IS the ask that was recomputed; a
      // card naming another turn must not burn the stored reading's one repair.
      if (expectedAskId === undefined || expectedAskId === ask.askId) attempted.add(attemptKey);
      retries.delete(attemptKey);

      // The ask is readable, so its verbatim words are cached before the model call: a card
      // whose summary fails or is switched off can still state the question.
      originals.set(originalKey(sessionId, messageId === '' ? ask.messageId : messageId), ask.assistantText);
      originals.set(originalKey(sessionId, ask.messageId), ask.assistantText);

      callTimes.push(now());
      const reading = await summarize.summarize({
        sessionId,
        sessionTitle,
        askId: ask.askId,
        revision: ask.revision,
        assistantText: ask.assistantText,
        context: askReading.context,
      });
      // The semantic gate's negative verdict: this message is not a question. There is no digest
      // to write for it; suppressing a card the fleet already received is the retraction task's
      // job. Remember the attempt so a card that polls does not buy the same model call again.
      if (reading.isAsking === false) {
        remember();
        return;
      }
      // The switch may have been turned off while the call was in flight; keep the old reading.
      if (reading.state === 'skipped') return;

      const uri = formatSessionUri(sessionId);
      const object = store.getObject(uri);
      // An existing object is overwritten in place. The missing-object self-heal has nothing to
      // overwrite: it creates the object from the session/transcript it just resolved.
      if (object === null && createObject === false) return;
      // The legacy slot names the session's LATEST ask. Repairing an older card's ask must not
      // move that slot backwards, so the slot is written only when it has no ask of its own (a
      // disabled skip, an unwritten failure) or when it already names the repaired ask.
      const slot = object === null ? null : storedReading(object);
      const slotRelevant = slot === null || slot.state !== 'evaluated' || slot.askId === ask.askId;
      const baseDigest = object?.digest ?? {};
      store.writeRevision({
        uri,
        kind: 'session',
        title: object?.title ?? sessionTitle,
        status: object?.status ?? SELF_HEAL_STATUS,
        digest: {
          ...baseDigest,
          ...(slotRelevant ? { askDecision: reading } : {}),
          ...rememberAskDecision(baseDigest, {
            askId: ask.askId,
            messageId: messageId !== '' ? messageId : ask.messageId,
            reading,
            originalAsk: ask.assistantText,
          }),
        },
        deltaItems: [],
        provenance: {
          producer: SESSION_ASK_DECISION_READER_PRODUCER,
          tier: reading.state === 'evaluated' ? 'llm' : 'deterministic',
          evaluatedAt: now(),
        },
      });
    } catch (failure) {
      // A repair must never fail the card read it was started from — but the failure is a
      // reading, not silence: this is the branch that used to leave 「未启用」 on screen.
      remember();
      writeFailure(
        sessionId,
        `重算失败：读取转写失败（${failure instanceof Error ? failure.message : String(failure)}）`,
        { create: createObject, title: sessionId },
      );
    }
  };

  /**
   * Answers one already-resolved reading and, when it is absent or stale, starts the bounded
   * background repair. The answer never waits for the model: the repaired reading is what the
   * next read sees. `shape === null` means the reading is usable as it stands.
   */
  const answerWithRepair = (
    sessionId: string,
    messageId: string,
    answer: SessionAskDecisionReading,
    shape: StaleShape | null,
    expectedAskId: string | undefined,
  ): SessionAskDecisionReading => {
    if (shape === null) return answer;

    const settings = readSettings();
    if (!settings.enabled) return answer;

    // The hourly ceiling is answered synchronously: the stored reading is left untouched and
    // the caller is told why this round produced nothing (the disabled shape) or simply keeps
    // its valid content (the evaluated shapes and a stored model-output failure).
    if (callsInTheLastHour(now()) >= settings.maxPerHour) {
      return shape === 'disabled' ? { state: 'skipped', reason: SESSION_ASK_DECISION_LIMIT_REASON } : answer;
    }

    // An askId already names the ask, so the attempt is keyed by it. The shapes that must
    // identify the ask from the transcript first key the attempt by the card's message instead.
    const attemptKey = expectedAskId ?? `${sessionId}\u0000${messageId}\u0000${shape}`;
    if (attempted.has(attemptKey)) return answer;
    // A temporal miss schedules itself: until the interval has elapsed the stored reading is
    // the answer (「暂不可判定」), and no second transcript read is paid for.
    const retry = retries.get(attemptKey);
    if (retry !== undefined && retry.nextAt > now()) return answer;

    const key = `${sessionId}\u0000${messageId}\u0000${shape}`;
    if (!inflight.has(key)) {
      const started = repair(sessionId, messageId, { attemptKey, expectedAskId });
      inflight.set(key, started);
      void started.then(() => {
        if (inflight.get(key) === started) inflight.delete(key);
      });
    }
    return answer;
  };

  /**
   * Answers one read whose observation object does not exist yet, and starts the bounded
   * missing-object self-heal.
   *
   * The read is synchronous, so it cannot wait for the transcript; the frame answers
   * 「这条提问的摘要尚未生成」 while the background repair resolves the session (app id, then
   * provider id, then the projects scan), reads the transcript and WRITES the object. The next
   * poll reads the object the repair created. Returning `null` here without starting that repair
   * — the old behaviour — drew 「尚未生成」 forever, because the repair could only ever be started
   * from the object it never read.
   *
   * It returns `null` when there is nothing to anchor a reading to (no session row and no
   * transcript) or the tier is off/over its hourly ceiling, and it never throws: a resolver
   * failure is a null answer, not a broken read.
   */
  const answerWithSelfHeal = (
    sessionId: string,
    messageId: string,
  ): SessionAskDecisionReading | null => {
    let resolved: ReturnType<typeof resolveSession> = null;
    try {
      resolved = resolveSession(sessionId);
    } catch {
      resolved = null;
    }

    const settings = readSettings();
    if (!settings.enabled) return null;
    if (callsInTheLastHour(now()) >= settings.maxPerHour) return null;

    // The same once-per-ask bound the stored-reading repair uses: a terminal attempt is
    // remembered, a temporal miss waits out its widening interval, and reads during an in-flight
    // attempt do not pay for a second transcript read.
    const attemptKey = `${sessionId}\u0000${messageId}\u0000missing-object`;
    const retry = retries.get(attemptKey);
    const blocked = attempted.has(attemptKey) || (retry !== undefined && retry.nextAt > now());
    if (!blocked && !inflight.has(attemptKey)) {
      const started = repair(sessionId, messageId, { attemptKey, createObject: true });
      inflight.set(attemptKey, started);
      void started.then(() => {
        if (inflight.get(attemptKey) === started) inflight.delete(attemptKey);
      });
    }

    // A legacy read (no card message) keeps answering null: 「摘要尚未生成」 is a sentence about
    // a card's ask, and this call names none. The heal itself still runs and writes the object.
    if (messageId === '' || resolved === null) return null;

    const original = originals.get(originalKey(sessionId, messageId));
    return {
      state: 'unevaluated',
      reason: SESSION_ASK_DECISION_NOT_GENERATED_REASON,
      ...(original === undefined ? {} : { originalAsk: original }),
    };
  };

  return {
    read(sessionId, messageId = '') {
      if (sessionId === '') return null;
      const object = store.getObject(formatSessionUri(sessionId));
      // NO OBJECT IS NOT A DEAD END. The transcript may carry the whole ask; the self-heal
      // rebuilds the object from it and the next poll answers with it.
      if (object === null) return answerWithSelfHeal(sessionId, messageId);

      // A CARD READS ITS OWN ASK. `contentRef.messageId` resolves to the askId the digest
      // indexed; the session's `askDecision` slot names the LATEST ask and is never this card's
      // answer (borrowing it is the live defect: an old card showed a newer question's
      // options). With no decision for this ask the card answers 「摘要尚未生成」 plus the asking
      // message's own words once the transcript — or an earlier repair — made them readable.
      if (messageId !== '') {
        const askId = askIdOfMessage(object.digest, sessionId, messageId);
        const reading = askId === undefined ? null : storedAskReading(object.digest, askId);
        if (reading !== null) {
          const expectedAskId = reading.state === 'evaluated' ? reading.askId : askId;
          return answerWithRepair(sessionId, messageId, reading, staleShapeOf(reading), expectedAskId);
        }
        const original = originals.get(originalKey(sessionId, messageId));
        const notGenerated: SessionAskDecisionReading = {
          state: 'unevaluated',
          reason: SESSION_ASK_DECISION_NOT_GENERATED_REASON,
          ...(original === undefined ? {} : { originalAsk: original }),
        };
        return answerWithRepair(sessionId, messageId, notGenerated, 'missing', askId);
      }

      // The legacy session read (no card message): the latest ask's slot, repaired as before.
      const reading = storedReading(object);
      if (reading === null) return null;
      const expectedAskId = reading.state === 'evaluated' ? reading.askId : undefined;
      return answerWithRepair(sessionId, messageId, reading, staleShapeOf(reading), expectedAskId);
    },

    async settled() {
      // Reads that arrive while a repair is settling may start the next one, so drain to empty.
      while (inflight.size > 0) await Promise.all([...inflight.values()]);
    },
  };
}
