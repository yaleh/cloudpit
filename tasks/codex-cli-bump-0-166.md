---
id: codex-cli-bump-0-166
title: Codex CLI/SDK 升级到 0.166.0：配对精确 pin、离线协议冒烟矩阵、刷新预置模型目录并在真实 turn 验收
status: todo
labels:
  - ops
parent: null
children: []
extra: {}
depends_on:
  - codex-model-catalog-drop-dead-slugs
---
## Proposal

<!-- dedup-ref --> 2026-10-30 立案期检索（root=/data/home/yale/work/claudecodeui）：`grep -rln '0\.166\|0\.165\|@openai/codex' tasks/` 只命中 codex resident 的 AC-435..AC-444 系列任务与 `codex-model-catalog-drop-dead-slugs`（模型目录死 slug 修复），没有任何一条是 CLI/SDK 版本升级；`grep -rln '升级.*codex\|codex.*升级\|bump.*codex' tasks/` 同样只有这两类；`ls tasks/ | grep -iE 'bump|dynamic-catalog|model-list'` 为空。task-granularity-advice 对本任务 Touches 报 `peers: [codex-model-catalog-drop-dead-slugs]`（共享 `server/modules/providers/list/codex/codex-models.provider.ts`），同文件串行由 frontmatter 表达，正文不复述。

### 现状（2026-10-30 读 package.json / lock / npm）

| 项 | 值 |
|---|---|
| `package.json` | `@openai/codex: "0.153.4"`（精确）、`@openai/codex-sdk: "^0.153.0"` |
| lock 实际安装 | codex 0.153.4 / sdk 0.153.4 |
| npm 最新 | 0.166.0（两个包都是） |
| 本机 PATH codex | 0.165.0（只服务 Shell 标签页与 auth 探测） |

**SDK 自带 CLI 依赖**：`@openai/codex-sdk@0.153.4` 的 `dependencies` 是 `{"@openai/codex":"0.153.4"}`，0.166.0 的 SDK 依赖 `0.166.0`。SDK 的 `findCodexPath()` 从 SDK 自己的 `dist/` 解析 CLI，`server/modules/providers/list/codex/codex-app-server.connection.ts:480` 从 server 模块解析；只 bump SDK 会让两条路径拿到不同版本（聊天 0.166、常驻 0.153.4）。两个包必须同版本、一次安装，并用 `npm ls @openai/codex` 确认只有一份。

### 0.153.4 vs 0.165.0 实测兼容矩阵（立案前用两个二进制各跑一遍）

| 面 | 0.153.4 | 0.165.0 | 结论 |
|---|---|---|---|
| `model/list` | 4 个可见模型 | 8 个 | 同形状，目录不同 |
| `exec --experimental-json` | 可用 | 可用 | 事件名一致 |
| `thread/start` / `thread/queue/add` / `thread/queue/list` | 正常 | 正常 | 回包形状一致 |
| 无 `experimentalApi` 调 queue | `-32600 thread/queue/add requires experimentalApi capability` | 逐字相同 | 现有 latch 与测试钉子仍成立 |
| `thread/settings/update` | `{}` + `thread/settings/updated` | 相同 | "只认通知"的实现仍对 |
| `process/spawn` / `process/kill` | `{}`（`cwd` 必填） | 相同 | 后台任务面未变 |
| 审批请求种类 | schema 中都有 | 相同 | 未变 |
| `experimentalFeature/list` | 同形状 | 同形状，集合不同 | `step_model_switching` 两版都 under development |
| 未 live 测 | `turn/steer`、`thread/queue/delete`、`thread/queue/start`、真实 turn | 同 | 在本任务补 |

`model/list` 在没有 auth.json 时也返回目录，且与有 auth 时相同：它反映 CLI 自带目录，不是账号 entitlement；账号不可用仍只在 turn 时报 400。

### 要做的事

1. **配对 pin**：在主检出执行 `npm install --save-exact @openai/codex@0.166.0 @openai/codex-sdk@0.166.0`，把主检出的 `package.json` 与 `package-lock.json` 复制进 worktree 并提交。不要只在 worktree 安装：worktree 的 `node_modules` 是指向主检出的符号链接，worktree 里装的依赖到不了主检出，suite 会跑旧版本。此步会让所有会话看到 0.166，完成记录必须写明这一全局影响。
2. **离线协议冒烟脚本** `scripts/codex-protocol-smoke.mjs`：用临时 `CODEX_HOME`（无 auth.json、无网络）spawn 打包 launcher 的 `app-server`，依次调用 `initialize`（带 experimentalApi）→ `model/list`（翻页）→ `thread/start` → `thread/queue/add` / `thread/queue/list` → `thread/settings/update`（等 `thread/settings/updated`）→ `process/spawn` / `process/kill`（带 `cwd`）→ `experimentalFeature/list`；再起一次不带 experimentalApi 的握手，断言 queue 的逐字拒绝文案。输出 JSON 报告，形状不符时非 0 退出。脚本不读宿主 `~/.codex`。
3. **刷新静态目录**：用 0.166 的 `model/list` 取 `hidden === false` 的集合，更新 `server/modules/providers/list/codex/codex-models.provider.ts` 的 `CODEX_PREDEFINED_MODELS`（value/label/description/effort.default/effort.values；`isDefault` → `DEFAULT`）。如果 0.166 与 0.153.4 返回同一集合，照实记录，不要为了"有变化"编造模型。
4. **跑 codex 面测试**：`codex-app-server-protocol`、`codex-host-driver-persistent`、`codex-host-driver-queue`、`codex-host-driver-settings`、`provider-models.service`、`codex-resident-capabilities`；`npm run typecheck`（SDK `.d.ts` 变化会在这里暴露）与 `npm run lint`。
5. **真实 per-run turn**：在真实应用里用默认模型发一条消息并拿到回复；贴 turn/session 读数与模型 id，确认没有 400。
6. **真实 resident turn**：通过应用真实入口（HTTP session 创建/发送或 MCP `session_create`，不要求 UI 已落地）跑一条 resident turn，覆盖 queue add + withdraw 与 live settings patch；贴 threadId、queue delete 次数、settings 通知。
7. **状态与配置**：第一次用 0.166 前把 `~/.codex` 的 `auth.json` 与状态 DB 备份到 `tmp/`；跑 `codex doctor`；说明现有 `model_providers.bob.api` 告警是既存配置，不属本任务。
8. **回滚**：完成记录写出回滚命令（`npm install --save-exact @openai/codex@0.153.4 @openai/codex-sdk@0.153.4`）与状态备份路径。

