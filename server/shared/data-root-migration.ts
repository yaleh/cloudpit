/**
 * Copies a legacy CloudCLI data root into an explicitly requested Cloudpit data
 * root.
 *
 * WHY THIS FINISHES BEFORE THE MARKER. A half-copied data root must never read
 * as a completed migration, so `.migrated-from-cloudcli` is written LAST: its
 * presence is the single fact that means "every earlier step succeeded". The
 * legacy root is only ever read — it is never renamed, unlinked, checkpointed
 * or written to, so a failed attempt (including an occupied SQLite database)
 * leaves it exactly as it was. v3.0 does NOT fall back to it at runtime: the
 * caller reports the thrown failure instead.
 *
 * ROLLBACK ON FAILURE. Every file and directory this module creates is recorded
 * before it is written and removed in reverse order when any step throws. The
 * explicit root therefore never keeps half a migrated dataset, and a directory
 * that existed before the attempt is not deleted.
 *
 * This module is deliberately unwired: `server/shared/data-root.ts` is its only
 * code consumer (and the data-root criterion drives it directly). GOAL-054 is
 * what will call the resolver, not this file.
 */
import { createRequire } from 'node:module';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * `better-sqlite3` is loaded on first use rather than at module evaluation:
 * `server/load-env.ts` imports this module through `data-root.ts` before any
 * database is needed, and a bootstrap must not pay for (or depend on) the
 * native addon when no migration runs.
 */
const nodeRequire = createRequire(import.meta.url);

type ReadonlySqliteDatabase = {
  exec(sql: string): unknown;
  close(): void;
};

type ReadonlySqliteDatabaseConstructor = new (
  sourcePath: string,
  options: { readonly: boolean; fileMustExist: boolean },
) => ReadonlySqliteDatabase;

/** Opens the legacy database readonly, loading the native addon only here. */
function openReadonlySqlite(sourcePath: string): ReadonlySqliteDatabase {
  const Database = nodeRequire('better-sqlite3') as ReadonlySqliteDatabaseConstructor;
  return new Database(sourcePath, { readonly: true, fileMustExist: true });
}

/**
 * The filesystem operations the migration needs. Injectable so a criterion can
 * fake an IO failure, and so the real implementation stays a thin `node:fs` seam.
 */
export type DataRootFs = {
  existsSync(filePath: string): boolean;
  statSync(filePath: string): { isDirectory(): boolean };
  readdirSync(dirPath: string): string[];
  mkdirSync(dirPath: string, options: { recursive: true }): unknown;
  copyFileSync(sourcePath: string, targetPath: string): void;
  writeFileSync(filePath: string, data: string, encoding: 'utf8'): void;
  rmSync(filePath: string, options: { recursive: true; force: true }): void;
};

/**
 * Take a consistent SQLite snapshot of `sourcePath` into `targetPath`.
 * Injectable so the fallback arm can be driven with a `SQLITE_BUSY` error.
 */
export type BackupDatabase = (sourcePath: string, targetPath: string) => void;

/** What one attempt decided; the caller maps these onto its public reasons. */
export type DataRootMigrationOutcome = {
  migrated: boolean;
  reason: 'migrated' | 'already-migrated' | 'user-root' | 'no-legacy';
};

/** Dependencies and paths of one migration attempt. */
export type MigrateLegacyDataRootOptions = {
  /** The existing legacy data root (`<home>/.cloudcli` by default). */
  legacyRoot: string;
  /** The explicitly requested data root (`CLOUDPIT_HOME` / `CLOUDCLI_HOME`). */
  newRoot: string;
  /** The legacy settings file (`<home>/.config/claudecodeui/server.settings.json`). */
  legacySettingsPath: string;
  /** The explicit-mode settings file (`<home>/.config/cloudpit/server.settings.json`). */
  newSettingsPath: string;
  /** Recorded in the completion marker; the caller supplies it, never read here. */
  version: string;
  /** The filesystem seam; defaults to `node:fs`. */
  fs?: DataRootFs;
  /** The SQLite snapshot seam; defaults to a readonly `VACUUM INTO`. */
  backupDatabase?: BackupDatabase;
  /** Clock seam for the marker's `at`; defaults to the current time. */
  now?: () => Date;
};

/** The marker that means "this data root was fully migrated". */
const MIGRATION_MARKER_FILE = '.migrated-from-cloudcli';

/**
 * The entries copied from the legacy root, in the order the contract names.
 * `assets/` is deliberately absent: it belongs to a later task.
 */
const MIGRATED_DATA_ENTRIES = [
  'voice-data',
  'cockpit-card-feedback.json',
  'reply-suggestions-usage.jsonl',
] as const;

/** The real `node:fs` seam. */
const NODE_FS: DataRootFs = {
  existsSync,
  statSync,
  readdirSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  rmSync,
};

/**
 * Snapshot a SQLite database with `VACUUM INTO`, which is why no bare `cp` is
 * used: a plain copy of a live database can capture a torn page set. Opening
 * read-only means the legacy database is never modified and a lock that denies
 * a consistent snapshot surfaces as a thrown error — exactly the fallback arm.
 */
