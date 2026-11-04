---
id: gap-routine-architecture-analysis-god-package-src-architecture
title: "architecture-analysis: archguard scope src: modules/architecture = 61
  files / 252 entities (fresh CLI package-stats), fanIn 1 / fanOut 564
  instrument relation count — the largest f"
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

## Disposition (re-verified and split, 2026-11-04)

**复核（develop tip `f9566d20a`，archguard 0.1.44 CLI `analyze -s src --lang typescript` + 与 MCP `archguard_detect_god_packages` 相同的 `getPackageStats` / `computePackageFanMetricsFromRelations` 读数）：**
- `modules/architecture` = **61 files / 252 entities**，fanIn 1 / fanOut 564；`ArchitecturePanel.tsx` 4685 行、`PlantUmlGraph.tsx` 4040 行、`semanticZoomLayout.ts` 1679 行、`graphDom.ts` 1485 行 —— 与 finding 的五个数字逐项一致，finding 仍然成立。

**处置：按 requested action 拆分（不是档案化，也不是「已注意到」）。** 根目录只留 `index.ts` barrel；实现文件全部迁入三个子包：

| 子包 | 迁移内容 | fileCount | entityCount |
| --- | --- | --- | --- |
| `dom/` | 渲染契约、图常量/样式、选择模型、实体导航、语义缩放计划/读取、布局方向、收敛、存储等 DOM/几何底层 | 22 | 84 |
| `layout/` | PlantUML 文本与 archguard 桥、graphDom、布局管线、drawnFit、readable/svg viewport、panel 持久化 | 12 | 117 |
| `render/` | 全部 React 组件、面板控制器、curation/export/chat bridge、PlantUML DOM 读数 `plantUmlNavigation.ts` | 27 | 65 |
| `modules/architecture`（根） | 仅 `index.ts` | 1 | 0 |

- **barrel 不变：** `src/modules/architecture/index.ts` 仍导出同一组符号（`ArchitecturePanel`、`useArchitectureGraph`、四个 graph 类型、两个 tab 可见性 hook、chat bridge 两个符号）；`PlantUmlGraph` 继续 re-export `renderWithMemberDetail` / `PLANTUML_MEMBER_DETAIL` / `pickNavigationStart` / `keyboardA11yDefect` / `KEYBOARD_A11Y_STORAGE_KEY` / `capDrawnMemberRows`，所以测试与 e2e 读取的公共面没有变化。
- **子包结构（为什么没有新增环）：** 三个子包按 `render → layout → dom` 分层，`dom` 是 sink（不 import 任何 root/render/layout 文件），`hooks → dom`，root barrel → 三者。`frontend-import-cycle-budget.test.ts` 原有的 `architecture ↔ architecture/hooks` 目录环因此变短（root → hooks → dom），按棘轮只降不升的规则从 pin 中**下调移除**；没有新增组、没有新增成员。
- **尺寸 AC：** 根包 1 file / 0 entities（was 61 / 252）；三个子包分别 22/84、12/117、27/65，全部满足 requested action 的 fileCount<=30、entityCount<=120。
- **⚠️ 未达成项（诚实读数）：** 两个 panel 文件没有降到 <=2000 行：`ArchitecturePanel.tsx` 仍 4685 行；`PlantUmlGraph.tsx` 由 4040 降到 **3569**（506 行的 DOM/导航/焦点/Diff 工具块迁到 `render/plantUmlNavigation.ts`）。现有机制失败点：`server/shared/tests/architecture-ratchet.test.ts` 的 `oversizeFiles` 只钉「不得高于已提交基线」，这两个文件在基线里被显式记为 4685/3569，因此该机制只能阻止继续增长，**不能强制缩小**；把 4685 行的组件体拆成 <=2000 行需要重排组件契约（~3.4k 行 hook wiring 与 JSX 的 owner 划分），不是本任务的机械拆分范围，故不在本任务里伪造完成。
- **⚠️ 默认阈值残余：** archguard 默认 `minFiles 20 / minEntities 50 / minFanIn 5 / minFanOut 20` 下三个子包仍会被点名（`tooManyFiles`/`tooManyEntities`/`highFanIn`/`highFanOut`）。relation 口径的 fanIn/fanOut 在拆包时只会把包内调用变成跨包关系，**不可能靠切分降低**（`god-package-split-lowers-size-not-relation-fanout` 已实证）；本任务按 requested action 的 fileCount/entityCount 口径交付，并如实记录该残余，不声称默认阈值转绿。
- **探针只立案不执行：** 复核、拆分、验证全部由派发链的 worker 会话执行，例程没有代跑。

