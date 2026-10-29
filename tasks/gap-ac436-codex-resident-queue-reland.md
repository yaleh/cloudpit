---
id: gap-ac436-codex-resident-queue-reland
title: AC-436 Codex 常驻：把忙时输入队列（queue/add、list 真值、delete 撤回、完成自动排水、中断后显式
  queue/start）重新落到当前 goal/GOAL-051 树
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-436
---
## Proposal

<!-- dedup-ref --> 机制去重与粒度（本轮实测，2026-10-29）：`task_list --search AC-436` 只有 `gap-ac436-codex-resident-queue-busy-input`，其状态是 **superseded**（不是 todo/ready/needs-human，不在飞），没有别的任务以顶层 `goal_ac: AC-436` 认领本判据；`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches <下述源码> --json` 返回 `peers: []`、`mentions: []`。因此 **separate，不 merge**：本任务与那份 superseded 任务是同一机制、同一判据文件，但它不是「再做一遍设计」，而是把已经写成的实现重新落到当前的 goal 树上。

**为什么上一份没有兑现 AC（可复核的读数）**

- 当前 `goal/GOAL-051` 尖端 `b2412749e` 上没有判据文件，也没有任何队列机制：`git ls-tree -r --name-only goal/GOAL-051 -- server/modules/providers/list/codex/` 列出 19 个文件，不含 `codex-resident-queue.ts` / `codex-background-processes.ts`；`git ls-tree` 的 tests 目录同样没有 `codex-host-driver-queue.test.ts`。goal gate 给 AC-436 的 evidence（2026-10-29T15:45:36.952Z）是 `acceptance failed (exit 1) — Could not find 'server/modules/providers/tests/codex-host-driver-queue.test.ts'`。
- 实现其实写成了：分支 `task/gap-ac436-codex-resident-queue-busy-input`（尖端 `1a0c3707c`）含 `codex-resident-queue.ts`（423 行）、`codex-background-processes.ts`（136 行）、`codex-host-driver-queue.test.ts`（1017 行）。今天直接在该 task worktree 上跑判据：exit **0**，`tests 8 / pass 8 / fail 0`（~10.5s）。**失败点是落地，不是实现**：worker-driver 连续 3 次 `exited-not-landed`，每次都卡在 `step=merge-develop` 的文本冲突（`server/shared/tests/quay-test-script.test.ts`、`tasks/gap-ac442-codex-resident-capabilities.md`），撞重试上限后标 needs-human 并最终 superseded；期间它的提交从未进入 `goal/GOAL-051`，所以判据在 goal 树上恒读「文件不存在」。
- 也不能直接复用那条分支/worktree：该 worktree 现在停在半合并态（`UU server/shared/tests/quay-test-script.test.ts`、`UU tasks/gap-ac442-codex-resident-capabilities.md`），且分支基龄早于 AC-437（`codex-live-settings.ts`）与 AC-438（`codex-approval-broker.ts`）——相对当前 goal 尖端，`git diff --stat goal/GOAL-051 task/...` 显示它会**删除** `codex-approval-broker.ts`（-449 行）并回退 `codex-app-server.connection.ts` / `codex-runtime.provider.ts` 的既有改动。所以本任务**只从分支取机制代码**（`git show task/...:<path>`），在**当前 goal 尖端**上重新接缝，禁止整支 merge/cherry-pick 那份 driver。

**当前 goal 树的接缝（本轮读的行号）**

