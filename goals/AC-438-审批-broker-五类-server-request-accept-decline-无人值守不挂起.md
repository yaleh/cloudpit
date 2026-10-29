---
id: AC-438
title: 审批 broker：五类 server request、accept/decline、无人值守不挂起
status: draft
kind: criterion
goal: GOAL-051
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/codex-resident-approvals.test.ts
expect: 五类 server
  request（commandExecution/fileChange/permissions/elicitation/toolUserInput）都能产生
  permission_request 帧、accept/decline 路由、waitingOnApproval 状态、无人值守
  decline/cancel 不挂起。假形态：无人值守静默不响应必须红。
origin: GOAL-051 的 Codex 常驻方案（人 yale 2026-10-29 五条裁定）+
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4 实测）
phase: pre-merge
---
