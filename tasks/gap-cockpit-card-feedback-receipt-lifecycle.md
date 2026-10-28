---
id: gap-cockpit-card-feedback-receipt-lifecycle
title: 卡片反馈回执生命周期：确认后把反馈发给 provider，卡片原位进入「已发出、待确认」，回执到达或条目关闭才结束；2 分钟无回执显示重发
status: done
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

回执协议（fleet 侧 `fleet-cockpit-feedback-receipt` 已落地并上线：实现 `e22f1de`、release `3c02eee`；以 `quay-fleet rescue executors --json` 里 `fleet.feedback` 的声明为准）：

1. 确认后先执行卡片动作（`session.start` / `session.send` / provider 自己的 executor），成功后生成 `feedbackId`，调用 provider 声明的反馈 executor（fleet：`fleet.feedback`），参数：`attentionId`*、`revision`*（int）、`feedbackId`*（幂等键：同一 id 重放返回同一 receipt、不重复记）、`optionId`、`ownReply`（**boolean**，是否自己写）、`text`（自写原文/自由文本）——三者至少一个（fleet 落地声明 `requiredAnyOf`，2026-10-28 `rescue executors --json` 实读）；自写回复传 `ownReply: true` + `text`，选项传 `optionId`；`suggested`（bool）、`source`（assistant|judge|provider）、`outcome`（`executor`、`ok`、`sessionId?`、`deliveryId?`）。
2. 服务端持久记下叠加 `{cardId, revision, feedbackId, optionId, label, sentAt, outcome}`（CloudCLI 自己的库，按 backend-module-standards 收进带生命周期的对象），刷新、换设备都在。
3. 回执 `receipt: { feedbackId, at, disposition: 'closed' | 'kept' | 'rejected', reason? }` 由反馈 executor 在**返回结果**里给出（fleet：`result.receipt`；`closed` = 条目以关闭原因 `feedback` 关闭，`kept` = 记下反馈但不关（如挂起），`rejected` = 未知 attentionId / 未知 optionId / `stale-revision`）。收到匹配的回执 ⇒ 叠加清掉：`closed` 时卡片按下一次读数消失（读数仍带着它时保持「已发出」直到读数不再含它），`kept` 显示处置（例如「已挂起」），`rejected` 回到待处理并显示原因。provider 若也在卡片上回显 `receipt`，同样按 `feedbackId` 匹配处理；卡片不在 open 读数里 ⇒ 叠加清掉。
4. 反馈调用失败或超时、且发出满 2 分钟仍没有回执 ⇒ 「未确认收到」；「重发」只用同一 `feedbackId` 重发第 1 步的反馈（fleet 幂等，返回同一 receipt）。provider 没声明反馈 executor 时，「重发」禁用并写明原因，卡片仍只在条目关闭时消失。
5. 会话提问卡同一模型：反馈是发进原会话的回复，同样调用反馈 executor（fleet 同时会从 `session.answered` 关闭条目，以先到者为准）。

夹具 provider 同步实现反馈 executor 与 `receipt` 回显（可配置延迟、`kept`、`rejected`、不回执），用来在隔离实例里覆盖每个状态。头部计数写成「N 张，其中 M 张等 fleet 确认」。

效果图（2026-10-28，真实 class 注入 live 页面）：`tmp/cockpit-handoff/v2-pc-states-col.png`、`tmp/cockpit-handoff/v2-m-states-long.png`。

`src/modules/cockpit/cockpitCardController.ts` 已在 ratchet 基线 1329 行：叠加状态机放进新文件 `cockpitCardFeedback.ts`，控制器只加接线；若仍需上调，按 RECORDED CHANGE 格式记录。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 退出 0：动作成功后恰好调用一次反馈 executor，参数含 `feedbackId`、`revision`（整数）、`optionId` 或 `ownReply: true` + `text`、`outcome.sessionId`；动作失败时不调用反馈、不建叠加；叠加持久（重建 store 后仍读到）；反馈结果里的 `receipt.feedbackId` 匹配、卡片读数里回显的 `receipt` 匹配、或卡片不在读数里时叠加清掉；`closed` 回执而读数仍含该卡时保持「已发出」；`rejected` 清叠加并带回原因；重发复用同一 `feedbackId` 且不重做动作；provider 未声明反馈 executor 时重发返回明确的不可用原因。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardFeedback.test.ts` 退出 0（注入时钟）：已发出卡片原位不动（卡片顺序与 id 列表与发出前相同）、选项与确认锁住；第 120 秒前不出现重发，第 120 秒出现；收到匹配回执后回到 provider 读数所示状态；头部计数读数正确。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx`、`npx vitest run src/shared/tests/cockpitCardTypeSync.test.ts`、`npx vitest run src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts` 退出 0（`receipt` 字段两端同步；新文案进全部 locale）。
- [x] 假形态变红：叠加改为按 `revision` 变化就清掉（而不是按回执/条目关闭）⇒ 「回执到达才清」用例红；把卡片排到末尾 ⇒ 「原位不动」用例红；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts`、`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（关 residentRestore；fleet home 指向临时副本，⛔ 不写真实 `~/.quay-fleet`；只点夹具卡片），MCP 浏览器 PC 宽与手机宽各走一遍，截图存 `tmp/`：

