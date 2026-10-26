---
id: ui-scenario-cockpit-card-readings
title: 场景运行器读出并操作驾驶舱卡片：语义面加卡片读数与 drive 动词，运行器加 cockpit-cards 打开方式与断言键，新增卡片场景
status: ready
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

- [x] `npx vitest run src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts` 退出 0（AC-426 判据）：在 jsdom 里挂一份带 `data-cockpit-cards` 的卡片列表夹具，断言读数字段与顺序、属性缺失时读作 null、五个 drive 动词经 DOM 控件触发后读数相应变化；生产构建开关关闭时语义面不挂载。→ `Test Files 1 passed (1) / Tests 4 passed (4)`，退出 0。
- [x] 假形态变红：drive 动词改为直接写入读数而不点击控件 ⇒ 用例红（夹具控件的点击计数为 0）；改完即还原。→ 见下「假形态」记录。
- [x] 现有语义面不退：`npx vitest run src/modules/ui-scenario/tests/scenarioSurface.test.ts` 退出 0，既有用例数不减少。→ `Test Files 1 passed (1) / Tests 2 passed (2)`，退出 0；该文件本任务未改。
- [x] `node --check scripts/ui-scenario.mjs` 退出 0；`npm run typecheck` 与 `npm run lint` 退出 0。→ 三者均退出 0（lint 仅既有 warning，新文件无告警）。

## DoD

在隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`）上实际运行 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json --base-url <实例地址> --auth-token <令牌> --project <项目名> --session <会话名> --out tmp/ui-scenario-cockpit-cards`，退出 0，贴出 JSON 报告与检查点截图；同时读夹具执行器记录，恰好多出场景确认的那一条。再跑一次 `e2e/scenarios/cockpit-mode-switch.json` 贴出报告，证明旧场景不退。用 MCP 浏览器打开同一视图，`browser_evaluate('window.__cloudcliScenario.read()')` 取一次读数，截图存 `tmp/`。实例用毕 `scripts/isolated-instance.sh stop`。

### 完成记录（2026-10-27）

**实现要点。** `read().cockpit.cards` 严格解析 `data-cockpit-cards`（缺失/非 JSON/形状不完整 ⇒ null），`confirmOpenCardId` 从确认面板自身的 `data-card-id` 读出，不猜。五个 drive 动词只派发真实事件（pointerdown / click / 原生 setter + input）。React 18 在事件处理返回后才提交离散更新，所以一个卡片步骤是两次按压：`drive` 做第一次按压并登记后续，`settle()` 跨一个宏任务边界后按第二次（下拉里的选项、自己的回复编辑框、确认卡的发送），再跨一次边界让读数看到提交结果；运行器每步 drive 后 await `settle()`。两半都是真实 DOM 按压，动词从不写 `data-cockpit-cards`。

**本轮修复（超长文件棘轮）。** 上一轮 fan-in 只红 `architecture-ratchet` 的 `oversizeFiles src/modules/ui-scenario/scenarioSurface.ts 基线外→1018`（基线外文件上限 800 行）。把卡片读数与五个 `cockpitCard.*` 动词的实现整体拆到同模块新文件 `src/modules/ui-scenario/cockpitCardsSurface.ts`（411 行），`scenarioSurface.ts` 降到 654 行，两个文件都在 800 行上限内；`index.ts` 桶改为从新文件导出 `ScenarioCockpitCardTarget` / `ScenarioCockpitCardsReading`，跨模块导入路径不变，行为不变。本轮复跑：`architecture-ratchet.test.ts` ⇒ 6/6 通过；两条 AC 判据合计 6/6 通过（4+2）；`npm run typecheck` 与 `npm run lint` 退出 0。基线只允许下降，未上调任何读数。

**AC1** `npx vitest run src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts` ⇒
`Test Files 1 passed (1) / Tests 4 passed (4)`，退出 0（夹具就是真实 `CockpitCardList`，HTTP 缝被 stub；四条用例分别覆盖读数与顺序、缺失/坏属性读 null、五个动词经控件驱动且读数跟随、生产构建开关关闭不挂载）。

**AC2 假形态**（备份 `scenarioSurface.ts` 到 `/tmp/scenarioSurface.ac2-backup.ts`，sha256 `0bfc023d…`）：把五个动词改成不按压、直接改写 `data-cockpit-cards`（confirm 连按压都不做）⇒ 同一条判据红：
`Test Files 1 failed (1) / Tests 1 failed | 3 passed (4)`
`AssertionError: selecting was a pointer press on the second card, not a state write`
——它上面那条读数断言已经通过（`selectedCardId` 被直接写成 `fixture:decision`），红在点击账本为空，正是「读数动了但没有按压控件」。随即用备份字节级还原（sha256 相同）并复跑 ⇒ `Tests 4 passed (4)`。

**AC3** `npx vitest run src/modules/ui-scenario/tests/scenarioSurface.test.ts` ⇒ `Test Files 1 passed (1) / Tests 2 passed (2)`，退出 0；文件未改动，用例数未减。

**AC4** `node --check scripts/ui-scenario.mjs` ⇒ 退出 0；`npm run typecheck`（client / server / scripts 三个 tsconfig）⇒ 退出 0；`npm run lint` ⇒ 退出 0。

