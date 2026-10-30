---
id: gap-cockpit-ask-retraction-and-ledger-backfill
title: 撤回误发提问 + 补发 answered：retraction 覆盖事件-only ask、回放 ledger、发 asking
  必写对象、无对象也发 answered、投影本地抑制
status: done
labels:
  - gap
  - cockpit
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cockpit-ask-semantic-gate
---
## Proposal

来源：`gap-cockpit-ask-detector-last-paragraph` 修正检测器后，历史 ledger 里仍存着误判的 asking，共享事件流与 fleet attention 里也有对应条目。只改检测器不会让已发出的 asking 消失。实测当前 31 张 open ask 卡中，fea61be5 的 4 张（7aed36dd / 973a3df3 / 5e25b481 / 33ba0c00）全部是「事件流里有 asking、ledger/对象里没有」的误判；只回放 ledger 会漏掉这一批。

撤回协议（已与 quay-fleet 会话按代码确认）：新增 kind `session.asking.retracted`，producer=cloudcli，group=interaction，`data {askId, messageId}`。fleet 当前 release 对未知 kind 是**容忍**（`producerOfKind` 返回 null、`validateRow` 跳过 producer/per-kind 校验），不会拒收；fleet 的 retraction-consume 任务落地后才消费并 resolve。因此 CloudCLI 直接写共享流，不加版本门。

做什么：
- `context-event-writer.ts`：接受新 kind 与上述 payload；不改既有 kind。
- ledger：在 digest 的 `askEvents` 里记录已撤回的 askId（例如 `retracted: string[]`）；读取或启动回放时，对每条 asking 用修正后的检测器复核 transcript，确认是假提问就追加一次 `session.asking.retracted`、从 `asking`/`pending` 移除、记入 `retracted`。同一 ask 只撤一次；transcript 不可读时不撤（a1690759 交给来源消失/人工忽略）。
- 回放范围包含**事件流里全部 asking**：对共享事件流中该会话的每条 `session.asking`（即使没有写进 ledger/对象，例如 fea61be5 的 7aed/973a/5e25/33ba、5b 的 a68ae/b849/fc0f），按 `contentRef.messageId` 复核 transcript；确认是假提问就发一次 retraction 并记入 retracted。只回放 ledger 会漏掉「有事件无对象」这一批。
- 发 asking 必写对象：当前 producer 在 object 守卫之前写 asking 事件，导致 `!observed && activity==='idle'` 时出现「有事件无对象」；修正为有 current 时先写 observation object，再走摘要。
- `answered` 不依赖 observation object：启动补扫与每次用户回合时，从 transcript 的 `readSessionAsks` 结果扫描「其后已有用户消息」的 asking；即使该会话没有对象/ledger，也补发一次 `session.answered`（同一 askId 幂等）。这修的是 5b984a5f / 843631e5 / b96e7efc 这类「人已回复、但没有对象所以从未发 answered」的卡；与 fleet 的旧键迁移互补。实测：这 6 张卡在 transcript 里 asking 之后都有真实用户消息，但 ledger 为 null / 不含该 ask，事件流没有对应 `session.answered`。
- 本地即时抑制：投影（`cockpit-fleet-card-projection.ts`）读到卡片的 `contentRef.messageId` 在 retracted 集合里时，不把该卡加入可见列表（或按 resolved 处理）。这个集合必须**对没有 observation object 的会话也有效**（从共享事件流的 retraction 行或一个按 messageId 的本地持久集合读取），否则 fea61be5 这类「事件-only」卡无法抑制。不等 fleet consumer 上线，界面当天就消掉误发卡；fleet 消费后成为持久关闭。
- 只做 CloudCLI 写端与本地抑制；fleet 的文本键迁移、来源消失 resolve、retraction 消费由对方任务负责。

约束：撤回只针对「确认不是提问」的 ask；真提问与不可读转写不动；不改卡片交互规则（折叠与空内容展示在 `gap-cockpit-card-fold-by-contentref`）。

- 撤回判定**不得**使用位置启发式：`62d959c0:3818a9e5` 的决策在中段、末段是 caveat，按末段判定会把它读成陈述而误撤一张真卡。判定改为全文机械预筛 + T1 语义判定；位置启发式仅作预筛提示，不产出撤回结论。

## AC

