#!/usr/bin/env node
/**
 * Repair ONE session whose stored provider binding is internally inconsistent.
 *
 * Two defect shapes are repaired, both narrow and evidence-first:
 *
 *  1. `fork-rebind` — an edit forked the conversation, the row was repointed to
 *     the fork, and a late `session_created` from the pre-edit host wrote the
 *     old thread id back while the row kept the fork's transcript path. The row
 *     then claims thread A while pointing at thread B's file, and the indexer
 *     creates a second sidebar row for B.
 *
 *  2. `null-path-retired` — the row claims a real thread but `jsonl_path` is
 *     NULL, and that same thread is wrongly marked in
 *     `superseded_provider_sessions` for this session. Nothing points at the
 *     transcript, so the sidebar reads the row's stale `updated_at` (hours
 *     behind the conversation) instead of the transcript's activity.
 *
 * This is deliberately narrow and evidence-first:
 *   - it only runs for the session named by `--session`;
 *   - it refuses unless the row, the superseded table, and the transcript still
 *     match one of those shapes (thread id and cwd agree with the row, the file
 *     is readable, and it records an activity timestamp to restore);
 *   - it never edits, truncates or deletes a transcript file;
 *   - it restores `updated_at` from the transcript's own last recorded activity
 *     timestamp, never from the repair's wall clock;
 *   - every write uses the full expected row/ledger values as a compare-and-swap
 *     inside one transaction, so a concurrent rebind or ledger change refuses
 *     instead of overwriting, and a failure leaves nothing half-written;
 *   - it is idempotent: a second run reports `already-consistent`;
 *   - it does not restart the shared service.
 *
 * The repair runs outside the server process, so a committed row is not
 * broadcast. Reload the session list afterwards (the existing `GET
 * /api/projects` path runs the synchronizer and then reads the row) — direct
 * database writes are not announced to connected clients.
 *
 * Usage:
 *   node scripts/repair-session-binding.mjs --session <app-session-id>
 *   node scripts/repair-session-binding.mjs --session <app-session-id> --apply
 *
 * Options:
 *   --db <path>        database file (default: $DATABASE_PATH, else ~/.cloudcli/auth.db)
 *   --apply            commit the repair (default is a dry run)
 *   --evidence <path>  evidence JSON (default: tmp/session-binding-recovery-<id>-<run>.json)
 *
 * Exit codes: 0 repaired / dry-run-ready / already consistent; 2 refused
 * (preconditions do not match); 1 operational failure.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

const SHAPE_FORK_REBIND = 'fork-rebind';
const SHAPE_NULL_PATH_RETIRED = 'null-path-retired';

/**
 * @param {string[]} argv
 * @returns {{ session: string | null, db: string | null, apply: boolean, evidence: string | null }}
 */
