/**
 * The neutral accessor for "may a resident provider child call this server's own
 * `/mcp` gateway, and with what credential?".
 *
 * WHY THIS FILE EXISTS. The address and the credential are read from the SERVER
 * settings file together with `MCP_GATEWAY_PATH`, and the ONE composition root
 * (`server/index.ts`) is the only place that may read that file. A provider
 * module that imported `modules/settings` would close the
 * `providers -> settings -> mcp-gateway -> providers` loop AC-394 pins. The two
 * scalars are boot-time facts the composition root already holds, so they are
 * installed here and read lazily — at the moment a child process is spawned,
 * never at module evaluation, because the provider singletons are built before
 * `loadServerSettings()` runs.
 *
 * FAIL CLOSED. An uninstalled port answers `null`: a process that never
 * assembled the composition root (a focused criterion, a display-only mount)
 * injects nothing, which is exactly the behaviour every provider had before this
 * task. A criterion that means to exercise the injected arm installs a reader of
 * its own.
 *
 * WHAT IT IS NOT. The token is a `ccp_` personal access token that the gateway
 * verifies through its own `AccessTokensService`; this port neither mints nor
 * bypasses that chain. The child authenticates to `/mcp` like any other client,
 * so the gateway's scope check and audit row apply unchanged.
 *
 * Consumers: `modules/providers/list/codex/codex.provider.ts` (the launch it
 * hands its resident connection factory) and `server/index.ts` (the assembly
 * that installs it). This file imports nothing.
 */

/** One gateway endpoint plus the credential a child presents to it. */
export type McpGatewayClientTarget = {
  /** The absolute `/mcp` URL this process serves. */
  url: string;
  /** A `ccp_` personal access token, never written to argv. */
  token: string;
};

/** The installed reader shape: a call-time getter, never a captured value. */
export type McpGatewayClientPort = {
  /** The target for a child spawned now, or null when the injection is off or misconfigured. */
  readTarget(): McpGatewayClientTarget | null;
};

/** The installed reader, or null before `server/index.ts` assembles the process. */
let installedMcpGatewayClient: McpGatewayClientPort | null = null;

/**
 * Installs the process's gateway-client reading.
 *
 * Called by `server/index.ts` immediately after the settings file is read, before
 * any child process can be spawned. The last installation wins so a focused
 * criterion can swap in its own fixture.
 */
export function installMcpGatewayClientPort(port: McpGatewayClientPort): void {
  installedMcpGatewayClient = port;
}

/**
 * Reads the gateway target for a child spawned right now. `null` before the
 * composition root installs a reader — the safe answer, and the reason no
 * provider gains a tool surface by omission.
 */
export function readMcpGatewayClientTarget(): McpGatewayClientTarget | null {
  return installedMcpGatewayClient?.readTarget() ?? null;
}
