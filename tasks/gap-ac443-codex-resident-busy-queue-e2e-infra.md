---
id: gap-ac443-codex-resident-busy-queue-e2e-infra
title: "AC-443 leg 4: codex e2e 基建（隔离 HOME 播种 .codex）+ 忙时输入进队列可撤回腿"
status: superseded
labels: []
parent: null
children: []
extra:
  schema: execution
---
## 背景

AC-443（post-merge）的第四条 expect「忙时输入进队列可撤回」需要一个真实在飞的 codex turn。探得结论：当前 e2e 里跑不通——

- e2e server 的 `HOME = dataDir`（隔离目录，`playwright.config.ts` 的 webServer env），`DATABASE_PATH` 也在 dataDir。
- 但 `playwright.config.ts` 与 `scripts/e2e-*.mjs` 里 `.codex` 播种 = 0；真 codex app-server 读 `$HOME/.codex/auth.json` + `config.toml`，e2e 隔离 HOME 里没有 ⇒ 无法认证 ⇒ 在飞 turn 跑不起来。

所以忙时腿没有写进 `e2e/codex-resident-ui.spec.ts`（按人裁定「探不通就标红」）。

## 要做的

1. 给 e2e 补 codex 播种：在隔离 dataDir 里放 `.codex/auth.json` + `config.toml`（来源只读宿主 `~/.codex/`，不硬编码凭据），让 e2e server 起的 codex app-server 能认证并跑一个真 turn。
2. 写忙时腿进 `e2e/codex-resident-ui.spec.ts`：codex resident 会话在飞（真 turn）时，composer 输入进浏览器队列（`[data-queued-message-card]`）且可撤回。
3. 备选（若真 turn 在 e2e 里 flake 太重）：给 debug-agent 加 `codex` dialect（现 `DEBUG_AGENT_DIALECTS = ['claude']`，`server/modules/debug-agent/debug-agent.scenario.ts`），用 `unattended-turn` 制造忙态，不在 e2e 里真调模型。

## AC

- [ ] AC1 **忙时腿绿**：`npx playwright test e2e/codex-resident-ui.spec.ts` 含第四条忙时腿且 pass，fail 0；失败行不得是「忙时腿缺失」。
- [ ] AC2 **忙态是真忙**：忙时腿制造的在飞 turn 由真 codex app-server（或 debug-agent codex dialect）承载，不是把队列卡片空转（`[data-queued-message-card]` 出现时 `GET /api/session-hosts` 该会话 host state = busy）。
- [ ] AC3 **凭据不硬编码**：e2e 播种 `.codex` 只从宿主 `~/.codex/` 拷贝或引用，仓库里不出现真实 auth token。

## DoD

AC-443 判据 `npx playwright test e2e/codex-resident-ui.spec.ts` 四条腿全绿；若选备选（debug-agent codex dialect），`server/modules/debug-agent/tests/` 里有对应单测且 `npx tsx --tsconfig server/tsconfig.json --test server/modules/debug-agent/tests/<新测试>` 绿。

## Touches

- playwright.config.ts
- e2e/codex-resident-ui.spec.ts
- scripts/e2e-data-dir-selection.mjs
- server/modules/debug-agent/debug-agent.scenario.ts
- tasks/gap-ac443-codex-resident-busy-queue-e2e-infra.md

supersede：人 yale 2026-10-30 裁定——本任务是 `gap-ac443-codex-resident-ui-e2e`（goal_ac AC-443，status ready，已由 gap-filing 立案）的窄切片，机制重复（同 Touches 的 WorkspaceMain 门槛 / codex-resident-ui spec / playwright.config）。改由 `gap-ac443-codex-resident-ui-e2e` 端到端覆盖：它的 AC5 含 WorkspaceMain 门槛，AC6 含 codex-shell.provider.ts 的 resume 收紧，AC4 用 e2e/support/codex-fake-app-server.mjs 确定性替身，无需真 OpenAI 凭据。本任务作废，不重复实现。