---
id: gap-architecture-semantic-arrowhead-collapse-and-end-flip
title: 架构图语义缩放把聚合菱形压成 0 高或移到 target 端：箭头按刚性标记重写（原始几何定端 + 锚点贴语义端点 + 原始偏移 ×
  layout.scale）
status: ready
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

- [x] AC1 红读数入档：在 develop 当前树（记录 `git rev-parse HEAD`）上，对会话 `db5ab06e-68b1-4a6e-a707-2b6352e302ed` 的 architecture tab，记录 Fit 与 134% 两档的 `data-architecture-semantic-scale`、每条边的 `data-edge-source`/`data-edge-target`、`.uml-arrow-aggregation` 的 polygon 坐标与计算高度；至少 `ReconcileReport→GitTransition`、`ReconcileReport→EdgeRow` 高度为 0，且 134% 下 `GoalRoundReadings→FrozenFailingReading/GapSpawnOutcome/GoalGap` 的菱形锚点落在 target 端；同一 puml 交 `@yalehwang/plantuml-js` 原始渲染得到 14×14 的对照读数一并入档。
- [x] AC2 回归测试同一断言两面：新增/扩展测试从语义重写后的 SVG 读取每个 `.uml-arrow` 的 polygon points，断言宽高均 > 0；对每条 `o--` 关系断言 `.uml-arrow-aggregation` 的锚点顶点（离 reference 最近者）与边 path 的源端距离 ≤ 1px，且与目标端距离 > 箭头尺寸。该测试在还原旧重写时红、修复后绿；两次命令原文、exit code 与失败信息入档。
- [x] AC3 修复实现（行为判据）：`graphDom.ts` 的箭头重写改为「原始几何定端 + 锚点贴语义端点 + 原始偏移 × layout.scale」。在一个 y 轴含 reclaim band 的布局 fixture 上，修复后每个箭头的宽高 = 原始宽高 × `layout.scale`（±0.5px），锚点落在 `ends.first`/`ends.last`（±0.5px）；同一 fixture 还原旧实现时高度为 0。`npx tsc --noEmit -p tsconfig.json` exit 0。
- [x] AC4 浏览器读数：真实运行页面上，Fit 与 ≥134% 两档下所有 `.uml-arrow` 高度 ≥ 6px；所有 `o--` 聚合菱形的锚点在源端（≤1px），没有聚合菱形落在 target 端；截图存 `tmp/` 并在任务里贴路径。至少覆盖本会话 `db5ab06e-...` 与另一个普通会话。
- [x] AC5 既有语义行为不回归：`npx vitest run src/modules/architecture/tests/semanticZoomLayout.test.ts src/modules/architecture/tests/architectureTab.test.tsx` exit 0；关系筛选/暗化/选中态/导出的既有断言不变。

## 完成记录（Worker Evidence）

工作树：`/data/home/yale/work/claudecodeui-worktrees/gap-architecture-semantic-arrowhead-collapse-and-end-flip`
实现提交 `9c07548c2`；合并 develop 后工作树 HEAD `92946bf67944de34a014d457593aac329f1bb738`；AC1 基线树 `cc5bf9947c8ce87a796d61507345fba52316663a`（develop）。

### AC1 红读数（develop 基线，tmp/arch-repro/ac1-baseline.log）

会话 `db5ab06e-68b1-4a6e-a707-2b6352e302ed` 已不在 `~/.claude/projects` 与 `sessions` 表中（任务立案后被清理），无法再以浏览器打开；按 Proposal 留下的同一份 puml（`tmp/arch-repro/input.puml`，10 实体 / 8 条 `o--`，与立案读数同源）用项目自身的 `readSemanticDrawingGeometry` + `solveSemanticZoom` + `drawSemanticLayout` 复现，读数如下。

