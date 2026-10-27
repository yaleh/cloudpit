---
id: gap-sidebar-project-row-two-line-quiet-desktop-menu
title: 项目行两行化与降噪：删路径行、全零计数隐藏、quay 图标只在非 idle 时出现、桌面端操作收进悬停 ⋯ 菜单（含右键）、删除文案缩短（手机端同步）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref -->前一个同区域任务 `gap-sidebar-project-row-actions-overflow-menu-uniform-height` 已完成并合入，只处理了手机端：右侧控件收进 `SidebarProjectActionsMenu` 的「⋯」菜单、行内只留收藏星 + ⋯ + 箭头。本任务是它在桌面端与「行内信息降噪」上的延续，复用同一个菜单组件，不重复实现；两个任务机制不同（前者是手机端控件收纳，本任务是桌面端控件收纳加行内读数规则），所以分开立案。

来源：2026-10-27 与用户的两轮讨论和两组效果图。效果图是把改后结构注入隔离实例的真实侧栏页面（真实 class 与数据）后截的，本机路径（`tmp/` 被 git 忽略，只在这台机器上有）：桌面 `tmp/mockup-project-row-before.png`、`tmp/mockup-project-row-after.png`、`tmp/mockup-project-row-menu-open.png`；手机 `tmp/real-mobile-menu.png`（改前真实菜单）、`tmp/mockup-mobile-row-after.png`、`tmp/mockup-mobile-menu-open.png`。下文的文字结构是权威描述，图只是示意。仅前端，范围 `src/modules/sidebar/`，外加 `ActionMenu` 与两份 locale。

### 现状的四个问题（桌面行 74px，手机行 62px）

1. **路径行没有信息**：`SidebarProjectItem.tsx` 桌面分支在 `project.fullPath !== project.displayName` 时渲染 `- ` + 取末 22 字符并加 `...` 前缀的路径。项目名几乎总是路径末段，所以每一行都带着 `…/yale/work/<name>` 这种与第一行重复、且被左截断得像坏了的文字，条件恒为真，行因此是三行。完整路径已经在 `title` 里，搜索也匹配 `fullPath`（`sidebarProjectFormatting.ts` 的 `searchPath`），删掉这一行不损失功能。
2. **全零计数是噪声**：`ProjectTaskCountsBadge` 常驻显示灰/蓝/橙 `todo / ready / needs-human` 三个数，大多数项目是 `0 0 0`。真正需要人行动的是 needs-human，却混在三个数里。
3. **quay 图标 ∿ 实际是静态事实**：行内 `const quayStatus = getQuayIndicatorStatus(project, null)` 恒传 `null`，所以任何配置了 quay 的项目都读成 `idle`（蓝色 `Activity` 图标，title 为 `quay configured, driver idle`），它只表示「有 `.quay/config.yml`」，从不显示 `running`（绿 `Zap`）或 `stale`（琥珀 `AlertTriangle`）。同时 `/api/quay/fleet-summary` 的每个项目条目本来就带 `driver: { state }`（`QuayFleetProjectSummary`），只是 `useFleetTaskCounts.ts` 只发布了 `tasks`。另外这个图标带内边距，把桌面行从 52px 撑到 56px，导致同列表里行高有两种。
4. **桌面端 5 个悬停才出现的图标**（过滤、重命名、关注星、驾驶舱、删除）加箭头：使用频率都很低，`opacity-0 group-hover:opacity-100` 没有 `focus-within`/`focus-visible` 兜底，键盘 Tab 聚焦到它们却看不见；悬停时一排按钮突然出现也很跳。手机端已有的菜单里删除项文案 `Remove project from sidebar (Delete)` 在 240px 宽的菜单里折成两行，是最高的一项。

### 目标结构（桌面与手机同一份读数规则）

```text
[★] archguard                          [⋯][›]      ← ⋯ 只在悬停/聚焦/菜单打开时出现（桌面）
    22 sessions  ∿                                  ← ∿ 仅 driver 非 idle 时出现

[★] quay-dogfood-goal030                   [›]
    0 sessions  ●1 ●2 ●2  ⚠                         ← 只显示非零的圆点+数字
```

