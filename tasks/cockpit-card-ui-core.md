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

- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0（AC-424 判据）：覆盖单一确认绑定当前选项、切换选项切换确认目标、自己的回复同一路径、确认卡后恰好一次请求、取消零次、无 suggested 时无默认选项且确认不可用、数字键只选选项、Escape 不被处理、新 revision 原位更新不改选中卡片。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0（AC-425 判据）：覆盖 A 区点按请求打开 Details、无独立 Alternatives 与 Details 按钮、下拉每项富文本且末项为自己的回复编辑框、确认条标签带选项名、不可逆选项警示样式、未知 kind 走默认渲染不报错。
- [x] 假形态各自变红：确认不经确认卡直接发请求 ⇒ controller 用例红；在提供方无 suggested 时默认显示第一个选项 ⇒ 用例红；给卡片加一个独立 Details 按钮 ⇒ 组件用例红。每个假形态改完即还原。
- [x] 现有驾驶舱测试不退：`npx vitest run src/modules/cockpit/tests` 退出 0，既有用例数不减少。
- [x] `npx vitest run src/modules/chat/tests/inlineQuoteChip.test.tsx src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（locale key 集 digest 已按新增 key 刷新）。
- [x] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0。

## DoD

在隔离实例（`scripts/isolated-instance.sh start`）里打开 `cockpit.fixtureCards`，用 MCP 浏览器在 390 与 1280 两个宽度打开 `/cockpit?view=cards` 实际操作：按类型与项目过滤各一次；切到 compact 再切回；在一张有推荐的卡片上展开下拉、换成另一个选项、确认条标签随之变化，确认并在确认卡上再确认，读夹具执行器记录恰好多一条；在一张无推荐的卡片上确认不可用；用自己的回复写一句并确认；点按 A 区打开 Details 并看到会话链接。每一步截图存 `tmp/`，在完成记录里贴出。

场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json` 贴出 JSON 报告（证明旧视图未被破坏）；卡片读数与操作的场景由 `ui-scenario-cockpit-card-readings` 任务交付，本任务如实记录此处尚无卡片场景。隔离实例用毕 `scripts/isolated-instance.sh stop`。

## Evidence（2026-10-27）

判据读数（均在任务 worktree `/data/home/yale/work/claudecodeui-worktrees/cockpit-card-ui-core` 内执行）：

- AC1 `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts`：`Test Files 1 passed (1) / Tests 18 passed (18)`，退出 0。
- AC2 `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx`：`Test Files 1 passed (1) / Tests 9 passed (9)`，退出 0。
- AC3 假形态三腿各自变红后还原：
  - 确认条直接发请求（跳过确认卡）⇒ controller 判据 5 条用例红；
  - 提供方无 suggested 时仍默认显示第一个选项 ⇒ 1 条用例红；
  - 卡片上加一个独立 Details 按钮 ⇒ 组件判据 1 条红。
  还原后两文件合计 `Tests 27 passed (27)`。
- AC4 `npx vitest run src/modules/cockpit/tests`：`Test Files 15 passed (15) / Tests 201 passed (201)`（新增两张判据文件共 27 条，既有用例一条未减）。
- AC5 `npx vitest run src/modules/chat/tests/inlineQuoteChip.test.tsx src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts`：`Test Files 2 passed (2) / Tests 23 passed (23)`。如实记录：`inlineQuoteChip.test.tsx` 的两个 key 集 digest 钉读的是 `chat.json`，本任务新增文案在 `common.json` 的 `cockpit` 段，因此这两个钉**保持原值未刷新**（按新 key 刷新反而会假红），并在该判据的注释里写明了原因；新增 46 个 `cockpit.card*` key 的完整性由 `i18nCockpitCompleteness.test.ts` 的新用例覆盖。
- AC6 `npm run typecheck` 退出 0；`npm run lint` 退出 0（仅既有 warning，新文件无告警）；`npm run build:client` 退出 0（`✓ built in 24.43s`）。

DoD（隔离实例 + 真实浏览器；本会话无 MCP 浏览器可用，按项目备忘用一次性 Playwright 驱动真实页面，脚本在 `/tmp/cockpit-card-ui-dod.mjs`，不在仓库内）：

