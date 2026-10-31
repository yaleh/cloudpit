/**
 * The session's mention reading: which tasks and goals this conversation NAMES in its message text.
 *
 * This is a different question from `session-task-chain.service.ts`. The chain asks "which tasks
 * did this session WRITE" and reads tool calls; this service asks "which tasks and goals does the
 * prose TALK ABOUT" and reads only the user/assistant message bodies. Tool calls, tool results,
 * thinking blocks and non-message rows (attachments, queue operations, snapshots) are deliberately
 * outside the scan: measured on this project's recent sessions, counting tool blocks multiplied
 * the reading by roughly ten and named nothing a person had actually said.
 *
 * The scan is over the WHOLE transcript, not a recent window: what a conversation mentioned an
 * hour ago is still what it mentioned, and a window would make the reading depend on how long the
 * turn had been running. It is incremental — each session remembers the byte offset it has
 * consumed (always on a line boundary), so a transcript that grows while a turn runs is read once
 * per appended chunk rather than whole on every poll.
 *
 * WHAT THE CACHE HOLDS: candidate tokens and their tallies, never the vocabulary join. Tasks are
 * created mid-conversation, so the vocabulary grows; a cache keyed to one vocabulary snapshot
 * would hide a task whose id was already spoken before it was filed. Every request joins the
 * cached tokens against the CURRENT task/goal index instead.
 *
 * PROVIDER FORMATS ARE NOT READ HERE. A transcript row is handed to the provider that owns its
 * format (`IProviderSessions.readTranscriptMessage`, reached through the registry and injected by
 * `quay.module.ts`). This service only sees role + prose + timestamp, so adding a provider means
 * implementing the capability, not teaching Quay a second JSON shape.
 *
 * READ-ONLY BY CONSTRUCTION. Every dependency is a reader, injected by `quay.module.ts`, and the
 * service's one verb answers a reading.
 *
 * WHERE THE VOCABULARY COMES FROM, AND HOW FRESH IT IS. Task rows are taken from the event-driven
 * task index whenever that index is genuinely event-fresh — the project's monitor is `active` and
 * the index is `ready` (inside its TTL). That costs zero CLI spawns, but it is the one place this
 * reading can be STALE: a hand edit of a task file emits no event, so under the event path the
 * worst-case lag equals the index's freshness window (the same bound the MCP `changes` tool
 * reports). Every other case — no monitor, a degraded monitor, or a `cold` / `warming` / `stale` /
 * `error` index — falls back to the direct `task list --json --no-body` read, which is exactly
 * today's freshness, and a `cold` / `stale` index is also asked to reload so the NEXT open can
 * use it. Goal rows ride the 60 s single-flight cache in `session-mentions-goal-cache.ts`; a
 * failed goal read is never cached, so it retries on the next request.
 *
 * Consumers: `server/modules/quay/quay.routes.ts` (the `GET /api/quay/:projectId/session-mentions`
 * endpoint) and `server/modules/quay/tests/session-mentions.test.ts` (the criterion), which drives
 * this factory with injected transcript/task/goal/lanes stubs and no subprocess.
 */

import type { ProviderTranscriptMessage, QuayGanttLanes } from '@/shared/types.js';
import { isRecord } from '@/shared/utils.js';

import { createSessionMentionsGoalCache } from './session-mentions-goal-cache.js';

// --------------------------- TRANSCRIPT TEXT ------------

/**
 * The transcript's condition as far as one reading can tell.
 *
 * `unreadable` covers a stat/read failure (the file is missing, detached, or denied) and a
 * session whose provider cannot read a transcript at all. It is deliberately a separate
 * field from an empty `tasks`/`goals` pair: "the conversation said nothing" and "we could not
 * read the conversation" are different answers, and a client that rendered both as the empty
 * state would report a failed read as a successful one.
 */
export type SessionMentionsTranscriptState = 'ok' | 'unreadable';

