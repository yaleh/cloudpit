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

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-queue.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 5`。红态基线已测：同命令当前 exit 1、文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-queue.test.ts'`。
- [x] AC2 忙时接受而非拒绝：turn active 时第二次 `run` 不抛拒绝；打印 `busyOutcome=queued queueAddCalls=1 refusal=none`，`thread/queue/add` 参数含当前 `threadId`、命令文本与 `clientUserMessageId`；被 queue 的 run 在断言时仍 pending（未 resolve 未 reject）；返回的 `queuedInputUuid` 与该条 `thread/queue/list` 里的 `clientUserMessageId` 相等。
- [x] AC3 queue/list 是深度真值：连加两条后打印 `depthAfterTwo=2 bytes=…`；随后假 transport **直接**删掉一条并只发 `thread/queue/changed`（driver 未发 delete），等待一次刷新后打印 `depthAfterExternalDelete=1 bytes=…`；两次读数与传输层 `thread/queue/list` 的返回逐字一致；driver 的 `queue/delete` 调用次数为 0。
- [x] AC4 撤回：打印 `cancel=<uuid> result=withdrawn deleteCalls=1 remaining=1`；对已离开队列的条目打印 `alreadyStartedResult=already-started deleteCallsUnchanged=true`；对不存在的 uuid 打印 `unknownResult=unknown`；三种情形分别按上列值断言。
- [x] AC5 正常完成自动排水：`turn/completed` 后由假 transport 自动发下一条 `turn/started`（复制 E2 读数），打印 `completedTurns=2 queueStartCallsAfterCompletion=0 queuedRunResolved=true`；结束时 `thread/queue/list` 为空。
- [x] AC6 中断保留且显式 start：打印 `interruptStatus=interrupted queuedAfterInterrupt=1 autoStartedAfterInterrupt=false queueStartCalls=1`；`thread/queue/start` 参数为队头 `queuedSubmissionId`；被推起的 turn 完成；`threadId` 与 pid 中断前后相等；transport 在 interrupt 前后都报告进程存活。
- [x] AC7 chat.send 接缝：用真实 `createProviderRuntimeService` + 测试内非 union provider（`declareRuntimeProviderCapabilities({provider:'codex-queue-test', lifecycleModes:['resident'], multiplexedHost:false})`）+ 真实 `sessionHostManager.openHost` 的 live host，打印 `acceptsBusyInput=true runRejected=false runtimeQueueAddCalls=1`；第二次 `runtime.run` 的 promise 不 reject。证明这条路径不会走到 `RUN_IN_PROGRESS` 的拒绝分支。
- [x] AC8 反向控制可达：测试内把「忙时拒绝」读数喂给接受断言、把「interrupt 后未显式 start 就自动起 turn」读数喂给中断断言，两者都必须 reject；各自打印判定，证明判据不是恒真。
- [x] AC9 接口与声明：`CodexHostDriver` 以 `IProviderHostDriver` 类型赋值且四个队列读法随测试文件类型检查通过（`npm run typecheck` 退出 0）；打印 `multiplexedHost=false`。
- [x] AC10 三个假形态承重：A 忙时拒绝、B 中断后假设自动排水、C 本地计数器，各自令 criterion 退出 **1**；三次红态文案逐字记录；还原后 `git status --short` 无残留。
- [x] AC11 无回归：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0；`npm run typecheck` 退出 0。
- [x] AC12 范围不越界：`git diff --name-only develop...HEAD` 仅含 Touches；`git diff --name-only develop...HEAD | grep -E 'codex\\.provider\\.ts|provider-capabilities\\.service\\.ts|provider-runtime\\.service\\.ts|codex-runtime\\.provider\\.ts|codex-app-server\\.client\\.ts'` 输出为空。
- [x] AC13 如实登记：完成记录写明假 transport 形态与锁定协议版本（0.153.4）、E2/E3 通知序列出处、三个假形态的实测退出码与逐字红态文案、`thread/queue/list` 与 `thread/queue/start` 的 params，以及未实现项（experimentalApi、host lease、provider 挂载/capabilities、settings/approvals/background/restore/E2E）。

## DoD

