---
id: gap-ac440-codex-app-server-protocol-gate
title: AC-440 Codex 常驻：initialize 声明 capabilities.experimentalApi=true、缺失时
  thread/queue/add 被拒且驱动 fail-closed、未知 notification 放过不中断读取循环
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac435-codex-resident-host-driver-persistent
goal_ac: AC-440
---
## Proposal

<!-- dedup-ref --> 机制去重与粒度（本轮实测，2026-10-29）：`grep -l '^goal_ac: *AC-440' tasks/*.md` → 0 个文件；`grep -ril 'experimentalApi|experimental-api|codex-app-server-protocol' tasks/*.md` → 只命中四个兄弟任务：`gap-ac435…` 的 `initialize` 处留 `capabilities: {}` 并注明「Queue and per-turn settings need experimentalApi and belong to AC-436/437」；`gap-ac436…` / `gap-ac437…` / `gap-ac438…` 三处都把「experimentalApi 声明与未知通知放过（AC-440）」写进自己的非目标。没有一条认领本 AC。`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/providers/list/codex/codex-app-server.connection.ts --touches server/modules/providers/list/codex/codex-host-driver.provider.ts --touches server/modules/providers/tests/codex-app-server-protocol.test.ts --json` 返回 `reasons: []`、`peers: [gap-ac435（ready，共享 connection+driver）, gap-ac436/437/439（共享 driver）, gap-ac438（共享 connection+driver）]`。**决定：separate，不 merge** —— 本条有独立判据文件与独立验收（协议门控 ≠ 队列 ≠ 设置 ≠ 审批）；长驻连接由 gap-ac435 先建，关系边用顶层 `depends_on` 登记（SQL 关系边，不是散文前置）；与 ac436…ac439 的文件重叠由调度器按 Touches 串行。

**来源与判据物。** criterion 逐字取自 `goals/AC-440-协议门控-experimentalapi-声明与未知通知放过.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-app-server-protocol.test.ts`。红态基线（本轮直跑，不是推断）：该命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-app-server-protocol.test.ts'`。`.quay/gate-events.jsonl` 里 AC-440 最近三条 fail 的 `treeSha` 都是 `89f5a7c4…`，与当前树不同，但本轮已在当前树重跑同命令，仍是 exit 1 ⇒ 红是真的，不是过期读数。

**现状（本轮读的读数）**

- 长驻连接已由 AC-435 落地在 `task/gap-ac435-codex-resident-host-driver-persistent` 分支（commit `90901930f`，尚未并入 develop）。它的 `initialize()` 逐字发 `capabilities: {}`，源码注释写着「`capabilities` is deliberately empty … Queue and per-turn settings need `experimentalApi` and belong to AC-436/437」——声明本身没人认领，就是本条。
- 该连接的 `request()` 目前只有通用超时与 `CODEX_APP_SERVER_ERROR`（`statusCode 502`，`details.rpcCode`）两条失败路径，没有「实验方法」概念：`-32600 requires experimentalApi capability` 会被原样抛成普通 RPC 错误，调用方无从知道这是能力缺失（不可 fail-closed）。
- 该连接的 `handleFrame()` 对 `typeof message.method === 'string'` 的帧直接同步调所有 notification handler；任何一个 handler 抛错都会冒泡进 transport 的 `onMessage`，在真实 readline 实现里就是从 `'line'` 事件里抛出的未捕获异常 ⇒ 读循环中断、长驻进程失去后续所有通知（pid 还在，会话已聋）。这就是「未知 notification 放过不中断读取循环」要防的形态。
- 真实 0.153.4 确实会发大量当前 driver 不认识的 notification（`tmp/codex-appserver-exp-NuPHhk/*.jsonl` 的 `dir:\"in\"` 帧计数，本轮实测）：`item/agentMessage/delta`（1536）、`mcpServer/startupStatus/updated`（71）、`item/started`/`item/completed`（各 43）、`thread/status/changed`（38）、`thread/tokenUsage/updated`（21）、`account/rateLimits/updated`（20）、`remoteControl/status/changed`（18）、`configWarning`（18）、`turn/moderationMetadata`（17）、`thread/started`（17）、`thread/queue/changed`（10）、`thread/settings/updated`（7）、`thread/goal/cleared`（3）、`deprecationNotice`（3）、`serverRequest/resolved`（2）、`warning`/`error`（各 1）。其中 `configWarning` 在 E1 里出现在 `initialize` 的响应**之前**，且 params 是 `{summary, details}`、**没有 threadId**：驱动现在的 `handleNotification` 靠 `params.threadId` 早退，正好靠「放过」活着。
- 协议约定（`tmp/codex-appserver-exp-NuPHhk/REPORT.md:9,50,165` 与 `e2-queue-while-busy.jsonl:46`）：`initialize` 声明 `capabilities.experimentalApi=true` 是 `thread/queue/*` 的前置；实验脚本 `appserver-client.mjs:139` 就是这么声明的；未声明时服务端逐字回 `{\"error\":{\"code\":-32600,\"message\":\"thread/queue/add requires experimentalApi capability\"},\"id\":5}`。
- 收窄：`initialize` 一旦声明 true，AC-435 的假 transport（只按方法名应答、不校验 capabilities）不受影响；AC-436 的队列方法也因此拿到前置。本条不实现任何队列语义。

