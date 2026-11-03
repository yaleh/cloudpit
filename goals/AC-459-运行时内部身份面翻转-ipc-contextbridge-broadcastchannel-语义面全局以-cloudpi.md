---
id: AC-459
title: 运行时内部身份面翻转：IPC/contextBridge/BroadcastChannel/语义面全局以 cloudpit- 为准，旧名零残留
status: achieved
kind: criterion
goal: GOAL-054
criterion: npx tsx --tsconfig server/tsconfig.json --test
  electron/tests/cloudpit-runtime-identity-surfaces.test.mjs
expect: Electron IPC 通道全部为 `cloudpit-desktop:*`（`electron/main.js` 的 `ipcMain`
  注册、`electron/preload.cjs` 的 `invoke`/`on`、`electron/desktopWindow.js` 的
  `webContents.send` 三处一致）；contextBridge 只暴露 `cloudpitDesktop` /
  `cloudpitDesktopNotifications`；架构独立页与工作区标签页的 BroadcastChannel 为
  `cloudpit-architecture`；dev-only 语义面为 `window.__cloudpitScenario`。旧名
  `cloudcli-desktop:`、`cloudcliDesktop*`、`cloudcli-architecture`、`__cloudcliScenario`
  在活代码面（`electron/`、`src/`、`scripts/`、`e2e/`、`AGENTS.md`）零命中；历史账本（`tasks/`、`goals/`、`adr/`、`experiments/`、`docs/proposals/`、`CHANGELOG`）按
  GOAL-054 非目标排除。语义面同步面包括
  `src/main.tsx`、`src/modules/ui-scenario/scenarioSurface.ts`、`src/modules/ui-scenario/index.ts`、`src/modules/ui-scenario/tests/scenarioSurface.test.ts`、`src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts`、`scripts/ui-scenario.mjs`、`e2e/ui-scenario-runner.spec.ts`、`e2e/scenarios/quay-wall-focus-pin-utter.json`、`AGENTS.md`；contextBridge
  新名消费面包括
  `electron/launcher/launcher.js`、`src/modules/settings/Settings.tsx`、`src/modules/settings/hooks/useWebPush.ts`。判据扫描器接受可注入
  root：正臂对 worktree 活代码根取证，负臂在 `tmp/` 夹具（旧名由常量拼接或置于夹具数据，判据文件自身不进入扫描）上验证，注入一条
  `cloudcli-desktop:` / `__cloudcliScenario`
  必须变红。非目标面保持原样并在同一判据中断言其存在：`cloudcli.ai`
  域名判定、`cloudcli://auth/callback`、`app_surface=cloudcli_desktop`、旧 appId 拼写
  `ai.cloudcli.desktop` 作为 v3.0 迁移常量保留在 `electron/appIdMigration.js` 的
  `LEGACY_DESKTOP_APP_ID`（活值 `APP_USER_MODEL_ID` 已是
  `ai.cloudpit.desktop`）；零命中扫描不得把 `cloudcli://` 一并禁掉。观测 URI 按 v3.0 R7 只接受
  `cloudpit://session|architecture`，旧拼写 `cloudcli://session|architecture` 必须解析为
  null（`src/modules/cockpit/tests/observationUri.test.ts` 同钉）。
origin: "人 yale 2026-11-01 经会话裁定采纳 gap-goal-054-runtime-identity-surfaces-ac 提案
  (a)；expect 按该任务 ## Resolution 的入册文本：零命中作用域为活代码面 electron/ src/ scripts/ e2e/
  AGENTS.md，历史账本（tasks/goals/adr/experiments/docs/proposals/CHANGELOG）按 GOAL-054
  非目标排除。GOAL-054 范围同步拆分：运行时默认值归 AC-452，运行时内部身份面归 AC-459。"
activatedAt: 2026-11-01T14:26:19.159Z
statusLog:
  - at: 2026-11-01T15:02:42.449Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
phase: pre-merge
---
