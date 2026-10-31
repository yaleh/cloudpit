#!/usr/bin/env node
/**
 * Repair ONE session whose stored provider binding is internally inconsistent.
 *
 * The defect this exists for: an edit forked the conversation, the row was
 * repointed to the fork, and a late `session_created` from the pre-edit host
 * wrote the old thread id back while the row kept the fork's transcript path.
 * The row then claims thread A while pointing at thread B's file, and the
 * indexer creates a second sidebar row for B.
 *
 * This is deliberately narrow and evidence-first:
 *   - it only runs for the session named by `--session`;
 *   - it refuses unless the row, the superseded table, and both transcript
 *     files still match that shape (the target thread has conversation turns,
 *     the fork file is metadata-only and names the target as its parent);
 *   - it never edits, truncates or deletes a transcript file;
 *   - it is idempotent: a second run reports `already-consistent`;
 *   - it does not restart the shared service.
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

import Database from 'better-sqlite3';

/**
 * @param {string[]} argv
 * @returns {{ session: string | null, db: string | null, apply: boolean, evidence: string | null }}
 */
function parseArgs(argv) {
  /** @type {{ session: string | null, db: string | null, apply: boolean, evidence: string | null }} */
  const args = { session: null, db: null, apply: false, evidence: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--session') args.session = argv[++i] ?? null;
    else if (arg === '--db') args.db = argv[++i] ?? null;
    else if (arg === '--evidence') args.evidence = argv[++i] ?? null;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 36).join('\n'));
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
function resolveDatabasePath(explicit) {
  if (explicit) return path.resolve(explicit);
  if (process.env.DATABASE_PATH) return path.resolve(process.env.DATABASE_PATH);
  return path.join(os.homedir(), '.cloudcli', 'auth.db');
}

const THREAD_ID_IN_FILENAME = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/**
 * @param {string | null | undefined} filePath
 * @returns {string | null}
 */
function readThreadIdFromPath(filePath) {
  if (!filePath) return null;
  const match = path.basename(filePath).match(THREAD_ID_IN_FILENAME);
  return match ? match[1] : null;
}

/**
 * @typedef {{
 *   path: string | null,
 *   exists: boolean,
 *   lines: number,
 *   turnCompletes: number,
 *   sessionMeta: any,
 *   bytes?: number,
 *   error?: string,
 * }} TranscriptReading
 */

/**
 * Reads the first `session_meta` row, plus a few content readings, from a rollout.
 * @param {string | null | undefined} filePath
 * @returns {TranscriptReading}
 */
