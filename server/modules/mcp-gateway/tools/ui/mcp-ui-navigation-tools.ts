/**
 * The UI-navigation WRITE registrar — the one place the four `ui_*` navigation
 * tools (`ui_open_session`, `ui_focus_turn`, `ui_show_diff`, `ui_open_task`)
 * are installed.
 *
 * They used to be registered one-by-one from `mcp-gateway.write-tools.ts`, which
 * made that registrar depend on eight feature entities (each tool's
 * `is*Wired` + `register*Tool` pair) and pushed its archguard out-degree over
 * the architecture finding's `register* outDegree<=20` budget. Aggregating the
 * four here restores a single edge (`registerMcpWriteTools` →
 * `registerMcpUiNavigationTools`) while keeping every tool's own module as the
 * one statement of its name, schema and handler.
 *
 * This module sits in `tools/ui/` (below the registrar) and imports only the
 * sibling UI modules plus the shared write contract — never the package root,
 * so the directory graph stays a DAG.
 */

import { ACCESS_TOKEN_SCOPES } from '@/shared/mcp-contract/index.js';

import { MCP_CORRELATION_ID_DESCRIPTION } from '../shared/mcp-correlation-id.js';
import type { McpWriteToolSeam } from '../shared/mcp-write-contract.js';
import {
  isUiFocusTurnWired,
  registerMcpUiFocusTurnTool,
  UI_FOCUS_TURN_INPUT_SCHEMA,
  UI_FOCUS_TURN_OUTPUT_SCHEMA,
} from './mcp-ui-focus-turn.js';
import type { McpUiFocusTurnDeps } from './mcp-ui-focus-turn.js';
import {
  isUiOpenSessionWired,
  registerMcpUiOpenSessionTool,
  UI_OPEN_SESSION_INPUT_SCHEMA,
  UI_OPEN_SESSION_OUTPUT_SCHEMA,
} from './mcp-ui-open-session.js';
import type { McpUiOpenSessionDeps } from './mcp-ui-open-session.js';
import {
  isUiOpenTaskWired,
  registerMcpUiOpenTaskTool,
  UI_OPEN_TASK_INPUT_SCHEMA,
  UI_OPEN_TASK_OUTPUT_SCHEMA,
} from './mcp-ui-open-task.js';
import type { McpUiOpenTaskDeps } from './mcp-ui-open-task.js';
import {
  isUiShowDiffWired,
  registerMcpUiShowDiffTool,
  UI_SHOW_DIFF_INPUT_SCHEMA,
  UI_SHOW_DIFF_OUTPUT_SCHEMA,
} from './mcp-ui-show-diff.js';
import type { McpUiShowDiffDeps } from './mcp-ui-show-diff.js';

// Positions within AC-243's vocabulary — `navigate` is the scope every one of
// these tools requires. The positional read is pinned by the OAuth module's own
// vocabulary criterion, so it cannot silently select the wrong scope.
const NAVIGATE_SCOPE = ACCESS_TOKEN_SCOPES[5];

/** `ui_open_session`'s name and description on `tools/list`. */
export const UI_OPEN_SESSION_TOOL_NAME = 'ui_open_session';

/** What `ui_open_session` says it does on `tools/list`. */
export const UI_OPEN_SESSION_DESCRIPTION =
  `Open a session in one of the connected browsers and position it, without waiting for the user. ${MCP_CORRELATION_ID_DESCRIPTION}`;

/** The three sibling navigation tools' names and descriptions. */
export const UI_FOCUS_TURN_TOOL_NAME = 'ui_focus_turn';

/** What `ui_focus_turn` says it does on `tools/list`. */
export const UI_FOCUS_TURN_DESCRIPTION =
  `Focus one turn inside a session in one of the connected browsers, without waiting for the user. ${MCP_CORRELATION_ID_DESCRIPTION}`;

export const UI_SHOW_DIFF_TOOL_NAME = 'ui_show_diff';

