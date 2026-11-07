/**
 * The MCP gateway's `project_create` tool (gap-mcp-project-create-tool).
 *
 * A caller can already READ projects (`projects_list`) and open sessions under
 * one (`session_create`), but nothing on the wire could REGISTER a project: the
 * only way in was the UI's `POST /api/projects/create-project` route. This tool
 * is the MCP face over the SAME service that route calls
 * (`server/modules/projects/services/project-management.service.ts` →
 * `createProject`), so the two front doors cannot disagree about which
 * directories are allowed, what a project row carries, or what an archived path
 * reactivates as.
 *
 * ## Reuse, never a second implementation
 *
 * Nothing here re-implements path safety or directory creation. The injected
 * `createProject` is the production service: it normalizes the path, runs
 * `validateWorkspacePath` (system-directory blacklist, realpath, parent
 * resolution for a not-yet-existing directory), `mkdir -p`s the directory, and
 * persists the row — answering `created`, `reactivated_archived`, or throwing
 * `PROJECT_ALREADY_EXISTS` for an ACTIVE duplicate. The one thing this module
 * adds is the IDEMPOTENT reading: `PROJECT_ALREADY_EXISTS` is not an error a
 * caller should have to special-case, so the tool reads the existing row back
 * through the injected `findProjectByPath` and answers
 * `{ created: false, outcome: 'existing' }` with the SAME project id. Calling
 * the tool twice with one path therefore always names one project.
 *
 * Any other `AppError` the service raises (an invalid/system path, or a path
 * that exists but is not a directory) is translated to the gateway's
 * `INVALID_ARGUMENT` envelope with the service's own code in `details.code` —
 * structured, retryable:false, and with no row written, because the service
 * throws before its persist step. A non-`AppError` failure is rethrown so the
 * audited wrapper's catch-all reports `INTERNAL_ERROR` rather than mislabelling
 * a bug as caller error.
 *
 * ## Why it is not one of `MCP_STAGE4_WRITE_TOOLS`
 *
 * AC-249's criterion pins that table to exactly the five SPEC tools. Like
 * `draft_*`, `session_steer` and the `ui_*` family, `project_create` registers
 * ALONGSIDE them through the same write-tool seam, and only when its deps are
 * supplied — a mount that predates this task keeps registering exactly its old
 * name set, so `tools/list` does not move under it.
 *
 * ## Scope
 *
 * `cloudcli:session:create` — the closest existing write authority (a caller
 * allowed to open sessions is the caller for whom registering a project already
 * matters). No new scope is minted: the scope vocabulary is positional and
 * AC-243 pins it.
 *
 * ## Why this file sits at the module root
 *
 * The proposal named `tools/projects/mcp-project-create.ts`, but a NEW directory
 * under `tools/` would red AC-394's directory leaf rule: the registrar in
 * `modules/mcp-gateway/` imports the tool, and a directory absent from the
 * committed manifest may have no inbound edge from another `modules/**`
 * directory. The module root is an existing manifest directory, so the tool
 * lives here beside the gateway's other module-level seams
 * (`mcp-resolve-target.ts`, `mcp-self-target.ts`).
 */

import { z } from 'zod';

import { AppError } from '@/shared/utils.js';

import { MCP_ERROR_CODES, McpToolError } from './tools/shared/mcp-error-envelope.js';
import type { McpPrincipal } from './tools/shared/mcp-gateway.auth.js';
import type { McpWriteToolRegistration, McpWriteToolSeam } from './tools/shared/mcp-write-contract.js';

// --------------------------- the tool identity ---------------------------

/** The tool's `tools/list` name. Registered alongside the five SPEC write tools. */
export const PROJECT_CREATE_TOOL_NAME = 'project_create';

/**
 * What `project_create` says it does on `tools/list`.
 *
 * The two properties a caller must be able to read BEFORE calling are stated:
 * a repeat with the same path is the same project (idempotent), and a system or
 * unusable directory is refused without writing anything.
 */
export const PROJECT_CREATE_DESCRIPTION =
  'Register a directory as a Cloudpit project and return its projectId and path, ready for projects_list and session_create. ' +
  'Repeating the same path returns the same project instead of creating a second one; a system directory or an unusable path is refused and nothing is written.';

// --------------------------- injected services ---------------------------

/**
 * One project as this tool reports it: the projection
 * `createProject` / `findProjectByPath` already answer with (the same fields
 * `projects_list` carries for a project row).
 */
export type McpProjectCreateProject = {
  projectId: string;
  path: string;
  fullPath: string;
  displayName: string;
};

/**
 * The services `project_create` answers from, all injected.
 *
 * `createProject` is the production project-management service the UI route
 * calls — the tool never re-validates a path or creates a directory itself.
 * `findProjectByPath` is the same row projection read back by normalized path;
 * it answers the ACTIVE row only, which is exactly the row
 * `PROJECT_ALREADY_EXISTS` collided with.
 */
export type McpProjectCreateDeps = {
  createProject(input: { projectPath: string; customName?: string | null }): Promise<{
    outcome: 'created' | 'reactivated_archived';
    project: McpProjectCreateProject;
  }>;
  findProjectByPath(projectPath: string): McpProjectCreateProject | null;
};

