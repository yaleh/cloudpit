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

- [x] AC1 红态基线逐字记录：改动前 `node --experimental-strip-types server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts` 因文件不存在退出 1（写下完整命令与完整输出），且 `grep -n "cloudcli:cockpit" server/shared/mcp-contract/types.ts` 退出 1。
- [x] AC2 scope 词汇（决定 a/b 的机械钉）：`grep -n "'cloudcli:cockpit:act'" server/shared/mcp-contract/types.ts` 命中，且其行在 `'cloudcli:selection',` 之后、`] as const;` 之前（append LAST）；`grep -n "cloudcli:cockpit:read" server/shared/mcp-contract/types.ts` 退出 1（决定 b：不造内容 scope）；`grep -n "cloudcli:cockpit:act" server/modules/oauth/oauth-consent.service.ts` 命中 `SCOPE_DESCRIPTIONS` 与 `SCOPE_RISK` 各一条；`grep -n "cockpitAct" server/modules/oauth/oauth-consent.service.ts` 命中 `ConsentScopeRisk` 联合。写下各 grep 输出。
- [x] AC3 判据绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts` 退出 0；写下 `# tests` / `# pass` / `# fail` 读数。
- [x] AC4 tools/list：经真实 HTTP + MCP SDK 客户端读 `tools/list`，四个工具名俱在，且 `cockpit_cards`/`cockpit_card`/`cockpit_card_brief` 的 requiredScope 为 `cloudcli:read`、`cockpit_card_confirm` 为 `cloudcli:cockpit:act`；`cockpit_card_confirm` 的 annotations `readOnlyHint=false`、`openWorldHint=true`。逐字写出四行。
- [x] AC5 读路径复用：夹具 provider 出卡后，`cockpit_cards` 返回 `{ cards, diagnostics }` 且与 `GET /api/cockpit/cards` 同源（registry.listCards）；`cockpit_card` 按 id 返回同一张卡；`cockpit_card_brief` 返回该卡 BriefSpec 或确定性 fallback。逐字写出返回。
- [x] AC6 confirm 复用 action channel：`cockpit_card_confirm({ cardId, revision, optionId })` 成功时 executor 恰好执行一次；用旧 revision 再确认 ⇒ 错误码 `REVISION_CONFLICT`；用不存在的 optionId ⇒ `INVALID_REQUEST`；对同一 (card, revision) 重复确认 ⇒ `ALREADY_CONFIRMED`。逐字写出三次返回。
- [x] AC7 scope 生效（决定 a）：仅 `cloudcli:read` 令牌调 `cockpit_card_confirm` 被拒（isError），`mcp_audit_log` 新增恰好一行 `tool='cockpit_card_confirm'`/`outcome='denied'`，executor 未执行；`cloudcli:cockpit:act` 令牌同调成功。逐字写出该行与前后计数。仅 `cloudcli:read` 令牌调三个读工具全部成功（决定 b 正例对照）。
- [x] AC8 取假形态三条必须红（先提交实现再变异，逐条记录变异 diff、逐字失败行、恢复命令）：(i) `cockpit_card_confirm` 的 requiredScope 写成 `cloudcli:read` ⇒ AC7 红；(ii) 任一读工具 requiredScope 写成 `cloudcli:cockpit:act` ⇒ AC7 红；(iii) `cockpit_card_confirm` 绕过 `actions.confirm` 自建执行路径 ⇒ AC6 的 REVISION_CONFLICT 臂红。每条恢复后重跑绿。
- [x] AC9 总记录与不回归：`MCP_TOOL_ANNOTATIONS` / `MCP_TOOL_ERROR_CODES` 各新增四行（编译期 total record 强制）；`npm run typecheck` 退出 0；`npm run lint` 无 `: error `（写下计数）；`server/modules/mcp-gateway/tests/mcp-tool-annotations.test.ts`、`mcp-error-vocabulary.test.ts`、`server/modules/oauth/tests/access-token-scopes.test.ts`、`oauth-consent-page.test.ts` 随 vocabulary 更新后逐字通过，且 `mcp-read-tools.test.ts` 不改一字仍通过（cockpit 工具走独立 bag，不进 stage-3 表）。
- [x] AC10 `git diff --stat develop...HEAD` 与 `## Touches` 逐条对齐（新增文件用 ASCII ` (new)`）；若被迫写 Touches 之外的文件，先用 task_write 加进 Touches 再写。列出实际改动文件清单。

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

## Notes

- 该轴仍暗,理由:本任务是把既有 cockpit 卡片系统接到 MCP 工具面，判据全部落在真实工具调用、scope 审计行与 action channel 错误码上，没有可读的 L_D/L_G 学习轴量。

