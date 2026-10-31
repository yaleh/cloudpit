/**
 * The Browser Use MCP registration names.
 *
 * WHY A DEPENDENCY-FREE LEAF. `browser-use/index.ts` re-exports these, and the
 * module barrel is imported by callers that only want to read a string (the
 * CLI bootstrap fixture and the Cloudpit runtime criterion among them). Taking
 * the values from `browser-use.service.ts` would evaluate that service, which
 * imports the database and provider singletons and, through the provider
 * registry, `@openai/codex-sdk` — a graph that cannot load in a CJS fixture.
 * The service imports this leaf too, so the registered name and the cleanup set
 * still come from one place.
 */

/** The name this build registers with every provider. */
export const MCP_SERVER_NAME = 'cloudpit-browser';

/** Spellings earlier builds registered; an uninstall removes them as well. */
export const LEGACY_MCP_SERVER_NAMES: string[] = ['cloudcli-browser', 'cloudcli-browser-use'];

/** The names an uninstall must remove: the current registration plus every legacy spelling. */
export function mcpServerNamesToRemove(): string[] {
  return [MCP_SERVER_NAME, ...LEGACY_MCP_SERVER_NAMES];
}
