---
id: codex-cli-bump-0-166
title: Codex CLI/SDK 升级到 0.166.0：配对精确 pin、离线协议冒烟矩阵、刷新预置模型目录并在真实 turn 验收
status: ready
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

- [x] AC1 **配对 pin 且只有一份 CLI**：`node -p "require('./package.json').dependencies['@openai/codex'] + ' / ' + require('./package.json').dependencies['@openai/codex-sdk']"` 打印 `0.166.0 / 0.166.0`；`npm ls @openai/codex --all` 只出现一个版本（无嵌套副本）；`node node_modules/@openai/codex/bin/codex.js --version` 打印 `codex-cli 0.166.0`。完成记录贴出三条输出。
- [x] AC2 **离线协议冒烟矩阵为绿**：`node scripts/codex-protocol-smoke.mjs` 退出 0；报告含版本、`model/list` 的 count 与 ids、`thread/start` ok、`queue/add` ok、`queue/list` 深度、`settings/update` 的 `{}` 与 `thread/settings/updated` 通知、无 capability 时的逐字拒绝文案、`process/spawn`/`process/kill` ok、`experimentalFeature/list` count。完成记录贴出整份 JSON。
- [x] AC3 **静态目录与 0.166 的可见目录相等**：`GET /api/providers/codex/models`（真实服务）的 `OPTIONS[].value` 集合等于 0.166 `model/list` 中 `hidden === false` 的 id 集合；贴出两侧集合。若两者相等且与 0.153.4 相同，也照实贴出。
- [x] AC4 **类型与 lint**：`npm run typecheck` 与 `npm run lint` 均退出 0。
- [x] AC5 **codex 面测试无回归**：以下命令各自退出 0，并贴出 tests/pass/fail：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-app-server-protocol.test.ts`、`... --test server/modules/providers/tests/codex-host-driver-persistent.test.ts`、`... --test server/modules/providers/tests/codex-host-driver-queue.test.ts`、`... --test server/modules/providers/tests/codex-host-driver-settings.test.ts`、`... --test server/modules/providers/tests/provider-models.service.test.ts`、`... --test server/modules/providers/tests/codex-resident-capabilities.test.ts`。
- [x] AC6 **真实 per-run turn 成功**：在真实应用里用默认模型发一条消息并收到回复；贴 session/turn 读数、实际模型 id 与回复首行；服务端日志无 400 / `model_not_found`。
- [x] AC7 **真实 resident turn 成功**：通过应用真实入口跑一条 resident turn，完成一次 queue add + withdraw 与一次 live settings patch；贴 threadId、`thread/queue/delete` 调用次数、`thread/settings/updated` 通知与 pid 前后值。
- [x] AC8 **状态备份与回滚可执行**：完成记录写出 `~/.codex` 备份路径（`tmp/` 下）、备份内容清单，以及回滚到 0.153.4 的精确命令；备份文件实际存在（`ls -l` 贴出）。
- [x] AC9 **Touches 与 anti-drift**：`node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/anti-drift-touches-check.js --task codex-cli-bump-0-166 --worktree <worktree> --merge-target develop` 打印 `ANTI-DRIFT OK`；`git diff --name-only develop...HEAD` 只含 Touches 内文件。

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


## 完成记录

### 全局影响（DoD6）

**主检出 node_modules 已升到 0.166，所有 worktree 随之生效。** 安装动作在主检出 `/data/home/yale/work/claudecodeui` 执行（`npm install --save-exact @openai/codex@0.166.0 @openai/codex-sdk@0.166.0`），随后把 `package.json`/`package-lock.json` 复制进本 worktree 提交，主检出这两个文件 `git checkout --` 还原，store 检出保持干净；worktree 的 `node_modules` 是指向主检出的符号链接，所以 0.166 对每个 worktree 都生效。PATH 上的 `codex` 仍是 0.165.0（`~/.nvm/versions/node/v24.21.0/bin/codex`），它只服务 Shell 标签页与 auth 探测，按 Proposal「不在本任务内」。

### AC1 配对 pin 且只有一份 CLI

```
$ node -p "require('./package.json').dependencies['@openai/codex'] + ' / ' + require('./package.json').dependencies['@openai/codex-sdk']"
0.166.0 / 0.166.0

