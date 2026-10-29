/**
 * The read-tool CONTRACT — the deps bag, the registration seam and the row
 * shapes every read tool is written against.
 *
 * Proposal `docs/proposals/mcp-gateway-tool-architecture.md` stage 2: these
 * declarations moved out of `mcp-gateway.read-tools.ts` into a LEAF so the
 * individual read-tool modules can type themselves against the contract
 * without importing the registrar that assembles them. That back-edge was one
 * of the edges closing the 23-file intra-package SCC (routine finding
 * `cycle-mcp-gateway-intra-package-scc`).
 *
 * LEAFLESSNESS: this file imports only `@/shared/**` (the MCP contract and the
 * generic shared types) — never `server/modules/**` and never a sibling module
 * in this package. The feature-specific optional bags on the FULL deps type
 * (`changes`, `runGet`, `sessionSearch`, `draft`, `ui*`) live with the registrar
 * (`mcp-read-tools-registry.ts`), which is allowed to import them precisely
 * because nothing imports it back.
 *
 * The full `McpReadToolDeps` is `McpReadToolDepsBase & { …feature bags }`; a
 * tool module that only reads the common services takes {@link McpReadToolDepsBase},
 * and the registrar's wiring guards narrow the optional bags generically.
 */
import type { z } from 'zod';

import type {
  McpApprovalPending,
  McpPrincipal,
  McpToolInputSchema,
} from '@/shared/mcp-contract/index.js';
import type { HostMode, LLMProvider, NormalizedMessage, ProcessHost } from '@/shared/types.js';

/**
 * The pending-approval reader `session_get` / `sessions_list` draw their
 * pending-interaction reading from.
 *
 * Structurally a single-session view of the runtime's own
 * `getPendingApprovalsForSession` — the read tools must not know whether the
 * runtime or the shared control service sits behind it, only that it answers
 * the same entries `approvals_list` does. Optional: a mount that predates this
 * reading (or a criterion exercising only the other tools) simply reports no
 * pending interaction, because this is one more injected capability rather than
 * a condition for serving the tools.
 */
export type McpApprovalReader = {
  pendingForSession(sessionId: string): McpApprovalPending[];
};

/** The slice of a project row the tools read (structurally satisfied by `ProjectListItem`). */
export type McpProjectPage = {
  projectId: string;
  path: string;
  displayName: string;
  sessionMeta: { total: number };
  sessions: ReadonlyArray<{ lastActivity?: string | null }>;
  /** Present only on the archived listing; absent on the active one. */
  isArchived?: boolean;
};

/** The slice of one project-page session the tools read (structurally satisfied by `SessionSummary`). */
export type McpProjectSession = {
  id: string;
  provider: string;
  summary: string;
  lastActivity?: string | null;
};

/** The slice of one recents-list row the tools read (structurally satisfied by `RecentSessionListItem`). */
export type McpRecentSession = {
  sessionId: string;
  provider: string;
  projectId: string | null;
  sessionTitle: string;
  lastActivity: string | null;
};

/** One outline turn as the provider service returns it. */
export type McpOutlineTurn = { id: string; index: number; timestamp: string; preview: string };

/** The project-sessions page the tools read (structurally satisfied by `ProjectSessionsPageApiView`). */
export type McpProjectSessionsPage = { projectId: string; sessions: ReadonlyArray<McpProjectSession> };

/** The recents page the tools read (structurally satisfied by `RecentSessionsPage`). */
export type McpRecentSessionsPage = { conversations: ReadonlyArray<McpRecentSession>; total: number };

/** One session's stored lifecycle preference (structurally satisfied by `SessionLifecycleReading`). */
export type McpSessionLifecycle = { provider: LLMProvider; mode: HostMode };

/** A history page (structurally satisfied by `FetchHistoryResult`). */
export type McpHistoryPage = { messages: ReadonlyArray<NormalizedMessage>; total: number };

/** A turn outline (structurally satisfied by `SessionTurnOutline`). */
export type McpOutline = { total: number; turns: ReadonlyArray<McpOutlineTurn> };

/** A window around one message (structurally satisfied by `SessionMessageWindow`). */
export type McpMessageWindow = { messages: ReadonlyArray<NormalizedMessage>; startIndex: number; total: number };

/**
 * The slice of one stored session row the by-id reader returns (structurally
 * satisfied by the session repository's own `SessionRow`).
 */
export type McpSessionLookupRow = {
  session_id: string;
  provider: string;
  project_path: string | null;
  custom_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  isArchived: number;
};

/** One live run (structurally satisfied by the chat run registry's reading). */
export type McpRunningRun = {
  sessionId: string;
  provider: LLMProvider;
  startedAt: number;
  lastSeq: number;
  /**
   * AC-337: the opaque label the caller that opened this run attached, or null.
   * OPTIONAL on this structural dep type (the registry's own reading always
   * carries it) so a mount that predates AC-337 — every criterion that fakes a
   * registry — stays a valid deps bag; an absent reading is `undefined`, which
   * matches no label and therefore widens nothing. Consumed by `sessions_list`'s
   * optional `correlationId` filter.
   */
  correlationId?: string | null;
};

/** One tracked run's read-only summary (structurally satisfied by `ChatRunSummary`). */
export type McpRunSummary = {
  runId: string;
  sessionId: string;
  status: 'running' | 'completed' | 'aborted';
  startedAt: number;
  completedAt: number | null;
};

/**
 * The services every read tool answers from, all injected.
 *
 * Production passes the process singletons (`server/index.ts`); the criterion
 * passes the same real objects over a temp database and a host manager it drove
 * itself. Only the members a tool actually reads are declared, so a caller
 * cannot be asked for a capability nothing uses.
 *
 * The FULL deps type is this base plus the registrar's feature bags; see
 * `mcp-read-tools-registry.ts`.
 */
