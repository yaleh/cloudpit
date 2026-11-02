---
id: AC-461
title: Codex 模型条目挂 codexProviderId：未声明继承全局、未知/已删 provider 可读拒绝
status: active
kind: criterion
goal: GOAL-055
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-provider-model-binding.test.ts
expect: ProviderModelConfig 可声明 codexProviderId；未声明编译为继承 Codex 全局（现行为）；声明的
  provider 不存在/已删时 create/update 返回可读 409/404（含 provider id），不落库；目录合并后自定义模型行显示
  model · provider。
origin: 人 yale 2026-11-02 裁定 Q1：provider 注册表为项目级一等配置，模型条目只引用 providerId；扩既有
  model-config-write-path.test.ts。
activatedAt: 2026-11-02T09:55:49.901Z
statusLog:
  - at: 2026-11-02T09:55:49.901Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-02T09:55:49.901Z
---
