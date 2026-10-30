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

- [x] AC1 **首轮 thread/start 带权限映射**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0 且 fail 0；新增用例断言 `permissionMode:'bypassPermissions'` 的启动选项经 `threadDefaultsFromLaunchOptions` 后，`threadParams` 产出含 `approvalPolicy:'never'` 且 `sandbox` 为全访问值；无 permissionMode 时不写这两个字段（行为不变）。
- [x] AC2 **假形态必红**：临时让 `threadDefaultsFromLaunchOptions` 重新丢弃 `permissionMode` ⇒ AC1 用例红；抄下逐字失败行后还原。
- [x] AC3 **无回归**：`npm run typecheck` 退出 0；不新增 server 测试文件（避免连带 quay-test-script collected/unknown 钉子与 suite-duration-baseline 覆盖率下限）。

## DoD

AC1/AC2 先红后绿实测，贴逐字失败行与 tests/pass/fail；部署后真实 codex resident 会话的首轮 `thread/start` 帧里能读到 `approvalPolicy`/`sandbox`（贴日志帧）。

### Evidence (2026-10-30, worktree gap-codex-resident-first-turn-permission-mode @ 692e084e0)

AC1 绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts`

```
bypassApproval=never bypassSandbox=danger-full-access defaultApproval=on-request defaultSandbox=workspace-write noModeHasApproval=false noModeHasSandbox=false
wireThreadStart={"approvalPolicy":"never","sandbox":"danger-full-access"}
✔ the first thread/start carries the launch permission mode (AC1) (0.997117ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

新增用例含两条腿：纯函数腿 `threadDefaultsFromLaunchOptions` → `threadParams`（bypass ⇒ never/danger-full-access；default ⇒ on-request/workspace-write；无 permissionMode ⇒ 两字段都不写），以及经 `driver.run` 冷启动 → 假 transport 的线上腿，断言实际发出的首帧 `thread/start` params 带 `approvalPolicy:'never'` + `sandbox:'danger-full-access'`。

AC2 假形态实测（删掉 permissionMode 映射块后逐字失败行，已还原）：

```
bypassApproval=undefined bypassSandbox=undefined defaultApproval=undefined defaultSandbox=undefined noModeHasApproval=false noModeHasSandbox=false
✖ the first thread/start carries the launch permission mode (AC1) (0.857171ms)
ℹ tests 9
ℹ pass 8
ℹ fail 1
  AssertionError [ERR_ASSERTION]: bypassPermissions must reach thread/start as the trusted app-server equivalent
  + actual - expected
    actual: { approvalPolicy: undefined, sandbox: undefined },
    expected: { approvalPolicy: 'never', sandbox: 'danger-full-access' },
```

还原后复跑 `tests 9 / pass 9 / fail 0`。

AC3：worktree 内 `npm run typecheck` EXIT=0（三段 tsc 全过）；`git status --short` 只有两条已声明的既有文件，未新增 server 测试文件。

实现要点：映射落在 `threadPermissionDefaults`，产出 thread/start 的字符串 `sandbox`（不是 live settings 的 `sandboxPolicy` 对象）；取值与 per-run SDK 的 `mapPermissionModeToCodexOptions` 一致，但留在叶子 contract 内而不反向 import provider 模块。

DoD 第二半（部署后真实 codex resident 首轮 `thread/start` 帧）在合并/部署前无法观测，本任务只保证发射端形状；线上帧待部署后回读。

该轴仍暗,理由:本任务只改一个既有叶子 contract 的纯映射函数并扩写既有测试文件，未新增模块、包级依赖边或循环，L_D/L_G 读数与本次缺陷无关（worktree 内亦无 archguard 读数来源）。

## Touches

- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/tests/codex-host-driver-persistent.test.ts
- tasks/gap-codex-resident-first-turn-permission-mode.md
