---
id: ui-scenario-cockpit-card-readings
title: 场景运行器读出并操作驾驶舱卡片：语义面加卡片读数与 drive 动词，运行器加 cockpit-cards 打开方式与断言键，新增卡片场景
status: todo
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
depends_on:
  - cockpit-card-ui-core
goal_ac: AC-426
---
## Proposal

来源：AGENTS.md 要求 UI 任务的 DoD 同时有 MCP 浏览器实操与场景运行器报告；现有语义面（`src/modules/ui-scenario/scenarioSurface.ts`）对驾驶舱只读 `data-cockpit-view`、`data-cockpit-focusables`、`data-cockpit-focus` 与回声节点，没有卡片读数，后续 PC 右侧列与手机驾驶舱页任务没有可回归的场景。本任务给卡片视图补齐读数与操作，使驾驶舱卡片的业务场景能以运行器为准回归。

做什么：

- 读数：`scenarioSurface.ts` 的驾驶舱读数增加 `cards` 字段，来自 `cockpit-card-ui-core` 发布的 `data-cockpit-cards` 属性——可见卡片 id 与顺序、选中卡片、每张卡片当前显示的选项与确认目标、确认卡是否打开、Details 是否打开。属性缺失或格式错误时读作 null，不猜。语义面仍不被驾驶舱页面导入，生产构建不挂载。
- 操作：`drive` 增加 `cockpitCard.select`、`cockpitCard.showOption`、`cockpitCard.ownReply`、`cockpitCard.confirm`、`cockpitCard.openDetails` 五个动词，经页面上与人相同的控件触发（点击与输入），不直接改 controller 状态。
- 运行器：`scripts/ui-scenario.mjs` 增加打开方式 `cockpit-cards`（经模式切换进入驾驶舱后切到 cards 视图）与断言键 `cockpitCardsVisible`、`cockpitCardSelected`、`cockpitCardShownOption`、`cockpitCardConfirmTarget`；未知键仍判失败。
- 场景：新增 `e2e/scenarios/cockpit-cards-confirm.json`：进入卡片视图，选中一张有推荐的卡片，换选项，确认，读出确认目标；对无推荐的卡片读出确认不可用。

## AC

- [ ] `npx vitest run src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts` 退出 0（AC-426 判据）：在 jsdom 里挂一份带 `data-cockpit-cards` 的卡片列表夹具，断言读数字段与顺序、属性缺失时读作 null、五个 drive 动词经 DOM 控件触发后读数相应变化；生产构建开关关闭时语义面不挂载。
- [ ] 假形态变红：drive 动词改为直接写入读数而不点击控件 ⇒ 用例红（夹具控件的点击计数为 0）；改完即还原。
- [ ] 现有语义面不退：`npx vitest run src/modules/ui-scenario/tests/scenarioSurface.test.ts` 退出 0，既有用例数不减少。
- [ ] `node --check scripts/ui-scenario.mjs` 退出 0；`npm run typecheck` 与 `npm run lint` 退出 0。

## DoD

在隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`）上实际运行 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json --base-url <实例地址> --auth-token <令牌> --project <项目名> --session <会话名> --out tmp/ui-scenario-cockpit-cards`，退出 0，贴出 JSON 报告与检查点截图；同时读夹具执行器记录，恰好多出场景确认的那一条。再跑一次 `e2e/scenarios/cockpit-mode-switch.json` 贴出报告，证明旧场景不退。用 MCP 浏览器打开同一视图，`browser_evaluate('window.__cloudcliScenario.read()')` 取一次读数，截图存 `tmp/`。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/ui-scenario-cockpit-card-readings.md
- src/modules/ui-scenario/scenarioSurface.ts
- src/modules/ui-scenario/index.ts
- src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts (new)
- src/modules/ui-scenario/tests/scenarioSurface.test.ts
- scripts/ui-scenario.mjs
- e2e/scenarios/cockpit-cards-confirm.json (new)
