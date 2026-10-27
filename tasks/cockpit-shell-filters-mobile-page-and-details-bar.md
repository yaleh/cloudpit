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

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：各类型胶囊的计数等于该类型 open 卡片数且受项目过滤约束；项目过滤多选并在重建 controller 后恢复。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例：列标题含等待数与 rescue 组数；Details 渲染底部确认条且标签与卡片当前选项一致；有 taskId 的卡片 Details 含「在 Quay 中打开」链接。
- [ ] 新增用例断言手机宽度的 `view=cards` 不渲染部署条、项目条与 Focus 行，而 `view=wall` 仍渲染（文件放在 `src/modules/cockpit/tests/` 下，名称在完成记录写明）。
- [ ] 现有测试不退：`npx vitest run src/modules/cockpit/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少。
- [ ] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

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
