---
id: gap-architecture-graph-gesture-owner
title: PlantUmlGraph 切片 2：手势、框选与回调槽收进 React-free 属主
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-architecture-graph-selection-owner
---
## Proposal

<!-- dedup-ref --> 同一组件 `PlantUmlGraph.tsx` 的第二个切片，只收手势与回调槽；选区状态已由 `gap-architecture-graph-selection-owner` 收走，本任务的属主调用它的命令而不再复制选区状态。

现状（2026-10-26 实测）：`PlantUmlGraph.tsx`（4453 行）第 1019–1075 行有一簇专为手势服务的 ref：`hoverCallbackRef`、`clickCallbackRef`、`edgeClickCallbackRef`、`selectionClearCallbackRef`、`escapeSelectionCallbackRef`、`toggleNodeCallbackRef`、`toggleEdgeCallbackRef`、`multiSelectStartCallbackRef`、`boxSelectCallbackRef`、`drawnCallbackRef` 共 10 个「只为让原生 DOM 监听器读到最新回调」的回调槽，外加 `multiSelectModeRef`、`suppressClickRef`、`shiftHeldRef`、`marquee`/`marqueeClientRef`、`coarsePointerRef`、`drawnLayoutRef`。它们实际表达的是一台手势状态机：何时抑制随拖拽而来的点击、框选矩形如何随指针更新、Shift 与多选模式如何改变点击含义、粗指针（触摸）如何改写命中半径。这台状态机现在只能通过挂载整个组件来测。

做法：新增 `src/modules/architecture/graphGestureController.ts`，导出 `createGraphGestureController(deps)`：对外是命令（pointerDown/Move/Up、keyDown/Up、setMultiSelectMode、setHandlers）+ `subscribe`/`getSnapshot`（含 marquee 矩形）+ `dispose`；回调槽收成一个 `setHandlers(handlers)`（单一写路径），原生监听器只读控制器，不再需要 10 个镜像 ref；命中半径等依赖经注入 seam 传入。组件只绑定 DOM 事件并转发。遵循 `.agents/skills/frontend-module-standards/SKILL.md` 的「Encapsulate state behind an owner」。

## AC

- [ ] 属主文件存在且不依赖 React：`grep -nE "export function createGraphGestureController" src/modules/architecture/graphGestureController.ts` 有命中，且 `grep -n "from 'react'" src/modules/architecture/graphGestureController.ts` 无输出。
- [ ] 下列声明已从组件中清零：`grep -cE "const \[?(hoverCallbackRef|clickCallbackRef|edgeClickCallbackRef|selectionClearCallbackRef|escapeSelectionCallbackRef|toggleNodeCallbackRef|toggleEdgeCallbackRef|multiSelectStartCallbackRef|boxSelectCallbackRef|drawnCallbackRef|multiSelectModeRef|suppressClickRef|shiftHeldRef|marquee|marqueeClientRef|coarsePointerRef)\b" src/modules/architecture/PlantUmlGraph.tsx` 输出 0。
- [ ] 属主可脱离 React 测试：新增 `src/modules/architecture/tests/graphGestureController.test.ts`，覆盖：拖拽后抑制一次点击、框选矩形随指针更新并在 pointerUp 时回调选中集合、Shift 与多选模式改变点击语义、粗指针放大命中半径、`setHandlers` 替换后旧回调不再被调用、dispose 后事件被忽略；`npx vitest run src/modules/architecture/tests/graphGestureController.test.ts` 退出码 0。
- [ ] 行数只降不升：`wc -l src/modules/architecture/PlantUmlGraph.tsx` 小于本任务开始时的行数（以 `server/shared/tests/architecture-ratchet.baseline.json` 当前值为准），且该基线在同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [ ] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：PC 视口拖出框选矩形并松开（选中集合与矩形一致）、拖拽平移后不误触发点击、Shift+点击多选、多选模式开关；390×844 触摸视口下点按一个小节点（粗指针命中）与双指缩放不误选。同时跑 `npx playwright test e2e/architecture-keyboard.spec.ts` 与 `npx vitest run src/modules/architecture/tests/mobileGestures.test.tsx` 退出码均为 0。仅单测通过不算完成。

## Touches

- src/modules/architecture/PlantUmlGraph.tsx
- src/modules/architecture/graphGestureController.ts
- src/modules/architecture/tests/graphGestureController.test.ts
- src/modules/architecture/tests/mobileGestures.test.tsx
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-graph-gesture-owner.md
