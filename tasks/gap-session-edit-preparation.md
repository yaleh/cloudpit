---
id: gap-session-edit-preparation
title: 编辑重发：封装公共准备流程，修复 Codex resident 回退与旧 host 重建互斥
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
depends_on: []
goal_ac: AC-445
---
## Proposal

用户 2026-10-31 授权 GOAL-052。对照 Claude 后发现 chat.edit-send 将 providerRewindsForEdit 与 resident 关闭互斥：Claude resident 已关闭并通过 resumeSessionAt 恢复，Codex resident 却只 fork、旧 host 保持原线程。另查到 session-host manager 吞掉 driver.closeHost 异常，await 不能证明成功关闭。

<!-- dedup-ref --> 2026-10-31 检查已完成 gap-resident-edit-send-truncates-in-place（Claude resident）、gap-codex-resident-normalize-app-server-frames（事件转换）以及 codex-message-editing.test.ts（provider 分叉）。这些不覆盖 Codex resident 的组合编排/明确关闭结果；本 task 补独立行为，后续绑定 task 负责身份一致性，不重复实现。

## Plan

1. 新建小型 React-free 编辑准备服务，工厂和注入接缝，网关仅验证传输与调用。生命周期是否 resident 与 provider 如何恢复独立组合。
2. 在请求获准后广播 history_truncated；resident 先关闭旧 host 并等待可检查结果；再执行 provider 回退准备；最后使用最新绑定运行。未获准不得关闭、fork 或改变绑定。
3. 采用明确准备结果表示 resume-at-anchor（含 null 首条语义）和 binding-replaced，不靠可选方法推断完整编排。扩展既有 capability，不增加 provider id 分支；Claude 分支裁剪与 Codex fork 算法继续各自拥有。
4. 为编辑调用暴露严格关闭结果，普通 best-effort 清理维持现有策略。关闭/回退/启动失败不继续旧上下文，统一错误与终态。
5. 明确对 Task 2 的接口契约与顺序，避免在网关再实现 DB 绑定规则。

## AC

- [ ] npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-edit-preparation.test.ts 通过；包含 Claude/Codex × resident/per-run、中间与首条、host 已消失、准入拒绝及失败矩阵。
- [ ] 对有活 host 的 resident，关闭完成先于 provider 准备和新运行；关停拒绝不得继续；普通发送不触发关闭。
- [ ] Claude resume/resumeSessionAt 和首条从空上下文启动正确，Codex 不携带无效 Claude 参数；应用会话 ID 和 lifecycle 保持。
- [ ] 反向控制：恢复 if/else 互斥或吞关闭失败，新增行为断言必红。
- [ ] 运行受影响既有单文件测试、typecheck、lint 和适当 build，记录结果。

## DoD

AC-445 通过，完成记录含操作顺序与失败读数，接口消费者更新齐全。基线实跑 exit 1：Could not find 'server/modules/websocket/tests/chat-edit-preparation.test.ts'。完成不代替 AC-446/447。

## Touches

- server/modules/websocket/services/chat-websocket.service.ts
- server/modules/websocket/services/chat-edit-preparation.service.ts
- server/modules/websocket/tests/chat-edit-preparation.test.ts
- server/modules/websocket/tests/chat-edit-send.test.ts
- server/modules/providers/services/sessions.service.ts
- server/modules/providers/index.ts
- server/modules/providers/list/claude/claude-sessions.provider.ts
- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/session-hosts/session-host-manager.service.ts
- server/modules/session-hosts/tests/*
- server/modules/session-hosts/index.ts
- server/shared/types.ts
- server/shared/interfaces.ts
- server/shared/index.ts
- tasks/gap-session-edit-preparation.md

## 约束

遵守 AGENTS.md 与 backend-module-standards；触及 src/ 时同时遵守 frontend-module-standards。服务约 260 行按关注点拆分、工厂与依赖注入；跨模块只走 barrel；不新增 provider 名字判断，不扩大到通用工作流框架。会话内单文件或有界 runner，不跑全套 fan-out；全套由 quay fan-in 承担。不得用替身、skip、仅静态代码匹配冒充真实行为验收。
