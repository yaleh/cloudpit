---
id: gap-cockpit-card-details-dismiss-action
title: Cockpit 卡片详情补齐忽略/丢弃入口与结果反馈
status: ready
labels:
  - gap
  - defect
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

用户反馈：Cockpit 卡片详情打开后没有 Ignore/discard，必须返回列表才能操作。本会话代码检查确认：CockpitCard.tsx 已渲染忽略控件，CockpitCardList.tsx 只给列表行传 dismissTarget、pending、dismissing 与三条命令；两处 CockpitCardDetails 调用均未接入，详情 props 无 dismiss 读数，固定底栏仅依赖发送 target 渲染。dismissNotice 位于列表分支，桌面内嵌详情不挂载该提示，浮层详情也会遮住列表提示。因此不能只补按钮而不补结果反馈。

按已讨论方案，在详情固定底栏增加“忽略 / 丢弃”次要按钮，与发送动作分开；提取模块内共用 CockpitCardDismissBar，由列表和详情复用。沿用现有 controller.requestDismiss/confirmDismiss/cancelDismiss 和 dismiss transport，不在 React 组件中另建状态机，不把忽略当作回答选项。列表、桌面内嵌详情、桌面弹层和手机抽屉读取同一个控制器状态。底栏是否存在应兼顾 dismiss target，不能因为没有可发送选项而隐藏有效忽略入口。

保留既有资格：仅支持 dismiss 的 ask 卡提供入口，已有 feedback 的卡不提供；首次点击仅展开“确认忽略 / 取消”，不改变选中项或回复草稿；发送确认、倒计时、发送中与忽略中不得触发冲突请求，禁用态必须可见。请求中防重复提交。失败留在详情内显示该卡错误且可重试；成功刷新后卡片消失，关闭该卡详情回到列表，在仍然挂载的提示位置显示“已忽略”，保留过滤条件、选择与列表位置。刷新失败不得把仍在页面的卡片伪装成已消失，应给出可理解的失败读数。

<!-- dedup-ref --> 相关已完成任务 gap-cockpit-card-dismiss-disposition 建立 dismiss 通道，gap-cockpit-card-dismiss-fleet-revision-and-receipt 修复真实 fleet revision 与回执。本任务补齐详情展示和交互接线，复用两者机制，不重做服务端。机制查重未发现重复；task-granularity-advice 对四个现有核心源文件返回 peers=[]、mentions=[]，无合并候选，独立立案。

## AC

- [x] AC1：执行 bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx --maxWorkers=1 退出 0。覆盖共用忽略控件与详情：ask 可用、非 ask/已有 feedback 不提供、无发送 target 仍可忽略、首次点击不发送、取消不改选项和草稿、请求中禁用重复操作。
- [x] AC2：执行 bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts --maxWorkers=1 退出 0。覆盖 dismiss 与发送互斥、确认请求只走 dismiss、不调用发送执行器、失败可重试、成功重读删除卡片并清理详情；保留既有 revision 与反馈锁保护。
- [x] AC3：执行 bash scripts/with-memory-cap.sh npx vitest run src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx --maxWorkers=1 与同命令单独运行 src/modules/cockpit/tests/CockpitColumn.test.tsx，分别退出 0。验证手机抽屉和桌面侧栏接入同一忽略状态，失败在详情可见，成功返回列表提示仍可见且位置与过滤条件保留。测试必须断言请求及界面结果，不能只断言新增按钮存在。
- [x] AC4：npm run typecheck、npm run build:client、npm run lint 分别退出 0；遵循 frontend-module-standards，忽略交互规则归 controller，控件只展示状态和转发命令。测试逐文件运行，不在会话内运行无并发限制的多文件测试或完整套件。
- [x] AC5：以可用的 e2e/scenarios/cockpit-cards-dismiss.json 为基础扩展详情场景，执行 node scripts/ui-scenario.mjs <scenario.json> …，JSON 报告 ok=true 且无失败步骤，检查点截图写入 tmp/。报告应可机械确认从详情发起忽略、取消、最终卡片消失和成功提示；不得只跑列表忽略代替详情验收。

## DoD

必须在实际运行的隔离页面通过 MCP 浏览器亲手操作桌面侧栏详情、桌面卡片页弹层和手机抽屉，至少完成进入详情、忽略、取消、重新忽略并确认；验证请求中锁定、失败提示与重试、成功返回列表及位置保留。截图保存 tmp/，在本任务完成记录贴出路径与对应场景，不能以组件测试或截图文件存在代替实际交互。

真实或隔离 fleet ask 卡经详情操作后，从可见列表及 API 读数消失，原会话没有新增回答或推理回合；保存 dismiss 请求、响应和前后读数，证明没有调用发送通道。失败路径保留卡片与草稿，错误在详情可见，重试能再次请求。运行场景运行器并贴出 JSON 报告及检查点截图；失败诊断优先一次读取 window.__cloudcliScenario.read()，使用开发构建和 ui-scenario=1 开启语义面。完成记录同时提供窄范围测试、构建与静态检查结果。

## 完成记录

实现：新增共用 `CockpitCardDismissBar`（列表行与详情底栏共用同一组 `data-card-id`/`data-dismiss-pending` 与三条命令）；`CockpitCardDetails` 接入 `dismissTarget`/`dismissPending`/`dismissing`/`dismissNotice`，无发送 target 但存在 dismiss target 时仍渲染忽略入口；桌面内嵌列、卡片页浮层、手机抽屉三处详情共用同一 controller 状态；ui-scenario 增加详情范围内的 open/confirm/cancel 驱动与 `detailsOpenCardId`/`dismissOpenCardId` 读数，场景扩为 7 步详情流程。

