---
id: gap-architecture-panel-search-reveal-owner
title: ArchitecturePanel 切片 3：搜索、悬停提示与深链定位状态收进属主
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-architecture-panel-chrome-layout-owner
---
## Proposal

<!-- dedup-ref --> `ArchitecturePanel.tsx` 的第三个切片，收搜索、悬停提示与深链/定位；前两个切片（策展过滤、chrome 布局）已由 `gap-architecture-panel-curation-filter-owner` 与 `gap-architecture-panel-chrome-layout-owner` 收走。

现状（2026-10-26 实测）：`ArchitecturePanel.tsx`（5023 行）里这一簇是「输入→候选→定位」的规则链：搜索 `searchQuery`、`searchOpen`、`activeSearchIndex`、`searchRootRef`、`searchInputRef`（输入去抖、候选排序、方向键移动高亮、Enter 定位并清空）；悬停提示 `hovered`、`hoverHintRef`、`hoverHintPosition`、`graphAreaRef`（悬停停留后出现提示、离开后消失、位置避让）；深链与定位 `deepLinkEntityAppliedRef`、`revealNodeRef`、`reconciledAnalysisRef`（URL 深链里的实体只应用一次、分析刷新后重新对齐、定位到节点）。其中 `deepLinkEntityAppliedRef` 与 `reconciledAnalysisRef` 是「只发生一次」的去重标志，正是属主应当持有并测试的规则。

做法：新增 `src/modules/architecture/architectureSearchController.ts`，导出 `createArchitectureSearchController(deps)`：命令（setQuery、moveActive、commit、clear、setHover、applyDeepLink、reconcileAnalysis、reveal）+ `subscribe`/`getSnapshot` + `dispose`；候选排序沿用现有纯函数（`detailRanking.ts`、`hoverHintPlacement.ts`），时钟经注入 seam 传入；「深链只应用一次」「同一 analysis 只对齐一次」在属主内且单一写路径。面板只订阅快照并渲染。遵循 `.agents/skills/frontend-module-standards/SKILL.md` 的「Encapsulate state behind an owner」。

## AC

- [x] 属主文件存在且不依赖 React：`grep -nE "export function createArchitectureSearchController" src/modules/architecture/architectureSearchController.ts` 有命中，且 `grep -n "from 'react'" src/modules/architecture/architectureSearchController.ts` 无输出。
- [x] 下列声明已从面板中清零：`grep -cE "const \[?(searchQuery|searchOpen|activeSearchIndex|searchRootRef|searchInputRef|hovered|hoverHintRef|hoverHintPosition|graphAreaRef|deepLinkEntityAppliedRef|revealNodeRef|reconciledAnalysisRef)\b" src/modules/architecture/ArchitecturePanel.tsx` 输出 0。
- [x] 属主可脱离 React 测试：新增 `src/modules/architecture/tests/architectureSearchController.test.ts`，用假时钟覆盖：输入去抖与候选排序、方向键移动与越界回绕、Enter 定位并清空、悬停停留阈值与离开消失、深链实体只应用一次、同一 analysis 只对齐一次、dispose 清定时器；`npx vitest run src/modules/architecture/tests/architectureSearchController.test.ts` 退出码 0。
- [x] 行数只降不升：`wc -l src/modules/architecture/ArchitecturePanel.tsx` 小于本任务开始时的行数（以 `server/shared/tests/architecture-ratchet.baseline.json` 当前值为准），且该基线同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [x] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出。

L_D 该轴仍暗，理由：本任务只把面板里的搜索、悬停与深链定位规则收进属主，并修正语义重排后丢失的焦点标记，不新增领域数据轴读数，故 L_D/L_G 无可测读数。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：在搜索框输入实体名，方向键选候选并回车，图定位到该节点；悬停一个节点出现提示、移开消失；用带 `?entity=` 深链打开页面，实体只被定位一次，刷新分析后仍对齐；390×844 手机视口重复搜索一遍。同时跑 `npx vitest run src/modules/architecture/tests/architectureDeepLink.test.ts` 与 `npx playwright test e2e/architecture-standalone.spec.ts` 退出码均为 0。仅单测通过不算完成。

## Touches

- src/modules/architecture/ArchitecturePanel.tsx
- src/modules/architecture/architectureSearchController.ts
- src/modules/architecture/PlantUmlGraph.tsx
- src/modules/architecture/detailRanking.ts
- src/modules/architecture/hoverHintPlacement.ts
- src/modules/architecture/hooks/useProjectSearch.ts
- src/modules/architecture/tests/architectureSearchController.test.ts
- src/modules/architecture/tests/architectureDeepLink.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-panel-search-reveal-owner.md

## Blocker

**2026-10-26T12:01:28.129Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/architecture/PlantUmlGraph.tsx 4040→4050 — 基线内读数不得上调（此基线只允许下降）
- run_id：wk-prod-anchor
- session_id：c9b78786-53a4-441e-9bb2-988d85f45c96
