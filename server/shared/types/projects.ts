

//----------------- PROJECT PERSISTENCE TYPES ------------
/**
 * Canonical project row shape returned by the projects repository.
 *
 * Use this type whenever backend services need to pass around one database
 * project record without leaking raw SQL row typing across modules.
 */
export type ProjectRepositoryRow = {
  project_id: string;
  project_path: string;
  custom_project_name: string | null;
  isStarred: number;
  isArchived: number;
  session_filter?: string | null;
};

/**
 * Result category returned by `projectsDb.createProjectPath`.
 *
 * `created` means a fresh row was inserted, `reactivated_archived` means an
 * existing archived path was accepted and updated, and `active_conflict` means
 * an already-active path blocked project creation.
 */
export type CreateProjectPathOutcome =
  | 'created'
  | 'reactivated_archived'
  | 'active_conflict';

/**
 * Structured result returned by project-path upsert operations.
 *
 * Services should use this result to decide whether a request succeeded,
 * should return a conflict, or needs follow-up retrieval of row metadata.
 */
export type CreateProjectPathResult = {
  outcome: CreateProjectPathOutcome;
  project: ProjectRepositoryRow | null;
};

/**
 * Validation result for user-supplied workspace/project paths.
 *
 * `resolvedPath` is present only when validation succeeds. `error` is present
 * only when validation fails and is suitable for user-facing diagnostics.
 */
export type WorkspacePathValidationResult = {
  valid: boolean;
  resolvedPath?: string;
  error?: string;
};

// ---------------------------
//----------------- GIT WORKTREE MANAGEMENT ------------
/**
 * Captured output of one completed `git` invocation.
 *
 * Returned by `GitCommandRunner` implementations so worktree services can read
 * both streams without caring about process plumbing.
 */
export type GitCommandResult = {
  stdout: string;
  stderr: string;
};

/**
 * Executes `git <args>` inside `cwd` and resolves with the captured output.
 *
 * All worktree services receive their git access through this contract so
 * tests can inject a fake runner instead of spawning real processes. The
 * promise must reject (with `stderr` attached when available) on a non-zero
 * exit code.
 */
export type GitCommandRunner = (args: string[], cwd: string) => Promise<GitCommandResult>;

/**
 * One entry parsed from `git worktree list --porcelain`.
 *
 * This is the raw repository-level view (path/HEAD/branch/flags) before any
 * enrichment with project links or ahead/behind counts. `branch` is null for
 * detached-HEAD worktrees.
 */
export type WorktreePorcelainEntry = {
  path: string;
  headSha: string | null;
  branch: string | null;
  isDetached: boolean;
  isLocked: boolean;
  isPrunable: boolean;
};

/**
 * Fully enriched worktree row served to the UI.
 *
 * Extends the porcelain entry with everything the Worktrees panel renders:
 * dirty-file count, ahead/behind relative to the base branch (the branch
 * checked out in the main worktree), last-commit metadata, and the Cloudpit
 * project row linked to the worktree directory (if one was registered).
 */
export type WorktreeDescriptor = {
  path: string;
  branch: string | null;
  headSha: string | null;
  isMain: boolean;
  isCurrent: boolean;
  isLocked: boolean;
  isDetached: boolean;
  changedFileCount: number;
  ahead: number;
  behind: number;
  lastCommitSubject: string | null;
  lastCommitDate: string | null;
  linkedProjectId: string | null;
  linkedProjectArchived: boolean;
};

/**
 * Response payload of `GET /api/worktrees`.
 *
 * `baseBranch` is the branch checked out in the main worktree — the merge
 * target offered by the UI. `worktrees` always lists the main worktree first.
 */
export type WorktreeListResult = {
  repositoryRoot: string;
  baseBranch: string | null;
  worktrees: WorktreeDescriptor[];
};

// ---------------------------
//----------------- WORKTREE SERVICE INPUTS AND RESULTS ------------
/**
 * Input accepted by the worktree-listing workflow.
 *
 * `projectPath` may point at the main checkout or any linked worktree. The
 * service uses Git to resolve the complete repository-level worktree list.
 */
export type ListWorktreesInput = {
  projectPath: string;
};

/**
 * Input accepted when creating a linked Git worktree.
 *
 * `branch` is checked out when it already exists, otherwise it is created from
 * `baseBranch`. When `baseBranch` is omitted, the main worktree branch is used.
 */
export type CreateWorktreeInput = {
  projectPath: string;
  branch: string;
  baseBranch?: string | null;
};

/**
 * Result of successfully creating a linked Git worktree.
 *
 * `createdBranch` distinguishes a new branch from an existing branch checkout,
 * allowing API clients to accurately describe what Git changed.
 */