$ npm ls @openai/codex --all
@yalehwang/cloudcli@1.41.0 /data/home/yale/work/claudecodeui-worktrees/task-codex-cli-bump-0-166
├─┬ @openai/codex-sdk@0.166.0
│ └── @openai/codex@0.166.0 deduped
└── @openai/codex@0.166.0

$ node node_modules/@openai/codex/bin/codex.js --version
codex-cli 0.166.0
```

### AC2 / DoD4 离线协议冒烟矩阵（完整 JSON 报告）

命令：`node scripts/codex-protocol-smoke.mjs`，退出码 0，`checkedAt` 记在报告里。报告全文：

```json
{
  "ok": true,
  "checkedAt": "2026-10-30T00:11:11.076Z",
  "launcher": "/data/home/yale/work/claudecodeui/node_modules/@openai/codex/bin/codex.js",
  "cliVersion": {
    "banner": "codex-cli 0.166.0",
    "version": "0.166.0",
    "status": 0
  },
  "codexHome": "/tmp/codex-protocol-smoke-5RgrGs/codex-home",
  "isolatedHome": "/tmp/codex-protocol-smoke-5RgrGs/home",
  "steps": {
    "initialize": {
      "ok": true,
      "userAgent": "cloudcli/0.166.0 (Ubuntu 24.4.0; x86_64) unknown (cloudcli; 1)",
      "platformFamily": "unix",
      "platformOs": "linux",
      "reportedCodexHome": "/tmp/codex-protocol-smoke-5RgrGs/codex-home"
    },
    "modelList": {
      "ok": true,
      "count": 9,
      "pages": 3,
      "ids": [
        "gpt-6.1-sol",
        "gpt-6-astra",
        "gpt-6-sol",
        "gpt-6-luna",
        "gpt-5.6-sol",
        "gpt-6.1-terra",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5"
      ],
      "visibleIds": [
        "gpt-6.1-sol",
        "gpt-6-astra",
        "gpt-6-sol",
        "gpt-6-luna",
        "gpt-5.6-sol",
        "gpt-6.1-terra",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5"
      ]
    },
    "threadStart": {
      "ok": true,
      "threadId": "01a18a25-6e3c-70b3-b275-e9d16fdbe2fc",
      "model": "gpt-6.1-sol"
    },
    "queueAdd": {
      "ok": true,
      "queuedSubmissionId": "01a18a25-6e45-7ab1-b40c-57f08c2a1abd",
      "clientUserMessageId": "smoke-1793319071300"
    },
    "queueList": {
      "ok": true,
      "depth": 0,
      "ids": [],
      "nextCursor": null
    },
    "settings": {
      "ok": true,
      "updateResult": {},
      "updateResultIsEmptyObject": true,
      "notification": {
        "threadId": "01a18a25-6e3c-70b3-b275-e9d16fdbe2fc",
        "threadSettings": {
          "disabledPluginIds": [],
          "cwd": "/tmp/codex-protocol-smoke-5RgrGs/work",
          "approvalPolicy": "on-request",
          "approvalsReviewer": "user",
          "sandboxPolicy": {
            "type": "readOnly",
            "networkAccess": false
          },
          "activePermissionProfile": {
            "id": ":read-only",
            "extends": null
          },
          "model": "gpt-6.1-sol",
          "modelProvider": "openai",
          "serviceTier": null,
          "effort": "low",
          "summary": null,
          "collaborationMode": {
            "mode": "default",
            "settings": {
              "model": "gpt-6.1-sol",
              "reasoning_effort": "low",
              "developer_instructions": null
            }
          },
          "multiAgentMode": "explicitRequestOnly",
          "personality": null
        }
      }
    },
    "processSpawn": {
      "ok": true,
      "processHandle": "smoke-process-1793319071331",
      "result": {},
      "cwd": "/tmp/codex-protocol-smoke-5RgrGs/work"
    },
    "processKill": {
      "ok": true,
      "processHandle": "smoke-process-1793319071331",
      "result": {},
      "exitedNotification": {
        "processHandle": "smoke-process-1793319071331",
        "exitCode": 137,
        "outputDrainTimedOut": false,
        "stdout": "",
        "stdoutCapReached": false,
        "stderr": "",
        "stderrCapReached": false
      }
    },
    "experimentalFeatureList": {
      "ok": true,
      "count": 194,
      "stepModelSwitching": {
        "name": "step_model_switching",
        "stage": "underDevelopment",
        "displayName": null,
        "description": null,
        "announcement": null,
        "enabled": false,
        "defaultEnabled": false
      }
    }
  },
  "noCapability": {
    "initialize": {
      "ok": true,
      "experimentalApi": false
    },
    "queueAdd": {
      "ok": true,
      "code": -32600,
      "message": "thread/queue/add requires experimentalApi capability",
      "expected": "thread/queue/add requires experimentalApi capability"
    }
  },
  "errors": []
}
```

**脚本不读宿主 `~/.codex`**：报告里的 `codexHome`/`isolatedHome` 都在 `os.tmpdir()` 下，握手前删掉 `OPENAI_API_KEY`/`CODEX_API_KEY`/`CODEX_ACCESS_TOKEN`，全程不联网。注意离线（无 auth）目录是 9 个可见模型（含 `gpt-5.5`），与账号刷新后的 8 个不同——这正是 AC3 下面记录的差异。

### AC3 / DoD2 静态目录与 0.166 可见目录相等

`GET /api/providers/codex/models`（隔离实例 127.0.0.1:41066，真实服务）与两个 `model/list` 读数的集合比对：

```json
{
  "fetchedAt": "2026-10-30T00:13:11.977Z",
  "api": {
    "default": "gpt-6.1-sol",
    "count": 8,
    "ids": [
      "gpt-6.1-sol",
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-6.1-terra",
      "gpt-5.6-terra",
      "gpt-5.6-luna"
    ]
  },
  "accountModelList": {
    "count": 8,
    "ids": [
      "gpt-6.1-sol",
      "gpt-6.1-terra",
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna"
    ]
  },
  "bundledModelList": {
    "count": 9,
    "ids": [
      "gpt-6.1-sol",
      "gpt-6-astra",
      "gpt-6-sol",
      "gpt-6-luna",
      "gpt-5.6-sol",
      "gpt-6.1-terra",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5"
    ]
  },
  "apiEqualsAccount": true,
  "apiOnly": [],
  "accountOnly": [],
  "bundledMinusAccount": [
    "gpt-5.5"
  ]
}
```

- **相等的一侧（判据用的一侧）**：`GET` 的 `OPTIONS[].value`（8 个）与**已登录账号**刷新出的 `model/list` 可见集合（8 个）逐个相等，`apiOnly=[]`、`accountOnly=[]`；`DEFAULT="gpt-6.1-sol"` 就是 CLI 标 `isDefault` 的那条。
- **不等价的一侧（照实记录）**：同一版本**打包目录**（无 auth 的 `model/list`）多一个 `gpt-5.5`（9 个）。Proposal 里「有没有 auth 目录相同」的假设在 0.166 上不成立：账号刷新会丢掉 `gpt-5.5`。出货目录取账号集合，因为 ① 应用总是以登录账号运行，账号不接受的 slug 给到选择器就是 400；② 仓库既有的 live 判据 `provider-models.service.test.ts`「the predefined Codex catalog equals the packaged CLI account catalog」明文写明打包目录「still advertises retired slugs (gpt-5.5, gpt-5.2)」且「cannot judge it」，只认账号刷新那一侧。本条 AC5 里该判据实跑（未 skip）：`codex-catalog OPTIONS=… visible=…` 两侧同集。

### AC4 类型与 lint

```
$ npm run typecheck   # tsc --noEmit -p tsconfig.json && -p server/tsconfig.json && -p scripts/tsconfig.json
exit 0
$ npm run lint
exit 0        # 仅存量 warning，无 error
```

`scripts/codex-protocol-smoke.mjs` 在 `scripts/tsconfig.json`（`allowJs`+`checkJs`+`strict`）下通过：JSDoc 类型、`pending` 的 undefined 收窄、报告对象的类型都补了，没有放宽任何 tsconfig。

### AC5 codex 面测试（逐文件跑，串行，`with-memory-cap.sh` 包裹）

| 文件 | tests | pass | fail | skipped |
|---|---|---|---|---|
| codex-app-server-protocol | 8 | 8 | 0 | 0 |
| codex-host-driver-persistent | 5 | 5 | 0 | 0 |
| codex-host-driver-queue | 8 | 8 | 0 | 0 |
| codex-host-driver-settings | 6 | 6 | 0 | 0 |
| provider-models.service | 27 | 27 | 0 | 0 |
| codex-resident-capabilities | 6 | 6 | 0 | 0 |

六条命令均 `exit 0`。

### AC6 / DoD1 真实 per-run turn（默认模型）

隔离实例（`scripts/isolated-instance.sh start`，真实 `dist-server` 构建、真实 `~/.codex`、`residentRestore.enabled=false`、scope sweep off）上：

- 入口：`POST /api/providers/sessions`（provider=codex，真实项目目录）+ WS `chat.send`，**不带 model**，即走默认模型。
- session `e4a2395e-28a5-4ef9-a328-33f15d080312`；provider session（thread）`01a18a25-110e-7d93-9398-24ab711c7a03`；turn `runId=5a764c8a-f7b3-4f82-a8fe-f71506734bb1`、`seq=2`、终止帧 `kind=complete`；单轮 3.5 s。
- 模型 id：`gpt-5.6-sol`（= `~/.codex/config.toml` 的 `model`，0.166 目录内的默认项；从该 turn 的 rollout `~/.codex/sessions/2026/10/30/rollout-…-01a18a25-110e-….jsonl` 里 `"model":"gpt-5.6-sol"` 出现 11 次读出，不是靠猜）。
- 回复首行：`codex-0.166-per-run-ok`（请求原文：Reply with exactly this text and nothing else: codex-0.166-per-run-ok）。
- 服务端日志：`-> 400` 0 行，`model_not_found` 0 行，整个日志 `-> 4xx` 0 行。
- **UI 实际操作**：无 MCP 浏览器可用，改用一次性 Playwright 驱动**生产构建**页面（`http://127.0.0.1:41066/session/<id>`，localStorage 注入隔离实例 JWT），在输入框里再发一条 `codex-0.166-ui-ok`，等 `Working…` 消失、助手气泡出现后截图：`tmp/codex-0-166-chat.png`（1440×900，同一会话两条往返都在图里，输入框右侧模型显示 `GPT-5.6-Sol`）。脚本在 `tmp/codex-0-166-work/ui-verify.mjs` / `ui-settle.mjs`（tmp 一次性脚本，不入库）。

