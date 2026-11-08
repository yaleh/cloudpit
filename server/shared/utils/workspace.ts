import { randomUUID } from 'node:crypto';
import { access, lstat, readlink, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NormalizedMessage, SubagentActivity, WorkspacePathValidationResult } from '../types/index.js';
import type { NormalizedMessageInput } from './core.js';

// ---------------------------
//----------------- WORKSPACE PATH VALIDATION UTILITIES ------------
/**
 * Root directory that all workspace/project paths must stay under.
 *
 * This is resolved from `WORKSPACES_ROOT` when configured; otherwise it falls
 * back to the current user's home directory.
 */
export const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT || os.homedir();

/**
 * System-critical paths that must never be used as workspace roots.
 *
 * The validation helper blocks these values directly and also blocks paths
 * nested under them (with explicit allow-list exceptions where necessary).
 */
export const FORBIDDEN_WORKSPACE_PATHS = [
  // Unix
  '/',
  '/etc',
  '/bin',
  '/sbin',
  '/usr',
  '/dev',
  '/proc',
  '/sys',
  '/var',
  '/boot',
  '/root',
  '/lib',
  '/lib64',
  '/opt',
  '/tmp',
  '/run',
  // Windows
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin',
];

function stripWindowsLongPathPrefix(inputPath: string): string {
  if (inputPath.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${inputPath.slice('\\\\?\\UNC\\'.length)}`;
  }

  if (inputPath.startsWith('\\\\?\\')) {
    return inputPath.slice('\\\\?\\'.length);
  }

  return inputPath;
}

function shouldUseWindowsPathNormalization(inputPath: string): boolean {
  if (process.platform === 'win32') {
    return true;
  }

  return inputPath.startsWith('\\\\') || /^[a-zA-Z]:([\\/]|$)/.test(inputPath);
}

/**
 * Canonicalizes project/workspace paths for stable DB keys and comparisons.
 *
 * Normalization rules:
 * - trim whitespace
 * - strip Windows long-path prefixes (`\\?\` and `\\?\UNC\`)
 * - normalize path separators and dot segments
 * - trim trailing separators except for filesystem roots
 */
export function normalizeProjectPath(inputPath: string): string {
  if (typeof inputPath !== 'string') {
    return '';
  }

  const trimmed = inputPath.trim();
  if (!trimmed) {
    return '';
  }

  const withoutLongPrefix = stripWindowsLongPathPrefix(trimmed);
  const useWindowsPathRules = shouldUseWindowsPathNormalization(withoutLongPrefix);
  const normalized = useWindowsPathRules
    ? path.win32.normalize(withoutLongPrefix)
    : path.posix.normalize(withoutLongPrefix);

  if (!normalized) {
    return '';
  }

  const parser = useWindowsPathRules ? path.win32 : path.posix;
  const root = parser.parse(normalized).root;
  if (normalized === root) {
    return normalized;
  }

  return normalized.replace(/[\\/]+$/, '');
}

/**
 * Validates that a user-supplied workspace path is safe to use.
 *
 * Call this before any filesystem mutation that creates or registers projects.
 * The function resolves symlinks, enforces `WORKSPACES_ROOT` containment, and
 * blocks known system directories.
 */
export async function validateWorkspacePath(requestedPath: string): Promise<WorkspacePathValidationResult> {
  try {
    const normalizedRequestedPath = normalizeProjectPath(requestedPath);
    if (!normalizedRequestedPath) {
      return {
        valid: false,
        error: 'Workspace path is required',
      };
    }

    const absolutePath = path.resolve(normalizedRequestedPath);
    const normalizedPath = normalizeProjectPath(absolutePath);

    if (FORBIDDEN_WORKSPACE_PATHS.includes(normalizedPath) || normalizedPath === '/') {
      return {
        valid: false,
        error: 'Cannot use system-critical directories as workspace locations',
      };
    }

    for (const forbiddenPath of FORBIDDEN_WORKSPACE_PATHS) {
      const normalizedForbiddenPath = normalizeProjectPath(forbiddenPath);
      if (
        normalizedPath === normalizedForbiddenPath
        || normalizedPath.startsWith(`${normalizedForbiddenPath}${path.sep}`)
      ) {
        // Allow specific user-writable folders under /var.
        if (
          normalizedForbiddenPath === '/var'
          && (normalizedPath.startsWith('/var/tmp') || normalizedPath.startsWith('/var/folders'))
        ) {
          continue;
        }

        return {
          valid: false,
          error: `Cannot create workspace in system directory: ${forbiddenPath}`,
        };
      }
    }

    let resolvedPath = normalizeProjectPath(absolutePath);
    try {
      await access(absolutePath);
      resolvedPath = normalizeProjectPath(await realpath(absolutePath));
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== 'ENOENT') {
        throw fileError;
      }

      const parentPath = path.dirname(absolutePath);
      try {
        const parentRealPath = await realpath(parentPath);
        resolvedPath = normalizeProjectPath(path.join(parentRealPath, path.basename(absolutePath)));
      } catch (parentError) {
        const parentFileError = parentError as NodeJS.ErrnoException;
        if (parentFileError.code !== 'ENOENT') {
          throw parentFileError;
        }
      }
    }

    const resolvedWorkspaceRoot = normalizeProjectPath(await realpath(WORKSPACES_ROOT));
    if (
      !resolvedPath.startsWith(`${resolvedWorkspaceRoot}${path.sep}`)
      && resolvedPath !== resolvedWorkspaceRoot
    ) {
      return {
        valid: false,
        error: `Workspace path must be within the allowed workspace root: ${WORKSPACES_ROOT}`,
      };
    }

    try {
      await access(absolutePath);
      const pathStats = await lstat(absolutePath);
      if (pathStats.isSymbolicLink()) {
        const symlinkTarget = await readlink(absolutePath);
        const resolvedSymlinkPath = path.resolve(path.dirname(absolutePath), symlinkTarget);
        const realSymlinkPath = await realpath(resolvedSymlinkPath);
        if (
          !realSymlinkPath.startsWith(`${resolvedWorkspaceRoot}${path.sep}`)
          && realSymlinkPath !== resolvedWorkspaceRoot
        ) {
          return {
            valid: false,
            error: 'Symlink target is outside the allowed workspace root',
          };
        }
      }
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;
      if (fileError.code !== 'ENOENT') {
        throw fileError;
      }
    }

    return {
      valid: true,
      resolvedPath,
    };
  } catch (error) {
    return {
      valid: false,
      error: `Path validation failed: ${(error as Error).message}`,
    };
  }
}

// ---------------------------
//----------------- NORMALIZED PROVIDER MESSAGE UTILITIES ------------
/**
 * Generates a stable unique id for normalized provider messages.
 */
export function generateMessageId(prefix = 'msg'): string {
  return `${prefix}_${randomUUID()}`;
}

/**
 * Creates a normalized provider message and fills the shared envelope fields.
 *
 * Provider adapters and live SDK handlers pass through provider-specific fields,
 * while this helper guarantees every emitted event has an id, session id,
 * timestamp, and provider marker.
 */
export function createNormalizedMessage(fields: NormalizedMessageInput): NormalizedMessage {
  return {
    ...fields,
    id: fields.id || generateMessageId(fields.kind),
    sessionId: fields.sessionId || '',
    timestamp: fields.timestamp || new Date().toISOString(),
    provider: fields.provider,
  };
}

/**
 * Build the unified terminal `complete` lifecycle message.
 *
 * Contract: every provider run ends with exactly one `complete` (the
 * abort-session handler emits it on behalf of cancelled runs, so aborted runs
 * must NOT emit their own). The frontend treats `complete` as the only
 * terminal signal and never needs provider-specific handling:
 *
 * - `sessionId`     — the id the client knows this run by ('' if never discovered)
 * - `actualSessionId` — canonical id after the run; equals `sessionId` unless
 *                       the provider rewrote it mid-run
 * - `exitCode`      — 0 on success; a missing/null code (e.g. killed process)
 *                     is reported as failure
 * - `success`       — exitCode === 0 and not aborted
 * - `aborted`       — run was cancelled by the user
 */
export function createCompleteMessage(opts: {
  provider: NormalizedMessage['provider'];
  sessionId?: string | null;
  actualSessionId?: string | null;
  exitCode?: number | null;
  aborted?: boolean;
}): NormalizedMessage {
  const exitCode = typeof opts.exitCode === 'number' ? opts.exitCode : 1;
  const aborted = Boolean(opts.aborted);

  return createNormalizedMessage({
    kind: 'complete',
    provider: opts.provider,
    sessionId: opts.sessionId || null,
    actualSessionId: opts.actualSessionId || opts.sessionId || null,
    exitCode,
    success: exitCode === 0 && !aborted,
    aborted,
  });
}

// ---------------------------
//----------------- SUBAGENT TIMELINE UTILITIES ------------
/**
 * Longest tool output kept on one subagent activity.
 *
 * A subagent's timeline is nested inside a collapsed panel, so it is a preview
 * of what the agent did, never the primary place its output is read. Sending
 * every child command's full output made the history payload of an
 * agent-heavy session grow by megabytes for content almost nobody expands.
 */
const MAX_SUBAGENT_ACTIVITY_CONTENT = 4000;

function truncateForPreview(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value.length <= MAX_SUBAGENT_ACTIVITY_CONTENT) {
    return value;
  }
  const omitted = value.length - MAX_SUBAGENT_ACTIVITY_CONTENT;
  return `${value.slice(0, MAX_SUBAGENT_ACTIVITY_CONTENT)}\n… ${omitted} more characters`;
}

/**
 * Trims one subagent activity down to what its nested preview can show.
 *
 * Used by both provider session adapters so a Claude agent's timeline and a
 * Codex agent's timeline cost the same to transport.
 */
export function truncateSubagentActivity(activity: SubagentActivity): SubagentActivity {
  const truncatedContent = truncateForPreview(activity.content);
  const truncatedResult = activity.toolResult
    ? { ...activity.toolResult, content: truncateForPreview(activity.toolResult.content) }
    : activity.toolResult;

  if (truncatedContent === activity.content && truncatedResult === activity.toolResult) {
    return activity;
  }

  return { ...activity, content: truncatedContent, toolResult: truncatedResult };
}

// ---------------------------
//----------------- CONVERSATION HISTORY PAGINATION UTILITIES ------------
/**
 * Slices one page from the END of a chronologically ordered message list.
 *
 * This is the single pagination contract for conversation history across all
 * providers: `offset = 0` returns the most recent `limit` items, increasing
 * offsets walk backwards in time (for "scroll up to load older" UIs), and a
 * `null` limit returns everything. Items must already be sorted oldest-first;
 * the returned page preserves that order.
 *
 * Every provider history reader must use this helper instead of slicing
 * manually so `offset`/`limit` query params behave identically regardless of
 * which provider produced the session.
 */
export function sliceTailPage<T>(
  items: T[],
  limit: number | null,
  offset: number,
): { page: T[]; hasMore: boolean } {
  const total = items.length;
  const normalizedOffset = Math.max(0, offset);

  if (limit === null) {
    // A null limit returns the full list; offset still trims newest entries
    // so "everything before the page I already have" stays expressible.
    const end = Math.max(0, total - normalizedOffset);
    return {
      page: items.slice(0, end),
      hasMore: false,
    };
  }

  const end = Math.max(0, total - normalizedOffset);
  const start = Math.max(0, end - Math.max(0, limit));
  return {
    page: items.slice(start, end),
    hasMore: start > 0,
  };
}

/**
 * Slices a symmetric window around one located item, by absolute subscript.
 *
 * This is the read contract for "load the neighborhood of message X": the
 * caller resolves `X` to its subscript in the same oldest-first array
 * `sliceTailPage` slices, then asks for `before` items on either side and
 * `after` items on the other. `match` is a predicate rather than an index so the
 * id-matching rule stays with the caller (a transcript may identify a row by its
 * provider anchor or by its synthesized id), while the boundary arithmetic —
 * the part every caller must get identically right — stays here.
 *
 * Unlike a tail offset, `startIndex`/`total` are *absolute*: they are the
 * subscripts in the full array, so appending newer items to the end never moves
 * an already-read window. The result is `null` when `match` finds nothing, which
 * is what lets a caller answer "not found" instead of falling back to the
 * newest page.
 */
export function sliceAroundIndex<T>(
  items: T[],
  match: (item: T) => boolean,
  before: number,
  after: number,
): {
  page: T[];
  startIndex: number;
  total: number;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
} | null {
  const total = items.length;
  const index = items.findIndex(match);

  if (index < 0) {
    return null;
  }

  const start = Math.max(0, index - Math.max(0, before));
  const end = Math.min(total, index + Math.max(0, after) + 1);

  return {
    page: items.slice(start, end),
    startIndex: start,
    total,
    hasMoreBefore: start > 0,
    hasMoreAfter: end < total,
  };
}

