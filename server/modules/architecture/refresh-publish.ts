/**
 * Atomic publish for the manual ArchGuard re-analysis.
 *
 * ArchGuard writes each artifact file atomically, but the run as a whole is NOT
 * atomic across scopes: a later scope can fail after earlier ones were written, and
 * the manifest is written last. So the child always runs into
 * `.archguard/refresh/<jobId>`; only on exit 0 is the staged `query` directory
 * renamed over the live one (old `query` moved aside first, restored if the second
 * rename fails). A failed or timed-out run therefore leaves the live
 * `.archguard/query` byte-for-byte untouched.
 *
 * Auxiliary query products (`git-history`, `shape-smells`, …) are carried from the
 * old directory into the new one so the swap does not delete artifacts this refresh
 * does not own. Scope directories the new analysis did not write (the retired `chat`
 * scope) are deliberately NOT carried over. The duplicate report is carried only as
 * keep-alive per-scope directories whose scope still exists: the legacy flat pair
 * has no scope information and `index.json` is rebuilt by `refresh-duplicates.ts`.
 *
 * Consumers: `refreshJob.ts` (the success path of `runJob`);
 * `tests/refreshJob.test.ts` exercises the swap through it.
 */
import { promises as fsPromises, type Dirent } from 'node:fs';
import path from 'node:path';

import type { ArchitectureRefreshDefect } from './refresh-settings.js';

/** The filesystem operations this module needs; injectable so a criterion can fake them. */
export type RefreshPublishFs = Pick<
  typeof fsPromises,
  'access' | 'mkdir' | 'readFile' | 'readdir' | 'rename' | 'rm'
>;

/**
 * The publish-side surface the refresh job composes.
 *
 * Consumers: `refreshJob.ts` only (the exit-0 arm of the child's `close` handler).
 */
export type RefreshPublisher = {
  /** The directory the CLI writes into; `no-preserve` deliberately points at the live `.archguard`. */
  stagingDir(projectPath: string, jobId: string, defect: ArchitectureRefreshDefect): string;
  /** Recreate the staging directory before a run (no-op for `no-preserve`). */
  prepareStaging(workDir: string, defect: ArchitectureRefreshDefect): Promise<void>;
  /** Remove staging after any terminal path (no-op for `no-preserve`). */
  discardStaging(workDir: string, defect: ArchitectureRefreshDefect): Promise<void>;
  /** Swap the staged `query` over the live one; rejects with a readable reason. */
  installStagedQuery(projectPath: string, stagedWorkDir: string, jobId: string): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** The scope keys a query directory's manifest declares. */
async function readScopeKeys(fsImpl: RefreshPublishFs, queryDir: string): Promise<Set<string>> {
  const keys = new Set<string>();
  try {
    const parsed: unknown = JSON.parse(
      await fsImpl.readFile(path.join(queryDir, 'manifest.json'), 'utf8'),
    );
    if (isRecord(parsed) && Array.isArray(parsed.scopes)) {
      for (const scope of parsed.scopes) {
        if (isRecord(scope) && typeof scope.key === 'string') keys.add(scope.key);
      }
    }
  } catch {
    // An unreadable manifest has no keys to protect; only the heuristic applies.
  }
  return keys;
}

/**
 * Carries only the duplicate reports whose scope still exists in the new manifest.
 *
 * The flat `duplicates/{manifest,groups}.json` pair predates per-scope reports and
 * carries no scope information, so it is never carried; `index.json` is rebuilt by
 * the duplicate refresh step. A scope directory the refresh no longer knows is
 * dropped, exactly like a retired analysis scope.
 */
async function carryDuplicates(
  fsImpl: RefreshPublishFs,
  previousDuplicates: string,
  liveDuplicates: string,
  newScopeKeys: ReadonlySet<string>,
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fsImpl.readdir(previousDuplicates, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !newScopeKeys.has(entry.name)) continue;
    try {
      await fsImpl.mkdir(liveDuplicates, { recursive: true });
      await fsImpl.rename(
        path.join(previousDuplicates, entry.name),
        path.join(liveDuplicates, entry.name),
      );
    } catch {
      // A carrier that already exists on both sides keeps the new one.
    }
  }
}

