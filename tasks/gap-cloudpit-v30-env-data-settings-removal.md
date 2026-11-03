---
id: gap-cloudpit-v30-env-data-settings-removal
title: Cloudpit v3.0：删除 env/数据根/settings 旧回退（保留一次性迁移与旧文件）
status: done
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

- [x] 环境变量读取只认 `CLOUDPIT_*`：`git grep -n 'process\.env\.CLOUDCLI_' -- server src electron`（非测试）零命中；`server/shared/brand.ts` 与 `electron/brandEnv.js` 的代码只构造 `CLOUDPIT_` 前缀（AST 判据）；旧名设置时读取结果为 absent/默认值，不再回退。树内其余 `CLOUDCLI_` 命中仅为注释/非环境标识符（如 `CLOUDCLI_CONTEXT_EVENT_KINDS`、`CLOUDCLI_SOURCE`、`CLOUDCLI_URI`、UI 常量）与 R4 附件双根（另立任务），不参与环境读取。
- [x] `resolveDataRoots` 不再接受 `defaultRoot:'legacy'`（该选项已从公开类型删除，传入被忽略），迁移失败路径返回显式错误/告警（`reason:'migration-failed'` + `migrationError`，`load-env.ts` `console.error`）且**不回退**旧根；`cloudpit-data-root.test.ts` 的 legacy 模式臂改为「已删除」，失败臂改为「失败即失败」；1.x 到 3.0 的一次性迁移夹具仍能完成迁移，旧根文件未被删除。
- [x] 设置读取只认新路径或显式 override；旧 `~/.config/claudecodeui/server.settings.json` 不再被读取（运行期改写旧文件不影响读数）；首次启动迁移夹具把旧文件复制到新路径，之后只读新路径；`settings-file.test.ts` 与 `cloudpit-runtime-flip.test.ts` AC4 更新。
- [x] 一次性迁移器保留且幂等：数据根与设置各有一个「旧→新」夹具，二次运行不重复写、不覆盖用户新文件；旧文件保留在盘上。
- [x] 测试与静态检查：更新 `server/shared/tests/cloudpit-brand-env.test.ts`、`cloudpit-data-root.test.ts`、`cloudpit-runtime-flip.test.ts`、`settings-file.test.ts`、`electron/tests/cloudpit-brand-env-wiring.test.mjs`；`npm run typecheck` 与 `npx oxlint` 对改动文件退出 0。
- [x] anti-drift：`git diff --name-only develop...HEAD` 只列出 `## Touches` 的文件。

## DoD

- 贴出两个 reader 的 diff 与 `git grep CLOUDCLI_` 零命中的完整读数。
- 贴出数据根 legacy/fallback 删除的 diff、失败臂读数、1.x→3.0 迁移夹具的两次运行读数与旧根文件清单。
- 贴出设置旧读删除的 diff、旧文件复制迁移夹具的两次运行读数、显式 override 仍生效的读数。
- 贴出相关测试的 `tests/pass/fail` 末行与 typecheck/oxlint 退出码。
- 不改 UI，不需要浏览器截图；若改了 UI 才按 AGENTS.md 补。

## DoD 证据（本次运行读数）

- 环境读取器：`server/shared/brand.ts` 与 `electron/brandEnv.js` 的代码只构造 `CLOUDPIT_<NAME>`（AST 字面量判据，注释不计）；`git grep -n 'process\.env\.CLOUDCLI_\|process\.env\[.CLOUDCLI_' -- server src electron`（非测试）→ **0 命中**。旧名-only 读数：`{CLOUDCLI_X:'old'}` ⇒ `{value:undefined,source:'absent',key:'CLOUDPIT_X'}`；`{CLOUDCLI_HOME:'…'}` 解析为默认 `~/.cloudpit`。`CLOUDCLI_` 的其余命中全部不是环境读取：注释、非环境标识符（`CLOUDCLI_CONTEXT_EVENT_KINDS`、`CLOUDCLI_SOURCE`、`CLOUDCLI_URI`、`CLOUDCLI_WORDMARK_FONT_FAMILY`、`CODEX_MCP_GATEWAY_TOKEN_ENV`、`WATCHER_MODE_ENV_VAR`、MCP scope 前缀）以及 R4 附件双根（`server/shared/image-attachments.ts`，明确不在本任务）。
- 数据根一次性迁移（1.x→3.0 夹具，两次运行）：
  `first.reason=default-migrated first.migrated=true activeRoot=.cloudpit`
  `second.reason=default-already-migrated second.migrated=false`
  `marker.exists=true`
  `newRoot.files=.migrated-from-cloudcli,auth.db,cockpit-card-feedback.json,reply-suggestions-usage.jsonl,voice-data/recording-1.wav`
  `legacyRoot.files.after=auth.db,cockpit-card-feedback.json,reply-suggestions-usage.jsonl,voice-data/recording-1.wav`
  `legacyRoot.settings.after=server.settings.json`
  `legacy.auth.bytes=legacy-sqlite-bytes`（旧根文件全部保留且字节不变；二次运行不重复写）。