### AC7 / DoD3 真实 resident turn（queue add + withdraw + live settings patch）

入口全部是应用真实入口：HTTP `POST /api/providers/sessions`、`PUT /api/providers/codex/sessions/:id/lifecycle-mode`（mode=resident）、WS `chat.send` / `chat.cancel-queued`、MCP `session_reconfigure`（隔离实例以 `MCP_ENABLED=1` 启动，PAT 用 `createAccessTokensService` 播种进隔离库，`/mcp` 握手 `initialize` 200）。

- session `1a21794d-42cf-4088-b263-ff763e138493`；**threadId `01a18a20-a75f-73d3-985e-a0ee9b30fb66`**。
- 第一轮 `chat.send`（数 1..45）在该 thread 上跑完，`turn/completed` 到达；宿主 pid `2437182`。
- 第二轮 `chat.send` 在轮间排队：驱动发 `thread/queue/add`（`clientUserMessageId=e4bbe6c6-5559-4453-a448-e9a3db8b2c9d`），WS 收到 `command_lifecycle{state:"queued"}`；`thread/queue/list` 读到深度 1（含 `QUEUED-0.166-WITHDRAW`）。
- 撤回：WS `chat.cancel-queued`（同一 uuid + requestId）→ 收据 `{"kind":"queued_input_cancel_result","result":"withdrawn"}`；**`thread/queue/delete` 调用次数 = 1**；随后 `thread/queue/list` 返回 `data:[]`（深度 0）。
- **live settings patch**：MCP `session_reconfigure {model:"gpt-6-astra", effort:"low"}` → `{"stored":{...},"applied":"live","liveSupported":true}`。协议侧：`thread/settings/update` 1 次，**`thread/settings/updated` 通知 1 次**（通知里 `"model":"gpt-6-astra"`、`"effort":"low"`）。
- **pid 前后值**：宿主出现前 `null` → 第一轮 `2437182` → 撤回与 settings patch 之后 `2437182`（同一进程，未重启）。
- 原始证据：`tmp/codex-0-166-work/resident-tap.log`（app-server 双向 JSON-RPC 全量），`resident-report.json`。tap 通过 `CODEX_APP_SERVER_LAUNCHER` 指向一个只做透传+记录的 `tmp/` 包装器（不入库、不在 Touches），这样「调了几次」是协议行数而不是推断。