判据在落地后的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录贴出 (a) 忙时 queue/add 的调用与 uuid 读数、(b) 外部删一条后的深度读数、(c) 三种撤回结果、(d) 正常排水与 `queue/start` 计数、(e) 中断前后队列/pid/threadId 与显式 start 读数、(f) chat.send 接缝的 `acceptsBusyInput`/`runRejected` 读数、(g) 两个反向控制判定、(h) A/B/C 三个假形态的退出码与逐字红态文案。`codex-host-driver-persistent.test.ts` 与 `npm run typecheck` 退出 0。改动只落在 Touches；`codex.provider.ts` / shipped capabilities / `provider-runtime.service.ts` / per-run runtime / fork client 零改动。完成后 goal driver 下一轮以 `goal_ac: AC-436` 独立复跑原 criterion 时由红翻绿；且翻绿有分辨力：忙时拒绝的变体必红，interrupt 后假设自动排水的变体必红，本地计数器变体必红。

## 完成记录

**树与提交。** worktree `/data/home/yale/work/claudecodeui-worktrees/task-gap-ac436-codex-resident-queue-busy-input`，分支 `task/gap-ac436-codex-resident-queue-busy-input`，基线 `goal/GOAL-051`。实现提交 `3de082d17`（driver + 新判据文件），`git merge --no-edit develop` 无冲突，merge 后 HEAD `2a79c685c`。

**锁定协议与读数出处。** `@openai/codex` **0.153.4**；E2（忙时入队 / 深度 / 撤回 / 自动排水）与 E3（interrupt 保留队列、显式 start）取自 `tmp/codex-appserver-exp-NuPHhk/REPORT.md` 与 `e2-reading.json`、`e3-reading.json`、`e2-queue-while-busy.jsonl`。

**假 transport 形态。** 判据内 `FakeAppServerTransport` 是内存 JSON-RPC app-server，实现 `initialize`、`initialized`、`thread/start`、`thread/resume`、`turn/start`、`turn/interrupt`、`thread/queue/add|list|delete|start`；主动发 `turn/started`、`turn/completed`（含 `turn.status='interrupted'`）、`thread/queue/changed`。开关 `autoComplete` / `autoDrainOnComplete=true`（E2：正常完成自动起下一条）/ `autoDrainAfterInterrupt=false`（E3：中断后 15s 不自动起）/ `holdQueueStart`（把 `thread/queue/start` 的应答压住，好在「中断后、显式 start 前」读一次队列）。`log` 记录调用与通知的**顺序**，`autoStartedAfterInterrupt` 由「interrupted 终态之后、首个 `thread/queue/start` 之前是否有 `turn/started`」算出，不是由任何计数器推断。不 spawn 真 codex、不开 DB、不碰网络。

**协议 params/result（判据实际发送与读取）。**

- `thread/queue/add` → `{"threadId":"thread-1","input":[{"type":"text","text":"queued while busy","text_elements":[]}],"clientUserMessageId":"<uuid>"}`，结果读 `result.queuedSubmission.{id, clientUserMessageId}`（E2 的 echo 被用作 app uuid）。
- `thread/queue/list` → `{"threadId":"thread-1"}`，结果读 `result.data[]`（每行 `{id, input, clientUserMessageId}`）与 `nextCursor`；深度与 bytes 只从这份镜像算。
- `thread/queue/delete` → `{"threadId":"thread-1","queuedSubmissionId":"qs-…"}`，只有 `{deleted:true}` 记作 `withdrawn`。
- `thread/queue/start` → `{"threadId":"thread-1","queuedSubmissionId":"qs-1"}`（中断后队头）。
- 通知 `thread/queue/changed` 的 params 为 `{threadId}`，每收到一条触发一次串行、可合并的 `thread/queue/list` 刷新。

**(a) 忙时 queue/add 与 uuid 读数。**

```
busyOutcome=queued queueAddCalls=1 refusal=none threadId=thread-1 queuedUuid=213d79a5-db61-4d69-99f3-b155e6fd964f listUuid=213d79a5-db61-4d69-99f3-b155e6fd964f stillPending=true
queuedRunResolved=true queuedFrames=thread/queue/changed,turn/completed,thread/queue/changed,turn/started,turn/completed
```

被 queue 的 run 在断言时既未 resolve 也未 reject；`queuedInputUuid` 与 `thread/queue/list` 里的 `clientUserMessageId` 逐字相等；该 run 的 writer 收到自己那一轮的 `turn/started`/`turn/completed` 帧后才结算。

**(b) 外部删一条后的深度读数。**

```
depthAfterTwo=2 bytes=25 transportDepth=2
depthAfterExternalDelete=1 bytes=12 transportDepth=1 deleteCalls=0
```

假 transport 直接删掉队头并只发 `thread/queue/changed`，driver 未发任何 `thread/queue/delete`（`deleteCalls=0`），读数仍跟随。

