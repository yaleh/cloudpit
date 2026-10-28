---
id: gap-cockpit-card-feedback-receipt-lifecycle
title: 卡片反馈回执生命周期：确认后把反馈发给 provider，卡片原位进入「已发出、待确认」，回执到达或条目关闭才结束；2 分钟无回执显示重发
status: todo
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
depends_on:
  - gap-cockpit-session-start-background-resident-and-run-events
---
## Proposal

来源：2026-10-28 线上。确认 fleet 卡 `att_94edac259017` 的「重新评估计划」后，卡片显示「Sent ✓」却原样留在列表里：CloudCLI 只在自己这边开了会话，fleet 没收到任何东西（`~/.quay-fleet/decisions.jsonl` 里该条目最后一笔仍是 10-15 的 ack），条目仍是 open。

用户定下的生命周期（2026-10-28 讨论）：

- **fleet 的待人处理条目**：不是等卡片动作执行完才关闭，而是 fleet 确认「这个条目得到反馈了」后关闭；条目关闭触发卡片关闭。事情没完（例如任务仍未落地）由 fleet 另开新条目，是新卡。
- **卡片**是条目的镜像，可以多出 CloudCLI 本地的状态，例如「开发者的反馈已发给 fleet，但 fleet 尚未确认收到」。⛔ 不引入第二个列表：多出的状态都**留在原位**显示，不排到末尾。
- 无回执超时 **2 分钟**，超时显示「重发」。

卡片状态（本地叠加只描述「我发了什么、到哪一步」，卡片何时消失只由 provider 决定）：

| 状态 | 来源 | 卡上显示 |
|---|---|---|
| 待处理 | 条目 open | 现状 |
| 倒计时 / 确认中 | 本地（现有五秒倒计时与请求在途） | 现状 |
| 已发出，待确认 | 本地、持久 | 原位变淡；确认区换成状态行「已发出：〈选项〉· 等 fleet 确认收到」+ 动作结果（如「后台会话运行中 · 打开会话 ›」）；选项与确认锁住 |
| 未确认收到 | 本地，发出满 2 分钟仍无回执 | 原位琥珀色提示「fleet 未确认收到 · 2 分钟无回执」+「重发」；说明重发只重发反馈，不重做动作 |
| 已关闭 | 条目关闭 | 卡片从读数里消失，本地叠加随之清掉 |

回执协议（本任务按此实现，并把同一段发给 fleet 对齐；字段名以 fleet 声明的 executor 为准，若改名按它的声明跟随）：

1. 确认后先执行卡片动作（`session.start` / `session.send` / provider 自己的 executor），成功后生成 `feedbackId`，调用 provider 声明的反馈 executor（fleet：`fleet.feedback`），参数：`attentionId`、`revision`、`feedbackId`、`optionId` 或 `ownReply` + `text`、`suggested`、`source`、`outcome`（`executor`、`ok`、`sessionId?`、`deliveryId?`）。
2. 服务端持久记下叠加 `{cardId, revision, feedbackId, optionId, label, sentAt, outcome}`（CloudCLI 自己的库，按 backend-module-standards 收进带生命周期的对象），刷新、换设备都在。
3. provider 在卡片上回显 `receipt: { feedbackId, at, disposition: 'closed' | 'kept' | 'rejected', reason? }`。读卡时：卡片不在 open 读数里 ⇒ 叠加清掉；`receipt.feedbackId` 等于本地的 ⇒ 叠加清掉，`kept` 显示 provider 给的处置（例如「已挂起」），`rejected` 回到待处理并显示原因。
4. 发出满 2 分钟仍没有回执 ⇒ 「未确认收到」；「重发」只用同一 `feedbackId` 重发第 3 步的反馈。provider 没声明反馈 executor 时，「重发」禁用并写明原因，卡片仍只在条目关闭时消失。
5. 会话提问卡同一模型：反馈是发进原会话的回复，同样调用反馈 executor（fleet 同时会从 `session.answered` 关闭条目，以先到者为准）。

夹具 provider 同步实现反馈 executor 与 `receipt` 回显（可配置延迟、`kept`、`rejected`、不回执），用来在隔离实例里覆盖每个状态。头部计数写成「N 张，其中 M 张等 fleet 确认」。

效果图（2026-10-28，真实 class 注入 live 页面）：`tmp/cockpit-handoff/v2-pc-states-col.png`、`tmp/cockpit-handoff/v2-m-states-long.png`。

`src/modules/cockpit/cockpitCardController.ts` 已在 ratchet 基线 1329 行：叠加状态机放进新文件 `cockpitCardFeedback.ts`，控制器只加接线；若仍需上调，按 RECORDED CHANGE 格式记录。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 退出 0：动作成功后恰好调用一次反馈 executor，参数含 `feedbackId`、`revision`、`optionId`/`ownReply`、`outcome.sessionId`；动作失败时不调用反馈、不建叠加；叠加持久（重建 store 后仍读到）；读到卡片消失或 `receipt.feedbackId` 匹配时叠加清掉；`rejected` 清叠加并带回原因；重发复用同一 `feedbackId` 且不重做动作；provider 未声明反馈 executor 时重发返回明确的不可用原因。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardFeedback.test.ts` 退出 0（注入时钟）：已发出卡片原位不动（卡片顺序与 id 列表与发出前相同）、选项与确认锁住；第 120 秒前不出现重发，第 120 秒出现；收到匹配回执后回到 provider 读数所示状态；头部计数读数正确。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx`、`npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts`、`npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（`receipt` 字段两端同步；新文案进全部 locale）。
- [ ] 假形态变红：叠加改为按 `revision` 变化就清掉（而不是按回执/条目关闭）⇒ 「回执到达才清」用例红；把卡片排到末尾 ⇒ 「原位不动」用例红；改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（关 residentRestore；fleet home 指向临时副本，⛔ 不写真实 `~/.quay-fleet`；只点夹具卡片），MCP 浏览器 PC 宽与手机宽各走一遍，截图存 `tmp/`：

1. 夹具卡配置为 10 秒后回执 `closed`：确认 → 截图「已发出，待确认」原位 → 10 秒后卡片消失。
2. 夹具卡配置为不回执：确认 → 2 分钟后截图「未确认收到 · 重发」→ 改配置为立即回执后点重发 → 卡片消失；贴出两次反馈调用的 `feedbackId` 相同、动作只执行了一次的读数。
3. 夹具卡配置为 `kept`（挂起）与 `rejected`：各截一张回到待处理后的样子。
4. 发出后刷新页面，截图叠加仍在。

实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/gap-cockpit-card-feedback-receipt-lifecycle.md
- server/modules/cockpit/cockpit-card-actions.ts
- server/modules/cockpit/cockpit-card-feedback-store.ts (new)
- server/modules/cockpit/cockpit-card-registry.ts
- server/modules/cockpit/cockpit-fixture-card-provider.ts
- server/modules/cockpit/cockpit-fleet-card-provider.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit.module.ts
- server/modules/cockpit/index.ts
- server/modules/cockpit/tests/cockpit-card-feedback.test.ts (new)
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/shared/types.ts
- src/shared/types.ts
- src/shared/api.ts
- src/shared/tests/cockpitCardTypeSync.test.ts
- src/modules/cockpit/cockpitCardFeedback.ts (new)
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/CockpitCardConfirmBar.tsx
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/tests/cockpitCardFeedback.test.ts (new)
- src/modules/cockpit/tests/CockpitCard.test.tsx
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- server/shared/tests/architecture-ratchet.baseline.json
- server/shared/tests/server-import-cycle-budget.test.ts
