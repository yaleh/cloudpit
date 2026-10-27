---
id: gap-phone-pulse-thumbnail-opens-popover-not-quay-tab
title: 手机 header 的 64×14 in-flight 缩略图：点击恢复为打开 popover，不再直接切到 Quay tab
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关的已完成任务：`cockpit-mobile-header-and-page`（提交 `3d05ccf2c`，AC-430，手机 header 布局，引入了 `compact` 形态）、`gap-workspace-header-quay-pulse-trigger-and-session-popover` 与 `gap-quay-pulse-popover-counts-band-and-inflight-list`（popover 本体与其内容）。本任务机制不同：只收回 `compact` 形态附带改掉的点击行为，不动手机 header 的布局。

缺陷（2026-10-28 用户报告，2026-10-28 核实）：提交 `3d05ccf2c` 给 `SessionPulse` 加了 `compact`（`WorkspaceHeader` 传 `compact={isMobile}`），其 `onClick` 在 compact 时直接调用 `onOpenQuayPanel()` 切到 Quay tab，同时去掉 `aria-haspopup` 与 `aria-expanded`，并且 `{!compact && isOpen && <SessionPulsePopover …>}` 使 popover 在手机上不再渲染。结果是手机上点 in-flight 图看不到 popover（计数带、in-flight 列表、本会话任务与 goal、窗口设置）。该任务的说明写的是「点按打开完整 Quay 面板（沿用现有行为）」，但 10-26 popover 落地之后，现有行为已是打开 popover，前提不成立。用户 2026-10-28 明确：10-27 确认的是手机 header 的布局，不是「点击直进完整面板」。

要做的事：
- `compact` 只决定尺寸与外形（64×14、`rounded-sm`），不再改变点击语义：点击切换 `isOpen`，恢复 `aria-haspopup="dialog"` 与 `aria-expanded`，`isOpen` 时渲染 `SessionPulsePopover`（与 narrow、wide 形态完全一致）。
- popover 底部原有的「Open Quay panel」按钮是手机上进入完整面板的路径（点缩略图，再点它），此行为沿用 `onOpenQuayPanel`，不新增入口。
- 更新 `WorkspaceHeader.tsx` 里「ONE trigger, two placements」的注释与 `SessionPulse` 中 `compact` 的注释，使其不再声称缩略图直接打开 Quay 视图。
- 手机布局（标题块里项目名后的位置、64×14 尺寸、右侧行的顺序）一概不变。

不做：改 popover 自身的内容或几何；改手机 header 布局；修改 `AC-430`（已达成的 goal 判据）的文字或判据命令——其 `expect` 中若仍写「点按打开完整 Quay 面板」，只在最终回报里指出，由用户决定是否另行修订；桌面形态。

## AC

- [ ] 点击行为：`npx vitest run src/modules/quay/tests/SessionPulse.test.tsx` exit 0；新增用例：`isMobile` 且 `compact` 时点击触发器会渲染 `[data-testid="quay-pulse-popover"]`，再点关闭；触发器点击本身不调用 `onOpenQuayPanel`；触发器带 `aria-haspopup="dialog"` 且 `aria-expanded` 随开关在 `false`、`true` 间切换。
- [ ] 进入完整面板：同一测试文件含用例：compact 下打开 popover 后点击 `[data-testid="quay-pulse-open-panel"]`，`onOpenQuayPanel` 恰被调用一次。
- [ ] 外形不变：同一测试文件含用例：compact 形态的触发器宽 64px、高 14px，`data-variant` 为 `compact`；`npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` exit 0，且该文件原有用例（含缩略图位置与尺寸那条）一条不少。
- [ ] 手机点击：`src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 新增用例：手机宽度渲染 header，点击缩略图后出现 popover，popover 的定位在 header 底边之下（`top` 不小于 header 的 bottom），关闭后焦点回到缩略图。
- [ ] 关闭行为：`npx vitest run src/modules/chat/tests/chatInterfaceEscapeAbort.test.tsx` exit 0；手机 compact 下 popover 打开时按 Escape 只关闭 popover，不触发会话中止，与桌面一致。
- [ ] 注释同步：`git grep -n "opens the Quay view\|opens the full Quay panel" -- src/modules/quay/SessionPulse.tsx src/modules/project-workspace/WorkspaceHeader.tsx` 无输出。
- [ ] 静态检查：`npx tsc --noEmit -p tsconfig.json` exit 0，`npx oxlint src/modules/quay src/modules/project-workspace` exit 0。

## DoD

在真实运行的页面上（MCP 浏览器；若被别的会话占用则用一次性 Playwright 脚本并如实注明）：手机宽度（390px）打开本项目一个会话，点项目名下的 64×14 缩略图，截图存 `tmp/` 并贴出：popover 出现，计数带与 in-flight 列表可见，位置在 header 之下；点 popover 底部的 Open Quay panel 切到 Quay tab 并截图；再回到会话页确认缩略图位置与尺寸未变（与改动前对比）；浅色、深色各一张。桌面宽度点击仍打开 popover，截一张证明未退。按项目约定同时跑 `node scripts/ui-scenario.mjs e2e/scenarios/quay-wall-focus-pin-utter.json` 并贴出 JSON 报告。

## Touches

- src/modules/quay/SessionPulse.tsx
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/quay/tests/SessionPulse.test.tsx
- src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx
- src/modules/chat/tests/chatInterfaceEscapeAbort.test.tsx
- tasks/gap-phone-pulse-thumbnail-opens-popover-not-quay-tab.md