/**
 * The candidate tokens in one body of text: runs of `[A-Za-z0-9][A-Za-z0-9-]*` that CONTAIN a
 * hyphen.
 *
 * The hyphen requirement is what makes this cache affordable — prose is mostly English words,
 * and caching every one of them per session would grow the cache with the conversation instead
 * of with its mentions. Task ids in this project are all lower-kebab and goal ids are
 * `GOAL-NNN`, so the filter keeps every id-shaped token and almost nothing else. Trailing
 * hyphens are trimmed so an id followed by a dash reads as the id.
 */
export function mentionTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(/[A-Za-z0-9][A-Za-z0-9-]*/g)) {
    const token = match[0].replace(/-+$/, '');
    if (token.includes('-')) tokens.push(token);
  }
  return tokens;
}

// --------------------------- READINGS ------------

/** One task the session mentioned, joined against the store index. */
export type SessionMentionTaskReading = {
  taskId: string;
  title: string;
  status: string;
  /** The phase of the task's in-flight lane interval, or `null` when it is not in flight. */
  phase: string | null;
  /** The goal this task belongs to (`goal_ac` → criterion row → `goal`), or `null`. */
  goalId: string | null;
  /** How many times the id appeared across the session's message bodies. */
  mentionCount: number;
  /** The instant of the most recent mention (the transcript row's `timestamp`), or `null`. */
  lastMentionAt: string | null;
};

/** One goal the session's reading names — directly in the text, through a task, or both. */
export type SessionMentionGoalReading = {
  goalId: string;
  title: string;
  status: string;
  /** How many of the listed tasks point at this goal. */
  viaTaskCount: number;
  /** Whether the goal's own id appeared in the message text. */
  mentionedDirectly: boolean;
};

/** The whole reading the route returns and the title-bar popover renders. */
export type SessionMentionsReading = {
  ok: true;
  sessionId: string;
  projectId: string;
  tasks: SessionMentionTaskReading[];
  goals: SessionMentionGoalReading[];
  /**
   * Whether the transcript itself was readable. `unreadable` is reported alongside empty
   * `tasks`/`goals` so a client can say "could not read the conversation" instead of
   * "the conversation mentioned nothing".
   */
  transcript: SessionMentionsTranscriptState;
  /** Where each vocabulary came from, so a criterion and a debugging reader can tell the arms apart. */
  sources: SessionMentionsSources;
  /** When this reading was assembled (ISO-8601). */
  generatedAt: string;
};

/**
 * The provenance of one reading's two vocabularies. Read-only reporting: no existing field
 * changes shape because of it, and a consumer that does not know the field ignores it.
 */
export type SessionMentionsSources = {
  /** `index` when the event-fresh task index answered; `cli` when this request spawned `task list`. */
  tasks: 'index' | 'cli';
  /** `cache` when the in-process goal cache answered; `cli` when this request spawned `goal list`. */
  goals: 'cache' | 'cli';
};

/** Where a project's event-driven task index stands, as far as this reading cares. */
export type SessionMentionsIndexState = 'cold' | 'warming' | 'ready' | 'stale' | 'error';

/** One task-index row, as the mention join consumes it. */
export type SessionMentionsTaskIndexRow = {
  taskId: string;
  title: string;
  status: string;
  /** The task's `goal_ac`, or `null`; omitted only by a row that never saw a full `task list` load. */
  goalAc?: string | null;
};

/**
 * The task-index reading this service consumes: where the index stands and the rows it holds.
 * A `ready` index under an `active` monitor is the only combination served without a CLI read.
 */
export type SessionMentionsTaskIndexReading = {
  state: SessionMentionsIndexState;
  tasks: ReadonlyMap<string, SessionMentionsTaskIndexRow>;
};

/** The event monitor's state, narrowed to the one question this service asks of it. */
export type SessionMentionsMonitorState = {
  state: 'off' | 'active' | 'degraded';
};

/** One task row of the project's index, as the reader hands it over. */
export type SessionMentionsTaskRow = {
  taskId: string;
  title: string;
  status: string;
  /** The task's `goal_ac` field: an AC id, or `null` when the task carries none. */
  goalAc: string | null;
};

/**
 * One row of `quay goal list --json`. A `goal` row is a goal (`id` is `GOAL-NNN`); a `criterion`
 * row is an AC whose `goal` field names the goal it belongs to.
 */
