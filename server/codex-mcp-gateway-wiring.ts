/**
 * The composition-root wiring for "a resident Codex child may call this server's
 * own `/mcp` gateway".
 *
 * WHY A WIRING FILE. `server/index.ts` is pinned by the architecture ratchet at
 * its current line count, and every line added there must be paid for by deleting
 * one. The rule the wiring enforces is small but has three moving parts (the
 * settings block, the server port that is only known later in the boot, the
 * gateway path constant), so it lives here — the same shape `cockpit-brief-wiring.ts`
 * and `cockpit-executors-wiring.ts` already use for the composition root's seams.
 *
 * WHEN IT RESOLVES. `readTarget` runs when a host opens, which is long after
 * `installCodexMcpGatewayWiring` returns: the provider singletons and their
 * connection factories are built at import time, before `loadServerSettings()`
 * has run, so capturing the target here would capture "off" forever. The port
 * fails closed for any process that never calls this function.
 *
 * WHAT IT DOES NOT DO. It never mints, reads or logs the token. The credential
 * comes from the operator's `tokenFile` and is verified by the gateway's ordinary
 * `AccessTokensService`; this file only decides whether a child is told the
 * endpoint. A configuration problem is reported ONCE, on the first spawn that
 * needs it, so a healthy process boots silently and a broken one says why at the
 * moment the feature is exercised.
 */
import { installMcpGatewayClientPort, type McpGatewayClientTarget } from '@/shared/ports/mcp-gateway-client.port.js';
import { terminalTextStyles } from '@/shared/utils.js';

import {
    resolveCodexMcpGateway,
    type CodexMcpGatewayResolution,
    type CodexMcpGatewaySettings,
} from './modules/settings/index.js';

/** What the composition root knows that the settings block does not. */
export type CodexMcpGatewayWiringOptions = {
    /** The `codex.mcpGateway` block of this boot's server settings reading. */
    settings: CodexMcpGatewaySettings;
    /**
     * The port this process listens on. A getter because `SERVER_PORT` is computed
     * after the port installation in the composition root; it is only read at
     * spawn time.
     */
    readServerPort: () => number;
    /** `MCP_GATEWAY_PATH` — the route the gateway is mounted on. */
    gatewayPath: string;
    /** Sink for the one configuration problem; defaults to `console.warn`. */
    warn?: (line: string) => void;
};

/**
 * Installs the provider-facing port. Call once, immediately after the server
 * settings are read and before any host can open.
 */
export function installCodexMcpGatewayWiring(options: CodexMcpGatewayWiringOptions): void {
    let reported = false;
    installMcpGatewayClientPort({
        readTarget: (): McpGatewayClientTarget | null => {
            const reading: CodexMcpGatewayResolution = resolveCodexMcpGateway(options.settings, {
                serverPort: options.readServerPort(),
                gatewayPath: options.gatewayPath,
            });
            if (reading.problem !== null && !reported) {
                reported = true;
                const sink = options.warn ?? ((line: string) => console.warn(`${terminalTextStyles.info('[INFO]')} ${line}`));
                sink(`Codex MCP gateway: ${reading.problem}`);
            }
            return reading.target;
        },
    });
}