**要建的东西**

1. `server/modules/providers/list/codex/codex-app-server.connection.ts`（改）：
   - 选项 `experimentalApi?: boolean`，默认 **true**；`initialize()` 据此发 `capabilities: this.experimentalApi ? { experimentalApi: true } : {}`，并把「声明了什么」记成只读读数 `experimentalApiDeclared`。
   - 实验方法集合 = 前缀 `thread/queue/`（REPORT 钉住的那组）。`request()` 对实验方法先过门：
     - 未声明（`experimentalApiDeclared === false`）或已 latch（见下）⇒ 立即以 `AppError`、`code: 'CODEX_EXPERIMENTAL_API_UNAVAILABLE'` 拒绝，**零帧**写到 transport（fail-closed 在本地完成，不把注定被拒的帧打出去）；
     - 正常发出后若服务端回 JSON-RPC 错误且 `message` 含 `requires experimentalApi capability`（不区分 `code` 的具体值，但判据按 0.153.4 的 `-32600` 断言）⇒ 以同一 `code` 拒绝，并 **latch** `experimentalApiRejected = true`；任何方法收到这条错误都 latch（catch-all），不只队列方法。
   - 只读读数：`experimentalApiDeclared`、`experimentalApiRejected`、`isExperimentalApiAvailable()`（`declared && !rejected`）。
   - `handleFrame()` 的通知分发逐 handler 隔离：每个 handler 单独 try/catch，抛错不中断同一帧的其余 handler、不影响后续帧、不拒绝 pending 请求；错误文本记到 `lastDispatchError`（可观测，不静默）。帧本身仍按 method 有无、id 有无分派，未知 method 一律照常发给订阅者（不 drop、不报协议错）。
2. `server/modules/providers/list/codex/codex-host-driver.provider.ts`（改）：加 `experimentalApiAvailable(appSessionId: string): boolean` —— 未 bind、连接未建、未完成握手、连接已关/进程已退出、或 `isExperimentalApiAvailable()` 为假时一律 **false**；否则 true。这是 AC-436 忙时输入路径要读的 fail-closed 读数（本条不消费它，只提供并钉住）。不改 `IProviderHostDriver`，不动 `run`/`submit`/`interrupt`/`reconfigure`。
3. `server/modules/providers/tests/codex-app-server-protocol.test.ts`（new，hermetic：注入内存假 transport，固定假 pid，不 spawn 真 codex、不碰 DB/网络）：
   - 假 transport 复刻 0.153.4 的两条真实行为：(i) `initialize` 收到 `params.capabilities.experimentalApi === true` 才允许 `thread/queue/*`，否则回逐字 `{\"code\":-32600,\"message\":\"thread/queue/add requires experimentalApi capability\"}`；(ii) 可以按测试指令在任意时刻注入任意 notification（含未知 method、params 为 null、无 threadId）。另有 `honorExperimentalApi` 开关，用来在没有加声明的情况下仍能构造「服务端拒」的腿；记录方法序列、每帧原文、`queueAddFramesWritten` 计数。
   - 判据腿见 `## AC` AC2–AC8。

