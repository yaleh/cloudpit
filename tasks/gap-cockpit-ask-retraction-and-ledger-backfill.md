---
id: gap-cockpit-ask-retraction-and-ledger-backfill
title: 撤回误发提问：新增 session.asking.retracted、回放 ledger 回填、发 asking 必写对象、投影本地即时抑制
status: todo
labels:
  - gap
  - cockpit
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cockpit-ask-detector-last-paragraph
---
## Proposal

来源：`gap-cockpit-ask-detector-last-paragraph` 修正检测器后，历史 ledger 里仍存着误判的 asking，共享事件流与 fleet attention 里也有对应条目（5b984a5f 3 条、fea61be5 2 条、0a8e120a / 843631e5 / b96e7efc / c07db8d2 各若干）。只改检测器不会让已发出的 asking 消失。

撤回协议（已与 quay-fleet 会话按代码确认）：新增 kind `session.asking.retracted`，producer=cloudcli，group=interaction，`data {askId, messageId}`。fleet 当前 release 对未知 kind 是**容忍**（`producerOfKind` 返回 null、`validateRow` 跳过 producer/per-kind 校验），不会拒收；fleet 的 retraction-consume 任务落地后才消费并 resolve。因此 CloudCLI 直接写共享流，不加版本门。

做什么：
- `context-event-writer.ts`：接受新 kind 与上述 payload；不改既有 kind。
- ledger：在 digest 的 `askEvents` 里记录已撤回的 askId（例如 `retracted: string[]`）；读取或启动回放时，对每条 asking 用修正后的检测器复核 transcript，确认是假提问就追加一次 `session.asking.retracted`、从 `asking`/`pending` 移除、记入 `retracted`。同一 ask 只撤一次；transcript 不可读时不撤（a1690759 交给来源消失/人工忽略）。
- 发 asking 必写对象：当前 producer 在 object 守卫之前写 asking 事件，导致 `!observed && activity==='idle'` 时出现「有事件无对象」；修正为有 current 时先写 observation object，再走摘要。
- 本地即时抑制：投影（`cockpit-fleet-card-projection.ts`）读到卡片的 `contentRef.messageId` 在 retracted 集合里时，不把该卡加入可见列表（或按 resolved 处理）。不等 fleet consumer 上线，界面当天就消掉误发卡；fleet 消费后成为持久关闭。
- 只做 CloudCLI 写端与本地抑制；fleet 的文本键迁移、来源消失 resolve、retraction 消费由对方任务负责。

约束：撤回只针对「修正后的检测器确认不是提问」的 ask；真提问与不可读转写不动；不改卡片交互规则（折叠与空内容展示在 `gap-cockpit-card-fold-by-contentref`）。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0：新增用例——ledger 里一条 asking 指向带编号列表的长回答 ⇒ 写出一次 `session.asking.retracted`（askId/messageId 正确），ledger 的 `asking`/`pending` 清空；第二次回放不重复写；真提问不撤；transcript 不可读时不撤。
- [ ] 同一文件新增：`current !== null` 时即使未 watch、activity 判定为 idle，也写出 observation object；断言不存在「有 asking 事件、无对象」。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/context-events/tests/context-event-writer.test.ts server/modules/context-events/tests/session-ask-event-writer.test.ts` 退出 0：新 kind 被接受且 producer=cloudcli、group=interaction、data 只含 `{askId,messageId}`；缺字段/错类型被拒；既有 kind 行为不变。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0：contentRef.messageId 在 retracted 集合中的卡不出现在可见列表；不在集合中的卡保留；假形态删掉本地抑制 ⇒ 该用例红。
- [ ] 假形态变红：删掉回放里的 retraction 写入 ⇒ 第一条用例红；改完即还原。
- [ ] `npm run typecheck`、`npm run lint` 退出 0；若 producer/投影越过基线，按 AC-394 RECORDED CHANGE 格式记录。

## DoD

真实数据（MCP 浏览器或一次性 Playwright；不点确认）：

1. 在隔离实例或真实数据副本上跑回放：共享事件流里出现 5b984a5f 的 3 条、fea61be5 的 2 条、0a8e120a/843631e5/b96e7efc/c07db8d2 对应条目的 `session.asking.retracted`（贴出 askId/messageId）；a1690759 与真提问没有 retraction 行。
2. 390 与 1440 打开 `/cockpit?view=cards`：误发卡不再出现（本地抑制即时生效），真提问卡仍在且可确认；截图存 `tmp/`。
3. 场景运行器可用时跑 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` 并贴 JSON；实例用毕停掉。

## Touches

- tasks/gap-cockpit-ask-retraction-and-ledger-backfill.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/session-digest.ts
- server/modules/context-events/context-event-writer.ts
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/observation/tests/session-digest.test.ts
- server/modules/context-events/tests/context-event-writer.test.ts
- server/modules/context-events/tests/session-ask-event-writer.test.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/shared/tests/architecture-ratchet.baseline.json