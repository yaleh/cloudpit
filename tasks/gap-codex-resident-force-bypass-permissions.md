---
id: gap-codex-resident-force-bypass-permissions
title: codex resident 权限未强制对齐 claude resident（bypassPermissions）
status: todo
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

修复：在 `codex-host-driver.contract.ts` 增加 `CODEX_RESIDENT_PERMISSION_MODE='bypassPermissions'` 常量，`startResidentSession` 据此强制 resident 首轮 `permissionMode`，映射复用现成 `threadPermissionDefaults`（`codex-host-driver.contract.ts:165-176`，无需新映射）。

## AC

- [ ] AC1 resident 首轮恒带受信任权限：`codex-host-driver-persistent.test.ts` 新增用例，经 `driver.run` 冷启动 → 假 transport 断言：即使 `launch.options` 不含 `permissionMode`（或为 `'default'`），发出的首帧 `thread/start` params 仍含 `approvalPolicy:'never'` 且 `sandbox:'danger-full-access'`；`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0 且 fail 0。
- [ ] AC2 假形态必红：临时去掉强制（`startResidentSession` 改回直接消费原始 `launch.options.permissionMode`）⇒ AC1 用例红，抄下逐字失败行后还原。
- [ ] AC3 无回归：`npm run typecheck` 退出 0；不新增 server 测试文件（`git status --short` 仅列出已声明的 Touches 文件）。

## DoD

AC1/AC2 先红后绿实测，贴逐字失败行与 tests/pass/fail；部署后真实 codex resident 会话首轮 `thread/start` 帧（或 `turn_context`）读到 `approvalPolicy:'never'` + `sandbox:'danger-full-access'`，且该会话审批类 MCP 工具调用不再被 `user rejected MCP tool call` 拒绝（贴日志帧/读数）。

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/tests/codex-host-driver-persistent.test.ts
- tasks/gap-codex-resident-force-bypass-permissions.md