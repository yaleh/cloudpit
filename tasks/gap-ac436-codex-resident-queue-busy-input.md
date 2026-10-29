---
id: gap-ac436-codex-resident-queue-busy-input
title: AC-436 Codex 常驻：忙时输入走 thread/queue/add、queue/list 深度真值、queue/delete
  撤回、完成自动排水、中断后显式 queue/start
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac435-codex-resident-host-driver-persistent
goal_ac: AC-436
---
## Proposal

<!-- dedup-ref --> 机制去重与粒度（本轮实测，2026-10-29）：`grep -rl 'goal_ac: AC-436' tasks/` → 0 个文件；`grep -ril 'thread/queue' tasks/` → 只命中 `gap-ac435-codex-resident-host-driver-persistent.md`（本任务的 depends_on 边所指任务，正文明确把 queue 划出其范围）与一个已 done 的 resident 编辑任务（Claude，无关）。`task-granularity-advice.js --touches server/modules/providers/list/codex/codex-host-driver.provider.ts --touches server/modules/providers/tests/codex-host-driver-queue.test.ts` 返回 `peers: [gap-ac435…]`，共享 driver 文件。**决定：separate，不 merge** —— AC-436 有独立判据文件与独立验收，driver/connection 由 gap-ac435 先建；关系边用顶层 `depends_on` 登记（SQL 关系边，不是散文前置）。

**来源与判据物。** 判据逐字取自 `goals/AC-436-忙时输入进队列-可撤回-中断后显式-start.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-queue.test.ts`。红态基线（本轮直跑，不是推断）：该命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-queue.test.ts'`。

**现状（本轮读的读数）**

- 队列语义的实测读数来自 `tmp/codex-appserver-exp-NuPHhk/REPORT.md` E2/E3 与 `e2-reading.json`：`thread/queue/add` 在 `thread/status/changed={type:'active'}` 时接受并返回 `queuedSubmission.id`；连加两条后 `thread/queue/list` 返回两条；`thread/queue/delete` 删掉一条后 list 只剩另一条；第一 turn **正常 completed 后由 app-server 自动起下一 turn**（`autoStartedAfterFirstTurn=true`，脚本未调 `thread/queue/start`）；**interrupt 后队列保留但 15 秒内不起下一 turn**（`autoStartedAfterInterrupt=false`），显式 `thread/queue/start {queuedSubmissionId}` 后 B 才执行。通知流里出现 `thread/queue/changed`。
- `chat.send` 的忙时分支不在 driver 里判断：`server/modules/websocket/services/chat-control.service.ts:667` 读 `runtime.acceptsBusyInput(provider, sessionId)`，为真时 `789-801` 返回 `{queued:true, queuedMessageUuid}` 而**不**产出 `RUN_IN_PROGRESS`；`RUN_IN_PROGRESS` 只在 `acceptsBusyInput === false` 或 `startRun` 返回 null 时由 chat-ws / control 产出。`acceptsBusyInput` 的实现是 `server/modules/providers/services/provider-runtime.service.ts:762`，要求「mode=resident + 该 provider 声明 resident + driver 有 `run` + 有 live host」四者同时成立。
- resident 队列在 runtime 侧的四个结构读法：`run`、`cancelQueuedInput`、`queuedInputUuid`、`pendingQueuedInputs`（`provider-runtime.service.ts:343-415`）；`HostQueuedInputCancelResult = 'withdrawn' | 'already-started' | 'unknown'`、`HostPendingQueuedInputs = {items, bytes}`（`server/shared/types.ts:3798,3819`）。`pendingQueuedInputs` / `queuedInputUuid` 是**同步**的（注释明说队列在 driver 自己内存里）。
- AC-435（`gap-ac435-…`）会创建 `codex-app-server.connection.ts`（长驻 JSON-RPC、通知分发）与 `codex-host-driver.provider.ts`（thread 选择、turn 开始/结算、interrupt 不杀进程），并明确把 queue 划给本条。它不挂载 `codex.provider.ts` 的 `hostDriver`、不改 capabilities —— 那是 AC-441/442；`experimentalApi` 声明与缺失时 fail-closed 是 AC-440 的判据。本条沿用这些边界。

**要建的东西**

