---
id: gap-architecture-orientation-policy-compares-pre-reclaim-geometry
title: 架构图方向策略按回收空白之前的几何比较 DOWN/RIGHT，会选出更小的那个方向
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

现象：`src/modules/architecture/layoutOrientation.ts` 的方向策略把同一张图排两次（DOWN / RIGHT），按渲染器原始几何算各自在画布上的 fit，选更大者（`horizontal-fit-larger`，滞回 `ORIENTATION_FIT_HYSTERESIS`）。语义缩放现在会回收类框里为未画出的成员行预留的空白（提交 3f1b1ea23），画出的几何比渲染器几何矮得多，但策略仍拿回收之前的几何比较。e2e 夹具 `architecture-canvas-layout-workspace-orientation`（两个类，其一 20 个成员）在 PC 视口 1151×596 画布上：策略选 RIGHT（原始几何 RIGHT fit 更大），回收后实际读数 RIGHT 自然尺寸 1128×138、zoom 1.21、fill 0.227；强制 DOWN 为 792×250、zoom 1.5、fill 0.289——被选中的方向反而更小。

机制：方向决策的输入（两次布局的 natural size）与最终画出的尺寸来自两套高度口径——策略读渲染器 SVG 尺寸，画出尺寸由 `semanticZoomLayout.ts` 的 y 轴求解（含 reclaim 区间、`planMemberFrameHeight`）决定。处理方向由执行者实测后定：(a) 策略对两个方向各自过一遍语义缩放的 y 轴求解（或其轻量近似），用回收后的尺寸比较；(b) 或把回收后的内容尺寸回填到方向缓存的比较键。不得放宽滞回来掩盖。

## AC

- [x] 新增单测（`src/modules/architecture/tests/layoutAspect.test.tsx`）：用 `orientationChainGraph()` 的两类夹具，PC 画布 1151×596，断言策略选中的方向，其回收后画出尺寸算出的 fit 不小于另一方向的 fit（减去滞回）；命令 `npx vitest run src/modules/architecture/tests/layoutAspect.test.tsx` 退出码 0。
- [x] 同一单测在回退本任务对 `layoutOrientation.ts` / `PlantUmlGraph.tsx` 的改动后为红（负臂：stash 这两个文件重跑，退出码非 0）。
- [x] `npx vitest run src/modules/architecture` 全绿，`npx tsc --noEmit -p .` 无输出。
- [x] e2e：`npx playwright test e2e/architecture-canvas-layout.spec.ts -g "orientation|downward layout|two-entity chain"` 退出码 0；并把 `DRAWING_FILL_FLOOR` 的注释与阈值按新读数复核——若被选方向的 fill 已高于强制 DOWN，则恢复“被选方向 fill 高于强制 DOWN”的对比断言。

## DoD

在隔离实例的真实页面上用该 orientation 夹具，PC 视口（1440×765）与 1920×900 各打开一次类图，读 `data-architecture-zoom-scale` 与画出 SVG 尺寸，截图存 `tmp/`：被选方向的 fill 不低于强制另一方向（用 DEV 杆 `forceDownLayout`）的 fill；手机视口仍保持 DOWN（`canvas-not-wide`）；大图（>150 实体）仍走 `entity-budget-exceeded`。贴出 `node scripts/ui-scenario.mjs` 的 JSON 报告（存在可用的架构场景时）。仅单测通过不算完成。

## Touches

- src/modules/architecture/layoutOrientation.ts
- src/modules/architecture/PlantUmlGraph.tsx
- src/modules/architecture/semanticZoomLayout.ts
- src/modules/architecture/drawnFit.ts
- src/modules/architecture/tests/layoutAspect.test.tsx
- e2e/architecture-canvas-layout.spec.ts
- tasks/gap-architecture-orientation-policy-compares-pre-reclaim-geometry.md

## Evidence

