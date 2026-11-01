---
id: gap-claude-session-cumulative-spend-cachewrite-counts
title: Claude session-cumulative spend + cacheWrite into
  ProviderTokenUsageCounts (Codex reads cache_write too)
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

Claude 的 token 读取器 `summarizeClaudeTokenUsage`（`server/modules/providers/list/claude/claude-token-usage.provider.ts`）只读最新一轮 assistant，写入 `used`/`inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheCreationTokens`，从不设置 `cumulative`。Codex 已通过 `normalizeCodexTokenCountInfo` 同时回答 `cumulative`（会话累计花费）与 `lastRequest`（最新一次请求）。因此 Claude 会话看不到「本会话一共花了多少 token」，跨 provider 比花费也不可能。本任务给 Claude 阅读器补上 `cumulative`（外加一个独立 `sidechain` 分桶），并把 `cacheWrite` 变成两个 provider 的一等计数。

Claude 的 `cumulative` = 对所有**主线程** assistant 轮求和：`input = Σ(input_tokens + cache_read_input_tokens + cache_creation_input_tokens)`、`output = Σ output_tokens`、`cacheRead = Σ cache_read`、`cacheWrite = Σ cache_creation`；`<synthetic>` 全零行跳过（沿用最新一轮读取已有的规则），sidechain 轮（`isSidechain: true`）**不计入** `cumulative`，落入顶层 `sidechain: ProviderTokenUsageCounts` 分桶——这是人拍板的结论：子代理 token 是账单的一部分，但拥有自己的上下文。这是把最新一轮读取的算法从 last-wins 泛化成求和，不是新算法。

`cacheWriteTokens?` 加进 `ProviderTokenUsageCounts`（`server/shared/interfaces.ts`），作为 `inputTokens` 的**子集**读数（Anthropic `cache_creation_input_tokens`、OpenAI/Codex 风格 `cache_write_input_tokens`），绝不再次相加。`readCodexUsageCounts`（`codex-token-usage-normalization.ts`）用与现有字段相同的 defensive 别名方式读 `cache_write_input_tokens ?? cacheWriteInputTokens`；若某个真实 Codex rollout 不报该键，字段保持缺失（「未报 ≠ 0」契约已覆盖）。Claude 侧把已读到的 `cache_creation_input_tokens` 映射进新字段。`buildStructuredCostData`（`commands.routes.ts`）把 `cumulative.cacheWriteTokens` 透传进 `tokenBreakdown.cacheWrite`。本任务扩展 `gap-codex-token-usage-snapshot-semantics`（done）建立的归一化机制；不在本层派生任何 ratio——命中率行是前端任务的事。

## AC

- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-token-usage.service.test.ts` 退出 0，且其中新增用例：一条含两轮主线程 assistant + 一轮 `isSidechain` + 一行 `<synthetic>` 全零的 transcript，`summarizeClaudeTokenUsage(...).cumulative` 逐字段等于主线程各轮手算和（`input = Σ(input_tokens+cache_read+cache_creation)`、`output`、`cacheRead`、`cacheWrite`），`sidechain` 分桶等于 sidechain 轮自身总量，全零行贡献为 0。
- [x] 同一测试文件退出 0，且其中新增用例：Codex `token_count` 事件的 `total_token_usage` 与 `last_token_usage` 各带 `cache_write_input_tokens` 时，`cumulative.cacheWriteTokens`/`lastRequest.cacheWriteTokens` 等于该值，且 `inputTokens`/`outputTokens` 不被 cacheWrite 重复相加；事件缺该键时 `cacheWriteTokens` 保持 `undefined`。
- [x] 同一测试文件退出 0，且既有全形状 pin `the Claude summarizer reads the newest assistant turn`（约 412 行 deepEqual）更新为新返回形状后仍断言最新一轮占用不变：`used: 4183`、`cacheReadTokens: 4000`、`cacheCreationTokens: 100`；`skips synthetic rows` 与 `skips a subagent sidechain turn` 两用例仍断言 `.used === 4083`。
- [x] `npx tsx --tsconfig server/tsconfig.json --test server/modules/commands/tests/commands.test.ts` 退出 0，且 `cost` 相关用例断言 `tokenBreakdown.cacheWrite` 等于 `cumulative.cacheWriteTokens`、`tokenUsage.cumulative.cacheWriteTokens`/`lastRequest.cacheWriteTokens` 原样透传，并在缺该字段时仍不产出 `cacheWrite` 键。

## DoD

后端真实读取路径（JSONL → 读取器 → service → `/cost` route）而非桩：一个 ≥2 轮的 Claude 会话通过 `getSessionTokenUsage` 得到会话累计花费（求和，不是最新一轮占用），sidechain token 以独立分桶可还原；一个报告 `cache_write_input_tokens` 的 Codex 会话在 `cumulative`/`lastRequest` 露出 `cacheWriteTokens`，`/cost` 命令的 `tokenBreakdown` 带出 `cacheWrite`。`provider-token-usage.service.test.ts` 与 `commands.test.ts` 全绿，`npm run typecheck`、`npm run build`、`npm run lint` 通过。本任务只动 `server/`，不碰 `src/`；不加任何 provider-id 分支（改动都落在 `providers/list/` 内的能力实现与共享类型上）。

## ADR-007

- 该轴仍暗,理由:本任务只改 provider token 读取器与共享 token 计数类型，未触及分层依赖轴，无 L_D/L_G 读数可测。

## Touches

- server/shared/interfaces.ts (ProviderTokenUsageCounts 加 cacheWriteTokens?；ProviderTokenUsageReading 加 sidechain?)
- server/modules/providers/list/claude/claude-token-usage.provider.ts
- server/modules/providers/list/codex/codex-token-usage-normalization.ts
- server/modules/commands/commands.routes.ts (buildStructuredCostData 透传 cacheWrite)
- server/modules/commands/tests/commands.test.ts
- server/modules/providers/tests/provider-token-usage.service.test.ts
- tasks/gap-claude-session-cumulative-spend-cachewrite-counts.md
