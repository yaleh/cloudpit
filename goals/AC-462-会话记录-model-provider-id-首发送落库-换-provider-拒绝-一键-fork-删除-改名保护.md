---
id: AC-462
title: 会话记录 model_provider_id：首发送落库、换 provider 拒绝 + 一键 fork、删除/改名保护
status: draft
kind: criterion
goal: GOAL-055
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/provider-models.service.test.ts
expect: sessions 新列 model_provider_id：首发送落库所选模型的 provider id；resolveSessionModel
  带出；换不同 provider id 被拒并给 fork/新会话动作（可读）；删除/改名被引用 provider
  被保护（拒绝或显式标记），不静默把会话改回默认模型。
origin: 人 yale 2026-11-02 裁定 Q3：换 provider 拒绝 + 一键 fork；Codex resume 语义要求同
  provider id 配置仍在。扩既有 provider-models.service.test.ts。
---