export function parseArgs(argv) {
  /** @type {{ session: string | null, db: string | null, apply: boolean, evidence: string | null }} */
  const args = { session: null, db: null, apply: false, evidence: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--session') args.session = argv[++i] ?? null;
    else if (arg === '--db') args.db = argv[++i] ?? null;
    else if (arg === '--evidence') args.evidence = argv[++i] ?? null;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') {
      const source = fs.readFileSync(new URL(import.meta.url), 'utf8');
      const end = source.indexOf('\n */');
      console.log(source.slice(0, end + 4).replace(/^#!.*\n/, ''));
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!args.session) throw new Error('--session <app-session-id> is required');
  return args;
}

/**
 * @param {string | null | undefined} explicit
 * @returns {string}
 */
export function resolveDatabasePath(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.DATABASE_PATH) return path.resolve(process.env.DATABASE_PATH);
  return path.join(os.homedir(), '.cloudcli', 'auth.db');
}

/**
 * Where Codex rollouts are looked up. `CODEX_SESSIONS_ROOT` exists so a test can
 * point the walk at a fixture tree instead of the host's real `~/.codex`.
 * @returns {string}
 */
function resolveCodexSessionsRoot() {
  if (process.env.CODEX_SESSIONS_ROOT) return path.resolve(process.env.CODEX_SESSIONS_ROOT);
  return path.join(os.homedir(), '.codex', 'sessions');
}

const THREAD_ID_IN_FILENAME = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/**
 * @param {string | null | undefined} filePath
 * @returns {string | null}
 */
export function readThreadIdFromPath(filePath) {
  if (!filePath) return null;
  const match = path.basename(filePath).match(THREAD_ID_IN_FILENAME);
  return match ? match[1] : null;
}

/**
 * Converts a transcript timestamp to the database's UTC `YYYY-MM-DD HH:MM:SS`
 * form. Returns null for anything the database layer could not parse — writing
 * such a value would fall back to CURRENT_TIMESTAMP, i.e. the repair time.
 * @param {string | null | undefined} timestamp
 * @returns {string | null}
 */
export function toSqliteUtc(timestamp) {
  if (typeof timestamp !== 'string' || !timestamp.trim()) return null;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * @typedef {{
 *   path: string | null,
 *   exists: boolean,
 *   lines: number,
 *   turnCompletes: number,
 *   sessionMeta: any,
 *   lastActivity: string | null,
 *   bytes?: number,
 *   error?: string,
 * }} TranscriptReading
 */

/**
 * Reads the first `session_meta` row, the last recorded activity timestamp, and
 * a few content readings from a rollout.
 *
 * The activity reading mirrors the server's transcript reader: the last record
 * carrying a parseable top-level `timestamp` wins, and maintenance records
 * without one are skipped rather than read as activity.
 *
 * @param {string | null | undefined} filePath
 * @returns {TranscriptReading}
 */
export function inspectTranscript(filePath) {
  if (!filePath) {
    return { path: null, exists: false, lines: 0, turnCompletes: 0, sessionMeta: null, lastActivity: null };
  }
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    let sessionMeta = null;
    let turnCompletes = 0;
    let lastActivity = null;
    for (const line of lines) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!sessionMeta && row?.type === 'session_meta') sessionMeta = row.payload ?? null;
      if (row?.type === 'event_msg' && row?.payload?.type === 'task_complete') turnCompletes += 1;
      const recorded = row?.timestamp;
      if (typeof recorded === 'string' && !Number.isNaN(new Date(recorded).getTime())) {
        lastActivity = recorded;
      }
    }
    return {
      path: filePath,
      exists: true,
      bytes: fs.statSync(filePath).size,
      lines: lines.length,
      turnCompletes,
      sessionMeta,
      lastActivity,
    };
  } catch (error) {
    return {
      path: filePath,
      exists: false,
      lines: 0,
      turnCompletes: 0,
      sessionMeta: null,
      lastActivity: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Finds a thread's rollout under the Codex sessions tree (bounded to that tree).
 * @param {string} threadId
 * @returns {string | null}
 */
export function findThreadTranscript(threadId) {
  const root = resolveCodexSessionsRoot();
  const wanted = new RegExp(`-${threadId.replace(/[-]/g, '\\-')}\\.jsonl$`, 'i');
  /** @type {(directory: string, depth: number) => string | null} */
  const walk = (directory, depth) => {
    if (depth > 5) return null;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const found = walk(entryPath, depth + 1);
        if (found) return found;
      } else if (wanted.test(entry.name)) {
        return entryPath;
      }
    }
    return null;
  };
  return walk(root, 0);
}

/**
 * @typedef {{
 *   session: any,
 *   superseded: any[],
 *   supersededRow: any | null,
 *   pathThreadId: string | null,
 *   targetPath: string | null,
 *   target: TranscriptReading,
 *   fork: TranscriptReading,
 * }} BindingState
 */

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} sessionId
 * @returns {BindingState | null}
 */