- `server/modules/providers/list/codex/codex-host-driver.provider.ts` 正好 **800 行**，处在 `architecture-ratchet.test.ts` 的 `OVERSIZE_LIMIT = 800`（判定 `> 800` 才红）边缘——任何内联新增都会越线，队列实现必须落进兄弟模块，并把 `process/*` 面抽出去腾行数。
- 忙时入口在 `submit()`（约 201 行）：现在总是 `ensureThread` → `beginTurn` → `addTurnLease` → `turn/start` → `await pending.promise`。队列分支要在这里分叉：thread active 时改发 `thread/queue/add`，把该 run 的 promise 挂起，直到对应 `turn/started` 的终态；不得抛 `RUN_IN_PROGRESS`。
- `handleNotification()`（约 568 行）先处理 `process/exited` 与 `thread/settings/updated`，再按 `params.threadId` 找 session，然后交给 `this.approvals.observeNotification(...)`；`turn/started` 与 `turn/completed|failed|interrupted` 在此更新状态并走 `settleTurn()`（约 612 行）。`thread/queue/changed` 必须在 approval broker 之前/之后明确归属，不能被吞掉。
- `interrupt()`（约 244 行）只发 `turn/interrupt` 并等 `pending.promise`；中断终态后要在这里（或 `settleTurn` 的 interrupted 分支）**显式** `thread/queue/start`，且不 `kill` 进程、不动 threadId。
- `server/modules/providers/list/codex/codex-host-driver.contract.ts` 声明 `ResidentSession`（约 103 行）；队列状态字段加在这里，保持 driver 文件的行数预算。
- runtime 侧四个读法**已经存在**于当前树，不需要改：`server/modules/providers/services/provider-runtime.service.ts` 的 `acceptsBusyInput`（约 762 行）、`cancelQueuedInput`（779）、`queuedInputUuid`（810）、`pendingQueuedInputs`（841），以及 `server/shared/types.ts:3798,3819` 的 `HostQueuedInputCancelResult` / `HostPendingQueuedInputs`。本任务只补 driver 的这四个实现。

**上一份已写好、可直接搬运的两块（今天复跑过判据 8/8）**

- `codex-resident-queue.ts`：`QueuedEntry` / 串行可合并的 `thread/queue/list` 镜像刷新 / add、cancel、next、bind、remove、settleAll。镜像刷新必须由 `thread/queue/changed` 驱动，`pendingQueuedInputs` 读镜像而不是本地计数器（外部直删 + 单条通知必须能跟上）。
- `codex-host-driver-queue.test.ts`：内存 `FakeAppServerTransport`（实现 `initialize`、`thread/start|resume`、`turn/start|interrupt`、`thread/queue/add|list|delete|start`，主动发 `turn/started` / `turn/completed` / `turn/interrupted` / `thread/queue/changed` / `thread/status/changed`），带 `autoDrainOnComplete=true`、`autoDrainAfterInterrupt=false`、`holdQueueStart`，8 条腿覆盖 AC2–AC9；hermetic，不 spawn 真 codex、不碰 DB/网络。搬运时要按当前 driver 的 approval broker / live settings 接缝调整 import 与 fake 通知，不能假设旧 driver 的形状。

**落地顺序（这是上一份真正失败的地方，必须按此顺序）**

1. 从 `goal/GOAL-051` 尖端开 task worktree，先只搬模块与测试文件，再在当前 driver 上重接队列钩子。
2. 队列钩子完成、判据本地绿后，**先** `git merge develop` 并解决冲突，**再**在合并后的树上重测采集数与两个 pin（`server/shared/tests/quay-test-script.test.ts` 的 `known=3 unknown=…` 与 `known=1 unknown=…`；当前 goal 尖端是 `unknown=468` / `unknown=470`，新增一个测试文件后必须按实测改），**最后**改 `scripts/suite-duration-baseline.tsv` 的追加行。上一份在 merge 前就把 pin 改死，兄弟任务的采集数一变就必冲突，这是 3 次 exited-not-landed 的直接来源。
3. 只提交 Touches 内文件；`tasks/*.md` 冲突按两边正文语义取并集，不要整文件取 ours/theirs。

**非目标**：不改 `server/modules/providers/services/provider-runtime.service.ts`、`provider-capabilities.service.ts`、`codex.provider.ts`、`codex-runtime.provider.ts`、`codex-app-server.client.ts`；不做 AC-437 已交付的 live settings、AC-438 的 approval broker、AC-439 的 background lease、AC-440 的 experimentalApi 门、AC-441/442 的宿主与 capabilities（本任务必须原样保留它们）。

## Plan

