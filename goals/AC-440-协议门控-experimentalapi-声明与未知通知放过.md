---
id: AC-440
title: 协议门控：experimentalApi 声明与未知通知放过
status: achieved
kind: criterion
goal: GOAL-051
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-app-server-protocol.test.ts
expect: initialize 声明 capabilities.experimentalApi=true；缺失时 thread/queue/add
  被拒且驱动 fail-closed；未知 notification 放过不中断读取循环。
origin: GOAL-051 的 Codex 常驻方案（人 yale 2026-10-29 五条裁定）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4 实测）
activatedAt: 2026-10-29T09:29:01.426Z
statusLog:
  - at: 2026-10-29T09:29:01.426Z
    from: draft
    to: active
    actor: human:yale
    reason: 人 yale 指令：激活 GOAL-051 的 AC，红先行
  - at: 2026-10-29T12:12:08.922Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: faithful
  reason: "fidelity judge: faithful"
  at: 2026-10-29T09:29:01.426Z
phase: pre-merge
---
