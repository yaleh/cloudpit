---
id: gap-ac438-codex-resident-approvals-broker
title: AC-438 Codex 常驻：五类 server request 审批 broker（permission_request
  帧、accept/decline 路由、waitingOnApproval、无人值守不挂起）
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac435-codex-resident-host-driver-persistent
goal_ac: AC-438
---
## Proposal

<!-- dedup-ref --> 机制去重与粒度（本轮实测，2026-10-29）：`grep -rl 'goal_ac: AC-438' tasks/` → **0** 个文件；`grep -ril 'requestApproval\|requestUserInput\|waitingOnApproval\|mcpServer/elicitation' tasks/` → **0** 个文件（Codex 侧没有任何审批实现或认领）。同 goal 的 `gap-ac435…` / `gap-ac436…` / `gap-ac437…` 只在正文里把审批面明确划出自己的范围（AC-436、AC-437 的“非目标”逐字写着“审批 broker（AC-438）”），它们都不认领它。Claude 侧的同类机制已由 `gap-claude-resident-permission-interception`（AC-168，status: done）落地，是本条的**形态先例而非重复**：AC-168 拦的是 Claude SDK 的三个回调（canUseTool/onElicitation/onUserDialog），本条接的是 Codex app-server 的五类 server request，协议、判据文件与响应形状都不同。`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches … --json` 返回 peers `[gap-ac435（共享 connection/driver 文件）, gap-ac436（共享 driver）, gap-ac437（共享 driver）]`、mentions `[]`。**决定：separate，不 merge** —— 本条有独立判据文件、独立验收与独立协议面（审批），不是任何一条的补丁；driver/connection 由 gap-ac435 先建，关系边用顶层 `depends_on` 登记（SQL 关系边，不是散文前置）；与 AC-436/437 只共享 driver，由调度器按 Touches 串行。

**来源与判据物。** criterion 逐字取自 `goals/AC-438-审批-broker-五类-server-request-accept-decline-无人值守不挂起.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-approvals.test.ts`。红态基线（本轮直跑，不是推断）：该命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-resident-approvals.test.ts'`。

**现状（本轮读的读数）**

