---
id: gap-routine-architecture-analysis-cycle-src-cockpit-quay-sidebar-ui-scenario
title: "architecture-analysis: 5-package SCC (cockpit, cockpit/hooks, quay,
  sidebar, ui-scenario) closed by 13 cross-package import sites: sidebar imports
  the cockpit barrel for WatchPinTo"
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
5-package SCC (cockpit, cockpit/hooks, quay, sidebar, ui-scenario) closed by 13 cross-package import sites: sidebar imports the cockpit barrel for WatchPinToggle/cockpitViewPath/formatProjectUri, cockpit imports sidebar+quay, quay dynamically imports ui-scenario, ui-scenario imports cockpit types.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793090640570` · ts `2026-10-27T08:44:00.570Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`CockpitPage`、`QuayPanel`、`SidebarModeSwitch`、`SidebarProjectItem`、`publishScenarioViewContract`、`useInitiatives`
- 涉及文件：
- `src/modules/cockpit/CockpitPage.tsx:17`
- `src/modules/cockpit/CockpitStage.tsx:6`
- `src/modules/quay/QuayPanel.tsx:594`
- `src/modules/sidebar/SidebarModeSwitch.tsx:13`
- `src/modules/sidebar/SidebarProjectItem.tsx:10`
- `src/modules/ui-scenario/cockpitCardsSurface.ts:28`
- kind：`dependency-cycle`
- verdict：`confirmed`

## Requested action
Extract cockpitViewPath/formatProjectUri/WatchPinToggle and the CockpitCardReading type into a leaf contract module (src/modules/cockpit/contract/) that quay, sidebar and ui-scenario import, so nothing imports the cockpit barrel back; AC: archguard_detect_cycles(outputScope=package) on src lists no component containing both modules/cockpit and modules/sidebar.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-27T08:44:00.570Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `cycle-src-cockpit-quay-sidebar-ui-scenario`（routine `architecture-analysis`，runId `architecture-analysis-1793090640570`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/cockpit/CockpitPage.tsx`
- `src/modules/cockpit/CockpitStage.tsx`
- `src/modules/quay/QuayPanel.tsx`
- `src/modules/sidebar/SidebarModeSwitch.tsx`
- `src/modules/sidebar/SidebarProjectItem.tsx`
- `src/modules/ui-scenario/cockpitCardsSurface.ts`
- `tasks/gap-routine-architecture-analysis-cycle-src-cockpit-quay-sidebar-ui-scenario.md`