**(c) 三种撤回结果。**

```
cancel=476ed659-f346-44c7-a346-a10a07874ed4 result=withdrawn deleteCalls=1 remaining=1
alreadyStartedResult=already-started deleteCallsUnchanged=true
unknownResult=unknown
```

被撤回的 run 也结算（不会留 pending promise 泄漏）。

**(d) 正常排水与 queue/start 计数。**

```
completedTurns=2 queueStartCallsAfterCompletion=0 queuedRunResolved=true
```

**(e) 中断前后队列/pid/threadId 与显式 start。**

```
interruptStatus=interrupted queuedAfterInterrupt=1 autoStartedAfterInterrupt=false queueStartCalls=1 queueStartParams={"threadId":"thread-1","queuedSubmissionId":"qs-1"} pidBefore=515151 pidAfter=515151 threadIdBefore=thread-1 threadIdAfter=thread-1
explicitStartCompleted=true turnStartedCount=2 transportAlive=true
```

**(f) chat.send 接缝。**

```
acceptsBusyInput=true runRejected=false runtimeQueueAddCalls=1 busyStillPending=true
runtimeBusyResolved=true queueEmpty=true
```

非 union provider `codex-queue-test` 经 `declareRuntimeProviderCapabilities({provider, lifecycleModes:['resident'], multiplexedHost:false})` 声明，真实 `sessionHostManager.openHost` 给出 live host，真实 `createProviderRuntimeService` 派发；第二次 `runtime.run` 不 reject，说明不会走 `RUN_IN_PROGRESS` 分支。

**(g) 两个反向控制。**

```
reverseRefusalRejected=true reverseAutoDrainRejected=true
```

把「忙时拒绝」读数喂给 `assertBusyAccepted`、把「interrupt 后未显式 start 就自动起 turn」读数喂给 `assertExplicitQueueStartAfterInterrupt`，两者都抛，判据不是恒真。

**(h) A/B/C 三个假形态（只改实现，判据文件未动）。**

- **A 忙时拒绝**（`isBusy` 分支抛 `RUN_IN_PROGRESS` 而非 `thread/queue/add`）：criterion exit **1**，`pass 2 / fail 6`（AC2/AC3/AC4/AC5/AC6/AC7 全红）。红态文案逐字：

```
✖ busy input is queued, not refused (AC2)
  Error [AppError]: A Codex turn is already running.
    code: 'RUN_IN_PROGRESS',
    statusCode: 409,
```

- **B 中断后假设自动排水**（`status === 'interrupted'` 时不再调 `advanceQueueAfterInterrupt`）：criterion exit **1**，`pass 7 / fail 2`。红态文案逐字：

```
interruptStatus=interrupted queuedAfterInterrupt=1 autoStartedAfterInterrupt=false queueStartCalls=0 queueStartParams=null pidBefore=515151 pidAfter=515151 threadIdBefore=thread-1 threadIdAfter=thread-1
✖ an interrupt keeps the queue and needs an explicit queue/start (AC6)
  AssertionError [ERR_ASSERTION]: the driver must push the queue exactly once with thread/queue/start (got 0)
  0 !== 1
```

- **C 本地计数器冒充深度真值**（`pendingQueuedInputs` 改读 `session.queue.length` 而非 `thread/queue/list` 镜像）：criterion exit **1**，`pass 7 / fail 1`。红态文案逐字：

```
depthAfterTwo=2 bytes=25 transportDepth=2
✖ queue/list is the depth truth, including an external delete (AC3)
  Error: timed out waiting for the mirror to follow the external delete
```

每个假形态后都 `git checkout -- server/modules/providers/list/codex/codex-host-driver.provider.ts` 还原，`git status --short` 输出为空；还原后 criterion 复跑 exit **0**（`tests 8 / pass 8 / fail 0`）。

**判据与回归读数。**

