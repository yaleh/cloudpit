import type { Readable } from 'node:stream';
import type { WorkspacePathValidationResult } from './projects.js';

//----------------- FILE TREE MODULE CONTRACTS ------------
/**
 * One filesystem item returned by the File Tree API.
 *
 * The service populates metadata without following symlinks and recursively
 * attaches `children` only while the requested depth permits traversal. The
 * frontend uses the absolute `path` as the stable identifier for editor and
 * file-operation requests.
 */
export type FileTreeNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string | null;
  permissions: string;
  permissionsRwx: string;
  isSymlink?: boolean;
  children?: FileTreeNode[];
  // Lazy directory listings never open child directories, so a directory entry
  // reports whether it may have children optimistically (always true today) and
  // the frontend draws an expander without a peek request.
  hasChildren?: boolean;
};

/**
 * One lazily-listed directory level for the Files tab.
 *
 * The listing contains exactly the visible entries of `path` (no recursion).
 * `truncated` is true when the directory has more visible entries than the
 * per-directory cap, in which case `entries` holds the first `cap` of them and
 * the request still succeeds instead of failing the whole tree.
 */
export type FileTreeDirectoryListing = {
  path: string;
  entries: FileTreeNode[];
  truncated: boolean;
};

/**
 * One flat entry in a project's file index.
 *
 * The index exists so filename-resolution consumers (chat @-mentions, the command
 * palette, the open-file resolver, Files-tab search) can share one bounded list
 * instead of each walking the project tree. `path` is absolute and `name` is its
 * basename, so a consumer can match on either without re-deriving the parent.
 *
 * Entries describe files only: a git-backed index is exactly the path set from
 * `git ls-files`, which lists no directories, and the non-git fallback matches
 * that shape. `type` stays a union so a later directory-index reader can widen
 * the contract without a second entry type.
 */
export type FileTreeIndexEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
};

/**
 * A project's bounded flat file index.
 *
 * `truncated` is true only when the non-git filesystem fallback stopped at the
 * entry cap. A git-backed index is exact and therefore never truncated.
 */
export type FileTreeIndex = {
  files: FileTreeIndexEntry[];
  truncated: boolean;
};

/**
 * Minimal directory-entry shape required during File Tree traversal.
 *
 * Production adapts Node `Dirent` objects to this structural contract. Tests
 * provide small handwritten entries and therefore never read real directories.
 */
export type FileTreeDirectoryEntry = {
  name: string;
  isDirectory(): boolean;
};

/**
 * Minimal file-stat shape used for tree metadata and delete decisions.
 *
 * The numeric mode is converted to octal and rwx strings for the UI. `lstat`
 * supplies symlink state while `stat` is used when deciding file versus folder
 * deletion behavior.
 */
export type FileTreeStats = {
  size: number;
  mtime: Date;
  mode: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
};

/**
 * Complete filesystem capability injected into File Tree services.
 *
 * The production composition root delegates these operations to Node's fs
 * APIs. Unit tests provide deterministic path-keyed fakes so service tests
 * cannot inspect, write, rename, or delete developer files.
 */
