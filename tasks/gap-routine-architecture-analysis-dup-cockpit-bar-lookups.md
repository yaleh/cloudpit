---
id: gap-routine-architecture-analysis-dup-cockpit-bar-lookups
title: "architecture-analysis: archguard_detect_duplicates(scope=src) group
  09b92d29fcda31df: 77 tokens / 8 statements / 13 lines, an identical
  document.querySelectorAll loop that differs "
status: todo
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard_detect_duplicates(scope=src) group 09b92d29fcda31df: 77 tokens / 8 statements / 13 lines, an identical document.querySelectorAll loop that differs only in the data attribute name (confirm-pending vs dismiss-pending).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793882215773` · ts `2026-11-05T12:36:55.773Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pendingBarFor`、`dismissBarFor`
- 涉及文件：
- `src/modules/ui-scenario/cockpitCardsSurface.ts:325`
- `src/modules/ui-scenario/cockpitCardsSurface.ts:448`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Parameterize the attribute into one barFor(attribute, cardId) helper and route both waiters through it; AC: group 09b92d29fcda31df is gone from archguard_detect_duplicates(scope=src) and src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts stays green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-05T12:36:55.773Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-cockpit-bar-lookups`（routine `architecture-analysis`，runId `architecture-analysis-1793882215773`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/ui-scenario/cockpitCardsSurface.ts`
- `tasks/gap-routine-architecture-analysis-dup-cockpit-bar-lookups.md`