- 长驻连接（AC-435 worktree 里的空壳 `server/modules/providers/list/codex/codex-app-server.connection.ts`，380 行）有 `request` / `notify` / `onNotification` / `onServerRequest` / `onExit` / `close`，但**没有回写 server request 响应的动词**：`handleFrame` 把带 `method`+`id` 的帧分发给 `serverRequestHandlers` 后就没有下文，没有 `respond(id, result)`。这是审批 broker 缺的第一根梁。
- `codex-host-driver.provider.ts`（454 行）的 `run()` 只 `connection.onNotification(...)` 把通知原样转给 writer，**没有注册 `onServerRequest`**；`readSession()` 的读数只有 `threadId/activeTurnId/turnStatus/lastResumeError`，没有 `waitingOnApproval`/pending；`turn/status/changed` 通知完全没读。
- 客户端回答审批的既有协议在 Claude 侧：`claude-runtime.provider.ts:529` 的 `requestClientToolDecision`（`permission_request` 帧 + `action_required` 通知 + `waitForToolApproval` 等待），`provider-runtime.service.ts:1200` 的 `resolveToolApproval` 对每个 provider 的 `runtime.permissions.resolve` 扇出，WS `chat.permission-response` 只带 `{requestId, allow, updatedInput, message, rememberEntry}`（`chat-websocket.service.ts:1813-1826`）。pending 注册表（`ClaudeRuntimeState.pendingToolApprovals` + held/decision 两个有界账本，`claude-runtime.provider.ts:125-270`）与 `requestClientToolDecision` 都写死在 Claude 文件里，且帧里 `provider: 'claude'` 逐字硬编码（`:552` / `:586` / `:605`）。`codexRuntime`（`codex-runtime.provider.ts:589`）只有 `run`/`abort`，**没有 `permissions` facet** —— 今天即使 Codex 驱动发出 `permission_request`，`provider-runtime.service.resolveToolApproval` 的扇出也到不了它。
- 协议读数（锁定版 `@openai/codex 0.153.4`）。五类 server request 的**逐字方法名与响应类型**来自本机真实二进制的代码生成器（不是手抄文档）：`./node_modules/.bin/codex app-server generate-ts --out <tmp>`，产物 `ServerRequest.ts` 列出 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`、`item/tool/requestUserInput`、`mcpServer/elicitation/request`、`item/permissions/requestApproval`。响应形状：commandExecution/fileChange `{decision: 'accept'|'acceptForSession'|'decline'|'cancel'|…}`；elicitation `{action:'accept'|'decline'|'cancel', content, _meta}`；userInput `{answers: {[questionId]: {answers: string[]}}}`；permissions `{permissions: GrantedPermissionProfile, scope:'turn'|'session'}`（**没有 decline/cancel 词汇**，拒绝的唯一形状是空 grant）。
- 真实读数（`tmp/codex-appserver-exp-NuPHhk/`）：E7/E7b 的 `e7-reading.json` / `e7b-reading.json` 证明 `item/commandExecution/requestApproval` 的 params 含 `threadId/turnId/itemId/command/cwd/reason/availableDecisions`；accept 回 `{decision:'accept'}` 后命令 `status=completed`、文件写成；decline 回 `{decision:'decline'}` 后命令 `status=declined`、文件不存在、**turn 仍 completed**（REPORT 第 126-141 行）；`availableDecisions` 可能不含 `decline`，而 `decline` 仍是可接受的响应。等待期间 `thread/status/changed` 逐字为 `{"threadId":…,"status":{"type":"active","activeFlags":["waitingOnApproval"]}}`，答复后同一方法再来 `activeFlags:[]`（`e7-approval-requests.jsonl`）。线上响应帧逐字 `{"jsonrpc":"2.0","id":0,"result":{"decision":"accept"}}`（同文件的 `dir:"out"` 行）。
- E7 脚本（`e7-approval-requests.mjs:20-40`）在真机上还回了非审批 server request：`currentTime/read` → `{currentTimeAt}`、`attestation/generate` → `{token:''}`、其余未知 → `{}`；不回答它们同样会让进程停在那里。REPORT 第 163 行（“对 resident 设计的直接影响 7”）逐字要求接全五类。

**要建的东西**

1. **共享审批请求服务**（把 Claude 的通用能力搬到 provider 共享层，Codex 才有第二份实现可用；也是 backend-module-standards 的“第二个同形实现出现时就抽取”）：新建 `server/modules/providers/services/approval-requests.service.ts`，从 `claude-runtime.provider.ts` 迁出 pending 注册表、held/decision 两个有界账本、`waitForToolApproval` 的 arming/超时/abort 逻辑与 `requestClientToolDecision`。
   - 公开面：`requestClientToolDecision({provider, toolName, input, requiresInteraction, requestId, ws, emitNotification, sessionId, sessionSummary, signal?, timeoutMs?})`（`provider`、`timeoutMs` 是新参数；Claude 调用点不传时行为与今天逐字一致：`provider:'claude'`、`timeoutMs = requiresInteraction ? 0 : TOOL_APPROVAL_TIMEOUT_MS`）；`resolveToolApproval(requestId, decision, decidedBy)`；`getPendingApprovalsForSession(sessionId)`；`classifyMissingApproval(requestId)`；`readApprovalDecision(requestId)`。
   - 状态由**一个 owner 实例**持有（类的私有字段；无模块级可变 Map/Set），`resolve` 对同一 id 幂等：第一次结算并记账，第二次 no-op（`provider-runtime.service` 会对每个 provider 的 facet 各调一次）。
   - `claude-runtime.provider.ts` 删掉这些实现、改为从新服务导入并**原样 re-export 现有名字**（`resolveToolApproval` / `getPendingApprovalsForSession` / `classifyMissingApproval` / `readApprovalDecision` / `requestClientToolDecision` / `TOOL_APPROVAL_TIMEOUT_MS`），行为零变化 —— AC-168 的判据文件与 `claude-host-driver.provider.ts` 的 import 都不必改。
   - `codex-runtime.provider.ts` 的 `codexRuntime` 增加 `permissions: { resolve, listPending, classifyMissingApproval, readApprovalDecision }`，全部指向同一个共享服务实例；这就是 `provider-runtime.service.resolveToolApproval` 扇出到 Codex 的那条边。
2. **连接回写**（`codex-app-server.connection.ts`）：加 `respond(id: number|string, result: unknown): void` 与 `respondError(id, code, message): void`，写 `{jsonrpc:'2.0', id, result}` / `{jsonrpc:'2.0', id, error:{code,message}}`；id 原样回显（含数字 `0`）；`closed` / 进程已退出时 no-op 且不抛。
3. **Codex 驱动审批 broker**（`codex-host-driver.provider.ts`）：
   - 选项加 `connectedClientCount?: () => number`（默认 `() => 0`，与 Claude 同样以端口注入：不从 providers/list 反向 import websocket）与 `approvalTimeoutMs?: number`（默认 `TOOL_APPROVAL_TIMEOUT_MS`）；生产装配留给 AC-441。
   - `run()` 把本轮 writer 记到会话上（结束时清空，保留最后一个可用于回应落在边界上的请求）；连接创建时注册一次 `onServerRequest`，按 `params.threadId` 找会话。五类方法的分派与响应映射（用 `requestClientToolDecision` 发帧与等待，`provider:'codex'`，`toolName` 依次是 `commandExecution`/`fileChange`/`permissions`/`mcpElicitation`/`requestUserInput`，`input = {method, params}`）：
     - `item/commandExecution/requestApproval` / `item/fileChange/requestApproval`：allow→`{decision:'accept'}`；deny/超时/无人→`{decision:'decline'}`；`{cancelled:true}`→`{decision:'cancel'}`。
     - `mcpServer/elicitation/request`：allow→`{action:'accept', content: updatedInput?.content ?? null, _meta:null}`；deny/超时/无人→`{action:'decline', content:null, _meta:null}`；cancel→`{action:'cancel', content:null, _meta:null}`。
     - `item/permissions/requestApproval`：allow→`{permissions: updatedInput?.permissions ?? params.permissions, scope: updatedInput?.scope === 'session' ? 'session' : 'turn'}`；deny/超时/无人/cancel→`{permissions:{}, scope:'turn'}`（协议无 decline，空 grant 即不授予）。
     - `item/tool/requestUserInput`：allow→`{answers: updatedInput?.answers ?? {}}`；deny/超时/无人/cancel→`{answers:{}}`。
   - **无人值守判定**：`!writer || connectedClientCount() <= 0` → 不进客户端等待、不发 `permission_request` 帧，立即按上表拒绝，并发一条 `action_required` 通知（`code:'permission.unattended_refused'`，provider `codex`，meta 带 method/reason），同时记账。
   - **有界**：有客户端但一直不答时用 `approvalTimeoutMs` 超时→按拒绝回答（`null` 决策），不把请求留在 pending。
   - **生命周期**：`turn/completed` / `turn/failed` / `turn/interrupted`、`interrupt()`、`unbind`、`closeHost` 都会把该会话仍 outstanding 的请求一一回答（cancel/decline 映射），并清空 pending；连接已关时丢弃（没有 socket 可写，不算挂起）。
   - **非审批 server request**：`currentTime/read` → `{currentTimeAt: Math.floor(Date.now()/1000)}`，`attestation/generate` → `{token:''}`，其余 → `{}`，保证 server 永不因无人回答而停住（与 E7 脚本同形状）。
   - **会话读数扩展**：`readSession()` 增加 `threadStatus: 'idle'|'active'|null`、`activeFlags: string[]`、`waitingOnApproval: boolean`（`activeFlags.includes('waitingOnApproval') || pending.length > 0`）、`pendingApprovals: Array<{requestId, method, toolName}>`；`thread/status/changed` 通知写入 `threadStatus/activeFlags`。
4. **新判据** `server/modules/providers/tests/codex-resident-approvals.test.ts`（hermetic：复用 AC-435 的内存假 transport，固定假 pid；不 spawn 真 codex、不碰 DB/网络；`resolveToolApproval` 走真实共享服务）。假 transport 能主动发五类 server request 并记录 driver 写出的响应帧；五类各带真实 params 形状（取自上面的生成类型 / E7 读数），并按真实顺序发 `thread/status/changed` 的 `waitingOnApproval` 与 `activeFlags:[]`。
5. **非目标**：不挂 `codex.provider.ts` 的 `hostDriver`、不改 capabilities / `residentFeatures`（AC-441/442）；不做 queue（AC-436）、settings（AC-437）、background lease（AC-439）、experimentalApi/未知通知（AC-440）、浏览器 UI（AC-443）；不实现 `acceptForSession` / execpolicy / network amendment（只写 `accept`）、不做 `rememberEntry` 语义；不改 Claude 驱动的行为（只把通用实现搬到共享服务并保持 re-export）；不改 per-run `codex-runtime.provider.ts` 的 run/abort 行为（只加 permissions facet）。

**假形态（只改实现，不改判据文件）**

- **A 无人值守静默不响应**：无人分支直接 return、不回 JSON-RPC（或改成等 `approvalTimeoutMs`）⇒ criterion 退出 **1**（AC 逐字要求“无人值守静默不响应必须红”）。
- **B 只接一类 / 帧标错 provider**：只处理 commandExecution，或调 `requestClientToolDecision` 不传 `provider`（帧变成 `claude`）⇒ criterion 退出 **1**。
- **C accept/decline 反向**：allow 回答 decline、deny 回答 accept ⇒ criterion 退出 **1**。
- **D waitingOnApproval 不清**：答复后不把 pending 摘掉、读数恒 true ⇒ criterion 退出 **1**。

## Plan

1. 读 `claude-runtime.provider.ts` 的 pending/ledger 实现与所有 import 点；抽出 `approval-requests.service.ts`，先单独跑 Claude 判据确认行为零变化。
2. 给 `codex-app-server.connection.ts` 加 `respond` / `respondError`，先写这一段的判据腿。
3. 在 `codex-host-driver.provider.ts` 加 attendance 端口、`onServerRequest` 分派、五类映射、等待/超时/生命周期清理与 `readSession` 扩展。
4. 给 `codexRuntime` 加 permissions facet；用 `createProviderRuntimeService` 验证扇出。
5. 写判据：先打印每类帧/响应/读数，再收紧断言；跑 criterion 到 exit 0、`fail 0`。
6. 跑 Claude 回归（`claude-resident-permissions.test.ts`、`claude-turn-phase.test.ts`）、`codex-host-driver-persistent.test.ts`、`npm run typecheck`。
7. 实测 A/B/C/D 四个假形态（临改实现 → exit 1 → 抄逐字红态 → `git checkout --` 还原，`git status --short` 无残留）。
8. `git diff --name-only develop...HEAD` 核对只落在 Touches；若 AC-435 的空壳文件不在树上（depends_on 尚未落地），停止并报告，不自行重建连接/驱动。

## AC

- [ ] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-approvals.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 15`。红态基线已测：同命令当前 exit 1、文案逐字 `Could not find 'server/modules/providers/tests/codex-resident-approvals.test.ts'`。
- [ ] AC2 连接回写帧：判据打印 `respondFrame={"jsonrpc":"2.0","id":7,"result":…}`、`respondErrorFrame={"jsonrpc":"2.0","id":8,"error":{"code":-32000,"message":"…"}}`、`zeroIdFrame={"jsonrpc":"2.0","id":0,"result":…}`；id 原样回显（含数字 `0`）；`close()` 后 `respond` 不写帧且不抛（`closedNoop=true`）。
- [ ] AC3 五类都产生 `permission_request` 帧：对每个 method 打印 `method=… frames=1 provider=codex toolName=… inputMethod=… requestIdNonEmpty=true`；五类的 `toolName` 依次为 `commandExecution`/`fileChange`/`permissions`/`mcpElicitation`/`requestUserInput`，帧的 `input.method` 等于协议方法逐字；在客户端回答前**没有**任何 JSON-RPC 响应（`parkedResponses=0`）。
- [ ] AC4 accept 路由：五类各 `resolveToolApproval(requestId, {allow:true, updatedInput})`，逐字打印并断言响应：commandExecution/fileChange `{"decision":"accept"}`；permissions `{"permissions":<请求的 profile>,"scope":"turn"}`（`updatedInput.scope==='session'` 时为 `session`）；elicitation `{"action":"accept","content":<updatedInput.content 或 null>,"_meta":null}`；userInput `{"answers":<updatedInput.answers>}`。每类各收到一条 `permission_resolved` 帧，`getPendingApprovalsForSession` 排空。
- [ ] AC5 decline 路由：五类各 `resolveToolApproval(requestId, {allow:false})` → commandExecution/fileChange `{"decision":"decline"}`；permissions `{"permissions":{},"scope":"turn"}`；elicitation `{"action":"decline","content":null,"_meta":null}`；userInput `{"answers":{}}`。打印五行；turn 继续（假 server 收到全部响应后发 `turn/completed`，`run` resolve，零次 `turn/interrupt`）。
- [ ] AC6 cancel 映射：`resolveToolApproval(id,{cancelled:true})` → commandExecution/fileChange `{"decision":"cancel"}`、elicitation `{"action":"cancel",…}`；permissions/userInput 回落为 deny 形状（协议无 cancel 词汇）。打印 `cancelMappings=[…]`；进程未重启、pid 不变、零次 `turn/interrupt`。
- [ ] AC7 waitingOnApproval 状态：假 server 在请求未答时发 `thread/status/changed {threadId,status:{type:'active',activeFlags:['waitingOnApproval']}}`，打印 `parkedWaiting=true parkedPending=1 activeFlags=["waitingOnApproval"]`；答复后（含假 server 随后发 `activeFlags:[]`）打印 `settledWaiting=false settledPending=0`；无人值守的请求最终读数同样是 `waitingOnApproval=false`。
- [ ] AC8 无人值守不挂起（AC 的假形态腿）：`connectedClientCount()=>0`（可中途翻转），五类各请求一次，打印 `method=… unattendedResponse=<json> elapsedMs=<n> frames=0`；五条响应都在 1000ms 内到达、`permission_request` 帧数 **0**、每类一条 `permission.unattended_refused` 通知（provider `codex`）、pending 为空。静默不回的实现必须在这里红。
- [ ] AC9 有界超时：`connectedClientCount()=>1` 但判据不调用 `resolveToolApproval`，`approvalTimeoutMs: 40`；打印 `timeoutResponse=<json> elapsedMs=<n> parked=false`；响应为拒绝形状、pending 排空、turn 继续。证明“有人但没答”也不挂起。
- [ ] AC10 非审批 server request 不停住：假 server 依次发 `currentTime/read`（id 900）、`attestation/generate`（id 901）、`unknown/whatever`（id 902），打印三条响应；`currentTimeAt` 是数字、`token` 是字符串、未知为 `{}`，均在 1000ms 内。
- [ ] AC11 生命周期清理：请求 parked 时 `interrupt()` → 该请求被回答为 cancel/deny 形状、pending 排空、pid 不变；同样验证 `closeHost`（连接关闭后不再尝试写、pending 排空）与 `unbind`；打印 `interruptAnswered=… closeDrained=true unbindDrained=true`。
- [ ] AC12 客户端决策扇出走真实 provider runtime：`createProviderRuntimeService({listProviders: () => [fakeCodexProvider]})` 的 `resolveToolApproval` 到达 Codex facet，打印 `fanoutSettled=true pendingViaRuntime=1 decisionRecorded=true secondResolveNoop=true`；第二次对同一 id resolve 不产生第二次结算。
- [ ] AC13 反向控制可达：把伪造读数 `{frames:0, responses:[], waiting:true}` 喂给“五类都发帧且排空”的断言必须 throw，把 `{response:{decision:'accept'}}` 喂给“无人值守必须是拒绝”的断言必须 throw；打印 `negativeControlThrew=true` 两次，证明判据不是恒真。
- [ ] AC14 Claude 面零漂移：`claude-runtime.provider.ts` 的 `resolveToolApproval`/`getPendingApprovalsForSession`/`classifyMissingApproval`/`readApprovalDecision`/`requestClientToolDecision`/`TOOL_APPROVAL_TIMEOUT_MS` 五个名字仍可从原路径导入且与共享服务同源；`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-permissions.test.ts` 退出 0，`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-turn-phase.test.ts` 退出 0，`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0，`npm run typecheck` 退出 0。
- [ ] AC15 四个假形态承重：A（无人值守静默不回）、B（只接 commandExecution 或帧标 `claude`）、C（accept/decline 反向）、D（waitingOnApproval 不清）各让 criterion 退出 **1**；四次退出码与逐字红态文案抄进完成记录。还原后 `git status --short` 无残留。
- [ ] AC16 范围不越界：`git diff --name-only develop...HEAD` 仅含 Touches 列出的文件；`git diff --name-only develop...HEAD | grep -E 'codex\.provider\.ts|provider-capabilities\.service\.ts|provider-runtime\.service\.ts|codex-runtime\.provider\.ts'` 输出为空（`codex-runtime.provider.ts` 除外——它只允许出现 `permissions` facet 这一段；用 `git diff develop...HEAD -- server/modules/providers/list/codex/codex-runtime.provider.ts` 人工核对只增 facet）；`codex-app-server.client.ts` / `codex.provider.ts` 零改动。

## DoD

判据在落地后的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录里贴出：(a) 五类的 `permission_request` 帧读数（method/toolName/provider/requestId）、(b) accept 五条响应逐字 JSON、(c) decline 五条响应逐字 JSON、(d) cancel 映射与 pid/turn 读数、(e) `parkedWaiting`/`settledWaiting` 与 `activeFlags` 序列、(f) 无人值守五条的 `elapsedMs`/`frames=0`/响应、(g) 有界超时读数、(h) 非审批三条响应、(i) 生命周期清理三条读数、(j) provider-runtime 扇出与幂等读数、(k) 两个反向控制判定、(l) A/B/C/D 四次假形态的退出码与逐字红态文案、(m) Claude 三个回归与 typecheck 的退出码。改动只落在 Touches；`codex.provider.ts`、shipped capabilities、`provider-runtime.service.ts`、per-run runtime 的 run/abort、fork client 零改动。完成后 goal driver 下一轮以 `goal_ac: AC-438` 独立复跑原 criterion 时由红翻绿；且翻绿有分辨力：无人值守静默不响应的实现必红，只接一类或帧标 `claude` 的实现必红，accept/decline 反向的实现必红，`waitingOnApproval` 不清的实现必红。

## Touches

- server/modules/providers/services/approval-requests.service.ts (new)
- server/modules/providers/list/claude/claude-runtime.provider.ts
- server/modules/providers/list/codex/codex-app-server.connection.ts
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-runtime.provider.ts
- server/modules/providers/tests/codex-resident-approvals.test.ts (new)
- tasks/gap-ac438-codex-resident-approvals-broker.md
