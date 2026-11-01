---
id: gap-ac459-runtime-identity-surfaces-criterion
title: AC-459 判据：运行时内部身份面专用测试（IPC/contextBridge/BroadcastChannel/语义面全局）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-459
---
## Proposal

AC-459（运行时内部身份面翻转，`status: active`、`phase: pre-merge`）的专用判据任务。四面的**改名实现已由 `gap-goal-054-ac451-ac452-false-form-legs-unverified-by-criterion` 在 goal 分支落地**（task done；goal tip `fbda49cb4`；实现提交 `6b2d6407f`，19 个文件）。goal 分支现状读数：`cloudcli-desktop:` 0 处、`cloudpit-desktop:` 54 处；`__cloudcliScenario` 活代码 0、`__cloudpitScenario` 9；`cloudcli-architecture` 活代码 0。本任务**只补 AC-459 的 criterion 文件** `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`，不重做改名、不改源码。

判据覆盖面（逐项对应 AC-459 的 expect）：

- IPC 三处一致：`electron/main.js` 的 `ipcMain` 注册、`electron/preload.cjs` 的 `invoke`/`on`、`electron/desktopWindow.js` 的 `webContents.send` 全部为 `cloudpit-desktop:*`；旧名 `cloudcli-desktop:` 在活代码面零命中。
- contextBridge：只暴露 `cloudpitDesktop` / `cloudpitDesktopNotifications`；消费面 `electron/launcher/launcher.js`、`src/modules/settings/Settings.tsx`、`src/modules/settings/hooks/useWebPush.ts` 无旧名。
- BroadcastChannel：`src/modules/architecture/architectureChatBridge.ts` 的常量为 `cloudpit-architecture`；`cloudcli-architecture` 活代码零命中。
- 语义面：`window.__cloudpitScenario`；同步面 `src/main.tsx`、`src/modules/ui-scenario/scenarioSurface.ts`、`src/modules/ui-scenario/index.ts`、`src/modules/ui-scenario/tests/scenarioSurface.test.ts`、`src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts`、`scripts/ui-scenario.mjs`、`e2e/ui-scenario-runner.spec.ts`、`e2e/scenarios/quay-wall-focus-pin-utter.json`、`AGENTS.md` 均无旧名。
- 活代码扫描面：`electron/`、`src/`、`scripts/`、`e2e/`、`AGENTS.md`。历史账本（`tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG`）按 GOAL-054 非目标排除，不得为凑零命中改写。
- 非目标面正断言：`cloudcli.ai` 域名判定、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、appId `ai.cloudcli.desktop`、AC-452 的 `cloudcli://` 观测 URI 双读仍在；零命中扫描不得把 `cloudcli://` 一并禁掉。

判据实现约束：扫描器接受可注入 root；负臂在 `tmp/` 夹具上注入旧名并断言红；判据文件自身不进入扫描（旧名由常量拼接或只放夹具数据，避免自命中）；不得硬编码 main checkout 的绝对路径，使用 worktree 的 `process.cwd()`。

## AC

- [ ] AC1: 新增 `electron/tests/cloudpit-runtime-identity-surfaces.test.mjs`；在 goal 分支的 task worktree 上运行 `npx tsx --tsconfig server/tsconfig.json --test electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 退出 0，输出含 `fail 0`。
- [ ] AC2: 负臂：同一判据在 `tmp/` 夹具中注入一条 `cloudcli-desktop:` 与一条 `__cloudcliScenario` 后必须变红并报 violation；夹具不写进源码树，负臂随主判据一起运行并通过。
- [ ] AC3: 非目标面正断言：同一判据断言 `cloudcli.ai`、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、appId `ai.cloudcli.desktop` 与 `cloudcli://` 观测 URI 双读存在；并断言扫描根不含历史账本。
- [ ] AC4: 变异证明：把 `electron/preload.cjs` 的一条 `cloudpit-desktop:` 通道临时改回 `cloudcli-desktop:`，同一判据必须红；恢复后复跑绿。贴红/绿两次读数。
- [ ] AC5: 读回 `quay goal show AC-459 --json` 仍为 `goal: GOAL-054`、`phase: pre-merge`、criterion 逐字为本任务的命令；本任务不写 goal store、不改 AC-459 的 criterion/expect。

## DoD

在 `goal/GOAL-054` 的 task worktree 上真跑判据并贴末行 `tests N / pass N / fail 0` 与耗时；贴 AC2 注入负臂的红/绿读数；贴 AC4 变异红、恢复后绿两次读数；贴 `npx oxlint electron/tests/cloudpit-runtime-identity-surfaces.test.mjs` 退出码。⛔ 不重做改名、不改源码、不写 `goals/*.md`、不改 AC-459 的 criterion/expect。判据必须能在改名被回退时变红，不能只断言文件存在。

## Touches

- tasks/gap-ac459-runtime-identity-surfaces-criterion.md
- electron/tests/cloudpit-runtime-identity-surfaces.test.mjs (new, AC-459 criterion)