窄范围测试（worktree，逐文件 `bash scripts/with-memory-cap.sh npx vitest run <file> --maxWorkers=1`）：
- `CockpitCard.test.tsx` 93 passed，exit 0（tmp/ac-CockpitCard.log）
- `cockpitCardController.test.ts` 73 passed，exit 0（tmp/ac-cockpitCardController.test.log）
- `cockpitCardsMobileDetails.test.tsx` 18 passed，exit 0（tmp/ac-cockpitCardsMobileDetails.log）
- `CockpitColumn.test.tsx` 19 passed，exit 0（tmp/ac-CockpitColumn.log）
- `cockpitCardsSurface.test.ts` 6 passed，exit 0（tmp/ac-cockpitCardsSurface.test.log）

静态检查：`npm run typecheck`、`npm run build:client`、`npm run lint` 均 exit 0（tmp/ac4-typecheck.log、tmp/ac4-build-client.log、tmp/ac4-lint.log）。

场景运行器（AC5）：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-dismiss.json` → `ok: true`，7 steps / 5238ms，报告 `tmp/ui-scenario-dismiss/report.json`，检查点截图 `tmp/ui-scenario-dismiss/step-1-open-cockpit-cards.png` … `step-7-drive-cockpitCard.confirmDismissFromDetails.png`。步骤 3 打开详情、4 从详情发起忽略、5 从详情取消、6 重开、7 从详情确认；断言取 `data-cockpit-cards` 读数与 dismiss bar 的 `data-card-id`/`data-dismiss-pending`，驱动只按抽屉控件，不以列表行代替。

真实浏览器 DoD（隔离实例 :3111 + worktree vite :5199，`tmp/dod-cockpit-dismiss.mjs`，page/fail/phone/column 四条腿）：36 checks、0 failures，报告 `tmp/dod/report.json`，截图 `tmp/dod/01-page-list.png` … `tmp/dod/16-column-dismissed.png`。
- 桌面浮层详情：进入详情→忽略→取消→重开→确认（02/03/04/05/06）；请求中确认与取消同时禁用（05）。
- 失败路径：502 在详情内显示且卡片/详情保留，重试可再次发起（07/08/09）。
- 手机抽屉：进入详情→取消→确认，卡片消失（10/11/12）。
- 真实会话页 PC 列：详情内推、取消保留详情、确认后回到列表且列表不跳回顶部（13/14/15/16）。
- 发送通道：`confirmRequests: []`，四条腿全程零确认/回答请求。
- dismiss 请求体：`{"cardId":"fixture:ask","revision":1}`（page）、`{"cardId":"fixture:session-only","revision":1}`（fail 首次 502）、`{"cardId":"fixture:content-unavailable","revision":1}`（phone）、`{"cardId":"fixture:session-only","revision":1}`（column）。
- 前后读数：确认后目标卡从 `visibleCardIds` 消失（9→8；列内 6 条剩 5），`detailsOpenCardId` 回到 `null`，列表提示 `data-ok="true"`。

本轮（重跑落地，修复首轮 fan-in suite 红）：
- 把整组 `cockpitCard.*` 的 drive 分发（含三个详情命令）搬进 `cockpitCardsSurface.ts` 的 `dispatchCockpitCardStep`，`scenarioSurface.ts` 804→762 行，过 architecture-ratchet「基线外文件 ≤800 行」；surface 只保留一次 `isCockpitCardStep` 判定并转发 action 与 continuation，行为不变。
- `sessionLifecycleScenario.test.tsx` 的源码树遍历只吞 ENOENT：并行 worker 中 `voiceEditLabels.test.ts` 的 `__criterion-falsify-*` 临时模块可能在 `readdir` 与 `readFile` 之间消失，消失条目跳过、其他错误照抛，消除跨测试竞态红。
- 复核读数：`architecture-ratchet.test.ts` 6/6 pass；`scenarioSurface.test.ts` 2/2、`cockpitCardsSurface.test.ts` 6/6、`sessionLifecycleScenario.test.tsx` 14/14 与 `voiceEditLabels.test.ts` 23/23 并行 pass；`npm run typecheck`、`npm run lint` exit 0。AC5 的场景报告与截图沿用上一轮 `tmp/ui-scenario-dismiss/report.json`（本次为纯分发搬迁，`scenarioSurface`/`cockpitCardsSurface` 驱动测试重跑覆盖同一组详情命令）。

- 该轴仍暗,理由:本任务为前端 cockpit 详情接线，未跑架构探针，L_D/L_G 无可测读数，验证面为逐文件测试、构建静态检查与真实浏览器读数。

## Touches

- tasks/gap-cockpit-card-details-dismiss-action.md
- src/modules/cockpit/CockpitCardDismissBar.tsx
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- e2e/scenarios/cockpit-cards-dismiss.json
- scripts/ui-scenario.mjs
- src/modules/ui-scenario/cockpitCardsSurface.ts
- src/modules/ui-scenario/scenarioSurface.ts
- src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts
- src/modules/chat/hooks/tests/sessionLifecycleScenario.test.tsx

## Blocker

**2026-11-01T08:36:50.751Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/ui-scenario/scenarioSurface.ts 基线外→804 — 基线外的文件不得超过 800 行 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,src/modules/chat/hooks/tests/sessionLifecycleScenario.test.tsx,server/shared/tests/architecture-ratchet.test.ts,src/modules/chat/hooks/tests/sessionLifecycleScenario.test.tsx changed=-]
- run_id：wk-prod-anchor
- session_id：f72755e0-70d9-46fe-837a-826a45ff21e2
