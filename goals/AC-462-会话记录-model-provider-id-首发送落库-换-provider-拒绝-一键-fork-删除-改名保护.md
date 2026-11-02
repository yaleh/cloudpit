---
id: AC-462
title: 会话记录 model_provider_id：首发送落库、换 provider 拒绝 + 一键 fork、删除/改名保护
status: achieved
kind: criterion
goal: GOAL-055
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-session-provider-binding.test.ts
expect: sessions 新列 model_provider_id：首发送落库所选模型的 provider id；resolveSessionModel
  带出；换不同 provider id 被拒并给 fork/新会话动作（可读）；删除/改名被引用 provider
  被保护（拒绝或显式标记），不静默把会话改回默认模型。
origin: 人 yale 2026-11-02 裁定 Q3：换 provider 拒绝 + 一键 fork；Codex resume 语义要求同
  provider id 配置仍在。2026-11-03 修正：原判据 provider-models.service.test.ts 是既有绿文件（0 命中
  model_provider_id）造成假绿，重指到新判据 codex-session-provider-binding.test.ts，expect
  逐字不变。
activatedAt: 2026-11-02T09:28:55.940Z
statusLog:
  - at: 2026-11-02T09:28:55.940Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-11-02T09:30:09.621Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
  - at: 2026-11-02T17:09:10.871Z
    from: achieved
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-11-02T22:56:57.856Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-11-02T17:09:10.871Z
---
