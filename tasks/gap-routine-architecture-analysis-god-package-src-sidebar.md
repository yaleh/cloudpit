---
id: gap-routine-architecture-analysis-god-package-src-sidebar
title: "architecture-analysis: archguard flags modules/sidebar at 25 files (>=
  minFiles 20) / 24 entities with fanOut 133; the 1343-line useSidebarController
  hook is the concrete reducible"
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
archguard flags modules/sidebar at 25 files (>= minFiles 20) / 24 entities with fanOut 133; the 1343-line useSidebarController hook is the concrete reducible arm, while fanOut is a relation count a split cannot lower.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793795809080` · ts `2026-11-04T12:36:49.080Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`useSidebarController`、`SidebarContent`、`SidebarProjectItem`
- 涉及文件：
- `src/modules/sidebar/hooks/useSidebarController.ts:97`
- `src/modules/sidebar/SidebarContent.tsx:1`
- `src/modules/sidebar/SidebarProjectItem.tsx:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Decompose useSidebarController into session/project/dialog concern hooks behind a composed facade; AC: useSidebarController.ts<=600 lines, fileCount unchanged-or-lower with fanOut recorded as residual, sidebar and chat-composer tests green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T12:36:49.080Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-src-sidebar`（routine `architecture-analysis`，runId `architecture-analysis-1793795809080`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/sidebar/hooks/useSidebarController.ts`
- `src/modules/sidebar/SidebarContent.tsx`
- `src/modules/sidebar/SidebarProjectItem.tsx`
- `tasks/gap-routine-architecture-analysis-god-package-src-sidebar.md`