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
- **与 fleet 对齐（2026-10-29）**：fleet 用**整条消息原文**的规范化形式做键，不做「末尾问句」启发式。CloudCLI 在写入前做**尾部** 4000 字截断，这是事件体积上限，不是语义抽取：文本不超过 4000 字时键覆盖全文；超过时键只覆盖末尾 4000 字，因此两段只在 4000 字之前不同的提问会被并成同一键。这一取舍要写进常量注释，并在任务完成记录里向 fleet 说明（fleet 若要严格全文键，须改上限并重立 AC）。
- **只加字段，不改已有键**：`askId`、`messageId`、`revision`、`contentRef` 原样保留；`data` 仍是开放对象，不新增封闭枚举。
- **空文本不写该字段**：`assistantText` 去空白后为空时不写 `questionText`（fleet 据此回退旧键），避免写出 `questionText: ""` 让键变成空文本的哈希。
- **文档注释**：在 `SessionAskEvent` 类型旁写明 `questionText` 的语义（原文、尾部截断上限、供 fleet 的文本键使用），说明它不是给界面显示用的。
- **回归**：`session-ask-stream-reader.ts` 的启动补扫只读 `askId`/`messageId`，新增字段不影响它；补一条用例证明补扫对带 `questionText` 的行照旧工作。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：一次提问写出的 `session.asking` 行 `data.questionText` 等于该助手消息的文本（去首尾空白后比对）；超过 4000 字符的文本按尾部截断且长度等于上限；同一 askId+revision 重放两次写出相同字符串；`assistantText` 为空的提问**不含** `questionText` 键。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0（既有 asking/answered 载荷断言未被破坏）。
- [x] 假形态变红：把 `questionText` 从 payload 中删掉 ⇒ 第一条用例红；把截断改成保留头部 ⇒ 截断用例红（尾部截断是契约的一部分）；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0（本任务不新增 server 测试文件；若新增，测试文件计数钉子与 `scripts/suite-duration-baseline.tsv` 同步更新并补进 Touches）。
- [x] `npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（关 residentRestore；fleet home 指向临时副本，⛔ 不写真实 `~/.quay-fleet`）：

1. 让一个复制来的会话以一次提问结束；贴出临时事件目录里那条 `session.asking` 行（含 `questionText`，可截断展示）。
2. 同一会话再问一次（新 messageId、同一句问题）：贴出第二条 asking 行的 `questionText` 与第一条逐字相同（这是 fleet 文本键能命中的前提）。
3. 贴出补扫日志，证明带新字段的事件流不影响启动补扫。
4. 把该行原文交给 fleet 校验其规范化结果（在任务完成记录里贴出 fleet 的回复或本地用同一规则复算的 sha1 前 16 位）。

## DoD 结果

隔离实例：`ISOLATED_INSTANCE_STATE_DIR=/tmp/ask-questiontext-dod/state`、`ISOLATED_INSTANCE_SOURCE_DB=/tmp/ask-questiontext-dod/source.db`（`~/.cloudcli/auth.db` 的 better-sqlite3 备份副本）、`HOME=/tmp/ask-questiontext-dod/home`（fleet home 指向该临时副本，真实 `~/.quay-fleet` 未被写入）、`PATH=/tmp/ask-questiontext-dod/bin:$PATH`（`claude` 是 argv 桩）。residentRestore 关闭：启动输出 `resident-restore started=0 (restore is disabled; a pass cannot run)`。会话 `3b559b9c-3350-432e-82b1-139c282ec58c` 的 `jsonl_path` 指向 `/tmp/ask-questiontext-dod/transcript.jsonl`。

1. 第一次提问（messageId `a1`，revision 1，askId `3b559b9c-…:a1`）写进临时事件目录的 `session.asking` 行（`questionText` 截断展示）：

   ```json
   {"kind":"session.asking","session":"3b559b9c-3350-432e-82b1-139c282ec58c",
    "data":{"askId":"3b559b9c-…:a1","messageId":"a1","revision":1,
            "questionText":"要不要我把 session.asking 的 questionText 一起补上？\n\n我建议先补，然后让 fleet 用文本键去重。\n你希望我现在就改吗？",
            "contentRef":{"resolver":"cloudcli.session-ask","sessionId":"3b559b9c-…","messageId":"a1"}}}
   ```

2. 同一会话再问一次（追加 user+assistant 一轮，新 messageId `a2`、同一句问题）：第二条 asking 行的 `questionText` 与第一条**逐字相同**（逐字比对 `IDENTICAL: true`，两条都是 78 字符）：

   ```
   {"messageId":"a1","revision":1,"askId":"…:a1","len":78}
   {"messageId":"a2","revision":1,"askId":"…:a2","len":78}
   IDENTICAL: true
   ```

3. 重启后的启动补扫日志（事件流里带 `questionText` 的 asking 行照旧被补进 ledger，且不重述提问）：

   ```
   2026-10-29T05:28:31.592Z [observation.sessionDigest] 启动补扫: 从事件流补进 1 个旧 askId，检查 4 个有未结束提问的会话，补发 0 条 session.answered
   ```

   重启前后 `session.asking` 行数都是 2；补扫写回的 ledger 落在 `observed_objects`：`cloudcli://session/3b559b9c-…` revision 2，`askEvents={"answered":[],"asking":["3b559b9c-…:a2:1"],"pending":[{"askId":"…:a2","messageId":"a2"}]}`。