1. **删除路径行**：每个项目行恒为两行（名称行 + 读数行）。`title` 里保留 `fullPath`，搜索不变。只有两种情况需要路径来区分，此时把路径显示在**第一行名称右侧**（`text-xs text-muted-foreground opacity-60 truncate`，行仍是两行，不新增第三行）：(a) 同一列表里存在 `displayName` 相同的另一个项目；(b) `displayName` 与 `fullPath` 末段不同（项目被改过名）。判定由 `SidebarProjectList.tsx` 对当前渲染的项目集合一次算出，作为 prop 传给行，行本身不做集合扫描。
2. **计数只显示非零项**：沿用现有三色圆点 + 数字编码（灰 todo、蓝 ready、橙 needs-human），数值为 0 的项不渲染；三项全零时整个徽标不渲染；needs-human 数字用 `font-medium` 加琥珀文字色强调。徽标容器保留 `data-project-task-counts` 与 `data-task-todo/ready/needs-human` 三个属性（有非零项时渲染，属性里仍是三个真实读数，含 0），`aria-label` 与 `title` 仍是完整文字 `N todo, N ready, N needs-human`。手机与桌面两个分支一致。
3. **quay 图标只在需要注意时出现**：`idle` 与 `not-configured` 不渲染；`running`、`stale`、`unavailable` 渲染（沿用 `QuayIndicator` 现有图标与 title）。行内不再恒传 `null`：`useFleetTaskCounts.ts` 额外发布每个项目的 `driver.state`（新增一个独立的只读读数或可选成员，不改动既有必填成员的形状，避免打红手写 `FleetSummarySnapshot` 的兄弟夹具；该类型目前只有这一个消费文件），行用它判定。项目不在 fleet summary 里（没有读数）按「无读数」处理，不渲染，不把它读成 `unavailable`。图标盒必须钳进文字行高内（如固定 `h-4` 且去掉撑高的内边距），保证有图标与无图标的行等高。
4. **桌面操作收进「⋯」菜单**：桌面行右侧只保留展开箭头（去底色，仅作状态提示）与一个 `⋯` 触发钮；`⋯` 在行悬停、行内 `focus-within`、菜单打开时可见（`opacity-0` 加 `group-hover`、`group-focus-within`、`aria-expanded` 三个条件，键盘 Tab 到它时必须可见）。菜单复用手机端的 `SidebarProjectActionsMenu`（同一组件、同一菜单项与顺序：Rename project (F2)、Session filter…、View in cockpit、Pin to wall、分隔线、删除；驾驶舱与关注两项仍只在 `cockpitEnabled && fleetProjectId !== null` 时出现，过滤项仍在 `onEditSessionFilter` 缺省时不出现）。桌面行原有的 5 个悬停按钮及其分支代码一并删除，不保留两套。再加**右键菜单**作为同一个菜单的第二个入口：桌面行的 `contextmenu` 事件 `preventDefault` 并打开同一个菜单（锚在 `⋯` 触发钮位置即可，锚在指针处可选）；如 `ActionMenu` 目前没有受控打开能力，在 `src/shared/ui/ActionMenu.tsx` 里以向后兼容的方式补一个受控 `open` 入口（已有 `onOpenChange`），不改变其它调用方（`SessionOptions` 等）的行为。F2 重命名与 Delete 删除的键盘快捷键行为不变。
5. **删除文案缩短**：`tooltips.deleteProject` 在 `en/sidebar.json` 由 `Remove project from sidebar (Delete)` 改为 `Remove project (Delete)`，`zh-CN/sidebar.json` 同步缩短（如 `移除项目 (Delete)`）。只改这两份；其余 locale 的措辞各自维护，不动。只改值不改 key，所以不影响 `inlineQuoteChip.test.tsx` 钉住的 locale key 集 digest。
6. **箭头保留**但去掉底色；收藏星位置与行为不变；编辑态（重命名输入框与确认/取消钮）布局不变；会话行不动。

### 不采用的方案

把所有按钮常驻（回到拥挤）；把重命名/过滤/删除挪到项目设置页（管理类操作放远了反而绕路，菜单足够）；长按或左滑露出操作（无可发现性且与滚动冲突）。

## AC

