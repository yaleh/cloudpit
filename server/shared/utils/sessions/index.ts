import fs from 'node:fs';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AnyRecord, ClaudeBackgroundSessionOwner, ClaudeSessionOccupancy, ClaudeSessionRegistryLister } from '../../types/index.js';

// ---------------------------
//----------------- CLAUDE SESSION REGISTRY / OCCUPANCY UTILITIES ------------
/**
 * The config directory the Claude CLI this backend spawns will write its
 * transcript and session registry to.
 *
 * Read from the host's own environment rather than from a turn's option bag,
 * because the launch builder builds the child's environment from `process.env`
 * and ignores any `env` the caller supplied — so the bag is not what the process
 * was given, and reading it would be reading a value that never reached the CLI.
 *
 * Consumed by the Claude resident host driver (its Remote Control gate and its
 * occupancy gate) and by `readClaudeSessionOccupancy`'s default below.
 */
export function resolveClaudeConfigDir(): string {
  const fromEnv = process.env.CLAUDE_CONFIG_DIR;
  return fromEnv && fromEnv.trim() ? fromEnv : path.join(os.homedir(), '.claude');
}

/** The real directory listing, and the default every reader here is built on. */
const listSessionRegistryFiles: ClaudeSessionRegistryLister = (sessionsDirectory) =>
  fs.readdirSync(sessionsDirectory);

/**
 * Whether a registry row's process is still the process that wrote it.
 *
 * A registry file outlives a process that died without cleaning up, and pids are
 * recycled on a busy host, so "a signal can be delivered to that pid" is not
 * enough. Where `/proc` is readable the row's `procStart` (the process's start
 * time in clock ticks, field 22 of `/proc/<pid>/stat`) is compared as well; where
 * it is not, the signal probe alone decides. `EPERM` means the process exists
 * under another user, which is alive.
 */
function isRegistryProcessAlive(pid: number, procStart: string | null): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') {
      return false;
    }
  }
  if (!procStart) {
    return true;
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command name is parenthesised and may itself contain spaces or
    // parentheses, so the fields are counted from the last `)`.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    // Field 22 overall; the slice starts at field 3.
    return fields[19] === procStart;
  } catch {
    return true;
  }
}

/**
 * One parsed registry row, and the conversation it holds.
 *
 * The judgement is separated from the scan so the two readers below cannot
 * disagree about what an owner is. It answers with the row's *own* session id
 * rather than being told which id to look for, which is what lets a whole-table
 * reader key its table a row at a time instead of re-running the comparison
 * once per candidate.
 */
type ClaudeRegistryOccupant = { sessionId: string; owner: ClaudeBackgroundSessionOwner };

/**
 * Whether one parsed row is a live background job, and if so for which
 * conversation.
 *
 * `kind: "bg"` is the CLI's own mark for the agents view and `claude --bg`;
 * this app's resident processes register as `interactive` and are never an
 * owner. The pid has to be *the process that wrote the row* — see
 * {@link isRegistryProcessAlive} — because a registry file outlives a process
 * that died without cleaning up.
 *
 * `jobId` is the handle `claude stop` takes. The CLI writes one, but a row
 * without it still identifies the job well enough to name a command, so the
 * session id's first eight characters stand in for it — which is also the shape
 * the CLI prints as the short job id.
 */
function readRegistryOccupantRow(row: AnyRecord): ClaudeRegistryOccupant | null {
  if (row?.kind !== 'bg' || typeof row.sessionId !== 'string' || !row.sessionId) {
    return null;
  }
  if (typeof row.pid !== 'number') {
    return null;
  }
  if (!isRegistryProcessAlive(row.pid, typeof row.procStart === 'string' ? row.procStart : null)) {
    return null;
  }
  return {
    sessionId: row.sessionId,
    owner: {
      pid: row.pid,
      jobId: typeof row.jobId === 'string' && row.jobId ? row.jobId : row.sessionId.slice(0, 8),
      name: typeof row.name === 'string' && row.name ? row.name : null,
    },
  };
}

/**
 * The whole registry read once: every live background job, keyed by the
 * conversation it holds.
 *
 * Unreadable or unparseable rows are skipped, not errors: the registry is
 * another process's file, and one malformed row must not hide a real owner.
 * Where two rows claim the same conversation the first one wins, which is what
 * the single-conversation scan this replaced did — the registry is written one
 * file per process, so a duplicate means a recycled pid whose old file was never
 * cleaned up, and the row that sorts first is as good an answer as the other.
 *
 * Consumed by `findBackgroundSessionOwner` below and by `readClaudeSessionOccupancy`
 * (the host listing's whole-table reader); the two share this scan so a rule that
 * held for one could not disagree with the other.
 */
