---
id: gap-claude-history-reader-window-fallback
title: Claude history reader resolves the model context window instead of the
  160K default
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`fetchHistory`（`claude-sessions.provider.ts:1789`）调 `summarizeClaudeTokenUsage(rawMessages)` 只传 entries，不传模型窗口，于是 `resolveContextWindow(undefined, process.env.CONTEXT_WINDOW)` 回退到 `DEFAULT_CONTEXT_WINDOW = 160_000`。但 v4pro 模型条目声明 `CLAUDE_CODE_MAX_CONTEXT_TOKENS = 917000`，token-usage 服务路径（`readSessionUsage`）和实时 `token_budget` 帧（`claude-runtime.provider.ts:1587`）都正确解析了——唯独 history 路径（composer 计数器与 `/cost` 面板的喂数源）漏了。结果 Claude 会话的窗口在 UI 里永远显示 160K，compact / 另开会话的决策分母是错的。

修法照 `readSessionUsage`：`fetchHistory` 取 modelId（会话行 `model`，缺省则扫最新主线程 assistant 行的 `message.model`），`resolveModelContextWindowRow('claude', modelId)` 得到窗口，作为第三参传给 `summarizeClaudeTokenUsage`。这是 AC-028「模型 env row 是上下文窗口唯一来源」机制在漏掉调用点上的补全（`gap-model-env-row-single-source-context-window`，done）。

## AC

- [ ] `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-sessions.test.ts` 退出 0，且新增负臂用例：隔离 DB seed 一条 `provider_models`（provider=claude, model_id=v4pro，config_json 含 `CLAUDE_CODE_MAX_CONTEXT_TOKENS: "917000"`），会话行 `model='v4pro'`、transcript 含带 `message.model='v4pro'` 的 assistant 行；`fetchHistory(...).tokenUsage.total === 917000`（不是 160000）。
- [ ] 同一测试文件退出 0，且新增对照用例：会话/transcript 无模型、或模型条目无 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 时，`fetchHistory(...).tokenUsage.total` 仍回退 160000（默认行为不变，不伪造窗口）。

## DoD

真实 history 路径：model='v4pro' 的会话经 `fetchHistory` 返回 `tokenUsage.total = 917000`，composer 计数器与 `/cost` 面板的窗口不再显示 160K。`claude-sessions.test.ts` 全绿，`npm run typecheck`、`npm run build`、`npm run lint` 通过；token-usage 服务路径与实时帧路径行为不变。

## Touches

- server/modules/providers/list/claude/claude-sessions.provider.ts
- server/modules/providers/tests/claude-sessions.test.ts
- tasks/gap-claude-history-reader-window-fallback.md
