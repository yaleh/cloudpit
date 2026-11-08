---
id: gap-routine-architecture-analysis-server-cockpit-god-package
title: "architecture-analysis: archguard 2026-11-08 (scope server):
  modules/cockpit = 24 files / 53 entities, fanIn 12 / fanOut 242 — all four
  thresholds; re-confirmed from the 2026-11-06 "
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
archguard 2026-11-08 (scope server): modules/cockpit = 24 files / 53 entities, fanIn 12 / fanOut 242 — all four thresholds; re-confirmed from the 2026-11-06 finding (god-package-server-cockpit) and still has no covering task (only a leaf registration in the AC-394 budget).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794141478281` · ts `2026-11-08T12:37:58.281Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createCockpitBriefService`、`createCockpitCardActions`、`CockpitFleetExecutor`、`createCockpitBriefSettingsSource`
- 涉及文件：
- `server/modules/cockpit/cockpit-brief.service.ts:1`
- `server/modules/cockpit/cockpit-card-actions.ts:321`
- `server/modules/cockpit/cockpit-fleet-executor.ts:1`
- `server/modules/cockpit/cockpit-fleet-card-projection.ts:712`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split into cockpit/{brief,cards,fleet} subpackages behind barrels (brief already is 8 files, fleet 4, cards 4); AC: fileCount<20 and entityCount<50, no new SCC, cockpit HTTP/MCP tests and typecheck green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T12:37:58.281Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `server-cockpit-god-package`（routine `architecture-analysis`，runId `architecture-analysis-1794141478281`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/cockpit/cockpit-brief.service.ts`
- `server/modules/cockpit/cockpit-card-actions.ts`
- `server/modules/cockpit/cockpit-fleet-executor.ts`
- `server/modules/cockpit/cockpit-fleet-card-projection.ts`
- `tasks/gap-routine-architecture-analysis-server-cockpit-god-package.md`