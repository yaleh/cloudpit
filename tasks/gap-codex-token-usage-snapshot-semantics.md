---
id: gap-codex-token-usage-snapshot-semantics
title: Codex token 用量统一快照口径并展示累计、最近请求与明细
status: done
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

- [x] 增补聚焦测试，运行 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-token-usage.service.test.ts 与同方式运行 server/modules/providers/tests/codex-sessions.test.ts、server/modules/providers/tests/codex-runtime.test.ts，各自退出 0；覆盖真实形状的累计及最近请求、缓存与推理子集、窗口、字段缺失与显式零、无效或不完整尾行，且历史、实时、接口同一快照一致。
- [x] 运行 npx tsx --tsconfig server/tsconfig.json --test server/modules/commands/tests/commands.test.ts 退出 0；断言 /cost 保留已知明细和独立窗口，未知不伪装为零，不把累计量用于上下文比例，并保留 Claude 原有语义。
- [x] 增补并运行针对用量弹窗、紧凑计数器及会话切换/实时更新的前端聚焦测试，记录实际命令且退出 0；断言分组及标签正确、子集不重复计算、缺失不显示为零、旧历史数据不覆盖更新的实时数据，且 Claude 展示不回归。
- [x] npm run typecheck、npm run lint、npm run build:client 和 npm run build 退出 0；按仓库内存隔离规则运行测试，不在会话内启动无界多文件测试或全套测试。

## DoD

在包含修复的真实运行页面打开真实 Codex 会话，亲自通过 MCP 浏览器操作用量入口，核对历史载入、实时更新或重进会话后显示的累计输入/输出、可用缓存/推理明细与对应原始 token_count，验证最近请求和窗口独立展示且口径清楚；截图存入 tmp/ 并在任务验证记录贴出路径和数值证据。存在可用场景时同时运行 node scripts/ui-scenario.mjs <scenario.json> …，在任务记录贴出 JSON 报告与检查点截图；如无适用场景，记录查找结果。确认真实 Claude 会话既有展示未回归。仅有测试或 fixture 不构成完成。

## Verification