1. 扩展 `server/modules/providers/list/codex/codex-host-driver.provider.ts` 的每会话状态与队列面（协议方法全部走 AC-435 的连接）：
   - 忙时 `run(...)`（已有 `activeTurnId` / thread active）：生成 `clientUserMessageId`（uuid），调 `thread/queue/add {threadId, input:[{type:'text', text: command, text_elements: []}], clientUserMessageId}`；把返回的 `queuedSubmission.id` 与 app uuid 记入队列记录；**不抛拒绝**；该 `run` 的 promise 保持 pending，直到这条 queuedSubmission 对应的 `turn/started` → 终态才 resolve（把该轮帧写给同一个 writer）。
   - `queuedInputUuid(appSessionId)`：最近一条仍在队列里的 app uuid，或 `null`。
   - `pendingQueuedInputs(appSessionId)`：`{items, bytes}`，来自 **`thread/queue/list` 的镜像**而不是 driver 自己的计数器；每次收到 `thread/queue/changed` 触发一次串行 refresh（并发通知合并），返回 detached copy。
   - `cancelQueuedInput(appSessionId, messageUuid)`：用 app uuid 在镜像 / queue-list 真值里找 `queuedSubmission.id`；找不到 → `'unknown'`；该条已离开队列（已被 turn 取走）→ `'already-started'`；否则 `thread/queue/delete {threadId, queuedSubmissionId}`，`{deleted:true}` → `'withdrawn'`，非 true → `'unknown'`。
   - 正常 `turn/completed`：**不**调 `thread/queue/start`；app-server 自己起下一条，driver 只把随后的 `turn/started` 绑定到那条 pending run。
   - `turn/interrupt` 终态 `turn/interrupted`（或 `interrupt` 返回后收到该终态）：队列保留；driver **显式** `thread/queue/start {threadId, queuedSubmissionId}` 推队头一条，绑定随后的 `turn/started`。进程与 thread 不变，不 `kill`。
2. 新判据 `server/modules/providers/tests/codex-host-driver-queue.test.ts`（hermetic：注入内存假 app-server transport，不 spawn 真 codex、不碰 DB/网络）：
   - 假 transport 实现 `initialize`、`thread/start|resume`、`turn/start|interrupt`、`thread/queue/add|list|delete|start`，发 `turn/started`、`turn/completed`、`turn/interrupted`、`thread/queue/changed`、`thread/status/changed`；第一个 turn 由测试保持 active。
   - 判据腿：忙时接受（queue/add，不拒绝）、queue/list 深度真值（外部改队列后 driver 跟随）、queue/delete 撤回（withdrawn / already-started / unknown 三读）、正常完成自动排水（driver 零次 queue/start）、interrupt 后保留且显式 queue/start、chat.send 接缝、反向控制、接口一致性。
   - chat.send 接缝用真实 `createProviderRuntimeService` + 测试内**非 union** provider（如 `codex-queue-test`，经 `declareRuntimeProviderCapabilities({provider, lifecycleModes:['resident'], multiplexedHost:false})` 声明）+ 真实 `sessionHostManager.openHost` 的 live host。provider id 必须是非 union：`residentEntryFor` 先读 union 静态表，`codex` 在表里是 `per-run`，用 `codex` 会绕过 runtime 声明并让接缝腿读成 false。
3. 非目标：不改 `codex.provider.ts` / shipped `provider-capabilities.service.ts` 表 / `provider-runtime.service.ts` / `codex-runtime.provider.ts` / `codex-app-server.client.ts`；不做 experimentalApi 声明与 fail-closed（AC-440）、host lease/busy-idle（AC-441）、provider 挂载与 capabilities（AC-442）、settings/approvals/background/restore/E2E。

**三个假形态（只改实现，不改判据文件）**

- A 忙时拒绝：忙时 `run` 抛 `RUN_IN_PROGRESS` 形状的拒绝而不是 `thread/queue/add` ⇒ 判据退出 **1**；
- B 中断后假设自动排水：`turn/interrupted` 后什么都不做（不 `thread/queue/start`）⇒ 判据退出 **1**（队列卡住，无后续 `turn/started`）；
- C 本地计数器冒充深度真值：`pendingQueuedInputs` 返回自增/自减计数而不是 `thread/queue/list` 镜像 ⇒ 传输层直接删一条并只发 `thread/queue/changed` 时读数不跟随 ⇒ 判据退出 **1**。

三次退出码与红态文案抄进完成记录，`git checkout --` 还原，确认 `git status --short` 只剩 Touches。

## Plan

1. 读已落地的 `gap-ac435` 留下的 connection/driver 与 `REPORT.md` E2/E3 原始帧（`e2-queue-while-busy.mjs`、`e3-interrupt-keeps-process.mjs`），确认 params/result/通知名。
2. 在 driver 上加队列状态机与四个 runtime 读法；忙时 `run` 走 queue/add 并挂起，完成/中断的推进分叉。
3. 写假 transport 判据，先打印方法序列与每次读数，再收紧断言。
4. 跑 criterion 至退出 0；跑 `codex-host-driver-persistent.test.ts` 与 `npm run typecheck`。
5. 实测 A/B/C 三个假形态（临改实现 → 退出 1 → 记录文案 → 还原）。
6. 确认 diff 只落在 Touches。

## AC

