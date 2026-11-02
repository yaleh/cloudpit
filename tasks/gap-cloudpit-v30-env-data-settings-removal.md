---
id: gap-cloudpit-v30-env-data-settings-removal
title: Cloudpit v3.0：删除 env/数据根/settings 旧回退（保留一次性迁移与旧文件）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

P3 退场计划的 v3.0 第一批：删除 R1–R3 的**运行时回退**，保留一次性迁移器。R1 接线任务已完成（`createBrandEnvReader` 已接到 Electron/browser-use/serverInstaller），旧名回退现在真正生效，因此可以进入删除。

范围：

1. **R1 环境变量**：`server/shared/brand.ts` 与 `electron/brandEnv.js` 只读 `CLOUDPIT_*`；删除 `CLOUDCLI_*` 回退与 deprecation 警告。所有生产读取点已走 reader，不新增读取点。
2. **R2 数据根**：`server/shared/data-root.ts` 删除 `defaultRoot:'legacy'` 与「迁移失败回退旧根」的运行时兼容；保留一次性迁移（直接升级到 3.0 的机器仍把 `~/.cloudcli` 快照到 `~/.cloudpit`），旧根文件永不删除。`data-root-migration.ts` 保留迁移实现，但失败必须显式报错，不再回退。
3. **R3 设置**：`server/shared/settings-file.ts` 与 `server/modules/settings/*` 删除「新文件缺失时读旧文件」；保留首次启动把旧文件复制到新路径的一次性迁移。显式 `SERVER_SETTINGS_PATH` / `settingsPath` 行为不变。

明确不在本任务：R4 附件双根（依赖 `migrate-assets --rewrite`，另立任务）；R5–R12 身份契约（下一任务）；R13 appId（再下一任务）。历史账本、NOTICE/LICENSE 不改。

## AC

- [ ] `git grep -n 'CLOUDCLI_' -- server src electron`（非测试、非历史文档）零命中；`server/shared/brand.ts` 与 `electron/brandEnv.js` 只有 `CLOUDPIT_` 前缀；旧名设置时读取结果为 absent/默认值，不再回退。
- [ ] `resolveDataRoots` 不再接受 `defaultRoot:'legacy'`，迁移失败路径返回显式错误/告警且**不回退**旧根；`cloudpit-data-root.test.ts` 的 legacy 模式臂改为「已删除」，失败臂改为「失败即失败」；1.x 到 3.0 的一次性迁移夹具仍能完成迁移，旧根文件未被删除。
- [ ] 设置读取只认新路径或显式 override；旧 `~/.config/claudecodeui/server.settings.json` 不再被读取；首次启动迁移夹具把旧文件复制到新路径，之后只读新路径；`settings-file.test.ts` 与 `cloudpit-runtime-flip.test.ts` AC4 更新。
- [ ] 一次性迁移器保留且幂等：数据根与设置各有一个「旧→新」夹具，二次运行不重复写、不覆盖用户新文件；旧文件保留在盘上。
- [ ] 测试与静态检查：更新 `server/shared/tests/cloudpit-brand-env.test.ts`、`cloudpit-data-root.test.ts`、`cloudpit-runtime-flip.test.ts`、`settings-file.test.ts`、`electron/tests/cloudpit-brand-env-wiring.test.mjs`；`npm run typecheck` 与 `npx oxlint` 对改动文件退出 0。
- [ ] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出两个 reader 的 diff 与 `git grep CLOUDCLI_` 零命中的完整读数。
- 贴出数据根 legacy/fallback 删除的 diff、失败臂读数、1.x→3.0 迁移夹具的两次运行读数与旧根文件清单。
- 贴出设置旧读删除的 diff、旧文件复制迁移夹具的两次运行读数、显式 override 仍生效的读数。
- 贴出相关测试的 `tests/pass/fail` 末行与 typecheck/oxlint 退出码。
- 不改 UI，不需要浏览器截图；若改了 UI 才按 AGENTS.md 补。

## Touches

- server/shared/brand.ts
- electron/brandEnv.js
- electron/main.js
- electron/localServer.js
- electron/serverInstaller.js
- server/modules/browser-use/browser-use.service.ts
- server/modules/cli/browser-use-mcp.ts
- server/shared/data-root.ts
- server/shared/data-root-migration.ts
- server/load-env.ts
- server/modules/cli/cli.module.ts
- server/shared/settings-file.ts
- server/modules/settings/server-settings-file.ts
- server/modules/settings/server-settings.ts
- server/shared/tests/cloudpit-brand-env.test.ts
- server/shared/tests/cloudpit-data-root.test.ts
- server/shared/tests/cloudpit-runtime-flip.test.ts
- server/shared/tests/settings-file.test.ts
- electron/tests/cloudpit-brand-env-wiring.test.mjs
- tasks/gap-cloudpit-v30-env-data-settings-removal.md