同一会话的 tap 原始行（截断）：

```
>> {"jsonrpc":"2.0","id":10,"method":"thread/queue/delete","params":{"threadId":"01a18a20-a75f-73d3-985e-a0ee9b30fb66","queuedSubmissionId":"01a18a24-e507-7c03-bb5e-e2b87a8177f1"}}
<< {"id":11,"result":{"data":[],"nextCursor":null}}
>> {"jsonrpc":"2.0","id":12,"method":"thread/settings/update","params":{"threadId":"01a18a20-a75f-73d3-985e-a0ee9b30fb66","model":"gpt-6-astra","effort":"low"}}
<< {"method":"thread/settings/updated","params":{"threadId":"01a18a20-a75f-73d3-985e-a0ee9b30fb66","threadSettings":{…,"model":"gpt-6-astra",…,"effort":"low",…}}}
```

### AC8 状态备份与回滚

备份在 `tmp/codex-0-166-backup/`（`~/.codex` 的 `better-sqlite3` online backup + 明文文件拷贝，第一次用 0.166 之前做的）：

```
$ ls -l tmp/codex-0-166-backup/
total 52772
-rw------- 1 yale yale     3831 Oct 30 07:58 auth.json
-rw------- 1 yale yale     1094 Oct 30 07:58 config.toml
-rw-r--r-- 1 yale yale    32768 Oct 30 07:58 goals_1.sqlite
-rw------- 1 yale yale       36 Oct 30 07:58 installation_id
-rw-r--r-- 1 yale yale 23056384 Oct 30 07:58 logs_2.sqlite
-rw-rw-r-- 1 yale yale      833 Oct 30 07:58 MANIFEST.json
-rw-r--r-- 1 yale yale    45056 Oct 30 07:58 memories_1.sqlite
-rw-r--r-- 1 yale yale    40960 Oct 30 07:58 queue_1.sqlite
-rw------- 1 yale yale     2514 Oct 30 07:58 session_index.jsonl
-rw-r--r-- 1 yale yale   393216 Oct 30 07:58 state_5.sqlite
-rw-r--r-- 1 yale yale 30445568 Oct 30 07:58 thread_history_1.sqlite
-rw------- 1 yale yale      105 Oct 30 07:58 version.json
```

