/**
 * The cockpit's read path into one session's T1 ask digest — and the repair of a digest that
 * was stored while the tier was still switched off.
 *
 * WHY IT EXISTS. The tier wrote `{ state: 'skipped', reason: '未启用 …' }` for every asking turn
 * that arrived before `observation.sessionDigest` was enabled, and only that session's NEXT turn
 * recomputes it. A person who enables the setting therefore keeps reading 「提问决策摘要未启用」 on
 * cards that are still open. This reader detects exactly that stale reading on the first read
 * after the setting is enabled, recomputes it from the session's last assistant message, and
 * writes the result back through the observation store.
 *
 * IT IS A REPAIR, NOT A SECOND PRODUCER. The read itself stays synchronous (the card projection
 * calls it in a loop), so the recompute is started in the background and the caller keeps the
 * stored reading for that frame; the repaired reading is what the next read answers. Nothing here
 * ever throws into the read path.
 *
 * CALLS ARE BOUNDED. One attempt per `<sessionId>:<askId>` — a failed attempt is remembered too,
 * so a broken gateway is not retried on every poll. The per-process sliding hour honours the
 * tier's own `maxPerHour`; once it is spent the stale reading is left untouched and the read
 * answers 「本轮未生成（限额）」.
 *
 * Consumers: `server/cockpit-fleet-wiring.ts` (the card provider's `readSessionAsk` seam) and
 * `tests/session-ask-decision-digest.test.ts` (which drives the repair over a memory store).
 */
import { readFile } from 'node:fs/promises';

import { sessionsDb } from '@/modules/database/index.js';
import type { SessionAskDecisionReading } from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

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
  resolveSession?: (sessionId: string) => { title: string; jsonlPath: string | null } | null;
  /** Reads a transcript file, answering `null` when it cannot be read. Defaults to `fs.readFile`. */
  readTranscript?: (jsonlPath: string) => Promise<string | null>;
  /** The clock. Defaults to `Date.now`. */
  now?: () => number;
};

/** The read surface the cockpit's content seam consumes. */
export type SessionAskDecisionReader = {
  /** The stored reading, or null; starts a background repair when it is a disabled-tier skip. */
  read(sessionId: string): SessionAskDecisionReading | null;
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

function defaultResolveSession(sessionId: string): { title: string; jsonlPath: string | null } | null {
  const row = sessionsDb.getSessionById(sessionId);
  if (row === null) return null;
  return { title: (row.custom_name ?? '').trim() || sessionId, jsonlPath: row.jsonl_path ?? null };
}

async function defaultReadTranscript(jsonlPath: string): Promise<string | null> {
  try {
    return await readFile(jsonlPath, 'utf8');
  } catch {
    return null;
  }
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
  const now = deps.now ?? (() => Date.now());

  const inflight = new Map<string, Promise<void>>();
  const attempted = new Set<string>();
  const callTimes: number[] = [];

  /** Prunes the sliding hour and answers how many calls it still holds. */
  const callsInTheLastHour = (at: number): number => {
    while (callTimes.length > 0 && at - (callTimes[0] ?? at) >= ONE_HOUR_MS) callTimes.shift();
    return callTimes.length;
  };

  /** Recomputes one session's skipped reading and writes the result back; never rejects. */
  const repair = async (sessionId: string): Promise<void> => {
    try {
      const resolved = resolveSession(sessionId);
      if (resolved === null || resolved.jsonlPath === null) return;
      const raw = await readTranscript(resolved.jsonlPath);
      if (raw === null) return;

      const askReading = readSessionAsk(raw, sessionId);
      const ask = askReading.current;
      if (ask === null) return;
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
    } catch {
      // A repair must never fail the card read it was started from.
    }
  };

  return {
    read(sessionId) {
      if (sessionId === '') return null;
      const object = store.getObject(formatSessionUri(sessionId));
      const reading = storedReading(object);
      if (reading === null) return null;
      if (reading.state !== 'skipped' || !reading.reason.includes(DISABLED_REASON_TOKEN)) return reading;

      const settings = readSettings();
      if (!settings.enabled) return reading;

      // The hourly ceiling is answered synchronously: the stored reading is left untouched and
      // the caller is told why this round produced nothing.
      if (callsInTheLastHour(now()) >= settings.maxPerHour) {
        return { state: 'skipped', reason: SESSION_ASK_DECISION_LIMIT_REASON };
      }

      if (!inflight.has(sessionId)) {
        const started = repair(sessionId);
        inflight.set(sessionId, started);
        void started.then(() => {
          if (inflight.get(sessionId) === started) inflight.delete(sessionId);
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
