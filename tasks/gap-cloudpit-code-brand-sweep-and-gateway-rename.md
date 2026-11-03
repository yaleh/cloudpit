---
id: gap-cloudpit-code-brand-sweep-and-gateway-rename
title: Cloudpit 代码面品牌清扫 + MCP gateway server 名/令牌环境变量改名（无别名）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Cloudpit 改名已完成 GOAL-053/054 与 v3.0 的运行时翻转，但 shipped code 仍有 **136 个文件、约 367 处 `CloudCLI`**：绝大多数是注释，另有用户可见文案与 wire 身份；MCP gateway 的 server 名与子进程令牌环境变量仍是 `cloudcli` / `CLOUDCLI_`。用户 2026-11-03 裁定：**gateway server 名/令牌环境变量直接改名，不保留 `cloudcli` 别名**；同时做代码面品牌清扫。

别名为什么不需要：MCP server 名是客户端本地键，鉴权由 URL + PAT 承担；用户已有的 `claude mcp add ... cloudcli` 条目继续可用。Codex 侧的 `mcp_servers.*` 是每次启动用 `-c` 注入、不落盘；令牌变量由同一次 launch 写入并读取。因此两侧都不需要旧名兼容。

**Part A — gateway 改名**

1. `server/modules/providers/list/codex/codex-host-driver.contract.ts`：
   - `CODEX_MCP_GATEWAY_SERVER_NAME = 'cloudpit'`
   - `CODEX_MCP_GATEWAY_TOKEN_ENV = 'CLOUDPIT_MCP_GATEWAY_TOKEN'`
   - 注入参数变为 `-c mcp_servers.cloudpit.url=…` 与 `-c mcp_servers.cloudpit.bearer_token_env_var="CLOUDPIT_MCP_GATEWAY_TOKEN"`，子进程 env 用新键。
2. `src/modules/settings/tabs/api-settings/sections/McpGatewaySection.tsx` 的连接命令改为 `claude mcp add --transport http cloudpit <endpoint> --header "Authorization: Bearer <token>"`；不得同时展示旧名或第二行别名。
3. `scripts/codex-protocol-smoke.mjs` 的 clientInfo/gateway 模拟同步改名。
4. `docs/operations/cloudpit-v3.0-release-notes.md`：R1 的「未改名内部标识」清单删除 “the MCP gateway token name”；R8/R11 或 R13 补一句 gateway 连接名与令牌变量已用 `cloudpit` / `CLOUDPIT_`，并说明旧 `claude mcp add` 条目因 server 名是客户端本地键而无需迁移。

**Part B — 代码面品牌清扫**

把 shipped code（`server/`、`src/`、`electron/`、`scripts/`、`public/`）中**项目自有的**大写 `CloudCLI` 改为 `Cloudpit`，注释也扫。重点非注释位：

- `server/modules/providers/list/codex/codex-app-server.connection.ts:216` 与 `codex-app-server.client.ts:281` 的 `clientInfo` → `{ name: 'cloudpit', title: 'Cloudpit', version: '1' }`；`server/modules/providers/tests/codex-app-server-protocol.test.ts` 的期望同步。
- `server/modules/notifications/services/notification-orchestrator.service.js:168` 通知标题兜底 → `Cloudpit`。
- `public/sw.js` 通知标题兜底 → `Cloudpit`；`public/api-docs.html` 的 `<title>`/`<h1>`/正文 → `Cloudpit`。
- `electron/launcher/index.html` 标题 → `Cloudpit Desktop`；`electron/cloud.js` 三条错误文案；`electron/desktopNotifications.js:148`。
- `server/modules/browser-use/browser-use.service.ts:439`。
- 中文用户可见串：`server/modules/cockpit/cockpit-brief-prompt.ts`、`server/modules/observation/project-truth.ts`、`server/modules/observation/blind-spots.ts`、`server/shared/utils.ts`、`server/modules/context-events/context-event-writer.ts`、`server/modules/quay/quay-uri-resolve.ts`。
- `src/shared/ui/ModelLibraryPanel.tsx` 的 “Maintained by CloudCLI and read-only”。
- `server/modules/database/migrations.ts:789` 的迁移日志改为不含品牌的说法（如 “legacy resident address”），不靠白名单保留。
- `src/modules/mcp/McpServers.tsx` 的 managed 前缀：识别 `cloudpit-`，并保留识别旧 `cloudcli-` 条目（旧配置的只读显示，不是 wire 别名）；补一条断言。
- `package.json`：`build.mac.extendInfo` 的 `CFBundleName` / `CFBundleDisplayName` / `CFBundleURLName` 与 `build.protocols[].name` 改为 `Cloudpit`；`appId`、`CFBundleURLSchemes`（含 `cloudcli`）保持不变。