### AC1 红态基线（未改动树）

改动未提交，`HEAD=2ea90f8e8` 即改动前；用 `git archive HEAD | tar -x -C /tmp/gap-mcp-cockpit-baseline` 取未改动树（不注册 worktree、不碰任何分支），在该树执行：

```
$ cd /tmp/gap-mcp-cockpit-baseline
$ node --experimental-strip-types server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts
node:internal/modules/cjs/loader:1568
  throw err;
  ^

Error: Cannot find module '/tmp/gap-mcp-cockpit-baseline/server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1118:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1142:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1169:28)
    at Module._load (node:internal/modules/cjs/loader:1341:27)
    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47 {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js v24.21.0
EXIT=1

$ grep -n "cloudcli:cockpit" server/shared/mcp-contract/types.ts
EXIT=1
```

### AC2 scope 词汇

```
$ grep -n "'cloudcli:cockpit:act'" server/shared/mcp-contract/types.ts
98:  'cloudcli:cockpit:act',
EXIT=0

$ grep -n "'cloudcli:selection',\|'cloudcli:cockpit:act',\|] as const;" server/shared/mcp-contract/types.ts
91:  'cloudcli:selection',
98:  'cloudcli:cockpit:act',
99:] as const;

$ grep -n "cloudcli:cockpit:read" server/shared/mcp-contract/types.ts
EXIT=1

$ grep -n "cloudcli:cockpit:act" server/modules/oauth/oauth-consent.service.ts
50:  'cloudcli:cockpit:act':
86:  'cloudcli:cockpit:act': 'cockpitAct',
EXIT=0

$ grep -n "cockpitAct" server/modules/oauth/oauth-consent.service.ts
69:  | 'cockpitAct';
86:  'cloudcli:cockpit:act': 'cockpitAct',
EXIT=0
```

SCOPE_DESCRIPTIONS 行（第 50 行）的文本：`'Confirm cockpit cards: may send messages or start sessions (those sessions run commands), or apply a fleet disposition'`。`SCOPE_RISK_KEYS` 在前端没有 `cockpitAct` 叶子，`OAuthConsentRoute.tsx:273` 的 `t(..., { defaultValue: option.description })` 因此把这段如实描述直接渲染成 badge（与既有 `selection` 同一回退路径）。

### AC3 判据

