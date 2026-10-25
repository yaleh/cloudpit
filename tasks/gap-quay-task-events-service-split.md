---
id: gap-quay-task-events-service-split
title: Quay：把 quay-task-events.service.ts（829 行）拆成 parse/cursor-store/service 三个文件
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关已完成任务：`gap-quay-event-driven-refresh-capability-probe-and-dispatch-reading`（引入 `quay-task-events.service.ts` 的机制所在）已 done。本任务只拆该 service，不改事件刷新的语义。

`server/modules/quay/quay-task-events.service.ts` 现为 829 行，把「task log 行解析」（`readTaskLogCursor`/`readTaskLogPage`，纯函数）、「游标持久化与去重状态」（`CursorSeed`、`monitor.seed`）、「`fs.watch` 监控循环 + 定时器编排」（`createQuayTaskEvents`）混在一个文件里。按 reply-suggestions 分层纪律切为三个文件：`quay-task-log-parse.ts`（纯解析，无 I/O）、`quay-task-log-cursor-store.ts`（游标 seed 读写，注入 fs/clock）、`quay-task-events.service.ts`（watch 循环 + 定时器，编排前两者）。`createQuayTaskEvents` 的公开签名不变，barrel 仍只暴露组装后的 `quayTaskEvents`。

## AC

- [x] 切分落地：`ls server/modules/quay/quay-task-log-parse.ts server/modules/quay/quay-task-log-cursor-store.ts` 两个文件都存在；`wc -l server/modules/quay/quay-task-events.service.ts server/modules/quay/quay-task-log-parse.ts server/modules/quay/quay-task-log-cursor-store.ts` 中 service ≤ 460 且其余两个各 ≤ 260。
- [x] 行为不回归：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-live-refresh.test.ts` exit 0。
- [x] 消费方不动：`git diff -U0 -- server/modules/quay/quay.module.ts server/modules/quay/index.ts` 无输出。
- [x] 类型检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/quay` exit 0。

## DoD

用真实 quay CLI 的 `task log --json` 输出驱动切分后的解析：对仓库里一个真实项目跑一次 `quay task log --json`，把 stdout 喂给 `quay-task-log-parse.ts` 的导出函数，证明 `readTaskLogPage` 返回的 `transitions`/`nextCursor` 与切分前一致；再起一个临时 `.quay` 目录验证 `createQuayTaskEvents` 在 `fs.watch` 触发下仍增量刷新（贴出触发前后 index 行数变化）。贴出两次数值的 diff 证明无回归。

## Touches

- server/modules/quay/quay-task-events.service.ts
- server/modules/quay/quay-task-log-parse.ts (new)
- server/modules/quay/quay-task-log-cursor-store.ts (new)
- server/modules/quay/tests/quay-live-refresh.test.ts
- tasks/gap-quay-task-events-service-split.md

## Blocker

**2026-10-25T19:21:06.730Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：8856f478-6a6c-43bc-b69a-95045b78eb47

## Needs-Human

**执行 2026-10-25T20:06:32.419Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：4cf4f4d5-7f18-4b00-9030-4b18cef238fb
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-quay-task-events-service-split~wk-prod-anchor~1792956251806-f38c72.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-quay-task-events-service-split-wk-prod-anchor.log