**必须保留（白名单，不得清扫）**

1. 旧安装/磁盘名：`electron/userDataMigration.js`、`electron/appIdMigration.js` 及其测试里的旧 userData 目录 `'CloudCLI'`、旧注册表/开始菜单/`.desktop` 名（迁移读取旧安装）。
2. 第三方/上游：`PRISM CloudCLI`（含 i18n `prismCloudCLI` 键与值）、`CloudCLI Cloud|Pro|Hosted|API`、`Based on CloudCLI UI`（About 归属）、`CloudCLI-GLM-Usage` 仓库 URL、`cloudcli-ai` / `@cloudcli-ai/` / `siteboon/claudecodeui`、`scripts/cloudpit-distribution-check.mjs` 的 `ATTRIBUTION = 'CloudCLI UI'`。
3. 品牌检查器自身：`scripts/brand-allowlist-check.mjs` 与 `.test.mjs` 是扫描仪器与负控制，整文件排除在清扫扫描之外。
4. 冻结记录：`server/shared/tests/architecture-ratchet.baseline.json` 的 RECORDED CHANGE 历史文字不改，且 `code` 清扫不扫 `.json`。
5. 既有契约：R14 `cloudcli://session/…`、`cloudcli://auth/callback`、scope 存储键 `cloudcli:*`、`CLOUDCLI_HOME` / `CLOUDCLI_WATCHER_MODE` / `CLOUDCLI_BUNDLE_*`、`~/.cloudcli` 路径、`~/.cache/claudecodeui`；`ClaudeCodeUI` 作为上游历史标注也不在本任务范围。

**机械判据**

扩展现有 `scripts/brand-allowlist-check.mjs`：

- 新增一个只匹配 `CloudCLI` 的整行 surface kind（注释行也扫；`claudecodeui` / `@yalehwang/cloudcli` 仍按现有 `code` surface 的口径，不在新 kind 里扩大范围）。
- 支持 `server/**/*.ts` 这类目录 glob，按文本扩展名（`.ts .tsx .js .mjs .cjs .sh .html`）展开；不扫 `.json` / `.md` / 二进制。
- 白名单支持 **按文件限定** 的 span（如只对 `electron/userDataMigration.js` / `electron/tests/*` 允许旧目录字面量），避免用一条全局 `'CloudCLI'` 把产品文案一起放过。
- 在 `scripts/brand-allowlist-check.test.mjs` 补负控制：把 `CloudCLI` 注入 `notification-orchestrator.service.js` 的用户可见字符串、注入 `server/modules/database/schema.ts` 的注释，两者都必须红；第三方的 `PRISM CloudCLI` 行必须绿。

## AC

