#!/usr/bin/env bash
# Restart the claudecodeui server once NO CloudCLI session is running a turn.
#
# Why this script exists: restarting the server unit kills every claude process under it, so doing
# it while another session is mid-turn loses that turn. It runs as a systemd USER transient unit
# (`systemd-run --user`), i.e. OUTSIDE the server's slice, so it survives the very restart it
# performs — a background child of the caller's session would die with the session's cgroup.
#
# The busy reading is the server's own registry projection
# (GET /api/providers/sessions/running -> chatRunRegistry.listRunningRuns()),
# NOT a local timer or process scan: a resident session keeps a claude process alive while idle, and
# a busy turn is mostly waiting on the network.
#
# Restart happens only after the registry has been empty for SETTLE_SECONDS continuously, so it does
# not slip into the gap between two turns.
#
# BUILD-SKEW PREFLIGHT: this script is the other restart entrypoint that once served a new browser
# bundle against an old server (2026-10-27). Right before stopping the service — and, with
# `--dry-run`, immediately — `scripts/build-skew-check.mjs` compares dist/build-info.json with
# dist-server/build-info.json. Not `same` (skew or a missing record) refuses the restart and writes
# the reason, both shas included, into the result file. Run `npm run build` (full build), not
# `build:client`, and re-run this waiter.
#
# This file is the in-repo copy. The pre-2026-10-27 out-of-repo copy at
# ~/.local/state/cloudcli-deferred-restart/restart-when-idle.sh is deliberately NOT deleted (that is
# a human's call); it has no build-skew preflight, so use this path for new deferred restarts.
#
# USAGE  scripts/restart-when-idle.sh [--dry-run]
#   --dry-run  build-skew preflight only; never polls, stops or restarts anything
#
# Test / isolation seams (defaults are the production host):
#   QUAY_REPO                     checkout to restart (default: this script's parent)
#   QUAY_NODE                     node binary (default: node on PATH)
#   QUAY_SERVER_UNIT              unit base name, without .service (default: claudecodeui-server)
#   QUAY_RESTART_PORT             port the registry API answers on (default: 3001)
#   QUAY_RUNNING_API              full registry URL (default: http://127.0.0.1:$PORT/api/providers/sessions/running)
#   QUAY_AUTH_DB                  auth sqlite db holding the jwt_secret
#   QUAY_RESTART_WHEN_IDLE_LOG    log file
#   QUAY_RESTART_WHEN_IDLE_RESULT result JSON
#   QUAY_BUILD_INFO_ROOT          app root whose dist/ and dist-server/ records are compared
#   QUAY_IDLE_POLL_SECONDS / QUAY_IDLE_SETTLE_SECONDS / QUAY_IDLE_MAX_WAIT_SECONDS
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${QUAY_REPO:-$(cd "$SCRIPT_DIR/.." && pwd)}"
NODE="${QUAY_NODE:-$(command -v node || true)}"
PORT="${QUAY_RESTART_PORT:-3001}"
AUTH_DB="${QUAY_AUTH_DB:-$HOME/.cloudcli/auth.db}"
LOG="${QUAY_RESTART_WHEN_IDLE_LOG:-$HOME/.local/state/cloudcli-deferred-restart/restart.log}"
RESULT="${QUAY_RESTART_WHEN_IDLE_RESULT:-$HOME/.local/state/cloudcli-deferred-restart/result.json}"
UNIT="${QUAY_SERVER_UNIT:-claudecodeui-server}.service"
BUILD_INFO_ROOT="${QUAY_BUILD_INFO_ROOT:-$REPO}"
API="${QUAY_RUNNING_API:-http://127.0.0.1:$PORT/api/providers/sessions/running}"

POLL_SECONDS="${QUAY_IDLE_POLL_SECONDS:-20}"
SETTLE_SECONDS="${QUAY_IDLE_SETTLE_SECONDS:-120}"
MAX_WAIT_SECONDS="${QUAY_IDLE_MAX_WAIT_SECONDS:-86400}"

