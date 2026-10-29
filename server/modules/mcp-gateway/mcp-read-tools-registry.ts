/**
 * The stage-3 read-tool REGISTRAR — the one place the read tool set is wired.
 *
 * Proposal `docs/proposals/mcp-gateway-tool-architecture.md` stage 2 (routine
 * finding `cycle-mcp-gateway-intra-package-scc`): this function used to live in
 * `mcp-gateway.read-tools.ts`, which forced the tool-table module to import
 * every tool IMPLEMENTATION while each implementation imported the table's
 * helpers and types back — one file-level cycle covering 23 files.
 *
 * The registrar is the AGGREGATION point, so it may depend on everything: the
 * table (`MCP_STAGE3_READ_TOOLS` / `TOOL_BODIES`) and each feature module. What
 * it must NOT be is a dependency OF those modules — nothing inside this package
 * imports this file. Its only consumers are the package barrel (`index.ts`) and
 * the transport, both of which sit above the tool modules, plus `server/index.ts`
 * through the barrel.
 *
 * The dependency direction is therefore: contract leaves (`@/shared/mcp-contract`,
 * `./mcp-read-contract.ts`, `./mcp-tool-schemas.ts`) ← tool implementations ←
 * this registrar ← barrel/transport. A future tool adds its implementation
 * module and one line here; it does not add an edge from an implementation back
 * into the registrar.
 */

import type { McpRunGetRegistration } from './mcp-run-get.js';
import { isRunGetWired, registerMcpRunGetTool } from './mcp-run-get.js';
import type { McpRunGetDeps } from './mcp-run-get.js';
import type { McpOverviewDeps, McpOverviewRegistration } from './mcp-overview-tools.js';
import { isOverviewWired, registerMcpOverviewTools } from './mcp-overview-tools.js';
import type { McpUiLastOpenedDeps } from './mcp-ui-tools.js';
import { isUiLastOpenedWired, registerMcpUiTools } from './mcp-ui-tools.js';
import type { McpUiVisibleContextDeps } from './mcp-ui-visible-context.js';
import {
  isUiVisibleContextWired,
  registerMcpUiSelectedTextTool,
  registerMcpUiVisibleContextTool,
} from './mcp-ui-visible-context.js';
import type { McpUiClientsListDeps } from './mcp-ui-clients-list.js';
import { isUiClientsListWired, registerMcpUiClientsListTool } from './mcp-ui-clients-list.js';
import type { McpSessionSearchDeps, McpSessionSearchRegistration } from './mcp-session-search.js';
import { isSessionSearchWired, registerMcpSessionSearchTool } from './mcp-session-search.js';
import type { McpDraftDeps } from './mcp-draft.js';
import {
  DRAFT_GET_DESCRIPTION,
  DRAFT_GET_INPUT_SCHEMA,
  DRAFT_GET_OUTPUT_SCHEMA,
  DRAFT_GET_TOOL_NAME,
  registerMcpDraftGetTool,
} from './mcp-draft.js';
import type { McpChangesDeps } from './mcp-changes.js';
import { isChangesWired, registerMcpChangesTool } from './mcp-changes.js';
import type { McpActivityReader } from './mcp-overview-tools.js';
import type { McpQuayRunner } from './mcp-overview-tools.js';
import type { McpReadToolDepsBase, McpReadToolSeam } from './mcp-read-contract.js';
import type { McpUiLastOpenedStore } from './mcp-ui-tools.js';
import {
  MCP_STAGE3_READ_TOOLS,
  READ_SCOPE,
  TOOL_BODIES,
} from './mcp-gateway.read-tools.js';
import type { McpReadToolBody, McpStage3ReadToolName } from './mcp-gateway.read-tools.js';

/**
 * Everything `registerMcpReadTools` reads: the services the four implemented
 * read tools answer from ({@link McpReadToolDepsBase}), plus each feature's own
 * bag. A feature whose bag is absent keeps its body-table refusal.
 *
 * This is the type the composition root (`server/index.ts`) and the transport
 * hand around. The tool IMPLEMENTATIONS never see it: they take only the base or
 * their own bag, so no implementation has to know the other features exist.
 */
