---
id: gap-observation-peer-message-not-a-user-prompt
title: observation 把跨会话 peer 消息当成真人 prompt，提前 settle pending ask 导致卡片永远 open
status: ready
labels:
  - gap
  - defect
  - observation
parent: null
children: []
extra:
  schema: execution
---
## Proposal

2026-11-02 23:33 的一张 session-ask 卡（`att_1540a0df3be2`，dedupKey `claudecodeui|session-ask|2c5f586d…:b18c19b04fe93292`）在真人回复后仍保持 open。复现链全部在 observation 层：

1. CLI 把别的 Claude 会话发来的 peer 消息写成一条 `type:user` 行：正文先是固定 lead-in `Another Claude session sent a message:`，再是一段**带属性**的 `<cross-session-message from="…" from-name="…" from-mode="…">…</cross-session-message>`；行上还有 `isMeta:true`、`promptSource:"system"`、`turnOrigin:"peer"`、`origin.kind:"peer"`。真实形状已用 transcript 与 `server/modules/providers/tests/claude-cross-session-message.test.ts` 的同类行核对。
2. `server/modules/observation/session-digest.ts` 的 `isUserPromptRow` 只看 role 与文本块；`SYNTHETIC_USER_TURN_TAGS` 没有 `cross-session-message`，且 `SYNTHETIC_USER_TURN_ENVELOPE` 只匹配裸 `<tag>`、不接受开标签属性。于是这条 peer 行被当成真人 prompt。
3. `readSessionAsks`（`session-ask-decision-digest.ts`）用 `isUserPromptRow` 划分 prompt 边界，把 peer 行当作对上一问的回答；`stateSettledPending` 据此提前 settle 并消耗 pending。
4. 真人 utterance 到达时，`session-ask-recovery.ts` 的 `stateUserTurnAnswers` 因 `unfinished` 为空直接 return，不再发 `session.answered`；fleet 只认有真人 utterance 佐证的 answered ⇒ 卡永远 open。

<!-- dedup-ref --> 相关已落地任务 `gap-cross-session-message-dropped-by-ismeta-gate` 修的是历史投影把 peer 行整条藏掉；本任务是 observation 的 prompt 判定把 peer 行当成真人回答，机制不同，独立立案。`gap-cockpit-ask-ledger-independent-of-digest-and-backfill`、`gap-cockpit-ask-retraction-and-ledger-backfill` 建立的是 ledger/backfill 本体，本任务不改它们。

修复范围只含根因，不新增 UI 入口：
- `isUserPromptRow` 增加结构性 peer 判定：`origin.kind === 'peer'`（兼容 `turnOrigin === 'peer'`）的行不是真人 prompt。
- 文本兜底：`SYNTHETIC_USER_TURN_TAGS` 增加 `cross-session-message`；envelope 正则接受开标签属性；剥离固定 lead-in `Another Claude session sent a message:`，使缺少 origin 的旧行也能整段剥空。
- 不改 provider 侧历史投影：它已按 `isMeta` 隐藏非 peer 行、放行 peer 行，既有测试钉住该行为。

逃生口现状：`kind === 'ask'` 的卡片在列表与详情都已有 Ignore / discard（`cockpitCardDerived.ts` 的 `dismissTargetOf`；2026-11-01 已在运行实例实测列表、详情与确认态）。本次事故卡是 session-ask，故不需要新增 UI 入口；本任务只修自动 settle 的误判。

## AC

- [ ] AC1：`bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0；新增用例钉住 peer 行形态（lead-in + 带属性 `<cross-session-message …>` + `isMeta:true` + `origin.kind:'peer'`）的 `isUserPromptRow` 为 `false`，并保留对照：同样正文但没有 envelope 的真人行为 `true`。
- [ ] AC2：同一命令运行 `server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0；新增用例：ask 之后只来 peer 行时 `scan.settled` 为 `[]` 且该 ask 仍是 `current`；再跟一条真人行时 `scan.settled` 只含真人行的 messageId，且不含 peer 行 id。
- [ ] AC3：同一测试文件退出 0；新增 turn-end 用例：事故形状下 peer 行不写出 `session.answered`，真人行只写一条且 `data.messageId` 等于真人行 id；同一 transcript 再跑一次 turn-end 不重复写。
- [ ] AC4：`npm run typecheck` 与 `npm run lint` 分别退出 0。

## DoD

必须操作真实机制对象，而不是只让测试变绿：

- 用事故 transcript 的真实形状（固定 lead-in、带属性 envelope、`origin.kind='peer'`）走真实 producer + recovery：peer 行不消耗 pending、不产生 `session.answered`；随后真人 utterance 到达时产生且只产生一条 `session.answered`，其 `messageId` 指向真人行。再跑一次 turn-end 读回仍是同一条，不重复。
- 在运行实例或隔离实例上对一张 ask 卡只读确认列表与详情都有 Ignore / discard，并从详情展开确认后点取消（不改动用户真实决定），保留截图；证明自动 settle 修复后逃生口仍可用。
- 在任务完成记录贴出：窄范围测试命令与 exit code、ledger/事件读回、截图路径。

## Touches

- server/modules/observation/session-digest.ts
- server/modules/observation/tests/session-digest.test.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- tasks/gap-observation-peer-message-not-a-user-prompt.md
