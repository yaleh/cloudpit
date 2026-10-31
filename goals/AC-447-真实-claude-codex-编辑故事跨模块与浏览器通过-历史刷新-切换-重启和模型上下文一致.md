---
id: AC-447
title: 真实 Claude/Codex 编辑故事跨模块与浏览器通过，历史刷新、切换、重启和模型上下文一致
status: active
kind: criterion
goal: GOAL-052
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/websocket/tests/session-edit-continuity.test.ts
expect: 新增有界验收入口，执行跨模块 session-edit-continuity.test.ts
  与浏览器回归并检查报告，不用仅静态字符串/文件存在判绿。覆盖 Claude/Codex ×
  per-run/resident，多轮→编辑中间/首条→续聊→刷新→切换→隔离实例重启；原保留历史完整，被替换分支不复活，无重复。当前 resident
  生成的真实 Codex transcript 以实际 CLI 分叉/恢复证明保留前缀与模型上下文；MCP 浏览器实际操作截图存
  tmp/；存在可用场景同时提交 ui-scenario JSON 和检查点截图。真实证据缺失不能以替身或 skip 宣称达成。
origin: 人 yale 2026-10-31 本会话授权：对照 Claude Code 的编辑回退、resident 重建与身份回写，修复 Codex
  历史消失；采纳一个 goal、三个顺序依赖 task 的方案并要求创建和激活。实测应用会话
  0f0cf753-c01e-4b26-93de-b13f418710f9 的
  provider_session_id=01a18fa6-3a32-7391-a3df-5b21e0183f03，但 jsonl_path 指向分叉
  01a19003-6b28-7910-9bf2-39ed4276635e；原始对话仍在原文件。
activatedAt: 2026-10-31T04:57:34.742Z
statusLog:
  - at: 2026-10-31T04:57:34.742Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-31T04:57:34.742Z
---