- criterion：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-queue.test.ts` → exit **0**，`tests 8 / pass 8 / fail 0`（merge develop 后复跑同样 exit 0）。
- 无回归：`codex-host-driver-persistent.test.ts` → exit **0**，`tests 5 / pass 5 / fail 0`；`npm run typecheck`（三个 tsc 项目）→ exit **0**。
- 范围：`git diff --name-only goal/GOAL-051...HEAD` 恰为 `server/modules/providers/list/codex/codex-host-driver.provider.ts` 与 `server/modules/providers/tests/codex-host-driver-queue.test.ts`；`git diff --name-only develop...HEAD | grep -E 'codex\\.provider\\.ts|provider-capabilities\\.service\\.ts|provider-runtime\\.service\\.ts|codex-runtime\\.provider\\.ts|codex-app-server\\.client\\.ts'` 输出为空。**需要如实说明的差别**：验收当时 `git diff --name-only develop...HEAD` 还列出 `codex-app-server.connection.ts`、`codex-background-lease-ledger.ts`、`codex-app-server-protocol.test.ts`、`codex-resident-background-leases.test.ts`、`server/shared/tests/quay-test-script.test.ts`、`scripts/suite-duration-baseline.tsv` 及若干 `tasks/*.md` —— 这些是兄弟任务 gap-ac435 / gap-ac439 / gap-ac440 已落在 `goal/GOAL-051`、但当时尚未 fan-in 进 develop 的提交，不是本任务的改动；本任务相对基线的增量就是上面两个 Touches 文件。
- anti-drift Touches 硬门：`ANTI-DRIFT OK: task gap-ac436-codex-resident-queue-busy-input — 2 actual file(s), all within declared Touches (3 glob(s))`（exit 0）。

**2026-10-29 第二轮 — exited-not-landed 后的修复（架构 ratchet 拆分 + 判据 pin 修复）。**

上一轮 fan-in suite 红在两条，本轮逐条修复：

1. `architecture-ratchet.test.ts`：`ratchet: oversizeFiles server/modules/providers/list/codex/codex-host-driver.provider.ts 基线外→1100 — 基线外的文件不得超过 800 行`。基线**外**没有 RECORDED CHANGE 通道，只能拆文件：把忙时队列的机制（`QueuedEntry`/镜像读取器/`CodexResidentQueue`：add、cancel、next、bind、remove、串行 refresh、settleAll）抽到新兄弟模块 `server/modules/providers/list/codex/codex-resident-queue.ts`（359 行），driver 只保留 turn 状态机并委托队列；`codex-host-driver.provider.ts` 1100 → **794** 行（< 800）。行为不变：criterion 复跑 `tests 8 / pass 8 / fail 0`，`codex-host-driver-persistent.test.ts` `tests 5 / pass 5 / fail 0`。
2. `quay-test-script.test.ts`：新判据文件把收集数从 467 推到 **468**，两处 pin 按实测改为 `known=3 unknown=465` / `known=1 unknown=467`，注释块各追加本任务与新文件；`scripts/suite-duration-baseline.tsv` 追加本判据行（`6519` ms，实测一次）使覆盖 422/468 = 90.17% ≥ 90%。

本轮单文件复跑读数：`architecture-ratchet.test.ts` → `tests 6 / pass 6 / fail 0`（含 `oversizeFiles` 全树 reading 通过）；`quay-test-script.test.ts` → `tests 14 / pass 14 / fail 0`；`server-import-cycle-budget.test.ts` → `tests 11 / pass 11 / fail 0`；`npm run typecheck`（三个 tsc 项目）→ exit 0。

**未实现项（本任务边界外，按 Proposal 非目标）。** `experimentalApi` 声明与缺失时 fail-closed（AC-440，已在同一 connection 上由兄弟任务落地）；host lease/busy-idle（AC-439/AC-441）；`codex.provider.ts` 挂载与 capabilities 声明（AC-442）；settings/approvals/background/restore/E2E。驱动层仍只原样转发未知协议帧，不把它们归一化成 app 消息形状。

- 该轴仍暗,理由:本任务交付 driver 内队列状态机与其 hermetic 判据，不产生架构图 L_D/L_G 读数，可测的只有 criterion/typecheck/anti-drift 退出码。

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-resident-queue.ts (new)
- server/modules/providers/tests/codex-host-driver-queue.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-ac436-codex-resident-queue-busy-input.md

## Blocker

**2026-10-29T14:19:49.502Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=merge-develop: Auto-merging scripts/suite-duration-baseline.tsv
CONFLICT (content): Merge conflict in scripts/suite-duration-baseline.tsv
Auto-merging server/modules/providers/list/codex/codex-host-driver.provider.ts
CONFLICT (content): Merge conflict in server/modules/providers/list/codex/codex-host-driver.provider.ts
Auto-merging server/shared/tests/quay-test-script.test.ts
CONFLICT (content): Merge conflict in server/shared/tests/quay-test-script.test.ts
Auto-merging tasks/gap-ac441-codex-resident-host-lifecycle.md
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-anchor
- session_id：a81e0e86-0318-4f17-b9cc-89a956693c2f
