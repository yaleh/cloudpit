---
id: gap-codex-resident-normalize-app-server-frames
title: Codex resident：把 app-server 原始帧归一化成 kind 消息，修复 assistant 回答被
  ChatSessionWriter 整体丢弃
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 机制去重（2026-10-31 实测）：`grep -rliE 'item/agentMessage/delta|item/completed|归一化' tasks/*.md` 命中的是别的机制——`gap-ac440-codex-app-server-protocol-gate`（done）只做 initialize 的 experimentalApi 声明门，其 AC12 把「事件归一化」列为未实现项；`gap-ac435-codex-resident-host-driver-persistent`（done）是 driver 本体。`codex-host-driver.provider.ts` 里 `run()` 注释「Normalizing them into app message shapes is a later integration task (AC-440)」所指的归一化从未落地。granularity：`--touches codex-host-driver.provider.ts` peers=[]。决定：separate，独立验收。

**现状（生产实测，非推断）**：2026-10-31 :3001 两个 resident codex 会话 `0f0cf753`/`4065b219` 首轮 assistant 已被 app-server 写盘（`~/.codex/sessions/.../rollout-*.jsonl` 完整、`01:51:13Z` task_complete），但 server.log 大量 `[ChatSessionWriter] Dropping non-normalized outbound payload`，method 为 `item/agentMessage/delta`（增量）、`item/completed`（`type:'agentMessage'` 的整段最终回答）、`turn/completed` 等。根因：`server/modules/providers/list/codex/codex-host-driver.provider.ts` 的 `run()` 把连接通知原样 `writer.send({ method, params })`，而 `chat-session-writer.service.ts:89` 只接受带 `kind` 的归一化消息 ⇒ 前端收不到任何 assistant 输出。

**修复方向**：在 resident driver 与 writer 之间补事件归一化，放 codex 目录内兄弟叶文件 `codex-resident-normalize.ts`（不新建目录）：`item/agentMessage/delta`→文本增量 kind、`item/completed`(agentMessage)→完整回答、`turn/completed|failed|interrupted`→终态；审批/后台/队列帧由既有 broker 消费、不重复归一化；无法映射的帧显式丢弃并日志注明。`run()` 的 onNotification 分支改为先归一化再 `writer.send`，删除裸帧直发路径。

## AC

