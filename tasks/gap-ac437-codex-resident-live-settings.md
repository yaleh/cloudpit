---
id: gap-ac437-codex-resident-live-settings
title: AC-437 Codex 常驻：thread/settings/update 实时生效（idle/active，pid
  不变）、turn/settings/update 按 step_model_switching 探测 fail-closed 拒绝
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac435-codex-resident-host-driver-persistent
goal_ac: AC-437
---
## Proposal

<!-- dedup-ref --> 机制去重与粒度（本轮实测，2026-10-29）：`grep -rl 'goal_ac: AC-437' tasks/` → 0 个文件；`grep -ril 'thread/settings/update\|step_model_switching' tasks/` → 只命中 `gap-ac435-codex-resident-host-driver-persistent.md` 与 `gap-ac436-codex-resident-queue-busy-input.md`，两者正文都把 settings 面明确划出自己的范围。`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/providers/list/codex/codex-host-driver.provider.ts --touches server/modules/providers/tests/codex-host-driver-settings.test.ts --json` 返回 `peers: [gap-ac435…, gap-ac436…]`（都只共享 driver 文件）、`mentions: []`。**决定：separate，不 merge** —— 本条有独立判据文件与独立验收（设置面 ≠ 队列面 ≠ 长驻生命期）；driver/connection 由 gap-ac435 先建，关系边用顶层 `depends_on` 登记（SQL 关系边，不是散文前置）；与 gap-ac436 只共享 driver，由调度器按 Touches 串行，不另立关系边。

**来源与判据物。** criterion 逐字取自 `goals/AC-437-实时设置-thread-settings-update-live-turn-settings-按能力拒绝.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-settings.test.ts`。红态基线（本轮直跑，不是推断）：该命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-settings.test.ts'`。

**现状（本轮读的读数）**

- 宿主层已有的设置动词就是实时设置：`server/shared/interfaces.ts:257` 的 `IProviderHostDriver.reconfigure(host, appSessionId, patch): Promise<'live' | 'next-turn'>`；`server/shared/types.ts:3112` 的 `HostReconfigurePatch = { model?, effort?, permissionMode? }`；`server/modules/providers/services/provider-runtime.service.ts:97` 另有 `HostReconfigureOutcome = 'live' | 'next-turn' | 'unsupported'`，`:985` 把 driver 的判决原样传出。MCP 侧 `server/modules/mcp-gateway/mcp-session-reconfigure.ts:275` 只在 `residentFeatures.liveReconfigure` 声明了该字段时才调 driver —— codex 的这份声明属 AC-442，本条不改 capabilities。
- 权限模式到 Codex 选项的既有映射在 `server/modules/providers/list/codex/codex-runtime.provider.ts:307` 的 `mapPermissionModeToCodexOptions`：`default` → `{sandboxMode:'workspace-write', approvalPolicy:'on-request'}`；`acceptEdits` → `{sandboxMode:'workspace-write', approvalPolicy:'never'}`；`bypassPermissions` → `{sandboxMode:'danger-full-access', approvalPolicy:'never'}`。app-server 的 `thread/settings/update` 要的是对象形状 `sandboxPolicy`，不是 per-run 的 `sandboxMode` 字符串；映射表相同、形状不同。
- 协议读数（锁定版 `@openai/codex 0.153.4`，`tmp/codex-appserver-exp-NuPHhk/`）：
  - E4（`e4-reading.json` + `e4-live-settings.jsonl`）：idle `thread/settings/update {threadId, model:'gpt-5.6-terra', effort:'medium', approvalPolicy:'on-request', sandboxPolicy:{type:'workspaceWrite',networkAccess:false,writableRoots:[]}}` 返回 `{}`，随后收到 `thread/settings/updated {threadId, threadSettings:{model,effort,approvalPolicy,sandboxPolicy,…}}`，`thread/read` 读到新 model/effort；active turn 期间同一方法的请求也被接受并回 `thread/settings/updated`（`effort=high`），pid `3602749` 前后不变。E4 的 active 那次只改了 model/effort；AC 要求 active 也覆盖 approvalPolicy/sandboxPolicy，判据在假 transport 上钉住 driver 的请求四字段与通知匹配（四字段在 idle 已由真机实证）。
  - 同一次 E4 里 `turn/settings/update {threadId,turnId,model,effort}` 回 JSON-RPC 错误 `{"code":-32600,"message":"turn settings updates require the step_model_switching feature"}`；REPORT 第 88 行记 `step_model_switching` 在 0.153.4 是 under development / 默认关闭。
  - 本轮另用真实二进制直接探了一次能力表（不是只读 REPORT）：`experimentalFeature/list` 返回 `{data:[…135 项…], nextCursor:null}`，其中 `step_model_switching` 逐字为 `{"name":"step_model_switching","stage":"underDevelopment","displayName":null,"description":null,"announcement":null,"enabled":false,"defaultEnabled":false}`；同样的调用在 `initialize` 只声明 `capabilities:{}` 时也成功，所以本条的探测不依赖 AC-440 的 `experimentalApi` 声明。
  - 注意：`thread/settings/update` 的 RPC 结果只是 `{}`，新设置是否真的落地只能由 `thread/settings/updated` 通知证明；driver 不能拿 RPC 返回当确认。
