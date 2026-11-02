# Cloudpit v3.0 — release notes (identity-contract retirement)

This release closes the runtime fallbacks that 2.x kept for the CloudCLI → Cloudpit
rename. The objects and user data stay; only the runtime encodings change. See
`docs/proposals/cloudpit-compat-retirement.md` for the full matrix.

## OAuth scope spelling (`cloudcli:*` → `cloudpit:*`) — R9

- **New tokens**: the authorization-server metadata, the consent screen and the
  personal-access-token API advertise and accept exactly the eight
  `cloudpit:*` scopes. A request naming a retired `cloudcli:*` spelling is refused
  with `INVALID_SCOPE`.
- **Existing tokens keep working**: tokens already issued carry the canonical
  `cloudcli:*` strings in their stored row. Nothing is migrated and nothing is
  revoked. Verification still accepts them until the token's own `expires_at`
  passes or the token/its grant is revoked, and an OAuth refresh keeps working
  under the same rule. The longest PAT lifetime is 90 days, so every pre-3.0
  token ages out on its own within one quarter.
- **Action**: re-create long-lived tokens from Settings → API tokens and pick the
  `cloudpit:*` labels (`Read` is the default baseline); the old row can be revoked
  there at any time. No server-side invalidation is required.

## Observation URIs and deep links — R5/R7

- The observation wall accepts only `cloudpit://session/<id>` and
  `cloudpit://architecture/<id>`; a stored `cloudcli://session|architecture`
  address is no longer read. Links minted by 2.1+ already use the canonical
  spelling.
- The desktop app registers only the `cloudpit://` deep link. The third-party
  login callback `cloudcli://auth/callback` is unchanged and still handled.
- The brief/reply `itemRef` contract (`cloudcli://session/<id>/msg/<messageId>#item-<n>`)
  is deliberately **not** changed: it addresses items inside a transcript, not an
  observation object.

## MCP server name and service-worker cache — R8/R11

- Browser Use registers and uninstalls exactly `cloudpit-browser`. The legacy
  `cloudcli-browser` / `cloudcli-browser-use` registrations were removed by the
  2.x uninstall path; re-running the Browser Use install is enough on a machine
  that skipped it.
- The service worker purges only its own `cloudpit-*` caches. Upgrading directly
  from 1.x to 3.x is not supported: go through a 2.x release once so the
  `claude-ui-*` caches are dropped there.
