---
id: gap-workspace-tabs-order-and-fit-to-width
title: PC 工作区 tab 栏：Quay/Architecture 前移、Shell 挪到内置组末尾，并按实测宽度在「全文字」与「仅图标」间自适应，同时压缩标题块
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

现象（用户在 PC 浏览器截图）：工作区 tab 栏只露出 Chat / Shell / Files / Source Control / Quay 五个，Architecture 被藏在 `>` 后面，要点滚动才能看到。

根因（读 `WorkspaceHeader.tsx` / `WorkspaceTabs.tsx` 得到）：
- tab 栏是 `min-w-max`，放在 `overflow-x-auto` 容器里，容器只拿 header 一行的剩余宽度；放不下就出现 `>` 与渐变遮罩。
- 同一行还有三样东西抢宽度：标题块（`md:max-w-[min(34%,24rem)]`，最宽 384px）、Quay 的 `SessionPulse` 条、右侧 `WorkspaceMenu`。
- 未激活 tab 的文字标签在 `lg`（≥1024px）以上无条件显示（`hidden … lg:inline`），每个 pill 约 95–110px；全开时 8 个内置 tab（外加插件 tab）约 850px，超过典型笔记本宽度（1440 屏减侧栏后约 1100px）的剩余空间。

已与用户商定的做法（不得改动）：
1. **顺序**：内置组改为 Chat · Quay · Architecture · Files · Git · Browser · Tasks · Shell；插件 tab 仍在内置组之后，中间保留现有分隔线（`index === builtInCount` 那条）。即 Shell 留在内置组末尾、分隔线之前，不放到插件之后。Quay / Architecture / Browser / Tasks 仍按各自的 `shouldShow…` 开关出现，被关掉的 tab 不占位，其余 tab 的相对顺序不变。该顺序由 `useWorkspaceTabDefinitions` 一处产生，桌面 pill 栏、移动端选择器对话框、键盘 Home/End/左右键因此一起变，不得另起第二份列表。
2. **溢出自适应（B2）**：桌面 pill 栏有两档文字模式——「全文字」（每个 tab 图标+文字）与「仅图标」（只有激活 tab 保留文字，其余只显示图标，沿用现在 `<lg` 时的样式）。由 `WorkspaceHeader` 用现有的 `ResizeObserver` 比较「可用宽度」与「全文字模式下 tab 栏的自然宽度」来选档：放得下就全文字，放不下就仅图标；仅图标仍放不下才出现现有的 `>` / `<` 滚动按钮与渐变（滚动兜底保留，不得删除）。
   - 「全文字自然宽度」必须与当前所处的档无关：用一份离屏、`aria-hidden`、不参与 tab 语义与焦点的全文字副本来量，或在全文字档时缓存、仅在 tab 集合/语言/可见性变化时失效。不得出现「切到仅图标 → 宽度变小 → 又切回全文字」的来回抖动；换视口宽度只触发一次稳定的档位变化。
   - 档位在首帧绘制前确定（`useLayoutEffect` 或等价手段），不出现「先全文字、一闪变图标」。
   - 替换掉 `WorkspaceTabs.tsx` 里 `hidden … lg:inline` 这条按断点写死的显示逻辑，改由档位决定；移动端（`CollapsedWorkspaceSelector`）不变。
   - 档位同时决定 tooltip：文字可见的 tab 不渲染 tooltip，只有图标的 tab 才有（与 ready 中的 `gap-architecture-compact-chrome-and-tab-tooltip` 里「tab tooltip only when the label is hidden」同一规则，本任务要让该规则以档位为准，而不是以断点为准）。
3. **压缩标题块（B3）**：`WorkspaceHeader.tsx` 标题块的 `md:max-w-[min(34%,24rem)]` 改为 `md:max-w-[min(34%,16rem)]`，`md:flex-[1_1_18rem]` 相应改为不超过 16rem 的基准。仅此一处宽度改动，标题截断行为不变。
4. 不做：B4（溢出改成「更多 ⋯」下拉）、新增 i18n 文案键、改任何 tab 的图标/标签文案、改移动端对话框的样式。

<!-- dedup-ref -->相关的在飞任务（仅作追溯，不是本任务的前置）：`gap-architecture-compact-chrome-and-tab-tooltip`（ready，改 `WorkspaceTabs.tsx` 的 tab tooltip 条件）与 `gap-quay-pulse-popover-escape-copy-and-mobile-chip-label`（ready，改 `WorkspaceTabs.tsx` 里移动端 tab 下拉的文字）。三者的 Touches 在 `WorkspaceTabs.tsx` 上重叠，调度器会串行；本任务开工时先把 develop 合进来，在其最终形态上改，不要把对方已改的行还原。决定：separate（独立验收：顺序 + 宽度自适应是另一个机制，对方分别是 tooltip 点击关闭与脉冲 popover）。

## Touches

- src/modules/project-workspace/WorkspaceTabs.tsx
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx
- e2e/workspace-tabs-fit.spec.ts (new)
- tasks/gap-workspace-tabs-order-and-fit-to-width.md

## AC

