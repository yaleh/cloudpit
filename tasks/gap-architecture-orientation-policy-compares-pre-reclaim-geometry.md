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

- [ ] 新增单测（`src/modules/architecture/tests/layoutAspect.test.tsx`）：用 `orientationChainGraph()` 的两类夹具，PC 画布 1151×596，断言策略选中的方向，其回收后画出尺寸算出的 fit 不小于另一方向的 fit（减去滞回）；命令 `npx vitest run src/modules/architecture/tests/layoutAspect.test.tsx` 退出码 0。
- [ ] 同一单测在回退本任务对 `layoutOrientation.ts` / `PlantUmlGraph.tsx` 的改动后为红（负臂：stash 这两个文件重跑，退出码非 0）。
- [ ] `npx vitest run src/modules/architecture` 全绿，`npx tsc --noEmit -p .` 无输出。
- [ ] e2e：`npx playwright test e2e/architecture-canvas-layout.spec.ts -g "orientation|downward layout|two-entity chain"` 退出码 0；并把 `DRAWING_FILL_FLOOR` 的注释与阈值按新读数复核——若被选方向的 fill 已高于强制 DOWN，则恢复“被选方向 fill 高于强制 DOWN”的对比断言。

## DoD

在隔离实例的真实页面上用该 orientation 夹具，PC 视口（1440×765）与 1920×900 各打开一次类图，读 `data-architecture-zoom-scale` 与画出 SVG 尺寸，截图存 `tmp/`：被选方向的 fill 不低于强制另一方向（用 DEV 杆 `forceDownLayout`）的 fill；手机视口仍保持 DOWN（`canvas-not-wide`）；大图（>150 实体）仍走 `entity-budget-exceeded`。贴出 `node scripts/ui-scenario.mjs` 的 JSON 报告（存在可用的架构场景时）。仅单测通过不算完成。

## Touches

- src/modules/architecture/layoutOrientation.ts
- src/modules/architecture/PlantUmlGraph.tsx
- src/modules/architecture/semanticZoomLayout.ts
- src/modules/architecture/tests/layoutAspect.test.tsx
- e2e/architecture-canvas-layout.spec.ts
- tasks/gap-architecture-orientation-policy-compares-pre-reclaim-geometry.md
