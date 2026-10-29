/**
 * The MCP tool vocabulary shared by every tool module — the refusal code and
 * the tool limits that are part of the wire contract rather than of any one
 * module's implementation.
 *
 * Proposal `docs/proposals/mcp-gateway-tool-architecture.md` stage 2: these
 * constants moved out of `mcp-gateway.read-tools.ts` / `mcp-run-get.ts` into
 * the `server/shared/mcp-contract` LEAF so the tool modules depend DOWNWARD on
 * the contract. The imports back into `mcp-gateway.read-tools.ts` were among
 * the edges closing the 23-file intra-package SCC (routine finding
 * `cycle-mcp-gateway-intra-package-scc`).
 *
 * This file imports nothing: it is pure constants, which keeps the contract a
 * leaf (proposal rule R1).
 */

/**
 * The code a registered-but-unowned tool answers with.
 *
 * A tool whose behaviour another task delivers is still REGISTERED (the name
 * set is a contract), and its handler refuses with this named code rather than
 * disappearing from `tools/list` — so a client can tell "the gateway knows this
 * name but this mount cannot serve it" from "no such tool".
 */
export const MCP_TOOL_NOT_IMPLEMENTED_CODE = 'MCP_TOOL_NOT_IMPLEMENTED';

/**
 * The longest single `run_get` call waits for a run to reach a terminal state,
 * in seconds. A caller asking for longer is clamped to this bound, so one call
 * cannot pin a transport for an unbounded time.
 */
export const MCP_RUN_GET_MAX_WAIT_SECONDS = 25;

/** How many hits one `session_search` page returns when the caller names no `limit`. */
export const MCP_SESSION_SEARCH_DEFAULT_LIMIT = 10;

/** The largest `limit` one `session_search` page accepts. */
export const MCP_SESSION_SEARCH_MAX_LIMIT = 50;