- [ ] 在 `src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx` 改写既有用例 `desktop keeps the full tablist and renders no collapsed trigger` 的期望顺序，并新增用例（名含 `desktop built-in order puts Quay and Architecture after Chat and Shell last before plugins`）：开启 Quay、Architecture、Browser、Tasks 与启用的插件，断言 `getAllByRole('tab')` 的 `data-workspace-tab` 序列严格等于 `chat, quay, architecture, files, git, browser, tasks, shell, plugin:…`（插件按现有顺序在最后），且分隔线位于 `shell` 与第一个插件之间；反向对照：关掉 Quay 与 Architecture 后序列为 `chat, files, git, browser, tasks, shell, plugin:…`。命令 `npx vitest run src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx` 退出码 0。
- [ ] 同文件新增用例（名含 `mobile dialog lists the same order as desktop`）：移动端对话框里按钮的 `data-workspace-tab` 序列与桌面 tablist 序列逐项相等；既有的 Home/End 键盘用例保持绿（End 落在最后一个 tab）。同一 vitest 命令退出码 0。
- [ ] 同文件新增用例（名含 `tab strip drops to icon-only when the full-label width exceeds the room, and returns when it fits`）：在 jsdom 里桩 `ResizeObserver` 与元素 `clientWidth` / `scrollWidth`，断言可用宽度小于全文字自然宽度时，未激活 tab 的文字 span 不在可见集（`hidden`）而激活 tab 的文字仍在；把可用宽度调大到不小于自然宽度后，所有 tab 的文字都可见；两次切换之间自然宽度的读数不变（不因档位而变，用来证明没有来回抖动）。同一 vitest 命令退出码 0。
- [ ] 同文件新增用例（名含 `tab tooltip follows the label mode, not the breakpoint`）：全文字档下没有任何 tab 渲染 tooltip，仅图标档下未激活 tab 有 tooltip、激活 tab 没有。同一 vitest 命令退出码 0。
- [ ] 新增 e2e `e2e/workspace-tabs-fit.spec.ts`（沿用 `e2e/support/architectureFixture.ts` 与 `e2e/resident-shell-tab.spec.ts` 起隔离实例的方式，项目需同时开启 Quay 与 Architecture tab）：依次把视口设为 1280×800、1440×900、1920×1080（侧栏展开），每档断言 `[role="tab"][data-workspace-tab]` 中除插件外的每一个都在视口内且完全可见（`getBoundingClientRect` 的 right ≤ tablist 滚动容器的 right，且 `>` 按钮 `aria-label` 含 `Scroll tabs right` 的元素不存在），并且 Quay 与 Architecture 在 DOM 顺序上紧随 Chat；至少一档（1280）的未激活 tab 为仅图标、1920 为全文字。命令 `npx playwright test e2e/workspace-tabs-fit.spec.ts` 退出码 0。
- [ ] 同一 e2e 再加一档 1024×768 且启用 2 个以上插件：此时 `>` 滚动按钮可以出现，断言点击它能让最后一个 tab 滚入可见（兜底仍可用），并断言标题块 `getBoundingClientRect().width` ≤ 256（16rem）。同一 playwright 命令退出码 0。
- [ ] `grep -c "lg:inline" src/modules/project-workspace/WorkspaceTabs.tsx` 为 0，且 `grep -c "min(34%,16rem)" src/modules/project-workspace/WorkspaceHeader.tsx` 为 1，`grep -c "min(34%,24rem)" src/modules/project-workspace/WorkspaceHeader.tsx` 为 0（grep 的零命中输出 0 但退出码 1，按输出数字判断，不要用退出码）。
- [ ] 类型检查与既有相关单测不退化：`npx tsc --noEmit -p tsconfig.json` 退出码 0；`npx vitest run src/modules/project-workspace/tests` 退出码 0（只跑这一个目录，不做整仓 fan-out）。

## DoD

- 真实页面验证（AGENTS.md「UI 验证」两条都要做，截图存 `tmp/` 并贴在任务里）：起隔离实例（配方见 isolated-browser-dod-recipe-claudecodeui，须关 residentRestore），用一个同时有 Quay 与 Architecture tab 的真实项目会话，用 MCP 浏览器在 1280、1440、1920 三档宽度各截一张工作区 header，确认 Chat 右侧依次是 Quay、Architecture，Shell 在内置组最右、分隔线之前，所有内置 tab 无需点 `>` 就可见；再把窗口从 1920 逐步拖窄到 1024，确认文字标签在某个宽度整体切成仅图标、没有闪烁或来回跳；再用 `browser_evaluate` 读 `[role=tab]` 的 rect 把读数贴出。
- 常驻会话下 Shell 仍是禁用态（`data-disabled-reason="resident"`）且位置在内置组末尾，hover 能读到原有的说明；点击每个 tab 都能切换到对应视图。
- 场景运行器：存在可用场景时按 AGENTS.md 跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告与检查点截图（已有的 `quay-panel` 场景点的是 `[data-workspace-tab="quay"]`，顺序变化不应让它变红）。
- 不改 `CollapsedWorkspaceSelector` 的样式与文案，不新增 i18n 键；`WorkspaceTabs.tsx` 里 tab 列表仍只有 `useWorkspaceTabDefinitions` 这一份来源（`grep -c "BASE_TABS" src/modules/project-workspace/WorkspaceTabs.tsx` 的结果与改前一致或更少）。
