/**
 * The Browser Use MCP stdio entrypoint now lives in `modules/cli` (it is the `cloudcli
 * browser-use-mcp` subcommand's implementation). It is NOT re-exported here on purpose: this
 * module may not import the CLI module, because the server root imports this module and the CLI
 * module imports the root bootstrap — re-exporting the entry would close that cycle again.
 */
// getBrowserUseRuntime: used by Browser Use services and environment-mode regression coverage.
export { getBrowserUseRuntime } from './browser-use-runtime.js';
// The MCP registration names and the cleanup set: exported so the Cloudpit runtime criterion can
// assert an uninstall removes the current name AND both legacy spellings without importing the
// service (and its database/provider singletons) directly.
export {
  LEGACY_MCP_SERVER_NAMES,
  MCP_SERVER_NAME,
  mcpServerNamesToRemove,
} from './browser-use.service.js';
