---
id: gap-ac444-codex-resident-turn-steer
title: AC-444 Codex 常驻：忙时 turn/steer 改当前 turn（返回当前 turnId、产物
  STEERED、pid/threadId 不变、queue 深度不增），stale expectedTurnId 错误 fail-closed
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-444
---
## Proposal

<!-- dedup-ref --> 机制去重（本轮实测，2026-10-29T16:07Z）：`grep -l '^goal_ac: *AC-444' tasks/*.md` → **0**；`grep -rln 'AC-444' tasks/*.md` 只命中 `gap-goal-051-turn-steer-not-an-ac.md`（status=needs-human、goal_ac 为空，它是「提议新增 AC-444」的提案任务，不是本判据的实现承载者，且已由人裁定把它推进到 AC 记录落地）；`grep -rln 'turn/steer' tasks/*.md` 也只命中同一份提案。`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches <下列源码> --json` → `peers: [gap-ac436-codex-resident-queue-reland (ready)]`，共享 `codex-host-driver.provider.ts` 与 `codex-host-driver.contract.ts`；`mentions: []`。**决定：separate，不 merge** —— AC-444 与 AC-436 是两条独立判据、独立验收（steer 改当前 turn vs queue 排后续 turn），且本条是 hermetic 的协议面判据，不依赖队列实现；两个任务在 Touches 上重叠，scheduler 会串行化对同一 driver 的编辑。因此不写 `depends_on`（避免被 peer 的落地状态卡死），只在正文登记该 peer。

**来源与判据物。** criterion 逐字取自 `goals/AC-444-忙时-steer-turn-steer-改当前-turn-不排队列-不开新-turn.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-steer.test.ts`。红态基线（本轮直跑，不是推断）：该命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-steer.test.ts'`。

**当前树（`goal/GOAL-051` 尖端 `b2412749e`，本轮逐项读的行号）**

- `server/modules/providers/list/codex/codex-host-driver.provider.ts` 恰好 **800** 行，处在 `server/shared/tests/architecture-ratchet.test.ts` 的 `OVERSIZE_LIMIT = 800`（只在 `> 800` 时红）边缘：任何内联新增都可能越线，steer 的协议逻辑必须落进兄弟模块。
- `submit()`（约 202 行）今天**无条件** `ensureThread` → `beginTurn` → `addTurnLease` → `connection.request('turn/start', turnParams(...))` → `await pending.promise`。driver 里没有任何 steer 分支。
- `handleNotification()`（约 565 行）按 `params.threadId` 找 session，`turn/started` 更新 `session.turnStatus/activeTurnId`，终态走 `settleTurn()`（约 610 行，唯一结算点，释放 turn lease 并 resolve `pending`）。
- `interrupt()`（约 244 行）只发 `turn/interrupt`，不动进程/threadId；`closeHost` 才是杀进程的唯一路径。
- `codex-app-server.connection.ts` 的 `request()` 把 JSON-RPC error 包成 `AppError(message, { code: 'CODEX_APP_SERVER_ERROR', details: { rpcCode } })`（约 372-394 行）；experimental 门只拦 `thread/queue/` 前缀，**`turn/steer` 不在该门内**，本条不需要能力门。
- `codex-host-driver.contract.ts`：`turnParams(threadId, turn)`（约 203 行）产出 `{threadId, input:[{type:'text',text}]}`；`readTurnId()`（约 131 行）读的是 **`result.turn.id`**。⚠️ `turn/steer` 的响应形状不同（见下），不能复用它。
- `git grep -c 'turn/steer' goal/GOAL-051 -- server/` → **0**；goal 树上没有任何 steer 实现。
- 判据骨架可照抄 AC-435 已落地的 `server/modules/providers/tests/codex-host-driver-persistent.test.ts`：`FakeAppServerTransport implements CodexAppServerTransport`、固定假 pid、`createDriver()` 用 `createConnection: (launch) => new CodexAppServerConnection({ launch, createTransport: () => transport })` 注入，`startHost` + `bind` 后 `submit`；writer 帧通过 `driver.run(appSessionId, turn, writer, context)` 的通知订阅获得。

