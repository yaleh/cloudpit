---
id: AC-468
title: Codex 模型目录 model×provider 选项 + 会话模型写路径接受显式 provider id
status: active
kind: criterion
goal: GOAL-056
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-model-provider-option.test.ts
expect: getProviderModels('codex') 对每个内置模型展开裸名（modelProviderId 缺省=继承默认）+ 每个注册
  provider 的变体（modelProviderId=provider id），自定义模型单条且带
  codexProviderId；setSessionModel 接受显式 modelProviderId（内置模型路由到非默认 provider）并落库
  model_provider_id；换 provider 仍拒绝（SESSION_PROVIDER_MISMATCH）、未知 provider
  拒绝（SESSION_PROVIDER_UNKNOWN）。
origin: 人 yale 2026-11-03 裁定：单选择项 = model + provider id 组合，后缀用 provider
  id，内置模型展开、自定义模型不展开。
activatedAt: 2026-11-03T13:02:29.319Z
statusLog:
  - at: 2026-11-03T13:02:29.319Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-03T13:02:29.319Z
---
