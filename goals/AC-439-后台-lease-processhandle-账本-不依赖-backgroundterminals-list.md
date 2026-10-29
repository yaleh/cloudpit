---
id: AC-439
title: 后台 lease：processHandle 账本，不依赖 backgroundTerminals/list
status: active
kind: criterion
goal: GOAL-051
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-resident-background-leases.test.ts
expect: process/spawn 到 process/exited 驱动按 processHandle 维护/释放 background-task
  lease；不把 thread/backgroundTerminals/list 当 client 进程账本（实测它不含 client 进程）。假形态：把
  backgroundTerminals/list 当账本必须红。
origin: GOAL-051 的 Codex 常驻方案（人 yale 2026-10-29 五条裁定）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4 实测）
activatedAt: 2026-10-29T09:29:06.490Z
statusLog:
  - at: 2026-10-29T09:29:06.490Z
    from: draft
    to: active
    actor: goal-driver
    reason: "triage: activate"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-29T09:29:06.490Z
phase: pre-merge
---
