---
id: gap-architecture-refresh-react-free-controller
title: 架构：把 useArchitectureRefresh 的业务规则抽成 React-free controller
status: ready
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

- [ ] controller 落地：`grep -n "createArchitectureRefreshController" src/modules/architecture/architectureRefreshController.ts` 命中工厂导出；`wc -l src/modules/architecture/useArchitectureRefresh.ts` ≤ 120 且 `grep -c "useState" src/modules/architecture/useArchitectureRefresh.ts` 输出 0。
- [ ] 规则可离 React 测试：新增 `src/modules/architecture/tests/architectureRefreshController.test.ts`，用注入的假 api/clock 覆盖 once-per-job 交付、observed-running 去重、coalescing 三条规则；`npx vitest run src/modules/architecture/tests/architectureRefreshController.test.ts` exit 0。
- [ ] 行为不回归：`npx vitest run src/modules/architecture/tests/useArchitectureRefresh.test.tsx src/modules/architecture/tests/architectureRefreshDialog.test.tsx` exit 0。
- [ ] 类型检查：`npx tsc --noEmit -p tsconfig.json` exit 0；`npx oxlint src/modules/architecture` exit 0。

## DoD

MCP 浏览器在真实运行页面上走一遍手动刷新：打开架构 tab，点 footer 的刷新入口，确认对话框出现、POST 后状态条 running→succeeded、成功后图自动 refit；再开第二个 tab 观察同一 job 的 coalescing（不出现第二次 POST）。截图存 `tmp/` 并贴出；存在可用场景时同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴出 JSON 报告与检查点截图。

## Touches

- src/modules/architecture/useArchitectureRefresh.ts
- src/modules/architecture/architectureRefreshController.ts (new)
- src/modules/architecture/tests/architectureRefreshController.test.ts (new)
- src/modules/architecture/tests/useArchitectureRefresh.test.tsx
- src/shared/api.ts
- tasks/gap-architecture-refresh-react-free-controller.md