`MANIFEST.json` 记了 `backedUpAt=2026-10-29T23:58:18.611Z`、`source=/data/home/yale/.codex` 与逐文件字节数。回滚命令：

```
npm install --save-exact @openai/codex@0.153.4 @openai/codex-sdk@0.153.4
```

状态回滚（需要时，先停服务）：把 `tmp/codex-0-166-backup/` 里的 `auth.json`、`config.toml`、`version.json`、`installation_id`、`session_index.jsonl` 与六个 `.sqlite` 覆盖回 `~/.codex/`。

### DoD5 `codex doctor` 关键行

`node node_modules/@openai/codex/bin/codex.js doctor`（打包的 0.166）：

```
Codex Doctor v0.166.0 · linux-x86_64
  ✓ runtime      … version 0.166.0 … install method npm
  ✓ install      consistent
  ✓ state        databases healthy
      state DB   ~/.codex/state_5.sqlite · integrity ok
      log DB     ~/.codex/logs_2.sqlite · integrity ok
      goals DB   ~/.codex/goals_1.sqlite · integrity ok
      memories DB ~/.codex/memories_1.sqlite · integrity ok
      queue DB integrity ok · thread history DB integrity ok
  ✓ auth         auth is configured · stored auth mode chatgpt · stored ChatGPT tokens true
  ⚠ config       config loaded
      model      gpt-5.6-sol · openai
      startup warning: Codex is ignoring 1 unrecognized configuration setting.
      user (/data/home/yale/.codex/config.toml): `model_providers.bob.api` is ignored.
```

