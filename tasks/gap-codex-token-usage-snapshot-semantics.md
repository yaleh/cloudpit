---
id: gap-codex-token-usage-snapshot-semantics
title: Codex token 用量统一快照口径并展示累计、最近请求与明细
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

Codex 会话 /cost 曾显示 Total tokens used 2,508,151、Breakdown Unavailable。实际 rollout 的 token_count 快照有 total_token_usage：input_tokens 2,503,128、cached_input_tokens 2,398,208、output_tokens 5,023、reasoning_output_tokens 481、total_tokens 2,508,151，另有 last_token_usage 和 model_context_window。当前 codex-sessions.provider.ts 的历史路径只保留 used/total，丢掉明细；独立读取器和实时路径有不同的解析。Claude 读取最近一次有效主会话请求并保留缓存信息，但 Codex 的累计用量语义不同，不能把累计量当成当前上下文占用。

统一 Codex 历史、实时和 token-usage 读取的归一化语义：分别保留会话累计和最近一次请求的数据，保留输入、输出、可用时的缓存输入与推理输出，缓存输入是输入的子集，推理输出是输出的子集，不可重复相加。缺失字段须保持未知而非伪造为零。窗口容量独立于累计量；最近请求用量只能标为上下文近似参考，不承诺精确占用，不能以累计用量除以窗口容量。参考 Claude 会话用量链路，保留其他 provider 现有语义并明确不同口径。弹窗分组展示累计、最近请求及窗口，紧凑计数器标明其数值口径。

<!-- dedup-ref --> 粒度检查：现有完成任务 gap-token-usage-404-before-first-transcript-write 处理 Claude transcript 尚未创建时的 404，机制不同；上述源码路径的 open 任务回退搜索未发现合并候选，单独立案。插件包未提供 task-granularity-advice.js，已按技能要求使用逐文件搜索回退。

## AC

- [ ] 增补聚焦测试，运行 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-token-usage.service.test.ts 与同方式运行 server/modules/providers/tests/codex-sessions.test.ts、server/modules/providers/tests/codex-runtime.test.ts，各自退出 0；覆盖真实形状的累计及最近请求、缓存与推理子集、窗口、字段缺失与显式零、无效或不完整尾行，且历史、实时、接口同一快照一致。
- [ ] 运行 npx tsx --tsconfig server/tsconfig.json --test server/modules/commands/tests/commands.test.ts 退出 0；断言 /cost 保留已知明细和独立窗口，未知不伪装为零，不把累计量用于上下文比例，并保留 Claude 原有语义。
- [ ] 增补并运行针对用量弹窗、紧凑计数器及会话切换/实时更新的前端聚焦测试，记录实际命令且退出 0；断言分组及标签正确、子集不重复计算、缺失不显示为零、旧历史数据不覆盖更新的实时数据，且 Claude 展示不回归。
- [ ] npm run typecheck、npm run lint、npm run build:client 和 npm run build 退出 0；按仓库内存隔离规则运行测试，不在会话内启动无界多文件测试或全套测试。

## DoD

在包含修复的真实运行页面打开真实 Codex 会话，亲自通过 MCP 浏览器操作用量入口，核对历史载入、实时更新或重进会话后显示的累计输入/输出、可用缓存/推理明细与对应原始 token_count，验证最近请求和窗口独立展示且口径清楚；截图存入 tmp/ 并在任务验证记录贴出路径和数值证据。存在可用场景时同时运行 node scripts/ui-scenario.mjs <scenario.json> …，在任务记录贴出 JSON 报告与检查点截图；如无适用场景，记录查找结果。确认真实 Claude 会话既有展示未回归。仅有测试或 fixture 不构成完成。

## Touches

- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/providers/list/codex/codex-token-usage.provider.ts
- server/modules/providers/list/codex/codex-runtime.provider.ts
- server/modules/providers/list/codex/codex-token-usage-normalization.ts
- server/shared/interfaces.ts
- server/modules/commands/commands.routes.ts
- server/modules/providers/tests/provider-token-usage.service.test.ts
- server/modules/providers/tests/codex-sessions.test.ts
- server/modules/providers/tests/codex-runtime.test.ts
- server/modules/commands/tests/commands.test.ts
- src/shared/types.ts
- src/modules/chat-support/modals/CommandResultModal.tsx
- src/modules/chat-composer/composer/TokenUsageSummary.tsx
- src/modules/chat-composer/hooks/useCommandMenuState.ts
- src/modules/chat/tests/tokenUsageFreshness.test.tsx
- src/modules/chat/tests/costModalAiTitle.test.tsx
- src/modules/chat/tests/tokenBudgetSessionScope.test.tsx
- tasks/gap-codex-token-usage-snapshot-semantics.md
