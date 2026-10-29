---
id: gap-cockpit-ask-detector-last-paragraph
title: 提问检测只按最后一段判定：整条消息的编号列表不再被当成提问（修 5b/0a8/8436/b96e/c07 类误发卡）
status: ready
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

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts` 退出 0：新增用例——带 3/4/14 行编号的长回答（最后一段是陈述）⇒ `askingYou.isAsking=false`；最后一行是问号 ⇒ true；最后一段是两条短选项 ⇒ true；问号出现在中间段落但最后一段是陈述 ⇒ false。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0：同一组夹具下 `readSessionAsk.current` 对长回答为 null、对真提问非 null；并用一个共享表断言 `readSessionAsk` 与 `buildSessionDigest.askingYou` 对同一文本给出相同 `isAsking`。
- [ ] 假形态变红：把 `askEndingAt` 改回对整条 `assistantText` 调 `analyzeAsking` ⇒ 长回答用例红（又变成 asking）；改完即还原。
- [ ] `npm run typecheck`、`npm run lint` 退出 0；若 `session-digest.ts` 越过基线，按 AC-394 RECORDED CHANGE 格式记录。

## DoD

真实数据回放（一次性脚本，不提交）：读取本机 5b984a5f、0a8e120a、843631e5、b96e7efc、c07db8d2 的 transcript，对各自 fleet 卡片的 messageId 跑修正后的 `readSessionAsk`，贴出「修前 full=asking / 修后 current=null」的对照表；再对 a1690759、c0aa3f51、a83c4cd4 的真提问各跑一次，贴出修后仍为 asking。说明本次不改卡片列表（撤回与本地抑制在另一任务），因此 UI DoD 不在本任务内。

## Touches

- tasks/gap-cockpit-ask-detector-last-paragraph.md
- server/modules/observation/session-digest.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/tests/session-digest.test.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/shared/tests/architecture-ratchet.baseline.json