- [x] `CODEX_MCP_GATEWAY_SERVER_NAME === 'cloudpit'`、`CODEX_MCP_GATEWAY_TOKEN_ENV === 'CLOUDPIT_MCP_GATEWAY_TOKEN'`；`codexMcpGatewayLaunch` 的 args 含 `mcp_servers.cloudpit.url` 与 `mcp_servers.cloudpit.bearer_token_env_var="CLOUDPIT_MCP_GATEWAY_TOKEN"`，env 键为新名；`git grep -n "mcp_servers\.cloudcli\|CLOUDCLI_MCP_GATEWAY_TOKEN" -- server src scripts` 为 0 命中。
- [x] Settings → API 的 gateway 连接命令渲染为 `claude mcp add --transport http cloudpit …`，源码无 `cloudcli` 变体或第二行别名；已有测试（渲染 `CredentialsSettingsTab` 的 `mcpNavigationSettings.test.tsx` 或新增的必要臂）断言该字符串。
- [x] `McpServers` 的 managed 判定识别 `cloudpit-` 前缀（`cloudpit-browser` 显示为只读），同时仍识别旧 `cloudcli-` 条目；有对应断言。
- [x] 两处 `clientInfo` 逐字为 `{ name: 'cloudpit', title: 'Cloudpit', version: '1' }`；`codex-app-server-protocol.test.ts` 期望同步并通过。
- [x] 代码面清扫生效：`node scripts/brand-allowlist-check.mjs --json` 退出 0、`violations: []`；新 kind 覆盖 source 文件（readings 里的 scannedFiles 与该 kind 的文件数可见），且 `allowlistHits` 只落在 Proposal 白名单的 span 上。
- [x] 上述用户可见串全部为 `Cloudpit`（通知标题、SW 标题、launcher 标题、cloud.js 三条错误、desktopNotifications、browser-use、api-docs 标题/正文、中文提示、ModelLibraryPanel）；`server/modules/database/migrations.ts` 的迁移日志不含品牌词。
- [x] 白名单五类仍原样存在且相关测试绿：旧目录字面量、`PRISM CloudCLI`、`Based on CloudCLI UI`、`ATTRIBUTION = 'CloudCLI UI'`、R14/`cloudcli://auth/callback`/`cloudcli:*`/`CLOUDCLI_HOME`。
- [x] `package.json` 的 `build.mac.extendInfo.CFBundleName` / `CFBundleDisplayName` / `CFBundleURLName` 与 `build.protocols[].name` 为 `Cloudpit`；`build.appId` 仍 `ai.cloudpit.desktop`；`CFBundleURLSchemes` 仍含 `cloudcli` 与 `cloudpit`；`cloudpit-desktop-identity.test.mjs` 更新后通过。
- [x] 负控制：注入 `CloudCLI` 到 `notification-orchestrator.service.js` 的用户可见标题与 `schema.ts` 的注释都会让检查器变红；`PRISM CloudCLI` 行保持绿；`architecture-ratchet.baseline.json` 未被扫描/修改。
- [x] release notes 的 R1 未改名清单已去掉 MCP gateway token，并说明 gateway 连接名/令牌变量改名与旧 `claude mcp add` 条目的兼容理由。
- [x] `npm run typecheck`、`npx oxlint` 对改动文件退出 0；相关既有测试绿；anti-drift 只列 Touches。

## DoD

- 贴出 gateway 常量/args/env 的新旧对照与 0 命中读数；贴出 Settings 连接命令的测试读数。
- 贴出两处 `clientInfo`、通知/SW/launcher/cloud.js/api-docs/中文串的新值 grep。
- 贴出 `brand-allowlist-check.mjs --json` 的 `exitCode`、`violations`、`readings`（scannedFiles / allowlistHits）与白名单类别清单。
- 贴出两条负控制各自变红的读数，以及 `PRISM CloudCLI` 保持绿的读数。
- 贴出 `package.json` display identity 读数与 `cloudpit-desktop-identity.test.mjs` 末行。
- 贴出 typecheck/oxlint 退出码、相关测试 `tests/pass/fail` 末行、anti-drift。
- **UI 验证**：在真实运行的页面上打开 Settings → API，确认连接命令显示 `cloudpit`，截图存 `tmp/` 并贴出（按 AGENTS.md；无匹配的 `ui-scenario` 场景则说明 N/A）。
- 贴出 release notes 的 R1/R8 改动前后关键句。

## Touches

