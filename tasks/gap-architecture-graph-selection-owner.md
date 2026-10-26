---
id: gap-architecture-graph-selection-owner
title: PlantUmlGraph 切片 1：选区与键盘导航状态收进 React-free 属主
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 与 `gap-architecture-orientation-policy-compares-pre-reclaim-geometry`（改方向策略）同改 `PlantUmlGraph.tsx`，Touches 重叠由调度器串行；本任务只收选区/导航，不碰布局方向。机制不同于已完成的 `gap-architecture-refresh-react-free-controller`（那是刷新流程）。

现状（2026-10-26 实测）：`src/modules/architecture/PlantUmlGraph.tsx` 4453 行，单个组件函数 `PlantUmlGraph`（第 962 行起）持有 25 个 `useState`、57 个 `useRef`、37 处定时器/监听，其中选区与键盘导航这一簇（第 1079–1140 行）是典型的「缺属主」形态：`selectedId`/`selectedByTouch`、`selectedRef`、`selectedNodeIdRef`/`selectedRelationRef`/`selectedNodeIdsRef`/`selectedRelationsRef` 是为了让 DOM 监听器看到最新值而镜像 state 的 ref；`navigationActive`/`navigationCursorId`/`navigationAnnouncement` 与 `navigationActiveRef`/`navigationCursorRef` 同理；`keyboardFocusRef`、`focusModalityRef`、`lastPointerTypeRef`、`lastTapRef`、`contextMenu` 决定「何时进入导航、何时清选区、触摸还是键盘」。这些规则只能经渲染一个 React 组件才能测，且每多一条规则就多一对 state/ref。

做法：新增 React-free 属主 `src/modules/architecture/graphSelectionController.ts`，导出 `createGraphSelectionController(deps)`，返回一个类型化对象：命令（选中/多选切换/清除/移动导航光标/进入与退出导航/打开与关闭上下文菜单/记录指针类型与双击）+ `subscribe` + `getSnapshot` + `dispose`；依赖（时钟、焦点读数）经注入 seam 传入；已有纯逻辑 `entityNavigation.ts`、`selectionModel.ts` 保持纯函数由它调用。`PlantUmlGraph.tsx` 只用 `useSyncExternalStore` 订阅快照并转发事件，镜像 ref 全部删除。遵循 `.agents/skills/frontend-module-standards/SKILL.md` 的「Encapsulate state behind an owner」，正例 `architectureRefreshController.ts`。

## AC

- [x] 属主文件存在且不依赖 React：`grep -nE "export function createGraphSelectionController" src/modules/architecture/graphSelectionController.ts` 有命中，且 `grep -n "from 'react'" src/modules/architecture/graphSelectionController.ts` 无输出。
- [x] 下列声明已从组件中清零：`grep -cE "const \[?(selectedId|selectedByTouch|selectedRef|selectedNodeIdRef|selectedRelationRef|selectedNodeIdsRef|selectedRelationsRef|keyboardFocusRef|navigationActive|navigationCursorId|navigationAnnouncement|navigationActiveRef|navigationCursorRef|focusModalityRef|contextMenu|lastPointerTypeRef|lastTapRef)\b" src/modules/architecture/PlantUmlGraph.tsx` 输出 0。
- [x] 属主可脱离 React 测试：新增 `src/modules/architecture/tests/graphSelectionController.test.ts`，用注入的假时钟/假焦点读数覆盖：单选与多选切换、清选区、导航光标移动与公告文本、触摸与键盘模态切换、双击、dispose 后不再通知；`npx vitest run src/modules/architecture/tests/graphSelectionController.test.ts` 退出码 0。
- [x] 行数只降不升：`wc -l src/modules/architecture/PlantUmlGraph.tsx` 的行数小于 4453，且 `server/shared/tests/architecture-ratchet.baseline.json` 中该文件的 `oversizeFiles` 值在同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [x] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出。

## DoD

在隔离实例（复制库须关 residentRestore）的真实页面上，用 architecture e2e 夹具打开类图，亲手走一遍：点选一个类（选中环出现）、Ctrl/Cmd 多选、点空白清选区、Tab 进入键盘导航后方向键移动并核对 aria-live 公告、触摸视口（390×844）下点选与双击、右键上下文菜单开关；每步截图存 `tmp/`。同时跑 `npx playwright test e2e/architecture-keyboard.spec.ts e2e/architecture-keyboard-a11y.spec.ts` 退出码 0。仅单测通过不算完成。

## Touches

- src/modules/architecture/PlantUmlGraph.tsx
- src/modules/architecture/graphSelectionController.ts
- src/modules/architecture/entityNavigation.ts
- src/modules/architecture/selectionModel.ts
- src/modules/architecture/tests/graphSelectionController.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-graph-selection-owner.md
