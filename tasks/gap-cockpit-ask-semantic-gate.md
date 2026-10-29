---
id: gap-cockpit-ask-semantic-gate
title: 提问判定改为机械预筛 + T1 摘要语义判定：不再用首/中/尾位置；62d959c0 的中段决策要被识别，5b/fea61b 类长报告不产生假卡
status: todo
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

来源：用户实测指出，`gap-cockpit-ask-detector-last-paragraph`（已 done，commit `4eae3dbaf`）的「只看最后一段」启发式同样不成立。案例 session `62d959c0-5487-4649-a5f2-ab38462c438b` / message `3818a9e5-1fb5-4c9f-9d99-eb8b7ee0647a`：一条三段式审查报告，真正的待决点在**中段**「值得优先讨论的下一步 1/2/3」，最后一段是附注「本轮没有运行测试…以上是只读审查」。用户在 16:11 回复「先拆 observation producer 的 ask ledger 和恢复/sweep…创建任务。」——这是真提问。按最后一段判定会把它判成 NOT asking，从而**静默漏掉真问题**；按全文编号列表判定又会把 5b/fea61be5 那类长报告判成提问，产生假卡。位置启发式（首/中/尾）都不可靠。

结论：「有没有在问、问什么」是语义判断，不是位置判断。方案：
- **机械预筛**（只产生候选，不判定）：对整条 assistant 消息做宽匹配——问号、`要不要`、`是否`、`请选择`、`请确认`、`值得优先`、`下一步`、`建议`、连续短编号行等。62d 的中段有「是否/值得优先/1/2/3」，会进入候选；5b 的长报告也会进入候选（由下一步判断）。
- **T1 摘要语义判定**：`createSessionAskDecisionDigest` 吃全文 + 上下文，输出一个显式 `isAsking`（或等价 decision）以及真正的 `ask`/`situation`/`options`。62d 应抽出中段那个决策问题；5b 应返回 `isAsking=false`。提示词明确要求「不是提问就 isAsking=false，且不要编造选项」。
- 生产者只在摘要判为 asking 时写 `session.asking` 并写 observation object；判为 false 则不产事件/对象（若已有临时事件则撤回）。摘要不可用或未启用时，文档化的回退是「预筛通过即视为候选」，并显示 contentUnavailable；后续摘要判 false 时走 retraction。宁可短暂可见，也不能静默漏掉真问题。
- 摘要的 `ask` 是卡片显示的真正问句；`questionText` 继续是全文（用户 2026-10-29 的全文去重规则），不要把位置截取的片段冒充问句。与 quay-fleet 的 `fleet-cockpit-ask-fallback-fulltext` 互补。

<!-- dedup-ref -->
`gap-cockpit-ask-detector-last-paragraph` 是全消息编号列表误判的历史修复；本任务取代它的位置启发式，不改它的其它成果。`gap-cockpit-ask-retraction-and-ledger-backfill` 已 parked（needs-human），恢复后应改为依赖本任务的语义判定，而不是最后一段。

## AC

- [ ] 新增 `server/modules/observation/tests/session-ask-semantic-gate.test.ts` 退出 0：62d 风格夹具（决策在中段、末段是附注）⇒ 预筛通过、摘要桩 `isAsking=true`、抽出的 `ask` 含中段决策；5b/fea61be5 风格长报告（中段编号列表、末段陈述）⇒ 预筛通过、摘要桩 `isAsking=false`；末尾问号夹具 ⇒ true；无任何标记的纯陈述 ⇒ 预筛不通过。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/observation/tests/session-digest.test.ts server/modules/observation/tests/session-ask-decision-digest.test.ts` 退出 0：生产者/投递路径只在摘要 `isAsking=true` 时写 `session.asking` 与 object；false 时不写事件/对象；摘要未启用/失败时的回退与可见原因有断言。
- [ ] 既有最后一段测试更新：把「中段问句 = not asking」的断言改为 asking（62d 回归）；5b 长报告仍为 not asking；全消息编号列表仍为 not asking。既有用例不弱化。
- [ ] 假形态变红：把判定改回只看最后一段 ⇒ 62d 用例红；改回全文 `analyzeAsking` ⇒ 5b 用例红；改完即还原。
- [ ] `npm run typecheck`、`npm run lint` 退出 0；若 `session-digest.producer.ts` 或 types 越过基线，按 AC-394 RECORDED CHANGE 格式记录。

## DoD

真实数据（一次性回放脚本 + 真实页面；不点确认）：

1. 对 62d959c0 / 3818a9e5 跑语义判定：事件流出现 `session.asking`，摘要的 `ask` 指向中段那个决策；对 5b984a5f 的 a68ae9b0/b8494a51、fea61be5 的 7aed/973a/5e25/33ba 跑同一路径：不产 asking（若之前有事件则由 retraction 任务撤）。贴出每条消息的预筛/摘要判定与 ask 文本。
2. 真实页面 390/1440：62d 的卡显示中段问题与选项（可确认），5b/fea 的假卡不出现；截图存 `tmp/`。
3. 场景运行器可用时跑 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` 并贴 JSON；实例用毕停掉。

## Touches

- tasks/gap-cockpit-ask-semantic-gate.md
- server/modules/observation/session-digest.ts
- server/modules/observation/session-ask-decision-digest.ts
- server/modules/observation/session-ask-decision-answer.ts
- server/modules/observation/session-ask-decision-reader.ts
- server/modules/observation/session-digest.producer.ts
- server/shared/types.ts
- server/modules/observation/tests/session-digest.test.ts
- server/modules/observation/tests/session-ask-decision-digest.test.ts
- server/modules/observation/tests/session-ask-semantic-gate.test.ts (new)
- server/shared/tests/architecture-ratchet.baseline.json