**实测依据（`tmp/codex-appserver-exp-NuPHhk/`，锁定 `@openai/codex 0.153.4`）**

- `REPORT.md` E8 逐字：active turn 中 `turn/steer {threadId, expectedTurnId, input}` 返回 `{turnId}`；最终 assistant 文本变为 `STEERED`，turn `completed`；与 `thread/queue/add` 不同（steer 改当前 turn；queue 排后续 turn）。
- `e8-steer.jsonl` 的真实帧：请求 `{"method":"turn/steer","params":{"threadId":...,"expectedTurnId":"<当前 turn id>","input":[{"type":"text","text":"…STEERED"}]}}`（`:16`）；响应是 **顶层** `{"turnId":"01a18670-…"}`，**不是** `{turn: {id}}`；期间先有 `item/completed`（userMessage=steer 文本，`:1494`），随后 `item/completed`（`agentMessage` `text:"STEERED"`，`:1500`），最后 `turn/completed` 的 `params.turn.items` **只含最终 agentMessage `STEERED`**（`:1504`），`status:"completed"`，`turn.id` 与 steer 返回的 turnId 相同。

**要建的东西**

1. `server/modules/providers/list/codex/codex-resident-steer.ts`（new）—— steer 的纯协议面，保证 driver 行数预算：
   - `steerParams(threadId, expectedTurnId, turn)`：在 `turnParams(threadId, turn)` 上补 `expectedTurnId`；
   - `readSteerTurnId(result)`：读**顶层** `result.turnId`（string，非空），不读 `result.turn.id`；
   - `assertSteerTurnId(returnedTurnId, activeTurnId)`：不等则抛 `AppError`（`code:'CODEX_STEER_TURN_MISMATCH'`、statusCode 502，消息里带 `expected=<activeTurnId> actual=<returnedTurnId>`）；
   - 公开类型 `CodexSteerResult = { turnId: string }`（driver re-export，测试不需要 import 内部函数）。
2. `CodexHostDriver.steer(host: ProcessHost, appSessionId: string, turn: HostTurnInput): Promise<CodexSteerResult>`（改 `codex-host-driver.provider.ts`，必要时把新增类型塞进 `codex-host-driver.contract.ts`）：
   - 前置：session 存在、`turnStatus === 'inProgress'`、`threadId` 与 `activeTurnId` 均非空；否则 reject `AppError`（`code:'CODEX_STEER_NO_ACTIVE_TURN'`、statusCode 409），**零协议调用**；
   - `await connection.request('turn/steer', steerParams(threadId, activeTurnId, turn))`；
   - 读 `readSteerTurnId` 并 `assertSteerTurnId(returned, activeTurnId)`；返回 `{turnId: returned}`；
   - **成功路径不改变** `session.pending`、`session.activeTurnId`、`session.threadId`、turn lease、pid；
   - **错误路径 fail-closed**：不 catch/不转换/不吞掉 connection 抛出的错误，原样 rethrow；绝不回落 `thread/queue/add`、绝不 `turn/start`、不 `thread/start|resume`；
   - driver 行数必须 ≤ 800：若新增行越线，把现有内聚块移到兄弟模块（不改行为），不要动 `architecture-ratchet.test.ts` 的阈值。
