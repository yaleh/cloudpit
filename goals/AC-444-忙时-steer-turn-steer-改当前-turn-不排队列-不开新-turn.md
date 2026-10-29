---
id: AC-444
title: 忙时 steer：turn/steer 改当前 turn、不排队列、不开新 turn
status: draft
kind: criterion
goal: GOAL-051
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-host-driver-steer.test.ts
expect: 假 app-server transport（不真起 codex）：同一 resident 会话 active turn 中
  turn/steer {threadId, expectedTurnId, input} 返回的 turnId 等于当前 turn id（不开新
  turn），该 turn 终态 completed，且最终产物体现 steer 输入（REPORT E8 实测最终 assistant 文本被改写为
  STEERED）；steer 期间与之后宿主 pid、threadId 不变；thread/queue/list 深度不增（steer 改当前
  turn，queue 排后续 turn）；steer 完成后下一轮同 pid 继续。假 transport 对 turn/steer 回 JSON-RPC
  错误（模拟 expectedTurnId 与当前 turn 不符）时，驱动把错误显式传回调用方并 fail-closed：不吞掉、不回落成
  thread/queue/add、也不 turn/start 开新 turn。假形态：把 steer 落到
  thread/queue/add（queue/list 深度 +1）必须红；用 turn/start 开新 turn（返回 turnId 不等于当前
  turn id）必须红；stale expectedTurnId 被接受（错误未传回）必须红。
origin: GOAL-051 范围第 3 条 turn/steer 无 AC 覆盖（充分性 insufficient）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md E8 实测（返回 turnId、最终文本 STEERED、turn
  completed）
phase: pre-merge
---
