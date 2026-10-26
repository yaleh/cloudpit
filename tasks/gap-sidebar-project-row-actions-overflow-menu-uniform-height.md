---
id: gap-sidebar-project-row-actions-overflow-menu-uniform-height
title: 手机端项目行：右侧控件收进「⋯」菜单，行内只留收藏星 + ⋯ + 箭头，所有项目卡片等高（桌面不变）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-26 与用户的 MCP 浏览器视觉分析和讨论（隔离实例 390/320/1280 三宽度截图），用户已确认两点：驾驶舱链接进菜单、关注星进菜单，行内只留收藏星。仅前端，范围 `src/modules/sidebar/`。

现状（手机分支，`SidebarProjectItem.tsx` 的 `!isCompact` 之外的移动渲染块）：每个项目卡片右侧常驻 4–6 个 32px 控件——关注星（`WatchPinToggle`）、驾驶舱链接（`CockpitProjectLink`）、删除、会话过滤、重命名、展开箭头——外加左侧收藏星。后果有二：一是名称被挤（已由提交 28781c506 改为名称独占一行、控件允许换行）；二是该换行修复使卡片高度取决于「控件个数 × 徽标位数」：开了驾驶舱的项目（6 个控件）整排按钮掉到名称下方，计数徽标位数多的项目徽标掉到第三行，没有徽标的项目最矮，列表高度参差不齐。这些控件里只有「整行点击展开」是高频操作，其余都是配置型或破坏性操作，常驻没有收益，红色删除钮紧挨重命名钮还有误触风险。

目标（手机，`!isCompact` 的移动渲染块）——行结构固定为两行，所有卡片等高：

```text
[★]  项目名                      [⋯] [›]
     22 sessions  ●0 ●0 ●0  ∿
```

- 右侧只保留两个控件：「⋯」菜单触发钮与展开箭头（箭头去掉底色，仅作状态提示）；行内不再出现关注星、驾驶舱链接、删除、过滤、重命名按钮。
- 收藏星留在左侧，行为不变。
- 「⋯」菜单复用 `@/shared/ui` 的 `ActionMenu`（会话行 `SessionOptions` 已用同一组件，样式一致；`portal` 打开以免被卡片裁切），菜单项依次：重命名、会话过滤、驾驶舱（仅 `cockpitEnabled && fleetProjectId !== null`）、关注/取消关注（同条件），`showDividerBefore` 分隔后放删除（`isDanger`）。每项沿用现有回调：`onStartEditingProject`、`onEditSessionFilter`（缺省则不出该项）、`CockpitProjectLink` 的导航目标、`WatchPinToggle` 背后的关注开关、`onDeleteProject`（删除确认流程不变）。实现者须先读 `WatchPinToggle` 与 `CockpitProjectLink` 的实现，把「点击即导航/切换」抽成菜单项可调用的形态，不得复制一份逻辑。
- 第二行（会话数 + 三色计数 + 活动图标）不换行：宽度不足时先隐藏活动图标，再截断，保证恒为一行；第一行名称 `truncate` 单行。因此不再需要上一轮为控件加的 `flex-wrap`，该处一并还原为固定两行结构。
- 菜单触发钮与行内两个控件的点击都必须 `stopPropagation`，不触发整行的展开。
- 菜单文案不新增 locale key：触发钮 `ariaLabel` 用 `Project options for ${displayName}` 这种与 `SessionOptions` 同风格的字符串，菜单项复用现有 key（`tooltips.renameProject`、`sessionFilter.menuItem`、`tooltips.deleteProject`、`common:cockpit.openProject` 及关注开关现有的 label）。若实现中确需新增 key，须同步刷新 `src/modules/chat/tests/inlineQuoteChip.test.tsx` 里的 en/zh-CN key 集 digest 钉子，并把该文件与两份 `sidebar.json` 补进 Touches。
- 桌面行（`isCompact` 之外的桌面分支，悬停才显示过滤/重命名/删除）**不改**：空闲时本来只剩一个箭头，没有换行与等高问题；`e2e/session-filter*.spec.ts` 用 `getByTitle('Session filter…')` 在桌面宽度点击，必须保持可用。
- 范围外：编辑态（重命名输入框、确认/取消钮）布局不变；`SidebarProjectList.tsx`、会话行不动。

