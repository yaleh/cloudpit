---
id: gap-cockpit-asking-event-question-text
title: session.asking 事件补写 questionText（未截断全文、空文本不写），让 fleet 的「会话+规范化全文」去重键覆盖严格全文
status: done
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

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0，新增用例：一次提问写出的 `session.asking` 行 `data.questionText` **逐字等于**该助手消息的文本（比对全串）；给一条 200000 字符的助手消息，`questionText.length` 等于原文长度且首尾各 100 字符与原文一致（钉住「不截断」）；同一 askId+revision 重放两次写出相同字符串；`assistantText` 为空的提问**不含** `questionText` 键。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0（既有 asking/answered 载荷断言未被破坏）。
- [x] 假形态变红：把 `questionText` 从 payload 中删掉 ⇒ 第一条用例红；加上任意 4000 字截断（尾部或头部）⇒ 长文本用例红（「不截断」是契约）；改完即还原。
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

2. 同一会话再问一次（追加 user+assistant 一轮，新 messageId `a2`、同一句问题）：第二条 asking 行的 `questionText` 与第一条**逐字相同**，且两条都与转写原文逐字相同（本轮重跑对比：`a1_event==transcript: True`、`a2_event==transcript: True`、`IDENTICAL a1==a2: True`，两条都是 78 字符）：

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

4. 长回答腿（25000 字符；上一轮 DoD 缺这一条，旧实现会把它截到 4000，本轮新增）：`session.asking` 行的 `questionText` 与转写原文**逐字相同**（`eq=True`，首尾各 100 字符一致，`truncated` 键不存在），该行在事件文件里的字节数为 **75450**：

   ```
   messageId=a4 len=25000 line_bytes=75450 truncated=None eq=True head100=True tail100=True
   ```

   体积代价如实记录：25000 个 CJK 字符按 UTF-8 每字 3 字节约 75 KB，一条 asking 行就超过 fleet schema 建议的 16 KB 行宽。这是「严格全文键」的直接代价。顺带说明**为什么 writer 必须改**：`context-event-writer.ts` 原先会把超 16 KB 的行里最长字符串截断；上一轮没跑长文本腿所以没暴露——旧构建下这一行实测被截成 `questionText: ""` 并带 `data.truncated: true`，fleet 的文本键会覆盖不到全文。

5. 交给 fleet 自己的实现复算（`/data/home/yale/work/quay-fleet/src/session-ask.ts` 的 `questionTextEntity`，该文本键已由 fleet 侧落地，不再是上一轮记录的「尚未落地」）：

   ```
   a1 chars=78    entity=3b559b9c-3350-432e-82b1-139c282ec58c:a2fde7541f7dd4f3
   a2 chars=78    entity=3b559b9c-3350-432e-82b1-139c282ec58c:a2fde7541f7dd4f3
   a4 chars=25000 entity=3b559b9c-3350-432e-82b1-139c282ec58c:b9549649e0fa7f19   normLen=24999
   ```

   两条同题重问（不同 messageId、不同 askId）落在**同一个**文本实体上——这正是去重键能命中的前提；25000 字那条得到自己的实体，规范化后仍是 24999 字（只去掉句末「？」）。

## 完成记录

- **补字段（不截断）**：`sessionAskQuestionText(assistantText)` 返回原文全文（去空白后为空返回 `null`），`buildSessionAskingData(sessionId, current)` 在 `server/modules/observation/session-digest.producer.ts` 组装 asking 事件的 `data`。`askId`/`messageId`/`revision`/`contentRef` 原样保留，`data` 仍是开放对象。
- **撤销 4000 字上限**：上一轮实现的 `SESSION_ASK_QUESTION_TEXT_MAX_CHARS = 4000` 尾部截断按用户 2026-10-29 改判删除；构造器与 `SessionAskEvent` 的文档注释都写明「唯一全文、不截断、截断会把不同提问并成一个键」。
- **writer 侧行宽豁免（本轮新发现的缺口）**：`server/modules/context-events/context-event-writer.ts` 原先把超 16 KB 行里最长的字符串截断并标 `data.truncated`。本轮把 `session.asking.data.questionText` 列为 verbatim 字段（`SESSION_ASKING_VERBATIM_FIELDS`）：该字段永不切；当且仅当超宽来自它时，整行按原样落盘且不标 `truncated`。其余事件/字段照旧截断（`utterance` 的 AC1(c) 截断判据仍绿）。
  - 契约依据：quay-fleet 的 schema `write` 段只规定截断 `data.text`，其**读取侧**逐行解析、无行宽校验；fleet 自己的 writer 仍按 `write.maxLineBytes=16384` 约束它自己写的事件。本仓库因此成为唯一写入超宽行的一方——若 fleet 以后把 `maxLineBytes` 当硬校验，需要 fleet 侧同步豁免该字段，如实记录在此。