export function readState(db, sessionId) {
  /** @type {any} */
  const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  if (!session) return null;
  /** @type {any[]} */
  const superseded = db
    .prepare('SELECT * FROM superseded_provider_sessions WHERE session_id = ?')
    .all(sessionId);
  const pathThreadId = readThreadIdFromPath(session.jsonl_path);
  const supersededRow =
    superseded.find((row) => row.provider_session_id === session.provider_session_id) ?? null;
  const targetPath = supersededRow?.jsonl_path ?? findThreadTranscript(session.provider_session_id ?? '');
  return {
    session,
    superseded,
    supersededRow,
    pathThreadId,
    targetPath,
    target: inspectTranscript(targetPath),
    fork: inspectTranscript(session.jsonl_path),
  };
}

/**
 * @param {string | null | undefined} left
 * @param {string | null | undefined} right
 * @returns {boolean}
 */
function sameProjectPath(left, right) {
  if (!left || !right) return false;
  return path.resolve(left) === path.resolve(right);
}

/**
 * Which repair shape the row is in, independent of whether it is consistent.
 * @param {BindingState} state
 * @returns {'no-provider-binding' | 'consistent' | 'null-path-retired' | 'fork-rebind'}
 */
export function classifyShape(state) {
  const { session } = state;
  if (!session.provider_session_id) return 'no-provider-binding';
  if (state.pathThreadId === session.provider_session_id) return 'consistent';
  if (!session.jsonl_path) return SHAPE_NULL_PATH_RETIRED;
  return SHAPE_FORK_REBIND;
}

/**
 * @param {BindingState} state
 * @returns {{ shape: string, reasons: string[], consistent: boolean }}
 */
export function assess(state) {
  const shape = classifyShape(state);
  if (shape === 'no-provider-binding') {
    return { shape, reasons: ['the row has no provider_session_id'], consistent: false };
  }
  // Idempotency: the binding already names the thread its transcript belongs
  // to. Nothing else about the row is a precondition in that case.
  if (shape === 'consistent') {
    return { shape, reasons: ['the row is already consistent'], consistent: true };
  }

  const { session, supersededRow, target, targetPath } = state;
  const providerSessionId = session.provider_session_id;
  const reasons = [];

  if (!supersededRow || supersededRow.session_id !== session.session_id) {
    reasons.push('the stored provider id is not marked superseded for this session');
  }
  if (!targetPath) {
    reasons.push('the original thread transcript could not be found');
  } else if (readThreadIdFromPath(targetPath) !== providerSessionId) {
    reasons.push('the transcript named for the stored provider id belongs to a different thread');
  }
  if (targetPath && !target.exists) {
    reasons.push('the original thread transcript is not readable');
  }
  if (target.exists) {
    if (target.sessionMeta?.id !== providerSessionId) {
      reasons.push("the transcript's session_meta id does not match the stored provider id");
    }
    if (!sameProjectPath(target.sessionMeta?.cwd, session.project_path)) {
      reasons.push("the transcript's session_meta cwd does not match the session's project path");
    }
    if (!toSqliteUtc(target.lastActivity)) {
      reasons.push('the transcript records no activity timestamp to restore');
    }
  }

  if (shape === SHAPE_FORK_REBIND) {
    if (!state.pathThreadId) reasons.push('the transcript path does not name a provider thread');
    if (!state.fork.exists) reasons.push('the transcript the row points at does not exist');
    if (state.fork.turnCompletes > 0) {
      reasons.push('the transcript the row points at contains completed turns');
    }
    if (state.fork.sessionMeta?.forked_from_id !== providerSessionId) {
      reasons.push('the transcript the row points at is not a fork of the stored provider id');
    }
    if (target.exists && target.turnCompletes === 0) {
      reasons.push('the original thread has no completed turns to restore');
    }
  }

  return { shape, reasons, consistent: false };
}

/**
 * @param {string} evidencePath
 * @param {any} evidence
 */
function writeEvidence(evidencePath, evidence) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

