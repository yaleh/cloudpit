---
id: gap-routine-architecture-analysis-server-shared-god-package
title: "architecture-analysis: archguard 2026-11-08 (scope server, fresh at HEAD
  b5cf28d): server/shared = 18 files / 12,388 LOC / 149 entities, fanIn 1,846
  relations / fanOut 99 — over to"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard 2026-11-08 (scope server, fresh at HEAD b5cf28d): server/shared = 18 files / 12,388 LOC / 149 entities, fanIn 1,846 relations / fanOut 99 — over tooManyEntities (149>=50); types.ts alone is 5,693 lines and utils.ts 1,930; no prior god-package task or routine finding covers server/shared.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794141478281` · ts `2026-11-08T12:37:58.281Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`residentRunIsTurn`、`createApiSuccessResponse`、`asyncHandler`、`bearerToken`、`IProviderRuntime`
- 涉及文件：
- `server/shared/types.ts:29`
- `server/shared/utils.ts:79`
- `server/shared/interfaces.ts:44`
- `server/shared/index.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split server/shared/types.ts and utils.ts by domain into server/shared/types/* and server/shared/<domain>/* subpackages behind barrels, then lower the oversize ratchet baseline for types.ts/utils.ts in the same commit; AC: detect_god_packages(scope=server) no longer lists shared for tooManyEntities, no new directory SCC, server typecheck + tests green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T12:37:58.281Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `server-shared-god-package`（routine `architecture-analysis`，runId `architecture-analysis-1794141478281`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/shared/attachments/image-attachments.ts`
- `server/shared/bounded-approval-ledger.ts`
- `server/shared/claude-cli-path.ts`
- `server/shared/data-root-migration.ts`
- `server/shared/data-root.ts`
- `server/shared/data/claude-cli-path.ts`
- `server/shared/data/data-root-migration.ts`
- `server/shared/data/data-root.ts`
- `server/shared/data/fs-bytes.ts`
- `server/shared/frontmatter.ts`
- `server/shared/fs-bytes.ts`
- `server/shared/image-attachments.ts`
- `server/shared/import-graph.ts`
- `server/shared/imports/import-graph.ts`
- `server/shared/interfaces.ts`
- `server/shared/knowledge-facts.ts`
- `server/shared/knowledge/knowledge-facts.ts`
- `server/shared/message-unification.ts`
- `server/shared/messages/message-unification.ts`
- `server/shared/plugin-scope.ts`
- `server/shared/settings-file.ts`
- `server/shared/settings/bounded-approval-ledger.ts`
- `server/shared/settings/plugin-scope.ts`
- `server/shared/settings/settings-file.ts`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `server/shared/tests/cloudpit-goal-exit-gate.baseline.json`
- `server/shared/tests/cloudpit-goal-exit-gate.test.ts`
- `server/shared/tests/server-import-cycle-budget.baseline.json`
- `server/shared/tests/server-import-cycle-budget.test.ts`
- `server/shared/transcript-activity.ts`
- `server/shared/transcript/frontmatter.ts`
- `server/shared/transcript/transcript-activity.ts`
- `server/shared/types.ts`
- `server/shared/types/architecture.ts`
- `server/shared/types/claude-events.ts`
- `server/shared/types/cli-session.ts`
- `server/shared/types/cockpit-brief.ts`
- `server/shared/types/cockpit-cards.ts`
- `server/shared/types/delivery.ts`
- `server/shared/types/file-tree.ts`
- `server/shared/types/index.ts`
- `server/shared/types/interfaces.ts`
- `server/shared/types/mcp-tools.ts`
- `server/shared/types/projects.ts`
- `server/shared/types/provider-contract.ts`
- `server/shared/types/provider-launch.ts`
- `server/shared/types/provider-message.ts`
- `server/shared/types/session-ask.ts`
- `server/shared/types/ui.ts`
- `server/shared/types/voice.ts`
- `server/shared/utils.ts`
- `server/shared/utils/core.ts`
- `server/shared/utils/files.ts`
- `server/shared/utils/index.ts`
- `server/shared/utils/providers.ts`
- `server/shared/utils/serialization.ts`
- `server/shared/utils/sessions/index.ts`
- `server/shared/utils/workspace.ts`
- `server/modules/cli/tests/cli-environment-bootstrap.test.ts`
- `server/modules/debug-agent/tests/debug-agent-frames.test.ts`
- `server/modules/debug-agent/tests/debug-agent-host-driver.test.ts`
- `src/shared/tests/cockpitCardTypeSync.test.ts`
- `src/shared/tests/wireContractTypeSync.test.ts`
- `tasks/gap-routine-architecture-analysis-server-shared-god-package.md`

## Disposition
**处置结论：修掉（split 落地，2026-11-08，commit db2d69704 + 后续 merge develop；客户端判据修复 commit 6ca9d2596）。**

