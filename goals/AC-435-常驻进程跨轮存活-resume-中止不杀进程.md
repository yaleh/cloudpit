---
id: AC-435
title: 常驻进程跨轮存活、resume、中止不杀进程
status: draft
kind: criterion
goal: GOAL-051
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-host-driver-persistent.test.ts
expect: 假 app-server transport（不真起 codex）：同一 resident 会话连续 3 轮 threadId 与宿主 pid
  不变；首轮后 thread/resume 同 id；零轮次 thread/resume 报 no rollout found 时驱动走
  thread/start；turn/interrupt 后 turn status=interrupted、pid 不变、下一轮同 pid
  继续。假形态：每轮换新 thread 必须红；interrupt 杀进程必须红。
origin: GOAL-051 的 Codex 常驻方案（人 yale 2026-10-29 五条裁定）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4 实测）
phase: pre-merge
---
