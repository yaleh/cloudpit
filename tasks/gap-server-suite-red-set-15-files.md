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

- [ ] AC1 15 个文件在当前 develop 上串行复跑，逐条贴出 exit code 与失败断言/超时；明确区分稳定红与负载红。
- [ ] AC2 稳定红的根因被定位到具体提交/代码路径（附 git log/bisect 读数），不是猜测。
- [ ] AC3 修复后 15 个文件串行全部 exit 0；若仍有负载红，必须有可复算的 "load-only" 证据并单独登记，⛔ 不把红改绿。
- [ ] AC4 fan-in 的 server phase（或等价 suite 命令）在修好的 develop 上不再产生这 15 个文件的 `passed=false`。
- [ ] AC5 改动只落在 Touches 列出的文件；不改 `scripts/test.sh` 的既有语义（除非根因确在 runner，且单独说明）。

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