- [x] AC1 归一化判据为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-normalize.test.ts` 退出 0、`fail 0`、`pass >= 4`。
- [x] AC2 delta→增量：归一化器对 `item/agentMessage/delta`（`params.delta` 非空）产出带 `kind` 的文本增量消息且 `threadId` 不变；打印 `deltaKind=<kind>`。
- [x] AC3 completed→终稿与终态：对 `item/completed`（`item.type==='agentMessage'`、`item.text` 非空）产出带 `kind` 的完整回答；对 `turn/completed` 产出终态消息；打印 `completedKind=<kind> turnTerminalKind=<kind>`。
- [x] AC4 无裸帧透传：以假 transport 跑一轮，捕获 writer 收到的每一帧，断言没有任何无 `kind` 的 `{method,params}` 裸帧（`kindless=0`）；打印 `frames=<n> kindless=0`。
- [x] AC5 假形态承重：临时把 `run()` 恢复为 `writer.send({ method, params })` 原样直发 ⇒ AC1 退出 1 且失败行含 `kindless`；逐字记录后还原并复绿。
- [x] AC6 typecheck 无回归：`npm run typecheck` 退出 0。

## DoD

在真实 app-server（非注入替身）上对 resident codex 会话发一条消息，前端实时看到增量输出、回合结束看到完整 assistant 回答（此前为零输出），日志不再出现该会话的 `Dropping non-normalized outbound payload`。完成记录贴判据逐字 tests/pass/fail、假形态逐字失败行、生产 :3001 复验日志或截图。新增 `*.test.ts` 若使 quay-test-script 的 collected/unknown 钉子或 suite-duration 覆盖率下限变红，须同任务内等量上调对应 pin 并在完成记录注明。

## 完成记录

实现：新增 `server/modules/providers/list/codex/codex-resident-normalize.ts`（归一化 + 每 run 的 turn 作用域 relay）；`run()` 的 onNotification 改为 `frames.forward`，裸帧直发路径删除；队列在 `add()` 建 entry 时即挂 `onBound`（修掉 add 的 queue/list 刷新期间 `turn/started` 先绑定、relay 永远停在 queued 的竞态）。

AC1（exit 0）：
```
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-normalize.test.ts
ℹ tests 4
ℹ pass 4
ℹ fail 0
```
AC2 读数：`deltaKind=stream_delta deltaThreadId=thread-normalize emptyDeltaFrames=0`
AC3 读数：`completedKind=text turnTerminalKind=complete terminalExitCode=0 failedKinds=error,complete`
AC4 读数：`frames=5 kindless=0 kinds=session_created,stream_delta,stream_delta,text,complete`
AC5 假形态（把 `frames.forward(method, params)` 换回 `writer.send({ method, params })`）：命令退出 1，失败行逐字：
```
AssertionError [ERR_ASSERTION]: kindless=6 — the run writer must never receive a bare {method,params} frame
```
还原后复绿：`ℹ tests 4 / ℹ pass 4 / ℹ fail 0`、`frames=5 kindless=0`。
AC6：`npm run typecheck` 退出 0。

DoD 真实 app-server 探针（非注入替身，bundled `codex app-server`，真实 pid 3635847；`tmp/real-app-server-probe.mts`，日志 `tmp/real-app-server-probe.log`）：
```
kinds=session_created,stream_delta ×7,text,complete
deltaArrivalsMs=[2848,2848,2848,2848,2848,2848,2880]
answers=["NORMALIZE-PROBE-OK"]
frames=10 kindless=0 rawFrames=0 threadId=01a18fd6-a491-7781-a875-9841cd97c0d4 turnStatus=completed
```
增量在约 2.85s 起实时到达 writer，回合末收到完整回答 `NORMALIZE-PROBE-OK` 与 `complete exitCode=0`；全程没有一帧无 `kind`，即 `ChatSessionWriter` 的 `Dropping non-normalized outbound payload` 路径不再被触发。诚实边界：本轮未重启共享 :3001 实例（重启会杀死运行在其下的会话），因此“生产 :3001 部署后复验日志/截图”留给 fan-in 后的部署步骤；浏览器端未单独截图（本任务无前端改动，证据是 run writer 收到与 `ChatSessionWriter` 契约一致的消息）。

pin：新增判据文件使 collected 479→480；`server/shared/tests/quay-test-script.test.ts` 的 unknown 钉子等量上调 476→477（AC2，3 known）与 478→479（AC3，1 known），注释链同步；suite-duration 覆盖率下限复验仍绿。同任务内因归一化契约更新了三个既有判据读取 writer 的方式：`codex-app-server-protocol.test.ts`（AC6 由“转发原始 item/started”改为“writer 只收 kind 消息且不泄露原始帧”）、`codex-host-driver-steer.test.ts`（终态 turn 身份读 transport 帧，agent 文本与 complete 读 writer）、`codex-host-driver-queue.test.ts`（queued writer 读 `complete`，并断言两个 writer 各恰好一个终态）。

ADR-007：该轴仍暗,理由:本任务是 app-server 帧归一化的行为修复,未改变文档/依赖结构,无 L_D/L_G 读数。

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-resident-normalize.ts
- server/modules/providers/list/codex/codex-resident-queue.ts
- server/modules/providers/tests/codex-resident-normalize.test.ts
- server/modules/providers/tests/codex-app-server-protocol.test.ts
- server/modules/providers/tests/codex-host-driver-queue.test.ts
- server/modules/providers/tests/codex-host-driver-steer.test.ts
- server/shared/tests/quay-test-script.test.ts
- tasks/gap-codex-resident-normalize-app-server-frames.md