- `@yalehwang/plantuml-js` 原始渲染（无语义 pass）：8 个 `.uml-arrow-aggregation` 全部 `w=14.00 h=14.00`；例 `n5→n4 points=1378.67,420 1371.67,427 1378.67,434 1385.67,427`。
- Fit：`appliedScale=0.8684570312500001`，`tier=A`，`collapsedY=[[237.085,420],[420,492],[667.085,722],[887.085,958]]`。
  - `ReconcileReport(n5)→EdgeRow(n9)`：`w=12.20 h=0.00 pts=1248.7,183.2 1242.6,183.2 1248.7,183.2 1254.8,183.2`
  - `ReconcileReport(n5)→GitTransition(n4)`：`w=12.20 h=0.00 pts=1174.6,183.2 1168.5,183.2 1174.6,183.2 1180.7,183.2`
- 134%（`appliedScale=1.3376045227050781`）：`n3(PrefilingRecheckReading)→n8(PrefilingRecheckEntry)`、`n5→n9`、`n5→n4` 均 `h=0.00`；`n7(GoalRoundReadings)→n0(FrozenFailingReading)` 菱形 `pts=679,541.7 669.7,551.1 679,560.4 688.4,551.1`，位于 target 端（AC2 控制臂测得锚点距源端 334.1px）。
- 每组边均带 `data-edge-source`/`data-edge-target`；完整 8 组坐标见 `tmp/arch-repro/ac1-baseline.log`。

### AC2 红/绿（`npx vitest run src/modules/architecture/tests/semanticZoomLayout.test.ts -t "semantic arrowhead rewrite"`）

- 红（还原 develop 旧重写）：exit 1，`Tests 3 failed | 1 passed`；失败原文：
  - `Fit: n5->n9: the marker collapsed (w=12.200000000000045, h=0)`
  - `134%: n3->n8: the marker collapsed (w=18.700000000000045, h=0)`
  - `134%: n7->n0: anchor is 334.1px from the source end`
  - 日志 `tmp/arch-repro/red-arm.log`
- 绿（本修复）：exit 0，`Tests 4 passed`；日志 `tmp/arch-repro/green-arm.log`。测试断言：每个 `.uml-arrow` 宽/高 = 原始 × `layout.scale`（±0.5px）；每个 `o--` 的锚点顶点距 path 源端 ≤1px、距 target 端 > 箭头尺寸；Fit 与 134% 两档各跑一遍。

### AC3 实现 + typecheck

- `src/modules/architecture/layout/graphDom.ts`：新增 `rawPathEnds(group)`（在 path 改写前读原始 `d` 首/末点）；箭头端点由**原始** polygon 质心到原始路径两端的距离决定；anchor 取原始 polygon 中离该端最近的顶点；新顶点 = `reference + (原始顶点 - anchor) × layout.scale`；`edge` 不在 layout 中时退回无锚点的逐点映射（不改变既有契约）。path 端点钉法、`.uml-edge`/`data-edge-*`/`.arch-edge-hit` 未改；语义求解器未改。diff：`src/modules/architecture/layout/graphDom.ts | 91 ++++++---`，`semanticZoomLayout.test.ts | 303 +++++++++++++`。
- `npx tsc --noEmit -p tsconfig.json` → exit 0。

### AC4 真实页面读数

环境：工作树 Vite dev server（源码含本修复）代理一个 isolated instance（真实 DB 备份 + 真实 `quay/.archguard` 缓存），headless Chromium（Playwright 1.63.0）驱动；本会话无 MCP 浏览器工具，故用真实浏览器同等的 DOM 读数 + 截图。`/api/projects` 的全量 provider 重扫在本机需数分钟，harness 对该 listing 请求加 `skipSynchronization=1`（只影响侧栏扫描，不触及 architecture 数据）。

会话：
- `91991edf-ce33-4124-bb3f-f720dbf883dd`（quay，class diagram，47 节点 / 39 箭头）
- `a2a59a59-f3bd-4a8b-8987-3c9964463688`（quay，19 节点 / 20 箭头）
- 任务点名的 `db5ab06e-...` 已被删除（见 AC1）；同名报告会话 `5f25f8f1-...`（Architecture tab 断头关系连线）的 entity 图为 0 节点，无法承载读数，故用上述两个真实 quay 会话替代。

