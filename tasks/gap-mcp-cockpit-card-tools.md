---
id: gap-mcp-cockpit-card-tools
title: MCP 暴露驾驶舱卡片：cockpit_cards / cockpit_card / cockpit_card_brief 用
  cloudcli:read，cockpit_card_confirm 用新增 cloudcli:cockpit:act；复用 cockpit
  registry/action channel/brief，不重写第二套读路径
status: ready
labels:
  - gap
  - cockpit
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-28 用户裁定（scope 已定死）。驾驶舱卡片经 MCP 网关暴露四个工具：三个读工具用 `cloudcli:read`，唯一写工具 `cockpit_card_confirm` 用新增 scope `cloudcli:cockpit:act`。

现状：`server/modules/cockpit/` 已把卡片系统实现完整——注册表 `cockpit-card-registry.ts`（合并/过滤/排序/默认值/confirmable 标记）、确认通道 `cockpit-card-actions.ts`（revision 乐观并发 + 声明检查 + 一次接受 ledger）、简报 `cockpit-brief.service.ts`、fleet/fixture provider、HTTP 面 `GET /api/cockpit/cards`、`GET /:id/brief`、`POST /confirm`——但只暴露在 HTTP。`server/modules/mcp-gateway/` 已有无状态 `/mcp` 网关（读/写/resident/draft 工具经同一 `withMcpAudit` 包装；`McpGatewayToolName` 联合 + `MCP_TOOL_ANNOTATIONS` + `MCP_TOOL_ERROR_CODES` 三个总记录强制「新增工具名必须补三处，否则编译不过」），Cockpit 不在其中。本任务把两者接起来，**不重写第二套读路径**：MCP 工具直接复用 `cockpitCards.registry / actions / brief` 作依赖。

工具集：

- `cockpit_cards`（读，`cloudcli:read`）→ `registry.listCards()` + `registry.diagnostics()`，返回 `{ cards, diagnostics }`（空列表要能与「fleet 读失败」区分，镜像 HTTP 面）。
- `cockpit_card`（读，`cloudcli:read`）→ `registry.getCard(id)`。
- `cockpit_card_brief`（读，`cloudcli:read`）→ 模块暴露的 `briefForCard(id)`（T2 简报）。单独成工具是为成本（LLM 预算、按需触发），不是为敏感度——`session_read` 已在 `cloudcli:read` 下返回原始转写正文，卡片是其有界派生摘要，严格不高于该天花板，故**不**新建内容 scope。
- `cockpit_card_confirm`（写，`cloudcli:cockpit:act`）→ `actions.confirm({ cardId, revision, optionId | replyText })`，只做入参转译 + 转发错误码（`CARD_NOT_FOUND / REVISION_CONFLICT / EXECUTOR_NOT_DECLARED / EXECUTOR_UNAVAILABLE / ALREADY_CONFIRMED / INVALID_REQUEST`，及 provider 透传的 `FLEET_EXEC_FAILED / project-not-registered / SESSION_*`）。所有守卫都在 action channel 里，MCP 工具不重复；revision 乐观并发天然适配 MCP（冲突 → 重新 list）。

scope 决定（已定死）：

- (a) confirm 用新增 `cloudcli:cockpit:act`，append 到 `ACCESS_TOKEN_SCOPES` **末尾**（该数组 ORDER IS LOAD-BEARING，`navigate`/`selection` 都因此 appended LAST）。理由：confirm 是通用执行器分发器（`session.send` / `session.start` / `fleet.hold·park·redispatch·log` / 未来 provider），既有任何单一 scope 都覆盖不了；运行时按 executor 动态判 scope 会破坏 `withMcpAudit` 的静态 `requiredScopes` 模型，并把鉴权塞进 AC-394 leaf。诚实代价：持 `cloudcli:cockpit:act` 可经确认卡触发 `session.send`（跑命令）而不必持 `cloudcli:session:send`——这是受中介的有限选项执行，不是任意会话任意写；consent 屏 `SCOPE_DESCRIPTIONS` 必须如实点名最坏情形（可能发消息/开会话/应用 fleet 处置，send/start 可能跑命令），`SCOPE_RISK` 加 `cockpitAct` 并扩 `ConsentScopeRisk` 联合。AC-252 self-target 守卫正交生效。
- (b) 三个读工具不加新 scope、全用 `cloudcli:read`，也**不**造 `cloudcli:cockpit:read`——`session_read`/`session_search` 已在该 scope 下可读全文转写，再造一个比底层还严的读授权方向反了。

