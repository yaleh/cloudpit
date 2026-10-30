---
id: gap-codex-resident-force-bypass-permissions
title: codex resident 权限未强制对齐 claude resident（bypassPermissions）
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Claude resident 把权限无条件钉死为 `bypassPermissions`：`claude-host-driver.provider.ts:281` 定义 `RESIDENT_PERMISSION_MODE='bypassPermissions'`，`:1606-1607` 在 resident 启动时强制 `sdkOptions.permissionMode=RESIDENT_PERMISSION_MODE` 并同时设 `allowDangerouslySkipPermissions=true`。Codex resident 缺少这一强制层：`codex-host-driver.provider.ts` 的 `startResidentSession` 只把 `launch.options.permissionMode`（来自 `defaultResidentLaunchOptions` → 会话行 `permission_mode`，未设过时为 NULL）交给 `threadDefaultsFromLaunchOptions` 映射成 `approvalPolicy`/`sandbox`。于是没存过权限或存 `default` 的 resident codex 会话首轮 `thread/start` 不带这两个字段（或带 `on-request` + `workspace-write`），落在 app-server 默认 `on-request`，审批类工具调用（如 `mcp__quay__task_list`）被回 `user rejected MCP tool call`（实测 2026-10-30 23:13 会话）。

<!-- dedup-ref --> 相关任务 `gap-codex-resident-first-turn-permission-mode`（done）只修了发射端映射（`bypassPermissions` → `never` + `danger-full-access`），其 DoD 明确「真实 resident 首轮帧待部署后回读」；本次回读确认仍未对齐。

修复：在 `codex-host-driver.contract.ts` 增加 `CODEX_RESIDENT_PERMISSION_MODE='bypassPermissions'` 常量，`startResidentSession` 据此强制 resident 首轮 `permissionMode`，映射复用现成 `threadPermissionDefaults`（`codex-host-driver.contract.ts`，无需新映射）。

## AC

- [x] AC1 resident 首轮恒带受信任权限：`codex-host-driver-persistent.test.ts` 新增用例，经 `driver.run` 冷启动 → 假 transport 断言：即使 `launch.options` 不含 `permissionMode`（或为 `'default'`），发出的首帧 `thread/start` params 仍含 `approvalPolicy:'never'` 且 `sandbox:'danger-full-access'`；`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0 且 fail 0。
- [x] AC2 假形态必红：临时去掉强制（`residentThreadDefaults` 改回直接消费原始 `launch.options`）⇒ AC1 用例红，抄下逐字失败行后还原。
- [x] AC3 无回归：`npm run typecheck` 退出 0；不新增 server 测试文件（`git status --short` 仅列出已声明的 Touches 文件）。

## DoD

AC1/AC2 先红后绿实测，贴逐字失败行与 tests/pass/fail；部署后真实 codex resident 会话首轮 `thread/start` 帧（或 `turn_context`）读到 `approvalPolicy:'never'` + `sandbox:'danger-full-access'`，且该会话审批类 MCP 工具调用不再被 `user rejected MCP tool call` 拒绝（贴日志帧/读数）。

## 实测

- AC1：新增用例 `a resident cold start forces the trusted permission pair without a stored mode (AC1)`（`driver.run` 冷启动 + 假 transport，分别以 `options:{}` 与 `options:{permissionMode:'default'}` 驱动）。读数 `noModeApproval=never noModeSandbox=danger-full-access storedDefaultApproval=never storedDefaultSandbox=danger-full-access`；整文件 `tests 11 / pass 11 / fail 0`，退出 0。
- AC2：临时把强制去掉（`residentThreadDefaults` 改为 `threadDefaultsFromLaunchOptions(options)`）后同一文件得 `tests 11 / pass 10 / fail 1`，退出 1，逐字失败行：
  ```
  AssertionError [ERR_ASSERTION]: a launch with no stored mode must still send approvalPolicy=never
  + actual - expected

  + undefined
  - 'never'
  ```
  还原后复跑，回到 `tests 11 / pass 11 / fail 0`，退出 0。
- AC3：`npm run typecheck` 退出 0；`npx oxlint` 三个改动文件退出 0；改动仅已声明的 Touches 三个实现/测试文件，未新增 server 测试文件。
- 棘轮修复（上一轮 exited-not-landed 原因）：强制逻辑内联在 `startResidentSession` 时 `codex-host-driver.provider.ts` 835→844，越过 oversizeFiles 基线（只允许下降）。本轮把覆盖逻辑移入 contract 叶子的 `residentThreadDefaults(options)`（`codex-host-driver.contract.ts` 417 行，不在基线内），provider 侧只留一行 `threadDefaults: residentThreadDefaults(launch.options)`，实测 `wc -l` 回到 **835**（= 基线）；`architecture-ratchet.test.ts` 复跑 `tests 6 / pass 6 / fail 0`，无 `ratchet:` 红行。
- DoD 部署后读数：待部署（待外部）。本 worktree 未部署运行中的 codex resident，真实首轮 `thread/start` 帧与审批类 MCP 工具调用的部署后回读需在部署后进行。

## ADR-007 暗轴

该轴仍暗,理由:本任务只强制 resident 首轮权限注入并补测试，不改架构层级或依赖图，无 L_D/L_G 读数。

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/tests/codex-host-driver-persistent.test.ts
- tasks/gap-codex-resident-force-bypass-permissions.md

## Blocker

**2026-10-30T16:00:08.464Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/architecture-ratchet.test.ts:   AssertionError [ERR_ASSERTION]: ratchet: oversizeFiles server/modules/providers/list/codex/codex-host-driver.provider.ts 835→844 — 基线内读数不得上调（此基线只允许下降） [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/shared/tests/architecture-ratchet.test.ts,server/shared/tests/architecture-ratchet.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：4d3bc73e-f3dd-4d9f-adcb-ade49cd0dd3d
