import { providerSessionBindingDb, sessionBindingService, sessionsDb } from '@/modules/database/index.js';
import { extractFirstValidJsonlData } from '@/shared/utils.js';

/**
 * The explicit recovery entry for a Codex session whose current binding was
 * wrongly retired.
 *
 * `codex-session-binding.ts` is the provider-side half of recovery: it is the
 * only place that turns a retirement record plus a rollout file into a binding
 * write, and it refuses unless the rollout's own `session_meta` proves it is
 * the thread being restored. The database layer owns the transaction
 * (`sessionBindingService.recoverBinding`); this file owns the identity claim.
 *
 * It is deliberately NOT reachable from the synchronizer or from run
 * discovery. An indexer that sees a retired thread must leave it alone and
 * report the conflict (see `CodexSessionSynchronizer`); guessing a recovery
 * there is exactly how the damaged row this repairs was produced. An operator
 * runs `scripts/repair-session-binding.mjs` for an out-of-process repair, or
 * this entry point for an in-process one.
 */

/** The identity a Codex rollout states about itself in its first metadata line. */
export type CodexThreadIdentity = {
  id: string;
  cwd: string | null;
};

export type CodexBindingRecoveryOutcome =
  | {
      kind: 'recovered';
      sessionId: string;
      providerSessionId: string;
      jsonlPath: string;
      previousProviderSessionId: string | null;
      previousJsonlPath: string | null;
    }
  | {
      kind: 'already-consistent';
      sessionId: string;
      providerSessionId: string;
      jsonlPath: string;
    }
  | {
      kind: 'refused';
      sessionId: string;
      reason:
        | 'missing-session'
        | 'not-codex'
        | 'no-binding'
        | 'not-retired'
        | 'missing-transcript'
        | 'identity-mismatch';
      detail: string;
    };

/**
 * Reads the identity a rollout records about itself.
 *
 * Only the first `session_meta` line is consulted: that is the entry Codex
 * writes for the thread, and it is the same field the operator runbook checks
 * before repairing. Returns null when the file is missing/unreadable or has no
 * metadata line, so callers refuse rather than guess.
 */
export async function readCodexThreadIdentity(jsonlPath: string): Promise<CodexThreadIdentity | null> {
  return extractFirstValidJsonlData<CodexThreadIdentity>(jsonlPath, (rawData) => {
    const data = rawData as Record<string, unknown>;
    if (data.type !== 'session_meta') {
      return null;
    }
    const payload = data.payload as Record<string, unknown> | undefined;
    const id = typeof payload?.id === 'string' ? payload.id : undefined;
    if (!id) {
      return null;
    }
    return {
      id,
      cwd: typeof payload?.cwd === 'string' ? payload.cwd : null,
    };
  });
}

/**
 * Restores the thread a session row still claims but that the ledger also
 * records as retired (the `null-path-retired` shape the operator runbook
 * describes).
 *
 * Preconditions, in order: the row exists, is Codex, claims a thread; either
 * the binding is already consistent (idempotent second run) or the thread is
 * recorded as retired with a rollout path; and that rollout's `session_meta`
 * names the same thread in the same project. Any failure is a refusal with a
 * reason and writes nothing. Success commits the row write and the ledger
 * change together.
 */
export async function recoverCodexSessionBinding(sessionId: string): Promise<CodexBindingRecoveryOutcome> {
  const row = sessionsDb.getSessionById(sessionId);
  if (!row) {
    return { kind: 'refused', sessionId, reason: 'missing-session', detail: 'session row not found' };
  }
  if (row.provider !== 'codex') {
    return {
      kind: 'refused',
      sessionId,
      reason: 'not-codex',
      detail: `session provider is "${row.provider}"`,
    };
  }

  const providerSessionId = row.provider_session_id;
  if (!providerSessionId) {
    return {
      kind: 'refused',
      sessionId,
      reason: 'no-binding',
      detail: 'session has no provider thread to recover',
    };
  }

  const retired = providerSessionBindingDb.getRetiredProviderSession(providerSessionId, 'codex');
  const jsonlPath = retired?.jsonl_path ?? row.jsonl_path;

  if (!jsonlPath) {
    return {
      kind: 'refused',
      sessionId,
      reason: 'missing-transcript',
      detail: 'neither the row nor the retirement record names a rollout path',
    };
  }

  const identity = await readCodexThreadIdentity(jsonlPath);
  if (!identity) {
    return {
      kind: 'refused',
      sessionId,
      reason: 'missing-transcript',
      detail: `rollout "${jsonlPath}" is missing or records no session_meta`,
    };
  }
  if (identity.id !== providerSessionId) {
    return {
      kind: 'refused',
      sessionId,
      reason: 'identity-mismatch',
      detail: `rollout names thread "${identity.id}", not "${providerSessionId}"`,
    };
  }
  if (identity.cwd !== null && row.project_path && identity.cwd !== row.project_path) {
    return {
      kind: 'refused',
      sessionId,
      reason: 'identity-mismatch',
      detail: `rollout cwd "${identity.cwd}" does not match the session's project "${row.project_path}"`,
    };
  }

  if (!retired) {
    // Identity agrees and nothing is retired. This is the idempotent second
    // run, but only when the row already points at the same rollout; a row
    // that claims the id with a different path is not a recovery shape.
    if (row.jsonl_path !== jsonlPath) {
      return {
        kind: 'refused',
        sessionId,
        reason: 'not-retired',
        detail: 'the binding is not retired and does not point at this rollout',
      };
    }
    return { kind: 'already-consistent', sessionId, providerSessionId, jsonlPath };
  }

  const outcome = sessionBindingService.recoverBinding({
    sessionId,
    providerSessionId,
    jsonlPath,
  });

  if (outcome.kind === 'already-consistent') {
    return { kind: 'already-consistent', sessionId, providerSessionId, jsonlPath };
  }

  return {
    kind: 'recovered',
    sessionId,
    providerSessionId,
    jsonlPath,
    previousProviderSessionId: outcome.previousProviderSessionId,
    previousJsonlPath: outcome.previousJsonlPath,
  };
}
