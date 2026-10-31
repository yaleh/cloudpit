---
id: gap-cloudpit-visible-identity-flip
title: Cloudpit B1：可见身份与分发身份翻转 + 品牌 allowlist 检查器（承载 AC-451）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-451
---
## Proposal

AC-451 的缺口承载任务：把 Cloudpit 的**可见身份**与**分发身份**一次性翻到位，并落地品牌 allowlist 检查器。AC-451 的判据文件就是本任务新增的 `scripts/brand-allowlist-check.test.mjs`，执行结束时 `npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs` 必须真实退出 0。

输入：`docs/proposals/cloudpit-rename-SPEC.md` §2（产品名与 allowlist 规则）、§6.1（npm 新包）、§9 T1（品牌基座 + 展示层）、§10 AC1/AC2/AC13。GOAL-053 的 A1 已把 `BRAND` 常量与 `server/shared/brand.ts` 作为暗管道落好；本任务第一次让这些常量进入生产读取面。

<!-- dedup-ref -->机制去重：以本任务 `## Touches` 复跑 `task-granularity-advice --task gap-cloudpit-visible-identity-flip`，除自身外只有 `gap-codex-resident-blocked-context-events`（共享一个通用文件 `server/index.ts`）与 `gap-codex-token-usage-snapshot-semantics`（共享一个通用文件 `src/shared/utils.ts`）两个 ready 任务在单个文件上重叠；mechanism 不同（Codex 重启同步 / token 用量语义 vs 品牌身份），判定 **separate**：各自独立验收，调度器按 Touches 串行。任务库里没有任何任务以 `goal_ac: AC-451` 登记（`grep -rl '^goal_ac: AC-451' tasks/` 为空）。边界：AC-452 的运行时默认值（默认 `~/.cloudpit`、settings 新路径、附件双根、协议/scope/MCP/SW）与 AC-453 的桌面迁移接线（userData 复制、server 缓存、`local-server.json` 回退、双 scheme、`appId`）不在本任务内；本任务只翻用户可见名称与 npm/桌面身份字段。若 AC-453 的任务也声明 `electron/main.js`，调度器按 `## Touches` 串行，两任务各自只改自己那部分。

### 本任务做什么

1. **可见面**：`index.html` 的 `<title>` / `apple-mobile-web-app-title`、`public/manifest.json` 的 `name`/`short_name`/`description`、`src/shared/utils.ts` 的默认页面标题、`src/modules/chat-session/utils/session/pageTitleNotification.ts` 的兜底标题、认证加载屏/认证布局/OAuth 同意页的可见产品名与 `alt`、侧边栏页脚、About 产品名、MCP 托管服务默认文案、12 个语言包的**值**（键不动）、CLI banner/status/help/update 文案、Electron `APP_NAME` 与窗口/通知/菜单/启动器可见文案、`server/index.ts` 的 ready 日志。
2. **分发身份**：`package.json` 的 `name`/`bin`/`productName`/`build.productName`/`build.artifactName`/`author`/`keywords` 与 `package-lock.json` 根部 `name`；CLI 版本检查、自更新、全局升级命令与 12 语言包的 `npmUpgradeCommand` 一并指向 `@yalehwang/cloudpit`。**不动** `appId`（仍 `ai.cloudcli.desktop`）、`build.protocols` / `CFBundleURLSchemes`（AC-453）、`cloudcli://auth/callback` 云端契约、`ccp_` PAT 前缀、`~/.cloudcli` 默认数据根（AC-452）。
3. **品牌 allowlist 检查器**：新增 `scripts/brand-allowlist-check.mjs`（可执行 + 可导入），扫描 §2.3 列出的用户可见面；`CloudCLI` / `claudecodeui` 只允许命中显式 allowlist。检查器自带 false-form：注入一条非 allowlist 的 `CloudCLI` 必须报违规，且检查器自身 CLI 退出 1。
4. **判据**：新增 `scripts/brand-allowlist-check.test.mjs`，把 AC-451 的 expect 拆成可运行的正臂/负臂。

### 检查器扫描面（实现时写成显式清单，测试断言清单至少覆盖这些）

