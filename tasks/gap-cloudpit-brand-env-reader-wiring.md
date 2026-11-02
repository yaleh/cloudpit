---
id: gap-cloudpit-brand-env-reader-wiring
title: Cloudpit R1 接线：createBrandEnvReader 接到
  Electron/browser-use/serverInstaller 生产读取点
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

P3 退场计划 R1 的前置接线任务。现状（2026-11-02 实测）：`createBrandEnvReader` 只有测试消费方，生产读取点仍直读 `CLOUDCLI_*`，所以 2.0 的「`CLOUDPIT_*` 优先」在这些位置并未生效。

需要接线的生产读取点（逐文件）：

- `electron/main.js:22` `CLOUDCLI_CONTROL_PLANE_URL`（默认仍 `https://cloudcli.ai`，不改）
- `electron/localServer.js:24-30` 的 URL/端口 env 键列表，`:391` `CLOUDCLI_USE_INSTALLED_SERVER`
- `electron/serverInstaller.js:88-103` `CLOUDCLI_SERVER_BUNDLE_URL` / `_RELEASE_TAG` / `_SERVER_DIR`
- `server/modules/browser-use/browser-use.service.ts:23-24,359` 的 `CLOUDCLI_BROWSER_USE_*` 读取；`:551-552` 是给子进程的**写入**，应改为写新名（旧名别名可保留一个过渡版本）
- `server/modules/cli/browser-use-mcp.ts:45-47` 的 `CLOUDCLI_BROWSER_USE_API_URL` / `_MCP_TOKEN` / `_API_TIMEOUT_MS`

实现方式：Electron 运行时不能直接 import `server/shared/brand.ts`（TS，且桌面跑源码），因此新增一个小的 `electron/brandEnv.js`，语义与 `server/shared/brand.ts` 的 `createBrandEnvReader` 一致（`CLOUDPIT_*` 优先、`CLOUDCLI_*` 回退、空串视为未设置、每个 reader 对每个旧 key 只警告一次）。**必须有一条跨运行时 parity 测试**，用同一张三臂表同时驱动 server 实现与 electron 实现，防止两份语义漂移。

保留项：`cloudcli.ai` 控制平面、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop` 是第三方契约，不因本任务改名；`CLOUDCLI_SERVER_BUNDLE_URL` 等旧名仍作为回退可读。

## AC

- [ ] `git grep -n 'process\.env\.CLOUDCLI_' -- server src electron`（排除测试）只剩 `server/shared/brand.ts`、新增的 `electron/brandEnv.js` 与明确的旧名回退常量表；上述业务读取点不再直接读旧名。
- [ ] `electron/brandEnv.js` 与 `server/shared/brand.ts` 的 parity 测试通过：同一组环境（只旧、只新、两者、都空、新为空串）两边返回相同的 `{value, source}`，且旧名警告次数相同。
- [ ] 新名生效：在 Electron/browser-use/serverInstaller 三个面上分别只设 `CLOUDPIT_*`，读取值等于新值；只设旧名时读取值等于旧值且产生一次 deprecation 日志；两者同时设置时新名胜出。
- [ ] 默认值不变：未设置任何品牌 env 时，控制平面仍是 `https://cloudcli.ai`、browser-use 默认仍是 3 sessions / 30min TTL / 10min install timeout / 60s API timeout、serverInstaller 仍用现有默认 bundle 基址与 tag。
- [ ] 子进程 env 写入（`browser-use.service.ts`）改为新名，并保留旧名别名一个过渡版本；`browser-use-mcp.ts` 能同时读取新旧名。
- [ ] 测试与静态检查：扩展 `server/shared/tests/cloudpit-brand-env.test.ts`、`server/modules/browser-use/tests/browser-use.service.test.ts`、`server/modules/cli/tests/browser-use-mcp-entry.test.ts`；新增 `electron/tests/cloudpit-brand-env-wiring.test.mjs`；`npm run typecheck`、`npx oxlint` 对改动文件退出 0。
- [ ] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出六个接线点的改动前后行，以及 `git grep 'process.env.CLOUDCLI_'` 的完整结果，证明业务读取点已收口。
- 贴出 parity 测试的 `tests/pass/fail` 行与三臂表；贴出「只旧名警告一次」的计数读数。
- 贴出未设置 env 时五个默认值的实读（控制平面 URL、3/30min/10min/60s）。
- 贴出 `npm run typecheck`、`npx oxlint` 的退出码。
- 不改 UI，不需要浏览器截图；若改了 Electron 可见文案才按 AGENTS.md 补。

## Touches

- electron/brandEnv.js (new)
- electron/main.js
- electron/localServer.js
- electron/serverInstaller.js
- server/modules/browser-use/browser-use.service.ts
- server/modules/cli/browser-use-mcp.ts
- server/shared/brand.ts
- server/shared/tests/cloudpit-brand-env.test.ts
- server/modules/browser-use/tests/browser-use.service.test.ts
- server/modules/cli/tests/browser-use-mcp-entry.test.ts
- electron/tests/cloudpit-brand-env-wiring.test.mjs (new)
- tasks/gap-cloudpit-brand-env-reader-wiring.md
