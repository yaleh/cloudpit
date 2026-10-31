---
id: gap-session-edit-preparation
title: 编辑重发：封装公共准备流程，修复 Codex resident 回退与旧 host 重建互斥
status: done
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

- [x] npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-edit-preparation.test.ts 通过；包含 Claude/Codex × resident/per-run、中间与首条、host 已消失、准入拒绝及失败矩阵。
- [x] 对有活 host 的 resident，关闭完成先于 provider 准备和新运行；关停拒绝不得继续；普通发送不触发关闭。
- [x] Claude resume/resumeSessionAt 和首条从空上下文启动正确，Codex 不携带无效 Claude 参数；应用会话 ID 和 lifecycle 保持。
- [x] 反向控制：恢复 if/else 互斥或吞关闭失败，新增行为断言必红。
- [x] 运行受影响既有单文件测试、typecheck、lint 和适当 build，记录结果。

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
- scripts/suite-duration-baseline.tsv
- server/shared/tests/quay-test-script.test.ts
- tasks/gap-session-edit-preparation.md

## 约束

遵守 AGENTS.md 与 backend-module-standards；触及 src/ 时同时遵守 frontend-module-standards。服务约 260 行按关注点拆分、工厂与依赖注入；跨模块只走 barrel；不新增 provider 名字判断，不扩大到通用工作流框架。会话内单文件或有界 runner，不跑全套 fan-out；全套由 quay fan-in 承担。不得用替身、skip、仅静态代码匹配冒充真实行为验收。

## 完成记录

操作顺序（`chat-edit-preparation.service.ts` 的 `apply`；仅在 `dispatchRun` 准入后的 `beforeRun` 内执行）：
1. 广播 `history_truncated`，先于任何可能很慢的关闭/回退。
2. resident 会话：`closeHostForEditAndWait` 严格关闭旧 host，等待 driver 自己的关闭结果；host 已消失返回 `{found:false}` 并继续，driver 拒绝则抛错、链条中断。
3. provider 回退准备：`binding-replaced`（Codex）执行 `rewindSessionForEdit` 替换绑定；`resume-at-anchor`（Claude）把 anchor 作为 run 选项交付。
4. 新 run 以最新绑定启动。关闭/回退/启动任一失败统一结算为一次 `EDIT_REWIND_FAILED` + 一次 `complete exitCode=1`，provider 不再被要求继续旧上下文。

失败读数（新文件行为测试实测）：
- 准入拒绝（busy）：close=0、rewind=0、run=1（在飞）、末帧 `RUN_IN_PROGRESS`，零副作用。
- host 关闭拒绝：close=1、rewind=0、run=0、complete=1(exit 1)、`EDIT_REWIND_FAILED`=1。
- 绑定替换失败（Codex resident）：close=1、run=0、complete=1(exit 1)、`EDIT_REWIND_FAILED`=1。
- 启动失败：close=1、rewind=1、run=1（抛错）、complete=1(exit 1)、`EDIT_REWIND_FAILED`=1。
- host 已消失：close 调用 1 次、found=false、run=1，不算失败。
- 普通 `chat.send`（resident）：close=0、`history_truncated`=0。

验证命令与读数：
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-edit-preparation.test.ts` → 26 pass / 0 fail（Claude/Codex × per-run/resident × 中间/首条、host 已消失、准入拒绝、失败矩阵、两条反向控制）。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-edit-send.test.ts` → 13 pass / 0 fail。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/session-hosts/tests/session-host-lifecycle.test.ts server/modules/session-hosts/tests/lifecycle-mode.test.ts` → 16 pass / 0 fail。
- `npx tsc --noEmit -p server/tsconfig.json` → exit 0。
- `npm run lint` → exit 0（仅既有 warning）。
- `npm run build:server` → exit 0。
- 实现前基线实跑 exit 1：`Could not find 'server/modules/websocket/tests/chat-edit-preparation.test.ts'`。

套件侧的连带读数（本轮续跑修复）：新增 server 判据文件把树收集数 481→482，AC7 的 90% 地板读成 433/482=89.83% 红，AC2/AC3 的两条 `unknown=` pin 实读 479/481 vs 钉 478/480。补 `scripts/suite-duration-baseline.tsv` 一行（实测 10542ms，覆盖回到 434/482=90.04%）并把两条 pin 移到 479/481 后，单文件复跑
- `TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --import ./scripts/undici-blocked-ports-preload.mjs --test server/shared/tests/quay-test-script.test.ts` → 14 pass / 0 fail（88156ms）。

反向控制：`reverse control: the pre-fix mutual exclusion would leave a Codex resident host open` 与 `reverse control: swallowing a close refusal would let the rewind continue` 在恢复 `resident && !rewinds` 互斥或吞掉 close 拒绝时必红。

- 该轴仍暗,理由:本任务为编辑编排行为修复，未变更模块分层或依赖环，无 L_D/L_G 可读量。