1. 读当前 `goal/GOAL-051` 树上的 driver / contract / live-settings / approval-broker，确认 `submit`、`handleNotification`、`settleTurn`、`interrupt` 四处接缝，并记录 driver 行数（当前 800）。
2. 用 `git show task/gap-ac436-codex-resident-queue-busy-input:server/modules/providers/list/codex/codex-resident-queue.ts` 与 `.../codex-background-processes.ts` 取机制代码；按当前 import / 类型面适配，放进 `server/modules/providers/list/codex/`。
3. 在 driver 上接队列：忙时 `thread/queue/add` + 挂起 run；`thread/queue/changed` 触发镜像刷新；`turn/started` 绑定队头；正常 `turn/completed` 零次 `queue/start`；`turn/interrupted` 后显式 `thread/queue/start`；暴露 `queuedInputUuid`、`pendingQueuedInputs`、`cancelQueuedInput`。driver 必须保持 ≤ 800 行。
4. 搬 `codex-host-driver-queue.test.ts` 并按当前接缝调整，逐条打印读数后收紧断言。
5. 先 merge develop，再按合并树实测更新 `quay-test-script.test.ts` 两个 pin 与 `suite-duration-baseline.tsv` 新增行（覆盖率 ≥ 90%）。
6. 跑判据、兄弟判据、`architecture-ratchet.test.ts`、`npm run typecheck`；实测 A/B（以及可选的 C）假形态并记录逐字红态；还原后确认 diff 只在 Touches。
7. 完成记录逐项贴读数，然后交给 fan-in。

## AC

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-queue.test.ts` 退出 **0**，输出 `pass 8` / `fail 0`；完成记录贴出末尾 12 行。红态基线（本轮实测，`goal/GOAL-051` 尖端）：同命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-queue.test.ts'`。
- [x] AC2 忙时接受而非拒绝：turn active 时第二次 `submit` 走 `thread/queue/add`，打印 `busyOutcome=queued queueAddCalls=1 refusal=none`；参数含当前 `threadId`、命令文本与 `clientUserMessageId`；该 run 在断言时仍 pending（未 resolve 未 reject）；`queuedInputUuid` 与 `thread/queue/list` 里的 `clientUserMessageId` 逐字相等；判据中不存在 `RUN_IN_PROGRESS` 命中。
- [x] AC3 queue/list 是深度真值：打印 `depthAfterTwo=2 bytes=<n> transportDepth=2`，再由 transport 直接删一条、只发 `thread/queue/changed`，等待刷新后打印 `depthAfterExternalDelete=1 bytes=<n> transportDepth=1 deleteCalls=0`，两次读数与 transport 的 `thread/queue/list` 逐字一致。
- [x] AC4 撤回三读：对队列中条目打印 `result=withdrawn deleteCalls=1 remaining=<n>`；对已离开队列的条目打印 `already-started` 且 `deleteCallsUnchanged=true`；对不存在的 uuid 打印 `unknown`。三种情形分别断言。
- [x] AC5 正常完成自动排水：`turn/completed` 后由 transport 自动起下一条 `turn/started`，打印 `completedTurns=2 queueStartCallsAfterCompletion=0 queuedRunResolved=true`，结束时 `thread/queue/list` 为空。
- [x] AC6 中断保留且显式 start：打印 `interruptStatus=interrupted queuedAfterInterrupt=1 autoStartedAfterInterrupt=false queueStartCalls=1`，`thread/queue/start` 参数为队头 `queuedSubmissionId`；中断前后 `threadId` 与 pid 相等、transport 报告进程存活；被推起的 turn 完成。
- [x] AC7 chat.send 接缝：用真实 `createProviderRuntimeService` + 测试内非 union provider（`declareRuntimeProviderCapabilities({provider:'codex-queue-test', lifecycleModes:['resident'], multiplexedHost:false})`）+ 真实 `sessionHostManager.openHost` 的 live host，打印 `acceptsBusyInput=true runRejected=false runtimeQueueAddCalls=1`，第二次 `runtime.run` 不 reject。
- [x] AC8 两个假形态必红（只改实现、不改判据文件）：A 忙时抛 `RUN_IN_PROGRESS` 而非 `thread/queue/add` ⇒ 判据 exit **1**；B 中断后不调 `thread/queue/start`（假设自动排水）⇒ 判据 exit **1**。两次逐字红态文案与退出码抄进完成记录，`git checkout --` 还原后 `git status --short` 只剩 Touches。
- [x] AC9 行数与骨架：`git show HEAD:server/modules/providers/list/codex/codex-host-driver.provider.ts | wc -l` ≤ **800**；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。
- [x] AC10 采集数与覆盖率钉子：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0，两处 pin 按**合并后**实测值（当前基线 `known=3 unknown=468` / `known=1 unknown=470`，新增判据文件后各 +1，若有漂移以实测为准）；`scripts/suite-duration-baseline.tsv` 含本判据行且覆盖率 ≥ 90%；完成记录贴出实测数与覆盖率算式。
- [x] AC11 兄弟判据无回归：`codex-host-driver-persistent.test.ts`、`codex-host-driver-settings.test.ts`、`codex-resident-approvals.test.ts`、`codex-resident-background-leases.test.ts`、`codex-app-server-protocol.test.ts`、`codex-resident-lifecycle.test.ts`、`lifecycle-mode.test.ts` 逐个退出 0；`npm run typecheck` 退出 0。完成记录贴出每条的 tests/pass/fail。
- [x] AC12 范围与 anti-drift：`git diff --name-only goal/GOAL-051...HEAD` 仅含 Touches；`ANTI-DRIFT OK`；完成记录贴出两行读数。