3. `server/modules/providers/tests/codex-host-driver-steer.test.ts`（new）—— hermetic 假 app-server transport（不 spawn 真 codex、不碰 DB/网络）：
   - 假 transport 实现 `initialize`、`initialized`、`thread/start|resume`、`turn/start|interrupt`、`turn/steer`、`thread/queue/add|list|delete`；维护 thread id / active turn id / queue 深度；记录方法序列与每调用的 params；固定假 pid。
   - `turn/start` 默认把 turn 保持 `inProgress`（`autoComplete=false`），便于在 active turn 中调 steer；`turn/steer` 成功模式校验 `expectedTurnId === activeTurnId`，返回顶层 `{turnId: activeTurnId}`，随后发 `item/completed`（userMessage=steer 文本）、`item/completed`（agentMessage `text:'STEERED'`）、`turn/completed {turn:{id: activeTurnId, status:'completed', items:[{type:'agentMessage', text:'STEERED'}]}}`。
   - stale 模式：`expectedTurnId !== activeTurnId` 时回 JSON-RPC error `{code:-32000, message:'expectedTurnId <x> does not match current turn <y>'}`，不发任何 turn 帧。
   - 测试用 `driver.run('session-1', turn(...), writer, context)`（不 await）→ `waitFor(turnStatus==='inProgress')` → `driver.steer(...)` → 等 run 完成；writer 帧用于断言最终产物。
   - 范围外：不接 `chat.send`/`provider-runtime.service.ts`（忙时队列与 runtime 接缝属 AC-436）；不改 capabilities、不挂 provider、不碰 `codex.provider.ts`；不实现 queue 语义。

**假形态（必须逐条实测红，只改实现、不改判据文件）**

- (A) steer 落到 `thread/queue/add`：`queue/add` 被调用且 queue 深度 +1 ⇒ 判据红。
- (B) steer 用 `turn/start` 开新 turn：返回新 turnId ≠ 当前 turn id ⇒ 判据红。
- (C) 接受 stale `expectedTurnId`（吞掉 JSON-RPC error 或把它读成成功）⇒ fail-closed 断言红。

## Plan

1. 从 `goal/GOAL-051` 尖端开 task worktree（目标分支 `task/gap-ac444-codex-resident-turn-steer`），先读 driver/contract/connection 与 AC-435 判据，记录 driver 行数（当前 800）。
2. 新建 `codex-resident-steer.ts`；在 driver 上接 `steer()`；按行数预算决定是否顺带抽出一个内聚块（只搬家、不改行为）。
3. 写 `codex-host-driver-steer.test.ts`，逐条打印读数后收紧断言；先本地绿。
4. **先** `git merge develop` 并解决冲突，**再**在合并后的树上重测采集数，按实测更新 `server/shared/tests/quay-test-script.test.ts` 的两个 pin（新判据文件令 collected +1），**最后**追加 `scripts/suite-duration-baseline.tsv` 的实测 duration 行并确认覆盖率 ≥ 90%。上一份 AC-436 任务死在「merge 前把 pin 改死」，本条必须按此顺序。
5. 逐条跑本判据、兄弟判据、`architecture-ratchet.test.ts`、`npm run typecheck`；实测 A/B/C 三个假形态并记录逐字红态；还原后确认 `git status --short` 只剩 Touches 内文件。
6. 跑 anti-drift（`--merge-target goal/GOAL-051`），逐项把读数写进完成记录，交给 fan-in。

## AC

