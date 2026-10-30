---
id: gap-cockpit-session-start-billing-error-confirm
title: 确认 cockpit `session.start` 拉起的会话首轮订阅/账单错误（同刻常驻会话正常，执行器仍报成功）
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：驾驶舱卡片「安排下一步」（`reevaluate` → 执行器 `session.start`）确认成功、界面显示「Sent」，但被拉起的会话首轮就死了，失败不可见。需要确认这是一次账户级订阅/账单问题、瞬时故障，还是 `session.start` 这条路径特有的会话级问题。

现场读数（2026-10-29，root=/data/home/yale/work/claudecodeui，project=quay-fleet）：

- 确认时刻 2026-10-29T16:17:54Z：卡 `att_55c270b18e3a`（entity `fleet-session-ask-text-key-migration`）的选项 `reevaluate` 走 `session.start`，返回 `ok:true, sessionId: c7daddcd-5fcc-41f5-b95e-ba7440c692d9`。
- 该会话的转写 `~/.claude/projects/-data-home-yale-work-quay-fleet/caf802f6-9f0c-4087-91f8-130423e937c9.jsonl` 里：`api-request`（16:17:56.256Z）为 `params.model="claude-opus-5-5"`、`output_config.effort="medium"`；随后唯一一条 assistant 消息（16:17:56.511Z）是：
  > Claude Code can't use your Claude subscription, usually because a payment is past due · Pay or renew at https://claude.ai/settings/billing (if you just paid, try again shortly), or use an Anthropic API key instead
- 同一时段另一条常驻会话 `8506d2f2-ce2b-42c4-b7fc-2f4326dc2f00`（cwd 同为 quay-fleet）在 16:19–16:21Z 正常回答（`requestedModel: v4pro`），说明当时不是整机/账号完全不可用。
- 驾驶舱侧：动作执行器返回成功并把 `sessionId` 记进 feedback outcome，overlay 停在「已发出」；会话首轮死亡没有任何读数回传。

要确认的问题：这个错误是否每次必现；它是否只发生在 `session.start` 的构造设置上（模型 `claude-opus-5-5`、effort medium）；还是账户订阅本身已欠费/该模型不在订阅权益内。

（查重：任务库内没有以 `session.start` 首轮订阅/账单失败为机制的条目；`gap-cockpit-card-dismiss-fleet-revision-and-receipt` 是卡片回执/revision 机制，不同。同 Touches 无在飞任务。）

## Plan

1. 取证：从上面那条转写逐字取回错误原文、时间戳、模型与 effort；不改写。
2. 复现：用与驾驶舱 `session.start` 相同的设置（同 project、同 provider/model、同 permissionMode/effort）在真实环境新建一个会话并发一句最小 prompt；记录首轮结果。相同设置再跑一次，两次读数用于区分「必现」与「偶发」。
3. 对照：读同刻成功的常驻会话 `8506d2f2` 的模型/设置读数，逐项列出与失败会话的差异（模型、provider、auth 路径、账号）；再取一条第三方读数（CLI 自带账号/订阅读数，或同一 API key 的最小请求）交叉印证。
4. 判定：在「账户级 / 瞬时 / 会话级」中给出一个结论并逐条引用支撑读数；账户级 ⇒ 写明外部下一步是续费或改用 API key；会话级/瞬时 ⇒ 记录可复现步骤，并另立一条缺陷任务（贴新任务 id），不在本任务里改代码。
5. 落记录：把判定、两态读数与下一步写进完成记录。

## AC

- [ ] AC1 **失败原文可机械取回**：`grep -rl "payment is past due" /data/home/yale/.claude/projects/-data-home-yale-work-quay-fleet/ | wc -l` 输出 ≥1；完成记录逐字贴出匹配文件路径、该条 `timestamp`、`params.model` 与 `output_config.effort`。
- [ ] AC2 **同款设置两次真实复现读数**：用驾驶舱 `session.start` 的同款设置在真实 provider 上新建会话并发送最小 prompt，连续两次；完成记录贴出每次的会话 id、首轮结果（成功或错误原文）与所用设置。
- [ ] AC3 **对照表与判定**：完成记录列出失败会话（`caf802f6`）与同刻成功会话（`8506d2f2`）在 provider/model/effort/auth 路径上的逐项差异，并给出「账户级 / 瞬时 / 会话级」三选一的判定，每条判定理由都引用一条具体读数。
- [ ] AC4 **下一步已定**：完成记录写明对应分支的下一步——账户级 ⇒「续费或改用 API key」为外部动作；会话级/瞬时 ⇒ 贴出另立任务的 id 与复现步骤。本任务不改源码。

## DoD

在真实环境用驾驶舱 `session.start` 的同款设置实际拉起会话并读回首轮结果（成功或同一错误），两次读数、对照表与三选一判定都落在完成记录里；账户级则外部动作清楚，会话级/瞬时则另立任务可读（id 已贴）。不改代码、不放宽任何判据。

## Touches

- tasks/gap-cockpit-session-start-billing-error-confirm.md
- server/modules/cockpit/cockpit-session-start.executor.ts （只读：session.start 的入口与设置）
- server/cockpit-executors-wiring.ts （只读：session.start 的构造绑定）