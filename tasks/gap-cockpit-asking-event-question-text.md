---
id: gap-cockpit-asking-event-question-text
title: session.asking 事件补写 questionText（未截断全文、空文本不写），让 fleet 的「会话+规范化全文」去重键覆盖严格全文
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

- **补字段（不截断）**：`data.questionText` = `current.assistantText` 的**全文**，一个字都不截。用户 2026-10-29 改判：去重键必须覆盖严格全文。同一 askId + revision 重放得到同一字符串（直接取转写原文，不做任何加工）。
- **与 fleet 对齐（2026-10-29，4000 字上限已按用户改判撤销）**：fleet 用**整条消息原文**的规范化形式做键，不做「末尾问句」启发式。fleet 起初接受 4000 字尾部截断，用户随后要求键覆盖**严格全文**，因此这里**不设上限、不截断**：`questionText` 与转写里那条助手消息的文本逐字相同（含全部前后缀与空白）。已知代价如实记录：长回答的 `session.asking` 行可能几万到几十万字符，事件文件增长更快——这是为「严格全文键」付的代价，不保留任何「超过 N 字截断」的后门。
- **只加字段，不改已有键**：`askId`、`messageId`、`revision`、`contentRef` 原样保留；`data` 仍是开放对象，不新增封闭枚举。
- **空文本不写该字段**：`assistantText` 去空白后为空时不写 `questionText`（fleet 据此回退旧键），避免写出 `questionText: ""` 让键变成空文本的哈希。
- **文档注释**：在 `SessionAskEvent` 类型旁写明 `questionText` 的语义（**未截断**的提问消息全文，供 fleet 的全文文本键使用），说明它不是给界面显示用的，并写明「不要为了体积对它做截断——截断会让不同提问并成同一个键」。
- **回归**：`session-ask-stream-reader.ts` 的启动补扫只读 `askId`/`messageId`，新增字段不影响它；补一条用例证明补扫对带 `questionText` 的行照旧工作。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：一次提问写出的 `session.asking` 行 `data.questionText` **逐字等于**该助手消息的文本（比对全串）；给一条 200000 字符的助手消息，`questionText.length` 等于原文长度且首尾各 100 字符与原文一致（钉住「不截断」）；同一 askId+revision 重放两次写出相同字符串；`assistantText` 为空的提问**不含** `questionText` 键。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0（既有 asking/answered 载荷断言未被破坏）。
- [ ] 假形态变红：把 `questionText` 从 payload 中删掉 ⇒ 第一条用例红；加上任意 4000 字截断（尾部或头部）⇒ 长文本用例红（「不截断」是契约）；改完即还原。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0（本任务不新增 server 测试文件；若新增，测试文件计数钉子与 `scripts/suite-duration-baseline.tsv` 同步更新并补进 Touches）。
- [x] `npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

隔离实例（关 residentRestore；fleet home 指向临时副本，⛔ 不写真实 `~/.quay-fleet`）：

1. 让一个复制来的会话以一次提问结束；贴出临时事件目录里那条 `session.asking` 行（含 `questionText`，可截断展示）。
2. 同一会话再问一次（新 messageId、同一句问题）：贴出第二条 asking 行的 `questionText` 与第一条逐字相同（这是 fleet 文本键能命中的前提）。
3. 贴出补扫日志，证明带 `questionText` 的事件流不影响启动补扫。
4. 贴一条长回答（≥ 20000 字符）的 asking 行：`questionText.length` 等于转写原文长度，并给出该行在事件文件里的字节数，如实记录体积代价。
5. 把该行原文交给 fleet 校验其规范化结果（在任务完成记录里贴出 fleet 的回复或本地用同一规则复算的 sha1 前 16 位）。

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

## Blocker

**2026-10-29T05:43:48.665Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/modules/providers/tests/skills.test.ts:   AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/modules/providers/tests/skills.test.ts]
- run_id：wk-prod-anchor
- session_id：b1fed98a-43cb-4649-835b-be6a6fa6be36
