---
id: gap-authoritative-token-reading-used-scope-elimination
title: One authoritative token-usage reading; eliminate the used/scope
  dual-meaning; strict buildCostView
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

本会话所有 token 统计 bug 是同一个根源的反复复发：`used`/`scope` 双关让每个消费者各自解释语义，且没有一个唯一的权威读数入口（`/cost` 吃前端混出来的实时帧、history 页自己算、composer 再自己判）。封装 task（`gap-cost-view-server-side-encapsulation`，done）把派生收敛到了 `buildCostView`，但两处洞仍漏：`/cost` handler 仍吃 `context.tokenUsage`（实时帧 = 最新一轮、无 cumulative），`buildCostView` 又用 `readRequestSessionCounts` 把最新一轮缝成 session——于是线上 `/cost` 的「Total tokens used」显示 437K 而非全量 118.5M。

本任务一次收敛：reading 加一等字段消灭双关、`/cost` 改从唯一入口取权威读数、`buildCostView` 禁止缝 session、前端把实时帧与权威读数分开。

修法：
1. `ProviderTokenUsageReading` 加 `sessionSpend`（= 现 `cumulative`，一等字段）与 `contextOccupancy: { used, total }`；`used`/`usageScope` 保留为 deprecated 兼容字段，新代码不消费。Claude：`sessionSpend`=全量累计、`contextOccupancy.used`=最新一轮、`contextOccupancy.total`=窗口；Codex：`sessionSpend`=cumulative、`contextOccupancy.total`=窗口、`contextOccupancy.used` 缺省。
2. `/cost` handler 改从 `providerTokenUsageService.getSessionTokenUsage(sessionId)` 取权威读数（有 `sessionSpend`），`context.tokenUsage` 仅作测试注入 fallback。
3. `buildCostView` 收紧：`session` 只来自 `sessionSpend`；删除 `readRequestSessionCounts`——无 session 数据就不产出 `session` 块，不缝。
4. 前端 `tokenBudget` 状态拆 `liveFrame`（实时帧，喂 composer 计数器）与 `authoritativeReading`（喂 /cost），`pickFresherTokenUsage` 不再把两者混给 /cost。
5. 窗口回归钉：三路径（/cost、history `fetchHistory`、实时帧）都解析模型窗口（v4pro=917000），无 160000 回退。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-token-usage.service.test.ts` 退出 0，且含用例：reading 新增 `sessionSpend`/`contextOccupancy` 一等字段；Claude reading 的 `contextOccupancy.used`=最新一轮 input+output、`sessionSpend`=全量累计；`used`/`usageScope` 仍在（向后兼容）但未被新逻辑消费。
- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/commands/tests/commands.test.ts` 退出 0，且含**数据源负臂**：`/cost` 对 Claude 会话走 `getSessionTokenUsage(sessionId)` 取权威 reading，`cost.session.total === 全量累计`（不是最新一轮）；`context.tokenUsage` 仅注入 fallback。
- [ ] 同一测试文件退出 0，且含**负臂**：context 语义 reading（无 `sessionSpend`、`usageScope` 缺省）经 `buildCostView` 产出**无 `session` 块**、只有 `context`；`readRequestSessionCounts` 已从 cost-view 删除（grep 无命中）。
- [ ] 前端测试（chat/chat-session 相关文件）退出 0，且含用例：`tokenBudget` 状态拆 `liveFrame`/`authoritativeReading`，`/cost` 命令取 `authoritativeReading` 而非 liveFrame；composer 计数器仍用 liveFrame。
- [ ] `grep -n "readRequestSessionCounts" server/modules/providers/services/cost-view.ts` 无命中；`npx tsc --noEmit -p tsconfig.json` 与 `npx tsc --noEmit -p server/tsconfig.json` 均退出 0。

## DoD

真实路径：v4pro 会话 `/cost` 的 `session.total` = 全量累计（118M 级），`context.used` = 最新一轮占用，`context.window` = 917000；三者来自同一条权威 reading，前端不再把实时帧当会话快照。`commands.test.ts` + `provider-token-usage.service.test.ts` + 前端测试全绿，`npm run typecheck`、`npm run build`、`npm run lint` 通过；`scripts/ui-scenarios/cost-panel-cache-ratio.json` 场景复跑仍 `ok:true`。backlink：`gap-cost-view-server-side-encapsulation`（done，本任务修其输入源洞）与 `gap-claude-history-reader-window-fallback`（done，窗口单一来源）。

## Touches

- server/shared/interfaces.ts (reading 加 sessionSpend/contextOccupancy)
- server/modules/providers/services/cost-view.ts (收紧 buildCostView，删 readRequestSessionCounts)
- server/modules/providers/services/provider-token-usage.service.ts (唯一入口/转发)
- server/modules/providers/list/claude/claude-token-usage.provider.ts (填 sessionSpend/contextOccupancy)
- server/modules/providers/list/codex/codex-token-usage-normalization.ts (填 sessionSpend)
- server/modules/commands/commands.routes.ts (/cost 改取权威 reading)
- server/modules/commands/tests/commands.test.ts
- server/modules/providers/tests/provider-token-usage.service.test.ts
- src/modules/chat-session/hooks/useChatSessionState.ts (拆 liveFrame/authoritativeReading)
- src/modules/chat-session/hooks/useChatRealtimeHandlers.ts
- src/modules/chat-composer/hooks/useCommandMenuState.ts
- tasks/gap-authoritative-token-reading-used-scope-elimination.md
