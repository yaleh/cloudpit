/**
 * The ONE human-readable client-name resolution in the MCP gateway.
 *
 * Proposal `docs/proposals/mcp-gateway-tool-architecture.md` stage 2 (routine
 * finding `cycle-mcp-gateway-intra-package-scc`): this helper moved out of
 * `mcp-write-notification.ts` into a leaf because `mcp-ui-navigation.ts` read it
 * back out of the notification module, and the notification module imports the
 * annotation table that types itself against the write tools — closing a cycle
 * across three unrelated features. Both consumers now depend DOWNWARD here.
 *
 * LEAFLESSNESS: this file imports only the database module and the MCP contract
 * — never a sibling module in this package.
 */
import type { McpPrincipal } from '@/shared/mcp-contract/index.js';

import { accessTokensDb, oauthClientsDb } from '@/modules/database/index.js';

/** How many characters of a resolved client name survive; a longer name is cut to this bound. */
export const MCP_CLIENT_NAME_MAX_LENGTH = 64;

/** The name a personal access token with no stored `name` is reported under. */
export const PERSONAL_TOKEN_LABEL = '个人访问令牌';
/** The name an OAuth client whose id is empty (so nothing readable remains) is reported under. */
const OAUTH_CLIENT_LABEL = 'OAuth 客户端';

/**
 * Resolves the human-readable name of the client behind a principal — the ONE
 * such resolution in the gateway.
 *
 * An OAuth principal is named by its client row's `client_name`; when the row
 * carries no display name the CLIENT ID itself stands in (bounded by
 * {@link MCP_CLIENT_NAME_MAX_LENGTH}), because the id is still a readable
 * identity and a prompt that shows nothing tells the user less. A personal
 * access token has no client, so it is named by its token row's `name`; a
 * nameless token falls back to {@link PERSONAL_TOKEN_LABEL}. Never throws — a
 * lookup that cannot run (or finds no row) is a fixed label, not a failure.
 *
 * Consumers: `mcp-write-notification.ts` (the write notification's `clientName`)
 * and `mcp-ui-open-session.ts` (the confirmation bar's requester, carried on the
 * `ui.navigate` frame and the navigation record). Both read THIS function rather
 * than a second copy, so the name a user sees on the bar and the name recorded
 * for `ui_visible_context` cannot drift.
 */
export function resolveClientName(principal: McpPrincipal): string {
  return boundClientName(readClientName(principal));
}

/** The raw name before bounding: the row's display name, else the best readable fallback. */
function readClientName(principal: McpPrincipal): string {
  try {
    if (principal.clientId !== null) {
      const name = oauthClientsDb.findById(principal.clientId)?.client_name;
      if (typeof name === 'string' && name.length > 0) {
        return name;
      }
      // No display name: the client id is the only readable identity left.
      const id = principal.clientId.trim();
      return id.length > 0 ? id : OAUTH_CLIENT_LABEL;
    }
    const name = accessTokensDb.findById(principal.tokenId)?.name;
    return typeof name === 'string' && name.length > 0 ? name : PERSONAL_TOKEN_LABEL;
  } catch {
    // A lookup that cannot run (e.g. before the database is open) still must not
    // leave the caller unnamed.
    return principal.clientId !== null ? OAUTH_CLIENT_LABEL : PERSONAL_TOKEN_LABEL;
  }
}

/** Cuts a name to {@link MCP_CLIENT_NAME_MAX_LENGTH}, so a fixed-width bar cannot be blown out. */
function boundClientName(name: string): string {
  return name.length > MCP_CLIENT_NAME_MAX_LENGTH ? name.slice(0, MCP_CLIENT_NAME_MAX_LENGTH) : name;
}
