# Migrating legacy attachments (`cloudpit migrate-assets`)

*R4 prerequisite: copy `~/.cloudcli/assets` into the Cloudpit assets root and rewrite the absolute
paths the app persists itself.*

The v3.0 runtime reads attachments from **both** roots (`~/.cloudpit/assets` first, then
`~/.cloudcli/assets`) and writes only to the Cloudpit root. The legacy read root can be retired
(R4) only after this command has really run on the machine and every app-owned path points at the
new root. Until then the legacy directory stays in place, unchanged, as the rollback source.

## What the command changes

| Surface | Location | Rewritten |
|---|---|---|
| Uploaded asset files | copied `~/.cloudcli/assets/**` → `~/.cloudpit/assets/**` (or `$CLOUDPIT_HOME/assets`) | copied, never moved; source kept |
| Scheduled messages | `auth.db` → `scheduled_messages.options` (attachment JSON) | yes |
| Composer drafts / queued messages | `auth.db` → `session_drafts.draft_text`, `queued_message` | yes |
| User preferences | `auth.db` → `user_preferences.preference_value` | yes |
| Settings | `~/.config/cloudpit/server.settings.json` | yes |
| Cockpit card feedback | `~/.cloudpit/cockpit-card-feedback.json` | yes |
| Voice manifest | `~/.cloudpit/voice-data/manifest.json` | yes |
| Provider transcripts | `~/.claude/projects/**`, `~/.codex/sessions/**` | **no** — listed as `unrewritable` |

The database is the one the server uses: `$DATABASE_PATH` when set, otherwise
`<CLOUDPIT_HOME or ~/.cloudpit>/auth.db`. Provider transcripts are owned by the CLIs, so the
command only reads them and lists every `file:line` hit; those references must be resolved by hand
(or accepted, because the session history they describe is already over).

## Order of operations

1. **Dry run — write nothing.**

   ```bash
   cloudpit migrate-assets --dry-run
   cloudpit migrate-assets --dry-run --json   # machine-readable report
   ```

   A dry run scans the legacy tree, the persisted documents and the provider transcripts and
   reports the planned counts. It creates no directory, copies no file, takes no backup and
   rewrites no path. Compare the printed `copied` / `rewritten` / `unrewritable` numbers with what
   you expect; `conflicts` must be understood before a real run (see below).

2. **Backup — automatic, before the first write.** During `--rewrite` the command copies every
   store it is about to modify to `<file>.bak-asset-migration-<YYYYMMDD-HHmmss>` and lists those
   paths in `backupPaths`. The copies are written before the first file is touched, so a kill
   mid-run still leaves a consistent backup. Keep them until the migration is verified.

3. **Real run.**

   ```bash
   cloudpit migrate-assets --rewrite
   cloudpit migrate-assets --rewrite --json
   ```

   Copy semantics: a missing target is copied; an existing target with identical bytes is
   skipped; an existing target with **different** bytes is a conflict and is never overwritten
   (the report names it and the legacy file stays authoritative). Copies are additive and
   idempotent, so re-running is safe:

   - second run over an unchanged tree → `copied=0`, `skipped=<all files>`;
   - second run after a successful rewrite → `rewritten=0`;
   - a failed path write rolls the whole rewrite batch back from the backups, reports the error in
     `errors`, and leaves **no** half-rewritten state (`rewritten=0`).

4. **Verify.**
   - `cloudpit migrate-assets --dry-run` reports `copied=0`, `skipped=<all legacy files>`,
     `rewritten=0`.
   - `unrewritable=0`, or every listed transcript reference was resolved by hand.
   - Open a recent chat that had an attachment and a scheduled message scheduled before the
     migration: both must still resolve the file from the new root.
   - Keep the `backupPaths` files until the checks pass.

5. **Keep the legacy root.** The command never deletes or renames `~/.cloudcli/assets`. Delete it
   by hand only after the checks above, and only if you also accept losing the rollback source.

## Report and exit codes

`--json` prints exactly this object on stdout:

```json
{
  "copied": 0,
  "skipped": 0,
  "conflicts": [],
  "rewritten": 0,
  "unrewritable": [],
  "backupPaths": [],
  "errors": []
}
```

| Exit code | Meaning |
|---|---|
| `0` | Everything the command owns is done; no unrewritable references, no errors. |
| `1` | Usage error, or the rewrite failed and was rolled back (`errors` non-empty). |
| `3` | Copies/rewrites succeeded, but provider transcripts still reference the legacy root (`unrewritable` non-empty). A warning is printed on stderr. |

A dry run exits with the same code the real run would (it never writes, so `errors` stays empty).

## Rollback

1. Stop the server so no process holds `auth.db`.
2. Copy each `backupPaths` entry back over its original path:
   `cp <file>.bak-asset-migration-<stamp> <file>`.
3. Re-run `cloudpit migrate-assets --dry-run` and confirm the planned counts match the state you
   started from.
4. Copied asset files under the Cloudpit root may be left in place — they are additive and the
   legacy root is untouched.

## Precondition for R4

R4 (removing the legacy read root from `server/shared/image-attachments.ts` and retiring the
`.cloudcli/assets` read path) may start only when **all** of the following hold on the target
machine:

- `cloudpit migrate-assets --rewrite` has completed with exit code `0`;
- a follow-up `--dry-run` reports `rewritten=0`, `copied=0`;
- `unrewritable` is empty, or each remaining transcript reference has been accepted as history
  that no live feature reads;
- the `backupPaths` from the last successful rewrite are still retained.

This document covers the migration tool only. It does not change the dual-root read behaviour;
that removal is a separate R4 task.
