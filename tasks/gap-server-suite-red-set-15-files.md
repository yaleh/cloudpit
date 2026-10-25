---
id: gap-server-suite-red-set-15-files
title: develop 的 server 测试红集（15 文件）归因并修复：让 fan-in 的 suite 不再被这组无关红挡住
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

develop（当前 `author == develop == 4a502e089`）的 server 测试红集在本机串行复跑中稳定复现。两条被它挡住的 fan-in（`gap-architecture-compact-chrome-and-tab-tooltip`、`gap-composer-quote-insert-breaks-only-for-multiline`）的 fan-in 日志逐字记录了同一组 15 个文件；前 5 个文件串行仍 exit 1，说明不是纯并发干扰：

- `server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` — `actual 'unknown' vs expected 'aborted'`（session_interrupt 后 run 状态）
- `server/modules/mcp-gateway/tests/mcp-session-send.test.ts` — `actual false vs expected true`（queued send；全量跑里出现 `SESSION_BUSY`）
- `server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts` — `actual false vs expected true`（unknown/cross-session send；全量跑里报 `Missing required scope "cloudcli:session:control"`）
- `server/modules/debug-agent/tests/debug-agent-control-queue.test.ts` — `probe child (queue) exited non-zero`
- `server/modules/providers/tests/claude-resident-busy-input.test.ts` — `leg-2 frame uuid undefined`

其余 10 个文件：`claude-resident-addressable` / `claude-resident-unattended-turn` / `claude-resident-unattended-after-turns` / `claude-resident-reconcile` / `voice-realtime-interrupt` / `voice-realtime-uplink-vad-seam` / `voice-realtime-queue-lifecycle-completion` / `voice-realtime-uplink-vad-arm-point` / `voice-realtime-uplink-vad-hold-open` / `chat-control-busy`。红集随负载会漂移（不同 baseline 看到 15～27 个），因此本任务必须先区分**真回归**与**负载/端口 flake**。

后果：只要 suite 一次点出 ≥12 个无关红，fan-in 的 rerun/baseline 两腿（各 300s）就装不下，任务必然 `exited-not-landed`。修好后两条被挡任务才能重跑。

## Plan

1. 在 `develop` 上串行复跑 15 个文件，逐条记录 exit code 与失败断言/超时，把稳定红与负载红分开。
2. 对稳定红定位：读失败断言与相关 source（mcp-gateway session/send/interrupt/cancel、providers resident bus/addressable/reconcile、voice-realtime、debug-agent probe、websocket chat-control-busy）；用 `git log` / `git bisect` 对照近期提交（`02b67b80d`、`49447771e`、`f170a7e17`、`c679313c1`、`811100e1b`、`53e482998`）。
3. 修复：优先修 source 回归；若是 harness/scope 缺失，更新 harness 的 token/scope 或断言；若是 load-only flake，加隔离/串行或显式 skip 并留证据（⛔ 不为变绿放宽判据）。
4. 在修好的 develop 上重跑 15 个文件串行 + fan-in 的 server phase，确认红集为空；再通知两条被挡任务重跑。
5. 不改无关模块；Touches 与实际改动一致。

## Acceptance Criteria

- [x] AC1 15 个文件在当前 develop 上串行复跑，逐条贴出 exit code 与失败断言/超时；明确区分稳定红与负载红。
- [x] AC2 稳定红的根因被定位到具体提交/代码路径（附 git log/bisect 读数），不是猜测。
- [x] AC3 修复后 15 个文件串行全部 exit 0；若仍有负载红，必须有可复算的 "load-only" 证据并单独登记，⛔ 不把红改绿。
- [x] AC4 fan-in 的 server phase（或等价 suite 命令）在修好的 develop 上不再产生这 15 个文件的 `passed=false`。
- [x] AC5 改动只落在 Touches 列出的文件；不改 `scripts/test.sh` 的既有语义（除非根因确在 runner，且单独说明）。

## Definition of Done

