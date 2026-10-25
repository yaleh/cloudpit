---
id: gap-quay-fleet-locator-barrel-export
title: Quay：locateQuayFleetCli 经 barrel 导出，删除 server/index.ts 的组合根深导入
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关已完成任务：`gap-quay-event-driven-refresh-capability-probe-and-dispatch-reading`（引入 `quay-fleet-locator.ts` 的机制所在）已 done。本任务机制不同：只改「组合根从哪里导入 `locateQuayFleetCli`」，不改定位逻辑。

`server/index.ts:105` 深导入 `./modules/quay/quay-fleet-locator.js` 的 `locateQuayFleetCli`，绕过 `server/modules/quay/index.ts` barrel，违反后端模块标准「只经 index.ts、绝不深导入内部文件」。同一符号在 quay 模块内部已有五个消费者（`quay-fleet-project-id.ts`、`quay-fleet-registry.ts`、`quay-initiatives.ts`、`quay-uri-resolve.ts`、`quay.service.ts`），barrel 却未导出。修法：在 `server/modules/quay/index.ts` 增加 `export { locateQuayFleetCli } from './quay-fleet-locator.js';` 并带 consumer 注释，把 `server/index.ts` 的导入改为走 barrel；其余代码不动。

## AC

- [x] barrel 导出：`grep -n "locateQuayFleetCli" server/modules/quay/index.ts` 命中一条 `export { locateQuayFleetCli } from './quay-fleet-locator.js';`，且该行上方有 consumer 注释。
- [x] 深导入移除：`grep -n "modules/quay/quay-fleet-locator" server/index.ts` 无输出；`grep -n "locateQuayFleetCli" server/index.ts` 命中的导入来自 `./modules/quay/index.js`。
- [x] 无其它跨模块深导入：`grep -rn "modules/quay/quay-fleet-locator" server/ --include='*.ts' | grep -v 'server/modules/quay/'` 无输出。
- [x] 类型检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0。

## DoD

用构建产物证明组合根仍能经 barrel 解析 fleet 二进制：`npm run build:server` exit 0（真实构建证明 barrel 导入成立）；`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/shared/tests/server-import-cycle-budget.test.ts` exit 0（导入图预算不回归）。贴出两处 diff 与两个命令输出。

## Evidence

### diff 1 — `server/index.ts`

```diff
@@ -56,7 +56,11 @@ import {
     validateApiKey,
 } from './modules/auth/index.js';
 import { taskmasterRoutes } from './modules/taskmaster/index.js';
-import { quayFleetRegistry, quayRoutes, quayService } from './modules/quay/index.js';
+// The ONE quay-fleet binary locator (QUAY_FLEET_BIN → PATH → ~/.quay-fleet/bin). The liaison
+// module must not grow a second lookup order, so the composition root injects this one.
+// Reached through the module's barrel, never one of its internal files — that deep path is
+// how the module's own consumers reach it, and it is not part of the public API.
+import { locateQuayFleetCli, quayFleetRegistry, quayRoutes, quayService } from './modules/quay/index.js';
@@ -100,9 +104,6 @@ import { assetsRoutes } from './modules/assets/index.js';
 import { createLiaisonModule, createFileLiaisonStore, createQuayFleetRunner } from './modules/liaison/index.js';
-// The ONE quay-fleet binary locator (QUAY_FLEET_BIN → PATH → ~/.quay-fleet/bin). The liaison
-// module must not grow a second lookup order, so the composition root injects this one.
-import { locateQuayFleetCli } from './modules/quay/quay-fleet-locator.js';
 import { createReplySuggestionsModule, setReplySuggestionsUsageObserver } from './modules/reply-suggestions/index.js';
```

### diff 2 — `server/modules/quay/index.ts`

```diff
@@ -22,6 +22,12 @@ export {
   quayService,
   quayTaskEvents,
 } from './quay.module.js';
+// The fleet binary locator: the composition root (`server/index.ts`) injects this ONE lookup
+// (QUAY_FLEET_BIN → PATH → ~/.quay-fleet/bin) into the liaison module rather than letting it
+// grow a second order; the five in-module consumers (registry, project-id, initiatives,
+// uri-resolve, service) keep reaching the deep path, which stays module-private. Exported here
+// because cross-module access goes through the module's index, never an internal file.
+export { locateQuayFleetCli } from './quay-fleet-locator.js';
```

### command 1 — `npm run build:server`

```
> tsc -p server/tsconfig.json && tsc-alias -p server/tsconfig.json && node scripts/write-build-info.mjs
write-build-info: wrote dist-server.next/build-info.json
build exit=0
```

Built output confirms the composition root resolves through the barrel: `dist-server/server/index.js:34`
`import { locateQuayFleetCli, quayFleetRegistry, quayRoutes, quayService } from './modules/quay/index.js';`
and `dist-server/server/modules/quay/index.js:22` `export { locateQuayFleetCli } from './quay-fleet-locator.js';`.

### command 2 — import-cycle budget test

```
✔ (a)(h) the scanner walks the real server tree, prints its summary line, and finishes inside the budget
✔ (b) every non-trivial SCC is contained in one baseline group — static-only and static+dynamic agree on the groups
✔ (c) the directory manifest is committed, cannot be raised, and any directory outside it is a leaf
✔ (e) the non-literal dynamic import and unresolved-internal budgets hold
✔ (f) the resolved file-level edge count is far above the floor — the walk cannot be vacuously green
ℹ tests 11
ℹ pass 11
ℹ fail 0
test exit=0
```

## Touches

- server/modules/quay/index.ts
- server/index.ts
- server/shared/tests/server-import-cycle-budget.test.ts
- tasks/gap-quay-fleet-locator-barrel-export.md

## Blocker

**2026-10-25T17:28:29.059Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：439a4746-ebe1-4a45-aa08-f80c4576dc92

## Needs-Human

**执行 2026-10-25T19:28:54.903Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：b97c8547-38e1-475a-89fe-43edf816cf8b
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-quay-fleet-locator-barrel-export~wk-prod-anchor~1792954794354-f9ac61.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-quay-fleet-locator-barrel-export-wk-prod-anchor.log

## Needs-Human

**执行 2026-10-25T22:31:40.528Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 3 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：81e35505-6c0f-4a4e-91d2-f0d00e1ef972
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-quay-fleet-locator-barrel-export~wk-prod-anchor~1792967166353-0b6a2d.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-quay-fleet-locator-barrel-export-wk-prod-anchor.log