- [x] AC1 **判据入口为绿**：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-steer.test.ts` 退出 **0** 且 `fail 0`；完成记录贴出末尾 12 行。红态基线（本轮实测，`goal/GOAL-051` 尖端）：同命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-steer.test.ts'`。
- [x] AC2 **steer 返回当前 turnId，不开新 turn**：active turn 中调 `driver.steer`，打印 `activeTurnId=<id> steerTurnId=<id> turnStartCalls=<n> turnStartedFrames=<n>`；断言 `steerTurnId === activeTurnId`、`turn/start` 调用数没有增加、没有出现与当前 turn id 不同的 `turn/started`。
- [x] AC3 **终态产物体现 steer 输入**：writer 收到的 `turn/completed` 的 `params.turn.items` 只含最终 `agentMessage` 且 `text` 逐字为 `STEERED`，`status` 为 `completed`，`turn.id` 等于当前 turn id；打印 `finalAgentText=STEERED terminalStatus=completed submitResolved=true`。反向控制：把终态 items 改成 pre-steer 文本 `NOT-STEERED` 时同一断言必须红（在测试内用共享断言函数证明非恒真）。
- [x] AC4 **pid 与 threadId 不变、下一轮同 pid 继续**：打印 steer 前 / steer 后 / 下一轮三个读数 `threadId=<id> hostPid=<n> transportPid=<n>`，三者全等；下一轮 `turn/start` 的 `threadId` 等于原 threadId，transport pid 不变。
- [x] AC5 **queue 深度不增、不回落成 queue**：steer 前后 transport 的 queue 深度均为 **0**（或不变），且 steer 窗口内方法序列只含 `turn/steer`；打印 `queueDepthBefore=0 queueDepthAfter=0 queueAddCalls=0 queueListDelta=0 steerWindowMethods=["turn/steer"]`。
- [x] AC6 **stale expectedTurnId 显式传回且 fail-closed**：假 transport 回 JSON-RPC error 时 `driver.steer` 必须 reject，错误为 `code=CODEX_APP_SERVER_ERROR`、`details.rpcCode=-32000`、消息含假 transport 的逐字文案；打印 `steerErrorCode=<…> rpcCode=<…> message=<…> queueAddCalls=0 turnStartCalls=<原轮次> fallback=none activeTurnIdAfter=<原 id> turnStatusAfter=inProgress`；断言错误后原 turn 仍可正常 `turn/completed`，run 正常 resolve。
- [x] AC7 **无 active turn 时拒绝**：idle 会话调 `driver.steer` reject `CODEX_STEER_NO_ACTIVE_TURN`，且 `turn/steer`、`turn/start`、`thread/queue/add` 调用数均不变；打印三个计数。
- [x] AC8 **假形态 A 必红（queue/add）**：临时把 steer 实现改成 `thread/queue/add` ⇒ 判据 exit **1**，失败落在 queue 深度/`queueAddCalls` 断言；抄下逐字失败行，`git checkout --` 还原后重跑 exit 0。
- [x] AC9 **假形态 B 必红（turn/start）**：临时把 steer 实现改成 `turn/start` ⇒ 判据 exit **1**，失败落在 `steerTurnId === activeTurnId` 断言；抄下逐字失败行，还原后 exit 0。
- [x] AC10 **假形态 C 必红（吞 stale 错误）**：临时让实现吞掉 JSON-RPC error 或把它读成成功 ⇒ 判据 exit **1**，失败落在 fail-closed 断言；抄下逐字失败行，还原后 exit 0。
- [x] AC11 **行数预算与架构棘轮**：`git show HEAD:server/modules/providers/list/codex/codex-host-driver.provider.ts | wc -l` ≤ **800**；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0；`npm run typecheck` 退出 0。
- [x] AC12 **采集数与覆盖率钉子（merge develop 之后实测）**：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0，两处 `unknown=` pin 按合并后实测值（新判据文件令 collected +1，若有漂移以实测为准）；`scripts/suite-duration-baseline.tsv` 含本判据行且覆盖率 ≥ 90%；完成记录贴出实测数与覆盖率算式。
- [x] AC13 **兄弟判据无回归**：`codex-host-driver-persistent.test.ts`、`codex-host-driver-settings.test.ts`、`codex-resident-approvals.test.ts`、`codex-resident-background-leases.test.ts`、`codex-app-server-protocol.test.ts`、`codex-resident-capabilities.test.ts`、`codex-resident-lifecycle.test.ts`、`lifecycle-mode.test.ts` 逐个退出 0；完成记录贴出每条的 tests/pass/fail。
- [x] AC14 **范围与 anti-drift**：`node --no-warnings /data/home/yale/.claude/plugins/cache/quay/quay/0.24.0/scripts/dist/anti-drift-touches-check.js --task gap-ac444-codex-resident-turn-steer --worktree <worktree> --merge-target goal/GOAL-051` 打印 `ANTI-DRIFT OK`；`git diff --name-only goal/GOAL-051...HEAD` 仅含 Touches 内文件。
- [x] AC15 **ADR-007 暗轴**：完成记录写行首声明 `该轴仍暗,理由:本条只新增 Codex 私有 steer 面与 hermetic 判据，未改变架构图/文档面，没有 L_D/L_G 可量化读数`。

## DoD

