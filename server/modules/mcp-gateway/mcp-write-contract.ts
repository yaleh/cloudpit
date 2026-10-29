/**
 * The write-tool CONTRACT — the registration metadata and the seam every write
 * tool is installed through.
 *
 * Proposal `docs/proposals/mcp-gateway-tool-architecture.md` stage 2: these
 * declarations moved out of `mcp-gateway.write-tools.ts` into a LEAF so the
 * individual write/navigation tool modules can type themselves against the
 * contract without importing the registrar that assembles them. `draft` /
 * `ui-*` importing back into `write-tools.ts` was one of the edges closing the
 * 23-file intra-package SCC (routine finding
 * `cycle-mcp-gateway-intra-package-scc`).
 *
 * LEAFLESSNESS: this file imports only zod and the `server/shared` MCP contract —
 * never a sibling module in this package.
 */
import type { z } from 'zod';

import type { McpPrincipal } from '@/shared/mcp-contract/index.js';

/**
 * One write tool as it is handed to the registration seam.
 *
 * `outputSchema` is optional so the placeholder tools (no result schema) and
 * `session_send` (which declares one so its payload also reaches the client as
 * `structuredContent`) share one seam shape.
 */
export type McpWriteToolRegistration = {
  name: string;
  description: string;
  requiredScope: string;
  inputSchema: z.ZodRawShape;
  outputSchema?: z.ZodRawShape;
  handler: (args: Record<string, unknown>, ctx: { principal: McpPrincipal }) => unknown | Promise<unknown>;
};

/**
 * The seam `registerMcpWriteTools` installs through.
 *
 * The transport supplies one backed by AC-244's `withMcpAudit` (and, when wired,
 * AC-246's target gate), so every write tool inherits the single audit row and
 * the scope refusal without restating either. The criterion supplies a recording
 * seam instead, which is how it reads back the names and required scopes a
 * registration actually declared.
 */
export type McpWriteToolSeam = (registration: McpWriteToolRegistration) => void;
