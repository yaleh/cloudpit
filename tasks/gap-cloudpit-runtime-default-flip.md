---
id: gap-cloudpit-runtime-default-flip
title: Cloudpit B2：运行时默认值翻转与兼容（默认 ~/.cloudpit、settings/附件新路径、协议/scope/MCP/SW 双接受）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-452
---
## Proposal

AC-452 的缺口承载任务：把 Cloudpit 的**运行时默认值**从 GOAL-053 的暗管道（默认仍 `~/.cloudcli`、写入仍旧根、helper 未接线）翻到「默认新根 + 旧布局自动迁移 + 旧值永远可读」，并一次落齐 AC-452 expect 的七个运行时面：数据根 / settings / 附件 / 协议与观测 URI / MCP 名 / OAuth scope / SW 缓存。AC-452 的判据文件就是本任务新增的 `server/shared/tests/cloudpit-runtime-flip.test.ts`；执行结束时 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-runtime-flip.test.ts` 必须真实退出 0。

现状（2026-10-31 逐文件复核，非推断）：

- `server/shared/data-root.ts` 的 `resolveDataRoots` 只在显式 `CLOUDPIT_HOME` / `CLOUDCLI_HOME` 时迁移；无环境变量时返回 `.cloudcli`（`default-legacy`）。模块注释明写「deliberately unwired；GOAL-054 接线」。
- `server/load-env.ts:53` 的 `DEFAULT_DATABASE_PATH` 仍是 `~/.cloudcli/auth.db`；`server/modules/cli/cli.module.ts:65` 同。
- `server/shared/image-attachments.ts` 的 `getImageAssetsRoots().writeRoot` 在无显式根时仍是 legacy；`readRoots` 已是 `[new, legacy]`。
- `server/shared/settings-file.ts:108` 与 `server/modules/settings/server-settings-file.ts:53` 的默认设置路径仍是 `~/.config/claudecodeui/server.settings.json`。
- `package.json` 的 `build.protocols` 只有 `cloudcli`；`electron/main.js` 只 `setAsDefaultProtocolClient('cloudcli')`。
- 观测 URI 两侧语法（`server/modules/observation/observation-uri.ts`、`src/modules/cockpit-contract/observationUri.ts`）只接受 `cloudcli://`。
- `server/modules/browser-use/browser-use.service.ts:84-85` 仍写 `cloudcli-browser`，legacy 名单只有 `cloudcli-browser-use`。
- OAuth 元数据 `buildAuthorizationServerMetadata` 没有 `scopes_supported`；`ACCESS_TOKEN_SCOPES` 只有 8 个 `cloudcli:*`。
- `public/sw.js:4-6` 的 `CACHE_PREFIX` / `CACHE_NAME` 仍是 `claude-ui-` / `claude-ui-v3`，activate 只清 `CACHE_PREFIX`。

边界（避免与兄弟任务撞机制）：

- `gap-cloudpit-visible-identity-flip`（AC-451，todo）负责产品名/文案/语言包/package 的 name/bin/productName/artifactName/CLI banner/品牌 allowlist；其任务体明确把运行时默认值（数据根、settings、附件、协议/scope/MCP/SW）留给 AC-452。
- AC-453（桌面身份：userData 三 JSON、server 缓存、local-server marker、appId）由后续任务承载；本任务只改 `package.json` 的协议声明与 `electron/main.js` 的协议注册行，不动 `APP_NAME` / userData / marker / appId。
- 观测 URI 2.0 仍**写旧值**（formatter 不变），只做双读；这是 SPEC §5.2 的明确顺序。
- 不翻 `browser-use` 的浏览器 profile 根（`~/.cloudcli/browser-use/profiles` 不在 AC-452 expect、且迁移会丢登录态），只改同文件的 MCP 名。

<!-- dedup-ref -->机制去重：`grep -rl '^goal_ac: *AC-452' tasks/` 为空；`task-granularity-advice` 对本任务 Touches 返回的 open peers 只有 `gap-cloudpit-visible-identity-flip`（共享 `package.json` / `electron/main.js` / `server/index.ts` / `server/modules/cli/cli.module.ts` 的不同机制与不同行）与 `gap-codex-resident-blocked-context-events`（只共享通用 `server/index.ts`）。判定 **separate**：独立验收，调度器按 Touches 串行。

