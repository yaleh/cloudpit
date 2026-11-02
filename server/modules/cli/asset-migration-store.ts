import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

/**
 * One app-owned persisted document that may embed a legacy asset path.
 *
 * `text` is the whole document (a JSON file's contents or one SQLite cell), so
 * the migration service can replace the path prefix and write the document back
 * as a unit. `handle` is opaque to the service and names what to write:
 * rewriting a SQLite row needs its key columns, and the service must not parse
 * a human-readable location string to recover them.
 */
export type PersistedAssetPathDocument = {
  /** Human-readable identity used in reports, e.g. `scheduled_messages[id=7].options`. */
  location: string;
  /** Current full text of the document. */
  text: string;
  /** Where the rewritten text belongs. */
  handle: AssetPathDocumentHandle;
};

/** Where one {@link PersistedAssetPathDocument} is stored. */
export type AssetPathDocumentHandle =
  | { kind: 'json-file'; filePath: string }
  | {
      kind: 'sqlite';
      table: string;
      column: string;
      keyColumns: string[];
      keyValues: Array<string | number>;
    };

/** One document plus the text that should replace its current contents. */
export type AssetPathDocumentUpdate = {
  document: PersistedAssetPathDocument;
  text: string;
};

/**
 * The app-owned stores whose documents may carry attachment paths.
 *
 * The migration service reads every document, rewrites the ones containing the
 * legacy root, and applies the whole batch through {@link writeDocuments}.
 * Backups are taken before the first write so {@link restore} can put the
 * stores back byte-for-byte when any write fails — the command must never leave
 * half the paths pointing at the new root.
 */
export type AssetPathStore = {
  readDocuments(): PersistedAssetPathDocument[];
  /** Snapshot every file the store can write; returns the backup paths. */
  backup(): string[];
  /** Apply all updates as one batch; throws when any write fails. */
  writeDocuments(updates: AssetPathDocumentUpdate[]): void;
  /** Put every file named by `backup()` back exactly as it was. */
  restore(backupPaths: string[]): void;
};

/** Options for {@link createAppAssetPathStore}. */
export type AppAssetPathStoreOptions = {
  /** The auth database holding scheduled messages and drafts; `null` skips the database. */
  databasePath: string | null;
  /** Known JSON state files (settings, cockpit card feedback, voice manifest). */
  jsonFilePaths: string[];
  /** Clock seam used in backup file names; defaults to the wall clock. */
  now?: () => Date;
};

const BACKUP_SUFFIX_MARKER = '.bak-asset-migration-';

/** SQLite columns that can hold an attachment path, grouped per table. */
const SQLITE_DOCUMENT_COLUMNS: Array<{
  table: string;
  keyColumns: string[];
  columns: string[];
}> = [
  { table: 'scheduled_messages', keyColumns: ['id'], columns: ['options'] },
  {
    table: 'session_drafts',
    keyColumns: ['user_id', 'draft_scope'],
    columns: ['draft_text', 'queued_message'],
  },
  {
    table: 'user_preferences',
    keyColumns: ['user_id', 'preference_key'],
    columns: ['preference_value'],
  },
];

/** `YYYYMMDD-HHmmss` in local time, used to keep backup names unique per run. */
function backupStamp(now: () => Date): string {
  const date = now();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`,
  ].join('-');
}

/** Reads and writes the app-owned path stores; see {@link AssetPathStore}. */
export function createAppAssetPathStore(options: AppAssetPathStoreOptions): AssetPathStore {
  const now = options.now ?? (() => new Date());
  const jsonFilePaths = [...new Set(options.jsonFilePaths)];

  const readableFiles = (): string[] => {
    const files: string[] = [];
    if (options.databasePath && fs.existsSync(options.databasePath)) {
      files.push(options.databasePath);
    }
    for (const filePath of jsonFilePaths) {
      if (fs.existsSync(filePath)) files.push(filePath);
    }
    return files;
  };

  return {
    readDocuments() {
      const documents: PersistedAssetPathDocument[] = [];
      for (const filePath of jsonFilePaths) {
        if (!fs.existsSync(filePath)) continue;
        documents.push({
          location: filePath,
          text: fs.readFileSync(filePath, 'utf8'),
          handle: { kind: 'json-file', filePath },
        });
      }
      if (!options.databasePath || !fs.existsSync(options.databasePath)) return documents;

      const database = new Database(options.databasePath, {
        readonly: true,
        fileMustExist: true,
      });
      try {
        const tableExists = database.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        );
        for (const table of SQLITE_DOCUMENT_COLUMNS) {
          if (!tableExists.get(table.table)) continue;
          const selection = [...table.keyColumns, ...table.columns].join(', ');
          const rows = database
            .prepare(`SELECT ${selection} FROM ${table.table}`)
            .all() as Array<Record<string, unknown>>;
          for (const row of rows) {
            const keyValues = table.keyColumns.map(
              (columnName) => row[columnName] as string | number,
            );
            for (const column of table.columns) {
              const value = row[column];
              if (typeof value !== 'string' || value === '') continue;
              const keyDescription = table.keyColumns
                .map((columnName, index) => `${columnName}=${String(keyValues[index])}`)
                .join(', ');
              documents.push({
                location: `${table.table}[${keyDescription}].${column}`,
                text: value,
                handle: {
                  kind: 'sqlite',
                  table: table.table,
                  column,
                  keyColumns: table.keyColumns,
                  keyValues,
                },
              });
            }
          }
        }
      } finally {
        database.close();
      }
      return documents;
    },

    backup() {
      const stamp = backupStamp(now);
      const backupPaths: string[] = [];
      for (const filePath of readableFiles()) {
        const backupPath = `${filePath}${BACKUP_SUFFIX_MARKER}${stamp}`;
        fs.copyFileSync(filePath, backupPath);
        backupPaths.push(backupPath);
      }
      return backupPaths;
    },

    writeDocuments(updates) {
      const jsonUpdates = updates.filter((update) => update.document.handle.kind === 'json-file');
      const sqliteUpdates = updates.filter((update) => update.document.handle.kind === 'sqlite');

      for (const update of jsonUpdates) {
        const handle = update.document.handle;
        if (handle.kind !== 'json-file') continue;
        fs.writeFileSync(handle.filePath, update.text, 'utf8');
      }

      if (sqliteUpdates.length === 0) return;
      if (!options.databasePath) {
        throw new Error('cannot write SQLite documents without a database path');
      }
      const database = new Database(options.databasePath);
      try {
        const applyAll = database.transaction(() => {
          for (const update of sqliteUpdates) {
            const handle = update.document.handle;
            if (handle.kind !== 'sqlite') continue;
            const assignments = `${handle.column} = ?`;
            const predicates = handle.keyColumns.map((columnName) => `${columnName} = ?`).join(' AND ');
            database
              .prepare(`UPDATE ${handle.table} SET ${assignments} WHERE ${predicates}`)
              .run(update.text, ...handle.keyValues);
          }
        });
        applyAll();
      } finally {
        database.close();
      }
    },

    restore(backupPaths) {
      for (const backupPath of backupPaths) {
        const markerIndex = backupPath.lastIndexOf(BACKUP_SUFFIX_MARKER);
        if (markerIndex === -1) {
          throw new Error(`not an asset-migration backup path: ${backupPath}`);
        }
        fs.copyFileSync(backupPath, backupPath.slice(0, markerIndex));
      }
    },
  };
}
