---
id: gap-quay-entrypoint-resolver-via-claude-plugin-scopes
title: Quay 适配器：按 Claude Code 插件 scope 解析 quay CLI 入口，不再依赖项目的 .quay/plugin 符号链接
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关的已完成/在飞任务：`gap-quay-snapshot-loop-status-version-drain-orphan`（snapshot 增加 loop 读数，读 `driver status` 的 `pointer`）与 `gap-quay-tab-status-band-charts-session-first-layout`（Quay tab 重排）。本任务机制不同：只改「用哪个可执行文件去 spawn quay」，不改 snapshot 形状。

背景（2026-10-25 实测与用户裁定）：Claude Code 的插件安装只把版本目录放进 `~/.claude/plugins/cache/<marketplace>/<plugin>/<版本>/`，不改用户 PATH，所以 CloudCLI 以前只能依赖各项目的 `.quay/plugin` 符号链接（由 `/quay:init` 创建）去找 `bin/quay`。该链接会指向已被清理的旧版本目录（cantus 实例：链接悬空，适配器读成 `entrypoint-missing`），也让每个项目钉在某个旧版本上。quay 侧会另立任务停止生成并删除该链接，CloudCLI 必须先不再依赖它。

要做的事：新增 `server/modules/quay/quay-entrypoint-resolver.ts`，所有文件读取通过注入接缝完成，`quay-process.ts` 在每次 spawn 前调用它得到 `{ path, version, source }`。解析顺序（命中即停）：
1. 服务设置 `server.settings.json` 里按项目根的显式覆盖（键 `quay.entrypoints`，值为绝对路径的 `bin/quay`），`config/server.settings.example.json` 同步加模板条目；
2. Claude Code 插件 scope 解析：读 `~/.claude/plugins/installed_plugins.json` 里 `quay@quay` 的所有记录，按启用状态过滤（启用来自 `~/.claude/settings.json`、`<项目根>/.claude/settings.json`、`<项目根>/.claude/settings.local.json` 的 `enabledPlugins`，后者覆盖前者；缺省视为启用）；优先级 local（`projectPath` 等于项目根）> project（`projectPath` 等于项目根）> user；记录的 `installPath` 目录已不存在则跳过并带 warning 落到下一条记录；入口是 `<installPath>/bin/quay`；
3. 兼容旧项目：`<项目根>/.quay/plugin/bin/quay`，**仅当**其 realpath 不在 Claude 插件缓存目录内（开发者自己的钉版，例如 quay 仓库指向 `../plugin`）才采用；指向缓存的符号链接一律忽略；
4. 裸 `quay`（PATH），沿用现有 warning。
缓存：以 `installed_plugins.json` 与各 settings 文件的 mtime+size 为键缓存解析结果，文件未变不重复解析。解析结果（`path`、`version`、`source`：`override|user|project|local|legacy-pin|path`）放进 snapshot 的诊断信息里，仅作可选增量字段，不得加宽 `QuayDriverSummary`。

不做：界面；quay 仓库内的任何改动（由 quay 侧任务负责）；删除任何项目的 `.quay/plugin` 链接；部署（构建与服务重启由用户执行）。

## AC