DRY=no
case "${1:-}" in
  --dry-run) DRY=yes ;;
  "") ;;
  *)
    echo "usage: scripts/restart-when-idle.sh [--dry-run]" >&2
    exit 64
    ;;
esac

if [ "$DRY" = no ]; then
  mkdir -p "$(dirname "$LOG")" "$(dirname "$RESULT")"
fi

log() { printf '%s %s\n' "$(date '+%F %T %Z')" "$*" >>"$LOG"; }

# Prints the build-skew reading; exit code is build-skew-check.mjs's (0 same, 1 skew, 2 missing).
build_skew_reading() {
  if [ -z "$NODE" ]; then
    echo "MISSING node not found on PATH — cannot run scripts/build-skew-check.mjs"
    return 2
  fi
  if [ ! -f "$REPO/scripts/build-skew-check.mjs" ]; then
    echo "MISSING $REPO/scripts/build-skew-check.mjs"
    return 2
  fi
  "$NODE" "$REPO/scripts/build-skew-check.mjs" --root "$BUILD_INFO_ROOT" 2>&1
}

mint_token() {
  local secret
  secret=$(/usr/bin/python3 -I -c "import sqlite3;c=sqlite3.connect('file:${AUTH_DB}?mode=ro',uri=True);print(c.execute(\"select value from app_config where key='jwt_secret'\").fetchone()[0])") || return 1
  [ -n "${secret:-}" ] || return 1
  ( cd "$REPO" && "$NODE" -e "console.log(require('jsonwebtoken').sign({userId:1,username:'yale'},process.argv[1],{expiresIn:'12h'}))" "$secret" )
}

# Prints "<count> <id,id,...>" on success; exit non-zero on transport/shape failure.
read_running() {
  local token=$1 body
  body=$(/usr/bin/curl -s --max-time 10 "${API}?token=${token}") || return 1
  [ -n "$body" ] || return 1
  "$NODE" -e '
    let s = "";
    process.stdin.on("data", d => s += d);
    process.stdin.on("end", () => {
      let j;
      try { j = JSON.parse(s); } catch { process.exit(2); }
      const a = j && j.data && j.data.sessions;
      if (!Array.isArray(a)) process.exit(2);
      process.stdout.write(String(a.length) + " " + a.map(x => x.sessionId).join(","));
    });
  ' <<<"$body"
}

main_pid() { systemctl --user show -p MainPID --value "$UNIT"; }
active_state() { systemctl --user show -p ActiveState --value "$UNIT"; }

write_result() {
  local status=$1 detail=$2 before_pid=${3:-} after_pid=${4:-}
  "$NODE" -e '
    const [status, detail, before, after, resultPath, repo] = process.argv.slice(1);
    const fs = require("node:fs");
    const path = require("node:path");
    const readInfo = (rel) => {
      try { return JSON.parse(fs.readFileSync(path.join(repo, rel), "utf8")); } catch { return null; }
    };
    fs.writeFileSync(resultPath, JSON.stringify({
      status, detail,
      finishedAt: new Date().toISOString(),
      mainPidBefore: before ? Number(before) : null,
      mainPidAfter: after ? Number(after) : null,
      buildInfo: readInfo("dist-server/build-info.json"),
      clientBuildInfo: readInfo("dist/build-info.json"),
    }, null, 2) + "\n");
  ' "$status" "$detail" "$before_pid" "$after_pid" "$RESULT" "$BUILD_INFO_ROOT"
}

# The refusal shared by the startup check and the moment just before the stop. Sets the global
# SKEW_READING to the check's one-line reading and returns its exit code (0 same, 1 skew, 2 missing).
refuse_on_skew() {
  local rc
  SKEW_READING=$(build_skew_reading)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    log "REFUSED: build-skew preflight: $SKEW_READING"
    return "$rc"
  fi
  log "build-skew preflight: $SKEW_READING"
  return 0
}