- `index.html`（title、apple-mobile-web-app-title）
- `public/manifest.json`（`name`、`short_name`、`description`）
- `README.md` 的安装命令行（含 `npx @yalehwang/`、`npm install -g`、`npm update -g` 的行）
- `src/modules/i18n/locales/**/*.json` 的**值**（不扫描键，避免 locale key-set digest 红灯）
- `src/shared/utils.ts`、`src/modules/chat-session/utils/session/pageTitleNotification.ts`
- `src/modules/auth/AuthLoadingScreen.tsx`、`src/modules/auth/AuthScreenLayout.tsx`、`src/modules/oauth-consent/OAuthConsentRoute.tsx`、`src/modules/sidebar/SidebarFooter.tsx`、`src/modules/settings/tabs/AboutTab.tsx`、`src/modules/mcp/McpServers.tsx`
- `server/modules/cli/cli.service.ts`、`server/modules/cli/sandbox.service.ts`、`server/modules/system/system.service.ts`、`server/index.ts`
- `electron/main.js`、`electron/desktopWindow.js`、`electron/launcher/launcher.js`、`electron/localServer.js`、`electron/viewHost.js`

代码文件扫描时跳过注释行（`trimmed` 以 `//`、`/*`、`*`、`<!--` 开头），只查字符串/JSX 文案。⛔ **不要扫描** `electron/userDataMigration.js`：`'CloudCLI'` 在那里是旧 userData 目录名（AC-453 的迁移输入），不是产品名。

### allowlist 口径（写进检查器的规则表）

允许出现 `CloudCLI` 的位置只有：`LICENSE` / `NOTICE`；README 的 fork 归属 blockquote 与 About 的 `Based on CloudCLI UI` 归属句；外部服务文案（`CloudCLI Cloud`、`CloudCLI Pro`、`CloudCLI Hosted`、`CloudCLI API`、`cloudcli.ai`、第三方插件名如 `PRISM CloudCLI`）；上游包/镜像/URL（`@cloudcli-ai/`、`docker.io/cloudcliai/`、`siteboon/claudecodeui`、`github.com/cloudcli-ai/`）。其余产品面一律是 Cloudpit。`claudecodeui` 只允许出现在未改名的本地目录名与旧 URL 中。

⚠️ 新增文件里不要写出完整的上游包全名（scope 后接 `cloudcli` 的字面量）：`scripts/release/tests/fork-release-workflows.test.mjs` 扫描所有 tracked 文件，命中上游包全名即红；allowlist 规则写到 scope 级 `@cloudcli-ai/` 即可。

## Plan

1. 写 `scripts/brand-allowlist-check.mjs`：导出 `SCANNED_SURFACES`、`collectBrandSources({root, overrides})`、`findBrandViolations(sources)`、`checkDistributionIdentity(packageJson)`、`runBrandAllowlistCheck({root, overrides})`（返回 `{exitCode, violations}`），并提供 `main()` 供 `node scripts/brand-allowlist-check.mjs` 直接运行；用 JSDoc 类型，因为 `scripts/tsconfig.json` 以 `checkJs + strict` 检查全部 `**/*.mjs`。允许 allowlist 命中计数打印，禁止“一律放行”。
2. 写 `scripts/brand-allowlist-check.test.mjs`：真实扫描 + 各产品面正臂 + 分发身份臂 + tarball 臂 + allowlist 正臂 + 注入 false-form，全部走生产 `runBrandAllowlistCheck` 同一路径。
3. 翻可见面：先 `index.html` / `public/manifest.json` / `src/shared/utils.ts` / pageTitleNotification，再认证/侧边栏/About/MCP 组件，再 locale 值，再 CLI 与 Electron 文案。前端优先读 `BRAND.name`（`src/shared/constants.ts`），并把该常量“尚无消费方”的过期注释改掉。
4. 翻分发身份：`package.json`（name、bin、productName、build.productName、build.artifactName、author、keywords）、`package-lock.json` 根部 name、CLI 版本检查/自更新/全局升级命令、README 安装命令行、12 语言包 `npmUpgradeCommand`。
5. 同步 collateral pins：页面标题断言、加载文案断言、system 升级命令断言、`fork-release-workflows.test.mjs` 的 `FORK_NAME` 与注释；不要改 `appId` / protocols / 云端回调 / `~/.cloudcli`。
6. 全量自检：判据文件、相关单测、typecheck、lint、UI 浏览器实测。