- 本条在 AC-435 创建的空壳之上扩展：AC-435 的 `codex-app-server.connection.ts` 已提供长驻连接、请求/通知分发与可注入 transport，`codex-host-driver.provider.ts` 已提供每 host 的连接状态、`threadId`、`activeTurnId`、`pid`。本条不重建连接，只加设置面。

**要建的东西**

1. 在 `server/modules/providers/list/codex/codex-host-driver.provider.ts` 落地 `reconfigure`（接口动词，直接覆盖 `IProviderHostDriver.reconfigure`）：
   - 解析 host → 长驻连接；`host.mode !== 'resident'`、连接不存在或已关闭 → `'next-turn'`；
   - `patch.model` / `patch.effort` 原样进入参数；`patch.permissionMode` 按上表映射成 `approvalPolicy` + `sandboxPolicy`（app-server 对象形状：`default` → `on-request` + `{type:'workspaceWrite', networkAccess:false, writableRoots:[]}`；`acceptEdits` → `never` + 同一 workspaceWrite；`bypassPermissions` → `never` + `{type:'dangerFullAccess'}`，最后这条的形状未在 E4 实测、判据不断言，保留为诚实映射）；
   - 发 `thread/settings/update {threadId, …请求字段}`，**只有**收到 `thread/settings/updated` 且 `params.threadId === threadId`、且 `threadSettings` 逐项等于本次请求的 model/effort/approvalPolicy/sandboxPolicy.type（以及请求里给了的 networkAccess）时才返回 `'live'`；通知要在一条可注入的超时内等到（判据注入短超时），超时 / RPC 错误 / 连接关闭 → `'next-turn'`；
   - 全程不碰 `pid`、`threadId`、`activeTurnId`，不重启、不杀进程。
2. 同文件加能力探测与 turn 级设置动词：
   - `settingsCapabilities(host, appSessionId): Promise<{ threadSettings: boolean; turnSettings: boolean }>`：无活连接 → `{threadSettings:false, turnSettings:false}`；否则 `threadSettings:true`（E4 已证），`turnSettings` 由每个连接**只探一次并缓存**的 `experimentalFeature/list` 决定：`data` 里存在 `name === 'step_model_switching'` 且 `enabled === true`（严格布尔）才是 true；探测抛错、结果非对象、`data` 非数组、条目缺失、`enabled` 非 true —— 一律 false（fail-closed；失败也缓存，不每轮重打）。
   - `reconfigureTurn(host, appSessionId, patch: {model?: string; effort?: string}): Promise<HostReconfigureOutcome>`：先读 `settingsCapabilities`；`turnSettings !== true`（或 thread 面也不可用）→ 返回 `'unsupported'`，且**零帧** `turn/settings/update`；只有探测为 true 才发 `turn/settings/update {threadId, turnId, …patch}`，成功 `'live'`、失败 `'next-turn'`。这条 true 分支在 0.153.4 默认不可达，它的存在只为让拒绝是一个真实分支（不是“方法不存在”），并让能力判决可执行。
