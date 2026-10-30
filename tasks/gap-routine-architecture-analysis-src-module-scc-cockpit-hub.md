---
id: gap-routine-architecture-analysis-src-module-scc-cockpit-hub
title: "architecture-analysis: At module granularity
  src/modules/{chat,cockpit,project-workspace,quay,sidebar,ui-scenario} form ONE
  6-member SCC over 14 cross-module edges (cockpit alone h"
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
- [x] `.quay/routine-findings.jsonl` 中 finding `src-module-scc-cockpit-hub`（routine `architecture-analysis`，runId `architecture-analysis-1793381097836`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## 处置（2026-10-31，派发链执行）

复核（读数，不是转抄）：用 `server/shared/import-graph.ts` 的同一走查 / 解析器 / Tarjan（`strongComponents`）在合并树上对 `src/` 做模块粒度读数（节点 = `modules/<name>`，边 = 任一跨模块 import）。读数：28 个模块节点、52 条跨模块 import 对，唯一的非平凡模块 SCC 是 `{chat, cockpit, project-workspace, sidebar}` 4 员。finding 的 6 员含 quay / ui-scenario，经复核不成立：quay 不在该 SCC 内、ui-scenario 只有出边（不是环成员）；finding 的 14 条边是 ArchGuard 的计数口径，与本仓解析器不同。结论：问题真实存在（模块环 4 员、cockpit 是 hub），但成员与边数要按本仓扫描器重测。

处置（按 requested action 的真意：让叶子契约在模块粒度上真正独立）：
- 环的根因是**粒度**：`src/modules/cockpit/contract` 虽然已是 leaf contract（只依赖 React 与 `@/shared`），但在模块粒度下仍被折叠进 `modules/cockpit`，所以 chat / sidebar / ui-scenario 指向契约的 import 仍是一条“指回 cockpit”的边，四个模块被钉在同一个 SCC。
- 把该叶子契约整体（无行为改动）搬到顶层 `src/modules/cockpit-contract/`，并全量更新 import（chat / sidebar / ui-scenario / cockpit 内部 / 测试）与 `.oxlintrc.json` 的 `frontend-leaf-contract` 元素及边界提示。于是这三条指回边变成指向一个无出边的叶子模块。
- 结果：模块 SCC 从 4 员降到 **exactly `{cockpit, project-workspace}` 2 员**，满足任务 AC 的 “at most 2 members”。`cockpitColumnController` / `cockpitCardController` 只被 cockpit 内部消费，不产生跨模块边，因此不搬（搬动不改变读数、只会扩大 diff）——这是对 requested action 中该项的有意取舍，理由可核。
- 判据钉进既有 `server/shared/tests/frontend-import-cycle-budget.test.ts`：同一文件、同一 `strongComponents`，不新建 server 测试文件（避免 quay pin / 时长基线红灯）；同一组 `moduleSccGroups` 在测试常量与已提交 JSON 两处钉死，只许缩。
- 判据自证可分辨：planted 两模块环必须红；两个模块 import 同一个叶子不红；“叶子反向 import 模块”的孪生必须红；真实树必须与 2 员 pin 完全相等；另有模块节点 / 跨模块边下限防止空扫描被读成绿；并断言 `modules/cockpit-contract` 没有出边（叶子守卫，防止契约又被拉回环里）。

实跑读数（本 worktree）：
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/frontend-import-cycle-budget.test.ts` → tests 6 / pass 6 / fail 0（5 组目录 pin 仍绿 + 2 员模块 pin 绿）。
- `architecture-ratchet.test.ts` 同命令 → 6/6；`quay-test-script.test.ts` → 14/14。
- `npx vitest run src/modules/cockpit/tests/cockpitColumnController.test.ts src/modules/sidebar/tests/SidebarModeSwitch.test.tsx` → 26/26。
- `npx tsc --noEmit -p tsconfig.json` 与 `npx tsc --noEmit -p server/tsconfig.json` → 均 exit 0；`npx oxlint <changed src files>` → exit 0（仅既有 warning）。

- L_G archguard: module_scc_groups=1 module_scc_max_members=2 module_nodes=29 cross_module_edges=53

该读数与本任务改动是同一张图：修复前模块 SCC 4 员、跨模块 52 对；修复后模块 SCC 2 员、跨模块 53 对（契约成为独立叶模块，cockpit 内部多出一条指向它的边）。失败在哪一步可核：任何让模块 SCC 回到 >2 员、或让 `modules/cockpit-contract` 出现出边的 import，都会在 `frontend-import-cycle-budget.test.ts` 的 `assertModuleSccBudget` / 叶子断言处红，消息要求“只许缩、不许加模块”。

## Touches
- `.oxlintrc.json`
- `server/shared/tests/frontend-import-cycle-budget.test.ts`
- `server/shared/tests/frontend-import-cycle-budget.baseline.json`
- `src/modules/chat/outline/InputOutlineDrawer.tsx`
- `src/modules/cockpit-contract/cardReading.ts`
- `src/modules/cockpit-contract/columnVisibility.ts`
- `src/modules/cockpit-contract/index.ts`
- `src/modules/cockpit-contract/observationPin.tsx`
- `src/modules/cockpit-contract/observationUri.ts`
- `src/modules/cockpit-contract/viewAddress.ts`
- `src/modules/cockpit/CockpitCardDetails.tsx`
- `src/modules/cockpit/CockpitColumn.tsx`
- `src/modules/cockpit/ObservationTile.tsx`
- `src/modules/cockpit/cockpitCardController.ts`
- `src/modules/cockpit/cockpitCardDerived.ts`
- `src/modules/cockpit/cockpitEntry.ts`
- `src/modules/cockpit/cockpitView.ts`
- `src/modules/cockpit/hooks/useCockpitCards.ts`
- `src/modules/cockpit/hooks/useObservationWall.ts`
- `src/modules/cockpit/observationUri.ts`
- `src/modules/cockpit/tests/cockpitColumnController.test.ts`
- `src/modules/sidebar/SidebarModeSwitch.tsx`
- `src/modules/sidebar/SidebarProjectActionsMenu.tsx`
- `src/modules/sidebar/SidebarSessionItem.tsx`
- `src/modules/sidebar/tests/SidebarModeSwitch.test.tsx`
- `src/modules/ui-scenario/cockpitCardsSurface.ts`
- `tasks/gap-routine-architecture-analysis-src-module-scc-cockpit-hub.md`