复核（与本 finding 同一探针、同一口径）：
- 拆分前（本任务基线树，archguard server scope）：`shared` = 18 files / 149 entities / fanIn 1846 / fanOut 99，reasons 含 `tooManyEntities` —— 与 finding 逐字一致。
- 拆分后（本任务合并树）：`shared` = 18 files / **5 entities** / fanIn 1511 / fanOut 3，reasons 仅 `highFanIn`；`tooManyEntities` 与 `tooManyFiles` 均不再触发。十个新子包 entityCount 均 <50（最大 `shared/utils` 47）。
- 口径：entityCount 只数 class + exported function（archguard 0.1.45 `getPackageStats`），故 types.ts（5,693 行、仅 3 个函数）本身几乎不改实体数；149→5 的下降来自 utils.ts（56 实体）与其余实现文件搬出根目录。
- 无新目录 SCC：`server/shared/tests/server-import-cycle-budget.test.ts` 全绿（12 pass），目录图仍只有 G1 providers 三成员；新子包只向下引用（root barrel → 子包；utils→types/transcript，messages→utils/types，settings→utils，data→types），没有子包回指 `shared` 根。
- 兼容性：`types.ts`/`utils.ts`/`interfaces.ts` 及其余根文件保留为 `export *` 反向 barrel，`@/shared/types.js` 与 `@/shared/utils.js` 的既有 600+ 说明符零改动。
- oversize 棘轮同批下调：`architecture-ratchet.baseline.json` 删除 `server/shared/types.ts`(5693) 与 `server/shared/utils.ts`(1930)；搬动文件的按路径读数逐条重键（claude-cli-path 1、image-attachments 2、message-unification 2、interfaces providerNameBranches 2，读数不变）。所有新文件 <800 行、模块级可变状态为 0（根 `utils.ts` 保留原 2 个 mutable 读数与 116 行 ceiling）。
- 路径敏感判据同步：`resident-run-is-turn-single-reader.test.ts` 与 `cloudpit-goal-exit-gate.test.ts` 对 `server/shared/utils.ts` 的钉读保持成立（两个读点留在根 leaf）；`cockpitCardTypeSync.test.ts` 与 `wireContractTypeSync.test.ts`（含 `interfaces.ts` 行）改为读 `server/shared/types/` 目录（声明已搬出根 barrel）。
- 测试夹具耦合修复（第三轮，2026-11-08）：拆分把 `LLMProvider` 联合移到 `server/shared/types/provider-message.ts`、把 `data-root` 实现移入 `server/shared/data/`。两处按文件路径钉读/手工拷贝的既有判据因此在本分支变红（非 develop 既有红）——`debug-agent-frames.test.ts` 与 `debug-agent-host-driver.test.ts` 的 `TYPES_MODULE` 改读新包边界（仍逐字钉同一联合行，不变式不变）；`cli-environment-bootstrap.test.ts` 的手工模块图补拷 `server/shared/data/{data-root,data-root-migration}.ts`（子进程此前报 `Cannot find module './data/data-root.js'`）。三条测试单独复跑：3 + 5 + 2 pass / 0 fail。
- 实跑门：`tsc --noEmit` ×3 项目（root/server/scripts）→ 0；`oxlint server/` → 0 error（仅既有 warning）；`server/shared/tests/*.test.ts` → 174 pass / 0 fail（合并 providers 与 cockpit 两条已落地任务后复跑仍全绿）；`vitest run src/shared/tests/{cockpitCardTypeSync,wireContractTypeSync}.test.ts` → 8 + 5 pass / 0 fail；`scripts/asr-health-provider-check.test.mjs` → 8 pass / 0 fail；`server/modules/resident-ledger/tests/resident-ledger-leaf-module.test.ts` → 7 pass / 0 fail。
- 残余（如实记录，不声称转绿）：关系维度不能靠拆包降低 —— `shared` 根 fanIn 仍 1511、`shared/utils` fanIn 227，`detect_god_packages` 仍以 `highFanIn/highFanOut` 列出它们。本任务修的是 finding 点名的 `tooManyEntities`（顺带消除 `tooManyFiles`）；关系耦合需端口/注入式解耦，应另行立案。

ADR-007 轴读数：
- L_D: codeLines=24597, docLines=0, ratio=0.000（`phase-declare.js --ld-reading --numstat-file <git diff --numstat develop HEAD>`，verdict=PASS）
- L_G: 不可评 —— shipped `archguard-runner.js` 只评估 quay 自身六个 scope，在本消费者仓读出 NOT EVALUATED（不声称 0 cycles）；目录 SCC 读数改由上表同口径 scanner 提供（G1 不变、无新增）。

## Blocker

**2026-11-08T13:31:56.290Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/modules/debug-agent/tests/debug-agent-host-driver.test.ts:   AssertionError [ERR_ASSERTION]: the union line must be exactly the pinned line [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/modules/debug-agent/tests/debug-agent-frames.test.ts,server/modules/debug-agent/tests/debug-agent-host-driver.test.ts,server/modules/cli/tests/cli-environment-bootstrap.test.ts,server/modules/debug-agent/tests/debug-agent-frames.test.ts,server/modules/debug-agent/tests/debug-agent-host-driver.test.ts,server/modules/cli/tests/cli-environment-bootstrap.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：d063be03-8ce9-4a75-8c37-548192989fcf
- 已处置（2026-11-08 第三轮）：以上三条红均为拆分的路径/夹具耦合，检查点确认后按 Disposition 的「测试夹具耦合修复」条目改读新包边界/补拷模块图并单独复跑全绿，本任务分支上不再复现。