export type McpReadToolDeps = McpReadToolDepsBase & {
  /** AC-247: the quay runner `overview` / `quay_snapshot` read through. */
  quay?: McpQuayRunner;
  /** AC-247: the activity store `overview` reads. */
  activity?: McpActivityReader;
  /** AC-248: the chat run lookup `run_get` reads. */
  runGet?: McpRunGetDeps;
  /** gap-mcp-ui-last-opened-session: the browser's last-opened pointer. */
  uiLastOpened?: McpUiLastOpenedStore;
  /** gap-mcp-ui-visible-context: the visible-context round trip. */
  uiVisibleContext?: McpUiVisibleContextDeps;
  /** gap-mcp-ui-clients-list: the connected-device listing. */
  uiClientsList?: McpUiClientsListDeps;
  /** gap-mcp-session-search: the cross-project conversation search engine. */
  sessionSearch?: McpSessionSearchDeps;
  /** gap-mcp-draft-get-set-submit: the caller's unsent composer text. */
  draft?: McpDraftDeps;
  /** gap-mcp-changes-on-demand-event-stream: the on-demand change event stream. */
  changes?: McpChangesDeps;
};

/**
 * Registers every stage-3 read tool exactly once.
 *
 * The scope comes from {@link MCP_STAGE3_READ_TOOLS} — the table is the one
 * place the pair (name, scope) is written down, and the body table is keyed by
 * the same names under a `satisfies`, so a tool added to one and not the other
 * is a type error rather than a silently missing registration.
 *
 * `overview` and `quay_snapshot` are AC-247's. When the injected deps are wired
 * with the quay runner and the activity store, those two names are registered by
 * {@link registerMcpOverviewTools} — the real handlers, with their metadata
 * passed down from this same table so the tool set stays one statement. When the
 * deps are NOT wired (AC-240/244/245's mounts), the two keep their body-table
 * refusal, so those criteria read exactly what they read before this task.
 * Either way the registered NAME SET is unchanged — this replaces handlers, it
 * does not add or rename a tool.
 *
 * `run_get` is AC-248's and follows the same routing: when `deps.runGet` is
 * supplied it is registered by `mcp-run-get.js`'s real handler, otherwise it
 * keeps the body-table refusal. `ui_last_opened_session` follows it too: when
 * `deps.uiLastOpened` is supplied it is registered by `mcp-ui-tools.js`, and
 * otherwise it keeps the body-table refusal. `ui_visible_context` follows the
 * same routing through `mcp-ui-visible-context.js` and `deps.uiVisibleContext`,
 * and `ui_clients_list` through `mcp-ui-clients-list.js` and
 * `deps.uiClientsList`. `session_search` (gap-mcp-session-search) follows the
 * same routing through `mcp-session-search.js` and `deps.sessionSearch`. The
 * registered NAME SET is the table either way.
 *
 * `changes` (gap-mcp-changes-on-demand-event-stream) follows the same routing
 * through `mcp-changes.js` and `deps.changes`.
 */
