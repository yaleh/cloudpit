---
id: gap-cost-view-server-side-encapsulation
title: Encapsulate /cost derivation server-side as a unified provider-agnostic
  cost view
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`/cost` 的派生逻辑现在是劈开的：服务端 `buildStructuredCostData`（`commands.routes.ts`）产出 `tokenUsage{used,total,scope,cumulative,lastRequest}` + `tokenBreakdown`，前端 `CostContent.tsx` 自己再算 `sessionTotal`、`cacheHitRatio`、`fresh`、三段占比（`buildCacheUsageBreakdown`），还背着两套布局和一个 provider 相关的 `cacheAccountingNote`。`used`/`scope` 双关（Claude `used`=最新一轮占用、Codex `used`=会话累计）已经漏成两个可见 bug：server 硬编码 `scope:"session-cumulative"`、面板把 Claude 的占用（~271K）标成「Total tokens used」；composer 的 `TokenUsageSummary` 又在别处用 `isCumulativeScope` 重实现同一套判定。

本任务把派生收敛到服务端一处，产出跨 provider 归一、前端只渲染的 `CostView`：

```
CostView = {
  session?:    { total, input, output, cacheRead?, cacheWrite?, reasoningOutput?, cacheHitRatio?, fresh? },
  context?:    { used?, window? },
  lastRequest?: ProviderTokenUsageCounts,
  accountingNote: string,
}
```

- `used`/`usageScope` 只在 `buildCostView(reading, provider)` 里判定一次：`usageScope === 'session-cumulative'` ⇒ `used` 落 `session.total`；否则 ⇒ `context.used`。`/cost` wire 不再带顶层 `used`/`scope`（不留别名）。
- `cacheHitRatio = cacheRead/input`、`fresh = input − cacheRead − cacheWrite` 由服务端派生（仅当 cacheRead 已报），前端直接取值。
- `accountingNote` 搬服务端（cost-view 模块内 provider→文案映射）；前端删掉 `PROVIDER_DESCRIPTORS.cacheAccountingNote` 与 `FALLBACK_CACHE_ACCOUNTING_NOTE`。

落位：`server/modules/providers/services/cost-view.ts`（纯派生，经 providers barrel 导出），`/cost` 执行器消费它返回 `data.cost`。reading 的 `used`/`usageScope`/`cumulative`/`lastRequest` 原样保留——composer 计数器与 history 页还在用，不动。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/commands/tests/commands.test.ts` 退出 0，且含用例：Claude 形 reading（无 `usageScope`）产出 `cost.session.total === cumulative.input+output`、`cost.context.used === used`、`cost.session.cacheHitRatio`/`fresh` 为派生值、`cost.accountingNote` 来自服务端映射，且 wire 上不存在顶层 `used`/`scope` 键。
- [ ] 同一测试文件退出 0，且含用例：Codex 形 reading（`usageScope:'session-cumulative'`）产出 `cost.session.total === cumulative.totalTokens`、`cost.context.window === total`、`cost.context.used` 缺省。
- [ ] `bash scripts/with-memory-cap.sh vitest run src/modules/chat-support/tests/CostContent.test.tsx` 退出 0，且组件只消费 `data.cost`：`buildCacheUsageBreakdown`/`formatCacheHitRatio` 不再从组件文件导出，`accountingNote` 取自 `data.cost.accountingNote`，无 `resolveProviderDescriptor`/`FALLBACK_CACHE_ACCOUNTING_NOTE` 引用。
- [ ] `npx tsc --noEmit -p tsconfig.json` 退出 0；`grep -nE "provider ===? '" src/modules/chat-support/modals/CostContent.tsx` 无命中（单一布局、无 provider 分支）。

## DoD

真实路径：`/cost` 命令返回 `data.cost`（统一视图），面板按 session/context/lastRequest 三块渲染，命中率/fresh/accountingNote 全取自服务端派生值，前端不再做任何 provider 判定或派生。`commands.test.ts` + `CostContent.test.tsx` 全绿，`npm run typecheck`、`npm run build`、`npm run lint` 通过；`scripts/ui-scenarios/cost-panel-cache-ratio.json` 场景复跑仍 `ok:true`（它读 DOM 的 `data-cost-*`，行标签/role 不变即活）。reading 的 `used`/`usageScope` 保持不变，composer 计数器与 history 页无回归。

## Touches

- server/modules/providers/services/cost-view.ts (new)
- server/modules/providers/index.ts (barrel 导出 cost-view)
- server/modules/commands/commands.routes.ts (改消费 buildCostView)
- server/modules/commands/tests/commands.test.ts
- src/shared/types.ts (CostCommandData 改为 cost 视图，退役 tokenUsage/tokenBreakdown)
- src/modules/chat-support/modals/CostContent.tsx
- src/modules/chat-support/tests/CostContent.test.tsx
- src/shared/constants.ts (PROVIDER_DESCRIPTORS 删 cacheAccountingNote)
- tasks/gap-cost-view-server-side-encapsulation.md