**非目标**：不实现队列语义（忙时 `run` 走 `thread/queue/add`、深度真值、撤回、自动排水——AC-436）；不做 settings（AC-437）、审批 broker（AC-438）、后台 lease（AC-439）、宿主层 lease/busy-idle（AC-441）、provider 挂载与 capabilities 表（AC-442）、restore/E2E（AC-443）；不改 `codex.provider.ts` / `provider-capabilities.service.ts` / `provider-runtime.service.ts` / `codex-runtime.provider.ts` / `codex-app-server.client.ts`；不把 `item/*`、`process/*`、`configWarning` 等未知帧归一化成 UI 帧（那是后续集成任务的事），本条只保证它们被放过而不打断循环。

**三个假形态（只改实现，不改判据文件）**

- A 不声明：把 `initialize()` 改回 `capabilities: {}`（声明恒 false）⇒ criterion 退出 **1**（AC2 的声明腿红）。
- B 不做 fail-closed：删掉本地门与 latch，让 `-32600 requires experimentalApi capability` 以普通 `CODEX_APP_SERVER_ERROR` 抛出、`isExperimentalApiAvailable()` 恒 true ⇒ criterion 退出 **1**（AC4/AC5 的 code 与可用性读数红）。
- C 不隔离通知 handler：删掉 per-handler try/catch，让订阅者抛错直接冒泡 ⇒ criterion 退出 **1**（AC7 的读取循环腿红；异常从假 transport 的 `emit` 冒出来）。

三次退出码与逐字红态抄进完成记录，`git checkout --` 还原，确认 `git status --short` 只剩 Touches。

## Plan

1. 读 `task/gap-ac435-…` 分支上的 `codex-app-server.connection.ts` / `codex-host-driver.provider.ts` 与 `tmp/codex-appserver-exp-NuPHhk/REPORT.md:9,50,165`、`e2-queue-while-busy.jsonl:46`、`appserver-client.mjs:139`，确认声明形状、拒绝文案与真实未知通知序列（E1 的 `configWarning` 在 initialize 响应之前）。
2. 改连接：`experimentalApi` 选项与声明、实验方法本地门 + 服务端错误 latch、三个只读读数、通知分发的 per-handler 隔离与 `lastDispatchError`。
3. 改 driver：`experimentalApiAvailable(appSessionId)` 的 fail-closed 读数。
4. 写判据文件：假 transport（声明校验 + 任意通知注入 + 帧计数）+ AC2–AC8 七组腿；先打印每帧原文与读数，再收紧断言。
5. 跑 criterion 至退出 0；跑 `codex-host-driver-persistent.test.ts` 与 `npm run typecheck`。
6. 实测 A/B/C 三个假形态（临改实现 → 退出 1 → 记录逐字红态 → 还原），确认 diff 只落在 Touches。

