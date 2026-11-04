---
id: gap-routine-architecture-analysis-god-package-src-architecture
title: "architecture-analysis: archguard scope src: modules/architecture = 61
  files / 252 entities (fresh CLI package-stats), fanIn 1 / fanOut 564
  instrument relation count — the largest f"
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
archguard scope src: modules/architecture = 61 files / 252 entities (fresh CLI package-stats), fanIn 1 / fanOut 564 instrument relation count — the largest frontend package, with ArchitecturePanel.tsx at 4685 lines and PlantUmlGraph.tsx at 4040 lines still unreduced after the earlier file-level R1 extraction.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793795809080` · ts `2026-11-04T12:36:49.080Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`ArchitecturePanel`、`PlantUmlGraph`、`semanticZoomLayout`、`graphDom`
- 涉及文件：
- `src/modules/architecture/ArchitecturePanel.tsx:368`
- `src/modules/architecture/PlantUmlGraph.tsx:880`
- `src/modules/architecture/semanticZoomLayout.ts:1`
- `src/modules/architecture/graphDom.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split the package into render/, layout/ and dom/ leaf subdirectories inside modules/architecture with the barrel re-exports unchanged; AC: archguard_detect_god_packages(scope=src) fileCount<=30 and entityCount<=120, both panel files <=2000 lines, frontend-import-cycle-budget.test.ts five pinned groups unchanged-or-smaller.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T12:36:49.080Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-src-architecture`（routine `architecture-analysis`，runId `architecture-analysis-1793795809080`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/architecture/ArchitecturePanel.tsx`
- `src/modules/architecture/PlantUmlGraph.tsx`
- `src/modules/architecture/semanticZoomLayout.ts`
- `src/modules/architecture/graphDom.ts`
- `tasks/gap-routine-architecture-analysis-god-package-src-architecture.md`