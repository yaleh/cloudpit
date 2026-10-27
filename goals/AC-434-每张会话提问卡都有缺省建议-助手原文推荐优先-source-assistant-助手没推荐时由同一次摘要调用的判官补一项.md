---
id: AC-434
title: 每张会话提问卡都有缺省建议：助手原文推荐优先（source=assistant），助手没推荐时由同一次摘要调用的判官补一项（source=judge，附理由），不自动执行
status: active
kind: criterion
goal: GOAL-050
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/observation/tests/session-ask-judge-default.test.ts
expect: 以夹具转写与桩掉的 LLM 客户端：助手原文给出推荐的提问，恰好一项 suggested 且
  source=assistant；助手原文没有推荐、但列出了选项或是是/否题的提问，恰好一项 suggested 且
  source=judge，带一句非空理由，判官的选择来自同一次摘要调用（LLM 桩调用次数为 1）；助手原文有推荐时判官不得覆盖它；incomplete 为
  true 时不设 suggested。驾驶舱侧，source=judge 的建议与 assistant
  一样作为卡片的缺省选项显示完整说明并标出来源，确认仍经确认卡，不自动执行。取假形态：判官的建议标成 source=assistant
  即红；助手有推荐时被判官覆盖即红；为判官另发一次 LLM
  调用即红。当前必红：server/modules/observation/tests/session-ask-judge-default.test.ts
  不存在。
origin: 2026-10-28 用户在手机上发现每张卡都停在「Choose an option」，指出偏离原设计。原设计（用户 2026-10-26
  原话）：「开发者最典型的行为应该是点击这个
  suggestion」「行是决策单元：…推荐按钮…」「列表中的信息应当能让我对问题和缺省的建议项/输入建立较完整的理解」「为所有选项提供一个下拉列表」。E1
  报告建议：默认优先助手推荐，判官只在助手没给推荐时补一条 source=judge 的建议，不进入自动档；K3 与 AC-424
  实现时误写为「无推荐不设默认」。
activatedAt: 2026-10-27T22:19:40.275Z
---
