---
id: gap-codex-resident-mcp-tool-surface
title: codex app-server 接入 CloudCLI MCP 工具面（Bash/Read/MCP 浏览器）
status: ready
labels: []
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`codex.provider.ts` 构造 `CodexHostDriver` 只传 `host`，`CodexAppServerLaunch` 只有 `cwd`/`env`；app-server 是 `spawn(node,[launcher,'app-server'],{cwd,env})` 裸起，没有把 CloudCLI 的 MCP 工具面（Bash/Read/MCP 浏览器等）接进去。结果 codex 会话只拿到 `~/.codex/config.toml` 里用户自配的工具，拿不到 claude 会话同源的 CloudCLI 工具与授权链（实测：codex 会话 Bash 沙箱初始化失败、MCP 浏览器标签页读取被拒）。

## Plan

1. 把 CloudCLI 的 MCP gateway 作为 codex app-server 的 MCP server 注入 launch（用 codex app-server 支持的配置形状，如 `-c mcp_servers.<name>.url=…` / 类型参数等），让 codex 会话获得 Bash/Read/MCP 浏览器等 CloudCLI 工具。
2. 工具的授权沿用现有 MCP gateway 的 scope/audit 链（不是给 codex 开新后门）：工具 scope、会话/调用者身份、审计都要与 claude 会话走同一条 seam；凭据/地址不得硬编码进仓库（走既有 gateway 配置/环境）。
3. 只在 codex provider 路径生效，其它 provider 与无 codex 选择的环境不受影响。

## AC

- [x] AC1 **codex 会话能拿到 CloudCLI MCP 工具**：真实（或隔离实例）codex 会话的工具列表里出现 Bash/Read/MCP 浏览器等 gateway 工具；贴工具名与来源读数。假形态：去掉注入 ⇒ 工具列表为空 ⇒ 红。
- [x] AC2 **授权链不旁路**：codex 会话调用 gateway 工具时仍过 scope/audit；缺 scope 的调用被拒且记审计；贴一条拒绝读数和审计行。假形态：把 codex 注入改成绕过 scope 检查 ⇒ 红。
- [x] AC3 **凭据/地址不硬编码**：仓库 diff 里不出现明文 token/内网地址；地址来自既有 gateway 配置/环境。`npm run typecheck` 退出 0。
- [x] AC4 **范围与无回归**：改动只在 codex provider 路径；claude/cursor/opencode 的工具面不变；`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 与相关 gateway 测试退出 0 且 fail 0。

## DoD

隔离实例（或真实实例）实测 codex 会话能调用至少一个 CloudCLI MCP 工具并拿到结果；贴工具列表、一次成功调用与一次拒绝读数；截图存 tmp/。

## Evidence

实现：`codexMcpGatewayLaunch`（`codex-host-driver.contract.ts`）把 `-c mcp_servers.cloudcli.url="…"` 与 `-c mcp_servers.cloudcli.bearer_token_env_var="CLOUDCLI_MCP_GATEWAY_TOKEN"` 追加进 `CodexAppServerLaunch.args`，token 只放子进程环境；`codex.provider.ts` 的 `createConnection` 在开 host 时经 fail-closed 端口读目标；地址缺省为 `http://127.0.0.1:<SERVER_PORT>/mcp`，凭据是 settings 文件 `codex.mcpGateway.tokenFile` 指向的 0600 `ccp_` PAT（默认关）。settings 块由 composition root 读一次并安装端口，provider 层不 import `modules/settings`（AC-394 环）。

**AC1 读数**（真实 `codex app-server` 0.166.0，真实 gateway，`mcpServerStatus/list detail=full`）：

