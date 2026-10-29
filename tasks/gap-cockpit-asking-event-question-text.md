---
id: gap-cockpit-asking-event-question-text
title: session.asking 事件补写 questionText（原文、尾部截断 4000 字、空文本不写），供 fleet 以「会话+规范化问题文本」去重
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra: {}
---
## Proposal

来源：2026-10-28/29 与 quay-fleet 会话对齐「重复提问卡」根因。fleet 核实：`c0aa3f51` 两条卡是不同 askId（`…:821a8ee6`、`…:52c517c4`），因为 dedupKey 含 messageId；并指出 CloudCLI 写出的 `session.asking.data` 目前只有 `{askId, messageId, revision, contentRef}`，**没有问句文本**，fleet 无法按文本去重。

双方定下的分工（fleet 2026-10-29 回复）：

- CloudCLI 在 `session.asking.data` 中补写 `questionText`（原文）；
- fleet 用「会话 + 规范化问题文本」做 session-ask 的 dedupKey（规范化：去首尾空白、压缩连续空白、去句末标点、拉丁字母小写；键 = `projectId|session-ask|<sessionId>:<sha1(规范化文本)前16位>`），有 `questionText` 用文本键、没有则回退旧 askId 键，不破坏存量；
- 同义改写不去重，交给驾驶舱侧的同题折叠兜底（`gap-cockpit-duplicate-cards-collapsed`）。

现状：`server/modules/observation/session-digest.producer.ts:446-462` 组装 `session.asking` 的 `data`；`readSessionAsk(...).current.assistantText` 已经有这条提问消息的原文（`server/modules/observation/session-ask-decision-digest.ts` 的 `SessionAskReading`），不需要再读一遍转写。

做什么：

- **补字段**：`data.questionText` = `current.assistantText`，尾部截断到 `SESSION_ASK_QUESTION_TEXT_MAX_CHARS = 4000`（常量与截断函数放在 producer 所在模块，注释写明「截断只影响键的稳定性，必须确定性」；同一 askId + revision 重放得到同一字符串）。
- **只加字段，不改已有键**：`askId`、`messageId`、`revision`、`contentRef` 原样保留；`data` 仍是开放对象，不新增封闭枚举。
- **空文本不写该字段**：`assistantText` 去空白后为空时不写 `questionText`（fleet 据此回退旧键），避免写出 `questionText: ""` 让键变成空文本的哈希。
- **文档注释**：在 `SessionAskEvent` 类型旁写明 `questionText` 的语义（原文、尾部截断上限、供 fleet 的文本键使用），说明它不是给界面显示用的。
- **回归**：`session-ask-stream-reader.ts` 的启动补扫只读 `askId`/`messageId`，新增字段不影响它；补一条用例证明补扫对带 `questionText` 的行照旧工作。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：一次提问写出的 `session.asking` 行 `data.questionText` 等于该助手消息的文本（去首尾空白后比对）；超过 4000 字符的文本按尾部截断且长度等于上限；同一 askId+revision 重放两次写出相同字符串；`assistantText` 为空的提问**不含** `questionText` 键。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0（既有 asking/answered 载荷断言未被破坏）。
- [ ] 假形态变红：把 `questionText` 从 payload 中删掉 ⇒ 第一条用例红；把截断改成保留头部 ⇒ 截断用例红（尾部截断是契约的一部分）；改完即还原。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0（本任务不新增 server 测试文件；若新增，测试文件计数钉子与 `scripts/suite-duration-baseline.tsv` 同步更新并补进 Touches）。
- [ ] `npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（关 residentRestore；fleet home 指向临时副本，⛔ 不写真实 `~/.quay-fleet`）：

1. 让一个复制来的会话以一次提问结束；贴出临时事件目录里那条 `session.asking` 行（含 `questionText`，可截断展示）。
2. 同一会话再问一次（新 messageId、同一句问题）：贴出第二条 asking 行的 `questionText` 与第一条逐字相同（这是 fleet 文本键能命中的前提）。
3. 贴出补扫日志，证明带新字段的事件流不影响启动补扫。
4. 把该行原文交给 fleet 校验其规范化结果（在任务完成记录里贴出 fleet 的回复或本地用同一规则复算的 sha1 前 16 位）。

## Touches

- tasks/gap-cockpit-asking-event-question-text.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/observation/tests/session-digest.test.ts
- server/shared/types.ts
- server/shared/tests/architecture-ratchet.baseline.json
