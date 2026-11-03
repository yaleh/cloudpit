import fs from 'node:fs';
import path from 'node:path';

/**
 * Synchronous filesystem seam for `cloudpit migrate-assets`.
 *
 * The command copies the legacy asset tree and scans provider transcripts
 * read-only, so every call is synchronous and every call goes through this
 * seam. Tests inject a fixture-rooted adapter to prove the dry run touches
 * nothing; the composition root injects {@link createNodeAssetMigrationFileSystem}.
 */
export type AssetMigrationFileSystem = {
  pathExists(filePath: string): boolean;
  isDirectory(filePath: string): boolean;
  listDirectoryNames(directoryPath: string): string[];
  readTextFile(filePath: string): string;
  readFileBytes(filePath: string): Buffer;
  copyFile(sourcePath: string, targetPath: string): void;
  createDirectory(directoryPath: string): void;
};

/** Node-backed implementation wired by `cli.module.ts` and by the command's tests. */
export function createNodeAssetMigrationFileSystem(): AssetMigrationFileSystem {
  return {
    pathExists: (filePath) => fs.existsSync(filePath),
    isDirectory: (filePath) => {
      try {
        return fs.statSync(filePath).isDirectory();
      } catch {
        return false;
      }
    },
    listDirectoryNames: (directoryPath) => fs.readdirSync(directoryPath),
    readTextFile: (filePath) => fs.readFileSync(filePath, 'utf8'),
    readFileBytes: (filePath) => fs.readFileSync(filePath),
    copyFile: (sourcePath, targetPath) => {
      fs.copyFileSync(sourcePath, targetPath);
    },
    createDirectory: (directoryPath) => {
      fs.mkdirSync(directoryPath, { recursive: true });
    },
  };
}

/**
 * Every regular file under `rootPath`, recursively, as absolute paths sorted
 * lexicographically so the report is stable across runs. A missing or
 * non-directory root is an empty list rather than an error: both the legacy
 * assets root and the provider transcript roots are legitimately absent on a
 * fresh machine, and an absent directory means "nothing to migrate".
 *
 * Symlinked directories are NOT followed: the asset store is a flat
 * upload directory and a link loop must not hang the command.
 */
export function listFilesUnder(
  fileSystem: AssetMigrationFileSystem,
  rootPath: string,
): string[] {
  if (!fileSystem.isDirectory(rootPath)) return [];
  const files: string[] = [];
  const pendingDirectories = [rootPath];
  while (pendingDirectories.length > 0) {
    const directoryPath = pendingDirectories.pop() as string;
    let entries: string[];
    try {
      entries = fileSystem.listDirectoryNames(directoryPath);
    } catch {
      // A directory that vanished between listing and reading contributes
      // nothing; a permission failure on a transcript directory must not abort
      // the whole scan.
      continue;
    }
    for (const entryName of entries) {
      const entryPath = path.join(directoryPath, entryName);
      if (fileSystem.isDirectory(entryPath)) {
        pendingDirectories.push(entryPath);
      } else {
        files.push(entryPath);
      }
    }
  }
  return files.sort();
}

/** True when two files hold byte-identical content. */
export function filesHaveSameContent(
  fileSystem: AssetMigrationFileSystem,
  leftPath: string,
  rightPath: string,
): boolean {
  try {
    return fileSystem.readFileBytes(leftPath).equals(fileSystem.readFileBytes(rightPath));
  } catch {
    return false;
  }
}