## AC

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-app-server-protocol.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 6`。红态基线已测：同命令当前 exit 1、文案逐字 `Could not find 'server/modules/providers/tests/codex-app-server-protocol.test.ts'`。
- [x] AC2 initialize 声明：打印 driver 经注入 transport 发出的 `initialize` 帧原文；`params.capabilities.experimentalApi === true`（严格布尔，不是字符串/真值性），打印 `initializeCapabilities={\"experimentalApi\":true}`。反向腿：同一假 transport、连接以 `experimentalApi:false` 构造时打印 `initializeCapabilities={} experimentalApiKeyPresent=false`，证明读的是声明而不是常量。
- [x] AC3 声明是开关：同一假 transport 的两个臂，唯一差别是 `initialize` 有没有声明 —— 声明 true 时 `thread/queue/add` 被接受（打印 `declaredQueueAdd=accepted`）；未声明时服务端逐字回 `{\"code\":-32600,\"message\":\"thread/queue/add requires experimentalApi capability\"}`（打印 `undeclaredQueueAdd=rejected rpcCode=-32600 message=thread/queue/add requires experimentalApi capability`）。两臂断言各自成立。
- [x] AC4 缺失即拒绝且本地 fail-closed：连接以 `experimentalApi:false` 握手后，`connection.request('thread/queue/add', …)` 以 `AppError` 拒绝，`error.code === 'CODEX_EXPERIMENTAL_API_UNAVAILABLE'`；打印 `localGateCode=CODEX_EXPERIMENTAL_API_UNAVAILABLE queueAddFramesWritten=0`，且该 promise 是 reject 而不是被吞掉后 resolve；`driver.experimentalApiAvailable(appSessionId) === false`。
- [x] AC5 服务端拒绝也 fail-closed（latch + 有界）：声明 true 但假 transport 置 `honorExperimentalApi=false`；第一次 `thread/queue/add` 以同一 `code` 拒绝并打印 `serverRejectionCode=CODEX_EXPERIMENTAL_API_UNAVAILABLE rpcCode=-32600`；latch 后第二次同方法调用仍以同一 `code` 拒绝且 `queueAddFramesWritten` 仍为 `1`（第二次零帧）；`driver.experimentalApiAvailable(...) === false`；门只关实验面：同一 session 随后一次普通 `turn/start` 成功、`threadId` 与 `pid` 不变、`connection.isAlive() === true`，打印这五项。
- [x] AC6 未知通知放过、读取循环不断：在 `turn/started` 与 `turn/completed` 之间注入四个当前 driver 不认识的 notification —— `configWarning`（params 无 threadId）、`account/rateLimits/updated`（无 threadId）、`item/started`（带本 session threadId）、`futureFeature/doesNotExist`（`params:null`）；断言该轮终态 `completed`、`connection.isInitialized === true`、`isAlive() === true`，且此后一次请求仍能 round-trip；打印 `unknownNotifications=[configWarning,account/rateLimits/updated,item/started,futureFeature/doesNotExist] turnStatus=completed postLoopRequest=ok`。同时打印 writer 转写集合：带 threadId 的未知帧被转发、不带的不被转发。
- [x] AC7 handler 抛错不打断循环：注册一个对 `configWarning` 抛 `Error('boom-from-unknown-notification')` 的订阅者，再注入该通知，随后注入 `turn/completed`；断言该轮仍 `completed`、后续请求仍 resolve、连接仍存活，打印 `handlerThrew=boom-from-unknown-notification loopContinued=true laterRequest=ok lastDispatchError=…`；`lastDispatchError` 含 `boom-from-unknown-notification`（错误被记录而非静默吞掉）。
- [x] AC8 反向控制可达：测试内把「未声明」读数喂给声明断言、把「未知帧到达后该轮未结算」的读数喂给放过断言、把「handler 抛错后后续帧丢失」的读数喂给循环断言，三者都必须 reject；各自打印判定，证明判据不是恒真。
- [x] AC9 三个假形态承重：A 声明恒 false、B 无本地门/无 latch 且可用性恒 true、C 通知分发无隔离，各自令 criterion 退出 **1**；三次红态文案逐字记录；还原后 `git status --short` 无残留。
- [x] AC10 无回归：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0；`npm run typecheck` 退出 0。
- [x] AC11 范围不越界：`git diff --name-only develop...HEAD` 仅含 Touches 列出的文件；`git diff --name-only develop...HEAD | grep -E 'codex\\.provider\\.ts|provider-capabilities\\.service\\.ts|provider-runtime\\.service\\.ts|codex-runtime\\.provider\\.ts|codex-app-server\\.client\\.ts'` 输出为空。
- [x] AC12 如实登记：完成记录写明假 transport 形态与锁定协议版本（0.153.4）、`experimentalApi` 的逐字拒绝文案与出处（REPORT:50 / E2 第 46 行）、真实未知通知来源（E1 的 `configWarning` 早于 initialize 响应、`dir:\"in\"` 帧计数）、三个假形态的实测退出码与逐字红态，以及未实现项（队列语义、settings、approvals、background、宿主层、provider 挂载/capabilities、restore/E2E）。

## DoD

判据在落地后的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录贴出 (a) 声明为 true 与 false 两臂的 `initialize` 帧原文；(b) 声明开关两臂的 `thread/queue/add` 结果与逐字 `-32600` 文案；(c) 本地门的 `CODEX_EXPERIMENTAL_API_UNAVAILABLE` 与 `queueAddFramesWritten=0`；(d) 服务端拒绝的 latch、第二次零帧、`experimentalApiAvailable=false`、普通 turn 仍可跑与 pid/threadId 不变；(e) 四个未知通知注入后的终态、存活与后续请求读数，以及 writer 转写集合；(f) handler 抛错后的循环存活与 `lastDispatchError`；(g) 三个反向控制判定；(h) A/B/C 三个假形态的退出码与逐字红态文案。`codex-host-driver-persistent.test.ts` 与 `npm run typecheck` 退出 0。改动只落在 Touches；`codex.provider.ts` / shipped capabilities / `provider-runtime.service.ts` / per-run runtime / fork client 零改动。完成后 goal driver 下一轮以 `goal_ac: AC-440` 独立复跑原 criterion 时由红翻绿；且翻绿有分辨力：不声明的变体必红，不 fail-closed 的变体必红，通知 handler 抛错即断流的变体必红。

## Touches

- server/modules/providers/list/codex/codex-app-server.connection.ts (new)
- server/modules/providers/list/codex/codex-host-driver.provider.ts (new)
- server/modules/providers/tests/codex-app-server-protocol.test.ts (new)
- tasks/gap-ac440-codex-app-server-protocol-gate.md
- server/shared/tests/quay-test-script.test.ts (计数钉：新判据文件令 collected 466→467，AC2 unknown 463→464、AC3 unknown 465→466)
- scripts/suite-duration-baseline.tsv (数据行：新判据文件入 baseline，保住 AC7 的 90% 覆盖率下限，421/467)

## 完成记录

**判据（AC1）**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-app-server-protocol.test.ts` → exit **0**，`pass 7`、`fail 0`（AC2/AC3/AC4/AC5/AC6/AC7/AC8 七组腿）。

**协议锁定与出处**：`@openai/codex 0.153.4`。`initialize` 声明 `capabilities.experimentalApi=true` 是 `thread/queue/*` 前置：`tmp/codex-appserver-exp-NuPHhk/REPORT.md:9,50,165`；声明形状见 `appserver-client.mjs:139`。逐字拒绝 `{"error":{"code":-32600,"message":"thread/queue/add requires experimentalApi capability"},"id":5}` 出自 `e2-queue-while-busy.jsonl:46`。

**真实未知通知来源**：`tmp/codex-appserver-exp-NuPHhk/e1-persistent-thread.jsonl` 的 `dir:"in"` 帧 —— `configWarning` 出现在 `initialize` 响应之前且 params 为 `{summary,details}`、无 threadId（第 6 行）；同批 `dir:"in"` 帧计数另有 `item/agentMessage/delta`（1536）、`mcpServer/startupStatus/updated`（71）、`item/started`/`item/completed`（各 43）、`thread/status/changed`（38）、`account/rateLimits/updated`（20）等。判据取其中四个代表形态：`configWarning`、`account/rateLimits/updated`、`item/started`、`futureFeature/doesNotExist`。

**假 transport 形态**：内存 `FakeAppServerTransport`（固定 pid 515151，不 spawn 真 codex、不碰 DB/网络）；`initialize` 记录 `capabilities.experimentalApi === true` 才算声明，`thread/queue/add` 仅在「已声明且 `honorExperimentalApi`」时接受，否则回逐字 `-32600`；`inject(method, params)` 可在任意时刻注入任意 notification（含 `params:null`、无 threadId）；记录方法序列、每帧原文、`queueAddFramesWritten`。

**(a) initialize 两臂帧原文**
- 声明臂：`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"cloudcli","title":"CloudCLI","version":"1"},"capabilities":{"experimentalApi":true}}}`；读数 `initializeCapabilities={"experimentalApi":true}`（严格布尔 true）。
- 未声明臂（同一 driver / 同一假 transport 类，仅连接以 `experimentalApi:false` 构造）：`initializeCapabilities={} experimentalApiKeyPresent=false`。

**(b) 声明开关两臂**
- 声明 true：`declaredQueueAdd=accepted result={"queuedSubmission":{"id":"queued-1"}}`。
- 未声明：`undeclaredQueueAdd=rejected rpcCode=-32600 message=thread/queue/add requires experimentalApi capability`（逐字等于 E2 第 46 行）。该臂直接驱动假 transport 本身：本地门（AC4）会先拒发帧，服务端逐字拒绝只能在桩上观察；两臂同一假 transport 类，唯一差别是 initialize 有没有声明。

**(c) 本地门**
- `localGateCode=CODEX_EXPERIMENTAL_API_UNAVAILABLE queueAddFramesWritten=0`；promise reject（不是被吞掉后 resolve）；`driver.experimentalApiAvailable('session-local-gate')===false`。

**(d) 服务端拒绝 latch + 有界 + 稳定面存活**
- 第一次：`serverRejectionCode=CODEX_EXPERIMENTAL_API_UNAVAILABLE rpcCode=-32600`，`queueAddFramesWritten=1`，`experimentalApiRejected=true`。
- latch 后第二次：`latchedCode=CODEX_EXPERIMENTAL_API_UNAVAILABLE queueAddFramesWritten=1`（第二次零帧）。
- 随后普通 turn：`ordinaryTurnStatus=completed threadIdBefore=thread-restored-5 threadIdAfter=thread-restored-5 pidBefore=515151 pidAfter=515151 isAlive=true`；`driver.experimentalApiAvailable(...)===false`。

**(e) 四个未知通知**
- `unknownNotifications=[configWarning,account/rateLimits/updated,item/started,futureFeature/doesNotExist] turnStatus=completed postLoopRequest=ok`；`connection.isInitialized=true`、`isAlive()=true`。
- writer 转写集合：`forwarded=turn/started,item/started,turn/completed` —— 带本 session threadId 的未知帧 `item/started` 被转发；无 threadId 的 `configWarning` / `account/rateLimits/updated` / `futureFeature/doesNotExist` 不被转发。

**(f) handler 抛错**
- `handlerThrew=boom-from-unknown-notification loopContinued=true laterRequest=ok lastDispatchError=notification handler for "configWarning" threw: boom-from-unknown-notification`。

**(g) 反向控制**
- `reverseUndeclaredRejected=true reverseUnsettledTurnRejected=true reverseDroppedFrameRejected=true reverseBrokenLoopRejected=true reverseSilentSwallowRejected=true`。

**(h) 三个假形态（临改实现 → 跑原命令 → 记录逐字红态 → `git checkout --` 还原；还原后 `git status --short` 为空）**
- A（声明恒 false，`capabilities:{}`）：exit **1**，`pass 4 fail 3`；逐字红态 `declared arm: experimentalApi must be a boolean` / `actual: 'undefined'` / `expected: 'boolean'`（AC2），AC3/AC5 同红。
- B（删本地门与 latch、可用性恒 true、-32600 走普通错误）：exit **1**，`pass 5 fail 2`；逐字 `localGateCode=CODEX_APP_SERVER_ERROR queueAddFramesWritten=1` 与 `actual: 'CODEX_APP_SERVER_ERROR'` / `expected: 'CODEX_EXPERIMENTAL_API_UNAVAILABLE'`（AC4/AC5）。
- C（通知分发无 per-handler try/catch）：exit **1**，`pass 6 fail 1`；逐字 `Error: boom-from-unknown-notification`（AC7，异常从假 transport 的 deliver 冒出）。

**AC10 无回归**：`codex-host-driver-persistent.test.ts` → `pass 5 fail 0`，exit 0；`npm run typecheck` exit 0。

**AC11 范围**：`git diff --name-only goal/GOAL-051...HEAD` = 本任务 5 个文件（connection / driver / 新判据 / quay-test-script 计数钉 / suite-duration-baseline 数据行），全部列在 Touches；禁区 grep（`codex.provider.ts|provider-capabilities.service.ts|provider-runtime.service.ts|codex-runtime.provider.ts|codex-app-server.client.ts`）输出为空。补注：`git diff develop...HEAD` 还会列出 goal 分支既有 AC-435/439 的落地文件，那些不是本任务写入；本任务写集以 anti-drift 门实际使用的 `goal/GOAL-051...HEAD` 为准。

**未实现（非目标）**：队列语义（忙时 `run` 走 `thread/queue/add`、深度真值、撤回、自动排水——AC-436）；settings（AC-437）；审批 broker（AC-438）；后台 lease（AC-439）；宿主层 lease/busy-idle（AC-441）；provider 挂载与 capabilities 表（AC-442）；restore/E2E（AC-443）。未改 `codex.provider.ts` / `provider-capabilities.service.ts` / `provider-runtime.service.ts` / `codex-runtime.provider.ts` / `codex-app-server.client.ts`。

该轴仍暗,理由:本条只新增协议门控与判据，未改变模块依赖图，也没有可读的 ArchGuard 周期/重复度量数值。