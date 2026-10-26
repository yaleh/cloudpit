---
id: gap-architecture-graph-layout-pipeline-owner
title: PlantUmlGraph 切片 4：语义层级与布局方向流水线收进 React-free 属主
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-architecture-graph-viewport-owner
  - gap-architecture-orientation-policy-compares-pre-reclaim-geometry
---
## Proposal

<!-- dedup-ref --> 同一组件 `PlantUmlGraph.tsx` 的第四个切片：语义缩放层级（LOD）与布局方向/宽高比重排流水线。方向策略的算法修正由 `gap-architecture-orientation-policy-compares-pre-reclaim-geometry` 负责，本任务在它之后搬状态，不改策略算法。

现状（2026-10-26 实测）：`PlantUmlGraph.tsx`（4453 行）里与「画什么层级、何时重排」相关的状态共约 25 个：语义层级簇 `previousIdShapeRef`、`semanticCaptureRef`、`semanticTierRef`、`layoutSamplesRef`、`layoutStatusNodes`、`foldDepth`、`appliedLayoutRef`、`appliedFontRef`、`centerPackageOnApplyRef`、`neighborCenterRef`、`applySemanticRef`、`lodSchedulerRef`、`lodDepth`、`drawnRevision`、`clusterExpanded`（第 1587–1653 行）；方向与重排簇 `layoutAspect`、`drawnAspectRef`、`layoutDirection`、`layoutDirectionReason`、`orientationCacheRef`、`drawnKeyRef`、`layoutInputRef`、`aspectTimerRef`、`relayoutLockedRef`、`wasRelayoutLockedRef`（第 2039–2068 行）。规则（200ms 去抖后应用语义布局、重排锁、方向缓存命中、宽高比阈值）与这些 ref/定时器耦合在多个 effect 中，只能整体挂载组件来测。

做法：新增 `src/modules/architecture/graphLayoutPipeline.ts`，导出 `createGraphLayoutPipeline(deps)`：命令（setDrawing、setCanvasAspect、setLodDepth、expandCluster、lockRelayout/unlockRelayout、applySemantic）+ `subscribe`/`getSnapshot`（层级、折叠深度、方向与原因、状态节点数）+ `dispose`（清去抖定时器与 LOD 调度器）；时钟、布局引擎（`elkAspectEngine`、`solveSemanticZoom`）经注入 seam 传入，方向缓存与重排锁是它的私有字段、单一写路径。组件只订阅快照。遵循 `.agents/skills/frontend-module-standards/SKILL.md` 的「Encapsulate state behind an owner」。

## AC

- [ ] 属主文件存在且不依赖 React：`grep -nE "export function createGraphLayoutPipeline" src/modules/architecture/graphLayoutPipeline.ts` 有命中，且 `grep -n "from 'react'" src/modules/architecture/graphLayoutPipeline.ts` 无输出。
- [ ] 下列声明已从组件中清零：`grep -cE "const \[?(previousIdShapeRef|semanticCaptureRef|semanticTierRef|layoutSamplesRef|layoutStatusNodes|foldDepth|appliedLayoutRef|appliedFontRef|centerPackageOnApplyRef|neighborCenterRef|applySemanticRef|lodSchedulerRef|lodDepth|drawnRevision|clusterExpanded|layoutAspect|drawnAspectRef|layoutDirection|layoutDirectionReason|orientationCacheRef|drawnKeyRef|layoutInputRef|aspectTimerRef|relayoutLockedRef|wasRelayoutLockedRef)\b" src/modules/architecture/PlantUmlGraph.tsx` 输出 0。
- [ ] 属主可脱离 React 测试：新增 `src/modules/architecture/tests/graphLayoutPipeline.test.ts`，用假时钟与假布局引擎覆盖：语义布局在去抖后只应用一次、重排锁期间不重排且解锁后补一次、方向缓存命中不重复布局、宽高比变化超阈值才重排、dispose 清掉定时器；`npx vitest run src/modules/architecture/tests/graphLayoutPipeline.test.ts` 退出码 0。
- [ ] 行数只降不升：`wc -l src/modules/architecture/PlantUmlGraph.tsx` 小于本任务开始时的行数（以 `server/shared/tests/architecture-ratchet.baseline.json` 当前值为准），且该基线在同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [ ] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出；`npx playwright test e2e/architecture-canvas-layout.spec.ts -g "semantic|orientation|downward layout|two-entity chain"` 的红集合不大于本任务开始前的基线红集合（先在未改动代码上记录基线）。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：用 `architecture-canvas-layout-workspace-node-size` 与 orientation 夹具依次缩放 100% / 65% / 46% / 33% / 17%，读每档 `data-architecture-semantic` 层级与 `data-architecture-zoom-scale` 并贴出；拉宽/收窄浏览器窗口触发方向与宽高比重排，确认只重排一次且图不闪烁；类框之间无重叠。仅单测通过不算完成。

## Touches

- src/modules/architecture/PlantUmlGraph.tsx
- src/modules/architecture/graphLayoutPipeline.ts
- src/modules/architecture/tests/graphLayoutPipeline.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-graph-layout-pipeline-owner.md