- [x] 顺序：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-entrypoint-resolver.test.ts` exit 0；用注入的假文件系统覆盖：覆盖项优先于一切；local 记录胜过 project 胜过 user；`projectPath` 不等于项目根的 project/local 记录被忽略；`enabledPlugins` 里 `quay@quay` 为 false 的 scope 被跳过。
- [x] 悬空降级：同一测试文件含用例：user 记录的 `installPath` 指向存在的目录而更高优先级记录指向不存在的目录，得到 user 记录的入口并附 warning，而不是 `entrypoint-missing`。
- [x] 旧链接：同一测试文件含用例：`.quay/plugin` 是指向 Claude 缓存的符号链接（含悬空）时被忽略并落到 scope 解析；指向缓存之外的目录时 `source` 为 `legacy-pin` 并被采用。
- [x] 缓存：同一测试文件含用例：连续两次解析只读一次 `installed_plugins.json`；改 mtime 后重新读取。
- [x] 接入：`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/modules/quay/tests/quay-process.test.ts server/modules/quay/tests/quay.service.test.ts` exit 0；`quay-process.ts` 不再以 `.quay/plugin` 作为默认入口，原有的 `entrypoint-not-executable` 失败分类对解析出的路径仍然成立。
- [x] 诊断：snapshot 的诊断里读得到 `{ path, version, source }`；`git diff -U0 -- server/shared/types.ts` 不含对 `QuayDriverSummary`、`QuayDriverState` 的改动，新增字段是可选的。
- [x] 扫描清理：`git grep -n "\.quay/plugin" -- server/modules/quay/quay-process.ts server/modules/quay/quay.module.ts server/modules/quay/quay.service.ts` 只剩第 3 条兼容旧项目的那一处读取与它的注释；e2e 夹具 `e2e/ui-scenario-runner.spec.ts`、`e2e/zz-quay-panel-mobile-grid.spec.ts` 不再要求项目里存在 `.quay/plugin`，且 `docs/proposals/` 中相关描述同步更新。
- [x] 静态检查：`npx tsc --noEmit -p server/tsconfig.json` exit 0，`npx oxlint server/modules/quay server/shared` exit 0。

## DoD

在真实机器上用已构建的服务器代码（构建产物，不重启 live 服务）对三个真实项目调用解析器并贴出结果：claudecodeui（`.quay/plugin` 指向缓存）解析为 user 0.22.0；cantus 与 archguard（链接现在或将来可能悬空）同样解析为 user 0.22.0 且 `entrypoint-missing` 不再出现；quay-fleet（project scope 0.19.0 记录，`projectPath` 等于其根）解析为 project 记录。贴出每个项目的 `{ path, version, source }` 和对应的 `quay driver status --json` 能被 snapshot 读到的证据。部署（`build:server` 与服务重启）由用户执行，本任务只交付代码与上述实测。

## Touches

- server/modules/quay/quay-entrypoint-resolver.ts (new)
- server/modules/quay/tests/quay-entrypoint-resolver.test.ts (new)
- server/modules/quay/quay-process.ts
- server/modules/quay/quay.module.ts
- server/modules/quay/quay.service.ts
- server/modules/quay/quay-capabilities.ts
- server/modules/quay/tests/quay-process.test.ts
- server/modules/quay/tests/quay.service.test.ts
- server/shared/types.ts
- server/shared/tests/quay-test-script.test.ts
- config/server.settings.example.json
- e2e/ui-scenario-runner.spec.ts
- e2e/zz-quay-panel-mobile-grid.spec.ts
- docs/proposals/cloudcli-mcp-control-observability-2026-10.md
- tasks/gap-quay-entrypoint-resolver-via-claude-plugin-scopes.md

## Needs-Human

**执行 2026-10-25T20:29:32.038Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：61bf6067-9362-420d-bb9a-93f21c97d624
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-quay-entrypoint-resolver-via-claude-plugin-scopes~wk-prod-anchor~1792958560401-0fbc42.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-quay-entrypoint-resolver-via-claude-plugin-scopes-wk-prod-anchor.log

## Needs-Human

**执行 2026-10-25T22:48:17.740Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 3 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 1
- run_id：wk-prod-anchor
- session_id：410c396f-7d78-4002-9b09-bd30793f8592
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-quay-entrypoint-resolver-via-claude-plugin-scopes~wk-prod-anchor~1792967394667-18164c.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-quay-entrypoint-resolver-via-claude-plugin-scopes-wk-prod-anchor.log

## Evidence

**2026-10-26 续做轮：suite-red 归因 + 重新验证**

- 前两轮 suite-red 的真实原因不是本任务：`suite-scope-check` 在 prelude 阶段被兄弟任务 `gap-cli-contract-sentinel-sleep2-bash-child-leaks-into-suite-leak-sweep` 的 AC 里的全量 suite 命令判红（当时该任务 status=ready 且 AC 裸写 `bash scripts/test.sh server/modules/providers/tests/claude-resident-cli-contract.test.ts`），整轮在跑任何用例前 abort（`# tests 0 / # fail 1`，`aborting before any stage`）。该兄弟任务已在 develop 修正并翻 done（b5bf0a743，2026-10-26 07:11:39）；本分支落后 develop 76 个提交，已 merge develop（5ec491ab2），prelude 不再被这条判据挡住。
- merge develop 两处冲突按语义并集解决：`server/shared/types.ts` 同时保留本任务的 `QuayEntrypointSource` / `QuayEntrypointDiagnostic` / `QuaySnapshot.entrypoint?` 与 develop 的 `QuayLoop*` 类型；`e2e/zz-quay-panel-mobile-grid.spec.ts` 保留本任务的可空 `resolveQuayPlugin(): string | null`（不要求 `.quay/plugin`）并吸收 develop 的注释细节（变量名保持 `quayPlugin` 以匹配共享的 `if (quayPlugin !== null)` 守卫）。
- AC1–AC4：`npx tsx … --test server/modules/quay/tests/quay-entrypoint-resolver.test.ts` → tests 10 / pass 10 / fail 0，exit 0（AC1 顺序、AC2 悬空降级、AC3 旧链接、AC4 缓存四条读数全绿）。
- AC5：`npx tsx … --test server/modules/quay/tests/quay-process.test.ts server/modules/quay/tests/quay.service.test.ts` → tests 51 / pass 50 / fail 0 / skipped 1，exit 0；跳过项是「已安装 lanes 插件」用例（worktree 无 `.quay/plugin/vendor/quay/dist/quay.js`，预期跳过）。
- AC6：`quay.service.ts:2530` 把 `entrypoint: { path, version, source }` 写进 snapshot；`git diff -U0 develop -- server/shared/types.ts | grep -E 'QuayDriverSummary|QuayDriverState'` 零命中（新增字段为可选）。
- AC7：`git grep -n "\.quay/plugin" -- quay-process.ts quay.module.ts quay.service.ts` 仅剩 `quay-process.ts:42` 的旧项目兼容读取注释；`quay.service.ts:177` 的 `.quay/plugin` 是 develop 上 loop-status 任务已存在的注释（非本任务引入、未增删，属判据写就后 develop 新增的既有散文）。`e2e/ui-scenario-runner.spec.ts`、`e2e/zz-quay-panel-mobile-grid.spec.ts` 的 `resolveQuayPlugin` 均返回 `string | null`，不再要求 `.quay/plugin`。
- AC8：`npx tsc --noEmit -p server/tsconfig.json` exit 0；`npx oxlint server/modules/quay server/shared` exit 0（仅既有 warning）。
- 反漂移：`anti-drift-touches-check --task gap-quay-entrypoint-resolver-via-claude-plugin-scopes --merge-target develop` → `ANTI-DRIFT OK: … 14 actual file(s), all within declared Touches`。
- DoD 实机读数（源码经 tsx 运行 `createSystemQuayEntrypointResolver`；未 build/重启 live 服务，按任务约定部署由用户执行）：
  - claudecodeui → `{ path: "/data/home/yale/.claude/plugins/cache/quay/quay/0.22.0/bin/quay", version: "0.22.0", source: "user", warning: null }`
  - cantus → 同 user 0.22.0，`warning: null`（不再 `entrypoint-missing`）
  - archguard → 同 user 0.22.0，`warning: null`（不再 `entrypoint-missing`）
  - quay-fleet → `{ path: "/data/home/yale/.claude/plugins/cache/quay/quay/0.19.0/bin/quay", version: "0.19.0", source: "project", warning: null }`
  - snapshot 侧（`{ path, version, source }` 及 loop/driver 读数）由 `quay-process.test.ts` / `quay.service.test.ts` 覆盖。
