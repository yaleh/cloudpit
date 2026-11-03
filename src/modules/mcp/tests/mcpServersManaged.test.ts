import assert from 'node:assert/strict';

import { test } from 'vitest';

import { isManagedServer } from '@/modules/mcp/utils/mcpFormatting';
import type { ProviderMcpServer } from '@/shared/types';

/**
 * The managed-prefix criterion for the MCP Servers list (Settings → MCP).
 *
 * A server the app writes automatically (`cloudpit-browser`, `cloudpit-browser-use`) is shown
 * read-only; the user must not edit or delete it out of sync with the feature toggle. Entries
 * written by a build that still used the legacy `cloudcli-` prefix keep that badge until the
 * feature re-registers them, so both prefixes are recognised and an ordinary user server is not.
 */

/** A minimal server row; only the name participates in the managed decision. */
function server(name: string): ProviderMcpServer {
  return { provider: 'claude', name, scope: 'user', transport: 'http' };
}

test('managed MCP servers are recognised by the cloudpit- prefix', () => {
  assert.equal(isManagedServer(server('cloudpit-browser')), true);
  assert.equal(isManagedServer(server('cloudpit-browser-use')), true);
});

test('a legacy cloudcli- entry is still read-only', () => {
  assert.equal(isManagedServer(server('cloudcli-browser')), true);
  assert.equal(isManagedServer(server('cloudcli-browser-use')), true);
});

test('a user-added server is editable', () => {
  assert.equal(isManagedServer(server('my-tools')), false);
  assert.equal(isManagedServer(server('cloudpit')), false, 'the gateway name itself is not a prefix');
});