/** Moves the old query directory's non-analysis entries into the new one. */
async function carryAuxiliaryQueryEntries(
  fsImpl: RefreshPublishFs,
  previousQuery: string,
  liveQuery: string,
): Promise<void> {
  const scopeKeys = await readScopeKeys(fsImpl, previousQuery);
  const newScopeKeys = await readScopeKeys(fsImpl, liveQuery);

  let entries: Dirent[];
  try {
    entries = await fsImpl.readdir(previousQuery, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'manifest.json') continue;
    if (entry.name === 'duplicates') {
      await carryDuplicates(
        fsImpl,
        path.join(previousQuery, entry.name),
        path.join(liveQuery, entry.name),
        newScopeKeys,
      );
      continue;
    }
    if (scopeKeys.has(entry.name)) continue;
    // `hashSources` keys are eight lowercase hex characters; an orphaned scope
    // directory without a manifest entry is still an analysis artifact.
    if (/^[0-9a-f]{8}$/.test(entry.name)) continue;
    try {
      await fsImpl.rename(
        path.join(previousQuery, entry.name),
        path.join(liveQuery, entry.name),
      );
    } catch {
      // A carrier that already exists on both sides keeps the new one.
    }
  }
}

/**
 * Renames `stagedQuery` over `<projectRoot>/.archguard/query`, restoring the old
 * directory if the second rename fails.
 *
 * Auxiliary entries of the old `query` directory (anything that is not the manifest
 * and not a scope artifact — `duplicates`, `git-history`, `shape-smells`, …) are
 * moved into the new directory first, so the swap publishes the analysis without
 * deleting products this refresh does not produce.
 */
async function installStagedQuery(
  fsImpl: RefreshPublishFs,
  projectPath: string,
  stagedWorkDir: string,
  jobId: string,
): Promise<void> {
  const archguardRoot = path.join(projectPath, '.archguard');
  const liveQuery = path.join(archguardRoot, 'query');
  const stagedQuery = path.join(stagedWorkDir, 'query');

  try {
    await fsImpl.access(path.join(stagedQuery, 'manifest.json'));
  } catch {
    throw new Error(`the analysis finished but wrote no ${path.join(stagedQuery, 'manifest.json')}`);
  }

  await fsImpl.mkdir(archguardRoot, { recursive: true });
  const previousQuery = path.join(archguardRoot, `query.previous-${jobId}`);
  let movedAside = false;
  try {
    try {
      await fsImpl.rename(liveQuery, previousQuery);
      movedAside = true;
    } catch (failure) {
      if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure;
    }

    try {
      await fsImpl.rename(stagedQuery, liveQuery);
    } catch (failure) {
      if (movedAside) await fsImpl.rename(previousQuery, liveQuery);
      throw failure;
    }

    if (movedAside) {
      await carryAuxiliaryQueryEntries(fsImpl, previousQuery, liveQuery);
      await fsImpl.rm(previousQuery, { recursive: true, force: true });
    }
  } catch (failure) {
    throw new Error(`could not install the refreshed analysis: ${errorMessage(failure)}`);
  }
}

/**
 * Creates the publish-side half of the refresh job.
 *
 * Consumers: `refreshJob.ts`; the two refresh test files drive it through the real
 * filesystem in throwaway project directories.
 */
export function createRefreshPublisher(options: { fsImpl?: RefreshPublishFs } = {}): RefreshPublisher {
  const fsImpl = options.fsImpl ?? fsPromises;

  return {
    stagingDir(projectPath: string, jobId: string, defect: ArchitectureRefreshDefect): string {
      // `no-preserve` deliberately removes the staging directory: the CLI writes the
      // live analysis, which is the defect the control arm measures.
      return defect === 'no-preserve'
        ? path.join(projectPath, '.archguard')
        : path.join(projectPath, '.archguard', 'refresh', jobId);
    },

    async prepareStaging(workDir: string, defect: ArchitectureRefreshDefect): Promise<void> {
      if (defect === 'no-preserve') return;
      await fsImpl.mkdir(path.dirname(workDir), { recursive: true });
      await fsImpl.rm(workDir, { recursive: true, force: true });
    },

    async discardStaging(workDir: string, defect: ArchitectureRefreshDefect): Promise<void> {
      if (defect === 'no-preserve') return;
      await fsImpl.rm(workDir, { recursive: true, force: true }).catch(() => {});
    },

    installStagedQuery(projectPath: string, stagedWorkDir: string, jobId: string): Promise<void> {
      return installStagedQuery(fsImpl, projectPath, stagedWorkDir, jobId);
    },
  };
}
