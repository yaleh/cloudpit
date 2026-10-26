---
id: gap-architecture-panel-chrome-layout-owner
title: ArchitecturePanel 切片 2：dock、抽屉、浮层与顶部 chrome 布局状态收进属主
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-architecture-panel-curation-filter-owner
---
## Proposal

<!-- dedup-ref --> `ArchitecturePanel.tsx` 的第二个切片，只收面板 chrome 的开合与布局状态；策展/过滤已由 `gap-architecture-panel-curation-filter-owner` 收走。

现状（2026-10-26 实测）：`ArchitecturePanel.tsx`（5023 行）里「谁开着、占多高、什么时候锁定布局」这一簇是多个 effect 与定时器互相配合的状态机：`dockOpen`/`dockOpenRef`、`dockExplicitlyOpened`、`dockTab`、`dockLayoutLocked`/`dockLockTimerRef`、`touchDrawerHeight`、`trayExpanded`、`sheetOpen`/`sheetControlsHost`/`canvasHeaderHost`、`touchHintDismissed`、`readoutOpen`、`legendOpen`、`unresolvedOpen`、`scopeHygieneOpen`、`topChromePx`、`multiSelectMode`、`focusTarget`。其中 `dockOpen` 与 `dockOpenRef` 是镜像对，`dockLayoutLocked` 由一个定时器在别处解除；手机抽屉高度、dock 显式打开与自动打开的区别、布局锁定窗口都是规则而非展示。

做法：新增 `src/modules/architecture/architectureChromeController.ts`，导出 `createArchitectureChromeController(deps)`：命令（openDock/closeDock、setDockTab、setDrawerHeight、toggleReadout/legend/sheet/tray、dismissTouchHint、reportTopChrome）+ `subscribe`/`getSnapshot` + `dispose`（清布局锁定定时器）；时钟与视口读数经注入 seam 传入；dock 自动打开/显式打开/锁定窗口的规则只在属主内。面板只订阅快照并渲染。遵循 `.agents/skills/frontend-module-standards/SKILL.md` 的「Encapsulate state behind an owner」。

## AC

- [x] 属主文件存在且不依赖 React：`grep -nE "export function createArchitectureChromeController" src/modules/architecture/architectureChromeController.ts` 有命中，且 `grep -n "from 'react'" src/modules/architecture/architectureChromeController.ts` 无输出。
- [x] 下列声明已从面板中清零：`grep -cE "const \[?(sheetOpen|sheetControlsHost|canvasHeaderHost|touchHintDismissed|trayExpanded|dockOpen|dockOpenRef|touchDrawerHeight|dockExplicitlyOpened|dockTab|dockLayoutLocked|dockLockTimerRef|readoutOpen|legendOpen|unresolvedOpen|scopeHygieneOpen|topChromePx|multiSelectMode|focusTarget)\b" src/modules/architecture/ArchitecturePanel.tsx` 输出 0。
- [x] 属主可脱离 React 测试：新增 `src/modules/architecture/tests/architectureChromeController.test.ts`，用假时钟覆盖：dock 显式打开与自动打开的区别、布局锁定窗口内的打开请求被合并、锁定超时后解除、抽屉高度钳位、触摸提示关闭后不再出现、dispose 清定时器；`npx vitest run src/modules/architecture/tests/architectureChromeController.test.ts` 退出码 0。
- [x] 行数只降不升：`wc -l src/modules/architecture/ArchitecturePanel.tsx` 小于本任务开始时的行数（以 `server/shared/tests/architecture-ratchet.baseline.json` 当前值为准），且该基线同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [x] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：PC 上选中实体后 dock 自动打开、手动关闭后不再自动弹出、切 dock tab；手机 390×844 上拖动抽屉高度、打开/关闭 sheet 与 legend、关闭触摸提示后刷新不再出现；全屏进出后顶部 chrome 高度读数正确。同时跑 `npx vitest run src/modules/architecture/tests/dockInspector.test.tsx src/modules/architecture/tests/mobileCompactToolbar.test.tsx` 与 `npx playwright test e2e/architecture-compact-chrome.spec.ts e2e/architecture-overlay-layout.spec.ts` 退出码均为 0。仅单测通过不算完成。

## 验证记录

- 属主：`src/modules/architecture/architectureChromeController.ts`（486 行，无 `from 'react'`），面板 4871 → 4782 行，`hookStateHeavy` 56 → 38；棘轮基线同提交下调至 4782 / 38。
- 单测：`architectureChromeController.test.ts` 7/7 通过（假时钟：显式 vs 自动打开、锁定窗口合并、超时解除、高度钳位、提示跨重挂载记忆、dispose 清定时器、Escape 逐层退出）。
- 回归：`npx vitest run src/modules/architecture` 42 文件 / 666 测试全绿；`npx tsc --noEmit -p .` 无输出；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- DoD 浏览器实操（隔离实例 + debug-agent 夹具，真实页面）：桌面 1440×900 选中实体 → dock 自动开在 inspector；× 关闭后 700ms 仍关闭（不自动弹回）；切 text/inspector tab；全屏进入 topChrome=77、退出后回到 0。手机 390×844：抽屉 half → collapsed（96px）→ full（92vh）；sheet 打开时 legend 可见；关闭触摸提示后刷新不再出现。
- 截图：`tmp/architecture-chrome-dod/` 下 10 张（desktop-dock-auto-open / desktop-dock-closed / desktop-dock-text-tab / desktop-fullscreen-top-chrome / mobile-hint-dismissed / mobile-drawer-half / mobile-drawer-collapsed / mobile-drawer-full / mobile-sheet-legend / mobile-after-reload-no-hint）。
- DoD 命令：`npx vitest run src/modules/architecture/tests/dockInspector.test.tsx src/modules/architecture/tests/mobileCompactToolbar.test.tsx` 39/39 通过；`npx playwright test e2e/architecture-compact-chrome.spec.ts e2e/architecture-overlay-layout.spec.ts` 3 passed，退出码 0。

该轴仍暗,理由:本任务是前端面板状态归属重构，不改变任何 GOAL 轴的可测量读数，行数与 hook 计数只作为本任务棘轮基线下降。

## Touches

- src/modules/architecture/ArchitecturePanel.tsx
- src/modules/architecture/architectureChromeController.ts
- src/modules/architecture/tests/architectureChromeController.test.ts
- src/modules/architecture/tests/dockInspector.test.tsx
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-panel-chrome-layout-owner.md
