# Session binding recovery

A session row stores one provider identity in two columns that must agree:

- `sessions.provider_session_id` — the provider-native thread id;
- `sessions.jsonl_path` — the transcript file that thread writes.

`superseded_provider_sessions` records threads an edit left behind.

## The defect this repairs

An edit rewind forks a thread, retires the pre-edit thread, and moves the row
onto the fork. A **late** `session_created` from the pre-edit host/run can then
write the old thread id back while the row keeps the fork's path. The row
claims thread A but reads thread B's file, and the indexer creates a second
sidebar row for B.

The application path no longer allows that write:

- ordinary run discovery goes through `sessionBindingService.recordRunDiscoveredBinding`;
  a retired id, or an id from a run that did not start on the row's current
  binding, is rejected and logged (`[SessionBinding] …`);
- only an explicit replacement (`replaceBinding` / `detachForEdit`, used by the
  Codex edit fork and first-prompt restart) may displace the binding, and it
  commits the id, path, superseded mark and duplicate-row merge in one
  transaction.

This runbook is for a row that was already damaged before those guards existed.
It is not a general repair tool and it never guesses.

## Second defect shape: the claimed thread is wrongly retired and the path is NULL

A related row looks different and is just as stale:

- `provider_session_id` names the thread the conversation actually lives in;
- `jsonl_path` is **NULL**;
- the same thread is present in `superseded_provider_sessions` for this
  session, with its rollout path.

Nothing points at the transcript, so the sidebar falls back to the row's stored
`updated_at` — the moment the bad retirement was recorded — and shows the
session as hours older than its last turn. The transcript itself is intact and
still ends with the conversation's real last activity.

The script classifies the row as `null-path-retired` when those hold, and
`fork-rebind` for the edit-fork shape above. It restores `provider_session_id`
/`jsonl_path`, clears the wrong retirement, and sets `updated_at` to the
transcript's own last recorded activity timestamp — never to the repair time.

## Diagnosis (read-only)

1. Read the row and the superseded table:

   ```bash
   node -e '
   const Database=require("better-sqlite3");
   const db=new Database(process.env.HOME+"/.cloudcli/auth.db",{readonly:true});
   console.log(db.prepare("SELECT * FROM sessions WHERE session_id=?").get(process.argv[1]));
   console.log(db.prepare("SELECT * FROM superseded_provider_sessions WHERE session_id=?").all(process.argv[1]));
   ' <app-session-id>
   ```

2. The defect shape is either of:
   - **fork-rebind**: `jsonl_path` names a thread id **different** from
     `provider_session_id`; `provider_session_id` is marked superseded for this
     session; the file the row points at is metadata-only (no completed turns)
     and its `session_meta.forked_from_id` is `provider_session_id`; the
     original thread's file (recorded in the superseded row) still exists and
     has completed turns;
   - **null-path-retired**: `jsonl_path` is NULL; `provider_session_id` is
     marked superseded for this session with that thread's rollout path; the
     rollout exists, its `session_meta.id` is `provider_session_id`, and its
     `session_meta.cwd` matches the row's `project_path`.

   Both shapes also require the target transcript to record an activity
   timestamp; the repair refuses rather than writing a wall-clock `updated_at`.

## Repair

Always dry-run first. The script writes one evidence JSON per run under `tmp/`
(override with `--evidence`) containing the row, superseded rows, and both
transcripts' readings before and after. It **does not modify, truncate or delete
transcripts**, and it does not restart the shared service.

```bash
node scripts/repair-session-binding.mjs --session <app-session-id>            # dry run
node scripts/repair-session-binding.mjs --session <app-session-id> --apply    # commit
node scripts/repair-session-binding.mjs --session <app-session-id>            # re-run: already-consistent
```

In one transaction, `--apply`:

1. restores `provider_session_id` (fork-rebind only) and `jsonl_path` to the
   original thread, guarded by a compare-and-swap on the id, path and
   `updated_at` it read;
2. sets `updated_at` to the transcript's last recorded activity timestamp;
3. deletes the superseded mark that wrongly retired the original thread,
   guarded by the recorded mark's path;
