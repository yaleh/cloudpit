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

## Touches

- server/modules/quay/index.ts
- server/index.ts
- server/shared/tests/server-import-cycle-budget.test.ts
- tasks/gap-quay-fleet-locator-barrel-export.md