- **测试**：`session-ask-decision-digest.test.ts` 覆盖逐字比对、200000 字符不截断（含首尾各 100 字符）、同 askId+revision 重放同一字符串、空白文本省略键，以及启动补扫带 `questionText` 行的用例；`context-event-writer.test.ts` 新增 AC1(g)：9001 字 `questionText` 原样落盘（实测 27228 字节行），无 `truncated` 键。
- **变异验证（改完即还原）**：删掉 `questionText` 展开 ⇒ 逐字用例红；改成 `slice(-4000)`（尾部截断）⇒ 长文本用例红；改成 `slice(0,4000)`（头部截断）⇒ 同样红。
- **复跑读数**：AC1 `session-ask-decision-digest.test.ts` 41/41、AC2 `session-digest.test.ts` 10/10、AC4 `quay-test-script.test.ts` 14/14，均 exit 0；writer 判据 10/10；architecture-ratchet 6/6；`npm run typecheck` exit 0；`npm run lint` exit 0（仅既有 warning）。
- **上一轮那条 suite 红已复核为环境问题，与本任务 delta 无关**：`server/modules/providers/tests/skills.test.ts` 本轮再次复现同一形状（codex 作用域 `undefined !== 'repo'`、opencode `'project' !== 'user'`）。裸跑该文件（沿用宿主机 TMPDIR）仍红；`TMPDIR=/var/tmp/askqt-check` 下 6/6 全绿。根因是宿主机 `/tmp/.git` 让 `findTopmostGitRoot` 把 `os.tmpdir()` 当成仓库根。develop 的 `5a022fee4`（`scripts/test.sh` 把 TMPDIR 隔离到祖先链无 `.git` 的私有根，children 共用同一根）已在本次 pre-merge 进入本分支（`git merge-base --is-ancestor 5a022fee4 HEAD` 为真），suite 走 `scripts/test.sh` 时继承干净 TMPDIR。
- **ratchet**：`server/shared/types.ts` 仍是 5265 行（注释改写等行数）；`server/modules/context-events/context-event-writer.ts` 797→849 成为 `oversizeFiles` 新条目，已按 RECORDED CHANGE 格式写入 `server/shared/tests/architecture-ratchet.baseline.json`。
- 未新增 server 测试文件，测试文件计数钉子与 `scripts/suite-duration-baseline.tsv` 无需改动。
- **pre-merge / anti-drift**：`git merge --no-edit develop` 无冲突完成；`anti-drift-touches-check.js --merge-target develop` 报 `ANTI-DRIFT OK — 6 actual file(s), all within declared Touches (8 glob(s))`。
- L_D cloudcli-session-asking: asking_rows=3 question_text_verbatim=3/3 truncated=0 long_chars=25000 long_line_bytes=75450
- L_G fleet-session-ask: text_entities=2 identical_pairs=1 a1_same_as_a2_sha1_16=a2fde7541f7dd4f3 a4_norm_chars=24999 a4_sha1_16=b9549649e0fa7f19

## Touches

- tasks/gap-cockpit-asking-event-question-text.md
- server/modules/observation/session-digest.producer.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/observation/tests/session-digest.test.ts
- server/modules/context-events/context-event-writer.ts
- server/modules/context-events/tests/context-event-writer.test.ts
- server/shared/types.ts
- server/shared/tests/architecture-ratchet.baseline.json

## Blocker

**2026-10-29T05:43:48.665Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/modules/providers/tests/skills.test.ts:   AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: [baseline A/B: HARD RED (changed-assertion) — the task's red set is NOT a subset of the develop baseline red set: added=- changed=server/modules/providers/tests/skills.test.ts]
- run_id：wk-prod-anchor
- session_id：b1fed98a-43cb-4649-835b-be6a6fa6be36