export function backupSqliteDatabase(sourcePath: string, targetPath: string): void {
  const database = openReadonlySqlite(sourcePath);
  try {
    const escapedTarget = targetPath.replace(/'/g, "''");
    database.exec(`VACUUM INTO '${escapedTarget}'`);
  } finally {
    database.close();
  }
}

/** True when `dirPath` exists and holds at least one entry. */
function directoryHasEntries(fs: DataRootFs, dirPath: string): boolean {
  return fs.existsSync(dirPath) && fs.readdirSync(dirPath).length > 0;
}

/**
 * Decide whether this attempt should copy anything, and copy it when it should.
 *
 * Order matters. A completion marker wins over every other observation (a
 * marker with a missing legacy root is still a finished migration). An existing
 * non-empty root without a marker is the user's own data — never overwritten.
 * A missing legacy root is the ordinary first-run-with-explicit-root shape.
 */
export function migrateLegacyDataRoot(options: MigrateLegacyDataRootOptions): DataRootMigrationOutcome {
  const fs = options.fs ?? NODE_FS;
  const backupDatabase = options.backupDatabase ?? backupSqliteDatabase;
  const now = options.now ?? (() => new Date());
  const markerPath = path.join(options.newRoot, MIGRATION_MARKER_FILE);

  if (fs.existsSync(markerPath)) {
    return { migrated: false, reason: 'already-migrated' };
  }
  if (directoryHasEntries(fs, options.newRoot)) {
    return { migrated: false, reason: 'user-root' };
  }
  if (!fs.existsSync(options.legacyRoot)) {
    return { migrated: false, reason: 'no-legacy' };
  }

  // Everything created below is recorded BEFORE it is written, so a throw after
  // a partial write still rolls the file back. Removal runs in reverse order.
  const createdPaths: string[] = [];

  const ensureDirectory = (dirPath: string): void => {
    if (fs.existsSync(dirPath)) return;
    const parent = path.dirname(dirPath);
    if (parent !== dirPath) ensureDirectory(parent);
    fs.mkdirSync(dirPath, { recursive: true });
    createdPaths.push(dirPath);
  };

  const copyFile = (sourcePath: string, targetPath: string): void => {
    // Only ever write where nothing exists: a pre-existing target is the user's.
    if (fs.existsSync(targetPath)) return;
    ensureDirectory(path.dirname(targetPath));
    createdPaths.push(targetPath);
    fs.copyFileSync(sourcePath, targetPath);
  };

  const copyDirectory = (sourcePath: string, targetPath: string): void => {
    if (fs.existsSync(targetPath)) return;
    ensureDirectory(targetPath);
    for (const entry of fs.readdirSync(sourcePath)) {
      const sourceEntry = path.join(sourcePath, entry);
      const targetEntry = path.join(targetPath, entry);
      if (fs.statSync(sourceEntry).isDirectory()) copyDirectory(sourceEntry, targetEntry);
      else copyFile(sourceEntry, targetEntry);
    }
  };

  const rollback = (): void => {
    for (let index = createdPaths.length - 1; index >= 0; index -= 1) {
      try {
        fs.rmSync(createdPaths[index]!, { recursive: true, force: true });
      } catch {
        // The original failure is the one the caller must see; a best-effort
        // removal failure must not replace it.
      }
    }
    createdPaths.length = 0;
  };

  try {
    ensureDirectory(options.newRoot);

    // 1. The database snapshot comes first, so an occupied database aborts
    //    before any other copy has been attempted.
    const legacyDatabasePath = path.join(options.legacyRoot, 'auth.db');
    const newDatabasePath = path.join(options.newRoot, 'auth.db');
    if (fs.existsSync(legacyDatabasePath) && !fs.existsSync(newDatabasePath)) {
      createdPaths.push(newDatabasePath);
      backupDatabase(legacyDatabasePath, newDatabasePath);
    }

    // 2. The data entries, each copied only when its target does not already
    //    exist. A missing legacy entry is simply not migrated.
    for (const entry of MIGRATED_DATA_ENTRIES) {
      const sourcePath = path.join(options.legacyRoot, entry);
      if (!fs.existsSync(sourcePath)) continue;
      const targetPath = path.join(options.newRoot, entry);
      if (fs.statSync(sourcePath).isDirectory()) copyDirectory(sourcePath, targetPath);
      else copyFile(sourcePath, targetPath);
    }

    // 3. The legacy settings move to the explicit config root, which is a
    //    separate tree from the data root (SPEC §4.4).
    if (fs.existsSync(options.legacySettingsPath)) {
      copyFile(options.legacySettingsPath, options.newSettingsPath);
    }

    // 4. The marker is last: its presence is the proof every step above ran.
    fs.writeFileSync(
      markerPath,
      `${JSON.stringify({ source: options.legacyRoot, at: now().toISOString(), version: options.version }, null, 2)}\n`,
      'utf8',
    );

    return { migrated: true, reason: 'migrated' };
  } catch (failure) {
    rollback();
    throw failure;
  }
}
