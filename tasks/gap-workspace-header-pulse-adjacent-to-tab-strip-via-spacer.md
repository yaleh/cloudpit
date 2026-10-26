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

- [x] 测试 mock：`npx vitest run src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx` exit 0；`installStripWidthStubs` 改为同时接收 `spacer` 与 `room` 两个宽度（占位节点读 `data-workspace-tabs-spacer`，容器读 `data-workspace-tabs-room`），其余元素仍读 0；既有各用例的原有断言保留，仅把原来的单个 room 宽度换成等价的「spacer + room」。
- [x] 可用宽度：同一测试文件含新增用例：`spacer + room` 等于 natural 加内边距时取全文字，少 1px 取图标；固定总和不变、把宽度在 spacer 与 room 之间重新分配，模式不变（证明不会反向锁死）。
- [x] 结构：同一测试文件或 `src/modules/quay/tests/SessionPulse.test.tsx` 含新增用例：桌面渲染时 header 的直接子节点顺序为标题块、占位节点、Loop Pulse 触发器、tab 容器、菜单；`isMobile` 时不渲染占位节点且顺序与改动前相同；Loop Pulse 触发器不是 `[data-workspace-tabs-room]` 的后代。
- [x] 紧挨：`npx playwright test e2e/workspace-tabs-fit.spec.ts` exit 0；新增用例在 1200、1440、1920 三种宽度下，量出 Loop Pulse 触发器右边缘到 tab 条（`[role="tablist"]` 外框）左边缘的距离，等于 header 的 gap（桌面 12px，容差 1px）。
- [x] 溢出态：同一 e2e 文件含新增用例：视口窄到 tab 条出现滚动箭头时，Loop Pulse 触发器右边缘到 tab 容器左边缘的距离仍等于 header 的 gap，且 tab 条未被挤出视口。
- [x] 切换点不变：同一 e2e 文件含新增用例：扫描视口宽度（每 10px 一档，范围含 Loop Pulse 的 110px 与 43px 切换处），记录 tab 条全文字与图标的切换宽度，与改动前在同一夹具上的记录相同，误差不超过 1px，且切换点两侧各 ±20px 内模式不来回抖动。改动前的基线值写进测试文件并注明测得日期。
- [x] 静态检查：`npx tsc --noEmit -p tsconfig.json` exit 0，`npx oxlint src/modules/project-workspace src/modules/quay` exit 0。

## DoD

在真实运行的页面上（MCP 浏览器；若被别的会话占用则用一次性 Playwright 脚本并如实注明）：桌面宽度（约 1200 与 1920）各截一张，标出 Loop Pulse 右边缘与 tab 条左边缘的量值，浅色与深色各一张，截图存 `tmp/` 并贴出；窄到出现滚动箭头的宽度再截一张；手机宽度（768px 以下）截一张证明未变化。贴出改动前后切换点扫描的两组数据。按项目约定同时跑 `node scripts/ui-scenario.mjs` 下现有场景并贴出 JSON 报告；没有可用场景则如实写明。

## Verification

实现提交：`d50ef1394 fix(workspace-header): place the Loop Pulse trigger one header gap before the tabs`（worktree `gap-workspace-header-pulse-adjacent-to-tab-strip-via-spacer`，`task/gap-workspace-header-pulse-adjacent-to-tab-strip-via-spacer` 分支）。

实现要点与任务正文的一处算术连带改动（如实记录）：占位节点是 header 的**额外 flex 子节点**，header 的 `gap`（桌面 12px）因此多花一次，容器读到的剩余宽度在每个视口都比改前少 12px。若只按 Proposal 原样改，标签切换点会从 1650px 漂到 1660px（AC6 会红）。所以 `TAB_STRIP_INLINE_PADDING_PX` 从 16 降到 4（12px 的 `md:pl-3` 静息内边距 + 4px 取整 → 只剩 4px 取整），使 `available - 4` 恒等于改前的 `available - 16`；同时桌面非溢出态去掉了容器上会变成「触发器与 tab 条之间死区」的静息 `md:pl-3`（溢出态仍保留 `md:px-9` 给箭头）。这是算术对齐，不是重新调参。

