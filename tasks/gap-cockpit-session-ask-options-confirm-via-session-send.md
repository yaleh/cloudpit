---
id: gap-cockpit-session-ask-options-confirm-via-session-send
title: 会话提问卡的选项可以确认：选项绑定 session.send，把「选项名 — 做什么」作为回复发回原会话（经确认卡），取代不可执行的占位执行器
  fleet.cockpit.session-ask-option
status: todo
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

来源：2026-10-28 10:50 线上读数（构建 `cfc248c00`）。判官补位上线后，会话提问卡都预选了缺省项（例如「晋升到 ready 让 worker 接手」，source=judge，附理由），但**每个选项都确认不了**：`/api/cockpit/cards` 里这些选项 `confirmable: false`，`confirmableReason: 执行器 fleet.cockpit.session-ask-option 尚未接入`，确认条是灰的，只能走「自己的回复」。这是驾驶舱主流程（约三分之一的待决事项是会话提问）。

根因：`server/modules/cockpit/cockpit-fleet-card-projection.ts` 的 `contentOption()`（约第 207–227 行）给每个由 T1 摘要补全的选项绑定 `COCKPIT_FLEET_ASK_OPTION_EXECUTOR = 'fleet.cockpit.session-ask-option'`，该常量的注释写明它是**刻意不声明**的占位，让确认被通道以 `EXECUTOR_NOT_DECLARED` 拒绝。K2（`cockpit-fleet-card-provider`）的任务正文没有规定会话提问卡选项的执行方式。

正确语义：在会话提问卡上选一个选项，就是在原会话里回答助手。所以选项应走 CloudCLI 已有的 `session.send` 执行器（`server/modules/cockpit/cockpit-session-send.executor.ts`，params `{ sessionId, text }`），与「自己的回复」同一条路，仍先经确认卡。用户 2026-10-28 确定发送内容为**选项名加一句「做什么」说明**。

做什么：

- `contentOption()` 的 `action` 改为 `{ executor: 'session.send', params: { sessionId: <subject.sessionId>, text: '<label> — <does>' } }`（`does` 为空时只发 label）；`sessionId` 取卡片 `subject.sessionId`（会话提问卡总有）。
- 删除 `COCKPIT_FLEET_ASK_OPTION_EXECUTOR` 常量及其导出与所有引用（含 `server/modules/cockpit/index.ts`），不留占位。
- 确认后：发送成功即返回成功；会话随后有用户发言，fleet 按 `session.answered` 自行结束卡片（CloudCLI 不在本地判定结束）。
- 卡片上缺省项的确认条因此可用；只有 `subject.sessionId` 缺失这种异常卡才不可确认，并给出可读原因。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts` 退出 0，新增用例：补全后的会话提问卡每个选项 `action.executor === 'session.send'`，`params.sessionId` 等于卡片 `subject.sessionId`，`params.text` 等于「label — does」（does 为空时等于 label）；投影后这些选项不带 `confirmable: false`。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/cockpit/tests/cockpit-session-executors.test.ts` 退出 0，新增用例：确认一个会话提问卡选项 ⇒ 发送函数恰好被调用一次，目标会话与文本正确。
- [ ] `grep -rn "session-ask-option" server src --include=*.ts --include=*.tsx` 无命中。
- [ ] 假形态变红：把执行器改回任意未声明的 id ⇒ 第一条新用例红；改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck` 与 `npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（复制会话库，打开 `cockpit.fixtureCards` 与 `observation.sessionDigest`；会话提问卡可由临时未提交的提供方给出，指向复制库里一个已结束、无人在用的会话）上用 MCP 浏览器在 390 宽度打开卡片页：缺省项的确认条可用；点确认、在确认卡上再确认 ⇒ 该会话转写尾部多出一条用户消息，内容为「选项名 — 做什么」，贴出转写尾部与确认接口响应，截图存 `tmp/`。⛔ 不对线上实例或真实在用的会话发送任何消息。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/gap-cockpit-session-ask-options-confirm-via-session-send.md
- server/modules/cockpit/cockpit-fleet-card-projection.ts
- server/modules/cockpit/index.ts
- server/modules/cockpit/tests/cockpit-fleet-card-provider.test.ts
- server/modules/cockpit/tests/cockpit-session-executors.test.ts