3. 新判据 `server/modules/providers/tests/codex-host-driver-settings.test.ts`（hermetic：复用 AC-435 的可注入内存假 transport，固定假 pid，不 spawn 真 codex、不碰 DB/网络）。假 transport 实现 `initialize`、`thread/start|resume`、`turn/start|interrupt`、`thread/settings/update`、`turn/settings/update`、`experimentalFeature/list`；记录方法调用序列、每次 params、通知发射次数；通知由测试显式放行（不是一收到请求就自动发），以便证明 driver 的 `'live'` 依赖通知。
4. 非目标：不挂 `codex.provider.ts` 的 `hostDriver` 槽、不改 `provider-capabilities.service.ts` / `residentFeatures.liveReconfigure`（AC-442）；不改 `provider-runtime.service.ts`；不做 queue（AC-436）、experimentalApi 声明与未知通知放过（AC-440）、审批 broker（AC-438）、后台 lease（AC-439）、宿主层 lease/busy-idle（AC-441）、restore/E2E（AC-443）；不改 per-run `codex-runtime.provider.ts`、fork 客户端 `codex-app-server.client.ts`、长驻连接 `codex-app-server.connection.ts`。

**三个假形态（只改实现，不改判据文件）**

- A 宣称 turn 级设置已 live：让 `settingsCapabilities` 忽略探测、`turnSettings` 恒 true（或 `reconfigureTurn` 直接回 `'live'` 并发 `turn/settings/update`）⇒ criterion 退出 **1**（AC 的“宣称 turn/settings 已 live 必须红”）。
- B 拿 RPC 的 `{}` 当确认：`reconfigure` 一收到 `thread/settings/update` 的 `{}` 就返回 `'live'`、不等匹配通知（或在 active 轮改用 `turn/settings/update`）⇒ criterion 退出 **1**（挂在“未等到通知”/“错误方法”腿上）。
- C 用重启/杀进程来“应用”设置：pid 变化 ⇒ criterion 退出 **1**（挂在 pid 稳定腿上）。

三次退出码与红态文案抄进完成记录，`git checkout --` 还原，确认 `git status --short` 只剩 Touches。

## Plan

1. 读 AC-435 落地的 `codex-app-server.connection.ts` / `codex-host-driver.provider.ts` 与 `REPORT.md` E4、`e4-live-settings.jsonl`，确认 `thread/settings/update` 的参数/结果、`thread/settings/updated` 的完整 `threadSettings` 形状、`experimentalFeature/list` 的 `{data,nextCursor}` 与 `step_model_switching` 条目。
2. 在 driver 上实现 `reconfigure` 的映射、通知匹配与有界等待；实现 `settingsCapabilities` 的一次性 fail-closed 探测与 `reconfigureTurn`。
3. 写假 transport 判据，先打印每次请求 params、通知序列、每腿读数，再收紧断言。
4. 跑 criterion 至退出 0；跑 `codex-host-driver-persistent.test.ts`、`codex-runtime.test.ts`、`npm run typecheck`。
5. 实测 A/B/C 三个假形态（临改实现 → 退出 1 → 记录逐字红态 → 还原）。
6. 确认 `git diff --name-only develop...HEAD` 只落在 Touches。