export type SessionMentionsGoalRow = {
  id: string;
  title: string;
  status: string;
  kind: string | null;
  goal: string | null;
};

/**
 * Everything the service reads from. All of it is injected so the criterion can drive the
 * production join with stubs and no filesystem, CLI or lane state.
 *
 * `readTaskRows`/`readGoalRows` answer `null` when the read failed; a failed vocabulary read
 * degrades the reading to the arm it can still answer rather than inventing hits.
 */
export type SessionMentionsDependencies = {
  /** The project path for a project id, or `null` when the project is unknown. */
  resolveProjectPath(projectId: string): string | null;
  /** The session's transcript (JSONL) path, or `null` when the session is not known here. */
  resolveTranscriptPath(input: { projectId: string; sessionId: string }): string | null;
  /**
   * The transcript's size in bytes plus a cheap file identity (device + inode on this host), or
   * `null` when it cannot be stat-ed.
   *
   * The identity is what catches a file REPLACED by another of the same or larger size: a size
   * alone only detects truncation (`size < offset`). A null identity means the host could not
   * provide one, and the scan falls back to the size check.
   */
  transcriptStat(transcriptPath: string): Promise<{ size: number; identity: string | null } | null>;
  /** Bytes from `start` to EOF, decoded as UTF-8, or `null` when the file cannot be read. */
  readTranscriptRange(transcriptPath: string, start: number): Promise<string | null>;
  /**
   * The prose reader for the provider that owns this session's transcript, or `null` when the
   * session's provider cannot read prose from a transcript.
   *
   * Resolved once per reading, never per row. Quay does not know which provider a row belongs
   * to — the provider's own format does — so this is the dependency through which provider
   * formats stay in `server/modules/providers/`.
   */
  resolveTranscriptMessageReader(input: {
    projectId: string;
    sessionId: string;
  }): ((row: unknown) => ProviderTranscriptMessage | null) | null;
  /** The project's task index rows (ids/titles/statuses/`goal_ac`), or `null` on a failed read. */
  readTaskRows(projectPath: string): Promise<readonly SessionMentionsTaskRow[] | null>;
  /** The project's `quay goal list --json` rows (goals AND criteria), or `null` on a failed read. */
  readGoalRows(projectPath: string): Promise<readonly SessionMentionsGoalRow[] | null>;
  /**
   * The project's task index as of its last load, WITHOUT loading. Reading it is also this
   * project's activity signal, which is what activates (and keeps alive) the event monitor.
   */
  readTaskIndex(projectId: string): SessionMentionsTaskIndexReading;
  /** The project's event monitor state; only `active` makes the index event-fresh. */
  readMonitorState(projectId: string): SessionMentionsMonitorState;
  /** Asks for a background index load; returns at once. Used when the index is `cold` / `stale`. */
  requestTaskIndexLoad(projectId: string): void;
  /** The project's packed lanes for the in-flight phase join, or `null` when unreadable. */
  readLanes(input: { projectId: string; projectPath: string }): Promise<QuayGanttLanes | null>;
  now(): number;
};

/** The service's one verb. `null` means the project (or its session) is not known here. */
export type SessionMentionsService = {
  readSessionMentions(input: { projectId: string; sessionId: string }): Promise<SessionMentionsReading | null>;
};

// --------------------------- SERVICE ------------

/** How many session scan caches to keep before dropping the least recently created. */
const MAX_CACHED_SESSIONS = 200;

/** One candidate token's tally across the consumed part of a transcript. */
type MentionTally = {
  count: number;
  /** The latest mention instant seen (a non-null transcript timestamp), or `null`. */
  lastMentionAt: string | null;
};

/** One session's incremental transcript scan. Holds tokens + tallies, never a vocabulary join. */
type TranscriptScanCache = {
  transcriptPath: string;
  /** The file identity the consumed offset belongs to, or `null` when the host gave none. */
  identity: string | null;
  /** The number of bytes already consumed; always sits on a line boundary. */
  offset: number;
  mentions: Map<string, MentionTally>;
};

