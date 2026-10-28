---
id: gap-routine-architecture-analysis-dup-observation-refreshall
title: "architecture-analysis: The same `refreshAll` method (accumulate non-null
  ObservedObject results over a target list) is implemented twice in two sibling
  producers of the same packag"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
The same `refreshAll` method (accumulate non-null ObservedObject results over a target list) is implemented twice in two sibling producers of the same package — identical modulo the loop variable name.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793208251918` · ts `2026-10-28T17:24:11.918Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`refreshAll`、`refreshProject`
- 涉及文件：
- `server/modules/observation/architecture-delta.producer.ts:216`
- `server/modules/observation/project-truth.producer.ts:311`
- kind：`duplicate`
- verdict：`confirmed`

## Requested action
Extract a `refreshAllOf(refreshOne, targets)` helper in the observation package (or a shared producer base) and have both producers delegate; AC: the duplicate group disappears from `archguard_detect_duplicates(scope=server)`.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T17:24:11.918Z

## 处置结论
已修复。逐目标串行收集循环抽到 `server/modules/observation/producer-batch.ts` 的 `refreshAllOf(refreshOne, targets)`，两个 producer 的 `refreshAll` 都改为委托它；行为不变（串行执行、跳过 `null` 读数）。

复核读数（`archguard_detect_duplicates(scope=server)`，默认门限 minStatements=6 / minTokens=50）：
- 修复前（develop 代码，main checkout 现有索引）：`totalGroups=5`，含 hash `3995ccc00c4cafbe`，members = `architecture-delta.producer.ts:216 refreshAll` + `project-truth.producer.ts:311 refreshAll`。
- 修复后（本任务 worktree，`archguard analyze` 重建 `server` scope）：`totalGroups=4`，`3995ccc00c4cafbe` 组消失，`refreshAll` 不再出现在任何重复组。
- 回归：`architecture-delta.test.ts` 7/7 通过，`project-truth.test.ts` 10/10 通过，`tsc --noEmit -p server/tsconfig.json` 通过。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-observation-refreshall`（routine `architecture-analysis`，runId `architecture-analysis-1793208251918`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## ADR-007 暗轴
该轴仍暗,理由:本任务只在 observation 包内抽取一个既有循环并让两个 producer 委托,未新增或删除依赖边/目标读数,暗轴无可采读数

## Touches
- `server/modules/observation/architecture-delta.producer.ts`
- `server/modules/observation/project-truth.producer.ts`
- `server/modules/observation/producer-batch.ts`
- `tasks/gap-routine-architecture-analysis-dup-observation-refreshall.md`