- [ ] `npx tsc --noEmit -p .` 退出码 0，且 `npx vitest run src/modules/sidebar/tests` 退出码 0（现有用例数不得减少；对已被本任务改变语义的既有断言——全零徽标渲染、桌面悬停按钮——就地改写为新的断言，保留整个 expect 的判别力，不得删除断言来过测）。
- [ ] `src/modules/sidebar/tests/SidebarProjectItem.test.tsx` 新增桌面行用例（`npx vitest run src/modules/sidebar/tests/SidebarProjectItem.test.tsx` 退出码 0），读数断言：桌面行文本内容里不含 `fullPath` 的任何截断形态（既无 `...` 前缀路径，也无 ` - ` 前缀路径），名称节点 `title` 仍等于 `fullPath`；传入「同名消歧」prop 或名称与路径末段不同的项目时，路径显示在第一行、行内文本节点分为恰好两行结构（不出现第三个块级行）；行内常驻可交互控件恰为收藏星、`⋯` 触发钮、展开箭头三个，原先的过滤/重命名/关注/驾驶舱/删除按钮在 DOM 中不再存在；打开菜单后菜单项与手机端用例读到的 key 列表一致。失败时打印实际读到的控件数与菜单项 key 列表。
- [ ] 同一测试文件断言菜单触发可达性与右键入口：`⋯` 触发钮在行上 `focus-within`、`aria-expanded=true`、悬停三种条件下的计算样式 `opacity` 为 1，空闲时为 0；对桌面行触发 `contextmenu` 事件后菜单打开且 `defaultPrevented` 为 true；点击菜单项或触发钮不触发整行展开（展开回调调用次数为 0）。
- [ ] `src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx` 与上一条同级的新增用例读数断言：三项全零时行内不存在 `[data-project-task-counts]`；只有 ready=2 时徽标里恰有一个圆点+数字、其 `data-task-todo/ready/needs-human` 属性等于端点读数 `0/2/0`；needs-human 非零时该数字节点带 `font-medium`；桌面与手机两个渲染分支读数一致。
- [ ] quay 图标规则的单测（`SidebarProjectItem.test.tsx`）：driver 读数为 `idle`、项目未配置 quay、项目不在 fleet summary 里三种情况行内无 `[data-quay-indicator]`；读数为 `running`/`stale`/`unavailable` 时各渲染一个且 `data-quay-indicator` 等于该状态；行读数来自 `useFleetTaskCounts` 新发布的 driver 读数而不是常量 `null`（用夹具把同一项目在两次渲染里从 `idle` 改为 `running`，断言图标由无到有）。
- [ ] `e2e/sidebar-project-row-uniform-height.spec.ts` 扩展，`npx playwright test e2e/sidebar-project-row-uniform-height.spec.ts` 退出码 0：在 390、320、1280 三个视口（每格先读 `window.innerWidth` 等于声明宽度，否则以该读数 fail）下，沿用现有四种项目形态并补两种——全零徽标、driver 为 `running` 的 quay 项目（经 `/api/quay/fleet-summary` 桩提供 driver 读数）——读取所有项目卡片 `getBoundingClientRect().height`，断言同一视口内全部卡片高度相等（容差 1px），包含带 quay 图标与不带图标的行；桌面格另断言：空闲时行内可见按钮只有箭头一个、悬停后 `⋯` 出现、键盘 Tab 聚焦后 `⋯` 出现、点开后菜单含手机端同一组菜单项、右键同一行也打开该菜单、卡片文本不含路径片段。失败时打印每张卡片的 `name:height` 清单。
- [ ] 依赖桌面 `Session filter…` 悬停按钮的三个既有 e2e 改为「悬停行 → 点 `⋯` → 点菜单项 `Session filter…`」：`npx playwright test e2e/session-filter.spec.ts` 与 `e2e/session-filter-conversations-live.spec.ts` 各退出码 0（`e2e/zz-diag-session-filter.spec.ts` 里同一处 `getByTitle('Session filter…')` 同步改写，是诊断副本，不要求单独跑通）。同时在 develop 上这两条 spec 本来是否通过要在 Evidence 里写明基线读数，不得把基线就红的失败算到本任务头上。
- [ ] 抗假变体（探针里做，还原用 `git checkout`，每个还原后全绿且 `git diff` 只剩本任务声明的写点，各自只让对应的用例变红）：① 把路径行放回桌面行 → 「文本不含路径片段」那条与桌面等高那格同时变红；② 把全零徽标改回常驻渲染 → 全零用例变红；③ 把行内 quay 状态改回恒传 `null` → 「idle→running 图标由无到有」用例变红；④ 去掉 `⋯` 的 `group-focus-within` 条件 → 键盘 Tab 可达性那条变红；⑤ 把 quay 图标盒的内边距恢复 → 带图标行与无图标行的等高那格变红。
- [ ] 全量前端检查：`npm run build:client` 与 `npm run lint` 退出码均为 0；`src/modules/sidebar/SidebarProjectItem.tsx` 行数不高于改动前的 660 行（桌面分支的 5 个悬停按钮删除应使其净减；若 `server/shared/tests/architecture-ratchet.baseline.json` 对该文件有 oversize 记录，提交前单独跑 `server/shared/tests/architecture-ratchet.test.ts` 确认未被突破）；`npx vitest run src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出码 0（证明只改了 locale 值、没动 key 集）。

## DoD

真实落地判据：不是「测试存在」。要求在隔离实例（`scripts/isolated-instance.sh start`，residentRestore 已由脚本关闭，复制库）上用 MCP 浏览器在 390、320、1280 三个宽度逐个实际操作：展开侧栏项目列表，截图存 `tmp/`（文件名含宽度），读数表列出每张卡片的 `name:height`，证明同一视口内全部卡片等高，且不再出现路径行与 `0 0 0` 徽标。桌面 1280：空闲截图（只有箭头）、悬停某行截图（出现 `⋯`）、Tab 聚焦截图、点开菜单截图、右键同一行截图；菜单里实际点一次「Session filter…」（打开过滤编辑器）、点一次「Rename project (F2)」（进入重命名输入）、删除只点到确认弹窗出现为止并取消，不得删除任何真实项目。本隔离实例的驾驶舱默认关闭，无法点「View in cockpit」与「Pin to wall」：用页面路由桩提供 `/api/settings/features` 与 `/api/quay/fleet-summary`（含 `running` 的 driver 读数，用来让带 quay 图标的行出现）再点一次这两项，或如实写明哪一项没有点到、原因是什么，不得声称已点过。AGENTS.md 要求的场景运行器：存在可用场景时同时跑 `node scripts/ui-scenario.mjs e2e/scenarios/<scenario>.json …` 并贴出 JSON 报告；若本实例没开驾驶舱导致 `cockpit-mode-switch` 无法运行，如实记录该步超时与原因，不得声称已通过，也不得为凑数新增与项目行无关的场景；用到按项目名选行的场景时（`quay-panel`、`session`）须确认项目选择在删掉路径行后仍然成功。隔离实例用毕必须 `scripts/isolated-instance.sh stop`，并确认无残留 `claudecodeui-session-<pid>-*` scope。生产服务的 build 与重启不属于本任务，按「等空闲再重启」另行执行。

L_D 该轴仍暗，理由：纯前端布局与读数规则任务，不产出领域数据或文档语义读数。

L_G 该轴仍暗，理由：同上；验证读数就是 DoD 里的逐宽度卡片高度表与 AC 的变红读数。

## Touches

- src/modules/sidebar/SidebarProjectItem.tsx
- src/modules/sidebar/SidebarProjectActionsMenu.tsx
- src/modules/sidebar/SidebarProjectList.tsx
- src/modules/sidebar/hooks/useFleetTaskCounts.ts
- src/shared/ui/ActionMenu.tsx
- src/modules/i18n/locales/en/sidebar.json
- src/modules/i18n/locales/zh-CN/sidebar.json
- src/modules/sidebar/tests/SidebarProjectItem.test.tsx
- src/modules/sidebar/tests/SidebarProjectItemTaskCounts.test.tsx
- src/modules/sidebar/tests/sidebarRowProps.test.tsx
- e2e/sidebar-project-row-uniform-height.spec.ts
- e2e/session-filter.spec.ts
- e2e/session-filter-conversations-live.spec.ts
- e2e/zz-diag-session-filter.spec.ts
- tasks/gap-sidebar-project-row-two-line-quiet-desktop-menu.md