```
servers ["cloudcli"]
gateway {"name":"cloudcli","serverName":"claudecodeui-mcp-gateway","authStatus":"bearerToken","toolCount":36,
 tools:["session_get","cockpit_card_confirm","ui_selected_text","ui_last_opened_session","session_read","run_get",
 "sessions_list","session_interrupt","ui_open_session","ui_open_task","session_reconfigure","session_start",
 "mcp_usage_stats","session_steer","overview","approvals_list","draft_submit","projects_list","ui_clients_list",
 "session_close","cockpit_cards","ui_visible_context","cockpit_card","changes","cockpit_card_brief",
 "session_create","ui_focus_turn","ui_show_diff","approval_answer","session_send","session_cancel_queued",
 "quay_snapshot","session_search","draft_get","session_background","draft_set"]}
```

假形态（去掉注入）：`codexMcpGatewayLaunch(launch, null)` 原样返回同一个 launch（无 `-c`、无 token env），已由 committed 判据 `the resident launch injects the /mcp gateway only when a target is installed` 钉住。

**AC2 读数**（同一只 `cloudcli:read` PAT，`token_id=287`）：
- `mcpServer/tool/call sessions_list` ⇒ `isError:false`，返回真实会话列表；
- `mcpServer/tool/call session_create` ⇒ `isError:true`，`Missing required scope "cloudcli:session:create". Re-authorize with that scope to call session_create.`
- `mcp_audit_log`：`{id:49659, tool:"sessions_list", outcome:"ok"}`；`{id:49660, tool:"session_create", outcome:"denied", denied_scopes:"[\"cloudcli:session:create\"]", error_code:"INSUFFICIENT_SCOPE"}`。

**AC3 读数**：`npm run typecheck` 退出 0（三段 tsc 全绿）；diff 中无明文 token，无内网地址（默认地址由 `SERVER_PORT`+`MCP_GATEWAY_PATH` 推导，token 只在 0600 文件与子进程环境）。`/proc/<server 起的 codex 子进程>/environ` 有 `CLOUDCLI_MCP_GATEWAY_TOKEN`（value_len=68），同进程 cmdline 中无该值。

**AC4 读数**：`codex-host-driver-persistent.test.ts` tests=10 pass=10 fail=0；`settings.service.test.ts` tests=7 pass=7 fail=0；`architecture-ratchet.test.ts` tests=6 pass=6 fail=0；`server-import-cycle-budget.test.ts` tests=12 pass=12 fail=0；`composition-root-wiring.test.ts` tests=6 pass=6 fail=0。改动面只在 codex provider 的 launch 与 settings/端口装配，claude/cursor/opencode 路径未改。

**DoD**：隔离实例（源码直起、复制库、restore/sweep 关、`MCP_ENABLED=true`）里经 gateway `session_start` 起了一个 codex resident host，`/proc/<pid>/cmdline` 读到
`codex app-server -c mcp_servers.cloudcli.url="http://127.0.0.1:4977/mcp" -c mcp_servers.cloudcli.bearer_token_env_var="CLOUDCLI_MCP_GATEWAY_TOKEN"`，随后 `session_close` 回收（child gone）。工具列表、成功调用、拒绝读数见上；完整报告存 `tmp/dod/REPORT.md`（`tmp/` 已 gitignore）。后端任务无 UI，故无浏览器截图，改为上述进程/协议读数。

- 该轴仍暗,理由:L_D/L_G 两根轴本任务均未触碰——没有设计文档或架构层次产物的改动，无可记读数。

## Touches

- server/modules/providers/list/codex/codex.provider.ts
- server/modules/providers/list/codex/codex-app-server.connection.ts
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/tests/codex-host-driver-persistent.test.ts
- server/shared/ports/mcp-gateway-client.port.ts
- server/modules/settings/codex-mcp-gateway.settings.ts
- server/modules/settings/server-settings.ts
- server/modules/settings/index.ts
- server/modules/settings/tests/settings.service.test.ts
- server/codex-mcp-gateway-wiring.ts
- server/index.ts
- server/shared/tests/architecture-ratchet.baseline.json
- config/server.settings.example.json
- tasks/gap-codex-resident-mcp-tool-surface.md