function inspectTranscript(filePath) {
  if (!filePath) return { path: null, exists: false, lines: 0, turnCompletes: 0, sessionMeta: null };
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    let sessionMeta = null;
    let turnCompletes = 0;
    for (const line of lines) {
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue;
      }
      if (!sessionMeta && row?.type === 'session_meta') sessionMeta = row.payload ?? null;
      if (row?.type === 'event_msg' && row?.payload?.type === 'task_complete') turnCompletes += 1;
    }
    return {
      path: filePath,
      exists: true,
      bytes: fs.statSync(filePath).size,
      lines: lines.length,
      turnCompletes,
      sessionMeta,
    };
  } catch (error) {
    return { path: filePath, exists: false, lines: 0, turnCompletes: 0, sessionMeta: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Finds a thread's rollout under ~/.codex/sessions (bounded to that tree).
 * @param {string} threadId
 * @returns {string | null}
 */
function findThreadTranscript(threadId) {
  const root = path.join(os.homedir(), '.codex', 'sessions');
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
function readState(db, sessionId) {
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
  const targetPath = supersededRow?.jsonl_path ?? findThreadTranscript(session.provider_session_id);
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
 * @param {BindingState} state
 * @returns {{ reasons: string[], consistent: boolean }}
 */
function assess(state) {
  const { session, supersededRow, target, fork, targetPath } = state;
  if (!session.provider_session_id) {
    return { reasons: ['the row has no provider_session_id'], consistent: false };
  }
  // Idempotency: the binding already names the thread its transcript belongs
  // to. Nothing else about the row is a precondition in that case.
  if (state.pathThreadId === session.provider_session_id) {
    return { reasons: ['the row is already consistent'], consistent: true };
  }

  const reasons = [];
  if (!supersededRow || supersededRow.session_id !== session.session_id) {
    reasons.push('the stored provider id is not marked superseded for this session');
  }
  if (!state.pathThreadId) reasons.push('the transcript path does not name a provider thread');
  if (!fork.exists) reasons.push('the transcript the row points at does not exist');
  if (fork.turnCompletes > 0) reasons.push('the transcript the row points at contains completed turns');
  if (fork.sessionMeta?.forked_from_id !== session.provider_session_id) {
    reasons.push('the transcript the row points at is not a fork of the stored provider id');
  }
  if (!targetPath || !target?.exists) reasons.push('the original thread transcript could not be found');
  if (target && target.turnCompletes === 0) reasons.push('the original thread has no completed turns to restore');

  return { reasons, consistent: false };
}

/**
 * @param {string} evidencePath
 * @param {any} evidence
 */
function writeEvidence(evidencePath, evidence) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sessionId = /** @type {string} */ (args.session);
  const databasePath = resolveDatabasePath(args.db);
  if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);

  const db = new Database(databasePath);
  db.pragma('busy_timeout = 5000');

  const before = readState(db, sessionId);
  if (!before) throw new Error(`Session not found: ${sessionId}`);

  /** @type {{ session: string, databasePath: string, appliedAt: string, apply: boolean,
   *          before: { session: any, superseded: any[], pathThreadId: string | null,
   *                    target: TranscriptReading, fork: TranscriptReading },
   *          after: any, assessment?: { reasons: string[], consistent: boolean } }} */
  const evidence = {
    session: sessionId,
    databasePath,
    appliedAt: new Date().toISOString(),
    apply: args.apply,
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
    args.evidence
      ?? path.join('tmp', `session-binding-recovery-${sessionId}-${runStamp}.json`),
  );

  const verdict = assess(before);
  evidence.assessment = { reasons: verdict.reasons, consistent: verdict.consistent };

  if (verdict.consistent) {
    writeEvidence(evidencePath, evidence);
    console.log(JSON.stringify({ result: 'already-consistent', evidence: evidencePath }, null, 2));
    db.close();
    return 0;
  }
  if (verdict.reasons.length > 0) {
    writeEvidence(evidencePath, evidence);
    console.error(JSON.stringify({ result: 'refused', reasons: verdict.reasons, evidence: evidencePath }, null, 2));
    db.close();
    return 2;
  }

  const targetThreadId = before.session.provider_session_id;
  const forkThreadId = before.pathThreadId;
  const targetPath = before.targetPath;

  if (!args.apply) {
    writeEvidence(evidencePath, evidence);
    console.log(JSON.stringify({
      result: 'dry-run-ready',
      would: {
        bindSessionTo: targetThreadId,
        transcript: targetPath,
        removeSupersededMarkFor: targetThreadId,
        deleteDuplicateRowFor: forkThreadId,
        supersedeAbandonedFork: forkThreadId,
        preserveTranscriptFiles: [targetPath, before.session.jsonl_path],
      },
      evidence: evidencePath,
    }, null, 2));
    db.close();
    return 0;
  }

  const repair = db.transaction(() => {
    const updated = db.prepare(
      `UPDATE sessions
       SET provider_session_id = @targetThreadId,
           jsonl_path = @targetPath,
           updated_at = CURRENT_TIMESTAMP
       WHERE session_id = @sessionId AND provider_session_id = @targetThreadId`,
    ).run({ targetThreadId, targetPath, sessionId });
    if (updated.changes !== 1) {
      throw new Error('the row changed while the repair was running; refusing to overwrite');
    }

    // The old mark was the defect's own claim that the real thread was
    // abandoned. Only this session's mark for this thread is removed.
    db.prepare(
      `DELETE FROM superseded_provider_sessions
       WHERE provider_session_id = ? AND provider = ? AND session_id = ?`,
    ).run(targetThreadId, before.session.provider, sessionId);

    // The watcher-created row for the metadata-only fork is the same
    // conversation about to be re-indexed under the restored binding.
    db.prepare(
      `DELETE FROM sessions
       WHERE session_id = ? AND session_id <> ? AND provider_session_id = ? AND provider = ?`,
    ).run(forkThreadId, sessionId, forkThreadId, before.session.provider);

    // Suppress the abandoned metadata-only fork from the indexer. Its file
    // stays on disk untouched.
    db.prepare(
      `INSERT INTO superseded_provider_sessions (provider_session_id, provider, session_id, jsonl_path)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_session_id, provider) DO UPDATE SET
         session_id = excluded.session_id,
         jsonl_path = excluded.jsonl_path,
         created_at = CURRENT_TIMESTAMP`,
    ).run(forkThreadId, before.session.provider, sessionId, before.session.jsonl_path ?? null);
  });

  repair();
  const after = readState(db, sessionId);
  evidence.after = {
    session: after?.session ?? null,
    superseded: after?.superseded ?? [],
    pathThreadId: after?.pathThreadId ?? null,
  };
  writeEvidence(evidencePath, evidence);
  db.close();

  console.log(JSON.stringify({
    result: 'repaired',
    session: sessionId,
    providerSessionId: targetThreadId,
    jsonlPath: targetPath,
    evidence: evidencePath,
  }, null, 2));
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(JSON.stringify({ result: 'error', error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
}
