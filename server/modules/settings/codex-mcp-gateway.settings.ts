/**
 * The `codex.mcpGateway` block of the SERVER settings file: whether a resident
 * Codex child is handed this server's own `/mcp` gateway, and with which
 * credential.
 *
 * WHY A KNOB HERE. A Codex resident process is spawned from the app-server
 * launcher with only `cwd`/`env`, so out of the box it sees nothing but the
 * operator's `~/.codex/config.toml` servers. Injecting CloudCLI's gateway makes
 * the same tools a Claude client gets available to a Codex session — but only
 * when an operator has minted a credential for it, which is why the shipped
 * default is OFF.
 *
 * WHY A SEPARATE FILE. `server-settings.ts` is already close to the
 * architecture ratchet's 800-line ceiling; this block's reader is self-contained
 * (it imports nothing from `modules/`) so it lands beside it instead of growing
 * it. `loadServerSettings` calls {@link readCodexMcpGateway}.
 *
 * THE CREDENTIAL IS A PATH, NEVER A VALUE. `tokenFile` names a 0600 file holding
 * a `ccp_` personal access token, the same token an operator pastes into
 * `claude mcp add --header "Authorization: Bearer …"`. The token therefore goes
 * through the gateway's ordinary `AccessTokensService` verification, scope check
 * and audit row — there is no internal shortcut. The value never appears in this
 * file, in argv or in a log line.
 */

import { readFileSync } from 'node:fs';

import type { McpGatewayClientTarget } from '@/shared/ports/mcp-gateway-client.port.js';
import { errorMessage } from '@/shared/utils.js';

/** The shipped switch: an operator must opt in and provide a credential. */
export const DEFAULT_CODEX_MCP_GATEWAY_ENABLED = false;

/** The `codex.mcpGateway` block as read from the settings file. */
export type CodexMcpGatewaySettings = {
  /** Whether a resident Codex child is handed the gateway. Ships `false`. */
  enabled: boolean;
  /**
   * The endpoint to inject. Empty means "derive it": this process's own loopback
   * address plus `MCP_GATEWAY_PATH`, which is the only address the loopback guard
   * accepts anyway.
   */
  url: string;
  /** Path to a 0600 file holding a `ccp_` token; empty means the block is inert. */
  tokenFile: string;
};

/** The shipped block: off, no explicit endpoint, no credential. */
export function defaultCodexMcpGatewaySettings(): CodexMcpGatewaySettings {
  return { enabled: DEFAULT_CODEX_MCP_GATEWAY_ENABLED, url: '', tokenFile: '' };
}

/**
 * Reads the `codex.mcpGateway` block, field by field over the shipped defaults.
 *
 * Takes the whole top-level `codex` object (its `mcpGateway` member is the block)
 * so `loadServerSettings` stays one line per block. A malformed field falls back
 * on its own and reports its own problem, so a typo in `url` cannot silently
 * switch off enabled injection while a typo in `enabled` cannot silently turn it
 * on. Other `codex.*` keys are ignored, so the block and its siblings can land
 * independently.
 */
export function readCodexMcpGateway(raw: unknown, problems: string[]): CodexMcpGatewaySettings {
  const settings = defaultCodexMcpGatewaySettings();
  if (raw === undefined) {
    return settings;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    problems.push('`codex` must be a JSON object');
    return settings;
  }

  const block = (raw as Record<string, unknown>).mcpGateway;
  if (block === undefined) {
    return settings;
  }
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    problems.push('`codex.mcpGateway` must be a JSON object');
    return settings;
  }

  const record = block as Record<string, unknown>;
  if (record.enabled !== undefined) {
    if (typeof record.enabled === 'boolean') {
      settings.enabled = record.enabled;
    } else {
      problems.push('`codex.mcpGateway.enabled` must be a boolean');
    }
  }
  if (record.url !== undefined) {
    if (typeof record.url === 'string') {
      settings.url = record.url.trim();
    } else {
      problems.push('`codex.mcpGateway.url` must be a string');
    }
  }
  if (record.tokenFile !== undefined) {
    if (typeof record.tokenFile === 'string') {
      settings.tokenFile = record.tokenFile.trim();
    } else {
      problems.push('`codex.mcpGateway.tokenFile` must be a string');
    }
  }
  return settings;
}

/** What the composition root hands the port, plus why it could not when it could not. */
export type CodexMcpGatewayResolution = {
  /** The injection target, or null when it is off or unusable. */
  target: McpGatewayClientTarget | null;
  /** A line for the boot log; null when the block is simply off. */
  problem: string | null;
};

/**
 * Turns the block into the target a child can use, or explains why it cannot.
 *
 * Never throws: a missing or unreadable credential file is a logged problem and a
 * null target, because a deployment whose secret file was moved must keep
 * booting — with the injection off — rather than refuse to start.
 *
 * The address is the operator's `url` when one is written, otherwise
 * `http://127.0.0.1:<serverPort><gatewayPath>`: the gateway is mounted on this
 * process, and its loopback guard means a non-loopback address would be refused
 * by the very route it points at.
 *
 * `readFile` is injectable so a criterion can drive the missing/blank/bad-prefix
 * arms without a real secret on disk.
 */
export function resolveCodexMcpGateway(
  settings: CodexMcpGatewaySettings,
  options: {
    serverPort: number;
    gatewayPath: string;
    readFile?: (filePath: string) => string;
  },
): CodexMcpGatewayResolution {
  if (!settings.enabled) {
    return { target: null, problem: null };
  }
  if (!settings.tokenFile) {
    return { target: null, problem: '`codex.mcpGateway.enabled` is true but `tokenFile` names no file' };
  }

  const url = settings.url || defaultCodexMcpGatewayUrl(options.serverPort, options.gatewayPath);
  if (!url) {
    return { target: null, problem: '`codex.mcpGateway.enabled` is true but this process has no known port' };
  }

  let token: string;
  try {
    token = (options.readFile ?? defaultReadFile)(settings.tokenFile).trim();
  } catch (failure) {
    return { target: null, problem: `could not read ${settings.tokenFile}: ${errorMessage(failure)}` };
  }
  if (!token) {
    return { target: null, problem: `${settings.tokenFile} is empty` };
  }
  if (!token.startsWith('ccp_')) {
    // A JWT or an OAuth token would be refused by the gateway anyway; say so at boot
    // instead of leaving a child that lists zero tools and looks like a wiring bug.
    return { target: null, problem: `${settings.tokenFile} does not hold a ccp_ personal access token` };
  }
  return { target: { url, token }, problem: null };
}

/** The loopback `/mcp` URL for a listening port, or '' when the port is unknown. */
function defaultCodexMcpGatewayUrl(serverPort: number, gatewayPath: string): string {
  if (!Number.isInteger(serverPort) || serverPort <= 0) {
    return '';
  }
  return `http://127.0.0.1:${serverPort}${gatewayPath}`;
}

/**
 * Reads the credential file as text.
 *
 * The file is read at boot, once, like every other knob in the settings file: an
 * operator who rotates the token restarts the server. `utf8` and no caching keep
 * it indistinguishable from any other small config read.
 */
function defaultReadFile(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}
