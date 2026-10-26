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

- [x] 属主文件存在且不依赖 React：`grep -nE "export function createGraphLayoutPipeline" src/modules/architecture/graphLayoutPipeline.ts` 有命中，且 `grep -n "from 'react'" src/modules/architecture/graphLayoutPipeline.ts` 无输出。
- [x] 下列声明已从组件中清零：`grep -cE "const \[?(previousIdShapeRef|semanticCaptureRef|semanticTierRef|layoutSamplesRef|layoutStatusNodes|foldDepth|appliedLayoutRef|appliedFontRef|centerPackageOnApplyRef|neighborCenterRef|applySemanticRef|lodSchedulerRef|lodDepth|drawnRevision|clusterExpanded|layoutAspect|drawnAspectRef|layoutDirection|layoutDirectionReason|orientationCacheRef|drawnKeyRef|layoutInputRef|aspectTimerRef|relayoutLockedRef|wasRelayoutLockedRef)\b" src/modules/architecture/PlantUmlGraph.tsx` 输出 0。
- [x] 属主可脱离 React 测试：新增 `src/modules/architecture/tests/graphLayoutPipeline.test.ts`，用假时钟与假布局引擎覆盖：语义布局在去抖后只应用一次、重排锁期间不重排且解锁后补一次、方向缓存命中不重复布局、宽高比变化超阈值才重排、dispose 清掉定时器；`npx vitest run src/modules/architecture/tests/graphLayoutPipeline.test.ts` 退出码 0。
- [x] 行数只降不升：`wc -l src/modules/architecture/PlantUmlGraph.tsx` 小于本任务开始时的行数（以 `server/shared/tests/architecture-ratchet.baseline.json` 当前值为准），且该基线在同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [x] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出；`npx playwright test e2e/architecture-canvas-layout.spec.ts -g "semantic|orientation|downward layout|two-entity chain"` 的红集合不大于本任务开始前的基线红集合（先在未改动代码上记录基线）。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：用 `architecture-canvas-layout-workspace-node-size` 与 orientation 夹具依次缩放 100% / 65% / 46% / 33% / 17%，读每档 `data-architecture-semantic` 层级与 `data-architecture-zoom-scale` 并贴出；拉宽/收窄浏览器窗口触发方向与宽高比重排，确认只重排一次且图不闪烁；类框之间无重叠。仅单测通过不算完成。

### 实测记录（2026-10-26，隔离实例 production build）

环境：`scripts/isolated-instance.sh start`（DB 备份副本、`residentRestore` 关、端口 3117），`DEBUG_AGENT=1` 下用 `writeArchitectureFixture` 写两份夹具并用 `/api/debug-agent/scenarios` 铸会话：
- node-size：`architecture-canvas-layout-workspace-node-size`，session `81ea5f7e-198f-469a-a4fa-dd6d6f98cb52`
- orientation：`architecture-canvas-layout-workspace-orientation`，session `222884dd-3a88-4a3f-a82f-67c14fa5bcca`

驱动脚本 `tmp/dod/walkthrough.mts`（Playwright，1440×765，登录后进 Architecture → Class diagram），读数写入 `tmp/dod/walkthrough.json`。缩放档位取在 UI 的 1.25× 步进 ±13% 内（与 e2e 的 `zoomToScale` 同一判据）。

**node-size 夹具**（`data-architecture-semantic` / `data-architecture-zoom-scale`）：

| 目标 | zoom-scale | semantic 层级 | semantic-scale | lod-depth | 方向/原因 | 可见类框 | 类框重叠 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100% | 0.994 | A | 0.994 | 2 | DOWN / canvas-not-wide | 2 | 0 |
| 65% | 0.636 | A | 0.636 | 2 | DOWN / canvas-not-wide | 2 | 0 |
| 46% | 0.509 | A | 0.509 | 2 | DOWN / canvas-not-wide | 2 | 0 |
| 33% | 0.326 | A | 0.326 | 2 | DOWN / canvas-not-wide | 2 | 0 |
| 17% | 0.167 | B | 0.167 | 1 | DOWN / canvas-not-wide | 2 | 0 |

**orientation 夹具**：

