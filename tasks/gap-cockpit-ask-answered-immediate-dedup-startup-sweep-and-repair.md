---
id: gap-cockpit-ask-answered-immediate-dedup-startup-sweep-and-repair
title: 提问卡回答后结束的四处补强：用户发言即为当前未结束提问发 answered（不依赖转写已写入）；answered
  跨历史去重（不再一次补发几十条）；服务启动时扫所有有未结束提问的会话补发；已存的 JSON 失败与缺原话字段的旧摘要各重算一次
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

来源：2026-10-28 15:10 线上验证（构建 `6ac8c372d`，含 `gap-cockpit-ask-cards-resolve-reliably-digest-json-and-details-polish` 的实现提交 `35be6ee3c`）。该修复把提问账本持久化到会话 digest、在 turn-end 与用户消息到达（`server/shared/ports/session-user-turn.port.ts`，由 `server/modules/websocket/services/chat-control.service.ts` 调用）时按转写补发 `session.answered`。实测四处仍不达标，读数来自 `~/.quay-fleet/context/events/2026-10-28.jsonl` 与 `/api/cockpit/cards`：

1. **刚回答的提问没有马上结束。** 会话 `8d8a6d0d-e1a7-45e1-bf52-b970c4d6f732` 在 06:33:17Z 发出 `session.asking`（askId 尾 `18680f668739`，卡片 `att_3117504e87a3`），用户 07:10:22Z 回答；同一时刻补发了一批 answered，却**唯独没有这一条**。推测：用户消息端口触发时该消息尚未写入转写，按「转写里其后已有用户消息」判断，最新那条提问被认为仍未回答，要等这一轮结束才补上。
2. **补发不跨历史去重。** 07:10:22Z 同一时刻为该会话写了约 70 条 `session.answered`，包括早已发过 answered 的 askId（例如 `1dcf39efc4b9`、`0358201cc0be`、`ac5fdb26fc36`）。
3. **没动静的会话不会被补扫。** 会话 `b32559b2-4a10-4a65-a202-67920d4399e2` 在 10-27 有提问卡 `att_099ff8751d77`（messageId `d8635d5f-…-e1bfa61007ca`），10-28 06:34Z 又出现一张内容相同的新卡；旧卡对应的提问从未收到 answered。重启后该会话没有新消息，补发从未对它运行。
4. **旧的失败读数不重算。** 两张 quay 提问卡（会话 `dbbf1404-7c68-40f6-a709-342c1fc158ce`）仍是「模型输出不可用：模型输出不是合法 JSON」，因为新的输出上限只对新算的摘要生效；同样，已有摘要都没有新加的助手原话字段，Details 里看不到原话引用。

做什么：

- **用户发言即结束当前提问**：用户消息端口触发时，以「此刻有一条新的用户消息」为事实，直接为该会话账本里所有未结束的 askId 发 `session.answered`（messageId 用端口事件给出的用户消息 id；没有则留空），不依赖转写是否已写入。turn-end 的转写补发保留为兜底。
- **跨历史去重**：账本记录每个 askId 的 answered 是否已发出（持久化，随会话 digest 存），已发过的不再发；一次处理最多补发账本里确实未结束的那几条。
- **启动补扫**：服务启动后（在 observation store 就绪之后、不阻塞启动），扫一遍账本里仍有未结束提问的会话，按转写补发 answered（其后已有用户消息的才发）。补扫限速，记录处理了多少会话、补发多少条。
- **旧读数重算一次**：读取器（`server/modules/observation/session-ask-decision-reader.ts`）对两类旧读数各补算一次——①失败原因是「模型输出不可用」的；②已评估但缺助手原话字段的；与已有的「未启用」修复同一机制（每个 askId 一次、失败记住并给出原因、受 `maxPerHour` 约束）。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：用户消息端口触发时转写尚未包含该消息 ⇒ 最新的未结束 askId 仍立即发出 answered；同一 askId 在第二次端口触发与随后的 turn-end 都不再重发；账本里已有 answered 的历史 askId 在补发时一条也不重发（补发条数恰等于未结束的条数）；启动补扫对「有未结束提问且转写里其后已有用户消息」的会话补发、对没有的会话不发；读取器对「模型输出不可用」与「缺原话字段」的旧读数各补算一次、第二次读取不再调用。
- [ ] 假形态变红：用户消息端口改回按转写判断 ⇒ 第一条用例红；去掉跨历史去重 ⇒ 补发条数用例红。改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0（既有用例不减）。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（复制会话库，打开 `observation.sessionDigest`；事件写入指向临时 fleet home 副本，⛔ 不写真实 `~/.quay-fleet`；用 workers 网关最便宜的模型，不打印密钥）：

1. 让一个复制来的会话以提问结束，读到 asking；随即发一条用户消息，**在这一轮结束之前**读临时事件目录，贴出该 askId 的 answered 行与时间差。
2. 再发一条用户消息，贴出事件目录里该会话的 answered 行数没有增加。
3. 准备一个「有未结束提问、其后已有用户消息」的复制会话，重启实例且不触碰该会话，贴出启动补扫发出的那条 answered 与补扫计数日志。
4. 对 `dbbf1404-7c68-40f6-a709-342c1fc158ce` 的旧失败读数请求两次卡片读口，贴出第二次的问题、选项与缺省；对一张旧卡打开手机 Details，截图显示助手原话引用与「in session」链接，存 `tmp/`。

实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/gap-cockpit-ask-answered-immediate-dedup-startup-sweep-and-repair.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/index.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/shared/ports/session-user-turn.port.ts
- server/modules/websocket/services/chat-control.service.ts
- server/index.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/shared/tests/server-import-cycle-budget.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
