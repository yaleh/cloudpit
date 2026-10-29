---
id: gap-cockpit-deploy-readout-truthful
title: 驾驶舱部署读数如实：Last deploy 读运行中进程的构建信息、changes not yet built 与
  build-skew-check 同源、读不到时说未知
status: ready
labels:
  - gap
  - cockpit
  - p2
parent: null
children: []
extra: {}
---
## Proposal

来源：2026-10-29 驾驶舱线上审查（MCP 浏览器）。截图 `tmp/cockpit-audit2/01-list-pc.png` 顶部。

问题：驾驶舱顶部的部署读数与事实不符。

- 页面显示 `Last deploy 6f6d140 · verified · 100 hours ago`，而线上实际跑的是 `13e798c`（2026-10-28T16:31Z 延迟重启上线，`~/.local/state/cloudcli-deferred-restart/result.json` 里有 `buildInfo.gitSha` 与 `finishedAt`）。
- 同一行左侧写着 `8 changes not yet built`，但我们每次都是完整构建后才重启，`node scripts/build-skew-check.mjs --json` 当时读数是 `same`。
- 旁边的 `todo 3` 与队列里 6 个任务不一致。

这类读数一旦说错，人会用它判断「要不要重启」，比界面不刷新更危险。要做的是让读数与它声称的来源对齐，并在来源不可读时**说不可读**，不要给出一个看起来像事实的旧值。

做什么：