export type FileTreeFileSystem = {
  access(candidatePath: string): Promise<void>;
  stat(candidatePath: string): Promise<FileTreeStats>;
  lstat(candidatePath: string): Promise<FileTreeStats>;
  // Streamed rather than returned as an array so a directory with millions of
  // children is abandoned at the entry limit instead of being materialized.
  openDirectory(directoryPath: string): AsyncIterable<FileTreeDirectoryEntry>;
  realpath(candidatePath: string): Promise<string>;
  readTextFile(filePath: string): Promise<string>;
  writeTextFile(filePath: string, content: string): Promise<void>;
  makeDirectory(directoryPath: string, recursive: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  removeDirectory(directoryPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  copyFile(sourcePath: string, destinationPath: string): Promise<void>;
  createReadStream(filePath: string): Readable;
  // Optional repository probes for the flat file index. Production supplies both
  // (a git-backed index); a filesystem-only fake may omit them, and the service
  // then takes the bounded walk fallback. They are optional so adding this
  // reading seam does not force every existing test fake to grow two members.
  isGitRepository?(projectRoot: string): Promise<boolean>;
  // Project-root-relative POSIX paths, exactly as `git ls-files` reports them.
  listGitFiles?(projectRoot: string): Promise<string[]>;
};

/**
 * Project lookup boundary consumed by File Tree workflows.
 *
 * File Tree services resolve DB-assigned project ids through this contract and
 * never import the Database module or its repositories directly.
 */
export type FileTreeProjectGateway = {
  getProjectPathById(projectId: string): string | null | Promise<string | null>;
};

/**
 * Workspace validation boundary used by filesystem browsing and folder creation.
 *
 * The injected validator enforces the configured workspace root and resolves
 * symlinks before the File Tree service exposes or mutates paths.
 */
export type FileTreeWorkspaceGateway = {
  rootPath: string;
  validatePath(candidatePath: string): Promise<WorkspacePathValidationResult>;
};

/**
 * Uploaded-file record passed from the Multer transport adapter into the File
 * Tree service.
 *
 * Transport-specific field names are normalized so upload workflows do not
 * depend on Express or Multer types.
 */
export type FileTreeUploadedFile = {
  originalName: string;
  temporaryPath: string;
  size: number;
  mimeType: string;
};

/**
 * Logger boundary for expected File Tree diagnostics.
 *
 * Production delegates to the server console. Unit tests use no-op or captured
 * loggers and never patch the global console singleton.
 */
export type FileTreeLogger = {
  error(message: string, error?: unknown): void;
};

/**
 * Required production dependencies for the File Tree application service.
 *
 * Filesystem, project lookup, workspace policy, MIME detection, concurrency,
 * and logging are all explicit so service construction has no hidden process,
 * repository, or machine-wide defaults.
 */
export type FileTreeServiceDependencies = {
  fileSystem: FileTreeFileSystem;
  projects: FileTreeProjectGateway;
  workspace: FileTreeWorkspaceGateway;
  resolveMimeType(filePath: string): string;
  fileSystemConcurrency: number;
  logger: FileTreeLogger;
};

/**
 * Complete File Tree application-service surface consumed by HTTP routes.
 *
 * Routes parse transport inputs and call these methods; they never resolve
 * project repositories, validate filesystem ownership, or perform filesystem
 * mutations themselves.
 */
export type FileTreeServices = {
  browseWorkspace(inputPath: string | null): Promise<{
    path: string;
    suggestions: Array<{ path: string; name: string; type: 'directory' }>;
  }>;
  createWorkspaceFolder(folderPath: string): Promise<{ success: true; path: string }>;
  readTextFile(projectId: string, filePath: string): Promise<{ content: string; path: string }>;
  openFile(projectId: string, filePath: string): Promise<{ contentType: string; stream: Readable }>;
  saveTextFile(projectId: string, filePath: string, content: string): Promise<{
    success: true;
    path: string;
    message: string;
  }>;
  // Lazy Files tab listing: exactly one directory level, bounded per directory.
  // `directoryPath` omitted (or the project root) lists the project root.
  listProjectDirectory(
    projectId: string,
    directoryPath?: string,
  ): Promise<FileTreeDirectoryListing>;
  // Flat file index shared by filename-resolution consumers; a git project is
  // served from `git ls-files`, everything else from a bounded filesystem walk.
  listProjectFileIndex(projectId: string): Promise<FileTreeIndex>;
  // Files-tab search index: an unfiltered bounded walk of what is on disk
  // (gitignored paths, `.git/`, `node_modules/` included). Deliberately
  // separate from `listProjectFileIndex`: display/search read disk truth,
  // filename references read git semantics.
  listProjectSearchIndex(projectId: string): Promise<FileTreeIndex>;
  createEntry(input: {
    projectId: string;
    parentPath: string;
    type: 'file' | 'directory';
    name: string;
  }): Promise<{ success: true; path: string; name: string; type: 'file' | 'directory'; message: string }>;
  renameEntry(input: { projectId: string; oldPath: string; newName: string }): Promise<{
    success: true;
    oldPath: string;
    newPath: string;
    newName: string;
    message: string;
  }>;
  deleteEntry(input: { projectId: string; targetPath: string }): Promise<{
    success: true;
    path: string;
    type: 'file' | 'directory';
    message: string;
  }>;
  storeUploadedFiles(input: {
    projectId: string;
    targetPath: string;
    relativePaths: string[];
    requestedFileCount: number;
    files: FileTreeUploadedFile[];
  }): Promise<{
    success: true;
    files: Array<{ name: string; path: string; size: number; mimeType: string }>;
    uploadedCount: number;
    requestedFileCount: number;
    targetPath: string;
    message: string;
  }>;
};

// ---------------------------
