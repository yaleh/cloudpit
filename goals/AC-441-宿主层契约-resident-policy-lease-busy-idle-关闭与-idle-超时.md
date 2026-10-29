---
id: AC-441
title: 宿主层契约：resident-policy lease、busy/idle、关闭与 idle 超时
status: achieved
kind: criterion
goal: GOAL-051
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts
expect: resident host 打开时持 resident-policy lease；turn 期间 busy、结束回
  idle；closeHost/unbind 原因正确；idle 超时关闭；restart restore 走 startResidentSession。
origin: GOAL-051 的 Codex 常驻方案（人 yale 2026-10-29 五条裁定）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4 实测）
activatedAt: 2026-10-29T09:29:49.972Z
statusLog:
  - at: 2026-10-29T09:29:49.972Z
    from: draft
    to: active
    actor: human:yale
    reason: 人 yale 指令：激活 GOAL-051 的 AC，红先行
  - at: 2026-10-29T14:04:54.729Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-29T09:29:49.972Z
phase: pre-merge
---