4. 规范化复算（按 fleet 2026-10-29 定的规则：去首尾空白、压缩连续空白、去句末标点、拉丁字母小写）：

   ```
   规范化: "要不要我把 session.asking 的 questiontext 一起补上？ 我建议先补，然后让 fleet 用文本键去重。 你希望我现在就改吗"
   sha1[:16] = a2fde7541f7dd4f3
   ⇒ dedupKey = <projectId>|session-ask|3b559b9c-3350-432e-82b1-139c282ec58c:a2fde7541f7dd4f3
   ```

   quay-fleet 侧文本键尚未落地（其 `src/session-ask.ts` 当前仍是 `<projectId>|session-ask|<askId>`），所以这里贴的是**本地按同一规则复算**的读数，未经 fleet 运行时确认。

## 完成记录

- 实现：`SESSION_ASK_QUESTION_TEXT_MAX_CHARS = 4000`、`sessionAskQuestionText(assistantText)`（尾部截断；去空白后为空返回 `null`）、`buildSessionAskingData(sessionId, current)` 都在 `server/modules/observation/session-digest.producer.ts`；asking 事件的 `data` 改由该构造器组装。`SessionAskEvent` 的类型注释写明 `questionText` 是原文、尾部截断 4000、空文本省略、只供 fleet 文本键使用，**不是显示字段**。
- 只加字段：`askId`、`messageId`、`revision`、`contentRef` 原样保留，`data` 仍是开放对象。
- **尾部截断的取舍（告知 fleet）**：文本 ≤4000 时文本键覆盖全文；>4000 时键只覆盖**末尾** 4000 字，两段只在 4000 字之前不同的提问会被并成同一键。fleet 若要严格全文键，须改上限并重立 AC。
- 空文本用例钉在 payload 构造器上：转写扫描的 `analyzeAsking` 不会产出空文本提问，所以「不含 `questionText` 键」只能在这一层验证，测试注释已写明。
- 架构 ratchet：`server/shared/types.ts` 5257→5265 行，`server/shared/tests/architecture-ratchet.baseline.json` 已同步，并在 `note` 末尾追加 RECORDED CHANGE（2026-10-29，gap-cockpit-asking-event-question-text）。
- 变异验证（改完即还原，diff 与备份逐字一致）：删掉 `questionText` 的展开 ⇒ 原文用例红（`'undefined'` vs `'string'`）；截断改成 `slice(0, MAX)` ⇒ 截断用例红（"the TAIL is kept"）。
- 复跑读数：AC1 `session-ask-decision-digest.test.ts` 41/41、AC2 `session-digest.test.ts` 10/10、AC4 `quay-test-script.test.ts` 14/14，均 exit 0；`npm run typecheck` exit 0；`npm run lint` exit 0（仅既有 warning）。
- 未新增 server 测试文件，测试文件计数钉子与 `scripts/suite-duration-baseline.tsv` 无需改动。
该轴仍暗,理由:fleet 侧「会话+规范化问题文本」的 dedupKey 尚未落地（其 src/session-ask.ts 仍按 askId 去重），本仓库没有该轴可观察的端到端读数，只有写入侧字段与本地 sha1[:16] 复算。

## Touches

- tasks/gap-cockpit-asking-event-question-text.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/observation/tests/session-digest.test.ts
- server/shared/types.ts
- server/shared/tests/architecture-ratchet.baseline.json