不采用的方案：长按/左滑露出操作（无可发现性、与列表滚动冲突）；只把按钮改灰（数量没少，换行与高度不一依旧）。

## AC

- [x] `npx tsc --noEmit -p . ` 退出码 0，且 `npx vitest run src/modules/sidebar/tests` 退出码 0（现有 19 个测试文件、97 个用例不得减少；桌面分支与驾驶舱链接相关的既有用例保持原断言，不得为过测而削弱）。
- [x] 在 `src/modules/sidebar/tests/SidebarProjectItem.test.tsx` 新增用例（`npx vitest run src/modules/sidebar/tests/SidebarProjectItem.test.tsx` 退出码 0），读数断言：手机渲染下，行内可交互控件恰为三个——收藏星、「⋯」触发钮、展开箭头；`cockpitEnabled=true` 且 `fleetProjectId` 非空时，行内仍恰为这三个（关注星与驾驶舱链接不在行内），打开菜单后出现重命名/会话过滤/驾驶舱/关注/删除五项且删除在分隔线之后；`cockpitEnabled=false` 时菜单不含驾驶舱与关注两项；`onEditSessionFilter` 缺省时不含会话过滤项。每个断言失败时打印实际读到的控件数与菜单项 key 列表。
- [x] 同一测试文件新增用例断言菜单项的行为接线：点击重命名调用一次 `onStartEditingProject(project)`，点击删除调用一次 `onDeleteProject(project)`，点击驾驶舱项导航到 `/cockpit?view=board&project=<fleetProjectId>`，点击任一菜单项或触发钮都不触发整行展开（展开回调调用次数为 0）。
- [x] 新增 `e2e/sidebar-project-row-uniform-height.spec.ts (new)`，`npx playwright test e2e/sidebar-project-row-uniform-height.spec.ts` 退出码 0：在 390、320 两个手机视口（每格先读 `window.innerWidth` 等于声明宽度，否则以该读数 fail）下，种入至少四种形态的项目（有徽标且开驾驶舱、有徽标无驾驶舱、无徽标、长名称），读取项目卡片 `getBoundingClientRect().height`，断言全部卡片高度相等（容差 1px），并断言每个卡片的名称节点 `scrollWidth <= clientWidth` 对短名称成立（长名称允许省略号）；桌面 1280 一格断言空闲状态下行内无过滤/重命名/删除按钮可见、悬停后出现。失败时打印每张卡片的 `name:height` 清单。
- [x] 抗假变体（探针里做，还原用 `git checkout`，每个还原后全绿且 `git diff` 只剩本任务声明的写点）：① 把 `cockpitEnabled` 项目的关注星或驾驶舱链接放回行内 → 手机行内控件数用例与等高用例同时变红；② 去掉第二行的不换行约束（恢复 `flex-wrap`）→ 320 宽度的等高那一格变红；③ 把删除项移到分隔线之前 → 菜单顺序用例变红。三个变体各自只让对应的用例变红。
- [x] 全量前端检查：`npm run build:client` 与 `npm run lint` 退出码均为 0；且 `src/modules/sidebar/SidebarProjectItem.tsx` 行数不高于改动前的 670 行，或该文件在 `server/shared/tests/architecture-ratchet.baseline.json` 的 oversize 记录若存在则不被突破（提交前单独跑 `server/shared/tests/architecture-ratchet.test.ts` 对应用例确认；新增菜单装配逻辑优先放进新的同目录文件，不往该文件净增行）。

## DoD

真实落地判据：不是「测试存在」。要求在隔离实例（`scripts/isolated-instance.sh start`，residentRestore 已由脚本关闭，复制库）上用 MCP 浏览器在 390、320、1280 三个宽度逐个实际操作：展开侧栏项目列表，截图存 `tmp/`（文件名含宽度），读数表列出每张卡片的 `name:height`，证明同一视口下全部卡片等高；在 390 宽度实际点开某个开了驾驶舱的项目的「⋯」菜单，截图，并逐项实际点一次「会话过滤」（打开过滤编辑器）与「驾驶舱」（URL 变为 `/cockpit?...`），确认没有触发整行展开；删除项只点到确认弹窗出现为止，取消，不得删除任何真实项目。AGENTS.md 要求的场景运行器：存在可用场景时同时跑 `node scripts/ui-scenario.mjs e2e/scenarios/<scenario>.json …` 并贴出 JSON 报告；若本实例未开驾驶舱导致 `cockpit-mode-switch` 无法运行，如实记录该步超时与原因，不得声称已通过，也不得为凑数新增与项目行无关的场景。隔离实例用毕必须 `scripts/isolated-instance.sh stop`，并确认无残留 `claudecodeui-session-<pid>-*` scope。