实现落点（遵守 `$backend-module-standards`，跨模块只经 barrel）：新文件 `server/modules/mcp-gateway/mcp-cockpit-tools.ts` 导出 `McpCockpitToolDeps` 与 `registerMcpCockpitTools(seam, deps)`；`mcp-gateway.transport.ts` 的 `McpGatewayDeps`/`McpGatewayModuleDeps` 加可选 `cockpitTools`，`createMcpServer` 加一条与 `residentTools` 同构的注册分支（走同一个 `audited` 包装），barrel 导出新符号；`server/modules/cockpit/cockpit.module.ts` 在 `CockpitCardsModule` 上暴露 `briefForCard(cardId): Promise<CockpitBriefResponse>`（与 `/brief` 路由同一段 `briefTarget`+`toBriefResponse`+fixture 逻辑，避免复制）；`server/index.ts` 把 `cockpitCards` 解包注入 `createMcpGatewayModule`。cockpit 是 leaf（只 import shared+自身），`mcp-gateway → cockpit` 边与现有 `mcp-gateway → projects/database` 同向，不形成环。

边界（dedup/merge）：机制去重已核对——`grep -rlE "cockpit_card_confirm|cockpit_cards|cockpit_card_brief|cloudcli:cockpit" tasks/` 零命中，无任何任务认领「MCP 暴露 cockpit 卡片」。相关但不同：`cockpit-card-provider-contract-and-registry`、`cockpit-card-session-executors`、`cockpit-fleet-rescue-executors`、`cockpit-card-brief-rendering`（均 done）是卡片系统本体，本任务是其 MCP 暴露面。granularity 只报一个 peer `gap-cockpit-ask-answered-immediate-dedup-startup-sweep-and-repair`（ready，仅共享 `server/index.ts` 合成根），机制不同，分开立。

## AC

- [ ] AC1 红态基线逐字记录：改动前 `node --experimental-strip-types server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts` 因文件不存在退出 1（写下完整命令与完整输出），且 `grep -n "cloudcli:cockpit" server/shared/mcp-contract/types.ts` 退出 1。
- [ ] AC2 scope 词汇（决定 a/b 的机械钉）：`grep -n "'cloudcli:cockpit:act'" server/shared/mcp-contract/types.ts` 命中，且其行在 `'cloudcli:selection',` 之后、`] as const;` 之前（append LAST）；`grep -n "cloudcli:cockpit:read" server/shared/mcp-contract/types.ts` 退出 1（决定 b：不造内容 scope）；`grep -n "cloudcli:cockpit:act" server/modules/oauth/oauth-consent.service.ts` 命中 `SCOPE_DESCRIPTIONS` 与 `SCOPE_RISK` 各一条；`grep -n "cockpitAct" server/modules/oauth/oauth-consent.service.ts` 命中 `ConsentScopeRisk` 联合。写下各 grep 输出。
- [ ] AC3 判据绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts` 退出 0；写下 `# tests` / `# pass` / `# fail` 读数。
- [ ] AC4 tools/list：经真实 HTTP + MCP SDK 客户端读 `tools/list`，四个工具名俱在，且 `cockpit_cards`/`cockpit_card`/`cockpit_card_brief` 的 requiredScope 为 `cloudcli:read`、`cockpit_card_confirm` 为 `cloudcli:cockpit:act`；`cockpit_card_confirm` 的 annotations `readOnlyHint=false`、`openWorldHint=true`。逐字写出四行。
- [ ] AC5 读路径复用：夹具 provider 出卡后，`cockpit_cards` 返回 `{ cards, diagnostics }` 且与 `GET /api/cockpit/cards` 同源（registry.listCards）；`cockpit_card` 按 id 返回同一张卡；`cockpit_card_brief` 返回该卡 BriefSpec 或确定性 fallback。逐字写出返回。
- [ ] AC6 confirm 复用 action channel：`cockpit_card_confirm({ cardId, revision, optionId })` 成功时 executor 恰好执行一次；用旧 revision 再确认 ⇒ 错误码 `REVISION_CONFLICT`；用不存在的 optionId ⇒ `INVALID_REQUEST`；对同一 (card, revision) 重复确认 ⇒ `ALREADY_CONFIRMED`。逐字写出三次返回。
- [ ] AC7 scope 生效（决定 a）：仅 `cloudcli:read` 令牌调 `cockpit_card_confirm` 被拒（isError），`mcp_audit_log` 新增恰好一行 `tool='cockpit_card_confirm'`/`outcome='denied'`，executor 未执行；`cloudcli:cockpit:act` 令牌同调成功。逐字写出该行与前后计数。仅 `cloudcli:read` 令牌调三个读工具全部成功（决定 b 正例对照）。
- [ ] AC8 取假形态三条必须红（先提交实现再变异，逐条记录变异 diff、逐字失败行、恢复命令）：(i) `cockpit_card_confirm` 的 requiredScope 写成 `cloudcli:read` ⇒ AC7 红；(ii) 任一读工具 requiredScope 写成 `cloudcli:cockpit:act` ⇒ AC7 红；(iii) `cockpit_card_confirm` 绕过 `actions.confirm` 自建执行路径 ⇒ AC6 的 REVISION_CONFLICT 臂红。每条恢复后重跑绿。
- [ ] AC9 总记录与不回归：`MCP_TOOL_ANNOTATIONS` / `MCP_TOOL_ERROR_CODES` 各新增四行（编译期 total record 强制）；`npm run typecheck` 退出 0；`npm run lint` 无 `: error `（写下计数）；`server/modules/mcp-gateway/tests/mcp-tool-annotations.test.ts`、`mcp-error-vocabulary.test.ts`、`server/modules/oauth/tests/access-token-scopes.test.ts`、`oauth-consent-page.test.ts` 随 vocabulary 更新后逐字通过，且 `mcp-read-tools.test.ts` 不改一字仍通过（cockpit 工具走独立 bag，不进 stage-3 表）。
- [ ] AC10 `git diff --stat develop...HEAD` 与 `## Touches` 逐条对齐（新增文件用 ASCII ` (new)`）；若被迫写 Touches 之外的文件，先用 task_write 加进 Touches 再写。列出实际改动文件清单。