## Plan

1. 数据根翻转（`server/shared/data-root.ts`）：给 `ResolveDataRootsOptions` 加 `defaultRoot?: 'legacy' | 'cloudpit'`，缺省仍是 `'legacy'`，保证 AC-449 的 `cloudpit-data-root.test.ts` 逐字不变。`'cloudpit'` 且无显式 env 时：activeRoot=`<home>/.cloudpit`；新根有 `.migrated-from-cloudcli` → `default-already-migrated`；新根存在且非空无标记 → `default-user-root`（不覆盖）；旧根存在 → 复用 `migrateLegacyDataRoot` 后 `default-migrated`；旧根不存在 → `default-cloudpit`；迁移抛错 → activeRoot 回退 `<home>/.cloudcli`、`fallback-after-failure`，不创建半套新根。该模式的 settingsPath 为 `<home>/.config/cloudpit/server.settings.json`，legacySettingsPath 仍指旧配置。
2. 启动期接线（`server/load-env.ts`）：在 `.env` 读入之后、其它模块求值之前调用 `resolveDataRoots({defaultRoot:'cloudpit'})`，仅当 `process.env.DATABASE_PATH` 未设置时写入解析出的 `authDatabasePath`；导出该解析结果供 `server/index.ts` 复用，避免二次迁移。该文件既有约束是不能 import `shared/utils`（会在 `.env` 之前读环境）；若 `data-root-migration.ts` 顶层 `import Database from 'better-sqlite3'` 让 bootstrap 过重，就把默认 backup 实现改成 `createRequire` 惰性加载，函数签名不变。`server/modules/cli/cli.module.ts:65` 的 `defaultDatabasePath` 改由同一解析器派生。
3. 其余默认路径同批翻到 activeRoot：`server/index.ts` 的 cockpit-card-feedback 默认路径、`server/modules/reply-suggestions/reply-suggestions-usage-log.ts:204`、`server/modules/observation/view-events.service.ts:81`，以及 `server/modules/voice/voice-data.ts`、`voice-capture.ts`、`voice-realtime/voice-realtime-audio-capture.ts`、`voice-realtime-log.ts` 的 `DEFAULT_DATABASE_FILE`（改为 `.cloudpit/auth.db`，旧文件只读回退）。这些都从同一个 `ResolvedDataRoots` 读取，禁止各写一份 `.cloudpit` 字面量。
4. 设置路径（`server/shared/settings-file.ts`、`server/modules/settings/server-settings-file.ts`、`server/modules/settings/server-settings.ts`）：默认路径改 `<home>/.config/cloudpit/server.settings.json`；读取顺序「显式 override > SERVER_SETTINGS_PATH > 新默认（存在时）> 旧默认（回退）」；写入目标恒为新默认路径，绝不因读取回退而写回旧文件。两处 `defaultServerSettingsPath` 收敛成一个来源（shared 版），另一处转 re-export，并给解析函数加可注入的 `exists`/`homeDir` 供判据离开真实 HOME。显式命名但不存在的文件仍按现状报 problem。
5. 附件翻转（`server/shared/image-attachments.ts` + `server/modules/assets/services/image-assets.service.ts`）：无显式根时 `writeRoot` 改为 `newRoot`（`<home>/.cloudpit/assets`），`readRoots` 保持 `[new, legacy]` 且去重；`resolveImageAssetFile` 的旧单参调用可保留旧根语义，但 `openStoredAttachmentAsset` / `filterAttachmentsToUploadStore` 走双读。旧根「不搬、不删、永久可读」。
6. 协议注册（`package.json` + `electron/main.js`）：`build.protocols` 增 `{name:'Cloudpit', schemes:['cloudpit']}` 并保留 CloudCLI/cloudcli；mac `CFBundleURLSchemes` 同时列两个；`electron/main.js` 对 `cloudcli` 与 `cloudpit` 都调用 `setAsDefaultProtocolClient`（packaged 与 dev 两分支）。云端登录仍是 `cloudcli://auth/callback`、`app_surface=cloudcli_desktop` 不动。
7. 观测 URI 双读（`server/modules/observation/observation-uri.ts`、`src/modules/cockpit-contract/observationUri.ts`、`server/modules/observation/observation-store.ts`）：解析正则接受 `cloudcli://` 与 `cloudpit://`，两种拼写都归一到**旧** canonical 字符串（parsed.scheme 仍 `'cloudcli'`，DB join 不变）；`formatSessionUri` / `formatArchitectureUri` 2.0 仍产出 `cloudcli://`；`observation-store` 的 INVALID_URI 文案同步。两处语法必须同形（仓库禁止 server 跨看 src，判据用源码读取比对）。
8. MCP 名（`server/modules/browser-use/browser-use.service.ts`、`server/modules/cli/browser-use-mcp.ts`）：`MCP_SERVER_NAME='cloudpit-browser'`，`LEGACY_MCP_SERVER_NAMES=['cloudcli-browser','cloudcli-browser-use']`；注册/写出只用新名，清理遍历 `[新名, ...legacy]`；MCP entry 的 `serverInfo.name` 同步新名。
9. OAuth scope 双接受（`server/shared/mcp-contract/types.ts`、`server/modules/oauth/access-tokens.service.ts`、`server/modules/oauth/oauth-consent.service.ts`、`server/modules/mcp-gateway/oauth-metadata.gate.ts`、`server/modules/mcp-gateway/mcp-gateway.auth.ts`）：新增八个 `cloudpit:*` 拼写与 new→old 的 alias 表 + `canonicalScope()`；`ACCESS_TOKEN_SCOPES` 数组内容保持 8 个旧值不动（精确词表钉子不变）。`normalizeAccessTokenScopes` 接受两套拼写、按 canonical 去重、按请求拼写保存（请求新名就写新名）。`resolvePrincipal` 对 PAT 与 OAuth 两条分支都 `map(canonicalScope)`，使后续 `requiredScopes` 的旧字面量同时认新 token。consent 的 read-scope 比较、描述与风险查表都先 canonical 化。AS metadata 增 `scopes_supported` = 8 新 + 8 旧。旧 token 不迁移、不失效。
10. SW（`public/sw.js`）：`CACHE_PREFIX='cloudpit-'`、`CACHE_NAME='cloudpit-v1'`，新增 `LEGACY_CACHE_PREFIX='claude-ui-'`；activate 的 filter 改为「命中任一前缀且不是 CACHE_NAME」，仍保留 `voice-client-asr-model-v1` 等无关缓存。
11. 判据与钉子：写 `server/shared/tests/cloudpit-runtime-flip.test.ts`，用注入的 `homeDir`/`env`/`fs`/`backupDatabase` 覆盖步骤 1、4、5、7、8、9、10 的正臂与假形态；用 `node:vm` 跑 `public/sw.js` 的 activate 检查删除集合；静态读取 `package.json` / `electron/main.js` / `server/load-env.ts` 断协议注册与启动接线。新增一个 server 测试文件会把 `quay-test-script.test.ts` 的收集数从当前 490 推到 491（实现时以实际收集数为准），同步 `known=3 unknown=<N-3>` 与 `known=1 unknown=<N-1>` 两处钉子并补注释；给 `scripts/suite-duration-baseline.tsv` 追加本文件实测时长行（否则 AC7 的 90% 覆盖率地板被压破）。
12. 同步被默认值改红的兄弟夹具：`server/shared/tests/settings-file.test.ts`、`server/modules/assets/tests/cloudpit-assets-dual-root.test.ts`、`server/shared/tests/image-attachments.test.ts`、`server/modules/cli/tests/browser-use-mcp-entry.test.ts`、`server/modules/mcp-gateway/tests/oauth-metadata-mount.test.ts`、`server/modules/observation/tests/observation-store.test.ts`、`src/modules/cockpit/tests/observationUri.test.ts`。改期望值，不放宽断言；每个翻转点保留一条「旧值仍可读 / 仍被接受」的对偶臂。