```
$ npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts
EXIT=0
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

### AC4 tools/list（真实 HTTP + MCP SDK Client；scope 用无 scope 令牌读 INSUFFICIENT_SCOPE 的 details.requiredScopes 反读）

```
cockpit AC4 tools/list annotations cockpit_card_confirm {"readOnlyHint":false,"destructiveHint":true,"idempotentHint":true,"openWorldHint":true}
cockpit AC4 cockpit_cards requiredScope ["cloudcli:read"]
cockpit AC4 cockpit_card requiredScope ["cloudcli:read"]
cockpit AC4 cockpit_card_brief requiredScope ["cloudcli:read"]
cockpit AC4 cockpit_card_confirm requiredScope ["cloudcli:cockpit:act"]
```

### AC5 读路径复用

```
cockpit AC5 cockpit_cards {"cards":10,"diagnostics":[{"provider":"criterion","ok":true,"reason":null,"cards":1,"skippedLines":0,"cached":false}]}
cockpit AC5 cockpit_card {"id":"criterion:card","provider":"criterion","revision":2,"kind":"need","group":"rescue","rank":1,"state":"open","waitingSince":"2026-10-28T09:00:00.000Z","surfacedAt":"2026-10-28T09:00:00.000Z","subject":{"uri":"cloudcli://criterion/card","project":"criterion-project","title":"Criterion card"},"ask":"Should the criterion approve this card?","facts":[{"text":"the criterion provider produced this card","mechanical":true,"observedAt":"2026-10-28T09:00:00.000Z"}],"options":[{"id":"approve","label":"Approve the criterion","does":"Record that the criterion approved the card.","suggested":true,"source":"provider","action":{"executor":"criterion.record","params":{"cardId":"criterion:card","optionId":"approve"}}}],"ownReply":{"executor":"session.start","params":{"project":"criterion-project"}}}
cockpit AC5 cockpit_card_brief(fixture:ask) status=generated cardId=fixture:ask
cockpit AC5 cockpit_card_brief(criterion:card) status=fallback reason=unsupported-content
cockpit AC5 cockpit_card(criterion:absent) code=CARD_NOT_FOUND
```

同源不是靠这两行文字，而是靠判据里的 deepEqual：HTTP 面挂在同一个 express app 的 `/api/cockpit/cards`（`mcp-cockpit-tools.test.ts:302`），`assert.deepEqual(viaMcp.payload, viaHttp, 'cockpit_cards must answer the same body as GET /api/cockpit/cards')`（:427）；brief 同样与 `/api/cockpit/cards/:id/brief` deepEqual（:445-448），fallback 与路由 fallback deepEqual（:459）。

### AC6 confirm 复用 action channel

```
cockpit AC6 cockpit_card_confirm ok {"ok":true,"cardId":"criterion:card","executor":"criterion.record","params":{"cardId":"criterion:card","optionId":"approve"},"result":{"recorded":true}}
cockpit AC6 cockpit_card_confirm repeat code=ALREADY_CONFIRMED message=card criterion:card revision 2 was already confirmed
cockpit AC6 cockpit_card_confirm stale code=REVISION_CONFLICT message=card criterion:card is at revision 2, not 1
cockpit AC6 cockpit_card_confirm bad option code=INVALID_REQUEST message=card criterion:card has no option criterion:no-such-option
```

executor 恰好一次：每次调用后判据断言 `arm.log.count === 1`（成功一次；后续三次拒绝都不增加）。夹具 executor 特意不 bump revision，因此「同一 (card, 2) 重复」真正落到 accepted ledger 的 `ALREADY_CONFIRMED`，而「revision 1」是真正的 `REVISION_CONFLICT`——两条臂靠事实区分。

### AC7 scope 生效

```
cockpit AC7 read token: cockpit_cards / cockpit_card / cockpit_card_brief all ok
cockpit AC7 denied audit count 3->4 row={"tool":"cockpit_card_confirm","outcome":"denied","denied_scopes":"[\"cloudcli:cockpit:act\"]"}
cockpit AC7 act token: cockpit_card_confirm ok executor=criterion.record
```

即 `cloudcli:read` 令牌三读全成功、confirm 被拒（isError）且 `mcp_audit_log` 恰好新增 1 行 denied（3→4），executor 零次；`cloudcli:cockpit:act` 令牌同调成功并执行 `criterion.record`。

### AC8 三条取假形态（先提交 72ca7efa1，再变异）

(i) confirm requiredScope 写成 `cloudcli:read`

```
$ git diff
@@ -265,7 +265,7 @@ export function registerMcpCockpitTools(seam: McpCockpitToolSeam, deps: McpCockp
     name: 'cockpit_card_confirm',
-    requiredScope: MCP_COCKPIT_ACT_SCOPE,
+    requiredScope: MCP_COCKPIT_READ_SCOPE,
     inputSchema: COCKPIT_CARD_CONFIRM_INPUT_SCHEMA,
$ npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts
✖ (AC4) tools/list carries the four cockpit tools; the scopes are the ones the check enforces
✖ (AC7) cloudcli:read reads but cannot confirm; cloudcli:cockpit:act confirms
ℹ tests 4 / pass 2 / fail 2
  AssertionError [ERR_ASSERTION]: a cloudcli:read-only token must not confirm
    actual: false,
    expected: true,
恢复: git checkout -- server/modules/mcp-gateway/mcp-cockpit-tools.ts  → 重跑 ℹ tests 4 / pass 4 / fail 0
```

(ii) `cockpit_card_brief` 的 requiredScope 写成 `cloudcli:cockpit:act`

```
$ git diff
@@ -257,7 +257,7 @@ export function registerMcpCockpitTools(seam: McpCockpitToolSeam, deps: McpCockp
     name: 'cockpit_card_brief',
-    requiredScope: MCP_COCKPIT_READ_SCOPE,
+    requiredScope: MCP_COCKPIT_ACT_SCOPE,
     inputSchema: COCKPIT_CARD_ID_INPUT_SCHEMA,
$ npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts
✖ (AC4) tools/list carries the four cockpit tools; the scopes are the ones the check enforces
✖ (AC5) cockpit_cards / cockpit_card / cockpit_card_brief read the same module as the HTTP face
✖ (AC7) cloudcli:read reads but cannot confirm; cloudcli:cockpit:act confirms
ℹ tests 4 / pass 1 / fail 3
  AssertionError [ERR_ASSERTION]: cockpit_card_brief must require exactly cloudcli:read
    actual: [ 'cloudcli:cockpit:act' ], expected: [ 'cloudcli:read' ]
  AssertionError [ERR_ASSERTION]: cockpit_card_brief must succeed under a cloudcli:read-only token
    actual: true, expected: false
恢复: git checkout -- server/modules/mcp-gateway/mcp-cockpit-tools.ts  → 重跑 ℹ tests 4 / pass 4 / fail 0
```

(iii) confirm 绕过 action channel 的 revision 守卫（自建执行路径：先读当前 revision 再转发，等于把乐观并发守卫拿掉）

```
$ git diff
@@ -198,9 +198,10 @@ export async function buildCockpitCardConfirm(
   try {
+    const current = await deps.registry.getCard(input.cardId);
     return await deps.actions.confirm({
       cardId: input.cardId,
-      revision: input.revision,
+      revision: current?.revision ?? input.revision,
$ npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cockpit-tools.test.ts
✖ (AC6) cockpit_card_confirm runs the executor once and forwards every action-channel refusal
ℹ tests 4 / pass 3 / fail 1
  AssertionError [ERR_ASSERTION]: a stale revision must answer REVISION_CONFLICT
    actual: 'ALREADY_CONFIRMED', expected: 'REVISION_CONFLICT'
恢复: git checkout -- server/modules/mcp-gateway/mcp-cockpit-tools.ts  → 重跑 ℹ tests 4 / pass 4 / fail 0
```

### AC9 总记录与不回归

`MCP_TOOL_ANNOTATIONS` 新增四行（三个 read：`readOnlyHint:true`/`openWorldHint:false`；confirm：`readOnlyHint:false, destructiveHint:true, idempotentHint:true, openWorldHint:true`），`MCP_TOOL_ERROR_CODES` 新增四行（各 `[...WRAPPER_CODES]`；卡片模块的 `CARD_NOT_FOUND`/`REVISION_CONFLICT`/… 是 SERVICE 码，按该文件头「forwarded service codes are not listed」的既定规则不列入，因此 `mcp-error-vocabulary` 的静态「declared ⊆ vocabulary」腿保持绿）。

```
$ npm run typecheck   # 合并 develop 后
TYPECHECK_EXIT=0

$ npm run lint
LINT_EXIT=0
error_count=$(grep -c ': error ' …)=0

$ npx tsx --tsconfig server/tsconfig.json --test <each>
server/modules/mcp-gateway/tests/mcp-tool-annotations.test.ts   ℹ tests 5  / pass 5  / fail 0
server/modules/mcp-gateway/tests/mcp-error-vocabulary.test.ts   ℹ tests 5  / pass 5  / fail 0
server/modules/oauth/tests/access-token-scopes.test.ts          ℹ tests 5  / pass 5  / fail 0
server/modules/oauth/tests/oauth-consent-page.test.ts           ℹ tests 16 / pass 16 / fail 0
server/modules/mcp-gateway/tests/mcp-read-tools.test.ts         ℹ tests 8  / pass 8  / fail 0
$ git diff --stat develop...HEAD -- server/modules/mcp-gateway/tests/mcp-read-tools.test.ts
(空输出：一字未改)
```

### AC10 改动文件与 Touches 对齐

`git diff --stat develop...HEAD`（14 个文件，全部在 Touches 内；新增文件两个）：

```
 server/index.ts                                    |  10 +
 server/modules/cockpit/cockpit.module.ts           |  47 +-
 server/modules/mcp-gateway/index.ts                |  31 ++
 server/modules/mcp-gateway/mcp-cockpit-tools.ts    | 272 ++++++++++  (new)
 server/modules/mcp-gateway/mcp-gateway.transport.ts|  42 +-
 server/modules/mcp-gateway/mcp-tool-annotations.ts |  25 +-
 server/modules/mcp-gateway/mcp-tool-error-codes.ts |  17 +
 .../mcp-gateway/tests/mcp-cockpit-tools.test.ts    | 575 ++++++++++  (new)（判据）
 .../mcp-gateway/tests/mcp-error-vocabulary.test.ts |   6 +
 .../mcp-gateway/tests/mcp-tool-annotations.test.ts |  28 +-
 server/modules/oauth/oauth-consent.service.ts      |  18 +-
 .../oauth/tests/access-token-scopes.test.ts        |   8 +-
 .../oauth/tests/oauth-consent-page.test.ts         |  15 +-
 server/shared/mcp-contract/types.ts                |   7 +
 14 files changed, 1074 insertions(+), 27 deletions(-)
```

Touches 的 `tasks/gap-mcp-cockpit-card-tools.md` 由 task_write 自身产生，不在源码 diff 内。anti-drift Touches 硬门结果：`ANTI-DRIFT OK: task gap-mcp-cockpit-card-tools — 14 actual file(s), all within declared Touches (15 glob(s))`。