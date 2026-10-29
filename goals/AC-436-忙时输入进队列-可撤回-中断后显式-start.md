---
id: AC-436
title: 忙时输入进队列、可撤回、中断后显式 start
status: achieved
kind: criterion
goal: GOAL-051
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-host-driver-queue.test.ts
expect: thread active 时 chat.send 不返回 RUN_IN_PROGRESS 而是
  thread/queue/add；queue/list 是深度真值；queue/delete 撤回；正常 turn/completed
  后自动排水；turn/interrupt 后队列保留但不自动排水，驱动显式 thread/queue/start。假形态：active
  时拒绝输入（RUN_IN_PROGRESS）必须红；中断后假设自动排水必须红。
origin: GOAL-051 的 Codex 常驻方案（人 yale 2026-10-29 五条裁定）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4 实测）
activatedAt: 2026-10-29T09:24:39.594Z
statusLog:
  - at: 2026-10-29T09:24:39.594Z
    from: draft
    to: active
    actor: human:yale
    reason: 人 yale 指令：激活 GOAL-051 的 AC，红先行
  - at: 2026-10-29T16:30:56.448Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-29T09:24:39.594Z
phase: pre-merge
---