| 目标 | zoom-scale | semantic 层级 | semantic-scale | lod-depth | 方向/原因 | 可见类框 | 类框重叠 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100% | 0.960 | A | 0.960 | 2 | DOWN / vertical-fit-larger | 2 | 0 |
| 65% | 0.614 | A | 0.614 | 2 | DOWN / vertical-fit-larger | 2 | 0 |
| 46% | 0.492 | A | 0.492 | 2 | DOWN / vertical-fit-larger | 2 | 0 |
| 33% | 0.315 | A | 0.315 | 2 | DOWN / vertical-fit-larger | 2 | 0 |
| 17% | 0.201 | A | 0.201 | 2 | DOWN / vertical-fit-larger | 2 | 0 |

17% 档 node-size 落到 B（成员行收起、包标签显示 `voice (2)`），截图里缩放簇的标注同步从 `Names` 变为 `Frames`；orientation 两实体链在 17% 仍是 A，与夹具的包/成员形状一致。

**窗口拉宽/收窄（orientation，1440×765 → 1900×765 → 1000×765）**：
- 整图重排次数按「host 的 `<svg>` 被整体替换」计（`drawSemanticLayout` 只改 `svg.innerHTML`，不计）：基线 0，拉宽 **+1**，收窄 **+1** —— 每次落定只重排一次。
- 闪烁：RAF 采样 317 帧，host 内无 svg 的帧数 0 / 0 / 0。
- 方向策略每档都重算并改写原因：`vertical-fit-larger` → `fit-within-hysteresis`（拉宽，转向候选被迟滞带留下）→ `canvas-not-wide`（收窄）。方向保持 DOWN 是夹具的既定读数：两实体链在语义回收后的向下画法 fit 更大，策略只在转向候选按 fit 余量胜出时才翻转；本夹具不满足该余量。

**类框重叠**：两夹具 × 五档，可见 `.uml-node[data-entity-id]` 的矩形两两相交面积 >1px² 的对数均为 0。1000px 宽时右缘出现的浮层用 `elementFromPoint` 证认为 `[data-architecture-minimap]`（canvas 825,474 160×100），不是类框。

**截图**（`tmp/dod/screens/`）：
`nodeSize-100.png`、`nodeSize-65.png`、`nodeSize-46.png`、`nodeSize-33.png`、`nodeSize-17.png`、`orientation-100.png`、`orientation-65.png`、`orientation-46.png`、`orientation-33.png`、`orientation-17.png`、`orientation-before-resize-100.png`、`orientation-wide-100.png`、`orientation-narrow-100.png`。JSON 读数：`tmp/dod/walkthrough.json`。

**场景运行器**：`e2e/scenarios/` 现有 `cockpit-mode-switch.json` 与 `quay-wall-focus-pin-utter.json`，没有 architecture 场景，`node scripts/ui-scenario.mjs` 对本切片无可用的场景输入，故以 MCP/Playwright 真实页面读数为准。

### 判据复跑

- `npx vitest run src/modules/architecture/tests/graphLayoutPipeline.test.ts` → 6 passed (6)，退出码 0
- `npx tsx --test server/shared/tests/architecture-ratchet.test.ts` → tests 6 / pass 6 / fail 0，退出码 0
- `npx vitest run src/modules/architecture` → Test Files 39 passed，Tests 642 passed，退出码 0
- `npx tsc --noEmit -p .` → 无输出，退出码 0
- `wc -l src/modules/architecture/PlantUmlGraph.tsx` → 4040（基线 4291）；`architecture-ratchet.baseline.json` 同一提交内 4291 → 4040，并移除已不达 20 次调用的 `hookStateHeavy` 条目（现测 10 次）
- `npx playwright test e2e/architecture-canvas-layout.spec.ts -g "semantic|orientation|downward layout|two-entity chain"` → 改动前后同为 3 passed / 2 failed，且失败是同样两条（`main arm — semantic zoom keeps text readable, UML form and order at five levels`、`control arm — each semantic guard reads a false when its defect is injected`）；红集合未扩大

## ADR-007 暗轴

- L_D：该轴仍暗，理由：本任务只把语义层级与布局方向流水线从组件搬进 React-free 属主，判据是行数下降与行为复跑，没有可独立度量的领域数据轴读数。
- L_G：该轴仍暗，理由：同上；行为读数由既有 semantic/orientation e2e 与新增属主单测承担，目标层判据由 GOAL 的其余判据承担。

## Touches

- src/modules/architecture/PlantUmlGraph.tsx
- src/modules/architecture/graphLayoutPipeline.ts
- src/modules/architecture/tests/graphLayoutPipeline.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-graph-layout-pipeline-owner.md