// --------------------------- input and payload ---------------------------

/** The `project_create` tool's typed input. */
export type McpProjectCreateInput = {
  /** The directory to register. Absolute, or resolved by the service's own normalization. */
  path: string;
  /** The display name to record; absent takes the directory's basename. */
  name?: string;
};

/** The `project_create` tool's Zod input shape, used for registration and validation. */
export const PROJECT_CREATE_INPUT_SCHEMA = {
  path: z.string(),
  name: z.string().optional(),
} satisfies z.ZodRawShape;

/**
 * The `project_create` result.
 *
 * `outcome` is the honest three-way reading: `created` (a new row),
 * `reactivated_archived` (an archived row with that path is active again), and
 * `existing` (an ACTIVE row already existed, so this call changed nothing).
 * `created` is true only for the first; a reactivation and a no-op both answer
 * false, so "did this call mint a row" is never conflated with "is the project
 * usable now".
 */
export type ProjectCreatePayload = McpProjectCreateProject & {
  created: boolean;
  outcome: 'created' | 'reactivated_archived' | 'existing';
};

/** Reads and validates `project_create`'s arguments. */
export function readProjectCreateInput(args: Record<string, unknown>): McpProjectCreateInput {
  const path = args.path;
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new McpToolError(
      MCP_ERROR_CODES.INVALID_ARGUMENT,
      '"path" is required and must be a non-empty string.',
    );
  }
  const rawName = args.name;
  if (rawName !== undefined && rawName !== null && typeof rawName !== 'string') {
    throw new McpToolError(MCP_ERROR_CODES.INVALID_ARGUMENT, '"name" must be a string when provided.');
  }
  const trimmedName = typeof rawName === 'string' ? rawName.trim() : '';
  return {
    path: path.trim(),
    ...(trimmedName.length > 0 ? { name: trimmedName } : {}),
  };
}

/** One project row as the payload, without its outcome. */
function toPayload(project: McpProjectCreateProject): McpProjectCreateProject {
  return {
    projectId: project.projectId,
    path: project.path,
    fullPath: project.fullPath,
    displayName: project.displayName,
  };
}

// --------------------------- buildProjectCreate ---------------------------

/**
 * Registers (or finds) the project at `input.path`.
 *
 * The happy path is one call to the injected `createProject`; its outcome is
 * reported verbatim. An ACTIVE duplicate is turned into the idempotent reading
 * by reading the row back through `findProjectByPath` — the SAME id the first
 * call answered with, because the row is keyed by its normalized path. Any other
 * `AppError` becomes `INVALID_ARGUMENT` carrying the service's code, and no row
 * exists to roll back because the service throws before persisting.
 *
 * Consumers: `registerMcpWriteTools` (the registered handler) and this module's
 * criterion.
 */
export async function buildProjectCreate(
  input: McpProjectCreateInput,
  _ctx: { principal: McpPrincipal },
  deps: McpProjectCreateDeps,
): Promise<ProjectCreatePayload> {
  try {
    const result = await deps.createProject({
      projectPath: input.path,
      customName: input.name ?? null,
    });
    return {
      ...toPayload(result.project),
      created: result.outcome === 'created',
      outcome: result.outcome,
    };
  } catch (error) {
    if (error instanceof AppError && error.code === 'PROJECT_ALREADY_EXISTS') {
      const existing = deps.findProjectByPath(input.path);
      if (existing === null) {
        throw new McpToolError(
          MCP_ERROR_CODES.INTERNAL_ERROR,
          'The existing project for this path could not be read back.',
          false,
          { path: input.path },
        );
      }
      return { ...toPayload(existing), created: false, outcome: 'existing' };
    }
    if (error instanceof AppError) {
      throw new McpToolError(MCP_ERROR_CODES.INVALID_ARGUMENT, error.message, false, {
        // The service's own code: the caller sees WHY (system directory, not a
        // directory, …) without this tool minting a second vocabulary for it.
        code: error.code,
        ...(error.details === undefined ? {} : { details: error.details }),
      });
    }
    throw error;
  }
}

// --------------------------- registration ---------------------------

/**
 * Installs `project_create` through the write-tool seam.
 *
 * The scope is passed in by the assembler (the write table's
 * `cloudcli:session:create`), so this module never restates the vocabulary.
 * Consumers: `registerMcpWriteTools` and this module's criterion.
 */
export function registerMcpProjectCreateTool(
  seam: McpWriteToolSeam,
  deps: McpProjectCreateDeps,
  requiredScope: string,
): void {
  const registration: McpWriteToolRegistration = {
    name: PROJECT_CREATE_TOOL_NAME,
    description: PROJECT_CREATE_DESCRIPTION,
    requiredScope,
    inputSchema: PROJECT_CREATE_INPUT_SCHEMA,
    outputSchema: {
      projectId: z.string(),
      path: z.string(),
      fullPath: z.string(),
      displayName: z.string(),
      created: z.boolean(),
      outcome: z.string(),
    },
    handler: (args, ctx) => buildProjectCreate(readProjectCreateInput(args), ctx, deps),
  };
  seam(registration);
}
