---
id: cockpit-shell-filters-mobile-page-and-details-bar
title: 驾驶舱外壳对齐效果图：带计数的类型过滤胶囊与项目胶囊、列标题「N waiting for you · M
  stuck」、手机卡片页去掉旧部署条与项目条、Details 底部常驻确认条与「在 Quay 中打开任务」、输入框提示语如实
status: ready
labels:
  - gap
  - cockpit
  - ui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cockpit-live-cards-session-link-confirmability-and-titles
  - cockpit-pc-column-full-height-layout
---
## Proposal

来源：2026-10-27 用户审阅线上驾驶舱。效果图（gitignored，按绝对路径读）：`/data/home/yale/work/claudecodeui/tmp/cockpit-redesign/80-m-list-cards.png`、`85-m-project-filter.png`、`87-m-details-top.png`、`88-m-details-session-link.png`、`150-pc-open.png`、`150-pc-details.png`。线上截图：`/data/home/yale/work/claudecodeui/tmp/cockpit-review-pc-open-1440.png`、`cockpit-review-pc-details-1440.png`、`cockpit-review-m-page-390.png`。

差异：

- 过滤：效果图是带计数的类型胶囊（All 15 · Stuck 2 · Rulings 13 · Needs you 1 · Mine）加一个项目胶囊（多选抽屉，带各项目待办数）／线上是 Type、Project 两个下拉框，没有计数。
- 列标题：效果图「Cockpit · 15 waiting for you · 2 stuck」，旁边有快捷键提示 ／ 线上「Cockpit · 11 open」。
- 手机卡片页：效果图只有「Cockpit · 状态行 · 计数 · 过滤胶囊 · 卡片 · 底部输入框」／线上 `/cockpit?view=cards` 顶部仍套着旧驾驶舱外壳——部署条（「5 changes not yet built · Build and restart · Last deploy…」）、项目条（Observation wall · All projects · Initiatives · 各项目），底部还有「Focus: none」，类型过滤被挤到首屏之外。
- Details：效果图底部常驻同一个确认条（绑定当前显示的选项）／线上没有。任务类卡片（`subject.taskId`）没有「在 Quay 中打开该任务」的链接。
- 底部输入框：效果图提示「对驾驶舱说：在某个项目开会话做某事、把某个回复发给某会话…」，并注明「Cockpit command · goes to the system, not the session on the left」／线上仍是旧导航语法的提示（「Say what to look at — e.g. view claudecodeui, the second one, zoom in…」）。指令开会话本身是后续目标，本任务只让提示语如实反映当前能做的事，不实现新指令。

做什么：

