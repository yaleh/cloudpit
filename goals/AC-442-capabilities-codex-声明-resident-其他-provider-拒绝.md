---
id: AC-442
title: capabilities：codex 声明 resident，其他 provider 拒绝
status: active
kind: criterion
goal: GOAL-051
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-resident-capabilities.test.ts
expect: codex lifecycleModes 含 resident，residentFeatures
  按实测值（interruptKeepsProcess=true 等）；codex 之外的 provider 写 resident
  被拒（LIFECYCLE_MODE_NOT_SUPPORTED）。假形态：matrix 声称未实测能力必须红。
origin: GOAL-051 的 Codex 常驻方案（人 yale 2026-10-29 五条裁定）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4 实测）
activatedAt: 2026-10-29T09:30:47.999Z
statusLog:
  - at: 2026-10-29T09:30:47.999Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-29T09:30:47.999Z
phase: pre-merge
---
