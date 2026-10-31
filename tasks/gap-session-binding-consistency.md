---
id: gap-session-binding-consistency
title: 会话绑定：原子维护线程与 transcript，隔离旧身份回写并恢复受影响会话
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-session-edit-preparation
goal_ac: AC-446
---
## Proposal

接续 AC-445 的编辑服务契约。实测本会话 0f0cf753-c01e-4b26-93de-b13f418710f9：provider_session_id=01a18fa6-3a32-7391-a3df-5b21e0183f03，但 jsonl_path 指向 01a19003-6b28-7910-9bf2-39ed4276635e 分叉文件（仅元数据）。原线程仍有最初排查、两次部署复验和后续讨论；superseded 表又将原线程标为被放弃。

<!-- dedup-ref --> 已有 repointSessionToProviderSession 原子更新 ID/路径和 superseded 标记，但 assignProviderSessionId 可单改 ID，旧 host 的 session_created 能覆盖分叉后的身份。现有 codex-message-editing.test.ts 验证分叉/索引，未覆盖旧 run/host 迟到回写与历史缓存。本 task 独立覆盖绑定一致性，编排由前置任务负责。

## Plan

1. 区分普通运行发现身份（首次登记/确认）与主动绑定替换（编辑分叉/重新开始/明确恢复），复用仓储并收口应用层绑定入口。provider 验证协议/文件身份，数据库负责事务。
2. 替换绑定原子维护 provider ID、路径、superseded 关系，协调重复索引记录和缓存失效；提交失败不留下半套状态。
3. 用 run/host 归属、当前绑定和 superseded 事实拦截迟到覆盖；必要时再引入绑定版本，不预设新 schema。覆盖 watcher 与捕获回写竞争；禁止将合法首次创建、首条编辑、零回合恢复一概拒绝。
4. 修复前重新读本会话最新 DB、活动 host、原/分叉元数据与历史，保留备份/修复前证据；仅在仍吻合上述故障时恢复原线程路径并撤销错误 superseded 标记。若用户后续已合法编辑，依据最新状态修复而非硬写旧值。保留原文件，不截断、不覆盖内容，不重启共享服务。
5. 记录本会话修复前后 ID/路径/标记和可读轮次；将维修核对/幂等规则形成可复用、限定目标的操作方式，不做全库猜测修复。

## AC

- [ ] npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/session-binding-consistency.test.ts 通过。
- [ ] 当前绑定对应同一线程；旧 run/host、superseded ID 和异线程路径不能覆盖；事务失败不半更新；watcher 不复活旧分支。
- [ ] 合法首次创建、首条编辑、零回合恢复均通过；相关历史缓存不会继续服务旧路径。
- [ ] 本会话真实前后读数和历史恢复证据齐全，包含早期排查、两次部署复验和后续讨论；原始文件保留。最终刷新/重启浏览器故事由 AC-447 再验。
- [ ] 反向控制恢复旧身份盲写必须红；受影响仓储/provider/writer 单文件回归、typecheck、lint 通过。

## DoD

AC-446 判据和本会话恢复记录齐全。基线实跑 exit 1：Could not find 'server/modules/providers/tests/session-binding-consistency.test.ts'。真实实例的恢复不能仅以临时库测试代替。实际执行恢复前复核，避免覆盖用户新状态。

## Touches

- server/modules/database/repositories/sessions.db.ts
- server/modules/database/tests/*
- server/modules/database/index.ts
- server/modules/providers/services/session-binding.service.ts
- server/modules/providers/services/sessions.service.ts
- server/modules/providers/services/provider-runtime.service.ts
- server/modules/providers/index.ts
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/providers/list/codex/codex-session-synchronizer.provider.ts
- server/modules/providers/tests/session-binding-consistency.test.ts
- server/modules/providers/tests/codex-message-editing.test.ts
- server/modules/websocket/services/chat-run-registry.service.ts
- server/modules/websocket/services/chat-session-writer.service.ts
- server/modules/websocket/tests/*
- server/shared/types.ts
- server/shared/interfaces.ts
- server/shared/index.ts
- scripts/repair-session-binding.mjs
- docs/operations/session-binding-recovery.md
- tasks/gap-session-binding-consistency.md

## 约束

遵守 AGENTS.md 与 backend-module-standards；触及 src/ 时同时遵守 frontend-module-standards。服务约 260 行按关注点拆分、工厂与依赖注入；跨模块只走 barrel；不新增 provider 名字判断，不扩大到通用工作流框架。会话内单文件或有界 runner，不跑全套 fan-out；全套由 quay fan-in 承担。不得用替身、skip、仅静态代码匹配冒充真实行为验收。
