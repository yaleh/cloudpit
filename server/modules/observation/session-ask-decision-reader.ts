/**
 * The cockpit's read path into one session's T1 ask digest — and the repair of a digest that
 * was stored before the current suggestion rules held.
 *
 * TWO STALE SHAPES ARE REPAIRED ON READ, through one mechanism:
 *
 *   1. A digest stored while the tier was still switched off (`{ state: 'skipped', reason:
 *      '未启用 …' }`). Only that session's NEXT turn recomputes it, so a person who enables the
 *      setting keeps reading 「提问决策摘要未启用」 on cards that are still open.
 *   2. A digest evaluated under the old rule that only the assistant's own recommendation may be
 *      suggested. An `evaluated` reading with options, `incomplete: false` and NO suggested
 *      option is recomputed ONCE so the same call's judge can supply the missing default; the
 *      recompute carries the judge's reason onto the suggested option.
 *
 * IT IS A REPAIR, NOT A SECOND PRODUCER. The read itself stays synchronous (the card projection
 * calls it in a loop), so the recompute is started in the background and the caller keeps the
 * stored reading for that frame; the repaired reading is what the next read answers. Nothing here
 * ever throws into the read path.
 *
 * CALLS ARE BOUNDED. One attempt per `<sessionId>:<askId>` — a failed attempt is remembered too,
 * so a broken gateway is not retried on every poll. The per-process sliding hour honours the
 * tier's own `maxPerHour`; once it is spent the stale reading is left untouched and the read
 * answers 「本轮未生成（限额）」 (the disabled-tier shape) or keeps the stored reading (a digest
 * that is complete but has no default).
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
  const callTimes: number[] = [];

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
   * `expectedAskId` is set only for the missing-default repair: the stored reading already names
   * the ask, so a transcript that no longer carries THAT ask may not overwrite a valid digest
   * with a different turn's content.
   */
  const repair = async (sessionId: string, messageId: string, expectedAskId?: string): Promise<void> => {
    try {
      const resolved = resolveSession(sessionId);
      if (resolved === null) {
        if (expectedAskId !== undefined) attempted.add(expectedAskId);
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
        if (expectedAskId !== undefined) attempted.add(expectedAskId);
        writeFailure(sessionId, SESSION_ASK_DECISION_TRANSCRIPT_MISSING_REASON);
        return;
      }

      const askReading = readSessionAsk(raw, sessionId, messageId);
      const ask = askReading.current;
      if (ask === null) {
        if (expectedAskId !== undefined) attempted.add(expectedAskId);
        writeFailure(sessionId, SESSION_ASK_DECISION_ASK_MISSING_REASON);
        return;
      }
      if (expectedAskId !== undefined && ask.askId !== expectedAskId) {
        attempted.add(expectedAskId);
        writeFailure(sessionId, SESSION_ASK_DECISION_ASK_MISSING_REASON);
        return;
      }
      // A new turn has a new askId, so a repaired session is still eligible for its next ask.
      if (attempted.has(ask.askId)) return;
      attempted.add(ask.askId);

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
      if (expectedAskId !== undefined) attempted.add(expectedAskId);
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

      // The two stale shapes this reader repairs: a disabled-tier skip, and a complete digest
      // stored before the judge could supply a default.
      const disabledSkip = reading.state === 'skipped' && reading.reason.includes(DISABLED_REASON_TOKEN);
      const missingDefault =
        reading.state === 'evaluated' &&
        reading.options.length > 0 &&
        reading.incomplete === false &&
        !reading.options.some((option) => option.suggested);
      if (!disabledSkip && !missingDefault) return reading;

      const settings = readSettings();
      if (!settings.enabled) return reading;

      // The hourly ceiling is answered synchronously: the stored reading is left untouched and
      // the caller is told why this round produced nothing (the disabled shape) or simply keeps
      // its valid content (the missing-default shape).
      if (callsInTheLastHour(now()) >= settings.maxPerHour) {
        return disabledSkip ? { state: 'skipped', reason: SESSION_ASK_DECISION_LIMIT_REASON } : reading;
      }

      const expectedAskId = missingDefault && reading.state === 'evaluated' ? reading.askId : undefined;
      if (expectedAskId !== undefined && attempted.has(expectedAskId)) return reading;

      const key = `${sessionId}\u0000${messageId}\u0000${expectedAskId === undefined ? 'disabled' : 'default'}`;
      if (!inflight.has(key)) {
        const started = repair(sessionId, messageId, expectedAskId);
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
