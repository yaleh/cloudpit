/**
 * The tool output schemas shared between the tool-table owner
 * (`mcp-gateway.read-tools.ts`) and the tool implementation that renders them.
 *
 * Proposal `docs/proposals/mcp-gateway-tool-architecture.md` stage 2 (routine
 * finding `cycle-mcp-gateway-intra-package-scc`): `overviewOutputSchema` moved
 * out of `mcp-overview-tools.ts` into a LEAF so `mcp-gateway.read-tools.ts` can
 * declare the tool metadata without importing the implementation module, which
 * imports the read-tool contract back. The schema is still the ONE description
 * of `overview`'s reading; both sides import it from here.
 *
 * LEAFLESSNESS: this file imports only zod — never a sibling module in this
 * package.
 */
import { z } from 'zod';

/**
 * The declared output shape of `overview`: the ONE description of the reading
 * `buildOverview` returns, written as the same six top-level keys, so
 * `tools/list` advertises exactly what a caller reads back.
 *
 * It replaces AC-247's `{ overview: z.unknown().optional() }` placeholder, which
 * was both MISNAMED (the handler returns the reading directly, never wrapped
 * under an `overview` key) and WRONGLY WIDE-but-narrow at once: `z.unknown()`
 * admitted anything inside the wrapper, yet the conversion emitted
 * `additionalProperties: false`, so the REAL payload (`running` / `hosts` / … at
 * the top level) failed a warm client's output validation with `-32602`. The
 * `quay` arm is a `discriminatedUnion` on `status` — the same three-arm union as
 * `McpOverviewQuayEntry` — rather than `z.unknown()`, so a caller reads the
 * per-status fields off the wire.
 *
 * Consumers: `mcp-gateway.read-tools.js`'s `TOOL_BODIES.overview`, which hands it
 * to the registration seam, the transport's audited wrapper (which optionalizes
 * it and splices in the error envelope), and the criterion, which validates a
 * real `buildOverview` reading against it with `z.object(...).strict()`.
 */
export const overviewOutputSchema: z.ZodRawShape = {
  running: z.array(
    z.object({
      sessionId: z.string(),
      projectId: z.string().nullable(),
      project: z.string().nullable(),
      title: z.string(),
      phase: z.string(),
      elapsedMs: z.number(),
    }),
  ),
  awaitingPermission: z.array(
    z.object({
      sessionId: z.string(),
      projectId: z.string().nullable(),
      project: z.string().nullable(),
      title: z.string(),
      phase: z.string(),
    }),
  ),
  aborted: z.array(
    z.object({
      runId: z.string(),
      sessionId: z.string(),
      status: z.string(),
      startedAt: z.number(),
      completedAt: z.number().nullable(),
      projectId: z.string().nullable(),
      project: z.string().nullable(),
    }),
  ),
  hosts: z.array(
    z.object({
      hostId: z.string(),
      state: z.string(),
      sessionId: z.string(),
      peerName: z.string().nullable(),
      // The leases are the opaque `HostLease` union copied verbatim — a lease IS
      // why the process lives, and `overview` never reinterprets its shape.
      leases: z.array(z.unknown()),
      projectId: z.string().nullable(),
      project: z.string().nullable(),
    }),
  ),
  quay: z.array(
    z.discriminatedUnion('status', [
      z.object({ projectId: z.string(), project: z.string(), status: z.literal('no_quay_config'), note: z.string() }),
      z.object({ projectId: z.string(), project: z.string(), status: z.literal('unknown'), note: z.string() }),
      z.object({
        projectId: z.string(),
        project: z.string(),
        status: z.literal('cached'),
        cached: z.boolean(),
        tasks: z
          .object({ total: z.number(), ready: z.number(), needsHuman: z.number(), done: z.number() })
          .nullable(),
        driver: z.object({ state: z.string() }).nullable(),
        suite: z.object({ state: z.string() }).nullable(),
      }),
    ]),
  ),
  archguard: z.array(
    z.object({ projectId: z.string(), project: z.string(), hasArchguardCache: z.boolean() }),
  ),
};
