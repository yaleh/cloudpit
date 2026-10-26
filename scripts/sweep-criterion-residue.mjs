#!/usr/bin/env node
// sweep-criterion-residue.mjs — remove `__criterion-falsify-*` mutant copies a killed test left behind.
//
// WHY. Several criteria prove a mutation is load-bearing by writing a modified copy of the module
// under test NEXT TO it (a sibling in the same directory, so the copy's relative imports resolve) and
// then deleting the copy in a `finally`. That cleanup only runs when the process gets to run it: a
// per-file timeout, an OOM, or a SIGKILL leaves the copy in the source tree. The copies are excluded
// from the build by name (server/tsconfig.json), but they are untracked files in the working tree, so
// `git status --porcelain` and anything built on it (ArchGuard's duplicate scan, cleanliness
// criteria) read them as real source. One such file produced 14 of a day's 85 duplicate groups.
//
// WHAT. Walk `server/` and `src/` (never descending into node_modules/ or dist/) for entries whose
// name starts with `__criterion-falsify-`. Parse the trailing `-<pid>` from a `.ts` file name or a
// directory name. A pid that no longer exists (process.kill(pid, 0) throws ESRCH) is residue.
//
// SAFETY: a live pid — or a name with no parseable pid — is only REPORTED, never removed. Missing a
// dead residue costs one more sweep; deleting a copy a running criterion is still using would corrupt
// that test mid-flight. `--apply` is required to delete anything; without it this is a dry run.
//
// OUTPUT (one line per candidate, stdout, stable shape for the suite log and for criteria):
//   residue: <path relative to cwd> pid=<pid|unknown> state=<dead|alive|unknown> action=<removed|kept>
//
// Exit code is ALWAYS 0: this is housekeeping, and a suite must not go red over a sweep that could not
// read a directory (the copy simply stays and the next run tries again).

import { readdirSync, rmSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const PREFIX = '__criterion-falsify-';
const SCANNED_ROOTS = ['server', 'src'];
const SKIPPED_DIR_NAMES = new Set(['node_modules', 'dist']);
const APPLY = process.argv.includes('--apply');

/**
 * @typedef {{ path: string, isDirectory: boolean }} Candidate
 */

/**
 * The pid stamped into a copy's name, or null when the name carries none.
 * Files are written as `<prefix>…-<pid>.ts`; directories as `<prefix>…-<pid>`.
 * @param {string} name
 * @param {boolean} isDirectory
 * @returns {number | null}
 */
function parsePid(name, isDirectory) {
  let stem = name;
  if (!isDirectory && stem.endsWith('.ts')) stem = stem.slice(0, -3);
  const match = /-(\d+)$/.exec(stem);
  if (match === null) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/**
 * @param {number} pid
 * @returns {'dead' | 'alive' | 'unknown'}
 */
function pidState(pid) {
  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    // EPERM means the process EXISTS but belongs to someone else — never read that as dead.
    if (code === 'EPERM') return 'alive';
    if (code === 'ESRCH') return 'dead';
    return 'unknown';
  }
}

/**
 * Collect prefixed entries under one directory. A prefixed entry is the unit: we do not descend into
 * it, because deleting the directory removes its contents either way and a nested copy inside a copy
 * is not a shape the criteria produce.
 * @param {string} dir
 * @returns {Candidate[]}
 */
function collect(dir) {
  /** @type {Candidate[]} */
  const found = [];
  /** @type {import('node:fs').Dirent[]} */
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A root that does not exist (or is unreadable) contributes nothing; never fail the sweep.
    return found;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.name.startsWith(PREFIX)) {
      found.push({ path: full, isDirectory: entry.isDirectory() });
    } else if (entry.isDirectory() && !SKIPPED_DIR_NAMES.has(entry.name)) {
      found.push(...collect(full));
    }
  }
  return found;
}

function main() {
  const cwd = process.cwd();
  const candidates = SCANNED_ROOTS.flatMap((root) => collect(join(cwd, root)));

  for (const candidate of candidates) {
    const rel = relative(cwd, candidate.path);
    const pid = parsePid(basename(candidate.path), candidate.isDirectory);
    const state = pid === null ? 'unknown' : pidState(pid);
    let action = 'kept';
    if (APPLY && state === 'dead') {
      try {
        rmSync(candidate.path, { recursive: true, force: true });
        action = 'removed';
      } catch (error) {
        process.stderr.write(
          `sweep-criterion-residue: could not remove ${rel}: ${String(error)}\n`,
        );
      }
    }
    process.stdout.write(
      `residue: ${rel} pid=${pid === null ? 'unknown' : String(pid)} state=${state} action=${action}\n`,
    );
  }
}

main();
