---
id: gap-routine-architecture-analysis-cycle-src-cockpit-quay-sidebar-ui-scenario
title: "architecture-analysis: 5-package SCC (cockpit, cockpit/hooks, quay,
  sidebar, ui-scenario) closed by 13 cross-package import sites: sidebar imports
  the cockpit barrel for WatchPinTo"
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

## 处置结论
复核结论：**修掉**（不是「已注意到」）。

- 复现：`archguard_analyze(projectRoot=<task worktree>, sources:["src"], lang:"typescript")`（scope `72c33d5d`）+ `archguard_detect_cycles(outputScope:"package")` 复现原 SCC —— `modules/cockpit`、`modules/cockpit/hooks`、`modules/quay`、`modules/sidebar`、`modules/ui-scenario` 同属一个强连通分量。
- 处置：新增叶子契约 `src/modules/cockpit/contract/`（`viewAddress.ts`、`observationUri.ts`、`observationPin.tsx`、`cardReading.ts`、`columnVisibility.ts`，`index.ts` 是唯一入口），只依赖 react 与 `@/shared`；sidebar 的 `SidebarModeSwitch` / `SidebarProjectItem` / `SidebarProjectActionsMenu` / `SidebarSessionItem` 与 ui-scenario 的 `cockpitCardsSurface` 改从 `@/modules/cockpit/contract` 取；cockpit 内部在 `cockpitView.ts` / `observationUri.ts` / `ObservationTile.tsx` / `useObservationWall.ts` / `cockpitCardController.ts` 保留 re-export 兼容路径，实现只有一份。
- 侧栏只要「列是否占屏」两个字段：`CockpitColumnVisibilityContext` 由 `CockpitColumnBoundary` 用同一 snapshot 只喂 `{layout, expanded}`，不把整套 column binding / cockpit hooks 拖进契约。
- 守卫：`.oxlintrc.json` 新增 `frontend-leaf-contract` 元素与两条 `boundaries/dependencies` 规则 —— 契约只能经 `src/modules/cockpit/contract/index.ts` 进入，深路径 import 报红。

## 复核读数
- L_G archguard: packageCycles=6; maxScc=5; cockpitSidebarComponents=0
  - 修复前：同一条命令给出 1 个 SCC，同时含 `modules/cockpit` 与 `modules/sidebar`（5 包、46 条包边）
  - 修复后：6 个环分别为 settings(5)、shared(4)、chat/tools(3)、git-panel(3)、architecture(2)、cockpit↔cockpit/hooks(2)，没有任何分量同时包含 `modules/cockpit` 与 `modules/sidebar`；sidebar / ui-scenario 指向 cockpit 的跨包边全部落在 `modules/cockpit/contract`
- 门读数：`npx tsc --noEmit -p tsconfig.json` exit 0；`npx oxlint src/ server/ scripts/ shared/` exit 0（仅 warning）；相关 vitest 57+27+67 全绿；`server/shared/tests/architecture-ratchet.test.ts` 6/6

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `cycle-src-cockpit-quay-sidebar-ui-scenario`（routine `architecture-analysis`，runId `architecture-analysis-1793090640570`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/cockpit/CockpitPage.tsx`
- `src/modules/cockpit/CockpitStage.tsx`
- `src/modules/quay/QuayPanel.tsx`
- `src/modules/sidebar/SidebarModeSwitch.tsx`
- `src/modules/sidebar/SidebarProjectItem.tsx`
- `src/modules/ui-scenario/cockpitCardsSurface.ts`
- `tasks/gap-routine-architecture-analysis-cycle-src-cockpit-quay-sidebar-ui-scenario.md`
- `.oxlintrc.json`
- `src/modules/cockpit/CockpitColumn.tsx`
- `src/modules/cockpit/ObservationTile.tsx`
- `src/modules/cockpit/cockpitCardController.ts`
- `src/modules/cockpit/cockpitView.ts`
- `src/modules/cockpit/hooks/useObservationWall.ts`
- `src/modules/cockpit/observationUri.ts`
- `src/modules/sidebar/SidebarProjectActionsMenu.tsx`
- `src/modules/sidebar/SidebarSessionItem.tsx`
- `src/modules/cockpit/contract/index.ts` (new)
- `src/modules/cockpit/contract/viewAddress.ts` (new)
- `src/modules/cockpit/contract/observationUri.ts` (new)
- `src/modules/cockpit/contract/observationPin.tsx` (new)
- `src/modules/cockpit/contract/cardReading.ts` (new)
- `src/modules/cockpit/contract/columnVisibility.ts` (new)