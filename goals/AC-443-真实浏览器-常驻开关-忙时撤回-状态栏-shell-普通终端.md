---
id: AC-443
title: 真实浏览器：常驻开关、忙时撤回、状态栏、Shell 普通终端
status: achieved
kind: criterion
goal: GOAL-051
criterion: npx playwright test e2e/codex-resident-ui.spec.ts
expect: 真实浏览器里 Codex 会话可开启常驻、忙时输入进队列可撤回、状态栏显示常驻、Shell 标签是普通终端不 resume。
origin: GOAL-051 的 Codex 常驻方案（人 yale 2026-10-29 五条裁定）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4 实测）
activatedAt: 2026-10-29T09:32:22.510Z
statusLog:
  - at: 2026-10-29T09:32:22.510Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
  - at: 2026-10-29T23:18:02.224Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-29T09:32:22.510Z
phase: post-merge
---