## AC

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-settings.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 6`。红态基线已测：同命令当前 exit 1、文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-settings.test.ts'`。
- [x] AC2 idle 实时设置：patch `{model:'gpt-5.6-terra', effort:'medium', permissionMode:'default'}`；打印 `idleVerdict=live idleModel=… idleEffort=… idleApprovalPolicy=on-request idleSandboxType=workspaceWrite idleNotifications=1 idlePidBefore=… idlePidAfter=…`；`thread/settings/update` 的 params 同时含这四个字段，匹配的 `thread/settings/updated` 恰好 1 条，pid 前后相等。
- [x] AC3 active 实时设置：turn 处于 active（`turn/started` 已发、未终态）时 patch `{model:'gpt-5.6-sol', effort:'high', permissionMode:'acceptEdits'}`；打印 `activeVerdict=live activeApprovalPolicy=never activeSandboxType=workspaceWrite activeTurnIdBefore=… activeTurnIdAfter=… activePidBefore=… activePidAfter=…`；判决 `live`、turnId 未变、pid 未变。
- [x] AC4 通知才是确认：假 transport 先发一条不匹配的 `thread/settings/updated`（例如 `turn/start` 带出的 `effort=low`），此时打印 `settledBeforeMatch=false`；放行匹配通知后才 resolve，打印 `matchedNotification=1 staleIgnored=true`。证明 driver 不拿 RPC 的 `{}` 当确认。
- [x] AC5 turn 级拒绝与缓存：探测返回 `step_model_switching {enabled:false}` 时打印 `caps={threadSettings:true,turnSettings:false} turnVerdict=unsupported turnRpcCalls=0 probeCalls=1`；重复调用 `settingsCapabilities` / `reconfigureTurn` 后 `probeCalls` 仍为 1、`turn/settings/update` 帧数仍为 0。
- [x] AC6 fail-closed 三臂：探测 RPC 报错、`data` 缺 `step_model_switching`、条目 `enabled` 非 true（含字符串 `'true'`）三种读数下，各自打印 `arm=<name> turnSettings=false turnVerdict=unsupported turnRpcCalls=0`；三行均为 false/unsupported/0。
- [x] AC7 反向控制可达：测试内把伪造读数 `{threadSettings:true,turnSettings:true,turnRpcCalls:1}` 喂给“turn 级必须被拒”的断言必须 throw；把 `{verdict:'next-turn', notifications:0}` 喂给“实时设置必须 live”的断言必须 throw；各自打印判定（如 `negativeControlThrew=true`），证明判据不是恒真。
- [x] AC8 假形态 A 承重：让 `turnSettings` 恒 true / `reconfigureTurn` 宣称 `live` 时 criterion 退出 **1**；红态文案逐字记录。AC 的“宣称 turn/settings 已 live 必须红”由这一臂钉住。
- [x] AC9 假形态 B/C 承重：`reconfigure` 拿 RPC `{}` 当确认（不等通知）或 active 轮改用 `turn/settings/update` 时 criterion 退出 **1**；用重启/杀进程应用设置（pid 变化）时 criterion 退出 **1**；两次红态文案逐字记录。还原后 `git status --short` 无残留。
- [x] AC10 接口与类型：测试文件里 `const _conformance: IProviderHostDriver = driver`（或 `satisfies`）随 `npm run typecheck` 退出 0；打印 `multiplexedHost=false`。
- [x] AC11 无回归：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0；`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-runtime.test.ts` 退出 0；`npm run typecheck` 退出 0。
- [x] AC12 范围不越界：`git diff --name-only develop...HEAD` 仅含 Touches 列出的文件；`git diff --name-only develop...HEAD | grep -E 'codex\.provider\.ts|provider-capabilities\.service\.ts|provider-runtime\.service\.ts|codex-runtime\.provider\.ts|codex-app-server\.client\.ts|codex-app-server\.connection\.ts'` 输出为空。
- [x] AC13 如实登记：完成记录写明锁定协议版本（0.153.4）、E4 的 `thread/settings/update` 参数/结果与 `thread/settings/updated` 形状出处、`experimentalFeature/list` 真实读数（135 项、`nextCursor:null`、`step_model_switching` 逐字条目、`capabilities:{}` 下同样可用）、三个假形态的实测退出码与逐字红态文案、以及未实现项（capabilities 声明、provider 挂载、queue/approvals/background/restore/E2E）。

## DoD

判据在落地后的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录里贴出 (a) idle 的请求四字段与通知读数、(b) active 判决/turnId/pid、(c) 不匹配通知被忽略、匹配通知才 resolve、(d) `caps`/`turnVerdict`/`turnRpcCalls`/`probeCalls`、(e) fail-closed 三臂读数、(f) 两个反向控制判定、(g) A/B/C 三个假形态的退出码与逐字红态文案、(h) `multiplexedHost=false` 与 typecheck 结果。`codex-host-driver-persistent.test.ts`、`codex-runtime.test.ts` 与 `npm run typecheck` 退出 0。改动只落在 Touches；`codex.provider.ts` / shipped capabilities / `provider-runtime.service.ts` / per-run runtime / fork client / 长驻 connection 零改动。完成后 goal driver 下一轮以 `goal_ac: AC-437` 独立复跑原 criterion 时由红翻绿；且翻绿有分辨力：宣称 turn 级设置 live 的实现变体必红，拿 RPC 当确认或用错方法的变体必红，重启/杀进程应用设置的变体必红。

## 完成记录

**判据重跑（完成时的树：worktree `task/gap-ac437-codex-resident-live-settings`，已 merge develop，merge commit `de4b31bb8`）**

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-settings.test.ts` → exit **0**，`pass 6` / `fail 0`（要求 `pass >= 6`）。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` → exit **0**，`pass 5` / `fail 0`。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-runtime.test.ts` → exit **0**，`pass 12` / `fail 0`。
- `npm run typecheck` → exit **0**。
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` → exit **0**，`pass 14` / `fail 0`（新增判据文件把 server 收集数 466→467，pin 与 duration baseline 已同步）。
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → exit **0**，`pass 6` / `fail 0`（driver 717 行 < 800；新 helper 无模块级可变状态）。
- `npx oxlint` 四个改动文件 → 无输出（exit 0）。

