---
id: gap-session-binding-consistency
title: 会话绑定：原子维护线程与 transcript，隔离旧身份回写并恢复受影响会话
status: ready
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

- [x] npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/session-binding-consistency.test.ts 通过。
- [x] 当前绑定对应同一线程；旧 run/host、superseded ID 和异线程路径不能覆盖；事务失败不半更新；watcher 不复活旧分支。
- [x] 合法首次创建、首条编辑、零回合恢复均通过；相关历史缓存不会继续服务旧路径。
- [x] 本会话真实前后读数和历史恢复证据齐全，包含早期排查、两次部署复验和后续讨论；原始文件保留。最终刷新/重启浏览器故事由 AC-447 再验。
- [x] 反向控制恢复旧身份盲写必须红；受影响仓储/provider/writer 单文件回归、typecheck、lint 通过。

## DoD

AC-446 判据和本会话恢复记录齐全。基线实跑 exit 1：Could not find 'server/modules/providers/tests/session-binding-consistency.test.ts'。真实实例的恢复不能仅以临时库测试代替。实际执行恢复前复核，避免覆盖用户新状态。

## 实现

- 仓储层（sessions.db.ts）新增带结果类型的绑定操作：普通运行发现走 confirmRunDiscoveredProviderSession（缺行/已 superseded/stale 拒绝，同 id 确认，NULL 首次登记，零回合且本 run 起步于当前绑定才允许替换）；主动替换走 replaceProviderSessionBinding / detachProviderSessionForEdit，ID、路径、superseded 标记与 watcher 重复行合并在同一事务内，失败整体回滚。
- 新增 session-binding.service.ts 作为应用层绑定入口（工厂 + 注入依赖），chat-run-registry 记下 run 起步时的 bindingAtStart 并只通过该入口写绑定；codex 编辑分叉/首条重开改用显式 replaceBinding / detachForEdit。
- 新增 scripts/repair-session-binding.mjs：仅针对单个会话、先干跑后 --apply、逐项核对故障形态、不修改/截断/删除 transcript、不重启共享服务，第二次运行报 already-consistent。操作说明见 docs/operations/session-binding-recovery.md。
- 历史缓存身份为 (sessionId, transcriptPath, mtime, size)，重绑后天然 miss，无需改动缓存文件。

## 真机恢复记录

修复前（0f0cf753-c01e-4b26-93de-b13f418710f9，2026-10-31 读库）：

- provider_session_id=01a18fa6-3a32-7391-a3df-5b21e0183f03，jsonl_path 指向 11-31-45-01a19003-6b28-7910-9bf2-39ed4276635e（2 行、23510 字节、0 个 task_complete、session_meta.forked_from_id=原线程）。
- superseded_provider_sessions 错误地把原线程 01a18fa6 标为被放弃。
- watcher 已为分叉新建重复行 session_id=01a19003-6b28-7910-9bf2-39ed4276635e。
- 原线程 transcript 501 行、2169544 字节、9 个完成轮次；含早期排查 2026-10-31T01:49:59Z、两次部署复验 03:25:15Z / 03:25:28Z、后续讨论 03:31:45Z / 03:35:08Z / 04:49:36Z / 04:51:29Z / 04:53:50Z / 04:54:32Z。

修复后（按同一会话重读，updated_at=2026-10-31 05:51:22）：

- provider_session_id=01a18fa6-3a32-7391-a3df-5b21e0183f03，jsonl_path 指回 09-49-58-01a18fa6 的原 transcript。
- superseded 表只剩被放弃的分叉 01a19003；重复分叉行数量为 0。
- 两份 transcript 大小未变（2169544 / 23510 字节），未截断、未删除；第二次运行脚本返回 already-consistent。

证据文件（worktree tmp/，gitignored）：session-binding-recovery-0f0cf753-c01e-4b26-93de-b13f418710f9.json 为修复后幂等重读；同前缀 -prerepair-capture.json 为修复前干跑与读库读数重建（apply 轮的默认证据文件曾被随后的幂等重跑覆盖，之后脚本改为每次运行独立文件名；修复后的值另有直接读库复核）。

## 验证

- AC1：npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/session-binding-consistency.test.ts → tests 10 / pass 10 / fail 0。
- 迟到旧 host、已退休 ID、同绑定确认、零回合替换与 stale 拒绝、事务失败回滚（SQLite trigger RAISE(ABORT) 后行与 superseded 标记均回滚）、watcher 不复活旧分支且不重复建行、历史缓存不服务旧路径，均由该文件的行为用例覆盖。
- 反向控制：绕过服务盲写旧身份后 assertBindingIsConsistent 抛 /must not be a retired thread/，证明绿色用例的保证来自守卫而非夹具。
- 回归（bounded runner）：sessions-provider-mapping、sessions.db.integration、codex-message-editing、codex-sessions、chat-run-registry → tests 48 / pass 47 / skipped 1 / fail 0。
- npm run typecheck（root + server + scripts 三份 tsconfig）通过；npm run lint 通过，改动文件单独 oxlint exit 0。

## 暗轴记录

该轴仍暗,理由:本任务以行为测试、单文件回归与真实实例修复验收,无可测的 L_D/L_G 读数

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

## Blocker

**2026-10-31T06:09:53.172Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/database/repositories/sessions.db.ts 1479→1752 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/quay-test-script.test.ts,server/shared/tests/server-import-cycle-budget.test.ts,server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/quay-test-script.test.ts,server/shared/tests/server-import-cycle-budget.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：ef65505e-20c0-4fa6-9a76-bf6a4be82a36