判据在**合并 develop 后的 goal 工作树**上按原命令重跑：exit 0、`fail 0`，且完成记录必须贴出以下实测读数，缺一项不算落地：

(a) AC2 的 `activeTurnId` / `steerTurnId` / `turnStartCalls`；(b) AC3 的 `finalAgentText=STEERED` 与终态 `turn/completed` 的 items 读数，以及 `NOT-STEERED` 反向控制的逐字红态；(c) AC4 的前/后/下一轮三行 pid+threadId；(d) AC5 的 queue 深度与 steer 窗口方法序列；(e) AC6 的 stale 错误码/消息/零回落计数，以及错误后原 turn 仍完成的读数；(f) AC7 无 active turn 的三计数；(g) AC8/AC9/AC10 三个假形态的退出码、逐字失败行与还原后 exit 0；(h) AC11 的 driver 行数、architecture-ratchet 与 typecheck 退出码；(i) AC12 的两个 pin 实测值与 baseline 覆盖率算式；(j) AC13 每个兄弟判据的 tests/pass/fail；(k) AC14 的 `ANTI-DRIFT OK` 与 diff 文件清单；(l) AC15 的暗轴行。

承重性：判据必须是 hermetic 假 transport（不真起 codex），并且三条假形态分别把「做成 queue」「做成新 turn」「吞掉 stale expectedTurnId 错误」打红——只有这三条都红过，判据才不是「文件存在即绿」。本任务**不**实现 queue 语义（AC-436）、不改 capabilities/挂载（AC-441/442）、不接 `chat.send` 运行时接缝。

## Completion Record

实施提交（task 分支）：`fa7166e45` codex-resident-steer.ts + driver.steer + 判据；`158889d9e` 按流程先 merge develop；`63936be94` 两个 pin + baseline 行。`158889d9e` 的 merge 同时把 develop 上 5 个 `tasks/*.md` 带进分支（`git diff --name-only goal/GOAL-051...HEAD` 会列出它们），这些是 driver 强制的 pre-merge 带入、非本条作者改动；anti-drift 读的是本条自有改动（5 个文件，全部在 Touches 内）。

**AC1**（合并 develop 后重跑）exit **0**，末尾 12 行：

```text
reverseNotSteeredRejected=true reverseNewTurnRejected=true reverseQueueFallbackRejected=true
✔ a stale expectedTurnId is refused fail-closed and the turn still completes (AC6) (2.078982ms)
✔ steer refuses a session with no active turn and sends nothing (AC7) (0.541188ms)
✔ reverse controls reject a queue fallback, a new turn, a drifted product and an idle acceptance (AC3/AC8/AC9/AC10) (3.711844ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3645.970684
```

**AC2** `activeTurnId=turn-1 steerTurnId=turn-1 turnStartCalls=1 turnStartedFrames=1`（steer 前后 `turn/start` 调用数与 `turn/started` 帧数均未增长，没有别的 turn id 的 `turn/started`）。

**AC3** `finalAgentText=STEERED terminalStatus=completed submitResolved=true`；`terminalItems=[{"type":"agentMessage","text":"STEERED"}] terminalTurnId=turn-1 activeTurnId=turn-1`。反向控制：把终态 items 的 text 换成 `NOT-STEERED` 后共享断言 `assertSteeredTerminal` 抛错，打印 `reverseNotSteeredRejected=true`（`assertSteeredTerminal` 的逐字红态即 `finalAgentText=NOT-STEERED expected=STEERED`）。

**AC4** 三行读数：
```text
before threadId=thread-1 hostPid=515151 transportPid=515151
afterSteer threadId=thread-1 hostPid=515151 transportPid=515151
next threadId=thread-1 hostPid=515151 transportPid=515151 nextTurnThreadId=thread-1
```

**AC5** `queueDepthBefore=0 queueDepthAfter=0 queueAddCalls=0 queueListDelta=0 steerWindowMethods=["turn/steer"]`。

