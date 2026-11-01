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

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-token-usage.service.test.ts` 退出 0，且含用例：reading 新增 `sessionSpend`/`contextOccupancy` 一等字段；Claude reading 的 `contextOccupancy.used`=最新一轮 input+output、`sessionSpend`=全量累计；`used`/`usageScope` 仍在（向后兼容）但未被新逻辑消费。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/commands/tests/commands.test.ts` 退出 0，且含**数据源负臂**：`/cost` 对 Claude 会话走 `getSessionTokenUsage(sessionId)` 取权威 reading，`cost.session.total === 全量累计`（不是最新一轮）；`context.tokenUsage` 仅注入 fallback。
- [x] 同一测试文件退出 0，且含**负臂**：context 语义 reading（无 `sessionSpend`、`usageScope` 缺省）经 `buildCostView` 产出**无 `session` 块**、只有 `context`；`readRequestSessionCounts` 已从 cost-view 删除（grep 无命中）。
- [x] 前端测试（chat/chat-session 相关文件）退出 0，且含用例：`tokenBudget` 状态拆 `liveFrame`/`authoritativeReading`，`/cost` 命令取 `authoritativeReading` 而非 liveFrame；composer 计数器仍用 liveFrame。
- [x] `grep -n "readRequestSessionCounts" server/modules/providers/services/cost-view.ts` 无命中；`npx tsc --noEmit -p tsconfig.json` 与 `npx tsc --noEmit -p server/tsconfig.json` 均退出 0。

## DoD

真实路径：v4pro 会话 `/cost` 的 `session.total` = 全量累计（118M 级），`context.used` = 最新一轮占用，`context.window` = 917000；三者来自同一条权威 reading，前端不再把实时帧当会话快照。`commands.test.ts` + `provider-token-usage.service.test.ts` + 前端测试全绿，`npm run typecheck`、`npm run build`、`npm run lint` 通过；`scripts/ui-scenarios/cost-panel-cache-ratio.json` 场景复跑仍 `ok:true`。backlink：`gap-cost-view-server-side-encapsulation`（done，本任务修其输入源洞）与 `gap-claude-history-reader-window-fallback`（done，窗口单一来源）。

## Evidence

2026-11-01，per-task worker 实测记录：