/**
 * Commits one repair. Every write is guarded by the values read before the
 * transaction started: a rebind, a path change, a timestamp change or a changed
 * superseded row refuses the repair, and the transaction rolls back every write
 * it already made.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {BindingState} state
 * @returns {{ shape: string, providerSessionId: string, jsonlPath: string, updatedAt: string }}
 */
export function applyRepair(db, state) {
  const verdict = assess(state);
  if (verdict.consistent) {
    return {
      shape: verdict.shape,
      providerSessionId: /** @type {string} */ (state.session.provider_session_id),
      jsonlPath: /** @type {string} */ (state.session.jsonl_path),
      updatedAt: state.session.updated_at,
    };
  }
  if (verdict.reasons.length > 0 || !state.targetPath) {
    throw new Error(`refusing to repair: ${verdict.reasons.join('; ')}`);
  }

  const { session, supersededRow, target } = state;
  const providerSessionId = /** @type {string} */ (session.provider_session_id);
  const targetPath = /** @type {string} */ (state.targetPath);
  const updatedAt = toSqliteUtc(target.lastActivity);
  if (!updatedAt) throw new Error('refusing to repair: the transcript records no activity timestamp to restore');

  return db.transaction(() => {
    const updateShape =
      verdict.shape === SHAPE_NULL_PATH_RETIRED
        ? `UPDATE sessions SET
             jsonl_path = @targetPath,
             updated_at = @updatedAt
           WHERE session_id = @sessionId
             AND provider_session_id = @providerSessionId
             AND jsonl_path IS NULL
             AND updated_at IS @expectedUpdatedAt`
        : `UPDATE sessions SET
             provider_session_id = @providerSessionId,
             jsonl_path = @targetPath,
             updated_at = @updatedAt
           WHERE session_id = @sessionId
             AND provider_session_id = @providerSessionId
             AND jsonl_path IS @expectedJsonlPath
             AND updated_at IS @expectedUpdatedAt`;

    const updated = db.prepare(updateShape).run({
      sessionId: session.session_id,
      providerSessionId,
      targetPath,
      updatedAt,
      expectedJsonlPath: session.jsonl_path ?? null,
      expectedUpdatedAt: session.updated_at ?? null,
    });
    if (updated.changes !== 1) {
      throw new Error('the row changed while the repair was running; refusing to overwrite');
    }

    // The old mark was the defect's own claim that the real thread was
    // abandoned. Only this session's unchanged mark for this thread is removed.
    const removed = db.prepare(
      `DELETE FROM superseded_provider_sessions
       WHERE provider_session_id = @providerSessionId
         AND provider = @provider
         AND session_id = @sessionId
         AND jsonl_path IS @supersededJsonlPath`,
    ).run({
      providerSessionId,
      provider: session.provider,
      sessionId: session.session_id,
      supersededJsonlPath: supersededRow?.jsonl_path ?? null,
    });
    if (removed.changes !== 1) {
      throw new Error('the superseded record changed while the repair was running; refusing to overwrite');
    }

    if (verdict.shape === SHAPE_FORK_REBIND) {
      const forkThreadId = state.pathThreadId;
      if (!forkThreadId) throw new Error('refusing to repair: the transcript path does not name a provider thread');

      // The watcher-created row for the metadata-only fork is the same
      // conversation about to be re-indexed under the restored binding.
      db.prepare(
        `DELETE FROM sessions
         WHERE session_id = ? AND session_id <> ? AND provider_session_id = ? AND provider = ?`,
      ).run(forkThreadId, session.session_id, forkThreadId, session.provider);

      // Suppress the abandoned metadata-only fork from the indexer. Its file
      // stays on disk untouched.
      db.prepare(
        `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(provider_session_id, provider) DO UPDATE SET
           session_id = excluded.session_id,
           jsonl_path = excluded.jsonl_path,
           created_at = CURRENT_TIMESTAMP`,
      ).run(forkThreadId, session.provider, session.session_id, session.jsonl_path ?? null);
    }

    return { shape: verdict.shape, providerSessionId, jsonlPath: targetPath, updatedAt };
  })();
}

