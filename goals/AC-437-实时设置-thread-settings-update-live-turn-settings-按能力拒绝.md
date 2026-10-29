---
id: AC-437
title: 实时设置（thread/settings/update live，turn/settings 按能力拒绝）
status: achieved
kind: criterion
goal: GOAL-051
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-host-driver-settings.test.ts
expect: thread/settings/update 在 idle 与 active 都更新
  model/effort/approvalPolicy/sandboxPolicy 并收到 thread/settings/updated，pid
  不变；turn/settings/update 因 step_model_switching 未启用被拒（能力探测 fail-closed）。假形态：宣称
  turn/settings 已 live 必须红。
origin: GOAL-051 的 Codex 常驻方案（人 yale 2026-10-29 五条裁定）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4 实测）
activatedAt: 2026-10-29T09:25:58.686Z
statusLog:
  - at: 2026-10-29T09:25:58.686Z
    from: draft
    to: active
    actor: human:yale
    reason: 人 yale 指令：激活 GOAL-051 的 AC，红先行
  - at: 2026-10-29T13:46:58.494Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-29T09:25:58.686Z
phase: pre-merge
---