### 切换点扫描（改动前 / 改动后，同一夹具）

- 改动前（改源码前实测）：label mode `icon → full` 在视口 1650px（1640 仍 icon）；pulse `43 → 110` 在视口 1290px（该档 header border-box 1001、内容盒 969，跨过 960 阈值）。
- 改动后：`scan mode-switches=[{"at":1650,"from":"icon","to":"full"}]`，`scan pulse-switches=[{"at":1290,"from":43,"to":110}]`；扫描网格 800–2060px 每 10px 一档共 127 档，两个切换各恰好一次；切换点 ±20px 内 1630/1640 = icon、1650/1660/1670 = full。基线常量与测得日期写在 `e2e/workspace-tabs-fit.spec.ts`（`BASELINE_LABEL_MODE_FULL_AT_PX = 1650`、`BASELINE_PULSE_WIDE_AT_PX = 1290`，MEASURED 2026-10-26）。

### 门禁结果

- `npx vitest run src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx` → `20 passed (20)`，exit 0。
- `npx tsc --noEmit -p tsconfig.json` → exit 0。
- `npx oxlint src/modules/project-workspace src/modules/quay e2e/workspace-tabs-fit.spec.ts` → exit 0（仅改动前既有的 warning）。
- `npx playwright test e2e/workspace-tabs-fit.spec.ts` → `5 passed (1.1m)`，exit 0。

### 真实页面读数与截图（`tmp/`，均在 worktree 内）

本 worker 会话没有挂载 Playwright MCP 浏览器工具（可从本会话工具清单直接看出），因此按 DoD 允许的第二种方式用一次性 Playwright 脚本（真实启动 server + Vite 的 e2e 夹具）驱动真实页面：把测量值画在页面上（红色虚线 = Loop Pulse 右边缘、蓝色虚线 = tab 条左边缘、绿色距离条、红框标出无边框的 Loop Pulse 触发器），再截图。

- `tmp/dod-header-1200-light.png`：1200px 浅色，`mode=icon gap=12 pulseRight=753.0 tablistLeft=765.0 distance=12.0`。
- `tmp/dod-header-1200-dark.png`：同宽度深色（`darkClass=true`），`distance=12.0`。
- `tmp/dod-header-1920-light.png`：1920px 浅色，`mode=full gap=12 pulseRight=975.0 tablistLeft=987.0 distance=12.0`。
- `tmp/dod-header-1920-dark.png`：同宽度深色（`darkClass=true`），`distance=12.0`。
- `tmp/dod-header-overflow-1024.png`：1024px 出现右箭头，`arrow=true pulseRight=583.2 roomLeft=595.2 distance=12.0`，`roomRight=964.0 ≤ viewport 1024`（tab 条未被挤出视口）。
- `tmp/dod-header-mobile-390.png`：390×844，`{"spacerRendered":false,"tablistRendered":false,"headerDirectChildren":2}`，手机分支未变。

深色是通过认证的 `request.newContext` 向 `/api/user/preferences` PATCH `{theme}` 得到的（主题是服务端用户偏好，客户端的 `localStorage['theme']` 不生效）。永久用例的截图另有 `tmp/workspace-tabs-adjacency-1200.png`、`-1440.png`、`-1920.png`、`-overflow.png`。

### 场景运行器

`node scripts/ui-scenario.mjs` 的现有场景只有 `cockpit-mode-switch.json` 与 `quay-wall-focus-pin-utter.json`，都不覆盖 workspace header 的桌面布局（前者是驾驶舱模式切换，后者是 Quay 墙的焦点钉住），因此本任务没有可用场景可跑；这一项如实记录为「无适用场景」，未用无关场景顶替。

## 暗轴（ADR-007）

该轴仍暗,理由:本任务只改桌面 header 的 flex 布局与标签模式测量，仓库里没有与之对应的设计文档可同步（L_D 没有文档侧可量），改动也没有新增模块或 import 边（L_G 无结构漂移）

## Touches

- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx
- src/modules/quay/tests/SessionPulse.test.tsx
- e2e/workspace-tabs-fit.spec.ts
- tasks/gap-workspace-header-pulse-adjacent-to-tab-strip-via-spacer.md