L_D 该轴仍暗，理由：纯前端布局任务，不产出领域数据或文档语义读数。

L_G 该轴仍暗，理由：同上；验证读数就是 DoD 里的逐宽度卡片高度表与 AC 的变红读数。

## Evidence

### 实现

- 新增 `src/modules/sidebar/SidebarProjectActionsMenu.tsx`（148 行）：`ActionMenu`（`portal`）装配五项，顺序为重命名、会话过滤（`onEditSessionFilter` 缺省则无该项）、驾驶舱（`cockpitEnabled && fleetProjectId !== null`）、关注/取消关注（同条件；`useObservationPin` + `formatProjectUri`，与桌面 `WatchPinToggle` 共用同一份 pin 缓存）、分隔线后删除（`isDanger`）。`ariaLabel` 为 `Project options for ${displayName}`，未新增 locale key。路由内外两臂（`useNavigate` / `window.location.assign`）让无 Router 的既有单测仍能挂载。
- `SidebarProjectItem.tsx` 手机分支：行内只留收藏星、「⋯」触发钮、展开箭头（箭头去底色）；卡片带 `data-testid="sidebar-project-card"` 与 `data-project-id`。第二行 `flex … overflow-hidden whitespace-nowrap`，活动图标在 `<360px` 隐藏（`min-[360px]:inline-flex`），会话数与名称 `truncate`；上一轮的 `flex-wrap` 已移除。`stopPropagation` 包在菜单触发钮外层，portal 菜单的事件沿 React 树冒泡，菜单项同样被覆盖。桌面分支未改。文件 660 行（≤670；ratchet baseline 无该文件记录）。

### AC 读数（合并 develop 后复跑）

- AC1：`npx tsc --noEmit -p .` → 0；`npx vitest run src/modules/sidebar/tests` → `Test Files 19 passed (19)` / `Tests 100 passed (100)`（基线 97，+3）。桌面分支与驾驶舱链接的既有 3 条用例断言未改。
- AC2/AC3：`SidebarProjectItem.test.tsx` 7 passed；新增 4 条。行内控件读数 `3`（star、⋯、expand），卡片内 `button` 数 `2`，菜单项 key `['tooltips.renameProject','sessionFilter.menuItem','common:cockpit.openProject','common:cockpit.observationPin','tooltips.deleteProject']`，删除项前一兄弟含 `bg-border`；cockpit off → `['tooltips.renameProject','sessionFilter.menuItem','tooltips.deleteProject']`；无 filter 回调 → 4 项。行为：rename/delete 各调用一次且实参为 `project`，cockpit 后 `LocationProbe` 读 `/cockpit?view=board&project=claudecodeui`，`onToggleProject` 0 次。失败信息打印实际控件数与菜单 key JSON。
- AC4：`npx playwright test e2e/sidebar-project-row-uniform-height.spec.ts` → `3 passed (18.2s)`（390、320、1280 三格）。每格先断言 `window.innerWidth`；四形态卡片高度差 ≤1px，失败信息为 `name:height` 清单；320 活动图标 `display:none` 且零宽、390 非 none 且正宽；桌面 idle 三项 opacity `0`，悬停后 `1`。
- AC5：三变体均以 `git checkout` 还原（还原后 `git status` 空且全绿）：① 行内放回 `WatchPinToggle` → 仅「three control slots」1 条单测红（1 failed / 6 passed），e2e 390 与 320 两格红 `spread read 8.00px`，桌面绿；② 恢复 `flex-wrap` → 仅 320 格红 `spread read 16.00px`，390 与桌面绿；③ 删除项 `showDividerBefore:false` → 仅菜单顺序 1 条红（`delete must sit after a divider; its preceding sibling is <button … lucide-star …>`），其余 6 条绿。
- AC6：`npm run build:client` → 0；`npm run lint` → 0（仅 warning）；`SidebarProjectItem.tsx` 660 行；baseline 无该文件 oversize 记录。

### DoD 隔离实例实测

