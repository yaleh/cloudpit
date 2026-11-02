---
id: gap-routine-architecture-analysis-god-package-src-cockpit
title: "architecture-analysis: Fresh archguard reading (2026-11-02, scope src
  93e0a992) flags modules/cockpit on all four god-package thresholds — fanIn 19,
  fanOut 363 relations, 41 files,"
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
Fresh archguard reading (2026-11-02, scope src 93e0a992) flags modules/cockpit on all four god-package thresholds — fanIn 19, fanOut 363 relations, 41 files, 96 entities — while three of its files are already oversize-ratchet pins (CockpitPage.tsx 1900 lines, cockpitCardController.ts 1797 baseline, CockpitCard.tsx 983), i.e. card UI, card state machine, column/stage shell, overlay/routing and 8 hooks all share one package.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622946064` · ts `2026-11-02T12:35:46.064Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`CockpitPage`、`CockpitCard`、`cockpitCardController`、`cockpitRouting`、`useCockpitCards`
- 涉及文件：
- `src/modules/cockpit/CockpitPage.tsx:1`
- `src/modules/cockpit/cockpitCardController.ts:1`
- `src/modules/cockpit/CockpitCardList.tsx:1`
- `src/modules/cockpit/cockpitRouting.ts:1`
- `src/modules/cockpit/hooks/useCockpitCards.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split into cockpit/cards (card components + controller + confirm/dismiss), cockpit/workspace (page/column/stage/overlay/routing) and keep cockpit/hooks; AC: a re-run archguard_detect_god_packages reports each resulting package below minFiles 20 / minEntities 50 with total fan-out not above 363, the three oversize-file pins move with their files, the committed cockpit↔hooks cycle pin is re-read rather than dropped, and the cockpit scenario/e2e criteria stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:35:46.064Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-src-cockpit`（routine `architecture-analysis`，runId `architecture-analysis-1793622946064`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/cockpit/CockpitPage.tsx`
- `src/modules/cockpit/cockpitCardController.ts`
- `src/modules/cockpit/CockpitCardList.tsx`
- `src/modules/cockpit/cockpitRouting.ts`
- `src/modules/cockpit/hooks/useCockpitCards.ts`
- `tasks/gap-routine-architecture-analysis-god-package-src-cockpit.md`