**实现**

- `codex-host-driver.provider.ts`：`reconfigure` 改为真实实现（resident host + 活连接 + 有 threadId 才发 `thread/settings/update`），匹配通知与有界等待交给 sibling；`settingsCapabilities` / `reconfigureTurn` 仍作为 driver 的动词（turn 级探测 false 时零帧返回 `unsupported`）；`thread/settings/updated` 在 turn 分发前交给 helper；`handleExit` / `closeHost` 调 `settleAll`。全程不碰 `pid` / `threadId` / `activeTurnId`。
- `codex-live-settings.ts`（new）：闭包持有 waiter 集合与 per-connection 的 `WeakMap` probe 缓存；`permissionModeSettings` 映射（default → `on-request` + workspaceWrite；acceptEdits → `never` + workspaceWrite；bypassPermissions → `never` + `{type:'dangerFullAccess'}`）；`settingsMatch` 逐字段比对（含请求里给了的 networkAccess）；`readStepModelSwitching` 只在条目 `enabled === true`（严格布尔）时为 true。文件 256 行，无模块级可变状态。
- 采用 sibling 而不是继续堆大 driver 的理由：把实现全部放进 driver 会到 897 行，超过 `architecture-ratchet` 的 800 行上限；与 `codex-background-lease-ledger.ts`（AC-439）同一形态。新增文件已通过 task_write 补进 `## Touches`。

**协议读数（锁定 `@openai/codex 0.153.4`）**

- E4（`tmp/codex-appserver-exp-NuPHhk/e4-reading.json` + `e4-live-settings.jsonl`）：idle `thread/settings/update {threadId, model:'gpt-5.6-terra', effort:'medium', approvalPolicy:'on-request', sandboxPolicy:{type:'workspaceWrite',networkAccess:false,writableRoots:[]}}` 返回 `{}`，随后收到 `thread/settings/updated {threadId, threadSettings:{model, effort, approvalPolicy, sandboxPolicy:{type:'workspaceWrite',…},…}}`；`thread/read` 读到新 model/effort；active turn 期间同一方法也被接受并回通知（effort=high），pid `3602749` 前后不变。⇒ driver 只认通知，不把 RPC 的 `{}` 当确认。
- `turn/settings/update {threadId,turnId,model,effort}` 在 E4 回 `{"code":-32600,"message":"turn settings updates require the step_model_switching feature"}`。
- 本轮真实二进制 `experimentalFeature/list` 返回 `{data:[…135 项…], nextCursor:null}`，其中 `step_model_switching` 逐字为 `{"name":"step_model_switching","stage":"underDevelopment","displayName":null,"description":null,"announcement":null,"enabled":false,"defaultEnabled":false}`；在 `initialize` 只声明 `capabilities:{}` 时同样可用（不依赖 AC-440 的 experimentalApi 声明）。

**DoD 读数**

- (a) `idleVerdict=live idleModel=gpt-5.6-terra idleEffort=medium idleApprovalPolicy=on-request idleSandboxType=workspaceWrite idleNotifications=1 idlePidBefore=730437 idlePidAfter=730437`；请求 params 同时含 model/effort/approvalPolicy/sandboxPolicy。
- (b) `activeVerdict=live activeApprovalPolicy=never activeSandboxType=workspaceWrite activeTurnIdBefore=turn-1 activeTurnIdAfter=turn-1 activePidBefore=730437 activePidAfter=730437`；active 轮仍走 `thread/settings/update`（`turn/settings/update` 帧数 0）。
- (c) `settledBeforeMatch=false`、`matchedNotification=1 staleIgnored=true`（先发的 `effort=low` 不匹配帧被忽略，匹配帧才 resolve）。
- (d) `caps={threadSettings:true,turnSettings:false} turnVerdict=unsupported turnRpcCalls=0 probeCalls=1`（重复 `settingsCapabilities` / `reconfigureTurn` 后 probeCalls 仍 1、`turn/settings/update` 帧数仍 0）。
- (e) `arm=probe-error turnSettings=false turnVerdict=unsupported turnRpcCalls=0`、`arm=missing-entry turnSettings=false turnVerdict=unsupported turnRpcCalls=0`、`arm=enabled-not-true turnSettings=false turnVerdict=unsupported turnRpcCalls=0`（第三臂的 `enabled` 是字符串 `'true'`）。
- (f) `negativeControlThrew=true falseCapabilityRejected=true deferredLiveRejected=true`。
- (g) 三个假形态实测见下。
- (h) `multiplexedHost=false`；`npm run typecheck` exit 0。

