---
id: gap-architecture-semantic-arrowhead-collapse-and-end-flip
title: 架构图语义缩放把聚合菱形压成 0 高或移到 target 端：箭头按刚性标记重写（原始几何定端 + 锚点贴语义端点 + 原始偏移 ×
  layout.scale）
status: todo
labels:
  - gap
  - defect
  - ui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-11-06 用 MCP 浏览器打开会话 `db5ab06e-68b1-4a6e-a707-2b6352e302ed` 的 architecture tab（Class diagram，默认 Fit≈86%，再放大到 134%）实测。

读数：
- Fit（`data-architecture-semantic="A"`，scale≈0.856）：8 条关系都有 `.uml-arrow-aggregation`；其中 `ReconcileReport o-- GitTransition`、`ReconcileReport o-- EdgeRow` 的多边形高度 = 0（四点同一 y），视觉上是一条没有菱形头的线。
- 134%（scale≈1.3376）：上述两条仍为 0；另加 `PrefilingRecheckReading o-- PrefilingRecheckEntry` 也为 0；同时 `GoalRoundReadings o-- FrozenFailingReading / GapSpawnOutcome / GoalGap` 的空心菱形出现在**子节点（target）顶端**，源端只剩裸线。
- 同一份 parser-safe PlantUML 直接交给 `@yalehwang/plantuml-js@0.5.2` 渲染，8 个聚合菱形全部 14×14。⇒ 数据/解析/上游 renderer 都是好的。

根因（2026-11-06 本树行号）：
1. 语义 y 轴把「成员行被隐藏后释放出来的框体空间」标成 `reclaim` band，并在求解时把该 band 映射为 0 高：`src/modules/architecture/layout/semanticZoomLayout.ts:585-600`（`reclaimed ? 0 : …`）与 `:854-863`（生成 `reclaim: true` 的元素）。
2. `drawSemanticLayout` 重画箭头时把 `<polygon>` 的每个顶点都过一遍 `mapPoint`（`src/modules/architecture/layout/graphDom.ts:906-946`）。落在 reclaim band 里的菱形顶点全部塌到同一 y ⇒ 零高度箭头。
3. 同一段用映射后的质心到两端点的距离决定箭头贴哪一端（`graphDom.ts:917-923`）；映射塌缩/拉伸后质心偏向另一端 ⇒ 菱形跑到 target 端。代码注释写的是 “The marker keeps its drawn SIZE and is translated…”，实现却逐顶点重映射，与意图不符。

复现脚本（只读，已留在工作区 `tmp/arch-repro/`，不进提交）：`render.mjs` 渲染原始 SVG；`semantic.ts` 用项目自身的 `readSemanticDrawingGeometry` + `solveSemanticZoom` + `drawSemanticLayout` 复现 h=0；`bands.ts` 打印每个菱形顶点落入的塌缩 y band。

### 要做什么

把箭头当刚性标记，不再逐顶点过有损轴映射：
1. 用**原始几何**判断箭头属于边的哪一端：在改写 path 之前读取原始 `d` 的首/末点，比较原始 polygon 质心/最近顶点得到 source 或 target。
2. 选定语义端点 `ends.first`/`ends.last` 作为 reference；取原始 polygon 中离该端最近的顶点作为 anchor。
3. 其余顶点按 `reference + (原始顶点 - anchor) × layout.scale` 铺开——保持箭头的形状、朝向与随缩放的屏幕尺寸，同时把 anchor 精确钉在边端点上。
4. 三角形/chevron 等其它箭头共用同一路径；不得改变 `.uml-edge` / `data-edge-*` / `.arch-edge-hit` 契约，也不得改变边的 path 端点钉法。

### 非目标

- 不改语义轴求解器的 reclaim/压缩规则（`semanticZoomLayout.ts` 的 band 逻辑是对的；问题只在箭头重写）。
- 不改上游 `@yalehwang/plantuml-js` 或 `archguardToPlantUml`。
- 不改关系筛选、暗化、选中态或导出逻辑。

### 去重

2026-11-06 扫描 `tasks/*.md`：没有在飞任务（todo/ready/needs-human）以「语义缩放箭头重写」为机制承载本问题；`architecture-class-body-vertical-compaction`（reclaim band 的引入者）、`architecture-lod-labels-and-edges-polish`、`architecture-semantic-zoom-render-regressions`、`gap-architecture-semantic-zoom-shared-y-axis-neighbour-stretch` 均 done 且机制不同、不共用本任务 Touches。故单独立项。