## AC

- [x] AC1 判据文件真实通过：`npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs` 退出 0，输出含 `fail 0`；`scripts/brand-allowlist-check.mjs` 与 `scripts/brand-allowlist-check.test.mjs` 均已落地。
- [x] AC2 产品面正臂：同一判据断言 `index.html` 的 `<title>` 与 `apple-mobile-web-app-title`、`public/manifest.json` 的 `name`/`short_name`、`src/shared/utils.ts` 的 `DEFAULT_PAGE_TITLE`、CLI banner/help/status/update 文案、About 产品名、Electron `APP_NAME` 及其派生窗口/通知标题全部为 `Cloudpit`（是正向断言值等于 Cloudpit，不只断言“无 CloudCLI”）。
- [x] AC3 分发身份：同一判据断言 `package.json` 的 `name === '@yalehwang/cloudpit'`、`bin` 键集合为 `['cloudpit']`、`productName === 'Cloudpit'`、`build.productName === 'Cloudpit'`、`build.artifactName` 匹配 `^cloudpit-desktop-`；`package-lock.json` 根部 `name` 同步；`npmUpgradeCommand` 与 CLI 自更新命令均指向新包。
- [x] AC4 tarball 臂：同一判据用 `npm pack --ignore-scripts --pack-destination <tmp>` 打出真实 tarball，读回 `package/package.json` 断言 `bin` 只有 `cloudpit`；同一校验函数在喂入含 `cloudcli` bin 的合成打包清单时返回违规（负向控制）。
- [x] AC5 allowlist 正臂：真实扫描产品面零违规；把一条 `CloudCLI Cloud` 或 `Based on CloudCLI UI` 喂给同一扫描函数不产生违规（证明 allowlist 既不是“一律放行”也不是“一律拒绝”）；扫描面清单包含本任务 Proposal 列出的每个文件/glob。
- [x] AC6 false-form：把 `CloudCLI` 注入 manifest `name`、一条 locale 值、CLI banner 文本、Electron `APP_NAME` 任一面，同一 `runBrandAllowlistCheck` 必须返回 `exitCode === 1` 并点名该文件；判据文件内至少覆盖 manifest 与 CLI 两面。
- [x] AC7 回归与静态检查：`npx vitest run src/shared/tests/pageTitle.test.ts src/modules/project-workspace/tests/WorkspaceStateViewOverview.test.tsx src/modules/settings/tests/aboutTabCommunityLinks.test.tsx` 退出 0；`npx tsx --tsconfig server/tsconfig.json --test server/modules/system/tests/system.service.test.ts server/modules/cli/tests/cli.service.test.ts server/modules/cli/tests/sandbox.service.test.ts` 退出 0；`node --test scripts/release/tests/fork-release-workflows.test.mjs` 退出 0；`node scripts/list-script-tests.mjs | grep brand-allowlist` 有输出；`npm run typecheck` 与 `npm run lint` 退出 0。
- [ ] AC8 anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件（任务文件本身按 task_write 落点说明）。

## DoD