在 landed 提交上，15 个文件串行 exit 0，fan-in 的 server phase 不再因这组文件红；两条被挡任务（`gap-architecture-compact-chrome-and-tab-tooltip`、`gap-composer-quote-insert-breaks-only-for-multiline`）可以重跑并落地。

## Touches

- server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts
- server/modules/mcp-gateway/tests/mcp-session-send.test.ts
- server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts
- server/modules/debug-agent/tests/debug-agent-control-queue.test.ts
- server/modules/providers/tests/claude-resident-busy-input.test.ts
- server/modules/providers/tests/claude-resident-addressable.test.ts
- server/modules/providers/tests/claude-resident-unattended-turn.test.ts
- server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts
- server/modules/providers/tests/claude-resident-reconcile.test.ts
- server/modules/voice-realtime/tests/voice-realtime-interrupt.test.ts
- server/modules/voice-realtime/tests/voice-realtime-uplink-vad-seam.test.ts
- server/modules/voice-realtime/tests/voice-realtime-queue-lifecycle-completion.test.ts
- server/modules/voice-realtime/tests/voice-realtime-uplink-vad-arm-point.test.ts
- server/modules/voice-realtime/tests/voice-realtime-uplink-vad-hold-open.test.ts
- server/modules/websocket/tests/chat-control-busy.test.ts
- server/modules/mcp-gateway/*.ts
- server/modules/providers/*.ts
- server/modules/voice-realtime/*.ts
- server/modules/debug-agent/*.ts
- server/modules/websocket/*.ts
- tasks/gap-server-suite-red-set-15-files.md


## Evidence

**结论：15 个文件在修复后的 develop 上串行全绿；红集根因是 quay anchor 从 `claudecodeui-server.service` 的 drop-ins 继承了 live 环境（`RESIDENT_RUN_IS_TURN=1`、`VOICE_REALTIME_*`），泄漏进测试进程，不是代码回归。修复已在 develop 上：兄弟任务 `gap-test-runner-unsets-host-live-voice-and-s2-env` 的提交 `cc9ad6fa9`（`scripts/test.sh` 在任何 stage/子进程前 unset 这些名字）。本任务因此是归因 + 复验，未重复实现。**

Worktree: `/data/home/yale/work/claudecodeui-worktrees/gap-server-suite-red-set-15-files`（branch `task/gap-server-suite-red-set-15-files`，基线 develop `8c350678f`）。

### AC1 串行复跑（当前 develop，逐文件独立进程）

命令：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test <file>`（每个文件一个进程，`scripts/with-memory-cap.sh`，240s timeout）。读数 `rc 秒 文件 tests/pass/fail`：

```
0 35 server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts               15/15/0
0 22 server/modules/mcp-gateway/tests/mcp-session-send.test.ts                     8/8/0
0 19 server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts                    6/6/0
0 32 server/modules/debug-agent/tests/debug-agent-control-queue.test.ts            5/5/0
0 16 server/modules/providers/tests/claude-resident-busy-input.test.ts             1/1/0
0 13 server/modules/providers/tests/claude-resident-addressable.test.ts            1/1/0
0  9 server/modules/providers/tests/claude-resident-unattended-turn.test.ts        1/1/0
0  7 server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts 3/3/0
0  8 server/modules/providers/tests/claude-resident-reconcile.test.ts             21/21/0
0 10 server/modules/voice-realtime/tests/voice-realtime-interrupt.test.ts         14/14/0
0  9 server/modules/voice-realtime/tests/voice-realtime-uplink-vad-seam.test.ts   34/34/0
0  8 server/modules/voice-realtime/tests/voice-realtime-queue-lifecycle-completion.test.ts 7/7/0
0  5 server/modules/voice-realtime/tests/voice-realtime-uplink-vad-arm-point.test.ts 28/28/0
0  4 server/modules/voice-realtime/tests/voice-realtime-uplink-vad-hold-open.test.ts 9/9/0
0  8 server/modules/websocket/tests/chat-control-busy.test.ts                      5/5/0
```

15/15 exit 0；无稳定红、无负载红。全绿不是判据被放宽：同一份代码在带宿主 env 的裸跑下确定性红（AC2 假钉）。

### AC2 根因定位（不是猜测）

宿主环境来源（只读）：
- `~/.config/systemd/user/claudecodeui-server.service.d/40-resident-run-is-turn.conf` → `Environment=RESIDENT_RUN_IS_TURN=1`
- 同目录 `30-uplink-vad.conf` / `50-tts-local.conf` / `60-voice-realtime-settings.conf` → `VOICE_REALTIME_*`
- `/data/home/yale/.config/claudecodeui/voice-realtime.settings.json` → `turnDetection.silence_duration_ms: 1500`（测试断言出厂默认 800）
- 同目录 `20-sensevoice.conf` → `SENSEVOICE_*`

假钉（同一份代码、同一命令，只加宿主 env，不经 `scripts/test.sh` 的清理）：

```
$ env RESIDENT_RUN_IS_TURN=1 ... npx tsx ... --test server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts
EXIT=1  ℹ tests 15 / pass 13 / fail 2
  AssertionError: the run registry must record the aborted terminal state
  actual: 'unknown'   expected: 'aborted'
  AssertionError: the returned runId must be the registry current run verbatim
  actual: 'null'      expected: 'f0fecffc-3477-4b33-83aa-def5e24326c9'

$ env RESIDENT_RUN_IS_TURN=1 VOICE_REALTIME_UPLINK_VAD=silero VOICE_REALTIME_SETTINGS_PATH=… npx tsx ... --test server/modules/voice-realtime/tests/voice-realtime-uplink-vad-arm-point.test.ts
EXIT=1  ℹ tests 28 / pass 25 / fail 3
  AssertionError: The input did not match /silenceMs=800\b/. Input:
  'uplink_vad: uplink-vad[webrtc]: active (bypassed=false) state=loading silenceMs=1500 aFrames=86'
```

这两条与任务 Proposal 记录的红签名逐字一致 ⇒ 红集是环境泄漏，不是源码回归。

归因提交：`git log --oneline -- scripts/test.sh` 中 `cc9ad6fa9 test.sh: unset host live voice/S2 env before running tests`；`git merge-base --is-ancestor cc9ad6fa9 develop` exit 0（已在 develop）。当前 `/proc/<anchor.pid>/environ` 已无这些名字（本轮 anchor 是干净环境），但修复点在 runner，不依赖 anchor 是否干净。

### AC3 修复后 15 文件串行全绿

见 AC1：15/15 exit 0。没有需要单独登记的 load-only 红。

### AC4 fan-in server phase 等价命令

`env RESIDENT_RUN_IS_TURN=1 VOICE_CAPTURE=on VOICE_REALTIME_UPLINK_VAD=silero VOICE_REALTIME_SETTINGS_PATH=… bash scripts/with-memory-cap.sh bash scripts/test.sh --for-task gap-server-suite-red-set-15-files` → `EXIT=0`：`__PERFILE__ … passed=true` 共 15 行，`passed=false` 0 行；test.sh 前置 `suite-scope-check: PASS`。故意带导致假钉的完整宿主 env，运行器仍全绿 ⇒ fan-in 的 server phase 不再产生这 15 个文件的 `passed=false`。

### AC5 改动面

本任务未修改任何源码/测试：`git status --porcelain` 为空（`tmp/` 被 gitignore）；实现来自已在 develop 的 `cc9ad6fa9`，`scripts/test.sh` 的既有语义未被本任务改动。写入仅经 ABI 的 `tasks/gap-server-suite-red-set-15-files.md`（在 Touches 内）。

### DoD 注

「两条被挡任务（`gap-architecture-compact-chrome-and-tab-tooltip`、`gap-composer-quote-insert-breaks-only-for-multiline`）可以重跑并落地」由 driver 的 fan-in 执行；本任务移除了它们的红集阻塞，未代替 driver 触发重跑。