- 实例：`scripts/isolated-instance.sh start`（复制库，`residentRestore.enabled=false`）。驾驶舱默认关，为本次实测在 `tmp/isolated-instance/server.settings.json` 增加 `"cockpit": {"enabled": true}`，并以脚本同一组 env（`SERVER_PORT=8519`、`HOST=127.0.0.1`、`DATABASE_PATH` / `SERVER_SETTINGS_PATH` 指向实例目录、`CLAUDE_SESSION_SCOPE_SWEEP=off`）重启；`GET /api/settings/features` 返回 `{"cockpit":{"enabled":true}}`。实例读真实复制库 319 个项目。
- 390：`viewportInnerWidth 390`，`cardCount 319`，`minHeight=maxHeight=62`，`spread 0`，直方图 `{"62":319}`；ledger `tmp/isolated-height-ledger-390.txt`（319 行 `name:height`）；截图 `tmp/isolated-sidebar-390.png`。
- 320：`viewportInnerWidth 320`，`cardCount 319`，`minHeight=maxHeight=62`，`spread 0`，直方图 `{"62":319}`；ledger `tmp/isolated-height-ledger-320.txt`；截图 `tmp/isolated-sidebar-320.png`。
- 1280：`innerWidth 1280`，`compactCards 0`；过滤/重命名/删除 idle opacity `0`，悬停后 `1`；截图 `tmp/isolated-sidebar-1280.png`。
- 390 实际点选（项目 `quay-fleet`，`projectId cc478371-7ff5-4d61-9c12-f0b1ebb19383`，`fleetProjectId quay-fleet`）：菜单 5 项 `["Rename project (F2)","Session filter…","View in cockpit","Pin to wall","Remove project from sidebar (Delete)"]`，截图 `tmp/isolated-390-menu.png`；点「会话过滤」→ 编辑器标题 `Session filter · quay-fleet`，截图 `tmp/isolated-390-session-filter.png`；点「驾驶舱」→ URL `http://127.0.0.1:8519/cockpit?view=board&project=quay-fleet`，截图 `tmp/isolated-390-cockpit.png`；删除项只到确认框（按钮 `["Archive project","Delete all data permanently","Cancel"]`）后取消，`confirmed:false`、`cardStillThere:1`，截图 `tmp/isolated-390-delete-confirm.png`。展开容器计数：打开菜单前 `0`、过滤后 `0`、删除取消后 `0`。
- 场景运行器：隔离实例是生产 `dist` 构建，场景语义面不挂载；直接以 `--base-url http://127.0.0.1:8519` 运行退出码 2（`the semantic surface (window.__cloudcliScenario) was not mounted within 30000ms … production dist/ build`），如实记录、未计为通过。改用同一隔离后端的 Vite 开发服务器（worktree 内 `SERVER_PORT=8519 VITE_PORT=5199 npm run client`，`/api` 代理到 8519）运行 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json --base-url http://127.0.0.1:5199 …`：退出码 0，报告 `tmp/ui-scenario-cockpit-mode-switch/report.json` `ok:true`，3/3 步、7571ms；读数 step1 `/session/1d38c52e-…` cockpit `null`、step2 `/cockpit?view=board&project=quay-fleet` view `board`、step3 回到同一 `/session/1d38c52e-…`；检查点截图 `tmp/ui-scenario-cockpit-mode-switch/step-{1,2,3}-*.png`。未新增场景。
- 收尾：`scripts/isolated-instance.sh stop` 报 `ok:false` / `port_still_serving:true`——手工重启后 `server.pid`（2602460）是启动器，真实服务是子进程 2602463；核对 `/proc/2602463/environ` 确认 `DATABASE_PATH` / `SERVER_SETTINGS_PATH` 均指向本实例、`SERVER_PORT=8519`，随后终止该进程。此后 8519 空闲、`ps` 无引用实例目录的进程、无 `claudecodeui-session-2602460-*` / `2602463-*` scope（现存 16 个 `claudecodeui-session-1914912-*` 属主实例，不属本次）。

## Touches

- src/modules/sidebar/SidebarProjectItem.tsx
- src/modules/sidebar/SidebarProjectActionsMenu.tsx (new)
- src/modules/sidebar/tests/SidebarProjectItem.test.tsx
- src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx
- e2e/sidebar-project-row-uniform-height.spec.ts (new)
- tasks/gap-sidebar-project-row-actions-overflow-menu-uniform-height.md