- 贴出 AC1 的完整 `tests` / `pass` / `fail` 行与退出码，不是只声称通过。
- 贴出检查器读数：扫描面文件数、locale 值数、`violations: []`、allowlist 命中样例（`CloudCLI Cloud` 与 `Based on CloudCLI UI` 不报红）。
- 贴出每条 false-form 的注入内容与违规消息，以及 `runBrandAllowlistCheck` 的 `exitCode: 1`（manifest、locale 值、CLI banner、Electron `APP_NAME` 至少各一条）。
- 贴出 `npm pack` 的 tarball 文件名、`tar -xOf <tarball> package/package.json` 的 `bin` 片段，以及合成 `cloudcli` bin 被拒的消息。
- 贴出 `package.json` 身份字段的 JSON 读数与 `package-lock.json` 根部 `name`。
- 贴出 `git grep -n 'CloudCLI'` 在本任务扫描面文件上的完整命中（每一条都应是 allowlist 类别；非 allowlist 命中即未完成），以及 locale 值的 `jq` 零命中读数。
- 真实运行 CLI 并贴 banner：`npx tsx --tsconfig server/tsconfig.json server/modules/cli/cli.ts help` 与 `… status` 的 Cloudpit 行。
- UI DoD（本项目 AGENTS.md 强制）：在真实运行页面上用 MCP 浏览器核对 `document.title`、`fetch('/manifest.json')` 的 `name`/`short_name`、Settings → About 产品名；截图存 `tmp/` 并在任务里贴出。当前没有品牌场景 JSON，若仓库存在可用场景则同时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 并贴 JSON 报告；否则在任务里写明“无覆盖品牌身份的可用场景，使用 MCP 浏览器实测”。
- 贴出 collateral pins 的 diff 与各自运行末行：`src/shared/tests/pageTitle.test.ts`、`src/modules/project-workspace/tests/WorkspaceStateViewOverview.test.tsx`、`server/modules/system/tests/system.service.test.ts`、`scripts/release/tests/fork-release-workflows.test.mjs`（`FORK_NAME` 与新注释）。
- 贴出 `npm run typecheck` 与 `npm run lint` 的退出码。
- anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。提交范围只含 Touches；不新增模块目录；不往 `server/shared/utils.ts` 加行；不改 `appId` / `protocols` / 云端回调 / 默认数据根。
- 不跑全量 suite（会话内 cgroup 8G 上限）；只跑上述有界文件，全量走 fan-in。

## Touches