- 单测：`npx vitest run src/modules/architecture/tests/layoutAspect.test.tsx` → 15 passed，exit 0。新增用例 `the direction policy compares the POST-reclaim fit, not the renderer geometry`（PC 1151×596）：DOWN 回收后 fit 1.5（内容 792×250），RIGHT 1.236；策略选 DOWN / `vertical-fit-larger`，且 chosen×(1+滞回) ≥ other。同一用例内置前提断言：按渲染器原始几何比较会选 RIGHT（即缺陷形态）。
- 负臂：把 `layoutOrientation.ts` / `PlantUmlGraph.tsx` 还原为 develop 版本后重跑同一用例 → 1 failed（chosen RIGHT fit 1.236 vs other DOWN 1.5），文件随后恢复。
- 模块测试与类型：`npx vitest run src/modules/architecture` → 35 files / 604 tests passed；`npx tsc --noEmit -p .` 无输出。
- e2e：`npx playwright test e2e/architecture-canvas-layout.spec.ts -g "orientation|downward layout|two-entity chain"` → 3 passed，exit 0。隔离实例真实页面读数：
  - 1440×765 / 画布 1151×596：被选 DOWN `vertical-fit-larger`，natural 792×250，zoom 1.5，fill 0.289；强制 RIGHT `forced-right`，natural 1128×138，zoom 1.21，fill 0.227 —— 被选方向更大。
  - 1920×900 / 画布 1631×731：被选 DOWN `fit-within-hysteresis`，natural 792×250，zoom 1.5，fill 0.166；强制 RIGHT `forced-right`，natural 1332×101，zoom 1.5，fill 0.113 —— 被选方向更大。
  - 手机 390×844：DOWN `canvas-not-wide`，fill 0.424。
  - 396 实体大图：DOWN `entity-budget-exceeded`，fill 0.516（未跑第二次布局）。
  - 截图：`tmp/orientation-shots/arch-chrome-orientation-{pc,phone,control-right,control-restored,1920x900,1920x900-forced-right,large-graph}.png`。
- `scripts/ui-scenario.mjs`：仓库现有场景仅 `e2e/scenarios/cockpit-mode-switch.json` 与 `quay-wall-focus-pin-utter.json`，无架构场景，故“存在可用的架构场景时”一项不适用；大颗粒度回归由上述 Playwright spec 承担。
- 棘轮（上一轮 fan-in 唯一红因）：`PlantUmlGraph.tsx` 曾因本任务改动 4453→4498，架构棘轮不允许上调。处理：把本任务新增的 `drawnFitScaleOf`、行数上限规则 `capDrawnMemberRows` 以及 `semanticDrawnFitScale` 包一层移入 `src/modules/architecture/drawnFit.ts`（`capDrawnMemberRows` 仍从 `PlantUmlGraph` 再导出，所有消费方导入路径不变；`semanticDrawnFitScale` 从 `drawnFit.ts` 导出，`layoutAspect.test.tsx` 的 import 同步改指）。读数：`PlantUmlGraph.tsx` 4453→4440（打印 `可下调基线`），`semanticZoomLayout.ts` 回到 develop 的 1688（本任务不再增长），`semanticZoomPlan.ts` 未改。`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 只剩 develop 既有的两条基线红（semanticZoomLayout 1642→1688、semanticZoomPlan 876→894），本任务未新增红。
- 抽取后复验：`npx vitest run src/modules/architecture/tests/layoutAspect.test.tsx` → 15 passed；`npx vitest run src/modules/architecture/tests/architectureTab.test.tsx` → 129 passed；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` → 11 passed；`npx tsc --noEmit -p .` 无输出；上面三例 e2e 重跑 3 passed（读数与上表逐项一致）。

## Blocker

**2026-10-26T07:16:29.945Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/architecture/PlantUmlGraph.tsx 4453→4498 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts]
- run_id：wk-prod-anchor
- session_id：ab5a88a9-e636-494e-83ea-7912a1599be3