export type McpReadToolDepsBase = {
  projects: {
    getProjectsWithSessions(options?: {
      skipSynchronization?: boolean;
      sessionsLimit?: number;
      sessionsOffset?: number;
      includeHidden?: boolean;
    }): Promise<ReadonlyArray<McpProjectPage>>;
    getArchivedProjectsWithSessions(options?: {
      skipSynchronization?: boolean;
    }): Promise<ReadonlyArray<McpProjectPage>>;
    getProjectSessionsPage(
      projectId: string,
      options?: { limit?: number; offset?: number; includeHidden?: boolean },
    ): Promise<McpProjectSessionsPage>;
    /**
     * The id of the project stored at one filesystem path, or null when no
     * project is registered there (gap-mcp-session-get-past-recents-page-and-
     * small-envelope-defects). It resolves the `projectId` of a session read by
     * id — the one field whose value `listRecentSessions` takes from a lookup
     * rather than from the session row itself.
     *
     * REQUIRED, not optional: a mount that wires the by-id reader
     * (`sessions.readSessionById`) cannot project that field without it, and an
     * optional member let the production assembly replace the `projects` bag
     * without it and read `projectId: null` for every by-id `session_get`
     * (gap-mcp-session-get-projectid-null-under-production-gateway-assembly).
     * Both `server/index.ts` and `createMcpGatewayModule` bind it to the project
     * repository's `getProjectPath(...).project_id` — the same lookup
     * `sessionsService.listRecentSessions` uses.
     */
    getProjectIdByPath(projectPath: string): string | null;
  };
  sessions: {
    listRecentSessions(limit: number, offset: number): McpRecentSessionsPage;
    /**
     * One session's recents row read straight by id, or null when the id names
     * no visible session (gap-mcp-session-get-past-recents-page-and-small-
     * envelope-defects).
     *
     * `listRecentSessions` is a bounded PAGE of the recents feed, so a session
     * older than that page is simply not in it — and `session_get` used to
     * answer SESSION_NOT_FOUND for exactly such a session. This reader resolves
     * one id directly, so it has no page to fall outside of. Optional so a mount
     * that predates this task — the run-get/overview criteria, and
     * `mcp-production-session-wiring.test.ts`, which pass the service bundle
     * itself — stays a valid deps bag; when absent, `buildSessionDetail`
     * falls back to the recents page it has always read. `server/index.ts` binds
     * it to the session repository's own by-id lookup; the row is projected by
     * the gateway (`toSessionRow`), so a session read by id and the same session
     * read in the recents list cannot disagree.
     */
    readSessionById?(sessionId: string): McpSessionLookupRow | null;
    readSessionLifecycle(sessionId: string): McpSessionLifecycle | null;
    fetchHistory(sessionId: string, options?: { limit?: number | null; offset?: number }): Promise<McpHistoryPage>;
    fetchOutline(sessionId: string): Promise<McpOutline>;
    fetchWindowAround(
      sessionId: string,
      options: { aroundId: string; before: number; after: number },
    ): Promise<McpMessageWindow>;
  };
  hosts: {
    snapshot(): ProcessHost[];
    liveHostForSession(appSessionId: string): ProcessHost | null;
  };
  runs: {
    listRunningRuns(): McpRunningRun[];
    /**
     * Every run the registry still holds (running plus terminal inside the
     * retention window), as summaries. Consumed by `overview` (AC-247) to read
     * the aborted runs; structurally satisfied by `chatRunRegistry.listRecentRuns`.
     * Optional so a mount that never wires the overview tools (AC-240/244/245's
     * criteria) stays a valid deps bag; `isOverviewWired` requires it before the
     * overview handlers are installed.
     */
    listRecentRuns?(): McpRunSummary[];
  };
  /**
   * The pending-approval reader `session_get` / `sessions_list` report a
   * session's pending interaction and `awaitingUser` from
   * (gap-mcp-pending-interaction-visibility-and-idempotent-answer). Optional:
   * absent, a session reads `pendingInteraction: null` /
   * `awaitingUser: false`, which is exactly the reading for a mount that has no
   * approval source to consult. `server/index.ts` binds it to the runtime
   * service's own pending lookup.
   */
  approvals?: McpApprovalReader;
  /** Clock seam, so every relative time is reproducible in a criterion. */
  now: () => number;
};

/** The caller identity a read handler may be handed: the transport's principal, or null. */
export type McpReadToolContext = { principal: McpPrincipal | null };

/** One read tool as it is handed to the registration seam. */
export type McpReadToolRegistration = {
  name: string;
  description: string;
  requiredScope: string;
  /** AC-288: a raw shape, or a built schema carrying a constraint a raw shape cannot express. */
  inputSchema: McpToolInputSchema;
  outputSchema: z.ZodRawShape;
  /**
   * The behaviour. `ctx` carries the caller's principal when the transport
   * supplies one; a tool that does not gate on caller identity simply ignores it.
   * The read seam historically handed a handler only `args`
   * (`(args) => unknown`), which is why `ctx` is optional: it was widened to
   * thread `{ principal }` for the one content-bearing read tool
   * (`ui_selected_text`), whose handler must read the caller's scopes.
   */
  handler: (args: Record<string, unknown>, ctx?: McpReadToolContext) => unknown | Promise<unknown>;
};

/**
 * The seam `registerMcpReadTools` installs through.
 *
 * The transport supplies one backed by AC-244's `withMcpAudit` — so every read
 * tool inherits the single audit row and the scope refusal without restating
 * either. The criterion supplies a recording seam instead, which is how it
 * reads back the names, descriptions and required scopes a registration
 * actually declared.
 */
export type McpReadToolSeam = (registration: McpReadToolRegistration) => void;