**隔离实例**：`ISOLATED_INSTANCE_SERVER_ENTRY=/tmp/ui-scenario-cockpit-card-readings-entry.mjs scripts/isolated-instance.sh start`（state dir = 本 worktree `tmp/isolated-instance`）⇒
`{"port":7439,"ok":true,"resident_restore_started":0}`；入口包装只把 `{"cockpit":{"enabled":true,"fixtureCards":true}}` 合并进隔离 settings（`residentRestore.enabled:false` 保留）。生产 dist 无语义面，故客户端用本 worktree 的 Vite dev server 且 `SERVER_PORT=7439` 代理到同一实例：
`CI=true SERVER_PORT=7439 node node_modules/vite/bin/vite.js --port 5199 --host 127.0.0.1`。

**场景报告**（`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json --base-url http://127.0.0.1:5199 --auth-token <token> --project lan --session pwd --out tmp/ui-scenario-cockpit-cards`）：

```json
{
  "ok": true,
  "failedStep": null,
  "stepCount": 6,
  "durationMs": 6116,
  "checkpoints": [
    "tmp/ui-scenario-cockpit-cards/step-1-open-cockpit-cards.png",
    "tmp/ui-scenario-cockpit-cards/step-2-drive-cockpitCard.select.png",
    "tmp/ui-scenario-cockpit-cards/step-3-drive-cockpitCard.showOption.png",
    "tmp/ui-scenario-cockpit-cards/step-4-drive-cockpitCard.confirm.png",
    "tmp/ui-scenario-cockpit-cards/step-5-drive-cockpitCard.select.png"
  ],
  "steps": [
    { "index": 1, "action": "open:cockpit-cards", "ok": true, "route": "/cockpit?view=cards", "visible": ["fixture:need","fixture:stuck","fixture:fix","fixture:ask","fixture:multi","fixture:decision"], "selected": "fixture:need" },
    { "index": 2, "action": "drive:cockpitCard.select", "ok": true, "selected": "fixture:need", "needShownOption": "provide" },
    { "index": 3, "action": "drive:cockpitCard.showOption", "ok": true, "needShownOption": "later", "needConfirmTarget": {"optionId":"later","label":"Later"} },
    { "index": 4, "action": "drive:cockpitCard.confirm", "ok": true, "confirmOpenCardId": null, "needConfirmTarget": {"optionId":"later","label":"Later"} },
    { "index": 5, "action": "drive:cockpitCard.select", "ok": true, "selected": "fixture:decision", "decisionShownOption": null },
    { "index": 6, "action": "expect", "ok": true, "decisionConfirmTarget": {"optionId":null,"label":null} }
  ]
}
```

（完整报告在 `tmp/ui-scenario-cockpit-cards/report.json`；五张检查点截图已逐张打开核对：step-3 卡片显示 `Later / Provider 2 of 2` 且确认条为 `Confirm · Later`，step-4 顶部出现 `Confirmed — fixture.record ran.`。）

**夹具执行器记录**：本会话无 MCP 浏览器，按项目备忘用一次性 Playwright 脚本驱动真实页面（`tmp/dod-cockpit-cards-probe.mjs`，gitignored），在场景跑完后额外确认一次 `fixture:stuck → park` 并捕获确认接口的响应体：

```json
{
  "status": 200,
  "body": {
    "ok": true,
    "cardId": "fixture:stuck",
    "executor": "fixture.record",
    "params": { "cardId": "fixture:stuck", "optionId": "park" },
    "result": { "total": 2 }
  }
}
```

夹具 provider 起于空数组，场景确认了 `fixture:need → later` 一条，本探针是第二条 ⇒ `total=2`，即恰好多出场景确认的那一条。探针读数（等价于 `browser_evaluate('window.__cloudcliScenario.read()')`）在 `tmp/dod-cockpit-cards/mcp-probe-report.json`；截图 `tmp/dod-cockpit-cards/mcp-cards-view.png`（六张卡、第一张选中）与 `tmp/dod-cockpit-cards/mcp-after-confirm.png`（`Confirmed — fixture.record ran.`，stuck 卡显示 `Park it`）。

**旧场景不退**：`cockpit-mode-switch.json` ⇒ `{"ok":true,"failedStep":null,"stepCount":3,"durationMs":4826}`，路线 `/session/0dd6d3a0-…` → `/cockpit?view=fleet` → `/session/0dd6d3a0-…`（回到同一会话；未注册项目打开 fleet 概览是产品答案）。

**用毕**：`scripts/isolated-instance.sh stop` ⇒ `{"ok":true,"port_still_serving":false}`；Vite dev server 一并停止。

**偏差与取舍**：提案写「确认卡是否打开」，但 `data-cockpit-cards` 并未携带该事实；本任务从确认面板自身的 `data-card-id` 诚实读出，没有改驾驶舱源码（不在 Touches 内），也没有伪造。确认动作按产品「两次按压」语义拆成 `drive`（开卡）+`settle`（发送并等响应），因此运行器每步后 await settle；这使确认动词的「读卡已打开」中间态在单元判据里可观察，最终读数仍是发送后的状态。

## ADR-007 轴记录

- 该轴仍暗,理由:本任务只做开发构建下的场景读数与驱动面，不新增领域数据的生成或持久化，L_D/L_G 两轴没有独立读数；行为由 AC-426 判据、隔离实例场景报告与夹具执行器记录覆盖。

## Touches

- tasks/ui-scenario-cockpit-card-readings.md
- src/modules/ui-scenario/scenarioSurface.ts
- src/modules/ui-scenario/cockpitCardsSurface.ts (new)
- src/modules/ui-scenario/index.ts
- src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts (new)
- src/modules/ui-scenario/tests/scenarioSurface.test.ts
- scripts/ui-scenario.mjs
- e2e/scenarios/cockpit-cards-confirm.json (new)
