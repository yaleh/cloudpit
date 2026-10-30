---
id: gap-mcp-session-steer-tool
title: 新增 session_steer MCP 工具：把 resident turn/steer 暴露给外部 MCP 客户端
status: ready
labels: []
parent: null
children: []
extra:
  schema: execution
---
## Proposal

GOAL-051 AC-444 已把 turn/steer（忙时改当前 turn、不排队列、不开新 turn）实现进 `CodexHostDriver.steer`（`server/modules/providers/list/codex/codex-host-driver.provider.ts`，经 `codex-resident-steer.ts` 发 `turn/steer`），且 HTTP/UI 面可用。但 MCP gateway（`server/modules/mcp-gateway/`）的工具表里**没有** `session_steer`：现有 session 工具是 `session_start/session_send/session_create/session_close/session_interrupt/session_cancel_queued/session_reconfigure/session_background`。外部 MCP 客户端无法经 MCP 触发 steer。

## Plan

1. 新增 `session_steer` MCP 写工具（scope 用 control，与 `session_interrupt` 同级），入参至少 `sessionId` + `input`（要 steer 成的新输入文本）；把调用路由到 resident steer 路径（复用 provider 侧 `steer`/控制服务的既有入口，不要另写一套协议）。
2. 语义与 AC-444 一致：改的是**当前在飞 turn**，不 `thread/queue/add`、不开新 turn；无在飞 turn 时给可读拒绝（不是静默成功）。
3. provider 中立：工具描述不写死 codex；凡 host driver 提供 `steer` 的 provider 都可用，未提供的给明确拒绝。

## AC

- [ ] AC1 **工具注册**：`session_steer` 出现在 gateway 的 stage-4/写工具表（与 `session_interrupt` 同表），scope=control；既有五工具（session_close/create/interrupt/send/start）不变。
- [ ] AC2 **路由到 resident steer**：注入内存假 transport 的 codex resident 会话在飞时，`session_steer {sessionId, input}` 发一次 `turn/steer`（expectedTurnId=当前 activeTurnId），不改队列、不 `turn/start`；假形态：改成 `thread/queue/add` ⇒ 用例红。
- [ ] AC3 **无在飞 turn 拒绝**：空闲/无绑定的会话上 `session_steer` 返回可读错误（不是空成功）；假形态：把拒绝分支删掉 ⇒ 用例红。
- [ ] AC4 **无回归**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` 与 codex resident 相关测试退出 0 且 fail 0；不新增 server 测试文件（测试加进既有 mcp-gateway 或 codex 测试文件，避免连带 quay-test-script/时长基线钉子）。

## DoD

AC2/AC3 假形态实测先红后绿，贴逐字失败行；`npm run typecheck` 退出 0。

## Touches

- server/modules/mcp-gateway/mcp-session-steer.ts (new)
- server/modules/mcp-gateway/index.ts
- server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts
- tasks/gap-mcp-session-steer-tool.md