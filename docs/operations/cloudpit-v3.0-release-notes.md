# Cloudpit v3.0 — release notes (identity-contract retirement)

This release closes the runtime fallbacks that 2.x kept for the CloudCLI → Cloudpit
rename. The objects and user data stay; only the runtime encodings change. See
`docs/proposals/cloudpit-compat-retirement.md` for the full matrix.

Every retirement section below names its **Breaking** change, the **Action** an
operator takes, and the **Rollback** path. Upgrading directly from 1.x to 3.0 is not
supported: read [Upgrade path](#upgrade-path-2x-is-mandatory-data-is-never-deleted)
first.

## Environment variables (`CLOUDCLI_*` no longer read) — R1

- **Breaking**: brand-owned environment variables are read under the `CLOUDPIT_*`
  spelling only. Up to 2.x the reader also accepted the legacy `CLOUDCLI_<NAME>`
  spelling and warned once per key; in 3.0 a process that exports only the legacy
  name reads the key as absent, so the caller's shipped default applies — no error
  and no warning. Every production reader (Electron `main.js` / `localServer.js` /
  `serverInstaller.js`, the browser-use service and its MCP entry) now goes through
  this one reader. Operator-visible keys include `CLOUDPIT_HOME`, `CLOUDPIT_SERVER_PORT`,
  `CLOUDPIT_USE_INSTALLED_SERVER`, `CLOUDPIT_CONTROL_PLANE_URL`, `CLOUDPIT_SERVER_DIR`,
  `CLOUDPIT_SERVER_BUNDLE_URL`, `CLOUDPIT_SERVER_BUNDLE_RELEASE_TAG` and the
  `CLOUDPIT_BROWSER_USE_*` settings.
- **Two deliberate exceptions**: the attachment dual root still accepts
  `CLOUDCLI_HOME` alongside `CLOUDPIT_HOME` (R4, retained in 3.0), and a few
  internal, non-operator identifiers that merely carry the old prefix
  (`CLOUDCLI_WATCHER_MODE`, the MCP gateway token name, the build-time
  `CLOUDCLI_BUNDLE_*` switches) were not renamed by this release.
- **Action**: before upgrading, rename the keys in systemd drop-ins, `.env` files
  and launcher scripts. `grep -rn 'CLOUDCLI_' /etc/systemd/system/*.d \
  ~/.config/systemd/user/ .env*` should return only the two exception groups above.
- **Rollback**: restart the 2.x binary, which still reads the legacy spelling. No
  data is involved; nothing was migrated.

## Data root (`~/.cloudcli` no longer falls back) — R2

- **Breaking**: there is one default root, `<home>/.cloudpit`. The `defaultRoot:
  'legacy'` mode is gone, and so is the 2.x fallback that kept serving `~/.cloudcli`
  when a migration failed. A failed migration is now reported
  (`resolveDataRoots` returns `reason: 'migration-failed'` with the error message)
  and the Cloudpit root stays active instead of silently reverting.
- **Action**: let the one-time migration run on the first 3.0 start. It copies the
  legacy layout (`auth.db` through SQLite `VACUUM INTO`, voice data, cockpit card
  feedback, reply-suggestion usage log, settings) and writes the
  `.migrated-from-cloudcli` marker LAST. Verify `~/.cloudpit/.migrated-from-cloudcli`
  exists. A machine upgrading straight from 1.x is copied once into `~/.cloudpit`
  by this same path.
- **Rollback**: reinstall/run the 2.x binary; it still reads `~/.cloudcli`. The
  legacy root is only ever READ — a failed attempt rolls back every file it created
  and leaves `~/.cloudcli` byte-identical — and it is never renamed or deleted. As a
  manual fallback, copy the new root's files back into `~/.cloudcli`.

## Settings file (`~/.config/claudecodeui` read fallback removed) — R3

- **Breaking**: the shipped settings path is
  `<home>/.config/cloudpit/server.settings.json`. The 2.x runtime fallback that read
  `~/.config/claudecodeui/server.settings.json` whenever the new file was missing is
  deleted; every read after the one-time copy uses only the Cloudpit file, and every
  save writes there.
- **Action**: on the first default-target resolution the legacy file is COPIED once
  to the Cloudpit path when the latter is absent (an existing Cloudpit file is never
  overwritten). The legacy file is left on disk. Alternatively set
  `SERVER_SETTINGS_PATH` to an explicit file, which is read and written in place.
- **Rollback**: copy the Cloudpit file back to the legacy path, or point
  `SERVER_SETTINGS_PATH` at the legacy file. Copying back is safe because the legacy
  file was never modified.

## Desktop app identity (`ai.cloudcli.desktop` → `ai.cloudpit.desktop`) — R13

- **Breaking**: the Electron app id moves from `ai.cloudcli.desktop` to
  `ai.cloudpit.desktop` (product name Cloudpit). Installers, the Windows uninstall
  registry key and start-menu/taskbar shortcuts, the macOS keychain service, the
  Linux `.desktop` entry and the userData directory are now keyed by the new id; a
  2.x install is not the same installation as a 3.0 install.
- **Action**: install the 3.0 desktop package once and launch it. On first launch
  `maybeMigrateDesktopAppId` copies the install-level identity, and
  `maybeMigrateDesktopUserData` copies the three userData JSON files, from the
  legacy locations. Keep the 2.x installer until the migration is confirmed.
- **Rollback**: reinstall the 2.x package. The migration never deletes or
  overwrites a legacy artifact, so the old registry key, shortcuts, keychain entry,
  `.desktop` file and userData directory are still valid. If a per-artifact
  migration fails, the app logs `[appIdMigration] fell back to the legacy
  installation:` and keeps running on the old installation.

## Attachment dual root (retained in 3.0) — R4

- **Breaking**: none for readers. The attachment dual root is **deliberately still
  present in 3.0**: new uploads are written to `~/.cloudpit/assets` (or
  `<explicit>/assets`), and reads try the new root first, then
  `~/.cloudcli/assets`; source-path validation allows both roots. This row is NOT
  retired by this release.
- **Action**: nothing required. Do not delete `~/.cloudcli/assets` — historical
  messages reference files by absolute path and may still need it. The retirement of
  the legacy read root remains deferred until the `cloudpit migrate-assets
  --rewrite` prerequisite lands (a separate task); until then both roots are read.
- **Rollback**: not applicable — the dual root is the current and only state. If an
  explicit root is used, `CLOUDPIT_HOME` (or the retained `CLOUDCLI_HOME`) selects
  the base for both the write root and the new read root.

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
- **Rollback**: existing rows were never rewritten, so a 2.x binary accepts the same
  tokens; revoking the new tokens is enough to fall back to the old ones.

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

## Upgrade path (2.x is mandatory, data is never deleted)

A direct 1.x → 3.0 upgrade is **not supported**. Pass through one 2.x release
first, for three reasons:

1. **Service-worker caches**: 2.x purges the historical `claude-ui-*` caches; 3.0
   only purges its own `cloudpit-*` caches, so a direct 1.x upgrade would leave the
   old caches behind.
2. **Observation URI keys**: 2.1+ writes the canonical
   `cloudpit://session|architecture` addresses and normalizes stored keys; 3.0 no
   longer reads a stored `cloudcli://` address. The 2.x pass performs that
   normalization.
3. **Old OAuth tokens**: tokens issued before the scope rename keep the canonical
   `cloudcli:*` strings and age out on their own (longest PAT lifetime is 90 days;
   see R9). Re-create long-lived tokens with the `cloudpit:*` labels.

The one-time data-root migration still runs for a machine that jumps straight from
1.x to 3.0 (R2), but the service-worker purge and URI-key normalization above still
require the 2.x pass.

**Old data and old installations are not deleted by the upgrade.** `~/.cloudcli`,
`~/.config/claudecodeui/server.settings.json`, `~/.cloudcli/assets`, the pre-3.0
userData directory and the legacy install artifacts (registry key, shortcuts,
keychain entry, `.desktop` file) all remain on disk. Old installs are not removed
automatically either; uninstalling 2.x is a manual, explicit action.
