---
id: AC-446
title: 线程绑定替换保持 ID、历史路径与 superseded 一致，旧运行不能回写覆盖并恢复受影响会话
status: active
kind: criterion
goal: GOAL-052
criterion: npx tsx --tsconfig server/tsconfig.json --test
  server/modules/providers/tests/session-binding-consistency.test.ts
expect: 区分首次登记/确认与主动绑定替换，后者原子维护 provider ID、路径、superseded 并失效相关缓存。旧
  run/host、superseded 身份和异线程路径不能覆盖新绑定；覆盖合法首次创建、编辑首条、零回合恢复、watcher 竞争与迟到事件。本会话
  0f0cf753-c01e-4b26-93de-b13f418710f9
  修复前后真实读数可核对；保留早期排查、两次部署复验及讨论，刷新重启后仍可读；不改写原文件，不覆盖修复前新发生的合法绑定变更。
origin: 人 yale 2026-10-31 本会话授权：对照 Claude Code 的编辑回退、resident 重建与身份回写，修复 Codex
  历史消失；采纳一个 goal、三个顺序依赖 task 的方案并要求创建和激活。实测应用会话
  0f0cf753-c01e-4b26-93de-b13f418710f9 的
  provider_session_id=01a18fa6-3a32-7391-a3df-5b21e0183f03，但 jsonl_path 指向分叉
  01a19003-6b28-7910-9bf2-39ed4276635e；原始对话仍在原文件。
activatedAt: 2026-10-31T04:57:19.853Z
statusLog:
  - at: 2026-10-31T04:57:19.853Z
    from: draft
    to: active
    actor: goal-cli
    reason: ""
fidelity:
  verdict: not-evaluated
  reason: no judge configured
  at: 2026-10-31T04:57:19.853Z
---