## AC

- [ ] AC1 判据文件真实通过：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/cloudpit-runtime-flip.test.ts` 退出 0，输出含 `fail 0`；文件已落地。
- [ ] AC2 数据根默认翻转：同一判据以 `env={}`、注入 tmp `homeDir` 与最小 `backupDatabase` 调 `resolveDataRoots({defaultRoot:'cloudpit', ...})`，断言 `activeRoot === <tmp>/.cloudpit`、旧布局被迁移（DB 目标存在、`.migrated-from-cloudcli` 只在成功后写入、`reason === 'default-migrated'`）；迁移抛错臂断言 `activeRoot === <tmp>/.cloudcli` 且新根无半成品；`defaultRoot:'legacy'` 臂仍返回 `.cloudcli`（负控证明翻转由模式驱动，不是删掉旧模式）。
- [ ] AC3 启动接线：同一判据读取 `server/load-env.ts` 与 `server/modules/cli/cli.module.ts` 源码，断言二者都从 `resolveDataRoots` 派生默认库路径、且两文件里不再有 `path.join(os.homedir(), '.cloudcli', 'auth.db')` / `path.join(homeDirectory, '.cloudcli', 'auth.db')` 的生产默认；`server/index.ts` 仍以 `import './load-env.js'` 首位求值。
- [ ] AC4 设置写新路径且旧文件仍生效：同一判据断言 `defaultServerSettingsPath(<tmp>)` = `<tmp>/.config/cloudpit/server.settings.json`；只有旧 `claudecodeui/server.settings.json` 时 boot 读取采用其值且 `problems` 为空；保存目标为新路径；显式 `SERVER_SETTINGS_PATH` / `settingsPath` 行为不变。
- [ ] AC5 附件新写旧读：同一判据断言无显式 env 时 `getImageAssetsWriteDir({homeDir})` = `<home>/.cloudpit/assets`、`getImageAssetsReadDirs` 以新根打头并仍含旧根；旧根里的文件经 `findStoredAttachmentAsset` 仍解析到旧绝对路径；把旧根移走后该臂必须失败（负控证明测试真在读旧根）。
- [ ] AC6 协议与观测 URI：同一判据断言 `package.json` 的 `build.protocols` 同时含 `cloudcli` 与 `cloudpit`、mac `CFBundleURLSchemes` 同；`electron/main.js` 对两个 scheme 都注册；`parseObservationUri('cloudpit://session/x')` 与 `'cloudcli://session/x'` 返回同一 canonical 旧 URI，`formatSessionUri` 仍产出旧协议；两侧语法同形（源码读取比对）。
- [ ] AC7 MCP 双接受：同一判据断言注册写入名 `cloudpit-browser`、legacy 名单含 `cloudcli-browser` 与 `cloudcli-browser-use`、清理遍历「新 + 全部 legacy」；`browser-use-mcp` 的 initialize `serverInfo.name` 为新名；一个不在名单里的名字不触发清理（负控）。
- [ ] AC8 OAuth scope：同一判据断言 AS metadata 的 `scopes_supported` 同时含 8 个 `cloudcli:*` 与 8 个 `cloudpit:*`；`normalizeAccessTokenScopes` 接受两套拼写且按 canonical 去重；既有旧 scope token 的 principal 仍满足 `requiredScopes: ['cloudcli:read']`，新 scope token 同样满足；未知 scope 仍被拒（负控）。
- [ ] AC9 SW 双前缀清理：同一判据在 `node:vm` 里以假 `caches` 注册 `cloudpit-v1`、`cloudpit-old`、`claude-ui-v3`、`claude-ui-legacy`、`voice-client-asr-model-v1`、`other`，触发 activate 后断言删除集合恰为 `cloudpit-old`、`claude-ui-v3`、`claude-ui-legacy`，保留 `cloudpit-v1`、`voice-client-asr-model-v1`、`other`。
- [ ] AC10 钉子与静态检查：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0 且两处 `known=/unknown=` 已按新收集数更新；`scripts/suite-duration-baseline.tsv` 含本判据文件行；`npm run typecheck` 与 `npx oxlint` 对全部改动文件退出 0。
- [ ] AC11 每个翻转点都有旧值对偶臂：同一次判据运行里，`defaultRoot:'legacy'` 返回旧根、旧 settings 文件生效、旧附件根可读、旧 scope token 可判、旧 MCP 名在 legacy 清理名单——五臂全部通过，证明新默认没有删掉兼容面。

## DoD

- 真跑判据并贴末行 `tests N / pass N / fail 0` 与耗时；同时贴出 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 的 `known=/unknown=` 行。
- 逐条贴读数：AC2 的 `reason` / `activeRoot` / 标记路径，AC4 的新默认与旧文件回退读取值，AC5 的 writeRoot / readRoots / 旧附件解析路径，AC6 的 protocols 与两种 URI 的 parse 结果，AC7 的注册名 / legacy 列表 / 清理遍历，AC8 的 `scopes_supported` 全表与两种 token 的 scope 判定，AC9 的删除集合与保留集合（逐名字列出）。
- 贴假形态负控实测：把新根默认改回旧根 ⇒ AC2/AC5 红；从 protocols 删掉 `cloudpit` ⇒ AC6 红；legacy SW 前缀从 filter 拿掉 ⇒ AC9 红；旧 scope 从接受表拿掉 ⇒ 旧 token 判定红。各贴红/绿两次读数，不用「应该会红」代替。
- 贴 `scripts/suite-duration-baseline.tsv` 追加行 diff 与 `server/shared/tests/quay-test-script.test.ts` 钉子 diff；贴 `npm run typecheck`、`npx oxlint <改动文件>` 退出码。
- 合入前把 develop merge 进本任务 worktree 并复跑判据（合并冲突按并集处理，不改判据语义）；不在会话内跑全量 suite（按 AGENTS.md 的 runner 规则只跑相关文件）。
- 本任务不动 UI，不需要 MCP 浏览器截图；若实现过程中改了任何 `src/` 可见组件，则按项目 DoD 补浏览器实测与截图。

## Touches

- tasks/gap-cloudpit-runtime-default-flip.md
- server/shared/tests/cloudpit-runtime-flip.test.ts (new, AC-452 criterion)
- server/shared/data-root.ts
- server/shared/data-root-migration.ts (lazy better-sqlite3 seam for bootstrap)
- server/shared/settings-file.ts
- server/shared/image-attachments.ts
- server/modules/settings/server-settings-file.ts
- server/modules/settings/server-settings.ts
- server/load-env.ts
- server/index.ts
- server/modules/cli/cli.module.ts
- server/modules/assets/services/image-assets.service.ts
- server/modules/reply-suggestions/reply-suggestions-usage-log.ts
- server/modules/observation/view-events.service.ts
- server/modules/observation/observation-uri.ts
- server/modules/observation/observation-store.ts
- src/modules/cockpit-contract/observationUri.ts
- server/modules/cli/browser-use-mcp.ts
- server/modules/browser-use/browser-use.service.ts
- server/shared/mcp-contract/types.ts
- server/modules/oauth/access-tokens.service.ts
- server/modules/oauth/oauth-consent.service.ts
- server/modules/mcp-gateway/oauth-metadata.gate.ts
- server/modules/mcp-gateway/mcp-gateway.auth.ts
- public/sw.js
- package.json (protocol declarations only)
- electron/main.js (protocol registration only)
- server/modules/voice/voice-data.ts
- server/modules/voice/voice-capture.ts
- server/modules/voice-realtime/voice-realtime-audio-capture.ts
- server/modules/voice-realtime/voice-realtime-log.ts
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- server/shared/tests/settings-file.test.ts
- server/modules/assets/tests/cloudpit-assets-dual-root.test.ts
- server/shared/tests/image-attachments.test.ts
- server/modules/cli/tests/browser-use-mcp-entry.test.ts
- server/modules/mcp-gateway/tests/oauth-metadata-mount.test.ts
- server/modules/observation/tests/observation-store.test.ts
- src/modules/cockpit/tests/observationUri.test.ts
