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

## Implementation

- `server/modules/mcp-gateway/mcp-session-steer.ts`（新）持有 `session_steer` 的 schema、`buildSessionSteer` 与注册函数。它注入三件事：会话行的 provider、provider registry 的 host-driver 解析、session-hosts 管理器的 `liveHostForSession`；随后对驱动做结构化 `steer` 能力读取（与 `provider-runtime.service.ts` 读 `run`/`cancelQueuedInput` 同一手法），命中即调用驱动**自己的** `steer(host, sessionId, turn)` —— 也就是 AC-444 的 `turn/steer` 面，没有第二套协议、没有队列、没有第二个 turn。驱动未实现 `steer` 时不分支 provider id，直接给 `MCP_TOOL_NOT_IMPLEMENTED` 可读拒绝。
- 注册走同一条写工具 seam，紧挨 AC-249 冻结的五工具（`MCP_STAGE4_WRITE_TOOLS` 长度不动），scope 取表里的 `cloudcli:session:control`；deps 未注入时工具根本不注册（`draft_*` 先例），因此既有 mount 的 `tools/list` 不变。
- 包 barrel `server/modules/mcp-gateway/index.ts` 未改动（新模块只被同包的 `mcp-gateway.write-tools.ts` 与测试以相对路径引用，无需新增导出）。`server/index.ts` 的 `writeTools` 增加 `sessionSteer` 三个进程 seam（与 `session_reconfigure` / `session_start` / `session_background` 读的是同一批对象）。`server/index.ts` 行数 2849→2862，已按 AC-394 格式在 `architecture-ratchet.baseline.json` 的 note 写 RECORDED CHANGE 并上调该条基线。

## AC

- [x] AC1 **工具注册**：`session_steer` 出现在 gateway 的 stage-4/写工具表（与 `session_interrupt` 同表），scope=control；既有五工具（session_close/create/interrupt/send/start）不变。
- [x] AC2 **路由到 resident steer**：注入内存假 transport 的 codex resident 会话在飞时，`session_steer {sessionId, input}` 发一次 `turn/steer`（expectedTurnId=当前 activeTurnId），不改队列、不 `turn/start`；假形态：改成 `thread/queue/add` ⇒ 用例红。
- [x] AC3 **无在飞 turn 拒绝**：空闲/无绑定的会话上 `session_steer` 返回可读错误（不是空成功）；假形态：把拒绝分支删掉 ⇒ 用例红。
- [x] AC4 **无回归**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` 与 codex resident 相关测试退出 0 且 fail 0；不新增 server 测试文件（测试加进既有 mcp-gateway 或 codex 测试文件，避免连带 quay-test-script/时长基线钉子）。

## DoD

AC2/AC3 假形态实测先红后绿，贴逐字失败行；`npm run typecheck` 退出 0。

## Verification (2026-10-30)

- AC1 实测读数：`registerMcpWriteTools` 的注册名 = `["session_send","session_create","session_interrupt","session_start","session_close","ui_open_session","ui_focus_turn","ui_show_diff","ui_open_task","session_steer"]`，`session_steer scope=cloudcli:session:control`；真实 mount 的 `tools/list` 同样含五工具 + `session_steer`（leg (o) 输出）。
- AC4 / typecheck：`npm run typecheck` 退出 0（三份 tsconfig 全过）。
- AC4 测试：`npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` → tests 17, pass 17, fail 0；`server/modules/providers/tests/codex-host-driver-steer.test.ts` → pass 4, fail 0；`mcp-tool-annotations` 5/5、`mcp-error-vocabulary` 5/5、`mcp-error-envelope` 7/7、`mcp-english-only` 10/10、`server/shared/tests/architecture-ratchet.test.ts` 6/6，全部 fail 0。
- AC2 假形态（把 `driver.steer` 换成经驱动连接发 `thread/queue/add`）先红，逐字：

  ```
  session-lifecycle (o) payload={"sessionId":"codex-steer-session","turnId":"turn-1"} activeTurnId=turn-1 steerWindow=["thread/queue/add"] queueDepth=1
  ✖ (o) session_steer is a control-scope write tool that rewrites the in-flight turn with one turn/steer
    AssertionError [ERR_ASSERTION]: exactly one turn/steer must be sent (saw ["thread/queue/add"])
      actual: 0,
      expected: 1,
  ```

  恢复为 `driver.steer` 后同用例绿，读数：`payload={"sessionId":"codex-steer-session","turnId":"turn-1"} activeTurnId=turn-1 steerWindow=["turn/steer"] queueDepth=0`。
- AC3 假形态（删掉 `if (!host)` 的 RUN_NOT_FOUND 拒绝分支）先红，逐字：

  ```
  session-lifecycle (p) unbound isError=true code=INTERNAL_ERROR text=Cannot read properties of null (reading 'hostId')
  ✖ (p) session_steer refuses an idle, unbound, unsupported or unknown session with a readable error
    AssertionError [ERR_ASSERTION]: no live host must be the structured RUN_NOT_FOUND refusal
      actual: 'INTERNAL_ERROR',
      expected: 'RUN_NOT_FOUND',
  ```

  恢复后同用例绿：idle `isError=true text=No Codex turn is in flight ...`、unbound `code=RUN_NOT_FOUND`、unsupported `code=MCP_TOOL_NOT_IMPLEMENTED`、unknown `code=SESSION_NOT_FOUND`，且 `steerCalls=0 queueAddCalls=0`。

## 轴线记录 (ADR-007)

该轴仍暗,理由:本任务只新增一个 mcp-gateway 叶子模块并在既有装配点注册，未新增包级依赖边或循环；worktree 内 `.archguard` 报告缺席，未取到 L_D/L_G 数值。

## Touches

- server/modules/mcp-gateway/mcp-session-steer.ts (new)
- server/modules/mcp-gateway/mcp-gateway.write-tools.ts
- server/modules/mcp-gateway/mcp-tool-annotations.ts
- server/modules/mcp-gateway/mcp-tool-error-codes.ts
- server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts
- server/modules/mcp-gateway/tests/mcp-tool-annotations.test.ts
- server/modules/mcp-gateway/tests/mcp-error-vocabulary.test.ts
- server/index.ts
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-mcp-session-steer-tool.md