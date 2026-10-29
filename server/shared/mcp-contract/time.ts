/**
 * The MCP time vocabulary — the relative + ISO pair every read tool reports.
 *
 * Proposal `docs/proposals/mcp-gateway-tool-architecture.md` stage 2: the
 * text-shaping helpers moved out of `mcp-gateway.read-tools.ts` into the
 * `server/shared/mcp-contract` LEAF, so the tool modules that render a time
 * field depend DOWNWARD on the contract instead of importing back into the
 * module that registers them. That back-edge was one of the edges closing the
 * 23-file intra-package SCC (routine finding
 * `cycle-mcp-gateway-intra-package-scc`).
 *
 * This file imports nothing: it is pure formatting over `number` and `string`,
 * which keeps the contract a leaf (proposal rule R1).
 */

/** A time as every read tool reports it: both readings of the same instant. */
export type McpTime = { relative: string; iso: string };

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Renders one instant as a relative phrase beside its ISO timestamp.
 *
 * Both readings come from the SAME instant, which is the point: a client that
 * only draws "3 minutes ago" cannot tell a stale reading from a fresh one, and a
 * client that only draws the ISO forces a human to subtract. `now` is injected
 * so the relative half is exactly predictable rather than merely plausible.
 *
 * Consumers: every read tool's time field, and the criterion, which pins a
 * clock and asserts both halves verbatim.
 */
export function formatMcpTime(ms: number, now: () => number): McpTime {
  const elapsed = Math.max(0, now() - ms);
  let relative: string;
  if (elapsed < MINUTE_MS) {
    relative = 'just now';
  } else if (elapsed < HOUR_MS) {
    relative = `${Math.floor(elapsed / MINUTE_MS)} minutes ago`;
  } else if (elapsed < DAY_MS) {
    relative = `${Math.floor(elapsed / HOUR_MS)} hours ago`;
  } else {
    relative = `${Math.floor(elapsed / DAY_MS)} days ago`;
  }

  return { relative, iso: new Date(ms).toISOString() };
}

/**
 * The time field for a stored timestamp, or null when the row carries none.
 *
 * The stored value is whatever a session row holds — canonical ISO for rows the
 * session repository normalized, and possibly a SQLite `YYYY-MM-DD HH:MM:SS`
 * form for one it did not. An unparseable value reads as null rather than as
 * "now", because a time field that quietly means "I do not know" is worse than
 * an absent one.
 *
 * Exported so the sibling read-tool modules render a stored stamp the SAME way:
 * `mcp-session-search.js` reads a matched message's `timestamp` and a hit's
 * `lastActivity` through this one function rather than restating the parse.
 * Consumers: every read tool's time field, and `mcp-session-search.js`.
 */
export function readTimeField(value: string | null | undefined, now: () => number): McpTime | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : formatMcpTime(parsed, now);
}