- scripts/brand-allowlist-check.mjs (new, AC-451 检查器)
- scripts/brand-allowlist-check.test.mjs (new, AC-451 criterion)
- index.html
- public/manifest.json
- README.md (install command lines only)
- src/shared/constants.ts (BRAND 已被消费，更新过期注释)
- src/shared/utils.ts (DEFAULT_PAGE_TITLE)
- src/modules/chat-session/utils/session/pageTitleNotification.ts
- src/modules/auth/AuthLoadingScreen.tsx
- src/modules/auth/AuthScreenLayout.tsx
- src/modules/oauth-consent/OAuthConsentRoute.tsx (visible alt text)
- src/modules/sidebar/SidebarFooter.tsx
- src/modules/settings/tabs/AboutTab.tsx
- src/modules/mcp/McpServers.tsx (managed-server default copy)
- src/modules/i18n/locales/*/*.json (values only; 12 locales)
- server/modules/cli/cli.service.ts
- server/modules/cli/cli.module.ts (version check + self-update package)
- server/modules/cli/sandbox.service.ts (banner/install copy)
- server/modules/system/system.service.ts (upgrade command)
- server/index.ts (ready log)
- electron/main.js (APP_NAME + visible strings)
- electron/desktopWindow.js (menu/toolbar visible strings)
- electron/launcher/launcher.js (launcher visible strings)
- electron/localServer.js (Local CloudCLI labels/logs)
- electron/viewHost.js (placeholder copy)
- package.json
- package-lock.json (root name)
- src/shared/tests/pageTitle.test.ts (collateral: expected title strings)
- src/modules/project-workspace/tests/WorkspaceStateViewOverview.test.tsx (collateral: /Loading CloudCLI/ fixture)
- server/modules/system/tests/system.service.test.ts (collateral: upgrade command)
- scripts/release/tests/fork-release-workflows.test.mjs (collateral: FORK_NAME + comments)
- scripts/voice-capture-process-check.mjs (collateral: ready-log marker)
- server/modules/mcp-gateway/tests/oauth-flow.e2e.test.ts (collateral: ready-line fixture)
- tasks/gap-cloudpit-visible-identity-flip.md

## Evidence

- AC1：`npx tsx --tsconfig server/tsconfig.json --test scripts/brand-allowlist-check.test.mjs` → `tests 6 / suites 0 / pass 6 / fail 0 / cancelled 0 / skipped 0 / todo 0`，退出码 0。
- 检查器读数：`brand-allowlist: files=118 values=34623 localeValues=27324 allowlistHits=22 violations=0`，退出码 0。
- allowlist 正臂：`CloudCLI Cloud`、`Based on CloudCLI UI`、`PRISM CloudCLI` 零违规；`CloudCLI Cloud and CloudCLI` 只报 1 条（span 级判定）。
- false-form（同一 `runBrandAllowlistCheck`，均 `exitCode=1` 且点名文件）：
  - manifest `name` 注入 `CloudCLI` → `public/manifest.json:name carries "CloudCLI" outside the brand allowlist: CloudCLI`
  - locale `src/modules/i18n/locales/en/auth.json` 注入 `{footerText:"CloudCLI"}` → `src/modules/i18n/locales/en/auth.json:footerText carries "CloudCLI" outside the brand allowlist: CloudCLI`
  - CLI banner 注入 `export const banner = 'CloudCLI';` → `server/modules/cli/cli.service.ts:1 carries "CloudCLI" outside the brand allowlist: export const banner = 'CloudCLI';`
  - Electron `APP_NAME` 注入 `const APP_NAME = 'CloudCLI';` → `electron/main.js:1 carries "CloudCLI" outside the brand allowlist: const APP_NAME = 'CloudCLI';`
  - 检查器 CLI（`--overrides <json>`）对 manifest 注入同样 `status=1`，stderr 点名 `public/manifest.json`。
- tarball：`npm pack --ignore-scripts --json` → `yalehwang-cloudpit-1.41.0.tgz`；`tar -xOf … package/package.json` 的 `bin` 为 `{"cloudpit": "dist-server/server/modules/cli/cli.js"}`；合成 `{"cloudcli": …}` 被 `checkPackedManifest` 拒绝：`the packed manifest must expose exactly the "cloudpit" bin, found ["cloudcli"]`。
- 身份读数：`package.json` name=`@yalehwang/cloudpit`、bin keys=`["cloudpit"]`、productName=`Cloudpit`、build.productName=`Cloudpit`、build.artifactName=`cloudpit-desktop-${version}-${os}-${arch}.${ext}`；`package-lock.json` 根部 name=`@yalehwang/cloudpit`。
- 可见面 `git grep -n 'CloudCLI|claudecodeui'`（本任务扫描面）余量全部落在 allowlist：上游仓库/URL（`siteboon/claudecodeui`、`yaleh/claudecodeui`）、上游 scope（`@cloudcli-ai/`）、上游镜像（`docker.io/cloudcliai/`）、外部服务（`CloudCLI Pro/Hosted`）、第三方插件（`PRISM CloudCLI`、`CloudCLI Scheduler`）、本地缓存目录（`['.cache','claudecodeui']`）、About 版本检查标识（`useVersionCheck('siteboon','claudecodeui')`）；locale 的 `prismCloudCLI` 是键名、不在扫描范围，其值为 allowlist 的 `PRISM CloudCLI`。
- CLI：`npx tsx --tsconfig server/tsconfig.json server/modules/cli/cli.ts help` 打印 banner `Cloudpit - Command Line Tool`（退出 0）；`… status` 打印 `Cloudpit - Status`（退出 0）。
- UI DoD（本会话无 MCP 浏览器，使用一次性 Playwright 直连 worktree vite :5199，`/api` 代理运行中的 :3001）：`documentTitle=Cloudpit`、`manifest.name=Cloudpit`、`manifest.short_name=Cloudpit`、`manifest.description=Cloudpit web application`、Settings → About 产品名=`Cloudpit`、`pageErrors=[]`；截图 `tmp/brand-ui-dod/01-landing.png`、`tmp/brand-ui-dod/02-settings-about.png`，读数 `tmp/brand-ui-dod/report.json`。仓库无覆盖品牌身份的场景 JSON，故未运行 `scripts/ui-scenario.mjs`。
- collateral pins：`vitest run src/shared/tests/pageTitle.test.ts src/modules/project-workspace/tests/WorkspaceStateViewOverview.test.tsx src/modules/settings/tests/aboutTabCommunityLinks.test.tsx` → 3 files / 11 tests passed；`tsx --test server/modules/system/tests/system.service.test.ts server/modules/cli/tests/cli.service.test.ts server/modules/cli/tests/sandbox.service.test.ts` → 14 pass / 0 fail；`node --test scripts/release/tests/fork-release-workflows.test.mjs` → 7 pass / 0 fail；`node scripts/list-script-tests.mjs | grep brand-allowlist` → `scripts/brand-allowlist-check.test.mjs`。
- `npm run typecheck` 退出 0；`npm run lint` 退出 0。

该轴仍暗,理由:品牌迁移只替换可见文案与分发身份字段,AC 内没有可量化的 L_D/L_G 领域读数