- AC1：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-token-usage.service.test.ts` → 22 pass / 0 fail，exit 0。新用例 `a Claude reading names its two scopes and keeps the legacy fields for older consumers` 钉住 `contextOccupancy.used = 4103 + 80 = 4183`、`contextOccupancy.total = 200000`、`sessionSpend` 为全量累计、`cumulative === sessionSpend`、`usageScope === undefined`；既有 Codex 用例仍断言旧 `usageScope` 值，兼容字段保持原样。
- AC2：`npx tsx --tsconfig server/tsconfig.json --test server/modules/commands/tests/commands.test.ts` → 16 pass / 0 fail，exit 0。数据源负臂 `cost command reads the authoritative session reading, never the injected live frame`：注入的 live frame 未被消费，`getSessionTokenUsage` 只被问一次且 sessionId 为 `session-1`，`cost.session.total = 118500000`（全量累计），`context.used = 437000`，`context.window = 917000`。
- AC3：同一文件 16 pass / 0 fail。负臂 `cost command derives no session block from a context-semantic reading`：reading 无 `sessionSpend`、`usageScope` 缺省 ⇒ `cost.session === undefined`，只有 `context`（used 120 / window 200000）。`readRequestSessionCounts` 已从 `cost-view.ts` 删除，`grep -rn` 全仓 0 命中（exit 1）。
- AC4：`npx vitest run src/modules/chat/tests/authoritativeTokenReadingChannels.test.tsx` → 4 pass / 0 fail；同批 16 个受影响前端测试文件合计 164 pass / 0 fail。四条用例分别钉：状态拆为 `liveFrame` / `authoritativeReading` 且互不干扰；`showCostModal()` 发出的 `context.tokenUsage` 深等于权威读数（不是 live frame），且 composer 状态的参数里根本没有 live frame；`TokenUsageSummary` 仍渲染 live frame 的 512K；`ChatInterface.tsx` 用 `tokenBudget={liveFrame}` 喂计数器、只把 `authoritativeReading` 交给 composer 状态。
- AC5：`grep -n "readRequestSessionCounts" server/modules/providers/services/cost-view.ts` 无命中（exit 1）；`npx tsc --noEmit -p tsconfig.json` 与 `npx tsc --noEmit -p server/tsconfig.json` 均 exit 0。
- DoD 真实路径：worktree dev server（:5199，`/api` 代理到运行中的 :3001 实例）上跑 `node scripts/ui-scenario.mjs scripts/ui-scenarios/cost-panel-cache-ratio.json`（会话「Claude Code 会话弹出的选项 dialog」，项目 `claudecodeui`）→ exit 0、`ok:true`、1 步通过，checkpoint `tmp/ui-dod-cost/step-1-open-cost-panel.png`；面板实际读数 `Total tokens used 2,116,419`（全会话累计，不是最新一轮）、cache hit rate 96%、input 2,109,555 / cached input 2,026,112。浏览器腿验证客户端通道拆分与面板读数，服务端权威来源由 AC1/AC2 的用例钉住。
- 门禁：`npm run lint` exit 0（0 error）、`npm run build` exit 0、`server/shared/tests/architecture-ratchet.test.ts` 6 pass / 0 fail；`useChatSessionState.ts` 的 hookStateHeavy 51→52 按 AC-394 以 baseline `note` 中的 RECORDED CHANGE 记录（2026-11-01，本任务），oversize 读数保持 2127 不变。

## Touches

- server/shared/interfaces.ts (reading 一等字段 sessionSpend/contextOccupancy，旧字段标 deprecated)
- server/modules/providers/services/cost-view.ts (收紧 buildCostView，删除 readRequestSessionCounts)
- server/modules/providers/services/provider-token-usage.service.ts (superseded 会话的 reading 同步带上 sessionSpend)
- server/modules/providers/list/claude/claude-token-usage.provider.ts (填 sessionSpend 与 contextOccupancy)
- server/modules/providers/list/codex/codex-token-usage-normalization.ts (填 sessionSpend 与 contextOccupancy.total)
- server/modules/providers/list/opencode/opencode-token-usage.provider.ts (填 sessionSpend)
- server/modules/providers/index.ts (导出 providerTokenUsageService 单例)
- server/modules/commands/commands.routes.ts (/cost 改取权威 reading，context.tokenUsage 仅作注入 fallback)
- server/modules/commands/commands.module.ts (把 providerTokenUsageService 注入 commands 依赖)
- server/modules/commands/tests/commands.test.ts (数据源负臂与无 session 块负臂)
- server/modules/providers/tests/provider-token-usage.service.test.ts (一等字段与兼容字段用例)
- server/shared/tests/architecture-ratchet.baseline.json (hookStateHeavy 51→52 的 AC-394 RECORDED CHANGE)
- src/modules/chat-session/hooks/useChatSessionState.ts (拆 liveFrame/authoritativeReading)
- src/modules/chat-session/hooks/useChatRealtimeHandlers.ts (实时 token_budget 只写 liveFrame)
- src/modules/chat-composer/hooks/useChatComposerState.ts (不再接受 live frame，只收 authoritativeReading)
- src/modules/chat-composer/hooks/useCommandMenuState.ts (命令上下文 tokenUsage 取自 authoritativeReading)
- src/modules/chat/ChatInterface.tsx (tokenBudget={liveFrame}；composer 状态只收 authoritativeReading)
- src/modules/chat/tests/authoritativeTokenReadingChannels.test.tsx (新增，四条通道拆分用例)
- src/modules/chat/tests/chatComposerReplyChips.test.tsx (移除已删除的 tokenBudget 入参)
- src/modules/chat/tests/chatRealtimeIgnoresActivityHeartbeat.test.tsx (setTokenBudget → setLiveFrame)
- src/modules/chat/tests/composerClearInput.test.tsx (移除已删除的 tokenBudget 入参)
- src/modules/chat/tests/composerDraftScoping.test.tsx (移除已删除的 tokenBudget 入参)
- src/modules/chat/tests/composerNewSessionSelection.test.tsx (移除已删除的 tokenBudget 入参)
- src/modules/chat/tests/composerToolsSettingsResolution.test.ts (移除已删除的 tokenBudget 入参)
- src/modules/chat/tests/inputSuggestionsComposer.test.tsx (移除已删除的 tokenBudget 入参)
- src/modules/chat/tests/inputSuggestionsDockTurn.test.tsx (移除已删除的 tokenBudget 入参)
- src/modules/chat/tests/occupiedSessionReadOnly.test.tsx (移除已删除的 tokenBudget 入参)
- src/modules/chat/tests/pendingDeliveriesSnapshot.test.tsx (setTokenBudget → setLiveFrame)
- src/modules/chat/tests/permissionPromptReplay.test.tsx (setTokenBudget → setLiveFrame)
- src/modules/chat/tests/replayCursorAcrossRuns.test.tsx (setTokenBudget → setLiveFrame)
- src/modules/chat/tests/sessionPermissionMode.test.tsx (移除已删除的 tokenBudget 入参)
- src/modules/chat/tests/tokenBudgetSessionScope.test.tsx (setTokenBudget → setLiveFrame)
- src/modules/chat/tests/unviewedSessionStreamAccumulation.test.tsx (setTokenBudget → setLiveFrame)
- tasks/gap-authoritative-token-reading-used-scope-elimination.md

该轴仍暗,理由:本任务只收敛 token 读数语义（reading 一等字段、/cost 权威来源、前端通道拆分），L_D/L_G 架构或文档轴读数与本次改动无关。