4. for fork-rebind only: deletes the watcher-created duplicate row for the
   metadata-only fork and records the abandoned fork as superseded so the
   indexer does not offer it back as an empty session.

A concurrent rebind, a changed transcript path or a changed superseded record
makes the whole transaction refuse and roll back; nothing is written partially.

The repair runs outside the server process, so a committed row is **not**
broadcast. Reload the project/session list afterwards: the existing
`GET /api/projects` path runs the provider synchronizer and then reads the row,
which is the supported refresh entry. Do not claim that writing the database
notifies open clients.

The transcript files stay on disk. A second run exits `already-consistent`
without writing.

## Refusals

Exit code `2` means the row does not match a defect shape: no binding, the
binding is already consistent, the target transcript is missing or has no
turns, its `session_meta.id`/`cwd` disagree with the row, it records no
activity timestamp, the pointed-at file has real turns, or it is not a fork of
the stored id. Do not hand-edit the database; re-diagnose from the evidence
file. Exit code `1` is an operational failure (database missing, session not
found, concurrent write).

## Verification after repair

- The row's `provider_session_id` matches the thread id in `jsonl_path`.
- `updated_at` equals the transcript's last recorded activity timestamp, not the
  repair's wall clock.
- `superseded_provider_sessions` no longer names the restored thread for the
  session, and (fork-rebind) does name the abandoned fork.
- Reopening the session in the app reads the original turns (early
  troubleshooting, deployment re-checks, later discussion) and the sidebar has
  one row, not two.
- The browser refresh/restart story is covered separately by AC-447.

`scripts/repair-session-binding.test.mjs` covers both shapes, the refusals, the
compare-and-swap conflict, transaction rollback and the idempotent second run:

```bash
node --test scripts/repair-session-binding.test.mjs
```

Tests point the Codex rollout walk at a temp tree with
`CODEX_SESSIONS_ROOT`, so no fixture can be answered by the host's real
`~/.codex`.

## A consistent row can still read empty: paginated Codex forks

The checks above catch a row whose two columns disagree. A Codex edit in the
CLI's `paginated` history mode produces a different shape that looks consistent
and still shows no conversation:

- the row's `provider_session_id` and `jsonl_path` both name the **fork**;
- the fork file holds two metadata rows, not copied turns — `session_meta`
  carries `payload.forked_from_id`, `payload.forked_from_ordinal_exclusive` and
  `payload.history_base {thread_id, end_ordinal_exclusive, end_byte_offset}`;
- the kept turns remain in the source rollout named by `forked_from_id`.

The CLI's own resume path follows that pointer, so the fork is a real thread.
The app's reader has to follow it too (measured 2026-10-31 against the bundled
`@openai/codex 0.166.0`: a fork file of 2 rows, `forked_from_ordinal_exclusive`
11, and the CLI's `thread/read` reporting the 2 kept turns). `codexRolloutLines`
in `server/modules/providers/list/codex/codex-fork-history.ts` emits the source
prefix before the fork's own rows; without it the history view opens only the
pointer file and renders nothing — the "history disappeared after an edit"
symptom.

Diagnose by reading the fork file's first row and the source's kept prefix:

```bash
head -n 1 <fork.jsonl>            # session_meta: forked_from_id + cut ordinal
# the source is rollout-*-<forked_from_id>.jsonl under the same ~/.codex/sessions root
```

Do **not** rewrite the fork to copy turns in, and do not repoint the row at the
source: both would undo the edit's cut. The correct reading is the prefix plus
the fork's own appended replacement turn.

Verification for this shape (AC-447):

```bash
npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/session-edit-continuity.test.ts
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/session-edit-real-cli.test.ts
bash scripts/session-edit-continuity-check.sh   # also verifies the browser/scenario evidence
```

The browser leg is a real page against an isolated instance whose `.codex` home
contains the pointer fork: open the fork, reload, switch to the source session
and back, then press the first kept turn's edit control. The source session is
the control — the edited turn is visible there, so its absence on the fork is a
reading rather than a blind reader.
