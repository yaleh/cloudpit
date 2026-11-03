---
id: AC-469
title: composer 模型菜单渲染 model×provider 单选择项并发送 model + provider id
status: achieved
kind: criterion
goal: GOAL-056
criterion: npx vitest run src/modules/chat/tests/composerModelProviderOption.test.tsx
expect: composer 模型菜单按 model 分组渲染内置模型（裸名 + 每个 (provider) 变体）与自定义模型（单条）；选中变体时
  selectProviderModel 携带 model + modelProviderId（裸名不带）；收起态按钮显示合成标签 gpt-5.6-terra
  (fjdac)。
origin: 人 yale 2026-11-03 裁定：单选择项 = model + provider id 组合，后缀用 provider
  id，内置模型展开、自定义模型不展开。
activatedAt: 2026-11-03T13:14:12.016Z
statusLog:
  - at: 2026-11-03T13:14:12.016Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-11-03T13:55:03.068Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-03T13:14:12.015Z
---