- 数据根失败臂（SQLITE_BUSY）：`failure.reason=migration-failed failure.migrated=false failure.activeRoot=.cloudpit failure.migrationError=SQLITE_BUSY: database is locked failure.newRoot.exists=false legacy.unchanged=true`。`load-env.ts` 在 `migrationError!==null` 时 `console.error` 且继续使用 Cloudpit 根，不回退 `~/.cloudcli`；`resolveDataRoots` 已无 `defaultRoot:'legacy'` 选项（传入被忽略，测试仍得 `.cloudpit`）。
- 设置一次性迁移（两次运行 + 显式 override）：
  `first.reason=copied first.migrated=true`
  `second.reason=target-exists second.migrated=false`
  `target.after-second-run={"cockpit":{"sessionStart":{"model":"saved-after-migration"}}}`
  `target.mode=600`
  `legacy.retained=true legacy.content={"cockpit":{"sessionStart":{"model":"legacy-model"}}}`
  `override.path=true override.writePath=true override.explicit=true`
  旧 `~/.config/claudecodeui/server.settings.json` 不参与运行期读取：`cloudpit-runtime-flip.test.ts` AC4 在首次迁移后改写旧文件，`loadServerSettings` 读数仍来自新文件。
- 测试末行（单文件运行，均通过）：
  `cloudpit-brand-env.test.ts` tests 8 / pass 8 / fail 0
  `cloudpit-data-root.test.ts` tests 10 / pass 10 / fail 0
  `cloudpit-runtime-flip.test.ts` tests 10 / pass 10 / fail 0
  `settings-file.test.ts` tests 14 / pass 14 / fail 0
  `cloudpit-brand-env-wiring.test.mjs` tests 23 / pass 23 / fail 0
  `browser-use.service.test.ts` tests 6 / pass 6 / fail 0
  `browser-use-mcp-entry.test.ts` tests 4 / pass 4 / fail 0
  `server-installer-bundle-url.test.mjs` tests 5 / pass 5 / fail 0
  连带回归：`settings.service.test.ts` 7/7、`cockpit-session-start-settings.routes.test.ts` 6/6、`cockpit-session-start-model-selection.test.ts` 9/9、`resident-restore.service.test.ts` 5/5。
- 静态检查：`tsc --noEmit -p tsconfig.json` exit 0；`-p server/tsconfig.json` exit 0；`-p scripts/tsconfig.json` exit 0；`npx oxlint`（22 个改动文件）exit 0。
- anti-drift：`ANTI-DRIFT OK: task gap-cloudpit-v30-env-data-settings-removal — 22 actual file(s), all within declared Touches (23 glob(s))`（少的一个是 `tasks/<id>.md`，其 task_write 提交落在 develop）。
- 该轴仍暗,理由:本任务只删除运行时环境/数据根/设置回退并更新判据，未运行 L_D/L_G 探针，无量化读数可记。

## Touches

- server/shared/brand.ts
- electron/brandEnv.js
- electron/main.js
- electron/localServer.js
- electron/serverInstaller.js
- server/modules/browser-use/browser-use.service.ts
- server/modules/browser-use/tests/browser-use.service.test.ts
- server/modules/cli/browser-use-mcp.ts
- server/modules/cli/tests/browser-use-mcp-entry.test.ts
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
- scripts/release/tests/server-installer-bundle-url.test.mjs
- tasks/gap-cloudpit-v30-env-data-settings-removal.md