- 过滤胶囊：`CockpitCardList.tsx` 顶部改为横向可滚动的类型胶囊，每个胶囊带当前（受项目过滤影响后的）数量；「Mine」暂按「主体会话是当前用户发起的」计，没有该信息时不显示该胶囊。项目胶囊点开为多选抽屉，列出有卡片的项目及数量；选择按设备记住（controller 已有过滤状态，补持久化）。
- 列标题：`CockpitColumn.tsx` 标题行显示「N waiting for you」以及 rescue 组的数量（「M stuck」一类，按 group 计，不按 provider 分支）。
- 手机卡片页：`view=cards` 在手机宽度下不渲染部署条、项目条与「Focus」行（这些仍属于旧视图，保留在 wall、fleet、board 视图里），只渲染标题、计数、过滤胶囊、卡片与输入框。
- Details：底部常驻确认条，与卡片上的确认条绑定同一个显示中的选项，走同一确认卡；`subject.taskId` 存在时提供「在 Quay 中打开该任务」链接（PC 在左侧打开对应项目的 Quay tab 并定位任务，手机跳转到该项目的 Quay 页）。
- 输入框提示语：改为如实描述当前能力（例如「选卡片：说第几张；看详情；…」），并在下方注明指令发给驾驶舱而不是左侧会话；新文案进所有语言的 `common.json`。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：各类型胶囊的计数等于该类型 open 卡片数且受项目过滤约束；项目过滤多选并在重建 controller 后恢复。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：列标题含等待数与 rescue 组数；Details 渲染底部确认条且标签与卡片当前选项一致；有 taskId 的卡片 Details 含「在 Quay 中打开」链接。
- [x] 新增用例断言手机宽度的 `view=cards` 不渲染部署条、项目条与 Focus 行，而 `view=wall` 仍渲染（文件放在 `src/modules/cockpit/tests/` 下，名称在完成记录写明）。
- [x] 现有测试不退：`npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少。
- [x] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（打开 `cockpit.fixtureCards`）上用 MCP 浏览器（不可用时用一次性 Playwright 并写明）：390 宽度打开卡片页，首屏能看到过滤胶囊与第一张卡片，没有部署条与项目条，截图并与 `80-m-list-cards.png` 对照；点项目胶囊打开多选抽屉，截图对照 `85-m-project-filter.png`；打开一张任务卡的 Details，底部确认条可见，「在 Quay 中打开」可用；1440 宽度列标题截图对照 `150-pc-open.png`。截图存 `tmp/`。场景运行器 `e2e/scenarios/cockpit-cards-confirm.json` 与 `e2e/scenarios/cockpit-mode-switch.json` 贴出 JSON 报告。⛔ 不在线上实例点击任何确认。

## Touches

- tasks/cockpit-shell-filters-mobile-page-and-details-bar.md
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitColumn.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitStage.tsx
- src/modules/cockpit/CockpitPage.tsx
- src/modules/cockpit/CockpitInput.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardsMobileShell.test.tsx (new)
- src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts
- src/modules/chat/tests/inlineQuoteChip.test.tsx
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- src/modules/i18n/locales/tr/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/zh-TW/common.json
- server/shared/tests/architecture-ratchet.baseline.json

## 完成记录

（2026-10-28，worker cockpit-shell-filters-mobile-page-and-details-bar，分支 `task/cockpit-shell-filters-mobile-page-and-details-bar`，提交 `6bb002cf7`）

### 改动

- 过滤胶囊：`CockpitCardList.tsx` 顶部改为横向可滚动的类型胶囊（`All 9`、`Needs you 1`、`Stuck 2` …），每枚带「受项目过滤约束后」的数量；项目胶囊打开多选抽屉（`role=dialog`），列出有卡片的项目与数量，可多次勾选、`Clear` 清空、`Show N items` 关闭。控制器的 `typeCounts`（受项目过滤约束）与 `projectCounts`（受类型过滤约束）是两条约束方向，不是两次独立计数。选择按设备持久化（`rememberFilters` seam，`localStorage['cockpit.cards.filters.v1']`，存储不可读时退化为不记忆）；路由记忆仍是 sessionStorage。
- 列标题：`CockpitColumn.tsx` 标题行显示 `N waiting for you`（`openCount`）与 `M stuck`（`card.group === 'rescue'` 的计数——按组，不按 provider 分支）。
- 手机卡片页：`CockpitPage.tsx` 读 `useDeviceSettings({ trackPWA: false })` 的 `isMobile`，手机宽度下 `view=cards` 不渲染部署条、项目条与 Focus 行；wall / fleet / board 与桌面宽度保持原样。
- Details：底部常驻确认条（`sticky bottom-0`），标签与卡片当前显示选项一致（同一个 `confirmTargetOf` 派生）、按钮走同一个 `requestConfirm`，不可逆选项沿用 amber 样式；`subject.taskId` 存在时在主体行旁渲染「Open in Quay」（带 `data-task-id`），指向 `cockpitViewPath({ type: 'board', project })`，无 project 时回退 `/cockpit`。
- 输入框：placeholder 改为 `e.g. “the second one”, “zoom in”, “back”`（一行，不再溢出），下方新增 `Cockpit command · goes to the cockpit, not the session on the left`；8 个新 key 与改写后的 placeholder 覆盖 12 个语言包，`i18nCockpitCompleteness.test.ts` 增加对应断言。

### 判据实测

- AC1：`npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` → exit 0，31 tests（新增 `the type chips count what the project filter leaves` 两例、`the project selection is remembered per device` 三例：多选重建后恢复、类型过滤持久化且坏存储不记忆、单项目 shim 替换集合）。
- AC2：`npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx src/modules/cockpit/tests/CockpitCard.test.tsx` → exit 0，47 tests（列标题两例：3 张里 1 张 rescue 读 `3 waiting for you` / `1 stuck`，零 rescue 读 `0 stuck`；Details 四例：标签等于 `confirmTargetOf` 对当前选项的派生、切到 `park` 后标签变化且 `data-irreversible="true"`、无目标不画条、任务卡链接 `href=/cockpit?view=board&project=proj-7` 且带 `data-task-id`）。
- AC3：新文件 **`src/modules/cockpit/tests/cockpitCardsMobileShell.test.tsx`**，3 例全绿：390 宽度 `view=cards` 不渲染 `deploy-readiness` / `cockpit-project-strip` / `cockpit-focus`，但渲染胶囊、列表与输入框；同一 cards 视图在 1440 仍渲染三者；390 宽度的 `view=wall` 仍渲染三者（对照组，防「哪儿都不画」也蒙混过关）。
- AC4：`npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` → exit 0，20 files / 293 tests，全部既有文件在列。
- AC5：`npm run typecheck`、`npm run lint`、`npm run build:client` 均 exit 0；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` exit 0（6/6）。oversize 基线按 AC-394 RECORDED CHANGE 格式上调 `CockpitPage.tsx 1883→1902`、`cockpitCardController.ts 876→1047`——两处增量就是本任务的交付物（过滤与按设备记忆收在已有 controller；页面只加移动宽度读数与三个 `{!phoneCards && …}` 包裹），理由写进 baseline.note。合并 `develop` 后重跑 ratchet 仍 exit 0。