/**
 * Runs one repair attempt and writes its evidence file.
 *
 * @param {{ sessionId: string, databasePath: string, apply: boolean, evidencePath?: string }} input
 * @returns {{ code: number, result: any }}
 */
export function repairSession(input) {
  const { sessionId, databasePath, apply } = input;
  if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);

  const db = new Database(databasePath);
  db.pragma('busy_timeout = 5000');

  try {
    const before = readState(db, sessionId);
    if (!before) throw new Error(`Session not found: ${sessionId}`);

    const verdict = assess(before);

    /** @type {any} */
    const evidence = {
      session: sessionId,
      databasePath,
      appliedAt: new Date().toISOString(),
      apply,
      shape: verdict.shape,
      restoreUpdatedAt: toSqliteUtc(before.target.lastActivity),
      before: {
        session: before.session,
        superseded: before.superseded,
        pathThreadId: before.pathThreadId,
        target: before.target,
        fork: before.fork,
      },
      after: null,
    };
    // One file per run: the post-repair idempotency check must not overwrite the
    // pre-repair capture that the same session's apply run produced.
    const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
    const evidencePath = path.resolve(
      input.evidencePath
        ?? path.join('tmp', `session-binding-recovery-${sessionId}-${runStamp}.json`),
    );

    evidence.assessment = { reasons: verdict.reasons, consistent: verdict.consistent };

    if (verdict.consistent) {
      writeEvidence(evidencePath, evidence);
      return { code: 0, result: { result: 'already-consistent', evidence: evidencePath } };
    }
    if (verdict.reasons.length > 0) {
      writeEvidence(evidencePath, evidence);
      return {
        code: 2,
        result: { result: 'refused', shape: verdict.shape, reasons: verdict.reasons, evidence: evidencePath },
      };
    }

    const targetPath = /** @type {string} */ (before.targetPath);
    const restoreUpdatedAt = /** @type {string} */ (toSqliteUtc(before.target.lastActivity));

    if (!apply) {
      evidence.would = {
        shape: verdict.shape,
        bindSessionTo: before.session.provider_session_id,
        transcript: targetPath,
        updatedAt: restoreUpdatedAt,
        removeSupersededMarkFor: before.session.provider_session_id,
        ...(verdict.shape === SHAPE_FORK_REBIND
          ? {
              deleteDuplicateRowFor: before.pathThreadId,
              supersedeAbandonedFork: before.pathThreadId,
            }
          : {}),
        preserveTranscriptFiles: [targetPath, before.session.jsonl_path].filter(Boolean),
      };
      writeEvidence(evidencePath, evidence);
      return { code: 0, result: { result: 'dry-run-ready', shape: verdict.shape, would: evidence.would, evidence: evidencePath } };
    }

    const repair = applyRepair(db, before);
    const after = readState(db, sessionId);
    evidence.after = {
      session: after?.session ?? null,
      superseded: after?.superseded ?? [],
      pathThreadId: after?.pathThreadId ?? null,
      target: after?.target ?? null,
    };
    writeEvidence(evidencePath, evidence);

    return {
      code: 0,
      result: {
        result: 'repaired',
        shape: repair.shape,
        session: sessionId,
        providerSessionId: repair.providerSessionId,
        jsonlPath: repair.jsonlPath,
        updatedAt: repair.updatedAt,
        evidence: evidencePath,
      },
    };
  } finally {
    db.close();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outcome = repairSession({
    sessionId: /** @type {string} */ (args.session),
    databasePath: resolveDatabasePath(args.db),
    apply: args.apply,
    evidencePath: args.evidence ?? undefined,
  });
  const stream = outcome.code === 2 ? console.error : console.log;
  stream(JSON.stringify(outcome.result, null, 2));
  return outcome.code;
}

// Importing this module (the test file does) must not run the CLI.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(JSON.stringify({ result: 'error', error: error instanceof Error ? error.message : String(error) }, null, 2));
    process.exitCode = 1;
  }
}