**AC6** `steerErrorCode=CODEX_APP_SERVER_ERROR rpcCode=-32000 message=expectedTurnId turn-1 does not match current turn turn-server-moved-on`；`queueAddCalls=0 turnStartCalls=1 fallback=none activeTurnIdAfter=turn-1 turnStatusAfter=inProgress`；随后 `runAfterRefusal resolved=true turnStatusAfterCompletion=completed`（错误后原 turn 照常 `turn/completed`，run resolve）。

**AC7** `idleSteerErrorCode=CODEX_STEER_NO_ACTIVE_TURN turnSteerCalls=0 turnStartCalls=0 queueAddCalls=0`。

**AC8**（假形态 A：steer 改发 `thread/queue/add`）判据 exit **1**，逐字失败行：
`AssertionError [ERR_ASSERTION]: steer must not queue the input (thread/queue/add calls=1)`（`1 !== 0`）。还原实现后重跑 exit **0**（`tests 4 pass 4 fail 0`）。

**AC9**（假形态 B：steer 改发 `turn/start`）判据 exit **1**，逐字失败行：
`AssertionError [ERR_ASSERTION]: steerTurnId=turn-2 activeTurnId=turn-1 — turn/steer must return the current turn`（`'turn-2' !== 'turn-1'`）。还原后重跑 exit **0**。

**AC10**（假形态 C：吞掉 JSON-RPC error 并报成功）判据 exit **1**，逐字失败行：
`AssertionError [ERR_ASSERTION]: a stale expectedTurnId must reject the steer`（同轮打印 `steerErrorCode=none rpcCode=null`）。还原后重跑 exit **0**。

**AC11** `git show HEAD:...provider.ts | wc -l` → **796**（≤ 800）；`architecture-ratchet.test.ts` exit **0**（tests 6 / pass 6 / fail 0）；`npm run typecheck` exit **0**。

**AC12** `quay-test-script.test.ts` exit **0**（tests 14 / pass 14 / fail 0）；两处 pin 实测更新为 `known=3 unknown=470` 与 `known=1 unknown=472`（collected 473 - 3 / -1）；`scripts/suite-duration-baseline.tsv` 追加 `3398	server/modules/providers/tests/codex-host-driver-steer.test.ts`。覆盖率算式：`427/473 = 90.27% ≥ 90%`（floor `473 × 0.9 = 425.7 ⇒ 需 426`）。

**AC13** 兄弟判据逐个 exit 0：
- `codex-host-driver-persistent.test.ts` tests 5 / pass 5 / fail 0
- `codex-host-driver-settings.test.ts` tests 6 / pass 6 / fail 0
- `codex-resident-approvals.test.ts` tests 18 / pass 18 / fail 0
- `codex-resident-background-leases.test.ts` tests 8 / pass 8 / fail 0
- `codex-app-server-protocol.test.ts` tests 7 / pass 7 / fail 0
- `codex-resident-capabilities.test.ts` tests 6 / pass 6 / fail 0
- `session-hosts/tests/codex-resident-lifecycle.test.ts` tests 9 / pass 9 / fail 0
- `session-hosts/tests/lifecycle-mode.test.ts` tests 9 / pass 9 / fail 0

**AC14** `ANTI-DRIFT OK: task gap-ac444-codex-resident-turn-steer — 5 actual file(s), all within declared Touches (7 glob(s))`（exit 0）。`git diff --name-only goal/GOAL-051...HEAD` 的本条改动：
```text
scripts/suite-duration-baseline.tsv
server/modules/providers/list/codex/codex-host-driver.provider.ts
server/modules/providers/list/codex/codex-resident-steer.ts
server/modules/providers/tests/codex-host-driver-steer.test.ts
server/shared/tests/quay-test-script.test.ts
```
同一条 diff 另列 5 个 `tasks/*.md`（develop merge 带入，见上）。

**AC15** 该轴仍暗,理由:本条只新增 Codex 私有 steer 面与 hermetic 判据，未改变架构图/文档面，没有 L_D/L_G 可量化读数

## Touches

- server/modules/providers/list/codex/codex-resident-steer.ts (new)
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/tests/codex-host-driver-steer.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-ac444-codex-resident-turn-steer.md
