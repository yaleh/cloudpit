---
id: gap-cockpit-ask-detector-last-paragraph
title: 提问检测只按最后一段判定：整条消息的编号列表不再被当成提问（修 5b/0a8/8436/b96e/c07 类误发卡）
status: done
labels:
  - gap
  - cockpit
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-29 对运行中的 `:3001` `GET /api/cockpit/cards` 与 13 个会话 transcript 的只读复核（未点击任何确认/忽略）。

根因证据：23 张 ask 卡里有 18 个可解析 messageId。用产品自己的 `analyzeAsking` 对**整条**助手消息判定，18/18 都是 `isAsking=true`；对**最后一整段**判定则只有约 7 个。5b984a5f 的三条消息：a68ae9b0（5815 字、14 行编号）、b8494a51（2211 字、4 行编号）、fc0f3e2d（2010 字、3 行编号）——全文判定 true，最后一段判定 false，最后一段分别以「要的话我可以把 P0 的三条拆成 quay 任务…」「Phone remote 则作为后续独立入口讨论。」「…不能只靠 dismiss 解决。」结尾，都不是提问。

机制：`analyzeAsking()`（`server/modules/observation/session-digest.ts:294-313`）把任意位置出现 ≥2 行 `1.`/`2.` 编号当作「选项」，于是长回答被判为提问；写 `session.asking` 的 `askEndingAt`（`server/modules/observation/session-ask-decision-digest.ts:293-322`）用整条助手文本，而 digest 的 `askingYou`（`session-digest.ts:425`）只用 `lastParagraph(lastText)`。两条路径对同一条消息给出相反结论：fleet 收到 asking 事件并建卡；digest 判 idle 不写 observation object；投影显示「提问决策摘要尚未生成」且不自愈。

做什么：
- 提问判定只对**最后一段**做。判为 asking 需满足：最后一段的最后一行以 `?`/`？` 结尾，或最后一段本身就是选项列表（连续、短行、`1.`/`2.` 形式，无 Markdown 标题与长段落）。整条消息里其它位置的编号列表不再参与判定。
- `readSessionAsk`/`askEndingAt` 与 `buildSessionDigest` 的 `askingYou` 共用一个函数、同一段输入（`lastParagraph` 语义），消除两条路径的分歧。
- 不改变 `session.asking` 事件形状、`questionText` 的全文规则、fleet 契约；不处理历史撤回（由 `gap-cockpit-ask-retraction-and-ledger-backfill` 负责）。

约束：只改判定与测试；不削弱真正的「是/否」或「选项列表」提问；现有 `analyzeAsking` 的调用点（wall 强调、ask 事件）都走同一实现。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0：新增用例——带 3/4/14 行编号的长回答（最后一段是陈述）⇒ `askingYou.isAsking=false`；最后一行是问号 ⇒ true；最后一段是两条短选项 ⇒ true；问号出现在中间段落但最后一段是陈述 ⇒ false。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0：同一组夹具下 `readSessionAsk.current` 对长回答为 null、对真提问非 null；并用一个共享表断言 `readSessionAsk` 与 `buildSessionDigest.askingYou` 对同一文本给出相同 `isAsking`。
- [x] 假形态变红：把 `askEndingAt` 改回对整条 `assistantText` 调 `analyzeAsking` ⇒ 长回答用例红（又变成 asking）；改完即还原。
- [x] `npm run typecheck`、`npm run lint` 退出 0；若 `session-digest.ts` 越过基线，按 AC-394 RECORDED CHANGE 格式记录。

## DoD

真实数据回放（一次性脚本，不提交）：读取本机 5b984a5f、0a8e120a、843631e5、b96e7efc、c07db8d2 的 transcript，对各自 fleet 卡片的 messageId 跑修正后的 `readSessionAsk`，贴出「修前 full=asking / 修后 current=null」的对照表；再对 a1690759、c0aa3f51、a83c4cd4 的真提问各跑一次，贴出修后仍为 asking。说明本次不改卡片列表（撤回与本地抑制在另一任务），因此 UI DoD 不在本任务内。

## Verification

判定实现：`analyzeAssistantAsk(assistantText)` = 只对 `lastParagraph(assistantText)` 判定；`askEndingAt`/`askingRows`/`readSessionAsks` 与 `buildSessionDigest` 的 `askingYou` 全部改走它。选项臂只在「段落以一段连续短编号行结尾、无 Markdown 标题」时成立，长 lead-in 行不影响（既有 fixture 的「…请从下面选一个：」+ 两选项仍判 asking）。`analyzeAsking` 保留为段落级原语（假形态回退时对整条文本仍按旧的宽松臂判 true）。

- AC1: `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` → tests 11 / pass 11 / fail 0。
- AC2: `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` → tests 47 / pass 47 / fail 0（共享表 6 组文本）。
- AC3 假形态：把 `session-ask-decision-digest.ts` 三处 `analyzeAssistantAsk` 全部改回 `analyzeAsking`（整条文本）⇒ 47 项中 1 红：`AC: readSessionAsk and buildSessionDigest.askingYou agree on the same text`，`AssertionError: 3 行编号的长回答: readSessionAsk.current`（长回答又变 asking）；`git checkout --` 还原后复跑 47/47 绿。
- AC4: `npm run typecheck` exit 0；`npm run lint` exit 0；`architecture-ratchet.test.ts` tests 6 / pass 6，`session-digest.ts` 各维度读数未上调，未改 `architecture-ratchet.baseline.json`。

DoD 真实回放（`quay-fleet cockpit cards --json` 取各卡 messageId，对本机 transcript 只读跑修正后的 `readSessionAsk`；脚本 `tmp/replay-ask.mjs` 未提交）：

| session | messageId | chars | 修前 full | 修后 current |
| --- | --- | --- | --- | --- |
| 5b984a5f | a68ae9b0 | 5815 | asking | null |
| 5b984a5f | b8494a51 | 2211 | asking | null |
| 5b984a5f | fc0f3e2d | 2010 | asking | null |
| 0a8e120a | 662cf8d5 | 2239 | asking | null |
| 843631e5 | 3a3302f5 | 545 | asking | null |
| 843631e5 | cc921d78 | 889 | asking | null |
| b96e7efc | 662051a1 | 1763 | asking | null |
| b96e7efc | 634c87aa | 1483 | asking | null |
| c07db8d2 | 8bdb6467 | 2034 | asking | null |

真提问（修后必须仍为 asking）：

| session | messageId | chars | 修前 full | 修后 current |
| --- | --- | --- | --- | --- |
| c0aa3f51 | 52c517c4 | 478 | asking | asking（rev1） |
| a83c4cd4 | a7550f4a | 1207 | asking | asking（rev1） |

a1690759 无法回放：本机 `auth.db` 无该 session 行，全项目 jsonl 中也没有 `uuid=10b2bc32-…` 的助手行（该 id 仅出现在事件/工具输出文本里），transcript 已不存在。如实记录，未用合成数据冒充真实回放。

本次不改卡片列表（撤回与本地抑制在 `gap-cockpit-ask-retraction-and-ledger-backfill`），因此 UI DoD 不在本任务内。

## Notes

该轴仍暗,理由:提问判定与测试改动，无架构图/依赖图读数可测

## Touches

- tasks/gap-cockpit-ask-detector-last-paragraph.md
- server/modules/observation/session-digest.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/tests/session-digest.test.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/shared/tests/architecture-ratchet.baseline.json