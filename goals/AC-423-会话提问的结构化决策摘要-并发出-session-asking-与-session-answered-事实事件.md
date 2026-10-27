---
id: AC-423
title: 会话提问的结构化决策摘要，并发出 session.asking 与 session.answered 事实事件
status: active
kind: criterion
goal: GOAL-050
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/observation/tests/session-ask-decision-digest.test.ts
expect: 以夹具转写与桩掉的 LLM
  客户端：一个以提问结束的会话产出结构化决策摘要，含问题重述、情境、选项列表（每项含做什么与后果标签）、助手自己的推荐（仅当原文给出时）与
  incomplete 标记；助手原文没有推荐时任何选项都不标 suggested；问题所依赖的内容不在送入的近几轮里时 incomplete 为 true
  且没有 suggested。以注入的事件写入器验证：识别到提问时恰好发出一条 session.asking（带会话 id
  与提问修订号），同一会话随后出现用户发言时恰好发出一条
  session.answered。取假形态：把助手原话末句原样当问题重述、或在助手没有推荐时补一个推荐即红。当前必红：server/modules/observation/tests/session-ask-decision-digest.test.ts
  不存在。
origin: 本会话 2026-10-26 实测：观察层会话摘要 conclusion 只是上一条消息的逐字摘录（tier
  deterministic），多数会话没有情境，列表无法支持判断；用户确定事实与内容由 CloudCLI 提供、语义由 quay-fleet 提供。
activatedAt: 2026-10-27T02:50:54.126Z
statusLog:
  - at: 2026-10-27T02:50:54.126Z
    from: draft
    to: active
    actor: claude-session-摄像头与阻塞项驾驶舱
    reason: 用户 2026-10-27 批准激活 GOAL-050（调整正文后）
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-27T02:50:54.126Z
---
