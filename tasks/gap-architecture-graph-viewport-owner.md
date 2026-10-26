---
id: gap-architecture-graph-viewport-owner
title: PlantUmlGraph 切片 3：缩放、视口与自动 Fit 状态收进 React-free 属主
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-architecture-graph-gesture-owner
---
## Proposal

<!-- dedup-ref --> 同一组件 `PlantUmlGraph.tsx` 的第三个切片，只收缩放/视口/自动 Fit；与已有纯函数 `svgViewport.ts`（几何读数）、`solveFitArea`/`solveFitScale`（`semanticZoomLayout.ts`）是调用关系，不改它们的算法。

现状（2026-10-26 实测）：`PlantUmlGraph.tsx`（4453 行）里缩放与视口这一簇分散在多处：`zoom`/`zoomRef`、`viewportRef`、`packageFocus`、`fullscreenInsets`、`fitViewportReading`、`lastFlowViewportRef`（第 1215–1288 行）、`autoFitTimerRef`（第 2893 行）、`onZoomModeChangeRef`、`fitDiagramRef`、`answeredFitTokenRef`（第 3102–3116 行）。规则散落在不同 effect 里：什么时候自动 Fit、被用户缩放后何时不再自动 Fit、全屏 insets 变化如何重新 Fit、Fit 请求令牌如何应答、缩放模式变化如何上报。`zoom` 与 `zoomRef` 互为镜像，定时器在一个 effect 里启动、在另一个里清除。

做法：新增 `src/modules/architecture/graphViewportController.ts`，导出 `createGraphViewportController(deps)`：命令（setZoom/zoomBy、requestFit(token)、setFullscreenInsets、focusPackage、reportViewport）+ `subscribe`/`getSnapshot` + `dispose`（清自己的定时器）；时钟与 DOM 读数（`svgViewport.ts` 的读数函数）经注入 seam 传入；Fit 令牌应答与「用户已手动缩放则停止自动 Fit」的规则都在属主内，单一写路径。组件只订阅快照并把 host 尺寸喂给属主。遵循 `.agents/skills/frontend-module-standards/SKILL.md` 的「Encapsulate state behind an owner」。

## AC

- [ ] 属主文件存在且不依赖 React：`grep -nE "export function createGraphViewportController" src/modules/architecture/graphViewportController.ts` 有命中，且 `grep -n "from 'react'" src/modules/architecture/graphViewportController.ts` 无输出。
- [ ] 下列声明已从组件中清零：`grep -cE "const \[?(zoom|zoomRef|viewportRef|packageFocus|fullscreenInsets|fitViewportReading|lastFlowViewportRef|autoFitTimerRef|onZoomModeChangeRef|fitDiagramRef|answeredFitTokenRef)\b" src/modules/architecture/PlantUmlGraph.tsx` 输出 0。
- [ ] 属主可脱离 React 测试：新增 `src/modules/architecture/tests/graphViewportController.test.ts`，用假时钟与假视口读数覆盖：自动 Fit 的触发与去抖、用户手动缩放后停止自动 Fit、全屏 insets 变化触发重新 Fit、同一 Fit 令牌只应答一次、缩放步进被钳在 `clampZoomScale` 范围内、dispose 清掉定时器；`npx vitest run src/modules/architecture/tests/graphViewportController.test.ts` 退出码 0。
- [ ] 行数只降不升：`wc -l src/modules/architecture/PlantUmlGraph.tsx` 小于本任务开始时的行数（以 `server/shared/tests/architecture-ratchet.baseline.json` 当前值为准），且该基线在同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [ ] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出；`npx playwright test e2e/architecture-fit-contract.spec.ts e2e/architecture-fullscreen-fit.spec.ts` 退出码 0。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：打开类图后自动 Fit 到画布；点 +/− 与滚轮缩放后窗口缩放不再自动 Fit；点「Fit to view」恢复；进入与退出全屏时图随 insets 重新居中；390×844 手机视口下顶部 chrome 色带下居中。读 `data-architecture-zoom-scale` 与画布尺寸并贴出。仅单测通过不算完成。

## Touches

- src/modules/architecture/PlantUmlGraph.tsx
- src/modules/architecture/graphViewportController.ts
- src/modules/architecture/svgViewport.ts
- src/modules/architecture/tests/graphViewportController.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-graph-viewport-owner.md