### 不在本任务内

- 动态模型目录（运行时 `model/list` 发现）另立任务。
- 把 PATH 上的 codex 也升到 0.166 属用户环境，不写进仓库。
- 修复 `~/.codex/config.toml` 的 `model_providers.bob.api` 告警。
- UI 改动；本任务只换运行时版本与目录数据。

## AC

- [ ] AC1 **配对 pin 且只有一份 CLI**：`node -p "require('./package.json').dependencies['@openai/codex'] + ' / ' + require('./package.json').dependencies['@openai/codex-sdk']"` 打印 `0.166.0 / 0.166.0`；`npm ls @openai/codex --all` 只出现一个版本（无嵌套副本）；`node node_modules/@openai/codex/bin/codex.js --version` 打印 `codex-cli 0.166.0`。完成记录贴出三条输出。
- [ ] AC2 **离线协议冒烟矩阵为绿**：`node scripts/codex-protocol-smoke.mjs` 退出 0；报告含版本、`model/list` 的 count 与 ids、`thread/start` ok、`queue/add` ok、`queue/list` 深度、`settings/update` 的 `{}` 与 `thread/settings/updated` 通知、无 capability 时的逐字拒绝文案、`process/spawn`/`process/kill` ok、`experimentalFeature/list` count。完成记录贴出整份 JSON。
- [ ] AC3 **静态目录与 0.166 的可见目录相等**：`GET /api/providers/codex/models`（真实服务）的 `OPTIONS[].value` 集合等于 0.166 `model/list` 中 `hidden === false` 的 id 集合；贴出两侧集合。若两者相等且与 0.153.4 相同，也照实贴出。
- [ ] AC4 **类型与 lint**：`npm run typecheck` 与 `npm run lint` 均退出 0。
- [ ] AC5 **codex 面测试无回归**：以下命令各自退出 0，并贴出 tests/pass/fail：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-app-server-protocol.test.ts`、`... --test server/modules/providers/tests/codex-host-driver-persistent.test.ts`、`... --test server/modules/providers/tests/codex-host-driver-queue.test.ts`、`... --test server/modules/providers/tests/codex-host-driver-settings.test.ts`、`... --test server/modules/providers/tests/provider-models.service.test.ts`、`... --test server/modules/providers/tests/codex-resident-capabilities.test.ts`。
- [ ] AC6 **真实 per-run turn 成功**：在真实应用里用默认模型发一条消息并收到回复；贴 session/turn 读数、实际模型 id 与回复首行；服务端日志无 400 / `model_not_found`。
- [ ] AC7 **真实 resident turn 成功**：通过应用真实入口跑一条 resident turn，完成一次 queue add + withdraw 与一次 live settings patch；贴 threadId、`thread/queue/delete` 调用次数、`thread/settings/updated` 通知与 pid 前后值。
- [ ] AC8 **状态备份与回滚可执行**：完成记录写出 `~/.codex` 备份路径（`tmp/` 下）、备份内容清单，以及回滚到 0.153.4 的精确命令；备份文件实际存在（`ls -l` 贴出）。
- [ ] AC9 **Touches 与 anti-drift**：`node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/anti-drift-touches-check.js --task codex-cli-bump-0-166 --worktree <worktree> --merge-target develop` 打印 `ANTI-DRIFT OK`；`git diff --name-only develop...HEAD` 只含 Touches 内文件。

## DoD

真实对象验收：应用真的用 0.166 跑起来，而不是只有脚本绿。

1. 真实应用里选 codex，用默认模型发一条消息并收到回复；截图存 `tmp/codex-0-166-chat.png`，并贴出回复与模型 id。
2. 同一实例 `GET /api/providers/codex/models` 返回的集合等于打包 0.166 的 `model/list` 可见集合；贴出 JSON。
3. 真实 resident turn：创建/切换一条 resident 会话，发一条消息，再排队一条并撤回，patch 一次 model/effort；贴出 threadId、queue delete 次数、settings 通知与 pid 前后值。
4. `node scripts/codex-protocol-smoke.mjs` 的完整 JSON 报告贴进完成记录。
5. 备份与回滚：`ls -l tmp/codex-0-166-backup/` 与 `codex doctor` 的关键行贴出；说明 `model_providers.bob.api` 是既存告警。
6. 全局影响声明：完成记录写明"主检出 node_modules 已升到 0.166，所有 worktree 随之生效"。

## Touches

- package.json
- package-lock.json
- server/modules/providers/list/codex/codex-models.provider.ts
- server/modules/providers/list/codex/codex-app-server.connection.ts
- server/modules/providers/list/codex/codex-live-settings.ts
- server/modules/providers/services/provider-capabilities.service.ts
- server/modules/providers/tests/provider-models.service.test.ts
- server/modules/providers/tests/codex-resident-capabilities.test.ts
- scripts/codex-protocol-smoke.mjs
- tasks/codex-cli-bump-0-166.md