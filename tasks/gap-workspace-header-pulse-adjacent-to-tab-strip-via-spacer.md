---
id: gap-workspace-header-pulse-adjacent-to-tab-strip-via-spacer
title: 桌面标题栏：Loop Pulse 紧挨 tab 条（占位节点加贴内容收缩的 tab 容器），不进入 tab 容器
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关的已完成任务：`gap-workspace-header-quay-pulse-trigger-and-session-popover`（引入了桌面标题栏里的 Loop Pulse 触发器）。本任务机制不同：只改桌面 header 的 flex 布局与 tab 条的宽度测量来源，不改触发器本身、不改 popover。

缺陷（2026-10-26 用户截图，桌面宽度）：Loop Pulse 离 tab 条很远，约在 x=420，而 tab 条在 x≈1040。原因是 `WorkspaceHeader.tsx` 桌面分支的顺序是「标题块、Loop Pulse、tab 容器（`data-workspace-tabs-room`，`flex-1`）、菜单」，tab 容器占满全部空白，tab 条在其中 `ml-auto` 贴右，于是空白落在 Loop Pulse 与 tab 条之间，窗口越宽越大。用户明确否决「把 Loop Pulse 移进 tab 容器」（语义不对），Loop Pulse 必须仍是 header 的独立兄弟节点。

要做的事（桌面分支，`isMobile` 为假时）：
- header 的子节点顺序改为：标题块、一个空的占位节点（`flex-1 min-w-0`、`aria-hidden`、无内容、带 `data-workspace-tabs-spacer` 属性）、Loop Pulse、tab 容器、菜单。DOM 顺序中 Loop Pulse 仍在 tablist 之前。
- tab 容器保留 `data-workspace-tabs-room` 属性，但从 `flex-1` 改为贴内容收缩：`min-w-0` 且 `flex: 0 1 auto`，放得下时宽度等于 tab 条，放不下时收缩并沿用现有的滚动与左右箭头。
- 标签模式测量（`measureLabelMode`）的「可用宽度」改为占位节点宽度加 tab 容器宽度；占位节点也挂 `ResizeObserver`。这样图标模式让容器变窄时占位节点相应变宽，两者之和不变，不会出现「图标模式反过来锁死图标模式」的反馈。屏幕外的全文字副本仍是 `natural` 的唯一来源，不动。
- 手机分支（`isMobile` 为真）完全不动。

不做：触发器本身（尺寸、高度、宽窄两种形态与 960px 切换阈值）；popover；标题块的宽度上限；把 Loop Pulse 放进 tab 容器；用 `order`、`row-reverse`、绝对定位或负 margin 调位置。

## AC

- [ ] 测试 mock：`npx vitest run src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx` exit 0；`installStripWidthStubs` 改为同时接收 `spacer` 与 `room` 两个宽度（占位节点读 `data-workspace-tabs-spacer`，容器读 `data-workspace-tabs-room`），其余元素仍读 0；既有各用例的原有断言保留，仅把原来的单个 room 宽度换成等价的「spacer + room」。
- [ ] 可用宽度：同一测试文件含新增用例：`spacer + room` 等于 natural 加内边距时取全文字，少 1px 取图标；固定总和不变、把宽度在 spacer 与 room 之间重新分配，模式不变（证明不会反向锁死）。
- [ ] 结构：同一测试文件或 `src/modules/quay/tests/SessionPulse.test.tsx` 含新增用例：桌面渲染时 header 的直接子节点顺序为标题块、占位节点、Loop Pulse 触发器、tab 容器、菜单；`isMobile` 时不渲染占位节点且顺序与改动前相同；Loop Pulse 触发器不是 `[data-workspace-tabs-room]` 的后代。
- [ ] 紧挨：`npx playwright test e2e/workspace-tabs-fit.spec.ts` exit 0；新增用例在 1200、1440、1920 三种宽度下，量出 Loop Pulse 触发器右边缘到 tab 条（`[role="tablist"]` 外框）左边缘的距离，等于 header 的 gap（桌面 12px，容差 1px）。
- [ ] 溢出态：同一 e2e 文件含新增用例：视口窄到 tab 条出现滚动箭头时，Loop Pulse 触发器右边缘到 tab 容器左边缘的距离仍等于 header 的 gap，且 tab 条未被挤出视口。
- [ ] 切换点不变：同一 e2e 文件含新增用例：扫描视口宽度（每 10px 一档，范围含 Loop Pulse 的 110px 与 43px 切换处），记录 tab 条全文字与图标的切换宽度，与改动前在同一夹具上的记录相同，误差不超过 1px，且切换点两侧各 ±20px 内模式不来回抖动。改动前的基线值写进测试文件并注明测得日期。
- [ ] 静态检查：`npx tsc --noEmit -p tsconfig.json` exit 0，`npx oxlint src/modules/project-workspace src/modules/quay` exit 0。

## DoD

在真实运行的页面上（MCP 浏览器；若被别的会话占用则用一次性 Playwright 脚本并如实注明）：桌面宽度（约 1200 与 1920）各截一张，标出 Loop Pulse 右边缘与 tab 条左边缘的量值，浅色与深色各一张，截图存 `tmp/` 并贴出；窄到出现滚动箭头的宽度再截一张；手机宽度（768px 以下）截一张证明未变化。贴出改动前后切换点扫描的两组数据。按项目约定同时跑 `node scripts/ui-scenario.mjs` 下现有场景并贴出 JSON 报告；没有可用场景则如实写明。

## Touches

- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx
- src/modules/quay/tests/SessionPulse.test.tsx
- e2e/workspace-tabs-fit.spec.ts
- tasks/gap-workspace-header-pulse-adjacent-to-tab-strip-via-spacer.md