## Evidence
- 拆分前 archguard（`/tmp/ag-before`）：`modules/architecture` 61 files / 252 entities，fanIn 1 / fanOut 564。
- 拆分后 archguard（`/tmp/ag-after`）：root 1/0；`dom` 22 files / 84 entities；`layout` 12 / 117；`render` 27 / 65（同一 CLI、同一 TypeScript scope）。
- 类型：`npx tsc --noEmit -p tsconfig.json` → 0 error；`npx tsc --noEmit -p server/tsconfig.json` → 0 error。
- 客户端回归（memory-capped，`--maxWorkers=2`）：`npx vitest run src/modules/architecture/tests` → **44 files / 687 tests passed**。
- 结构棘轮：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/frontend-import-cycle-budget.test.ts server/shared/tests/architecture-ratchet.test.ts` → **12 pass / 0 fail**；cycle pin 由 5 组下调为 4 组（architecture 组关闭），module SCC 仍恰为 cockpit ↔ project-workspace。
- 受影响的服务端判据：`server/shared/tests/cloudpit-runtime-flip.test.ts` → 11 pass（架构 BroadcastChannel 源路径改到 `render/architectureChatBridge.ts`）；`server/modules/architecture/tests/architecture-routes.test.ts` → 39 pass（绝对路径 fixture 改到 `dom/rendererContract`）。
- Lint：`npx oxlint src/ server/ scripts/ shared/` → 0 error（仅既有 warning）。
- 基线重键：`architecture-ratchet.baseline.json` 的 9 条 oversize 与 2 条 moduleMutableState 条目按新路径重键（PlantUmlGraph 4040→3569，其余读数不变，旧路径条目随文件删除）；`frontend-import-cycle-budget.baseline.json` 删除 architecture 组并重测 readings —— 本分支拆分后 files 708 / staticFileEdges 2481；merge develop（sidebar split）后再测为 **files 713 / staticFileEdges 2503 / nodeCount 126 / unresolvedInternal 100 / nonLiteralDynamic 2**，基线 JSON 记录 merge 后的读数。
- 路径敏感的判据同步：`layoutAspect`、`architectureTab`、`exportMenu`、`i18nArchitectureTabCompleteness` 的源码读取路径，以及 e2e `architecture-canvas-layout.spec.ts` 的 Vite module route（`**/src/modules/architecture/render/PlantUmlGraph.tsx*`）。
- Merge 后复验（2026-11-04）：合并 develop（`e53791ad3`、`49336fd37`，含 mcp-gateway 拆包 sibling）时 `architecture-ratchet.baseline.json` 的 `note` 冲突按并集解决 —— develop 的 mcp-gateway RECORDED CHANGE 段 + 本任务 RE-KEY 段同时保留，条目区两侧重键（server mcp-gateway 新路径 / src architecture 新路径）同时保留，`measuredAt` 取 develop 的 2026-11-04；合并后重跑：`frontend-import-cycle-budget.test.ts` + `architecture-ratchet.test.ts` → **12 pass / 0 fail**；`tsc --noEmit`（root + server）→ 0 error；`vitest run src/modules/architecture/tests --maxWorkers=2` → **44 files / 687 tests passed**。

## ADR-007 dark-axis record
- L_D archguard: architectureRoot fileCount=1 (was 61), entityCount=0 (was 252); render fileCount=27 entityCount=65; layout fileCount=12 entityCount=117; dom fileCount=22 entityCount=84
- L_G archguard: pinnedDirectoryCycleGroups=4 (was 5, architecture group lowered/closed), newCycleGroups=0

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-src-architecture`（routine `architecture-analysis`，runId `architecture-analysis-1793795809080`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过（复核读数、拆分后 package 读数、tsc、44 files / 687 tests、两条结构棘轮、受影响服务端判据与 lint 均见 Evidence）
- [x] ⛔ 探针只立案不执行：本任务的拆分与验证由派发链执行，例程未代跑

## Touches
- `src/modules/architecture/**`
- `e2e/architecture-canvas-layout.spec.ts`
- `e2e/architecture-fullscreen-fit.spec.ts`
- `server/modules/architecture/tests/architecture-routes.test.ts`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `server/shared/tests/cloudpit-runtime-flip.test.ts`
- `server/shared/tests/frontend-import-cycle-budget.test.ts`
- `server/shared/tests/frontend-import-cycle-budget.baseline.json`
- `tasks/gap-routine-architecture-analysis-god-package-src-architecture.md`

## Merge resolution
上一轮 `exited-not-landed` 的 merge 冲突已在续做轮解决并提交：`architecture-ratchet.baseline.json` 的 `note` 行按并集重建（develop 段 + 本任务段），条目区保留两侧重键，`git commit --no-edit` 完成 merge；随后再次 merge 最新 develop（`49336fd37`）无冲突。合并后结构棘轮 12 pass、tsc 双 0 error、architecture 客户端 44 files / 687 tests passed（见 Evidence）。
