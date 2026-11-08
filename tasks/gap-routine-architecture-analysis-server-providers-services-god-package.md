---
id: gap-routine-architecture-analysis-server-providers-services-god-package
title: "architecture-analysis: archguard 2026-11-08 (scope server):
  modules/providers/services = 24 files / 54 entities, fanIn 29 / fanOut 218 —
  violates all four thresholds; already repor"
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
archguard 2026-11-08 (scope server): modules/providers/services = 24 files / 54 entities, fanIn 29 / fanOut 218 — violates all four thresholds; already reported 2026-11-06 (god-package-server-providers-services) but no task exists, so the reading still stands unfiled.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794141478281` · ts `2026-11-08T12:37:58.281Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createProviderRuntimeService`、`sessionsService`、`sessionConversationsSearchService`、`createClaudeTaskReducer`
- 涉及文件：
- `server/modules/providers/services/provider-runtime.service.ts:633`
- `server/modules/providers/services/sessions.service.ts:391`
- `server/modules/providers/services/session-conversations-search.service.ts:1186`
- `server/modules/providers/services/claude-activity-task-reducer.service.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Extract providers/services/{runtime,sessions,search,claude-activity} subpackages behind barrels; AC: fileCount<20 and entityCount<50, no new directory SCC, provider suites and typecheck stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T12:37:58.281Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `server-providers-services-god-package`（routine `architecture-analysis`，runId `architecture-analysis-1794141478281`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/providers/services/provider-runtime.service.ts`
- `server/modules/providers/services/sessions.service.ts`
- `server/modules/providers/services/session-conversations-search.service.ts`
- `server/modules/providers/services/claude-activity-task-reducer.service.ts`
- `tasks/gap-routine-architecture-analysis-server-providers-services-god-package.md`