## Touches

- tasks/gap-architecture-semantic-arrowhead-collapse-and-end-flip.md
- src/modules/architecture/layout/graphDom.ts
- src/modules/architecture/tests/architectureTab.test.tsx
- src/modules/architecture/tests/semanticZoomLayout.test.ts

## AC

- [ ] AC1 红读数入档：在 develop 当前树（记录 `git rev-parse HEAD`）上，对会话 `db5ab06e-68b1-4a6e-a707-2b6352e302ed` 的 architecture tab，记录 Fit 与 134% 两档的 `data-architecture-semantic-scale`、每条边的 `data-edge-source`/`data-edge-target`、`.uml-arrow-aggregation` 的 polygon 坐标与计算高度；至少 `ReconcileReport→GitTransition`、`ReconcileReport→EdgeRow` 高度为 0，且 134% 下 `GoalRoundReadings→FrozenFailingReading/GapSpawnOutcome/GoalGap` 的菱形锚点落在 target 端；同一 puml 交 `@yalehwang/plantuml-js` 原始渲染得到 14×14 的对照读数一并入档。
- [ ] AC2 回归测试同一断言两面：新增/扩展测试从语义重写后的 SVG 读取每个 `.uml-arrow` 的 polygon points，断言宽高均 > 0；对每条 `o--` 关系断言 `.uml-arrow-aggregation` 的锚点顶点（离 reference 最近者）与边 path 的源端距离 ≤ 1px，且与目标端距离 > 箭头尺寸。该测试在还原旧重写时红、修复后绿；两次命令原文、exit code 与失败信息入档。
- [ ] AC3 修复实现（行为判据）：`graphDom.ts` 的箭头重写改为「原始几何定端 + 锚点贴语义端点 + 原始偏移 × layout.scale」。在一个 y 轴含 reclaim band 的布局 fixture 上，修复后每个箭头的宽高 = 原始宽高 × `layout.scale`（±0.5px），锚点落在 `ends.first`/`ends.last`（±0.5px）；同一 fixture 还原旧实现时高度为 0。`npx tsc --noEmit -p tsconfig.json` exit 0。
- [ ] AC4 浏览器读数：真实运行页面上，Fit 与 ≥134% 两档下所有 `.uml-arrow` 高度 ≥ 6px；所有 `o--` 聚合菱形的锚点在源端（≤1px），没有聚合菱形落在 target 端；截图存 `tmp/` 并在任务里贴路径。至少覆盖本会话 `db5ab06e-...` 与另一个普通会话。
- [ ] AC5 既有语义行为不回归：`npx vitest run src/modules/architecture/tests/semanticZoomLayout.test.ts src/modules/architecture/tests/architectureTab.test.tsx` exit 0；关系筛选/暗化/选中态/导出的既有断言不变。

## DoD

真实落地：在切自 develop 的任务工作树上，修复后的 `drawSemanticLayout` 在真实 architecture tab 的 Fit 与放大两档下，每条关系的箭头都是非零面积、聚合菱形在源端；回归测试在旧实现上红、新实现上绿（控制臂读数入档）；`src/modules/architecture/tests/semanticZoomLayout.test.ts` 与 `architectureTab.test.tsx` 全绿；`npx tsc --noEmit -p tsconfig.json` exit 0；按 `AGENTS.md` 的 UI DoD 用 MCP 浏览器亲手走过 Fit/放大两档并把截图放 `tmp/`（当前 `scripts/ui-scenarios/` 没有 architecture 场景，若有则同时跑 `node scripts/ui-scenario.mjs` 并贴 JSON）；改动仅限 Touches 声明的文件（若新增测试文件，必须在该文件路径后打独立 ASCII `(new)`），收尾 `git status --porcelain` 只剩本任务声明的改动；实现前加载并遵循 `.agents/skills/frontend-module-standards/SKILL.md`。完成记录必须含：工作树 HEAD sha、AC1 的红读数原文、AC2 的红/绿两次读数、AC3 的 diff 与 typecheck exit code、AC4 两种比例下每条边 polygon 的坐标与截图像素路径、AC5 的测试命令与 exit code。⛔ 不得通过放宽断言、跳过测试或改语义求解器来换绿。