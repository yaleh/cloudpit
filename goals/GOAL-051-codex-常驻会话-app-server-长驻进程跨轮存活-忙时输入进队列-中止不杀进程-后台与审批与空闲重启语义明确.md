---
id: GOAL-051
title: Codex 常驻会话：app-server 长驻进程跨轮存活、忙时输入进队列、中止不杀进程、后台与审批与空闲重启语义明确
status: draft
kind: goal
origin: 接续 GOAL-013 非目标（Codex/Cursor/OpenCode 常驻）。人 yale 2026-10-29 五条裁定：①
  multiplexedHost 先 false；② 默认 workspace-write + never；③ 租约只用 turn +
  background-task；④ Shell 改普通终端不 resume；⑤ task pump 放 server/modules/quay/。实验读数
  tmp/codex-appserver-exp-NuPHhk/REPORT.md（锁定版 0.153.4，E1–E8）
branch: true
---
## 背景

per-run Codex 每轮一个 codex exec（server/modules/providers/list/codex/codex-runtime.provider.ts），SDK 只有 startThread/resumeThread/runStreamed，没有 queue/steer/status/background terminals/goals。Codex 的 app-server JSON-RPC（锁定版 @openai/codex 0.153.4）具备这些原语，已实测（tmp/codex-appserver-exp-NuPHhk/REPORT.md，E1–E8：持久线程、忙时 queue、interrupt 保留进程、live settings、background terminals、restart resume、审批、steer）。本 goal 把 Codex 会话主路径从 SDK 迁到长驻 app-server，接入现有 session-hosts 宿主层，达到与 GOAL-013（Claude 常驻）对等的生命周期语义。

## 范围

- CodexAppServerConnection：长驻 stdio JSON-RPC，initialize 声明 capabilities.experimentalApi=true（thread/queue 必需），request/notification/server-request 分发，退出与日志。
- CodexHostDriver 实现 IProviderHostDriver + run；multiplexedHost=false，一会话一 app-server。
- thread/start|resume、turn/start|steer|interrupt、thread/queue/add|list|delete|start、thread/settings/update。
- 后台 lease：process/spawn 到 process/exited 的 processHandle 账本；不依赖 thread/backgroundTerminals/list（实测 client 进程不在该列表）。
- 审批 broker：五类 server request（commandExecution/fileChange/permissions/elicitation/toolUserInput），accept/decline/cancel，waitingOnApproval，无人值守 decline/cancel。
- capabilities：codex lifecycleModes=['per-run','resident'] 与 residentFeatures；其他 provider 拒绝 resident 写入。
- 重启恢复：thread/resume（首轮后）；零轮次 resume 失败（no rollout found）时 thread/start 并更新 session 行；复用 residentRestore。
- Shell 标签：普通终端不 resume（不沿用 Claude 的禁用）。
- 进程 containment：复用 claudecodeui-session-* scope 与启动清扫。
- 前端：常驻开关、忙时输入/撤回、状态栏，复用现有 resident UI；新增 Codex 错误文案。

## 非目标

- multiplexedHost=true（共享 app-server 多 thread）。
- Codex thread/goal lease（租约只用 turn + background-task）。
- 多机/websocket/daemon/remote-control。
- quay task pump（单独立 GOAL，放 server/modules/quay/）。
- 把 execution 放进 quay Provider ABI。

## 退出条件

- AC-435..AC-442（pre-merge，判据 worktree 上求值）+ AC-443（post-merge，真实浏览器，主检出上求值）。