export type CreateWorktreeResult = {
  worktreePath: string;
  branch: string;
  createdBranch: boolean;
};

/**
 * Result of atomically creating and registering a worktree for project use.
 *
 * The Worktrees application service compensates the Git creation if project
 * registration fails, so routes only receive this shape after both steps pass.
 */
export type CreateAndOpenWorktreeResult = CreateWorktreeResult & {
  project: WorktreeProjectView;
};

/**
 * Input accepted when registering an existing worktree as a Cloudpit project.
 *
 * The service verifies that `worktreePath` belongs to the repository containing
 * `projectPath` before it creates or restores any project record.
 */
export type OpenWorktreeInput = {
  projectPath: string;
  worktreePath: string;
};

/**
 * Project view returned after a worktree is opened in Cloudpit.
 *
 * This deliberately mirrors the project-selection payload used by the Projects
 * module so the frontend can switch to the worktree without another lookup.
 */
export type WorktreeProjectView = {
  projectId: string;
  path: string;
  fullPath: string;
  displayName: string;
  isStarred: boolean;
  sessions: [];
  sessionMeta: { hasMore: false; total: 0 };
};

/**
 * Input accepted when removing a linked Git worktree.
 *
 * `force` permits removal with local changes. `deleteBranch` requests
 * best-effort branch cleanup after the worktree directory is removed.
 */
export type RemoveWorktreeInput = {
  projectPath: string;
  worktreePath: string;
  force?: boolean;
  deleteBranch?: boolean;
};

/**
 * Result of removing a linked Git worktree.
 *
 * `archivalError` reports best-effort project archival failure after Git has
 * already removed the worktree, allowing callers to represent partial success.
 */
export type RemoveWorktreeResult = {
  removedPath: string;
  branch: string | null;
  branchDeleted: boolean;
  archivedProjectId: string | null;
  archivalError: string | null;
};

/**
 * Input accepted when merging a linked worktree into the main worktree branch.
 *
 * The service verifies both worktrees are clean, supports squash and regular
 * merges, and may remove the source worktree after a successful merge.
 */
export type MergeWorktreeInput = {
  projectPath: string;
  worktreePath: string;
  squash?: boolean;
  message?: string | null;
  removeAfterMerge?: boolean;
};

/**
 * Result of a completed worktree merge.
 *
 * `removedWorktree` is populated only when post-merge removal succeeds.
 * `cleanupError` reports failed optional removal without misrepresenting the
 * already-completed merge as a failure.
 */
export type MergeWorktreeResult = {
  mergedBranch: string;
  targetBranch: string;
  squash: boolean;
  removedWorktree: RemoveWorktreeResult | null;
  cleanupError: string | null;
};

// ---------------------------
//----------------- WORKTREE MODULE DEPENDENCY CONTRACTS ------------
/**
 * Filesystem capability required by the Worktrees module.
 *
 * Production wiring checks the real filesystem; unit tests provide a small
 * deterministic fake so worktree creation never touches developer directories.
 */
export type WorktreeFileSystem = {
  pathExists(candidatePath: string): Promise<boolean>;
};

/**
 * Project-management boundary consumed by Worktrees workflows.
 *
 * The Worktrees module uses this contract instead of importing Database or
 * Projects internals. Production adapters delegate through those modules'
 * `index.ts` barrels, while unit tests supply in-memory functions.
 */
export type WorktreeProjectGateway = {
  getProjectPathById(projectId: string): string | null;
  getProjectByPath(projectPath: string): ProjectRepositoryRow | null;
  createProject(input: {
    projectPath: string;
    customName: string;
  }): Promise<{
    outcome: 'created' | 'reactivated_archived';
    project: { projectId: string };
  }>;
  restoreProject(projectId: string): void | Promise<void>;
  archiveProject(projectId: string): void | Promise<void>;
};

/**
 * Complete application-service surface used by the Worktrees HTTP router.
 *
 * Routes parse transport values and call these functions; they do not import
 * repositories, filesystem adapters, Git runners, or individual service files.
 */
export type WorktreeServices = {
  resolveProjectPath(projectId: string): string;
  list(input: ListWorktreesInput): Promise<WorktreeListResult>;
  create(input: CreateWorktreeInput): Promise<CreateWorktreeResult>;
  createAndOpen(input: CreateWorktreeInput): Promise<CreateAndOpenWorktreeResult>;
  open(input: OpenWorktreeInput): Promise<WorktreeProjectView>;
  merge(input: MergeWorktreeInput): Promise<MergeWorktreeResult>;
  remove(input: RemoveWorktreeInput): Promise<RemoveWorktreeResult>;
};

// ---------------------------