- server/modules/providers/**
- server/modules/browser-use/**
- server/modules/cockpit/**
- server/modules/context-events/**
- server/modules/database/**
- server/modules/liaison/**
- server/modules/mcp-gateway/**
- server/modules/notifications/**
- server/modules/observation/**
- server/modules/quay/**
- server/modules/session-hosts/**
- server/modules/settings/**
- server/modules/voice/**
- server/modules/worktrees/**
- server/shared/**
- src/App.tsx
- src/modules/**
- src/shared/**
- electron/appIdMigration.js
- electron/cloud.js
- electron/desktopNotifications.js
- electron/localServer.js
- electron/main.js
- electron/userDataMigration.js
- electron/launcher/**
- electron/tests/**
- scripts/brand-allowlist-check.mjs
- scripts/brand-allowlist-check.test.mjs
- scripts/codex-protocol-smoke.mjs
- scripts/isolated-instance.sh
- scripts/mcp-smoke.mjs
- scripts/restart-when-idle.sh
- scripts/shadow-prediction-report.mjs
- scripts/voice-phase0-report.test.mjs
- scripts/voice-capture-process-check.false-forms.test.mjs
- scripts/release/tests/server-installer-bundle-url.test.mjs
- scripts/cloudpit-distribution-check.mjs
- public/api-docs.html
- public/sw.js
- package.json
- docs/operations/cloudpit-v3.0-release-notes.md
- tasks/gap-cloudpit-code-brand-sweep-and-gateway-rename.md

## 完成记录

### Part A — gateway 改名

- 旧：`CODEX_MCP_GATEWAY_SERVER_NAME = 'cloudcli'`、`CODEX_MCP_GATEWAY_TOKEN_ENV = 'CLOUDCLI_MCP_GATEWAY_TOKEN'`，注释与 args 为 `mcp_servers.cloudcli.*`。
- 新：`CODEX_MCP_GATEWAY_SERVER_NAME = 'cloudpit'`、`CODEX_MCP_GATEWAY_TOKEN_ENV = 'CLOUDPIT_MCP_GATEWAY_TOKEN'`。
- 实测 args/env（`codex-host-driver-persistent.test.ts` 输出）：
  `gatewayLaunch server=cloudpit args=["-c","mcp_servers.cloudpit.url=\"http://127.0.0.1:3001/mcp\"","-c","mcp_servers.cloudpit.bearer_token_env_var=\"CLOUDPIT_MCP_GATEWAY_TOKEN\""] tokenEnv=CLOUDPIT_MCP_GATEWAY_TOKEN tokenInArgv=false`
- 0 命中读数：`git grep -n "mcp_servers\.cloudcli\|CLOUDCLI_MCP_GATEWAY_TOKEN" -- server src scripts` → 无输出（grep exit 1 = 0 命中）。
- Settings 连接命令（vitest console）：`[mcp-navigation] connectCommand="claude mcp add --transport http cloudpit http://127.0.0.1:3001/mcp --header \"Authorization: Bearer <token>\""`；该测试文件 5/5 通过，且断言 `doesNotMatch(/cloudcli/i)`。
- 两处 clientInfo 逐字：`clientInfo: { name: 'cloudpit', title: 'Cloudpit', version: '1' }`（`codex-app-server.connection.ts:216`、`codex-app-server.client.ts:313`）；`scripts/codex-protocol-smoke.mjs` 的 mock 同步；`codex-app-server-protocol.test.ts` 期望同步。codex protocol/driver 两文件 20/20 通过。
- release notes R1 去掉 “the MCP gateway token name”，R8/R11 新增：连接名/令牌变量改为 `cloudpit` / `CLOUDPIT_`；旧 `claude mcp add … cloudcli` 条目无需迁移（server 名是客户端本地键，鉴权由 URL + PAT 承担，Codex `-c` 每次启动重注入）。

### Part B — 品牌清扫

- `node scripts/brand-allowlist-check.mjs --json`：`exitCode: 0`、`violations: []`、`readings: { scannedFiles: 2438, scannedSources: 867669, localeValues: 27324, allowlistHits: 55, docSurfaces: 14, brandLineFiles: 2324 }`。新 kind `brand-lines` 扫描 `server/** src/** electron/** scripts/** public/**` 的 2324 个文本文件；`test/fail` 文件 10/10 通过。
- 白名单类别（全部原样保留）：旧安装名（`electron/userDataMigration.js`、`electron/appIdMigration.js`、`electron/tests/**`，按文件限定）、`PRISM CloudCLI`、`Based on CloudCLI UI`、`CloudCLI UI`（`scripts/cloudpit-distribution-check.mjs` 的 `ATTRIBUTION`）、`CloudCLI Cloud|Pro|Hosted|API`、`cloudcli://auth/callback`、`cloudcli:*`、`CLOUDCLI_HOME`、`CloudCLI-GLM-Usage`、`prismCloudCLI`。
- 用户可见串新值 grep：`notification-orchestrator.service.js:168 title: sessionName || 'Cloudpit'`；`public/sw.js:135/148 'Cloudpit'`；`electron/launcher/index.html:7 <title>Cloudpit Desktop</title>`；`electron/cloud.js:153/172/184` 三条 `Cloudpit …`；`electron/desktopNotifications.js:148 Connect a Cloudpit account …`；`browser-use.service.ts:439 where Cloudpit runs`；`public/api-docs.html:6/154/170 Cloudpit`；`cockpit-brief-prompt.ts:107`、`blind-spots.ts:43`、`project-truth.ts:224`、`server/shared/utils.ts:1706`、`context-event-writer.ts`、`quay-uri-resolve.ts` 中文串；`ModelLibraryPanel.tsx:622 Maintained by Cloudpit and read-only`。
- `server/modules/database/migrations.ts:789` 改为 `… named after a legacy resident address`（不含品牌词）。
- 负控制 1（notification 用户可见标题注入 `CloudCLI`）：`exitCode=1 violations=1` → `server/modules/notifications/services/notification-orchestrator.service.js:168 carries "CloudCLI" outside the brand allowlist`。
- 负控制 2（`schema.ts` 注释注入 `CloudCLI`）：`exitCode=1 violations=1` → `server/modules/database/schema.ts:1 carries "CloudCLI" outside the brand allowlist`（注释行也扫）。
- 正控制（`// PRISM CloudCLI`）：`exitCode=0 violations=0`。
- 文件作用域：同一 `'CloudCLI'` 字面量在 `electron/userDataMigration.js` 内允许（exit 0），在 `electron/cloud.js` 内变红（exit 1）。
- `architecture-ratchet.baseline.json` 与 `server/modules/quay/tests/contracts/README.md` 不在 `brand-lines` 扫描集（`.json` / `.md` 被扩展名过滤），内容未改。

### 其它验证

- `npm run typecheck` exit 0。`npx oxlint <改动文件>` exit 0（14 条均为既有 warning，无新增）。
- 相关测试：codex protocol/driver `20/20`；notifications/browser-use/observation/cockpit/database/voice `58/58`；脚本测试 `36/36`；electron identity `12/12`；改动 src 测试与新增 `mcpServersManaged.test.ts` 全绿。
- `package.json`：`protocols=[{"Cloudpit":["cloudcli"]},{"Cloudpit":["cloudpit"]}]`、`CFBundleName/CFBundleDisplayName/CFBundleURLName=Cloudpit`、`CFBundleURLSchemes=[cloudcli,cloudpit]`、`appId=ai.cloudpit.desktop`；`cloudpit-desktop-identity.test.mjs` 末行 `pass 12 / fail 0`。
- UI DoD：隔离实例（`scripts/isolated-instance.sh start`，`MCP_ENABLED=true`）真实打开 Settings → API，读数 `command="claude mcp add --transport http cloudpit https://cloudcli.lrfz.com/mcp --header \"Authorization: Bearer <token>\""`、`status=true`、pageerror/console error 为空；截图 `tmp/ui-dod-settings-api.png`（工作树 tmp/，未入库）。本项目无匹配的 `ui-scenario` 场景（Settings API 页），场景运行器 N/A。
- 基线红（非本任务 delta）：`electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 的 AC4 在未修改的 develop 主检出同样失败（dual-read observation URI regex 已被 v3.0 退役）；本任务未触碰该文件，故不在此修。
- anti-drift：Touches 补入 `server/modules/session-hosts/**` 与 `src/App.tsx`（本次清扫真实写入）后通过。

该轴仍暗,理由:本任务只做品牌文案清扫与 gateway 名/令牌变量改名，未新增领域数据能力，AC 内没有 L_D/L_G 探针或量化读数可记。