## DoD

判据在合并后的 goal 树上按原命令重跑：退出 0、`fail 0`。完成记录必须贴出 (a) 忙时 `queue/add` 的 calls 与 uuid、(b) 外部删一条后的 mirror/transport 双读数、(c) 三种撤回结果、(d) 正常排水的 `queueStartCallsAfterCompletion=0`、(e) 中断前后队列/pid/threadId 与显式 `queue/start` 参数、(f) chat.send 接缝的 `acceptsBusyInput`/`runRejected`、(g) A/B 两个假形态的退出码与逐字红态文案、(h) driver 行数、两个 pin、baseline 覆盖率、兄弟判据与 typecheck 的退出码。并且完成记录要写明「上一份的实现为何没有兑现」的可复核事实：其分支判据今天仍 8/8 绿，但提交从未进入 `goal/GOAL-051`，失败在 merge-develop 冲突与重试上限。合并 develop 后的树上判据仍为 exit 0，才算真实落地。

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-resident-queue.ts (new)
- server/modules/providers/list/codex/codex-background-processes.ts (new)
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/tests/codex-host-driver-queue.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-ac436-codex-resident-queue-reland.md

## 完成记录

落地读数（2026-10-30，worktree `/data/home/yale/work/claudecodeui-worktrees/task-gap-ac436-codex-resident-queue-reland`，两次 `git merge develop` 之后的树）。

(a) 忙时 queue/add（AC2）：
`busyOutcome=queued queueAddCalls=1 refusal=none threadId=thread-1 queuedUuid=7ce20895-5987-4a3c-abcb-12da1a32ed69 listUuid=7ce20895-5987-4a3c-abcb-12da1a32ed69 stillPending=true`
`queuedRunResolved=true queuedFrames=thread/queue/changed,turn/completed,thread/queue/changed,turn/started,turn/completed`
`thread/queue/add` 参数含当前 `threadId=thread-1`、命令文本 `queued while busy` 与 `clientUserMessageId`；该 run 在断言时未 settle 未 reject。绿态的实际调用日志中没有 `RUN_IN_PROGRESS`（该字符串只出现在 AC8 反向控制的合成读数里，不是一次真实拒绝）。

(b) 外部删除后的 mirror/transport 双读数（AC3）：
`depthAfterTwo=2 bytes=25 transportDepth=2`
`depthAfterExternalDelete=1 bytes=12 transportDepth=1 deleteCalls=0`

(c) 撤回三读（AC4）：
`cancel=4270b811-bab8-42c9-8ebe-701857aae848 result=withdrawn deleteCalls=1 remaining=1`
`alreadyStartedResult=already-started deleteCallsUnchanged=true`
`unknownResult=unknown`

(d) 正常完成自动排水（AC5）：
`completedTurns=2 queueStartCallsAfterCompletion=0 queuedRunResolved=true`

(e) 中断保留 + 显式 start（AC6）：
`interruptStatus=interrupted queuedAfterInterrupt=1 autoStartedAfterInterrupt=false queueStartCalls=1 queueStartParams={"threadId":"thread-1","queuedSubmissionId":"qs-1"} pidBefore=515151 pidAfter=515151 threadIdBefore=thread-1 threadIdAfter=thread-1`
`explicitStartCompleted=true turnStartedCount=2 transportAlive=true`

(f) chat.send 接缝（AC7）：
`acceptsBusyInput=true runRejected=false runtimeQueueAddCalls=1 busyStillPending=true`
`runtimeBusyResolved=true queueEmpty=true`

