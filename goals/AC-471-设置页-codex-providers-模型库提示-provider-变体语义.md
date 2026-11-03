---
id: AC-471
title: 设置页 Codex providers/模型库提示 provider 变体语义
status: achieved
kind: criterion
goal: GOAL-056
criterion: npx vitest run src/modules/settings/tests/codexModelProviderHint.test.tsx
expect: 设置页 Codex providers 卡片说明每个 provider 以 (provider) 变体出现在
  composer/新建会话选择器；模型库内置模型行显示 built-in · N provider variants（N=注册 provider 数）。
origin: 人 yale 2026-11-03 裁定：单选择项 = model + provider id 组合，后缀用 provider
  id，内置模型展开、自定义模型不展开。
activatedAt: 2026-11-03T13:07:14.940Z
statusLog:
  - at: 2026-11-03T13:07:14.940Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-11-03T13:15:48.992Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-11-03T13:07:14.940Z
---