if [ "$DRY" = yes ]; then
  SKEW_READING=$(build_skew_reading)
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "REFUSED: build-skew preflight: $SKEW_READING"
    exit "$rc"
  fi
  echo "build-skew preflight OK: $SKEW_READING"
  exit 0
fi

log "waiter started (pid $$, cgroup $(cat /proc/self/cgroup))"

before_pid=$(main_pid)
log "target: $UNIT MainPID=$before_pid ActiveState=$(active_state) build=$(cat "$BUILD_INFO_ROOT/dist-server/build-info.json" 2>/dev/null | tr -d '\n')"

# A skew at startup cannot heal by waiting: nothing in this script builds. Refuse now and record
# why, rather than sitting in the idle loop for up to MAX_WAIT_SECONDS.
if ! refuse_on_skew; then
  write_result "refused-build-skew" "build-skew preflight: $SKEW_READING" "$before_pid"
  exit 1
fi

token=""
started_at=$(date +%s)
idle_since=""

while :; do
  now=$(date +%s)
  if [ $((now - started_at)) -ge "$MAX_WAIT_SECONDS" ]; then
    log "giving up after ${MAX_WAIT_SECONDS}s without a ${SETTLE_SECONDS}s idle window"
    write_result "gave-up" "no idle window within ${MAX_WAIT_SECONDS}s" "$before_pid"
    exit 2
  fi

  if [ -z "$token" ]; then
    token=$(mint_token) || { log "token mint failed; retrying"; sleep "$POLL_SECONDS"; continue; }
  fi

  if reading=$(read_running "$token"); then
    count=${reading%% *}
    ids=${reading#* }
    if [ "$count" = "0" ]; then
      if [ -z "$idle_since" ]; then
        idle_since=$now
        log "registry empty; settle window ${SETTLE_SECONDS}s starts"
      elif [ $((now - idle_since)) -ge "$SETTLE_SECONDS" ]; then
        # Re-check right before the stop: the tree may have changed while we waited.
        if ! refuse_on_skew; then
          write_result "refused-build-skew" "build-skew preflight: $SKEW_READING" "$before_pid"
          exit 1
        fi
        log "idle for $((now - idle_since))s; restarting $UNIT"
        write_result "restarting" "idle ${SETTLE_SECONDS}s+" "$before_pid"
        systemctl --user restart "$UNIT" >>"$LOG" 2>&1
        rc=$?
        log "systemctl restart rc=$rc"
        new_pid=""
        for _ in $(seq 1 90); do
          sleep 2
          new_pid=$(main_pid)
          state=$(active_state)
          if [ "$state" = "active" ] && [ -n "$new_pid" ] && [ "$new_pid" != "0" ] && [ "$new_pid" != "$before_pid" ]; then
            break
          fi
        done
        log "after restart: MainPID=${new_pid:-?} ActiveState=$(active_state)"
        healthy=""
        token="" # secret is stable, but re-mint so a rotated secret cannot hide a dead server
        for _ in $(seq 1 60); do
          if [ -z "$token" ]; then token=$(mint_token) || true; fi
          if [ -n "$token" ] && healthy=$(read_running "$token"); then break; fi
          sleep 2
        done
        if [ -n "$healthy" ]; then
          log "health: registry answers again -> ${healthy}"
          write_result "restarted" "idle ${SETTLE_SECONDS}s+; registry ${healthy%% *} running" "$before_pid" "$new_pid"
          exit 0
        fi
        log "restart done but registry did not answer; leaving result=restart-unhealthy"
        write_result "restart-unhealthy" "server restarted but registry did not answer" "$before_pid" "$new_pid"
        exit 3
      fi
    else
      if [ -n "$idle_since" ]; then
        log "busy again after $((now - idle_since))s idle; settle window resets"
      fi
      idle_since=""
      log "running=$count ids=$ids"
    fi
  else
    log "registry read failed; not restarting (will retry)"
    idle_since=""
  fi

  sleep "$POLL_SECONDS"
done