- 实例：`ISOLATED_INSTANCE_SERVER_ENTRY=/tmp/cockpit-card-ui-dod-entry.mjs scripts/isolated-instance.sh start` ⇒ `base_url=http://127.0.0.1:13671`、`ok:true`；入口包装只把 `{"cockpit":{"enabled":true,"fixtureCards":true}}` 合并进隔离 settings 文件（`residentRestore.enabled:false` 保留）。
- 390 与 1280 两个宽度各跑一遍同一组操作，读数一致：
  - 首屏六张卡都在，顺序 `fixture:need, stuck, fix, ask, multi, decision`，`density=cards`；
  - 类型过滤 `fix` ⇒ `visibleCardIds=["fixture:fix"]`；
  - 项目过滤 `fixture-project` ⇒ `projectFilter=fixture-project` 且六张卡仍在；
  - 密度 compact 再切回 cards，读数分别 `compact` / `cards`；
  - `fixture:need` 展开下拉换成 `later`：确认条 `Confirm · Provide the credential` → `Confirm · Later`；点确认打开确认卡（`confirmOptionId=later`，面板文案 `This sends “Later” once.`），再点发送恰好一次：请求体 `{"cardId":"fixture:need","revision":2,"optionId":"later"}`，响应 `{"ok":true,"executor":"fixture.record",...,"total":3}`；
  - 无推荐的 `fixture:decision`：确认条 `Nothing to confirm` 且 `disabled=true`；
  - `fixture:ask` 用自己的回复 `Keep it for one more day.`：请求体 `{"cardId":"fixture:ask","revision":2,"replyText":"Keep it for one more day."}`（无 optionId），响应 `"total":4` —— 相对上一条恰好多 1；1280 轮同样读到 5 → 6；
  - A 区点按打开 Details：会话链接 `href=/session/fixture-session`，文案 `Open conversation fixture-session`。
- 截图（每宽度 11 张，`tmp/dod-shots/`）：`dod-390-01-initial.png`、`-02-filter-type`、`-03-filter-project`、`-04-compact`、`-05-option-switched`、`-06-confirm-card`、`-07-confirmed`、`-08-no-recommendation`、`-09-own-reply`、`-10-own-reply-sent`、`-11-details`，以及同名的 `dod-1280-*` 一套；完整读数在 `tmp/dod-shots/dod-report.json`。
- 场景运行器（生产 dist 无语义面，故指向本 worktree 的 Vite dev server，`SERVER_PORT=13671` 代理到同一隔离实例）：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json --base-url http://127.0.0.1:5199 ...` ⇒ `"ok": true, "failedStep": null, "stepCount": 3, "durationMs": 7725`，三步读数 `route=/session/1d38…` → `route=/cockpit?view=board&project=quay-fleet, cockpit.view=board` → `route=/session/1d38…`，证明既有视图未被卡片视图破坏。如实记录：`ui-scenario` 的 opener 词表里没有进入 `?view=cards` 的入口，卡片读数与操作的场景由 `ui-scenario-cockpit-card-readings` 任务交付，本条只用真实浏览器 DoD 覆盖。
- 用毕 `scripts/isolated-instance.sh stop` ⇒ `{"ok":true,"port_still_serving":false}`。

如实记录的偏差与取舍：

- 「自己的回复」编辑框只在提供方声明 `ownReply` 的卡片上渲染，因为服务端对未声明 `ownReply` 的卡片拒绝 `replyText`（会 400）；`fixture:decision` 这类卡片的下拉末项因此不出现编辑框。控制器同样拒绝为这类卡片设置回复。
- `dist/` 与 `dist-server/` 是 gitignore 产物；为 DoD 额外跑了 `npm run build:server`，不入提交。

## ADR-007 轴记录

- 该轴仍暗,理由:本任务只做驾驶舱卡片界面与 React 之外的 controller，不新增领域数据的生成或持久化能力，L_D/L_G 两轴没有可读读数；界面行为由 AC-424/AC-425 判据、隔离实例真实浏览器读数与场景运行器覆盖。

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
- src/modules/cockpit/CockpitPage.tsx
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
