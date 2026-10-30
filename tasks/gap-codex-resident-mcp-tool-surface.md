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

- [ ] AC1 **codex 会话能拿到 CloudCLI MCP 工具**：真实（或隔离实例）codex 会话的工具列表里出现 Bash/Read/MCP 浏览器等 gateway 工具；贴工具名与来源读数。假形态：去掉注入 ⇒ 工具列表为空 ⇒ 红。
- [ ] AC2 **授权链不旁路**：codex 会话调用 gateway 工具时仍过 scope/audit；缺 scope 的调用被拒且记审计；贴一条拒绝读数和审计行。假形态：把 codex 注入改成绕过 scope 检查 ⇒ 红。
- [ ] AC3 **凭据/地址不硬编码**：仓库 diff 里不出现明文 token/内网地址；地址来自既有 gateway 配置/环境。`npm run typecheck` 退出 0。
- [ ] AC4 **范围与无回归**：改动只在 codex provider 路径；claude/cursor/opencode 的工具面不变；`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 与相关 gateway 测试退出 0 且 fail 0。

## DoD

隔离实例（或真实实例）实测 codex 会话能调用至少一个 CloudCLI MCP 工具并拿到结果；贴工具列表、一次成功调用与一次拒绝读数；截图存 tmp/。

## Touches

- server/modules/providers/list/codex/codex.provider.ts
- server/modules/providers/list/codex/codex-app-server.connection.ts
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/tests/codex-host-driver-persistent.test.ts
- tasks/gap-codex-resident-mcp-tool-surface.md