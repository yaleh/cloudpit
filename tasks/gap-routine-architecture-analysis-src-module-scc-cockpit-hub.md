---
id: gap-routine-architecture-analysis-src-module-scc-cockpit-hub
title: "architecture-analysis: At module granularity
  src/modules/{chat,cockpit,project-workspace,quay,sidebar,ui-scenario} form ONE
  6-member SCC over 14 cross-module edges (cockpit alone h"
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
At module granularity src/modules/{chat,cockpit,project-workspace,quay,sidebar,ui-scenario} form ONE 6-member SCC over 14 cross-module edges (cockpit alone has 4 out-edges and 4 in-edges); cockpit is the hub, so every change to it can ripple across the whole workspace/substrate shell.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793381097836` · ts `2026-10-30T17:24:57.836Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`CockpitCardList`、`SidebarModeSwitch`、`ProjectWorkspaceShell`、`SessionPulsePopover`、`useCockpitCards`
- 涉及文件：
- `src/modules/cockpit/CockpitCardList.tsx:26`
- `src/modules/project-workspace/ProjectWorkspaceShell.tsx:9`
- `src/modules/sidebar/SidebarModeSwitch.tsx:13`
- `src/modules/sidebar/SidebarProjectActionsMenu.tsx:9`
- `src/modules/quay/SessionPulsePopover.tsx:17`
- kind：`dependency-cycle`
- verdict：`confirmed`

## Requested action
Extract the cross-module surface (src/modules/cockpit/contract, cockpitColumnController/cockpitCardController) into a leaf contract module that sidebar/project-workspace/quay import instead of '@modules/cockpit/index'; AC: the module-level SCC drops to at most 2 members in the same scanner.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T17:24:57.836Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `src-module-scc-cockpit-hub`（routine `architecture-analysis`，runId `architecture-analysis-1793381097836`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/cockpit/CockpitCardList.tsx`
- `src/modules/project-workspace/ProjectWorkspaceShell.tsx`
- `src/modules/sidebar/SidebarModeSwitch.tsx`
- `src/modules/sidebar/SidebarProjectActionsMenu.tsx`
- `src/modules/quay/SessionPulsePopover.tsx`
- `tasks/gap-routine-architecture-analysis-src-module-scc-cockpit-hub.md`