(g) 两个假形态（AC8；只改 driver、未改判据文件，`git checkout --` 还原）：
- A 忙时抛 `RUN_IN_PROGRESS` 而非 `thread/queue/add`：判据 exit **1**，`ℹ tests 8 / ℹ pass 2 / ℹ fail 6`；AC2 红态逐字：
  `Error [AppError]: RUN_IN_PROGRESS`
  `    at CodexHostDriver.run (/data/home/yale/work/claudecodeui-worktrees/task-gap-ac436-codex-resident-queue-reland/server/modules/providers/list/codex/codex-host-driver.provider.ts:468:15)`
  `    at TestContext.<anonymous> (/data/home/yale/work/claudecodeui-worktrees/task-gap-ac436-codex-resident-queue-reland/server/modules/providers/tests/codex-host-driver-queue.test.ts:561:33)`
- B 中断后不调 `thread/queue/start`（假设自动排水）：判据 exit **1**，`ℹ tests 8 / ℹ pass 7 / ℹ fail 1`；AC6 红态逐字：
  `AssertionError [ERR_ASSERTION]: the driver must push the queue exactly once with thread/queue/start (got 0)`
  `0 !== 1`
  还原后 `git status --short` 为空（工作树与已提交树一致，所有改动都在 Touches 的两个提交里）。

(h) 行数 / 判据 / pin / 覆盖率 / 兄弟 / typecheck：
- `git show HEAD:server/modules/providers/list/codex/codex-host-driver.provider.ts | wc -l` → **786**（≤ 800）；`architecture-ratchet.test.ts` 6/6 pass、exit 0。
- AC1 判据末尾 12 行（最终合并树，exit 0）：
```
✔ the chat.send seam routes a busy send into queue/add (AC7) (1.764ms)
✔ reverse controls reject a refusal and an auto-drain (AC8) (2.503402ms)
✔ driver conforms to IProviderHostDriver with multiplexedHost=false (AC9) (0.183576ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6282.870108
```
- `quay-test-script.test.ts`：14/14 pass、exit 0；两个 pin 按合并后实测改为 `known=3 unknown=469`（采集 472 − 3）与 `known=1 unknown=471`（472 − 1）。
- baseline：`scripts/suite-duration-baseline.tsv` 新增行 `8144	server/modules/providers/tests/codex-host-driver-queue.test.ts`（两次热跑 8392/8144）；覆盖率 `426/472 = 90.25% ≥ 90%`。
- 兄弟判据：persistent 5/5、settings 6/6、approvals 18/18、background-leases 8/8、app-server-protocol 7/7、resident-lifecycle 9/9、lifecycle-mode 9/9，全部 exit 0；`npm run typecheck` exit 0。

范围与 anti-drift（AC12）：
- 实现提交 `bf2e5dfd7`（5 个文件：driver、contract、resident-queue、background-processes、判据）与 `f72ecaa15`（2 个 pin 文件：`quay-test-script.test.ts`、`suite-duration-baseline.tsv`），逐文件均在 Touches 内。
- `node --no-warnings …/anti-drift-touches-check.js --task gap-ac436-codex-resident-queue-reland --worktree /data/home/yale/work/claudecodeui-worktrees/task-gap-ac436-codex-resident-queue-reland --merge-target goal/GOAL-051` →
  `ANTI-DRIFT OK: task gap-ac436-codex-resident-queue-reland — 7 actual file(s), all within declared Touches (8 glob(s))`
  （合并 develop 后连跑两次，读数一致。）
- 说明：合并 develop 之后 `git diff --name-only goal/GOAL-051...HEAD` 还会列出 develop 相对 goal 分支的既有推进（cockpit/i18n/其它 task 文件），那是 develop 的内容、不是本任务的 delta；本任务自身的 delta 是上面两个提交的 7 个文件，fan-in 的 anti-drift 门以「7 个实文件全在 Touches 内」通过。

上一份为何没有兑现（可复核事实）：分支 `task/gap-ac436-codex-resident-queue-busy-input` 的判据今天仍 8/8 绿，但它的提交从未进入 `goal/GOAL-051`；worker-driver 连续 3 次 `exited-not-landed` 都卡在 `step=merge-develop` 的文本冲突（`server/shared/tests/quay-test-script.test.ts`、`tasks/gap-ac442-codex-resident-capabilities.md`），撞重试上限后标 needs-human 并最终 superseded。本轮按 Proposal 的顺序先 merge develop 再实测 pin/baseline，两次 merge 均无冲突，判据在合并后的树上仍 exit 0。

- 该轴仍暗,理由:本任务只把已写成的队列机制重新落到 goal/GOAL-051 树，未改变模块依赖/环结构，未产生可读的 L_D/L_G 数值读数。