export function scanSessionRegistry(
  configDir: string,
  listFiles: ClaudeSessionRegistryLister,
): Map<string, ClaudeBackgroundSessionOwner> {
  const occupants = new Map<string, ClaudeBackgroundSessionOwner>();
  let files: string[];
  try {
    files = listFiles(path.join(configDir, 'sessions'));
  } catch {
    return occupants;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) {
      continue;
    }
    let row: AnyRecord;
    try {
      row = JSON.parse(fs.readFileSync(path.join(configDir, 'sessions', file), 'utf8'));
    } catch {
      continue;
    }
    const occupant = readRegistryOccupantRow(row);
    if (!occupant || occupants.has(occupant.sessionId)) {
      continue;
    }
    occupants.set(occupant.sessionId, occupant.owner);
  }
  return occupants;
}

/**
 * The live Claude Code background job holding a conversation, or null.
 *
 * Claude Code refuses to resume a session that a background job (`claude --bg`,
 * the agents view) is running — the child exits with code 1 and says so only on
 * stderr — so a launch has to ask before it spawns one that cannot live. A job
 * that was detached from a terminal (`←` in `claude attach`) keeps running and
 * keeps its row, so detaching does not free the session; only `claude stop` does.
 *
 * Consumed by the Claude resident host driver (before it opens a resident host)
 * and by the Claude per-run runtime (before it creates a query). Those two
 * launch paths are the only consumers, and they share this one reader and the
 * refusal built from its answer.
 */
export function findBackgroundSessionOwner(
  configDir: string,
  providerSessionId: string | null | undefined,
): ClaudeBackgroundSessionOwner | null {
  if (!providerSessionId) {
    return null;
  }
  return scanSessionRegistry(configDir, listSessionRegistryFiles).get(providerSessionId) ?? null;
}

/**
 * Every conversation a Claude Code background job is holding on this host, keyed
 * by session id.
 *
 * Read from the registry the CLI this app spawns would write to: the config
 * directory is resolved here rather than taken as a parameter, exactly as the
 * resident launch resolves it, because the child's environment is built from
 * `process.env` and this is the directory the process would really register in.
 *
 * One scan for the whole answer, which is the shape the host listing needs: it
 * asks once per request for every session it is about to report, and it is
 * polled once a second. The `configDir` / `listFiles` parameters exist so a
 * criterion can point the same reader at a registry it owns and count the scans;
 * production callers pass neither.
 *
 * Re-exported through the providers barrel (via the Claude host driver) for
 * `server/index.ts`'s listing.
 */
export function readClaudeSessionOccupancy(
  configDir: string = resolveClaudeConfigDir(),
  listFiles: ClaudeSessionRegistryLister = listSessionRegistryFiles,
): Map<string, ClaudeSessionOccupancy> {
  const occupancy = new Map<string, ClaudeSessionOccupancy>();
  for (const [sessionId, owner] of scanSessionRegistry(configDir, listFiles)) {
    occupancy.set(sessionId, { jobId: owner.jobId, pid: owner.pid });
  }
  return occupancy;
}

/**
 * The refusal to resume a conversation a background job is holding.
 *
 * Thrown from a launch before any process exists, for the same reason the Remote
 * Control gate throws: the run has no room for an answer, and the dispatch
 * already handles a rejected run. `code` and `owner` are fields so a caller
 * branches on values; `message` is the sentence the user reads.
 *
 * Consumed by the Claude resident host driver and the Claude per-run runtime,
 * which throw the identical refusal so both server paths reject an occupied
 * session with the same words.
 */
export class ClaudeSessionOccupiedError extends Error {
  readonly code = 'session-occupied';
  readonly owner: ClaudeBackgroundSessionOwner;

  constructor(owner: ClaudeBackgroundSessionOwner) {
    super(
      `该会话正由 Claude Code 后台任务占用（job ${owner.jobId}，pid ${owner.pid}），Cloudpit 无法接管。` +
        `请先执行 \`claude stop ${owner.jobId}\` 停止它后重试，或 fork 该会话。`,
    );
    this.name = 'ClaudeSessionOccupiedError';
    this.owner = owner;
  }
}