**假形态实测（只改实现，判据文件未动；每次 `git checkout --` 还原，`git status --short` 无残留）**

- A 宣称 turn 级设置已 live（`settingsCapabilities` 忽略探测恒 true）：criterion exit **1**，`pass 4` / `fail 2`，首红逐字：

```
✖ turn settings are refused and the capability probe is cached (AC5)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected
    {
      threadSettings: true,
  +   turnSettings: true
  -   turnSettings: false
    }
```

- B 拿 RPC 的 `{}` 当确认（不等匹配通知）：criterion exit **1**，`pass 5` / `fail 1`，首红逐字：

```
✖ idle live settings apply on the notification, not the RPC result (AC2/AC4)
  AssertionError [ERR_ASSERTION]: the RPC result must not settle reconfigure
  true !== false
```

  同轮打印 `settledBeforeMatch=true`。

- C 用重启/杀进程“应用”设置（pid 变化）：criterion exit **1**，`pass 4` / `fail 2`，首红逐字：

```
✖ idle live settings apply on the notification, not the RPC result (AC2/AC4)
  AssertionError [ERR_ASSERTION]: applying a setting must not restart the process
  730438 !== 730437
```

  同轮打印 `idlePidBefore=730437 idlePidAfter=730438`。

**范围（AC12）**

- 本任务自有改动集：`git diff --name-only e5fdb309c..HEAD`（fork point = goal/GOAL-051）恰为 5 个文件：`codex-host-driver.provider.ts`、`codex-live-settings.ts`、`codex-host-driver-settings.test.ts`、`server/shared/tests/quay-test-script.test.ts`、`scripts/suite-duration-baseline.tsv`；`tasks/gap-ac437-codex-resident-live-settings.md` 由 task_write 单独提交。
- AC12 字面的 `git diff --name-only develop...HEAD` 在 goal 分支任务上会含 goal 分支继承的 AC-435/439 基线文件（`codex-app-server.connection.ts`、`codex-host-driver-persistent.test.ts` 等）——anti-drift 工具把这条差集称为 mainline divergence，不是本任务写入（与 AC-439 完成记录同一读数）。
- 禁改清单在本任务自有改动集上 grep 为空：`codex.provider.ts`、`provider-capabilities.service.ts`、`provider-runtime.service.ts`、`codex-runtime.provider.ts`、`codex-app-server.client.ts`、`codex-app-server.connection.ts` 均未被本任务改动。
- server 文件计数：新增判据文件把收集数 466→467；`server/shared/tests/quay-test-script.test.ts` 的 pin 移 `known=3 unknown=463→464`、`known=1 unknown=465→466`；`scripts/suite-duration-baseline.tsv` 追加本判据实测行（2684ms），覆盖率 421/467 = 90.15% ≥ 90%。

**未实现项（非目标）**

- 未挂 `codex.provider.ts` 的 `hostDriver`、未改 `provider-capabilities.service.ts` / `residentFeatures.liveReconfigure`（AC-441/442）。
- 未改 `provider-runtime.service.ts`、per-run `codex-runtime.provider.ts`、fork 客户端 `codex-app-server.client.ts`、长驻连接 `codex-app-server.connection.ts`。
- 未做 queue（AC-436）、experimentalApi 声明与未知通知放过（AC-440）、审批 broker（AC-438）、后台 lease（AC-439，已由前序任务落地）、宿主层 lease/busy-idle（AC-441）、restore/E2E（AC-443）。
- `dangerFullAccess` 的 sandbox 形状未在 E4 实测，判据不断言（保留为诚实映射）。

该轴仍暗,理由:本条是常驻设置面原语，判据为行为测试与能力探测，本轮未产生 L_D/L_G 可量化读数

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-live-settings.ts (new)
- server/modules/providers/tests/codex-host-driver-settings.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-ac437-codex-resident-live-settings.md