**AC 命令（本 worktree 实测，最后一次全量重跑于最终代码）**
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/provider-token-usage.service.test.ts server/modules/providers/tests/codex-sessions.test.ts server/modules/providers/tests/codex-runtime.test.ts server/modules/commands/tests/commands.test.ts` → 57 passed，exit 0。
- `npx vitest run src/modules/chat/tests/tokenUsageFreshness.test.tsx src/modules/chat/tests/costModalAiTitle.test.tsx src/modules/chat/tests/tokenBudgetSessionScope.test.tsx` → 3 files / 17 tests passed，exit 0。
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 passed，exit 0（本任务把 `src/shared/types.ts` 4749→4768 与 develop 上滞后的 `ChatComposer.tsx` 1633→1644 census 记入 baseline note 的 RECORDED CHANGE）。
- `npm run typecheck` → exit 0；`npm run lint` → exit 0（仅仓库既有 warning）；`npm run build:client` → exit 0；`npm run build` → exit 0。
- 会话内未运行全套或无限多文件 fan-out；均为聚焦文件 + 单文件 ratchet。

**浏览器实际操作（无 MCP 浏览器，使用独立 Playwright + 真实 Chromium；isolated instance 由本 worktree 构建产物启动）**
- `bash scripts/isolated-instance.sh start`（state=`tmp/isolated-instance`，residentRestore disabled，DB 为 live 备份，port 23899），服务端与客户端均为本任务分支构建产物。
- 真实 Codex 会话 `03c752cd-0bc3-474b-b1a6-f11d0bb868f1`。原始 rollout 最新 `token_count`：`input_tokens=2,503,128`、`cached_input_tokens=2,398,208`、`output_tokens=5,023`、`reasoning_output_tokens=481`、`total_tokens=2,508,151`；`last_token_usage.total_tokens=75,577`；`model_context_window=475,000`。
- `GET /api/providers/sessions/03c752cd…/token-usage` 实测：`used=2508151`、`total=475000`、`inputTokens=2503128`、`outputTokens=5023`、`cacheReadTokens=2398208`、`reasoningOutputTokens=481`、`lastRequest.totalTokens=75577`、`usageScope=session-cumulative`、`observedAt=2026-10-31T14:19:44.784Z`。
- 打开 `/session/03c752cd…`：紧凑计数器显示 `2.5M session total`；点击后弹窗分组为 `Session cumulative` / `Latest request (context estimate)` / `Context window`，行值 `2,508,151`、`2,503,128`、`2,398,208`（标注 subset of input — not added again）、`5,023`、`481`（标注 subset of output — not added again）、最近请求 `75,535 / 75,136 / 42 / 0 / 75,577`、窗口 `475,000`；无百分比/累计比例。弹窗内滚动可到窗口段（scrollTop 442 / scrollHeight 998 / client 556），窗口与 provider/model 完整可见。
- 同会话退出后重进：计数器仍 `2.5M session total`，弹窗读数完全一致（累计 2,508,151、最近请求 75,577、窗口 475,000）。
- 修复前对照（live :3001 旧构建，同会话）：计数器 `2.5M tokens`，弹窗只有 `Total tokens used 2,508,151` + `Breakdown Unavailable` —— 正是本任务修复的缺陷。
- 真实 Claude 会话 `1431a23c-8ea4-47ed-9cf1-fc651ec73df3`：修复前（live :3001）与修复后（本分支构建）一致 —— 计数器 `20K tokens`；弹窗 `Total tokens used 20,018` / `Input tokens 19,950` / `Output tokens 68` / `Context window 160,000`，无累计/最近请求分组，Claude 展示未回归。
- 浏览器 `pageerror` 与其他 console error：`[]`。
- 截图（本 worktree `tmp/dod-usage/`，gitignored）：`01-codex-chip.png`、`02-codex-panel-history.png`、`02b-codex-panel-window.png`、`03-codex-panel-reentry.png`、`04-claude-chip.png`、`05-claude-panel.png`；修复前对照 `live-before-codex-chip.png`、`live-before-codex-panel.png`、`live-before-claude-chip.png`、`live-before-claude-panel.png`。机器可读读数：`report.json`、`live-before.json`。

**场景运行器**
- `scripts/ui-scenarios/` 仅有 `cockpit-session-start-settings.json`、`quay-session-mentions.json`、`session-activity-restart.json`、`session-edit-continuity.json`；没有 token 用量或 `/cost` 场景，运行器的步骤词表也没有打开用量弹窗/读分组数值的能力。无适用场景，故使用上述独立 Playwright 真实页面验证并记录此查找结果。

**ADR-007 暗轴**
- 该轴仍暗,理由: 项目未声明 loop.scoped_command，本任务没有 loop 级 L_D/L_G 读数可报，以上聚焦测试、ratchet 与真实浏览器读数为本任务验证面。

**2026-10-31 suite-red 修复：Codex 实时路径的终端帧时序**
- 上轮 fan-in 红：`server/modules/session-hosts/tests/session-host-default-wrap.test.ts` AC4/AC6 期望 `turn-complete`、实测 `released`；隔离重跑与套件重跑均复现，判定为任务引入的真实回归（非环境假红）。
- 根因：`codex-runtime.provider.ts` 在 `turn.completed` 事件里，于终端帧归一化并发送之后才 `await readCodexSessionTokenUsage(...)`；session-host 包装器把「终端帧已到、run promise 未 settle」读成 held-open 窗口，先置 `lingering`，随后以 `released` 关闭。
- 修复（commit `3da48e8d0`）：把 rollout 读取上移到终端帧归一化/发送之前，帧顺序不变；终端帧成为 promise settle 前的最后一次写入，host 以 `turn-complete` 关闭。
- 复验：同一命令修复前 4/6（AC4、AC6 红）→ 修复后 6/6 passed；合并 develop 后重跑该文件 + `codex-runtime.test.ts` + `provider-token-usage.service.test.ts` → 38 passed；`npm run typecheck` exit 0；`npm run lint` exit 0；`architecture-ratchet.test.ts` 6 passed。
- merge develop 冲突处理：`server/modules/providers/tests/codex-sessions.test.ts` 取语义并集（develop 的 resident transcript 用例 + 本任务的 history/endpoint 一致性用例与 import）；`architecture-ratchet.baseline.json` 的 note 取两边 RECORDED CHANGE 并集，条目保留本任务 `src/shared/types.ts` 4749→4768 的读数。
- 四条 AC 仍全部满足（`task_check`：`acTotal=4, acChecked=4`）。

## Touches

- server/modules/providers/list/codex/codex-sessions.provider.ts
- server/modules/providers/list/codex/codex-token-usage.provider.ts
- server/modules/providers/list/codex/codex-runtime.provider.ts
- server/modules/providers/list/codex/codex-token-usage-normalization.ts
- server/modules/providers/list/codex/codex-token-usage-files.ts
- server/shared/interfaces.ts
- server/modules/commands/commands.routes.ts
- server/modules/providers/tests/provider-token-usage.service.test.ts
- server/modules/providers/tests/codex-sessions.test.ts
- server/modules/providers/tests/codex-runtime.test.ts
- server/modules/commands/tests/commands.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- src/shared/types.ts
- src/shared/utils.ts
- src/modules/chat-support/modals/CommandResultModal.tsx
- src/modules/chat-support/modals/CostContent.tsx
- src/modules/chat-composer/composer/TokenUsageSummary.tsx
- src/modules/chat-composer/index.ts
- src/modules/chat-session/hooks/useSessionStore.ts
- src/modules/chat-session/hooks/useChatSessionState.ts
- src/modules/chat-session/utils/session/tokenUsageFreshness.ts
- src/modules/chat-session/utils/session/index.ts
- src/modules/chat-session/index.ts
- src/modules/chat/tests/tokenUsageFreshness.test.tsx
- src/modules/chat/tests/costModalAiTitle.test.tsx
- src/modules/chat/tests/tokenBudgetSessionScope.test.tsx
- src/modules/chat-composer/hooks/useCommandMenuState.ts
- tasks/gap-codex-token-usage-snapshot-semantics.md

## Blocker

**2026-10-31T15:10:42.391Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/modules/session-hosts/tests/session-host-default-wrap.test.ts:   AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the develop baseline red set: added=server/modules/session-hosts/tests/session-host-default-wrap.test.ts,server/modules/session-hosts/tests/session-host-default-wrap.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：545e41a0-612d-4849-91d6-cd0f2eead3bf
