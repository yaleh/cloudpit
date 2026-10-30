---
id: gap-session-ask-task-notification-is-not-a-user-prompt
title: session-ask 把 <task-notification> 后台通知误当 user prompt，铸出 spurious
  session.answered
status: ready
labels:
  - cockpit
parent: null
children: []
extra: {}
---
## Proposal

`isUserPromptRow`（`server/modules/observation/session-digest.ts:169`）把任何带非空 text 的 `user` 行都当「真实用户回合」（tool result 除外，它没有 text）。但 harness 把**后台任务完成通知**（`<task-notification>…</task-notification>`）也写进 transcript 的 `user` 行，内容是裸字符串——`rowContentBlocks`（`:145`）把 string content 归一成 `{type:'text', text:'<task-notification>…'}`，于是 `isUserPromptRow` 对这条行返回 true。后果链：`readSessionAsks`（`session-ask-decision-digest.ts:425`）把一条 pending 提问**之后**的 `<task-notification>` 行当成「后来的 user prompt」⇒ 判该提问 `settled` ⇒ `stateSettledPending`（`session-ask-ledger.ts`）在 turn 结束铸出一条**无真实 user 回合**的 `session.answered`。实测 `49622a6c`：07:33:48 提问（codex resident 权限断点）、07:39:29 transcript 里出现 `<task-notification>` user 行、07:39:41 出无 user 回合的 `session.answered`。这条 spurious answered 污染 ledger（把 ask 标记已答），用户 07:59:04 的真实回复无法再归属到这条。fleet 侧已加防御（answered 需 utterance 佐证），本任务是**停掉源头继续铸**。

## Plan

1. `isUserPromptRow` 收紧：`user` 行 text 是 `<task-notification>…</task-notification>`（及同类 harness 注入的 synthetic 标记）⇒ 不当作真实 user prompt（⛔ 不改 `rowContentBlocks`——它是通用读取；只收紧「是不是真实 prompt」这一判）。
2. `readSessionAsks` 随之正确：pending 提问后面只跟 `<task-notification>`、没有真实 user 消息 ⇒ 该提问仍归 tail span 的 `current`，不进 `settled`。
3. `stateSettledPending` 在 turn 结束不再因 `<task-notification>` 行铸 `session.answered`（`stated` 计数为 0）。

## AC

- [ ] AC1: transcript 里 pending 提问之后只有 `<task-notification>` user 行（无真实 user 文本消息）⇒ `readSessionAsks` 返回该提问为 `current`（`settled` 为空）。
- [ ] AC2: 真实 user 文本消息（非 `<task-notification>`）仍判 prompt 边界 ⇒ 提问进 `settled`（回归现有行为不破坏）。
- [ ] AC3: `stateSettledPending` 在 turn 结束不因 `<task-notification>` 行铸 `session.answered`（无真实 user prompt 时 `stated=0`）。

## DoD

在 landed 提交上，`<task-notification>` 后台通知不再被 `isUserPromptRow` 当作 user prompt；pending 提问在真实用户回复前，不再被 turn 结束级联铸出 spurious `session.answered`。

## Touches

- server/modules/observation/session-digest.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- tasks/gap-session-ask-task-notification-is-not-a-user-prompt.md