### DoD：隔离实例实页（本会话无 MCP 浏览器，改用一次性 Playwright `tmp/dod-capture.mjs`）

- 实例：`scripts/isolated-instance.sh start`，入口包装 `tmp/dod-entry.mjs` 在启动前把 `{"cockpit":{"enabled":true,"fixtureCards":true}}` 合并进隔离 settings；`http://127.0.0.1:13695`，`ok:true`，`resident_restore_started:0`；隔离 `HOME=/tmp/dod-cockpit-shell/home`（符号链接真实 `~/.claude`、`~/.claude.json`、`~/.quay-fleet`）。Vite dev 在 `127.0.0.1:5195`（`SERVER_PORT=13695`）。结构化读数：`tmp/dod-cockpit-shell/report.json`；截图的 page 404 只有 GitHub 公共 API 的 403 限流，无 `pageerror`。
- 390 宽度卡片页（`tmp/dod-cockpit-shell/m-cards.png` 对照 `80-m-list-cards.png`）：9 张夹具卡；胶囊 `All 9 / Needs you 1 / Stuck 2 / Fix 1 / Ask 3 / Multiple 1 / Decision 1`；胶囊行 top=69px、首卡 top=137px，均在首屏；`deploy-readiness`、`cockpit-project-strip`、`cockpit-focus` 三者都不存在；`body.scrollHeight=844` 无整页滚动；胶囊行 `clientWidth 374 / scrollWidth 443`，横向可滚动。
- 项目抽屉（`m-project-filter.png` 对照 `85-m-project-filter.png`）：标题「Filter by project」、`Clear`、`fixture-project 7`、`Show 9 items`；勾选后 `Show 7 items`，关闭后项目胶囊读作 `fixture-project▾`、渲染 7 张卡、类型计数随之变为 `ask 1`（原 3）——多选与两条计数约束都是实页读数。
- 任务卡 Details（`m-details.png` 对照 `87-m-details-top.png`）：`fixture:fix` 的 Details 底部确认条可见（y=765.5，视口高 844），标签 `Confirm · Apply the fix` 与卡片当前选项一致、可点；「Open in Quay」`href=/cockpit?view=board&project=fixture-project`、`data-task-id=fixture-task`，点击后 URL 变为该地址。⛔ 全程未点任何确认。
- 1440 列标题（`pc-open.png` 对照 `150-pc-open.png`）：会话页展开列后标题读作 `9 waiting for you` 与 `6 stuck`（rescue 组 6 张），列内 9 张夹具卡。
- 场景运行器（均打在本隔离实例上）：
  - `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json --base-url http://127.0.0.1:5195 …` → exit 0，`ok:true`，6 步、4074ms、5 检查点；报告 `tmp/dod-scenario-cards/report.json`。
  - `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` → exit 0，`ok:true`，3 步、4109ms、3 检查点；报告 `tmp/dod-scenario-mode/report.json`。

### 与效果图仍有的差异

- 效果图头部状态行（`idle · landed 5 · suite ✓ · deploy ✓` 与计数气泡）未实现：Proposal 只要求手机卡片页去掉旧外壳，没有要求新增状态行。
- 效果图的类型胶囊是分组语义（Stuck / Rulings / Needs you / Mine）；实现按卡片 kind 计数，因为控制器里的过滤状态本来就是 `CockpitCardTypeFilter`（kind）。「Mine」按 Proposal 的条件（主体会话由当前用户发起）不显示：卡片线上没有 owner 字段，夹具也没有。
- 效果图抽屉列出所有项目（含 0 张卡的 `quay`/`archguard`/`plantuml-js`）并带 `sessions · tasks` 副标题；实现按 Proposal「列出有卡片的项目及数量」只列有卡项目，副标题在线上没有数据来源。夹具只有一个 `fixture-project`，所以抽屉只显示一行、无法展示多项目。
- 效果图确认条是黑底；实现沿用主题的 `bg-primary`（不可逆时 amber），与卡片内确认条同一套颜色语义。
- 列标题的书写：效果图 `15 waiting for you · 2 stuck` 一行；实现是两个 span（等待数 + rescue 数），数值语义相同，样式沿用列头既有布局。
- 其余宽度/密度差异来自夹具数据（项目名、主体名、年龄 16.3h）与主题色，不属于本任务。

### 环境备注

隔离实例已 `scripts/isolated-instance.sh stop`（`port_still_serving:false`），Vite dev 同时停止；隔离 HOME 让真实 `~/.cloudcli/local-server.json` 未被改写。

## ADR-007 暗轴记录

该轴仍暗,理由:本任务只改驾驶舱过滤、手机外壳与 Details 的 UI/文案，AC 内没有 L_D/L_G 探针或读数可记
