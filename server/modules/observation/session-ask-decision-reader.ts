/**
 * The cockpit's read path into one session's T1 ask digest — and the repair of a digest that
 * was stored before the current suggestion rules held.
 *
 * FOUR STALE SHAPES ARE REPAIRED ON READ, through one mechanism:
 *
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
 * Consumers: `server/cockpit-fleet-wiring.ts` (the card provider's `readSessionAsk` seam) and
 * `tests/session-ask-decision-digest.test.ts` (which drives the repair over a memory store).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sessionsDb } from '@/modules/database/index.js';
import type { SessionAskDecisionReading } from '@/shared/types.js';
import { isRecord, resolveClaudeConfigDir } from '@/shared/utils.js';

import { formatSessionUri } from './observation-uri.js';
import type { ObservationStore } from './observation-store.js';
import {
  createSessionAskDecisionDigest,
  readSessionAsk,
  SESSION_ASK_OUTPUT_UNUSABLE_REASON,
  type SessionAskDecisionDigest,
} from './session-ask-decision-digest.js';
import {
  createSessionDigestLlmSettingsSource,
  type SessionDigestLlmSettings,
} from './session-digest-llm-settings.js';

/** The stated reason on a read whose recompute was refused by the hourly ceiling. */
export const SESSION_ASK_DECISION_LIMIT_REASON = '本轮未生成（限额）';

/** The stated reason when neither the stored path nor the cross-project lookup found a file. */
export const SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON = '重算失败：找不到会话转写';

/** The stated reason when the transcript exists but does not carry the card's asking message. */
export const SESSION_ASK_DECISION_ASK_MISSING_REASON = '重算失败：转写里找不到这次提问';

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
   * The stored reading, or null; starts a background repair when it is a disabled-tier skip or
   * a complete digest stored without any suggested option. `messageId` is the asking message the
   * card names; without it the repair follows the transcript's last assistant message.
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

function defaultResolveSession(sessionId: string): {
  title: string;
  jsonlPath: string | null;
  providerSessionId: string | null;
} | null {
  const row = sessionsDb.getSessionById(sessionId);
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
   */
  const writeFailure = (sessionId: string, reason: string): void => {
    const object = store.getObject(formatSessionUri(sessionId));
    if (object === null) return;
    store.writeRevision({
      uri: object.uri,
      kind: 'session',
      title: object.title,
      status: object.status,
      digest: { ...object.digest, askDecision: { state: 'unevaluated', reason } },
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
   */
  const repair = async (
    sessionId: string,
    messageId: string,
    options: { attemptKey: string; expectedAskId?: string },
  ): Promise<void> => {
    const { attemptKey, expectedAskId } = options;
    /** Records the attempt so the next poll does not pay for the same stale reading again. */
    const remember = (): void => {
      attempted.add(attemptKey);
      if (expectedAskId !== undefined) attempted.add(expectedAskId);
    };
    try {
      const resolved = resolveSession(sessionId);
      if (resolved === null) {
        remember();
        writeFailure(sessionId, SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON);
        return;
      }

      let raw = resolved.jsonlPath === null || resolved.jsonlPath === ''
        ? null
        : await readTranscript(resolved.jsonlPath);
      if ((raw === null || raw.trim() === '') && resolved.providerSessionId !== null && resolved.providerSessionId !== undefined) {
        raw = await findTranscript(resolved.providerSessionId);
      }
      if (raw === null || raw.trim() === '') {
        remember();
        writeFailure(sessionId, SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON);
        return;
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

      callTimes.push(now());
      const reading = await summarize.summarize({
        sessionId,
        sessionTitle: resolved.title,
        askId: ask.askId,
        revision: ask.revision,
        assistantText: ask.assistantText,
        context: askReading.context,
      });
      // The switch may have been turned off while the call was in flight; keep the old reading.
      if (reading.state === 'skipped') return;

      const object = store.getObject(formatSessionUri(sessionId));
      if (object === null) return;
      store.writeRevision({
        uri: object.uri,
        kind: 'session',
        title: object.title,
        status: object.status,
        digest: { ...object.digest, askDecision: reading },
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
      );
    }
  };

  return {
    read(sessionId, messageId = '') {
      if (sessionId === '') return null;
      const object = store.getObject(formatSessionUri(sessionId));
      const reading = storedReading(object);
      if (reading === null) return null;

      // The stale shapes this reader repairs, all through the one bounded mechanism above:
      // a disabled-tier skip; an evaluated digest with no judge default; an evaluated digest
      // stored before the assistant quote existed; and a 模型输出不可用 failure stored before the
      // digest's output ceiling was raised.
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
      if (!disabledSkip && !missingDefault && !missingQuote && !failedOutput) return reading;

      const settings = readSettings();
      if (!settings.enabled) return reading;

      // The hourly ceiling is answered synchronously: the stored reading is left untouched and
      // the caller is told why this round produced nothing (the disabled shape) or simply keeps
      // its valid content (the evaluated shapes and a stored model-output failure).
      if (callsInTheLastHour(now()) >= settings.maxPerHour) {
        return disabledSkip ? { state: 'skipped', reason: SESSION_ASK_DECISION_LIMIT_REASON } : reading;
      }

      // An evaluated reading already names its ask, so the attempt is keyed by askId. The other
      // two shapes must identify the ask from the transcript first, so their key names the card.
      const expectedAskId = reading.state === 'evaluated' ? reading.askId : undefined;
      const shape = disabledSkip ? 'disabled' : failedOutput ? 'output' : missingQuote ? 'quote' : 'default';
      const attemptKey = expectedAskId ?? `${sessionId}\u0000${messageId}\u0000${shape}`;
      if (attempted.has(attemptKey)) return reading;
      // A temporal miss schedules itself: until the interval has elapsed the stored reading is
      // the answer (「暂不可判定」), and no second transcript read is paid for.
      const retry = retries.get(attemptKey);
      if (retry !== undefined && retry.nextAt > now()) return reading;

      const key = `${sessionId}\u0000${messageId}\u0000${shape}`;
      if (!inflight.has(key)) {
        const started = repair(sessionId, messageId, { attemptKey, expectedAskId });
        inflight.set(key, started);
        void started.then(() => {
          if (inflight.get(key) === started) inflight.delete(key);
        });
      }
      return reading;
    },

    async settled() {
      // Reads that arrive while a repair is settling may start the next one, so drain to empty.
      while (inflight.size > 0) await Promise.all([...inflight.values()]);
    },
  };
}
