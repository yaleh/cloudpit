---
id: gap-codex-resident-first-turn-permission-mode
title: 修复 codex resident 首轮 thread/start 丢弃 permissionMode：映射成 approvalPolicy+sandbox
status: ready
labels: []
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`provider-runtime.service.ts` 的 `defaultResidentLaunchOptions` 把会话的 `permissionMode` 放进 resident 启动选项；但 `codex-host-driver.contract.ts` 的 `threadDefaultsFromLaunchOptions` 只取 `cwd`/`model`，`permissionMode` 被丢弃，于是首轮 `thread/start`（经 `threadParams`）不带 `approvalPolicy`/`sandbox`。结果 codex resident 首轮跑在 app-server 自己的默认 sandbox/approval 上，既不是 GOAL-051 裁定的「workspace-write + never」，也不是 claude resident 的 `bypassPermissions` 等价物（`claude-host-driver.provider.ts` 的 `RESIDENT_PERMISSION_MODE='bypassPermissions'`）。

## Plan

1. 把 `permissionMode` 映射进 `threadDefaultsFromLaunchOptions`：有 `permissionMode` 字符串时，写入 thread/start 形状的 `approvalPolicy` + `sandbox`。注意形状差异：thread/start 用 `sandbox` 字符串（如 `workspace-write`），live settings 用 `sandboxPolicy` 对象——本任务要出 thread/start 形状，不要照搬 `codex-live-settings.ts` 的对象形状。
2. 语义对齐 claude resident 受信任语义：`bypassPermissions` → `approvalPolicy='never'` + `sandbox` 全访问值（app-server 等价值）；其余 permissionMode 至少落 GOAL-051 的 workspace-write + 对应 approvalPolicy；无 permissionMode 时不写这两个字段（保持现行为）。
3. 不新建 server 测试文件：用例加进既有 `server/modules/providers/tests/codex-host-driver-persistent.test.ts`（或既有 codex 测试文件）。

## AC

- [ ] AC1 **首轮 thread/start 带权限映射**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0 且 fail 0；新增用例断言 `permissionMode:'bypassPermissions'` 的启动选项经 `threadDefaultsFromLaunchOptions` 后，`threadParams` 产出含 `approvalPolicy:'never'` 且 `sandbox` 为全访问值；无 permissionMode 时不写这两个字段（行为不变）。
- [ ] AC2 **假形态必红**：临时让 `threadDefaultsFromLaunchOptions` 重新丢弃 `permissionMode` ⇒ AC1 用例红；抄下逐字失败行后还原。
- [ ] AC3 **无回归**：`npm run typecheck` 退出 0；不新增 server 测试文件（避免连带 quay-test-script collected/unknown 钉子与 suite-duration-baseline 覆盖率下限）。

## DoD

AC1/AC2 先红后绿实测，贴逐字失败行与 tests/pass/fail；部署后真实 codex resident 会话的首轮 `thread/start` 帧里能读到 `approvalPolicy`/`sandbox`（贴日志帧）。

## Touches

- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/tests/codex-host-driver-persistent.test.ts
- tasks/gap-codex-resident-first-turn-permission-mode.md
