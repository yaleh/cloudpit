---
id: gap-architecture-refresh-job-split
title: 架构：把 refreshJob.ts（931 行）按关注点切成 settings/spawn/publish/状态机四个文件
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关已完成任务：`architecture-archguard-refresh-trigger`（引入 `refreshJob.ts` 的机制所在）与 `gap-reply-suggestions-backend-encapsulation`（确立「每个关注点一个工厂文件、service 控制在约 260 行」的方法）均已 done。本任务只拆 `refreshJob.ts`，不改刷新语义。

`server/modules/architecture/refreshJob.ts` 现为 931 行，单文件承载五个关注点：`architecture.refresh` 设置块读取与 mtime 重读、single-flight/coalescing、`spawn`+`systemd-run` 内存上限、staged rename 原子发布、job 状态机与 shutdown hook。按 reply-suggestions 分层纪律切为四个文件：`refresh-settings.ts`（设置读 + mtime 重读）、`refresh-spawn.ts`（spawn + systemd-run）、`refresh-publish.ts`（原子发布）、`refreshJob.ts`（single-flight 状态机编排三者）。每个新文件用 `createX(deps): X` 工厂返回类型化对象并注入 seam（fs/spawn/clock），`createArchguardRefreshJob` 的签名与 `routes.ts`/`module.ts` 消费方式保持不变。

## AC

- [x] 切分落地：`ls server/modules/architecture/refresh-settings.ts server/modules/architecture/refresh-spawn.ts server/modules/architecture/refresh-publish.ts` 三个文件都存在；`wc -l server/modules/architecture/refreshJob.ts server/modules/architecture/refresh-settings.ts server/modules/architecture/refresh-spawn.ts server/modules/architecture/refresh-publish.ts` 中 refreshJob.ts ≤ 420 且其余三个各 ≤ 300。
- [x] 行为不回归：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/architecture/tests/refreshJob.test.ts server/modules/architecture/tests/refreshRoutes.test.ts` exit 0。
- [x] 消费方不动：`git diff -U0 -- server/modules/architecture/routes.ts server/modules/architecture/module.ts` 无输出。
- [x] 类型检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/architecture` exit 0。

## DoD

用真实 ArchGuard CLI 触发一次手动刷新并贴出证据：`POST /api/architecture/refresh` 启动 job，轮询 `GET /api/architecture/refresh/status` 直到 `succeeded`，`.archguard/query` 的 mtime 更新；失败回滚路径由 `refreshJob.test.ts` 覆盖（贴出对应用例名与运行输出）。贴出 job 日志与两次 status 读数。

## Touches

- server/modules/architecture/refreshJob.ts
- server/modules/architecture/refresh-settings.ts (new)
- server/modules/architecture/refresh-spawn.ts (new)
- server/modules/architecture/refresh-publish.ts (new)
- server/modules/architecture/tests/refreshJob.test.ts
- tasks/gap-architecture-refresh-job-split.md

## Blocker

**2026-10-25T18:50:13.340Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：d7f03c32-455d-419b-a386-ea9ddc81ce1e