/** What `ui_show_diff` says it does on `tools/list`. */
export const UI_SHOW_DIFF_DESCRIPTION =
  `Reveal a file's diff in the Git panel of one of the connected browsers, without waiting for the user. ${MCP_CORRELATION_ID_DESCRIPTION}`;

export const UI_OPEN_TASK_TOOL_NAME = 'ui_open_task';

/** What `ui_open_task` says it does on `tools/list`. */
export const UI_OPEN_TASK_DESCRIPTION =
  `Open a task's detail in one of the connected browsers, without waiting for the user. ${MCP_CORRELATION_ID_DESCRIPTION}`;

/** The four optional bags this registrar reads. */
export type McpUiNavigationDeps = {
  uiOpenSession?: McpUiOpenSessionDeps;
  uiFocusTurn?: McpUiFocusTurnDeps;
  uiShowDiff?: McpUiShowDiffDeps;
  uiOpenTask?: McpUiOpenTaskDeps;
};

// Re-exported so the write registrar can type its deps bag through one import
// from this family instead of four per-tool modules.
export type { McpUiFocusTurnDeps } from './mcp-ui-focus-turn.js';
export type { McpUiOpenSessionDeps } from './mcp-ui-open-session.js';
export type { McpUiOpenTaskDeps } from './mcp-ui-open-task.js';
export type { McpUiShowDiffDeps } from './mcp-ui-show-diff.js';

/**
 * Registers the four `ui_*` navigation tools through the audited write seam.
 *
 * None of them is `protect`-wrapped: revealing or opening the caller's own
 * session interrupts no run, so the self-target guard must not fire on them.
 * Each unwired tool keeps a named refusal so its name stays on `tools/list` for
 * the annotation / error-code records.
 */
export function registerMcpUiNavigationTools(
  seam: McpWriteToolSeam,
  deps: McpUiNavigationDeps,
): void {
  registerMcpUiOpenSessionTool(seam, isUiOpenSessionWired(deps) ? deps.uiOpenSession : null, {
    name: UI_OPEN_SESSION_TOOL_NAME,
    description: UI_OPEN_SESSION_DESCRIPTION,
    requiredScope: NAVIGATE_SCOPE,
    inputSchema: UI_OPEN_SESSION_INPUT_SCHEMA,
    outputSchema: UI_OPEN_SESSION_OUTPUT_SCHEMA,
  });

  registerMcpUiFocusTurnTool(seam, isUiFocusTurnWired(deps) ? deps.uiFocusTurn : null, {
    name: UI_FOCUS_TURN_TOOL_NAME,
    description: UI_FOCUS_TURN_DESCRIPTION,
    requiredScope: NAVIGATE_SCOPE,
    inputSchema: UI_FOCUS_TURN_INPUT_SCHEMA,
    outputSchema: UI_FOCUS_TURN_OUTPUT_SCHEMA,
  });
  registerMcpUiShowDiffTool(seam, isUiShowDiffWired(deps) ? deps.uiShowDiff : null, {
    name: UI_SHOW_DIFF_TOOL_NAME,
    description: UI_SHOW_DIFF_DESCRIPTION,
    requiredScope: NAVIGATE_SCOPE,
    inputSchema: UI_SHOW_DIFF_INPUT_SCHEMA,
    outputSchema: UI_SHOW_DIFF_OUTPUT_SCHEMA,
  });
  registerMcpUiOpenTaskTool(seam, isUiOpenTaskWired(deps) ? deps.uiOpenTask : null, {
    name: UI_OPEN_TASK_TOOL_NAME,
    description: UI_OPEN_TASK_DESCRIPTION,
    requiredScope: NAVIGATE_SCOPE,
    inputSchema: UI_OPEN_TASK_INPUT_SCHEMA,
    outputSchema: UI_OPEN_TASK_OUTPUT_SCHEMA,
  });
}