## DoD

- 四个 MCP 工具**真的**经真实 HTTP + MCP SDK 客户端驱动，落到**真** `createCockpitCardsModule` 的 registry / actions / brief 上（夹具 provider 出卡、假 executor 可观测）——不是「函数被调用」或「判据文件存在」就算数。
- `cockpit_cards` **真的**给出 `{ cards, diagnostics }`，空列表能区分「无卡」与「fleet 读失败」；`cockpit_card` **真的**按 id 取卡；`cockpit_card_brief` **真的**复用 `/brief` 同一代码路径产出 BriefSpec 或确定性 fallback。
- `cockpit_card_confirm` **真的**走 `actions.confirm`：revision 冲突**真的** `REVISION_CONFLICT`、重复确认**真的** `ALREADY_CONFIRMED`、executor 恰好一次、provider 透传错误码原样上抛。
- scope **真的**生效：仅 `cloudcli:read` 令牌**真的**能读不能 confirm（被拒 + 一行 `denied` 审计 + executor 零次）；`cloudcli:cockpit:act` **真的**放行；`ACCESS_TOKEN_SCOPES` **真的**只追加一个 `cloudcli:cockpit:act`，无 `cloudcli:cockpit:read`。
- consent 屏**真的**给 `cloudcli:cockpit:act` 显示写组 + risk badge，描述如实点名最坏情形（可能跑命令）。
- 三条取假形态都先红后恢复，变异 diff、逐字失败行、恢复命令齐全；恢复后重跑回绿。
- 遵守 `$backend-module-standards`（TS、跨模块只经 barrel、导出带消费方注释、不导出无消费者符号）与 AGENTS.md；不引入新依赖；不改卡片契约、action channel 守卫与既有 MCP 工具行为。

## Touches

- server/modules/mcp-gateway/mcp-cockpit-tools.ts (new)
- server/modules/mcp-gateway/mcp-gateway.transport.ts
- server/modules/mcp-gateway/mcp-tool-annotations.ts
- server/modules/mcp-gateway/mcp-tool-error-codes.ts
- server/modules/mcp-gateway/index.ts
- server/shared/mcp-contract/types.ts
- server/modules/oauth/oauth-consent.service.ts
- server/modules/cockpit/cockpit.module.ts
- server/index.ts
- server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts (new)（判据）
- server/modules/oauth/tests/access-token-scopes.test.ts
- server/modules/oauth/tests/oauth-consent-page.test.ts
- server/modules/mcp-gateway/tests/mcp-tool-annotations.test.ts
- server/modules/mcp-gateway/tests/mcp-error-vocabulary.test.ts
- tasks/gap-mcp-cockpit-card-tools.md