1. 夹具卡配置为 10 秒后回执 `closed`：确认 → 截图「已发出，待确认」原位 → 10 秒后卡片消失。
2. 夹具卡配置为不回执：确认 → 2 分钟后截图「未确认收到 · 重发」→ 改配置为立即回执后点重发 → 卡片消失；贴出两次反馈调用的 `feedbackId` 相同、动作只执行了一次的读数。
3. 夹具卡配置为 `kept`（挂起）与 `rejected`：各截一张回到待处理后的样子。
4. 发出后刷新页面，截图叠加仍在。

实例用毕 `scripts/isolated-instance.sh stop`。

## Verification

2026-10-28，worktree `/data/home/yale/work/claudecodeui-worktrees/gap-cockpit-card-feedback-receipt-lifecycle`（分支 `task/gap-cockpit-card-feedback-receipt-lifecycle`），实现提交 `4af36cb6c`。

- **AC1**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` ⇒ `tests 12 / pass 12 / fail 0`。12 条用例逐条对上本 AC 的分句：协议参数（`attentionId`、整数 `revision`、`feedbackId`、`optionId` 或 `ownReply: true` + `text`、`suggested`、`source`、`outcome.sessionId/deliveryId`）、动作失败不调反馈不建叠加、重建 store 仍读到、`closed` 且读数仍含该卡保持「已发出」、原位不动、revision 变化不清、卡片回显 kept 回执清叠加、别的 `feedbackId` 什么都不动、rejected 清叠加带原因、重发同 `feedbackId` 且动作只执行一次、无反馈 executor 时给明确不可用原因。
- **AC2**：`npx vitest run src/modules/cockpit/tests/cockpitCardFeedback.test.ts` ⇒ `5 passed`。注入时钟连 repeating interval 一起实现（控制器的 1 秒 feedback tick 是真跑的，不是被绕过）：原位与 id 顺序不变、选项与确认锁住（`disabledReason` = `FEEDBACK_LOCKED_REASON`）、119 999ms 不可重发 / 120 000ms 可重发、kept 回执回到 provider 读数、头部计数。
- **AC3**：`CockpitCard.test.tsx` ⇒ `71 passed`；`cockpitCardTypeSync.test.ts` + `i18nCockpitCompleteness.test.ts` ⇒ `20 passed`（五个新类型的 `receipt`/`feedback`/`feedbackNotice` 两端字段一致；12 个 locale 的 `cockpit` 块键集与 `{{}}` 占位符集一致）。
- **AC4**：两个假形态各改一次、跑红、还原。① 叠加改为「revision 变化就清」⇒ `✖ a revision change alone never clears the overlay`；② `applyCards` 把带叠加的卡片排到末尾 ⇒ `✖ a sent card keeps its place in the reading (原位不动)…` 与 `✖ a closed receipt keeps 「已发出」…` 两条红。诚实说明：②在客户端用例上不会红——客户端没有排序规则，排序只发生在服务端读数里，所以「原位不动」的承重腿是服务端那条。
- **AC5**：`cockpit-fleet-card-provider.test.ts` 11 pass、`server-import-cycle-budget.test.ts` 11 pass、`architecture-ratchet.test.ts` 6 pass；`npm run typecheck` 退出 0；`npm run lint` 退出 0（`LINT_EXIT:0`，输出只有既有 warning）。ratchet 的五处 oversize 上调与新增文件的判据修复都按 RECORDED CHANGE 记进 `architecture-ratchet.baseline.json`（2026-10-28 段），手工改基线而**不**跑 `ARCHITECTURE_RATCHET_WRITE_BASELINE=1`——生成器会把 `note` 重置成 `BASELINE_NOTE`，既有 RECORDED CHANGE 段会全丢。

### DoD（隔离实例 + 一次性 Playwright）

实例由 `scripts/isolated-instance.sh` 起（`residentRestore.enabled=false`、`CLAUDE_SESSION_SCOPE_SWEEP=off`，启动后读日志确认 `started=0`），HOME 指向临时目录 `/tmp/gap-feedback-home`，⛔ 未触碰真实 `~/.quay-fleet`；只点夹具卡片。会话里没有 MCP 浏览器工具，按「没 MCP 浏览器时用一次性 Playwright spec」用 `tmp/dod-feedback.mjs` 驱动真实页面（`/cockpit?view=cards`），截图在 `tmp/cockpit-feedback-dod/`。

1. `mode: closed` + `delayMs: 10000`：确认「Provide the credential」⇒ `closed-pc-1-sent.png`：`data-phase=sent`，状态行 "Sent: Provide the credential · waiting for the fleet to confirm receipt"，头部 "9 cards, 1 waiting for the fleet to confirm"，卡片仍在第一位（顺序未变）⇒ 约 10 秒后 `closed-pc-2-gone.png`，卡片 detached、确认区一起消失。手机宽 390 同一路径改用 `fixture:fix` ⇒ `closed-phone-1-sent.png` / `closed-phone-2-gone.png`。
2. `mode: none`：确认「Keep the scope small」⇒ 叠加文件 `feedbackId=c7514039-eba7-4970-b11a-20c2ae8c615b`、`sentAt=2026-10-28T15:15:20.685Z`、`revision=1`。2 分钟读数 `unconfirmed-1-two-minutes.png`：`phase=unconfirmed`、"The fleet has not confirmed · no receipt after 2 minutes"、Resend 可点；手机宽同一读数 `unconfirmed-1-two-minutes-phone.png`。改配置为 `closed` + 8 秒后点「Resend」⇒ 叠加文件 `feedbackId` **不变**、`sentAt` 变 `15:17:27.185Z`（同一幂等键重发，`revision` 仍是 1）；该页只发了 `POST /api/cockpit/cards/feedback/resend`，一个 `confirm` 请求都没有——整个 DoD 里 `confirm` 只出现过一次（`none` 腿的那次）⇒ 动作没有重做。8 秒后卡片消失、叠加清空 ⇒ `resend-1-resent.png` / `resend-2-gone.png`。
3. `mode: kept` ⇒ `kept-1-returned.png`：`noticeKind=kept`、"The fleet received it and kept the item open"，卡片回到待处理（`phase=null`、选项与确认重新可点）。`mode: rejected`（`reason: stale-revision`）⇒ `rejected-1-returned.png`：`noticeKind=rejected`、"The fleet rejected this feedback: stale-revision"，同一张卡的选项与确认恢复可用（provider 已把 revision 前移，允许重新选）。
4. 发出后 `page.reload()` ⇒ `reload-1-overlay-persists.png`，重载前后读数相同（`phase=sent`、同一 `feedbackId`、头部仍 "1 waiting"），叠加不只在内存里。

实例用毕 `scripts/isolated-instance.sh stop` ⇒ `ok:true`、`port_still_serving:false`、`residual_scopes:""`。

### fan-in suite 回归修复（2026-10-28 第二轮）

上一轮 exited-not-landed 的两条 suite 红都是本任务引入的，已在 worktree 内修复并复跑：

- `server/modules/cockpit/tests/cockpit-card-registry.test.ts`（`an old revision must be a conflict`：404 ≠ 409）：夹具 provider 的隐式反馈默认从 `closed` + 0ms 改为 `none`——未配置时不再改变夹具卡片原有的生命周期（确认只让 revision 前移，卡片仍在读数里），旧 revision 因此仍返回 409。DoD 各臂本就显式配置 `mode`，行为不变。复跑 ⇒ `tests 10 / pass 10 / fail 0`。
- `server/shared/tests/quay-test-script.test.ts`（`known=3 unknown=460` / `known=1 unknown=462` 钉子）：本任务新增 `server/modules/cockpit/tests/cockpit-card-feedback.test.ts` 使收集到的 server 测试文件 463→464，两条夹具读数改为 `unknown=461` / `unknown=463`，并按既有格式把这次 +1 记进注释链。复跑 ⇒ `tests 14 / pass 14 / fail 0`。
- 复跑本任务 AC1 用例 ⇒ `tests 12 / pass 12 / fail 0`；`npm run typecheck` 退出 0；`npm run lint` 退出 0（仅既有 warning）；`architecture-ratchet.test.ts` ⇒ `6 pass`。
- `server/shared/tests/quay-test-script.test.ts` 因这处必要的计数钉子改动补进 `## Touches`。

该轴仍暗,理由:真实 fleet 的 `fleet.feedback` 调用未在隔离实例执行，本任务只覆盖夹具 provider 的 closed/kept/rejected/none 与本地叠加/回执清理

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
- server/shared/tests/quay-test-script.test.ts
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
- server/index.ts
- server/modules/settings/server-settings.ts
- src/modules/cockpit/contract/cardReading.ts
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/i18n/locales/zh-TW/common.json
- src/modules/i18n/locales/tr/common.json

## Blocker

**2026-10-28T15:34:51.665Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/modules/cockpit/tests/cockpit-card-registry.test.ts:   AssertionError [ERR_ASSERTION]: an old revision must be a conflict [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/quay-test-script.test.ts,server/modules/cockpit/tests/cockpit-card-registry.test.ts,server/shared/tests/quay-test-script.test.ts,server/modules/cockpit/tests/cockpit-card-registry.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：4f8c0ec5-8ced-41b3-98eb-4530e9f4b34b
