---
id: cockpit-card-ui-core
title: 驾驶舱卡片界面核心：React 之外的 createCockpitCardController + CockpitCard
  组件（三个触摸区、富文本选项下拉、自己的回复、单一确认经确认卡），以 /cockpit?view=cards 非破坏挂载
status: ready
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
depends_on:
  - cockpit-card-provider-contract-and-registry
goal_ac: AC-424
---
## Proposal

来源：本会话 2026-10-26 至 10-27 用户确认的手机卡片模型（`docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md` G 节，效果图 80 至 90 号）与 PC 右侧列模型（H 节）。两种外壳共用同一张卡片与同一个 controller；本任务只做卡片核心，以新视图 `/cockpit?view=cards` 挂载，现有 wall、fleet、board 三个视图与其测试不动，PC 右侧列、手机 header 与驾驶舱页留给后续任务。

数据来自 `cockpit-card-provider-contract-and-registry` 交付的 `GET /api/cockpit/cards` 与 `POST /api/cockpit/cards/confirm`（类型取 `src/shared/types.ts` 的 CockpitCard 镜像）。

做什么：

- `src/modules/cockpit/cockpitCardController.ts`：`createCockpitCardController(deps)`，React 之外，依赖经注入（取卡、确认请求、时钟）。状态：卡片列表、选中卡片、类型与项目过滤、密度（cards 与 compact）、Details 栈、每张卡片当前显示的选项、确认卡状态。规则：每张卡片只有一个确认，绑定当前显示的选项；切换显示的选项即切换确认目标；自己的回复走同一确认路径；第一次确认进入确认卡，第二次才发请求且恰好一次，取消则不发；提供方没有 suggested 时默认不显示任何选项、确认不可用；数字键 1 至 9 只选选项；不处理 Escape。新 revision 到达时原位更新，选中与滚动锚点不跳。
- `src/modules/cockpit/hooks/useCockpitCards.ts`：只做订阅与绑定。
- `src/modules/cockpit/CockpitCard.tsx`：A 区（头部、问题、情境、事实）点按打开 Details；B 区为选项下拉，每项显示该选项的富文本说明（做什么与后果标签），最后一项是「自己的回复」编辑框；C 区为确认条，标签带当前选项名，不可逆选项为警示样式。卡片上没有独立的 Alternatives 或 Details 按钮。
- `src/modules/cockpit/cockpitCardDescriptors.ts`：kind 与小可视化（attempts、steps、history、size、parts）的描述表；未知 kind 走默认描述，不按提供方或 kind 写分支。
- `src/modules/cockpit/CockpitCardList.tsx` 与 `CockpitCardDetails.tsx`：列表顶部类型与项目过滤、密度切换；Details 抽屉内有会话链接，没有会话时显示「就此开一个会话」（本任务只发出意图回调，不实现开会话）。
- `src/modules/cockpit/cockpitView.ts` 与 `cockpitRouting.ts` 加 `cards` 视图；`CockpitStage.tsx` 在该视图下挂载卡片列表。卡片列表在根节点发布 `data-cockpit-cards` 读数属性（可见卡片 id 与顺序、选中卡片、各卡显示的选项与确认目标、Details 是否打开），供场景运行器任务读取。
- 新文案进 locale：所有语言的 `common.json` 补齐，并刷新 locale key 集 digest 钉子与驾驶舱 i18n 完整性测试。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0（AC-424 判据）：覆盖单一确认绑定当前选项、切换选项切换确认目标、自己的回复同一路径、确认卡后恰好一次请求、取消零次、无 suggested 时无默认选项且确认不可用、数字键只选选项、Escape 不被处理、新 revision 原位更新不改选中卡片。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0（AC-425 判据）：覆盖 A 区点按请求打开 Details、无独立 Alternatives 与 Details 按钮、下拉每项富文本且末项为自己的回复编辑框、确认条标签带选项名、不可逆选项警示样式、未知 kind 走默认渲染不报错。
- [ ] 假形态各自变红：确认不经确认卡直接发请求 ⇒ controller 用例红；在提供方无 suggested 时默认显示第一个选项 ⇒ 用例红；给卡片加一个独立 Details 按钮 ⇒ 组件用例红。每个假形态改完即还原。
- [ ] 现有驾驶舱测试不退：`npx vitest run src/modules/cockpit/tests` 退出 0，既有用例数不减少。
- [ ] `npx vitest run src/modules/chat/tests/inlineQuoteChip.test.tsx src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（locale key 集 digest 已按新增 key 刷新）。
- [ ] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0。

## DoD

在隔离实例（`scripts/isolated-instance.sh start`）里打开 `cockpit.fixtureCards`，用 MCP 浏览器在 390 与 1280 两个宽度打开 `/cockpit?view=cards` 实际操作：按类型与项目过滤各一次；切到 compact 再切回；在一张有推荐的卡片上展开下拉、换成另一个选项、确认条标签随之变化，确认并在确认卡上再确认，读夹具执行器记录恰好多一条；在一张无推荐的卡片上确认不可用；用自己的回复写一句并确认；点按 A 区打开 Details 并看到会话链接。每一步截图存 `tmp/`，在完成记录里贴出。

场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json` 贴出 JSON 报告（证明旧视图未被破坏）；卡片读数与操作的场景由 `ui-scenario-cockpit-card-readings` 任务交付，本任务如实记录此处尚无卡片场景。隔离实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-card-ui-core.md
- src/modules/cockpit/cockpitCardController.ts (new)
- src/modules/cockpit/cockpitCardDescriptors.ts (new)
- src/modules/cockpit/CockpitCard.tsx (new)
- src/modules/cockpit/CockpitCardList.tsx (new)
- src/modules/cockpit/CockpitCardDetails.tsx (new)
- src/modules/cockpit/hooks/useCockpitCards.ts (new)
- src/modules/cockpit/cockpitView.ts
- src/modules/cockpit/cockpitRouting.ts
- src/modules/cockpit/CockpitStage.tsx
- src/modules/cockpit/index.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts (new)
- src/modules/cockpit/tests/CockpitCard.test.tsx (new)
- src/modules/cockpit/tests/cockpitRouting.test.ts
- src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts
- src/modules/chat/tests/inlineQuoteChip.test.tsx
- src/shared/api.ts
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