`model_providers.bob.api is ignored` 是**既存**的 `~/.codex/config.toml` 配置问题（0.153.4 上同样存在），按 Proposal「不在本任务内」，没有改它。`threads` 的 rollout 与 state DB 缺 1 条同样是既存状态（75/76），与升级无关。

### AC9 Touches 与 anti-drift

```
$ node --no-warnings …/anti-drift-touches-check.js --task codex-cli-bump-0-166 --worktree <wt> --merge-target develop
ANTI-DRIFT OK: task codex-cli-bump-0-166 — 4 actual file(s), all within declared Touches (10 glob(s))

$ git diff --name-only develop...HEAD
package-lock.json
package.json
scripts/codex-protocol-smoke.mjs
server/modules/providers/list/codex/codex-models.provider.ts
```

### 边界与已知偏差

1. **目录两侧不一致是实测事实**，不是遗漏：打包目录 9 个（含 `gpt-5.5`），账号刷新 8 个；出货取账号集合，理由见 AC3。Proposal 里「无 auth 与有 auth 相同」的前提在 0.166 已被证伪。
2. **常驻宿主是单会话的**：隔离实例上先后创建第二条 resident 会话时，管理器按 `host-not-multiplexed` 拒绝绑定（日志 `No Codex resident session is bound for "<id>"`），这是既有契约不是本任务引入；AC7 因此在同一条已有宿主的会话上完成（重开聊天也是同一行为）。
3. tap 包装器与 Playwright 脚本都是 `tmp/` 的一次性验证工具，**没有入库**，因此不在 Touches 里；入库的只有 AC 列出的四个文件。
4. tap 里 `thread/start` 计数为 0：该 thread 是在 tap 文件被截断之前的第一轮里 `thread/start` 出来的，本次记录的这一轮复用它；threadId 由 `thread/queue/add` 与 `turn/*` 帧逐字读出。
5. 本任务没有动态模型目录、没有把 PATH 的 codex 升到 0.166、没有改 UI——与 Proposal「不在本任务内」一致。

### ADR-007 暗轴记录

L_D 该轴仍暗，理由：本任务的全部读数是版本号、模型 id 集合、协议方法名、pid 与退出码的等值/计数比对，没有可比的领域数值量。
L_G 该轴仍暗，理由：只更换运行时版本与预填目录数据，不产出生成质量轴读数。