export function registerMcpReadTools(seam: McpReadToolSeam, deps: McpReadToolDeps): void {
  const overviewDeps: McpOverviewDeps | null = isOverviewWired(deps) ? deps : null;
  const runGetDeps: McpRunGetDeps | null = isRunGetWired(deps) ? deps.runGet : null;
  const uiDeps: McpUiLastOpenedDeps | null = isUiLastOpenedWired(deps) ? deps : null;
  const visibleContextDeps: McpUiVisibleContextDeps | null = isUiVisibleContextWired(deps)
    ? deps.uiVisibleContext
    : null;
  const clientsListDeps: McpUiClientsListDeps | null = isUiClientsListWired(deps) ? deps.uiClientsList : null;
  // The session-search deps: the engine verb the caller injected, plus the
  // outline reader derived from the SAME `sessions.fetchOutline` the
  // `session_read` outline mode prints — so a hit's `turnIndex` and that outline
  // agree by construction rather than by a second numbering. An injected
  // `outlineFor` (a criterion's own seam) wins; absent it, the derivation is used.
  const sessionSearchDeps: McpSessionSearchDeps | null = isSessionSearchWired(deps)
    ? {
        ...deps.sessionSearch,
        outlineFor:
          deps.sessionSearch.outlineFor ??
          (async (sessionId: string) => (await deps.sessions.fetchOutline(sessionId)).turns),
      }
    : null;
  const draftDeps: McpDraftDeps | null = deps.draft ?? null;
  const changesDeps: McpChangesDeps | null = isChangesWired(deps) ? deps.changes : null;
  const table = new Map<string, (typeof MCP_STAGE3_READ_TOOLS)[number]>(
    MCP_STAGE3_READ_TOOLS.map((tool) => [tool.name, tool]),
  );

  /** A tool's metadata, read from the one table so a name cannot drift from its scope. */
  const registration = (name: McpStage3ReadToolName): McpOverviewRegistration => {
    const tool = table.get(name);
    const body = TOOL_BODIES[name];
    if (tool === undefined) {
      throw new Error(`the stage-3 read table is missing "${name}"`);
    }
    return {
      name: tool.name,
      description: tool.description,
      requiredScope: tool.requiredScope,
      inputSchema: body.inputSchema,
      outputSchema: body.outputSchema,
    };
  };

  for (const tool of MCP_STAGE3_READ_TOOLS) {
    if (overviewDeps !== null && (tool.name === 'overview' || tool.name === 'quay_snapshot')) {
      continue;
    }
    if (runGetDeps !== null && tool.name === 'run_get') {
      continue;
    }
    if (uiDeps !== null && tool.name === 'ui_last_opened_session') {
      continue;
    }
    if (visibleContextDeps !== null && tool.name === 'ui_visible_context') {
      continue;
    }
    if (visibleContextDeps !== null && tool.name === 'ui_selected_text') {
      continue;
    }
    if (clientsListDeps !== null && tool.name === 'ui_clients_list') {
      continue;
    }
    if (sessionSearchDeps !== null && tool.name === 'session_search') {
      continue;
    }
    if (changesDeps !== null && tool.name === 'changes') {
      continue;
    }
    const body: McpReadToolBody = TOOL_BODIES[tool.name];
    seam({
      name: tool.name,
      description: tool.description,
      requiredScope: tool.requiredScope,
      inputSchema: body.inputSchema,
      outputSchema: body.outputSchema,
      // `ctx` is threaded through so a caller-scoped body (mcp_usage_stats) can
      // read the principal; a body that ignores it is unaffected.
      handler: (args, ctx) => body.handle(args, deps, ctx),
    });
  }

  if (overviewDeps !== null) {
    registerMcpOverviewTools(seam, overviewDeps, {
      overview: registration('overview'),
      quaySnapshot: registration('quay_snapshot'),
    });
  }

  if (runGetDeps !== null) {
    const runGet: McpRunGetRegistration = registration('run_get');
    registerMcpRunGetTool(seam, runGetDeps, runGet);
  }

  if (uiDeps !== null) {
    registerMcpUiTools(seam, uiDeps, registration('ui_last_opened_session'));
  }

  if (visibleContextDeps !== null) {
    registerMcpUiVisibleContextTool(seam, visibleContextDeps, registration('ui_visible_context'));
    // The content-bearing companion: same round trip and device address, its own
    // name and its own scope gate. Registered together so a mount that can ask
    // the browsers exposes both readings.
    registerMcpUiSelectedTextTool(seam, visibleContextDeps, registration('ui_selected_text'));
  }

  if (clientsListDeps !== null) {
    registerMcpUiClientsListTool(seam, clientsListDeps, registration('ui_clients_list'));
  }

  if (sessionSearchDeps !== null) {
    const sessionSearch: McpSessionSearchRegistration = registration('session_search');
    registerMcpSessionSearchTool(seam, sessionSearchDeps, sessionSearch);
  }

  if (changesDeps !== null) {
    registerMcpChangesTool(seam, changesDeps, registration('changes'));
  }

  // gap-mcp-draft-get-set-submit: a read tool registered ALONGSIDE the stage-3
  // table rather than in it. `draft_get` reads the caller's own unsent composer
  // text; its write halves (`draft_set` / `draft_submit`) live with the write
  // tools, because a single tool cannot carry a read scope for one verb and a
  // send scope for the others (the seam takes one scope per registration). The
  // table's own size pin is untouched, which is why the name is NOT added to
  // `MCP_STAGE3_READ_TOOLS`.
  if (draftDeps !== null) {
    registerMcpDraftGetTool(seam, draftDeps, {
      name: DRAFT_GET_TOOL_NAME,
      description: DRAFT_GET_DESCRIPTION,
      requiredScope: READ_SCOPE,
      inputSchema: DRAFT_GET_INPUT_SCHEMA,
      outputSchema: DRAFT_GET_OUTPUT_SCHEMA,
    });
  }
}