1. 先查清这三处读数各自的数据来源（`DeployReadiness.tsx` 及其服务端读取），在任务完成记录里写出来源文件/接口与实测值。
2. `Last deploy` 改为读**当前正在运行的那个进程的构建信息**（`dist-server/build-info.json` + `/api/health` 或同类运行时读数），不读历史物化的某个文件；读不到时显示「未知（读数不可用）」，不显示旧 sha。
3. `changes not yet built` 与 `build-skew-check` 用同一个判定（同一次构建的 client/server sha 与服务端正在运行的 sha 比较），不再另算一套。
4. `todo N` 与驾驶舱队列用同一个来源（quay 任务读数），并写明读的是「队列里 ready+todo 的任务数」。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/DeployReadiness.test.tsx` 退出 0，新增用例：给出「运行中 sha = A、构建物 sha = A」的注入读数时，显示已部署 A 且不显示 `changes not yet built`；「运行中 sha = A、构建物 sha = B」时显示 `1 change not yet built` 与两个 sha；读数缺失时显示「未知（读数不可用）」而不是任何 sha 字面量。
- [x] `npx vitest run src/modules/cockpit/tests/DeployReadiness.test.tsx` 追加用例：`todo` 计数等于注入的队列读数，且与卡片列表用同一个注入源（同一测试里断言两处数字相等）。
- [x] 假形态变红：把运行中 sha 改回读历史文件 ⇒ 第一条用例红；把缺失读数回落成旧 sha ⇒ 「未知」用例红；改完即还原。
- [x] `npm run typecheck`、`npm run lint` 退出 0（lint 仅既有 warning）。

## DoD

真实页面（MCP 浏览器，只读）：截图驾驶舱顶部，贴出页面上显示的运行中 sha 与 `dist-server/build-info.json` 的 `gitSha`、`node scripts/build-skew-check.mjs --json` 的 `clientSha` 三个读数，三者一致；再贴出读数字段在服务端的来源路径。

## 完成记录

### 读数字段的来源与实测值（Proposal 1 / DoD）

真实页面：隔离实例 `127.0.0.1:3137`（`tmp/dod-deploy-state`，`cockpit.enabled=true`，resident restore 关闭）跑的是本 worktree 的构建产物；截图 `tmp/dod-deploy-readout/cockpit-top.png`、`cockpit-full.png`。页面顶部条视觉读数：`Deployment is current · todo 14 · 8c6d78d`。

三个读数（同一构建 `8c6d78d`，同一次读）：

| 读数 | 来源 | 值 |
| --- | --- | --- |
| 页面上显示的运行中 sha | 顶部条 `deploy-running-sha` / `deploy-last` | `8c6d78d2b2953aa160bb2d87ae92a895d7fad30e` |
| `dist-server/build-info.json` 的 `gitSha` | `cat dist-server/build-info.json` | `8c6d78d2b2953aa160bb2d87ae92a895d7fad30e`（`builtAt 2026-10-29T07:05:58.491Z`） |
| `build-skew-check --json` 的 `clientSha` | `node scripts/build-skew-check.mjs --json` | `8c6d78d2b2953aa160bb2d87ae92a895d7fad30e`，`verdict: same`（`serverSha` 同值，`clientBuiltAt 2026-10-29T07:05:39.202Z`） |

服务器端同刻读数：`GET /api/system/deploy-readiness` 的 `runningSha = builtSha = clientBuiltSha = headSha = 8c6d78d2b…`；`/health` 的 `buildSha = 8c6d78d2b…`；而 `lastDeploy.targetSha = 6f6d140…`（历史记录，故意与运行中不同——正是立案时的形态）。修复后该页面 `data-verified="false"`、只打印运行中的 `8c6d78d`，不打印 `6f6d140`，也不声称 `verified`。页面机器读数：`{"text":"Deployment is currenttodo 148c6d78d","status":"fresh","truth":"current","buildSkew":"false","lastText":"8c6d78d","lastVerified":"false","queueTodo":"14","buildReadings":null}`，`consoleErrors: []`。

读数字段在服务端的来源路径：

- `server/modules/system/deploy-readiness.service.ts` `read()`：`runningSha = dependencies.runningBuildInfo.gitSha`（296 行）；`builtSha = readBuildFingerprint(dist-server/build-info.json)`（297 行）；`clientBuiltSha = readClientFingerprint(dist/build-info.json)`（300 行）；`lastDeploy` 是持久化的历史部署记录（只作为「上一次验证」的物证，不是运行中进程）。
- `server/index.ts:253` `const BUILD_INFO = readBuildInfo(APP_ROOT)`——**进程启动时读一次**，`server/index.ts:260` 作为 `runningBuildInfo` 交给 system 模块；`server/modules/system/system.module.ts:292` 把它映射成 `runningSha`。`/health` 的 `buildSha` 是同一份 `BUILD_INFO.gitSha`（`server/index.ts:1770`）。
- `scripts/build-skew-check.mjs` 比较的正是 `dist/build-info.json`（client）与 `dist-server/build-info.json`（server）：两侧可读且不等 ⇒ `skew`，任一缺失 ⇒ `missing`，否则 `same`。
- 客户端读取：`src/shared/api.ts` 的 `api.system.deployReadiness()` → `src/modules/cockpit/DeployReadiness.tsx`。`src/shared/api.ts` 本次零 diff（该端口已存在），Touches 中列出但未改。
- `todo N` 来源：`CockpitPage` 在同一份 fleet 读数上求和 `project.tasks.ready + project.tasks.todo`，注入 `DeployReadiness` 的 `queue`；语义 =「队列里 ready+todo 的任务数」，与卡片/舞台用同一个项目读数，不是第二次读任务库。

实现要点：判定集中在同一文件的 `classifyDeployBuild`（非导出，输入只有 `runningSha/builtSha/clientBuiltSha/pendingCommits`）；`build-skew-check` 的规则原样复用；服务端可能陈旧的 `status` 只在 `building`/`restarting` 时优先；任一指纹缺失 ⇒ `unavailable`，不是回落到旧 sha。`lastDeploy` 只有在它验证的 sha 就是 `runningSha` 时才给出 verdict 与时间。新增机器读数供场景/审查读：section 的 `data-status`/`data-build-truth`/`data-build-skew`，以及 `deploy-build-readings`、`deploy-queue`（`data-queue-todo/ready/pending`）、`deploy-last[data-verified]`。

### AC 逐条验证

- AC-1：`npx vitest run src/modules/cockpit/tests/DeployReadiness.test.tsx` → **16 passed / 0 failed，退出 0**。用例「reads the RUNNING process, not the historical last-deploy record」：running=A、built=A、`lastDeploy.targetSha=C` ⇒ 显示 `aaaaaaa`、`data-verified="false"`，条内不含 `ccccccc`、不含 `changes not yet built`。用例「a running sha behind the build sha names both shas and the unbuilt change」：running=A、built=B ⇒ `1 change not yet built` + `aaaaaaa`/`bbbbbbb`，且给出动作按钮。用例「an unreadable build reading says unknown and prints no sha at all」：三个指纹为 null（服务端仍报 `fresh`）⇒ `Deployment status unknown`，`strip.textContent` 不匹配 `/[0-9a-f]{7}/`，且无 `deploy-last`。
- AC-2：用例「the todo number is the injected queue reading from the cards' own project source」：注入 `projects=[{ready:3,todo:2},{ready:1,todo:0}]` ⇒ `data-queue-todo=6`、文本 `todo 6`、`data-queue-ready=4`、`data-queue-pending=2`，同一测试里断言它等于对同一项目源的求和；用例「no queue reading draws no todo number rather than a false zero」⇒ 无队列读数时不画数字（不伪造 0）。
- AC-3（假形态变红，两次都只红对应用例，改完即还原、工作区干净、16/16 复绿）：变体 1「运行中 sha 改回读历史 `lastDeploy.targetSha`」⇒ `reads the RUNNING process…` 红：`expected '1 change not yet builtccccccc · aaaaa…' not to contain 'ccccccc'`。变体 2「缺失读数回落成旧 sha」⇒ `an unreadable build reading…` 红：`AssertionError: expected 'Deployment status unknownccccccc' not to match /[0-9a-f]{7}/`。还原：`git checkout -- src/modules/cockpit/DeployReadiness.tsx`，`git status --porcelain` 空。
- AC-4：`npm run typecheck` 退出 0（`tsconfig.json` / `server/tsconfig.json` / `scripts/tsconfig.json` 三段均无错误）；`npm run lint` 退出 0，仅既有 warning（`DeployReadiness.tsx` 仅 329 行既有的 set-state-in-effect；`CockpitPage.tsx` 的 warning 均在不属于本任务的行）。

### 边界与未做

- 未跑 fan-in 全量 suite、未调 fan-in（按调度约定由 worker-driver 接管）。
- 本会话 MCP 浏览器不可用，DoD 的「真实页面只读」由 Playwright 临时脚本 `tmp/dod-shot.mjs` 驱动真实构建产物完成（脚本与截图都在 gitignored 的 `tmp/` 下，未提交）。
- 该轴仍暗，理由：本任务只改驾驶舱部署读数的呈现与一个同模块类型引用，未改模块依赖分层或调用图，不产生 L_D（描述长度）/L_G（生成对齐）读数；本仓从未跑过 archguard 暗轴探针。

## Touches

- tasks/gap-cockpit-deploy-readout-truthful.md
- src/modules/cockpit/DeployReadiness.tsx
- src/modules/cockpit/tests/DeployReadiness.test.tsx
- src/modules/cockpit/CockpitPage.tsx
- src/shared/api.ts

## Blocker

**2026-10-29T07:18:07.508Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles src/modules/cockpit/CockpitPage.tsx 1902→1904 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：bae3047b-4982-407d-9a95-1b0de2157433
