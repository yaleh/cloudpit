---
id: AC-445
title: 编辑重发公共编排独立组合 provider 回退与 resident 关闭，失败不继续旧上下文
status: achieved
kind: criterion
goal: GOAL-052
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/websocket/tests/chat-edit-preparation.test.ts
expect: Claude/Codex × per-run/resident 均覆盖中间和首条编辑。仅获执行资格后变更；resident 旧 host
  完成关闭后才 provider
  准备并运行。明确区分恢复锚点与替换绑定；关闭失败、回退失败、启动失败不追加到旧上下文且统一结算，拒绝编辑零副作用；Claude 既有
  resumeSessionAt/分支裁剪不回归。反向控制恢复互斥分支或吞关闭失败必须红。
origin: 人 yale 2026-10-31 本会话授权：对照 Claude Code 的编辑回退、resident 重建与身份回写，修复 Codex
  历史消失；采纳一个 goal、三个顺序依赖 task 的方案并要求创建和激活。实测应用会话
  0f0cf753-c01e-4b26-93de-b13f418710f9 的
  provider_session_id=01a18fa6-3a32-7391-a3df-5b21e0183f03，但 jsonl_path 指向分叉
  01a19003-6b28-7910-9bf2-39ed4276635e；原始对话仍在原文件。
activatedAt: 2026-10-31T04:57:18.720Z
statusLog:
  - at: 2026-10-31T04:57:18.720Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
  - at: 2026-10-31T05:46:03.013Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-31T04:57:18.720Z
---
