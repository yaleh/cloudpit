---
id: gap-architecture-refresh-react-free-controller
title: 架构：把 useArchitectureRefresh 的业务规则抽成 React-free controller
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 相关已完成任务：`gap-reply-suggestions-frontend-controller`（把 `useReplySuggestions` 的 8 个 `useState`+8 个 `useRef` 抽成 `createReplySuggestionsController` 的方法所在）已 done。本任务把同一方法套到架构 tab 的刷新 hook 上。

`src/modules/architecture/useArchitectureRefresh.ts` 现为 259 行，用 4 个 `useState` + 5 个 `useRef`（含 `deliveredJobs`/`observedRunning` 两个 Set 去重）在 hook 里持有「success 交付每个 job 只发生一次」「只有本 tab 看着跑完的 job 才算」等业务规则。按 reply-suggestions 方法抽 React-free controller：新建 `src/modules/architecture/architectureRefreshController.ts`，`createArchitectureRefreshController({api, clock})` 返回 `{subscribe, getSnapshot, refresh, dispose}`，规则全部迁入；hook 只留 `useSyncExternalStore` 订阅与转发参数；api 解析（`/api/architecture/refresh`、`/status`）收敛进 `src/shared/api.ts`，调用方不碰 `Response`。

## AC

- [x] controller 落地：`grep -n "createArchitectureRefreshController" src/modules/architecture/architectureRefreshController.ts` 命中工厂导出；`wc -l src/modules/architecture/useArchitectureRefresh.ts` ≤ 120 且 `grep -c "useState" src/modules/architecture/useArchitectureRefresh.ts` 输出 0。
- [x] 规则可离 React 测试：新增 `src/modules/architecture/tests/architectureRefreshController.test.ts`，用注入的假 api/clock 覆盖 once-per-job 交付、observed-running 去重、coalescing 三条规则；`npx vitest run src/modules/architecture/tests/architectureRefreshController.test.ts` exit 0。
- [x] 行为不回归：`npx vitest run src/modules/architecture/tests/useArchitectureRefresh.test.tsx src/modules/architecture/tests/architectureRefreshDialog.test.tsx` exit 0。
- [x] 类型检查：`npx tsc --noEmit -p tsconfig.json` exit 0；`npx oxlint src/modules/architecture` exit 0。

## DoD

MCP 浏览器在真实运行页面上走一遍手动刷新：打开架构 tab，点 footer 的刷新入口，确认对话框出现、POST 后状态条 running→succeeded、成功后图自动 refit；再开第二个 tab 观察同一 job 的 coalescing（不出现第二次 POST）。截图存 `tmp/` 并贴出；存在可用场景时同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告与检查点截图。

### 验证证据（2026-10-26，worker 会话）

**真实页面路径。** 本会话 ToolSearch 查 `browser playwright` 无匹配（无 MCP 浏览器），按 [[no-mcp-browser-use-throwaway-playwright-spec]] 的等价路径，直接跑仓里**既有**的真实浏览器判据 `e2e/architecture-refresh.spec.ts`（`playwright.config.ts` 已将它列入 `DEBUG_AGENT_SPEC_FILES`，并为该 selection 发布 fixture home、假 ArchGuard CLI、counter/control 文件与 `SERVER_SETTINGS_PATH`；无临时 spec、无临时 config 改动）。命令与结果：

```
npx playwright test e2e/architecture-refresh.spec.ts
  ✓ 1 manual refresh: confirm, coalesce, run, refetch and fail without touching the live analysis (25.4s)
  ✓ 2 control arm: removing single-flight and staging turns the same readings red (14.8s)
  2 passed (46.0s)
```

主用例逐步读数（`readRefreshEvidence`，断言在 spec 内）：baseline `footerState=idle`、`unresolved=1`、`counter=0` → 点 footer 刷新入口，确认对话框出现（`02-confirm-dialog.png`；Cancel 与 Escape 均 `counter=0`）→ 确认后 `dialogPhase=running`、footer `running` 且 `disabled=true`、对话框显示 elapsed（`03-running.png`）→ **第二页同时按刷新，counter 仍为 1**（server 合并成同一 job，不出现第二次 CLI/POST）→ 运行中打开的第三页读到共享 `running` 且不再提供启动入口（`04-mid-run-tab.png`）→ 成功后对话框关闭、`generatedAt` 更新、`unresolved` 1→0、`zoomMode` 由 `custom` 变为 `fit`（图自动 refit）、footer `succeeded`（`05-succeeded.png`）→ 失败臂显示原因与 Retry，且 live manifest 哈希与成功时逐字节相同（`06-failed-retry.png`）。控制臂把 single-flight 与 staging 去掉后同一读数变红（`07-control-no-coalesce.png`、`08-control-no-preserve.png`），证明主臂绿来自机制本身。

截图（`tmp/architecture-refresh/`，gitignored）：`01-baseline.png`、`02-confirm-dialog.png`、`03-running.png`、`04-mid-run-tab.png`、`05-succeeded.png`、`06-failed-retry.png`、`07-control-no-coalesce.png`、`08-control-no-preserve.png`。

**场景运行器。** `e2e/scenarios/` 现有 `cockpit-mode-switch.json` 与 `quay-wall-focus-pin-utter.json`，没有架构刷新场景，故「存在可用场景」条件不成立，未跑 `scripts/ui-scenario.mjs`；上条真实浏览器 spec 即本改动的行为回归。

**补充读数。** `useArchitectureRefresh.ts` 259 → 117 行；`useState` 4 → 0；`useRef` 5 → 2（onSucceededRef、无状态镜像）。控制器 322 行，导出：`IDLE_ARCHITECTURE_REFRESH_STATUS`、`createArchitectureRefreshController` + 类型 `ArchitectureRefreshApi`/`ArchitectureRefreshClock`/`ArchitectureRefreshSnapshot`/`ArchitectureRefreshController`。

**StrictMode。** 控制器改为「首个订阅者到达时启动 activation read 与计时器，最后一个订阅者离开时停表」，并用临时（已删除）StrictMode 探针验证：React 18 StrictMode 的 teardown→reset 之后 hook 仍能读到 `running`（旧 dispose-on-cleanup 写法在探针里读到 `idle`，故没有沿用）。产物未留在提交里。

## Touches

- src/modules/architecture/useArchitectureRefresh.ts
- src/modules/architecture/architectureRefreshController.ts (new)
- src/modules/architecture/tests/architectureRefreshController.test.ts (new)
- src/modules/architecture/tests/useArchitectureRefresh.test.tsx
- src/shared/api.ts
- src/shared/types.ts (the shared ArchitectureRefresh* type group the controller, hook and API now share)
- tasks/gap-architecture-refresh-react-free-controller.md

## Blocker

**2026-10-25T18:11:56.261Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：675990b3-abca-4768-8a29-2039ad1d7323

## Needs-Human

**执行 2026-10-25T19:36:58.233Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：60945e7a-7dea-40bc-9d75-2dc02b8f202a
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-architecture-refresh-react-free-controller~wk-prod-anchor~1792955356141-172d72.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-architecture-refresh-react-free-controller-wk-prod-anchor.log

## Needs-Human

**执行 2026-10-25T22:56:27.654Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 3 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：30344956-78da-4c78-abfd-7816b90dd198
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-architecture-refresh-react-free-controller~wk-prod-anchor~1792968653361-11d471.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-architecture-refresh-react-free-controller-wk-prod-anchor.log