/**
 * The index reading's rows, narrowed to the join's own row shape. A row that never saw a full
 * load omits `goalAc`; that defaults to `null` here rather than leaking `undefined` into the join.
 */
function indexTaskRows(reading: SessionMentionsTaskIndexReading): SessionMentionsTaskRow[] {
  const rows: SessionMentionsTaskRow[] = [];
  for (const row of reading.tasks.values()) {
    rows.push({
      taskId: row.taskId,
      title: row.title,
      status: row.status,
      goalAc: row.goalAc ?? null,
    });
  }
  return rows;
}

/** The in-flight phase of each task named by a lane set; the latest interval wins. */
function inFlightPhases(lanes: QuayGanttLanes | null): Map<string, string> {
  const phases = new Map<string, string>();
  if (lanes === null) return phases;

  const latestStart = new Map<string, number>();
  for (const lane of lanes.lanes) {
    for (const interval of lane) {
      if (interval.phase === null) continue;
      const key = interval.taskId.toLowerCase();
      const previous = latestStart.get(key);
      if (previous !== undefined && previous >= interval.startMs) continue;
      latestStart.set(key, interval.startMs);
      phases.set(key, interval.phase);
    }
  }
  return phases;
}

/** The instant a transcript timestamp names, or `null` when it is absent/unparseable. */
function timestampEpochMs(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The deterministic task order: most recently mentioned first, ties (and rows with no timestamp)
 * broken by task id. A row with no instant has no position on the time axis, so it sorts after
 * every dated row rather than at an arbitrary end of it.
 */
function compareTaskReadings(a: SessionMentionTaskReading, b: SessionMentionTaskReading): number {
  const aMs = timestampEpochMs(a.lastMentionAt);
  const bMs = timestampEpochMs(b.lastMentionAt);
  if (aMs !== bMs) {
    if (aMs === null) return 1;
    if (bMs === null) return -1;
    return bMs - aMs;
  }
  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
}

/** The deterministic goal order: by goal id. */
function compareGoalReadings(a: SessionMentionGoalReading, b: SessionMentionGoalReading): number {
  return a.goalId < b.goalId ? -1 : a.goalId > b.goalId ? 1 : 0;
}

/**
 * Creates the session → mentions reader over its injected world.
 *
 * A session's transcript is scanned incrementally: the cache records the byte offset consumed so
 * far, and only complete JSONL lines are consumed (a trailing partial line waits for the next
 * poll). Re-reading therefore cannot double-count. A transcript that shrank — a new session file
 * reusing the id — resets the scan instead of reading from the middle of a row, and so does a
 * file whose identity changed while the path stayed the same (an atomic replace by a rollover or
 * a restored transcript). A changed PATH (the session's binding now points elsewhere) starts a
 * fresh scan cache outright.
 */
export function createSessionMentionsService(
  dependencies: SessionMentionsDependencies,
): SessionMentionsService {
  const scans = new Map<string, TranscriptScanCache>();
  // The goal vocabulary is slow-moving, so one project's successful read serves a 60 s window
  // and concurrent requests share a single spawn. A failed read is never cached (the cache
  // module owns that rule), so a transient failure retries on the next request.
  const goalCache = createSessionMentionsGoalCache<SessionMentionsGoalRow>({
    readGoalRows: (projectPath) => dependencies.readGoalRows(projectPath),
    now: () => dependencies.now(),
  });

  const scanCacheKey = (projectId: string, sessionId: string): string => `${projectId}\u0000${sessionId}`;

  const scanFor = (cacheKey: string, transcriptPath: string): TranscriptScanCache => {
    const existing = scans.get(cacheKey);
    if (existing !== undefined && existing.transcriptPath === transcriptPath) {
      return existing;
    }
    const fresh: TranscriptScanCache = {
      transcriptPath,
      identity: null,
      offset: 0,
      mentions: new Map(),
    };
    // Re-inserting keeps Map order as "least recently created", which is the eviction order.
    scans.delete(cacheKey);
    scans.set(cacheKey, fresh);
    if (scans.size > MAX_CACHED_SESSIONS) {
      const oldest = scans.keys().next().value;
      if (oldest !== undefined) scans.delete(oldest);
    }
    return fresh;
  };

  /** Tallies one body of text's candidate tokens; the latest non-null instant is kept. */
  const recordText = (scan: TranscriptScanCache, text: string, timestamp: string | null): void => {
    for (const token of mentionTokens(text)) {
      const key = token.toLowerCase();
      const existing = scan.mentions.get(key);
      if (existing === undefined) {
        scan.mentions.set(key, { count: 1, lastMentionAt: timestamp });
        continue;
      }
      existing.count += 1;
      if (timestamp !== null) existing.lastMentionAt = timestamp;
    }
  };

  /**
   * Consumes whatever the transcript appended since the last scan.
   *
   * Answers whether the transcript was readable at all. A `null` stat or read is a FAILED READ,
   * not an empty transcript: the caller reports it as `unreadable` rather than pretending the
   * conversation mentioned nothing. A failed read leaves the cursor untouched, so the next open
   * retries from the same offset once the file is readable again.
   */
  const readNewTranscriptLines = async (
    scan: TranscriptScanCache,
    readMessage: (row: unknown) => ProviderTranscriptMessage | null,
  ): Promise<boolean> => {
    const stat = await dependencies.transcriptStat(scan.transcriptPath);
    if (stat === null) return false;

    const replacedByIdentity = scan.identity !== null && stat.identity !== null && stat.identity !== scan.identity;
    if (stat.size < scan.offset || replacedByIdentity) {
      // The file was replaced under the same session id (a rollover, a restore, or a shorter
      // rewrite): start over rather than read from the middle of a row.
      scan.offset = 0;
      scan.mentions.clear();
    }
    scan.identity = stat.identity;
    if (stat.size === scan.offset) return true;

    const appended = await dependencies.readTranscriptRange(scan.transcriptPath, scan.offset);
    if (appended === null) return false;

    // Only complete lines are consumed; a turn still streaming its last line is read next time.
    const lastNewline = appended.lastIndexOf('\n');
    if (lastNewline === -1) return true;
    const complete = appended.slice(0, lastNewline + 1);
    scan.offset += Buffer.byteLength(complete, 'utf8');

    for (const line of complete.split('\n')) {
      if (line.trim() === '') continue;
      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        // A torn line is not a reason to drop the rest of the transcript.
        continue;
      }
      const message = readMessage(row);
      if (message === null) continue;
      recordText(scan, message.text, message.timestamp);
    }
    return true;
  };


  const readSessionMentions = async (input: {
    projectId: string;
    sessionId: string;
  }): Promise<SessionMentionsReading | null> => {
    const projectPath = dependencies.resolveProjectPath(input.projectId);
    if (projectPath === null) return null;

    const transcriptPath = dependencies.resolveTranscriptPath(input);
    if (transcriptPath === null) return null;

    const scan = scanFor(scanCacheKey(input.projectId, input.sessionId), transcriptPath);
    const readMessage = dependencies.resolveTranscriptMessageReader(input);
    // A session whose provider has no transcript-prose reader cannot be scanned — report that as
    // an unreadable transcript rather than as a conversation that mentioned nothing.
    const transcriptReadable = readMessage === null ? false : await readNewTranscriptLines(scan, readMessage);

    // Reading the index is also the activity signal that activates this project's event monitor,
    // which is why it happens before the monitor is consulted. Only BOTH answers — an `active`
    // monitor and a `ready` (inside-TTL) index — make the index event-fresh enough to serve.
    const index = dependencies.readTaskIndex(input.projectId);
    const monitorState = dependencies.readMonitorState(input.projectId).state;
    const useIndex = monitorState === 'active' && index.state === 'ready';
    if (!useIndex && (index.state === 'cold' || index.state === 'stale')) {
      // Nothing (or only an aged reading) is in the index: ask for a background load so the NEXT
      // open can serve from it. A `warming` index already has a load in flight.
      dependencies.requestTaskIndexLoad(input.projectId);
    }

    const [taskRows, goalReading, lanes] = await Promise.all([
      // Zero spawns on the index arm; the CLI arm is exactly today's direct read.
      useIndex ? Promise.resolve(indexTaskRows(index)) : dependencies.readTaskRows(projectPath),
      goalCache.read(projectPath),
      dependencies.readLanes({ projectId: input.projectId, projectPath }),
    ]);
    const goalRows = goalReading.rows;

    // The vocabulary. Task ids are lower-kebab (already lower-case); goal ids are `GOAL-NNN`,
    // so every lookup is case-insensitive against a lower-cased key while the reading keeps the
    // vocabulary's canonical spelling.
    const tasksById = new Map<string, SessionMentionsTaskRow>();
    for (const row of taskRows ?? []) {
      tasksById.set(row.taskId.toLowerCase(), row);
    }

    const goalsById = new Map<string, SessionMentionsGoalRow>();
    const goalIdByCriterion = new Map<string, string>();
    for (const row of goalRows ?? []) {
      if (row.kind === 'criterion') {
        if (row.goal !== null && row.goal.trim() !== '') {
          goalIdByCriterion.set(row.id.toUpperCase(), row.goal);
        }
        continue;
      }
      if (row.kind === 'goal') {
        goalsById.set(row.id.toLowerCase(), row);
      }
    }

    const phases = inFlightPhases(lanes);

    const tasks: SessionMentionTaskReading[] = [];
    const directGoalIds = new Set<string>();
    for (const [token, tally] of scan.mentions) {
      const taskRow = tasksById.get(token);
      if (taskRow !== undefined) {
        tasks.push({
          taskId: taskRow.taskId,
          title: taskRow.title,
          status: taskRow.status,
          phase: phases.get(taskRow.taskId.toLowerCase()) ?? null,
          goalId: taskRow.goalAc === null ? null : (goalIdByCriterion.get(taskRow.goalAc.toUpperCase()) ?? null),
          mentionCount: tally.count,
          lastMentionAt: tally.lastMentionAt,
        });
      }
      const goalRow = goalsById.get(token);
      if (goalRow !== undefined) {
        directGoalIds.add(goalRow.id);
      }
    }
    tasks.sort(compareTaskReadings);

    // A goal is listed when the text names it or when a listed task belongs to it. A goal the
    // current goal list no longer holds cannot be given a title/status, so it is not fabricated
    // into a row; the task that points at it still carries its goal id.
    const goalTally = new Map<string, { goalRow: SessionMentionsGoalRow; viaTaskCount: number; mentionedDirectly: boolean }>();
    const noteGoal = (goalId: string): { goalRow: SessionMentionsGoalRow; viaTaskCount: number; mentionedDirectly: boolean } | null => {
      const existing = goalTally.get(goalId);
      if (existing !== undefined) return existing;
      const goalRow = goalsById.get(goalId.toLowerCase());
      if (goalRow === undefined) return null;
      const entry = { goalRow, viaTaskCount: 0, mentionedDirectly: false };
      goalTally.set(goalId, entry);
      return entry;
    };
    for (const goalId of directGoalIds) {
      const entry = noteGoal(goalId);
      if (entry !== null) entry.mentionedDirectly = true;
    }
    for (const task of tasks) {
      if (task.goalId === null) continue;
      const entry = noteGoal(task.goalId);
      if (entry !== null) entry.viaTaskCount += 1;
    }

    const goals: SessionMentionGoalReading[] = [...goalTally.values()]
      .map(({ goalRow, viaTaskCount, mentionedDirectly }) => ({
        goalId: goalRow.id,
        title: goalRow.title,
        status: goalRow.status,
        viaTaskCount,
        mentionedDirectly,
      }))
      .sort(compareGoalReadings);

    return {
      ok: true,
      sessionId: input.sessionId,
      projectId: input.projectId,
      tasks,
      goals,
      transcript: transcriptReadable ? 'ok' : 'unreadable',
      sources: {
        tasks: useIndex ? 'index' : 'cli',
        goals: goalReading.source,
      },
      generatedAt: new Date(dependencies.now()).toISOString(),
    };
  };

  return { readSessionMentions };
}