- [ ] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-queue.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 5`。红态基线已测：同命令当前 exit 1、文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-queue.test.ts'`。
- [ ] AC2 忙时接受而非拒绝：turn active 时第二次 `run` 不抛拒绝；打印 `busyOutcome=queued queueAddCalls=1 refusal=none`，`thread/queue/add` 参数含当前 `threadId`、命令文本与 `clientUserMessageId`；被 queue 的 run 在断言时仍 pending（未 resolve 未 reject）；返回的 `queuedInputUuid` 与该条 `thread/queue/list` 里的 `clientUserMessageId` 相等。
- [ ] AC3 queue/list 是深度真值：连加两条后打印 `depthAfterTwo=2 bytes=…`；随后假 transport **直接**删掉一条并只发 `thread/queue/changed`（driver 未发 delete），等待一次刷新后打印 `depthAfterExternalDelete=1 bytes=…`；两次读数与传输层 `thread/queue/list` 的返回逐字一致；driver 的 `queue/delete` 调用次数为 0。
- [ ] AC4 撤回：打印 `cancel=<uuid> result=withdrawn deleteCalls=1 remaining=1`；对已离开队列的条目打印 `alreadyStartedResult=already-started deleteCallsUnchanged=true`；对不存在的 uuid 打印 `unknownResult=unknown`；三种情形分别按上列值断言。
- [ ] AC5 正常完成自动排水：`turn/completed` 后由假 transport 自动发下一条 `turn/started`（复制 E2 读数），打印 `completedTurns=2 queueStartCallsAfterCompletion=0 queuedRunResolved=true`；结束时 `thread/queue/list` 为空。
- [ ] AC6 中断保留且显式 start：打印 `interruptStatus=interrupted queuedAfterInterrupt=1 autoStartedAfterInterrupt=false queueStartCalls=1`；`thread/queue/start` 参数为队头 `queuedSubmissionId`；被推起的 turn 完成；`threadId` 与 pid 中断前后相等；transport 在 interrupt 前后都报告进程存活。
- [ ] AC7 chat.send 接缝：用真实 `createProviderRuntimeService` + 测试内非 union provider（`declareRuntimeProviderCapabilities({provider:'codex-queue-test', lifecycleModes:['resident'], multiplexedHost:false})`）+ 真实 `sessionHostManager.openHost` 的 live host，打印 `acceptsBusyInput=true runRejected=false runtimeQueueAddCalls=1`；第二次 `runtime.run` 的 promise 不 reject。证明这条路径不会走到 `RUN_IN_PROGRESS` 的拒绝分支。
- [ ] AC8 反向控制可达：测试内把「忙时拒绝」读数喂给接受断言、把「interrupt 后未显式 start 就自动起 turn」读数喂给中断断言，两者都必须 reject；各自打印判定，证明判据不是恒真。
- [ ] AC9 接口与声明：`CodexHostDriver` 以 `IProviderHostDriver` 类型赋值且四个队列读法随测试文件类型检查通过（`npm run typecheck` 退出 0）；打印 `multiplexedHost=false`。
- [ ] AC10 三个假形态承重：A 忙时拒绝、B 中断后假设自动排水、C 本地计数器，各自令 criterion 退出 **1**；三次红态文案逐字记录；还原后 `git status --short` 无残留。
- [ ] AC11 无回归：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0；`npm run typecheck` 退出 0。
- [ ] AC12 范围不越界：`git diff --name-only develop...HEAD` 仅含 Touches；`git diff --name-only develop...HEAD | grep -E 'codex\.provider\.ts|provider-capabilities\.service\.ts|provider-runtime\.service\.ts|codex-runtime\.provider\.ts|codex-app-server\.client\.ts'` 输出为空。
- [ ] AC13 如实登记：完成记录写明假 transport 形态与锁定协议版本（0.153.4）、E2/E3 通知序列出处、三个假形态的实测退出码与逐字红态文案、`thread/queue/list` 与 `thread/queue/start` 的 params，以及未实现项（experimentalApi、host lease、provider 挂载/capabilities、settings/approvals/background/restore/E2E）。

## DoD

判据在落地后的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录贴出 (a) 忙时 queue/add 的调用与 uuid 读数、(b) 外部删一条后的深度读数、(c) 三种撤回结果、(d) 正常排水与 `queue/start` 计数、(e) 中断前后队列/pid/threadId 与显式 start 读数、(f) chat.send 接缝的 `acceptsBusyInput`/`runRejected` 读数、(g) 两个反向控制判定、(h) A/B/C 三个假形态的退出码与逐字红态文案。`codex-host-driver-persistent.test.ts` 与 `npm run typecheck` 退出 0。改动只落在 Touches；`codex.provider.ts` / shipped capabilities / `provider-runtime.service.ts` / per-run runtime / fork client 零改动。完成后 goal driver 下一轮以 `goal_ac: AC-436` 独立复跑原 criterion 时由红翻绿；且翻绿有分辨力：忙时拒绝的变体必红，interrupt 后假设自动排水的变体必红，本地计数器变体必红。

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/tests/codex-host-driver-queue.test.ts (new)
- tasks/gap-ac436-codex-resident-queue-busy-input.md