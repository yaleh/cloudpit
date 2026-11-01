---
id: gap-cost-panel-cache-hit-ratio-and-cachewrite-bar
title: Cost panel cache-hit ratio + fresh/cacheRead/cacheWrite bar +
  per-provider usage-scope copy
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`CostContent`（`src/modules/chat-support/modals/CostContent.tsx`）目前把 `cumulative`/`lastRequest` 里的 `cacheReadTokens` 当 subset 行渲染，但从不给出缓存命中率，也不渲染 `cacheWriteTokens`（前端 `TokenUsageCounts` 还没有这个字段，`buildStructuredCostData` 也故意不发任何 ratio）。命中率 = `cacheRead/input` 是免费、跨 provider 可比的效率读数，正好解释跨 provider 花费差异。本任务给 `/cost` 面板补三样，不推翻现有三块布局：命中率行、fresh/cacheRead/cacheWrite 三段占比条、每 provider 一条「input 已含缓存」的口径说明。

命中率与三段占比是纯展示推导，不是状态机：`ratio = cacheRead/input`（两者都在 `cumulative` 时给出）、`fresh = input - cacheRead - cacheWrite`（cacheWrite 缺失则只减 cacheRead）。把它做成一个 React-free 的纯函数并单测，组件只渲染结果。`cacheWriteTokens?` 加进前端镜像类型 `TokenUsageCounts`（`src/shared/types.ts`），渲染规则与现有 `cacheReadTokens` 一致：缺失即不渲染、不伪造 0；`tokenBreakdown` 补 `cacheWrite?`。口径说明是 provider 差异，按 frontend-module-standards 走 `PROVIDER_DESCRIPTORS`（`src/shared/constants.ts`）加属性，**不写 `provider === 'claude'` 分支**。

因为 `TokenUsageCounts` 是手抄的服务器 wire 形状且当前无钉，本任务同时给 `src/shared/tests/wireContractTypeSync.test.ts` 补一条 TypeSync 判据：同时读 `server/shared/interfaces.ts` 的 `ProviderTokenUsageCounts` 与 `src/shared/types.ts` 的 `TokenUsageCounts` 字段名集合，任一侧漂移即红。后端 `cumulative`/`cacheWrite` 字段由 `gap-claude-session-cumulative-spend-cachewrite-counts`（backend）落地，本任务的单测用注入 props 直接喂数据，不依赖后端在线；UI 验证走已含 `cumulative.cacheRead` 的 Codex 会话。

## AC

- [ ] `bash scripts/with-memory-cap.sh vitest run src/modules/chat-support/tests/CostContent.test.tsx` 退出 0，且其中断言：counts 带 `cacheWriteTokens` 时渲染出带 subset hint 的缓存写行、缺省时零渲染；命中率/占比纯函数对 `{input: 100, cacheRead: 30, cacheWrite: 20}` 得 `ratio 0.30`、`fresh 50`、三段 `50/30/20`。
- [ ] `bash scripts/with-memory-cap.sh vitest run src/shared/tests/wireContractTypeSync.test.ts` 退出 0，且新判据断言 server `ProviderTokenUsageCounts` 与前端 `TokenUsageCounts` 的字段名集合相等（含 `cacheWriteTokens`），任一单边增删即红。
- [ ] `npx tsc --noEmit -p tsconfig.json` 退出 0（`TokenUsageCounts`/`tokenBreakdown`/`PROVIDER_DESCRIPTORS` 新字段全部类型落位，无 any 兜底）。

## DoD

开发构建真实页面上用 MCP 浏览器把四条新 UI 各走一遍并截图存 `tmp/`：命中率行、三段占比条、cacheWrite 行（带 cacheWrite 的夹具会话）、每 provider 口径说明；对 Codex 会话（`cumulative` 已有 `cacheRead`）与一个带 `cacheWrite` 的夹具会话各验一次。`scripts/ui-scenarios/` 下新增一条打开 `/cost` 面板的场景，`node scripts/ui-scenario.mjs <scenario.json>` 跑出 JSON 报告与检查点截图（AGENTS.md 两条 UI 验证都要满足）。前端测试与 TypeSync 判据全绿，`npm run typecheck`、`npm run build:client`、`npm run lint` 通过；`CostContent.tsx` 不新增 `provider ===` 分支（口径经 `PROVIDER_DESCRIPTORS` 数据表）。

## Touches

- src/shared/types.ts (TokenUsageCounts 加 cacheWriteTokens?；tokenBreakdown 加 cacheWrite?)
- src/shared/constants.ts (PROVIDER_DESCRIPTORS 加缓存口径说明属性)
- src/modules/chat-support/modals/CostContent.tsx
- src/modules/chat-support/tests/CostContent.test.tsx (new)
- src/shared/tests/wireContractTypeSync.test.ts (TokenUsageCounts ↔ ProviderTokenUsageCounts TypeSync 判据)
- scripts/ui-scenarios/cost-panel-cache-ratio.json (new)
- tasks/gap-cost-panel-cache-hit-ratio-and-cachewrite-bar.md