撤回类用例里的「不是提问」一律由**全文机械预筛 + T1 摘要语义判定**（`isAsking` + 抽取的问题文本）得出；位置启发式（末段检测）只可作预筛提示，**不得作为撤回依据**（现场夹具见本段最后一条）。

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0：新增用例——ledger 里一条 asking 指向带编号列表的长回答 ⇒ 写出一次 `session.asking.retracted`（askId/messageId 正确），ledger 的 `asking`/`pending` 清空；第二次回放不重复写；真提问不撤；transcript 不可读时不撤。
- [x] 同一文件新增：**只存在于事件流、ledger/对象没有的 asking**（内容引用一个最后一段是陈述的消息）⇒ 回放仍发出一次 `session.asking.retracted`；重复回放不重发；真提问不发 retraction。
- [x] 同一文件新增：`current !== null` 时即使未 watch、activity 判定为 idle，也写出 observation object；断言不存在「有 asking 事件、无对象」。
- [x] 同一文件新增：一个没有 observation object 的会话，transcript 里 asking 之后有用户消息 ⇒ 启动补扫/用户回合发出一次 `session.answered`（askId/messageId 正确）；重复调用不重发；假提问走 retraction 而不是 answered。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/context-event-writer.test.ts server/modules/context-events/tests/session-ask-event-writer.test.ts` 退出 0：新 kind 被接受且 producer=cloudcli、group=interaction、data 只含 `{askId,messageId}`；缺字段/错类型被拒；既有 kind 行为不变。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0：contentRef.messageId 在 retracted 集合中的卡不出现在可见列表；不在集合中的卡保留；**没有 observation object 的会话**其 retracted 卡也被抑制；假形态删掉本地抑制 ⇒ 该用例红。
- [x] 现场夹具 `62d959c0:3818a9e5`（session `62d959c0-5487-4649-a5f2-ab38462c438b` / message `3818a9e5-1fb5-4c9f-9d99-eb8b7ee0647a`，cockpit 卡 `att_260e4c9bbcc0`）：该消息是**真提问**（决策「值得优先讨论的下一步 1/2/3」在消息中段，末段只是「本轮没有运行测试」的说明）。回放/补扫后断言：(a) 共享流**没有**该 askId 的 `session.asking.retracted`；(b) 该 askId 的 `session.answered` 在用户回复后被写出（现网缺口：asking 已写、user 已答、answered 从未写出）；(c) 该 askId **不在**任何 retracted 集合里，本地投影**不得**抑制该卡；(d) 该卡只允许因 answered（或来源消失）关闭——answered 写出之前它必须仍可见。
- [x] 假形态变红：删掉回放里的 retraction 写入 ⇒ 第一条用例红；删掉事件-only 回放 ⇒ 第二条用例红；删掉无对象补发 answered 的分支 ⇒ 第四条用例红；改完即还原。
- [x] `npm run typecheck`、`npm run lint` 退出 0；若 producer/投影越过基线，按 AC-394 RECORDED CHANGE 格式记录。

## 现场夹具（2026-10-30 人工补录）

现场读数（`~/.quay-fleet/`，非推测）：

- 卡：`att_260e4c9bbcc0`，provider=quay-fleet，kind=ask，group=rescue，state=open，waitingSince=2026-10-29T16:05:53Z，subject.taskId=null，contentRef.resolver=`cloudcli.session-ask`，messageId=`3818a9e5-1fb5-4c9f-9d99-eb8b7ee0647a`，ask 文本空、options 空。
- 事件流（`context/events/2026-10-29.jsonl`）：16:05:53Z `session.asking`（askId `62d959c0-5487-4649-a5f2-ab38462c438b:3818a9e5-1fb5-4c9f-9d99-eb8b7ee0647a`）；16:11:45Z `chip.picked`；16:11:51Z 用户 utterance「先拆 observation producer 的 ask ledger 和恢复/sweep…创建任务。」；**没有**对应 `session.answered` ⇒ 卡至今仍开。这正是本任务「无对象也补发 answered」要修的现场症状。
- 判定：消息 `3818a9e5` 是真提问（决策在中段，末段是 caveat）。它同时是「不得用位置启发式撤回」的负向夹具——按末段判定撤回会撤掉一张真卡。
- 验收口径：该卡必须在一份 `session.answered {askId, messageId}` 写出之后才消失；消失的驱动力是 answered（或来源消失），**不是** retraction 本地抑制。

## DoD

真实数据（MCP 浏览器或一次性 Playwright；不点确认）：

1. 在隔离实例或真实数据副本上跑回放：共享事件流里出现 5b984a5f 的 3 条、fea61be5 的 4 条（7aed36dd / 973a3df3 / 5e25b481 / 33ba0c00）、0a8e120a/843631e5/b96e7efc/c07db8d2 对应条目的 `session.asking.retracted`（贴出 askId/messageId）；a1690759 与真提问没有 retraction 行。
2. 无对象的会话（5b984a5f / 843631e5 / b96e7efc）在补扫后共享流出现对应的 `session.answered`；贴出事件行（askId/messageId）；与 fleet 的旧键迁移配合后卡关闭。
3. 390 与 1440 打开 `/cockpit?view=cards`：上述误发卡不再出现（本地抑制即时生效，包含没有 object 的会话），真提问卡仍在且可确认；现场夹具 `att_260e4c9bbcc0` 必须**仍在**（它没被撤回，只等 answered）——补扫写出 answered 后再次打开，该卡才消失；截图存 `tmp/`。
4. 场景运行器可用时跑 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` 并贴 JSON；实例用毕停掉。

## ADR-007 暗轴

该轴仍暗,理由:本任务只修事件流、producer 与投影的缺陷，未新增文档或架构图，L_D/L_G 无新读数。

## Touches

- tasks/gap-cockpit-ask-retraction-and-ledger-backfill.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/session-ask-retraction.ts
- server/modules/observation/session-digest.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/context-events/context-event-writer.ts
- server/modules/context-events/session-ask-stream-reader.ts
- server/modules/context-events/index.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/cockpit-fleet-card-provider.ts
- server/cockpit-fleet-wiring.ts
- server/modules/observation/session-digest-llm.ts
- server/shared/types.ts
- server/modules/observation/tests/session-digest.test.ts
- server/modules/observation/tests/fixtures/session-ask-62d959c0-3818a9e5.txt
- server/modules/context-events/tests/context-event-writer.test.ts
- server/modules/context-events/tests/session-ask-event-writer.test.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/shared/tests/architecture-ratchet.baseline.json

## Blocker

**2026-10-30T03:12:54.640Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/context-events/context-event-writer.ts 849→939 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：02171349-8735-4d00-b67c-39951ac09b59