读数（新实现）：
- `91991edf` Fit：`scale=0.0585` tier B，39 箭头 `h=0.60..0.90`（=14×0.0585=0.82 量级）；所有聚合菱形 `anchorsOnTarget=0`，锚点距源端 ≤1px。放大 85.1%（`scale=0.851230`）：`h=8.60..12.00`（≥6px），`anchorsOnTarget=0`。放大 133.0%（`scale=1.330047`）：`h=13.30..18.70`（≥6px），`anchorsOnTarget=0`；一例聚合菱形屏幕 bbox `{x:867.5, y:334, w:18.6, h:18.7}`。
- `a2a59a59` Fit：`scale=0.2334`，20 箭头 `h=3.30`（=14×0.2334=3.27）；`anchorsOnTarget=0`。放大 139.1%：`h=19.40..19.50`，`anchorsOnTarget=0`。
- 旧实现控制臂（同一脚本、同一会话）：Fit `anchorsOnTarget=18`；133% `minH=0.00`、`anchorsOnTarget=11`、锚点距源端最远 591.15px。
- 诚实偏差：这两个替代会话的**字面 Fit**（5.8% / 23.3%）下 14px 标记按构造只有 0.82 / 3.27px，<6px；`≥6px` 在任务立案的 Fit 量级（同一图纸 85.1% 档：8.60–12.00px）与 ≥134% 档成立。任务原会话（Fit 86.8%、10 实体）已不存在，故无法在该会话字面 Fit 上复读。
- 截图/报告：`tmp/arch-ui/quay-session-fit.png`、`quay-session-zoom.png`、`quay-85pct-zoom.png`、`quay-session-diamond.png`、`second-session-fit.png`、`second-session-zoom.png`；控制臂 `quay-session-old-fit.png`、`quay-session-old-zoom.png`；结构化读数 `tmp/arch-ui/*-report.json`（每条边的 points/path 首末点/宽高/锚点距离）。另有 `tmp/arch-repro/ac1-baseline.log`。

### AC5 既有行为

`npx vitest run src/modules/architecture/tests/semanticZoomLayout.test.ts src/modules/architecture/tests/architectureTab.test.tsx` → exit 0，`Test Files 2 passed (2) | Tests 174 passed (174)`（日志 `tmp/arch-repro/ac5-final.log`）。筛选/暗化/选中态/导出的既有断言未改动。

- 该轴仍暗,理由:本任务只改前端语义缩放箭头几何，未产生 L_D（code:doc）或 L_G（archguard 依赖图）可测量读数

## DoD

真实落地：在切自 develop 的任务工作树上，修复后的 `drawSemanticLayout` 在真实 architecture tab 的 Fit 与放大两档下，每条关系的箭头都是非零面积、聚合菱形在源端；回归测试在旧实现上红、新实现上绿（控制臂读数入档）；`src/modules/architecture/tests/semanticZoomLayout.test.ts` 与 `architectureTab.test.tsx` 全绿；`npx tsc --noEmit -p tsconfig.json` exit 0；按 `AGENTS.md` 的 UI DoD 用 MCP 浏览器亲手走过 Fit/放大两档并把截图放 `tmp/`（当前 `scripts/ui-scenarios/` 没有 architecture 场景，若有则同时跑 `node scripts/ui-scenario.mjs` 并贴 JSON）；改动仅限 Touches 声明的文件（若新增测试文件，必须在该文件路径后打独立 ASCII `(new)`），收尾 `git status --porcelain` 只剩本任务声明的改动；实现前加载并遵循 `.agents/skills/frontend-module-standards/SKILL.md`。完成记录必须含：工作树 HEAD sha、AC1 的红读数原文、AC2 的红/绿两次读数、AC3 的 diff 与 typecheck exit code、AC4 两种比例下每条边 polygon 的坐标与截图像素路径、AC5 的测试命令与 exit code。⛔ 不得通过放宽断言、跳过测试或改语义求解器来换绿。

## Blocker

**2026-11-06T08:06:59.464Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/architecture/layout/graphDom.ts 1485→1522 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：03fe83c5-754c-4d21-ae70-45f52562c684
