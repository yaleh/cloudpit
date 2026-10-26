---
id: gap-ac238-debug-agent-control-queue-hermetic
title: AC-238 判据文件自钉 RESIDENT_RUN_IS_TURN 关态：裸 goal-gate 命令在 anchor 继承该开关时仍 5/5
  绿，四条读数与取假形态不变
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-238
---
## Proposal

<!-- dedup-ref --> 机制去重（立案时实测，2026-10-26）：`grep -l '^goal_ac: *AC-238' tasks/*.md` 只命中 `tasks/gap-ac238-debug-agent-control-queue.md`（status `done`，按 gap 重立规则它不是重复，而是上一轮修复没撑住的证据）；`grep -rl "debug-agent-control-queue.test.ts" tasks/*.md` 命中的 6 个任务（AC-235/AC-238/AC-249/AC-271/AC-287、`gap-server-suite-red-set-15-files`）全部 `done`，`todo`/`ready`/`needs-human` 中 0 命中本判据文件。同机制的兄弟任务 `gap-ac231-resident-run-flag-hermetic`（ready）修的是另一个文件 `server/modules/websocket/tests/chat-control-busy.test.ts`，与本文无文件重叠、验收独立 ⇒ **separate**。粒度工具 `task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/debug-agent/tests/debug-agent-control-queue.test.ts --json` ⇒ `peers: []`、`mentions: []`。

### 本轮直接复测（不是账本尾巴）

AC-238 的判据命令（goal store 原文）：

```
for f in server/modules/debug-agent/tests/debug-agent-control-queue.test.ts; do [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; done; npx tsx --tsconfig server/tsconfig.json --test server/modules/debug-agent/tests/debug-agent-control-queue.test.ts
```

在 `/data/home/yale/work/claudecodeui` 上当场实跑：

- 裸命令（本会话环境带 `RESIDENT_RUN_IS_TURN=1`，`env | grep` 逐字读数 `RESIDENT_RUN_IS_TURN=1`；来源是 anchor 从 `claudecodeui-server.service` 的 `40-resident-run-is-turn.conf` 继承，见 `scripts/test.sh` 的 host-env 隔离注释）⇒ `EXIT=1`，`tests 5 / pass 1 / fail 4`。四条读数腿 (a)–(d) 全部 `Error: probe child (<mode>) exited non-zero`；子进程 stderr 逐字含 `Warning: Detected unsettled top-level await at /data/home/yale/work/claudecodeui/server/modules/debug-agent/tests/debug-agent-control-queue.test.ts:492`，其中 (a)/(b)/(d) 另含 `[DebugAgent] Scenario run for session "…" did not meet its own expectations:` + `rows: the run wrote 1 row(s) (3 -> 4); the scenario expects 2`。只有 (e) 无 socket 自检是绿的。
- 同一命令 `env -u RESIDENT_RUN_IS_TURN npx tsx … --test …` ⇒ `EXIT=0`，`tests 5 / pass 5 / fail 0`（约 30s）。

⇒ 红/绿的唯一差别是宿主导出的 `RESIDENT_RUN_IS_TURN`，不是实现回归。

### 为什么绿不了：判据文件没有自述它所在的世界

- AC-385（`gap-ac385-send-deliveryid-runid-compat-window`，done，提交 `5ec056496`）给 resident 的 `send` 加了 `readAcceptedDelivery`：`server/modules/websocket/services/chat-control.service.ts` 在 `residentRunIsTurn()` 为真且会话 resident 时，`send` 会轮询 `readSessionDeliveries(sessionId)` 直到出现一条新 delivery 或 2s 上界。`residentRunIsTurn()`（`server/shared/utils.ts:76-77`）在**调用时**读 `process.env.RESIDENT_RUN_IS_TURN === '1'`。
- 本判据的 resident 会话是调试 agent：它在 `armHarness` 里用自己的工厂构造 provider（为了拿到 `openRun` 缝），没有传 `publishDeliveries`；而且调试 agent 只在 **busy push** 时写 `deliveriesBySession`（`debug-agent.provider.ts` 的 `recordQueuedDelivery`），**首轮 turn 的 send 不写 delivery**。于是 flag-on 下首轮 `send` 等一条永远不出现的 delivery。
- 该轮询的间隔定时器是 `unref()` 的（`DELIVERY_ID_POLL_INTERVAL_MS`），场景引擎的定时器跑完（约 320ms）后子进程事件循环清空，Node 以 exit 13 退出并打印上面的 unsettled-top-level-await ⇒ 父进程看到 `probe child … exited non-zero`。逐条读数被这条挂起遮住：临时在 `sendTwice` 打点（已回滚）只看到 `PROBE first send start`，没有 `first send done`，即**第一次 send 就没返回**，第二次 send 从未发生，`dequeue` 步取到空队列，于是 `expect.rows.delta=2` 读出 1。
- flag-off（变量未设）时 `priorDeliveryIds === null`，`send` 不走 delivery 轮询，按判据写的世界返回第一次的 `runId` 与第二次的 `queuedMessageUuid`，四条读数成立。

### 为什么上一轮的修复没有撑住（必写）

1. 原始 AC-238 任务（done，实现 `51760ea2`）落地时 5/5 全绿，但那次绿是在 `RESIDENT_RUN_IS_TURN` 不存在的环境里取得的；判据文件本身从未把「flag-off 世界」钉住，只是恰好继承了干净环境。
2. `gap-server-suite-red-set-15-files`（done，`cc9ad6fa9`）把同一类宿主 env 泄漏的修复落在**运行器** `scripts/test.sh`（`unset RESIDENT_RUN_IS_TURN VOICE_CAPTURE` + `VOICE_REALTIME_*`/`SENSEVOICE_*`）。但 **goal gate 不走 test.sh**：它按 AC 字面命令在 anchor 继承的环境里跑，所以泄漏在复验环上仍然把 AC-238 判红。
3. 同机制的兄弟判据已在文件内自钉（AC-231 的 `chat-control-busy.test.ts`、AC-385 的 `mcp-session-send-delivery.test.ts` 设 `process.env.RESIDENT_RUN_IS_TURN = '1'`）；AC-238 这个文件缺的正是这行「声明自己的世界」。

### 要交付的修复（只改判据文件）

在 `server/modules/debug-agent/tests/debug-agent-control-queue.test.ts` **模块顶层、`test(...)` 定义之前**：保存进进程时的 `process.env.RESIDENT_RUN_IS_TURN`，`delete process.env.RESIDENT_RUN_IS_TURN`（factory default = off；`residentRunIsTurn()` 只认 `'1'`），并在 `node:test` 的 `after` 钩子里恢复原值（原本未设则保持删除）。需要把 `import test from 'node:test'` 改为 `import test, { after } from 'node:test'`。注释写清：这就是 `scripts/test.sh` 的 `unset RESIDENT_RUN_IS_TURN` 与 AC-385 判据「this criterion's world」的同一件事；goal gate 不经过 test.sh，所以文件必须自己钉住。

本轮的可行性验证（临时补丁，已 `git checkout --` 回滚）：上述模块级保存/删除/`after` 恢复补丁在**环境仍带 `RESIDENT_RUN_IS_TURN=1`** 时跑裸判据命令 ⇒ `tests 5 / pass 5 / fail 0`。另一个等价位置是 `runChild` 构造子进程 env 时显式 `RESIDENT_RUN_IS_TURN: '0'`（同样实测 5/5），但模块级钉住还覆盖父进程将来的任何调用，建议以模块级为主。

**拒绝的替代方案**：给 `armHarness` 补 `publishDeliveries` 或让调试 agent 为首轮 send 写 delivery 账本。前者不解决首轮（调试 agent 只在 busy push 时记账），后者会把判据推进 S2 语义：flag-on 下 `send().runId` 是 nullable、busy send 复用当前 run，(b) 要求的「第二轮 runId 与第一轮不同」与两轮各自终止帧都不再是判据写的读数；run=turn 世界归 AC-385 自己的判据覆盖。

**边界**：只改判据文件与任务文件自身。不做 `scripts/test.sh` 级修复（已存在）、不改 goal store 的 criterion 文本、不碰 `chat-control.service.ts` / `debug-agent.provider.ts` / `provider-runtime.service.ts`、不放宽或删除任何 `assert*`、不把四条读数改写成「只要有某个 run 就算过」。不跳过失败腿。

## AC

- [x] AC1 裸判据命令在「继承宿主开关」的环境下退出 0：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/debug-agent/tests/debug-agent-control-queue.test.ts` ⇒ `EXIT=0`、`tests 5 / pass 5 / fail 0`。逐字抄命令行、退出码与计数（不得经 `scripts/test.sh`，不得用 `env -u`）。
- [x] AC2 同一命令在开关未设时也退出 0：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/debug-agent/tests/debug-agent-control-queue.test.ts` ⇒ `EXIT=0`、`tests 5 / pass 5 / fail 0`。两种宿主环境同一读数。
- [x] AC3 钉子承重（负向控制）：先提交实现，再临时移除钉住块（备份或存 `git diff` 补丁），以 `RESIDENT_RUN_IS_TURN=1` 跑同一命令 ⇒ `EXIT=1`，且逐字失败行是 `✖ (a) a busy resident send queues and hands over the driver queue tail` + `Error: probe child (queue) exited non-zero`（子进程 stderr 含 `Warning: Detected unsettled top-level await`）；恢复钉子后 AC1 重新 5/5。证明绿来自钉住的世界，不是把断言改松。
- [x] AC4 四条读数与断言未被改动：`git diff develop...HEAD -- server/modules/debug-agent/tests/debug-agent-control-queue.test.ts` 只含 env 钉住（`import test, { after }` + 保存/删除/`after` 恢复 + 注释），五个 `test(...)` 与全部 `assert*` 行逐字不变。AC1 运行里仍打印 `(a) first=… second=… queue=…`、`(b) round1RunId=… round2RunId=… round2Complete=true …`、`(c) verdict=withdrawn … pidBefore=… pidAfter=…`、`(d) … verdict=already-started …`、`(e) socketReferences=[]`；五条读数逐字抄进完成记录。
- [x] AC5 恢复语义：`after` 钩子把 `RESIDENT_RUN_IS_TURN` 恢复为进进程时的原值（原本未设则删除）。完成记录写下「进进程原值 → 文件内值 → 退出前恢复值」三项读数，分别对 `RESIDENT_RUN_IS_TURN=1` 与未设两种调用各取一次（临时打印验证后可移除）。
- [x] AC6 无实现改动：`git diff --stat develop...HEAD` 只列 `server/modules/debug-agent/tests/debug-agent-control-queue.test.ts` 与 `tasks/gap-ac238-debug-agent-control-queue-hermetic.md`；`git diff develop...HEAD -- server/ ':!server/modules/debug-agent/tests/debug-agent-control-queue.test.ts'` 无输出。
- [x] AC7 不回归：`npx tsx --tsconfig server/tsconfig.json --test server/modules/debug-agent/tests/debug-agent-host-driver.test.ts` ⇒ `EXIT=0`、fail 0（该文件与本判据共用调试驱动 stand-in）；`npm run typecheck` 退出 0；`npm run lint` 无 `: error `（写下 error 计数）。

## DoD

- 裸 goal-gate 命令在 anchor 继承 `RESIDENT_RUN_IS_TURN=1` 的真实环境下（不借 `scripts/test.sh`、不借 `env -u`）亲手跑出 `EXIT=0`、`tests 5 / pass 5 / fail 0`，并贴出原始命令行与计数。
- 负向控制真实做过：临时移除钉住块后同一环境下确定性变红，逐字失败行与恢复命令写在完成记录里；恢复后重跑绿。
- 四条读数（a）–（d）逐字记录，且与上一轮落地记录里的读数语义一致（(a) uuid = 驱动队列末条；(b) 两个不同 runId、两轮各一个终止帧；(c) `withdrawn`、不再成轮、pid 不变；(d) `already-started`）；没有一条断言被删除、放宽或替换成「存在某个 run」。
- 判据不构造 socket、不跑真 CLI；这次改动只影响进程环境，不引入新的外部依赖。
- 遵守 `$backend-module-standards`（这是 `server/` 下的判据文件：只加环境钉住块与必要 import，不导出无消费者符号）；ADR-007 暗轴无位移（理由是只钉住测试进程的环境变量，未改模块依赖图与服务实现）。

## 完成记录

实现提交：`de78a8ca9`（`test(debug-agent): pin RESIDENT_RUN_IS_TURN off in AC-238 criterion`），只改判据文件。工作树：`/data/home/yale/work/claudecodeui-worktrees/gap-ac238-debug-agent-control-queue-hermetic`。

### AC1 裸判据命令在继承宿主开关的环境下

```
RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/debug-agent/tests/debug-agent-control-queue.test.ts
```

⇒ `EXIT=0`，`tests 5 / pass 5 / fail 0`（`duration_ms 36067.991524`）。

五条读数（逐字）：

```
control-queue (a) first={"ok":true,"runId":"44f7beec-8f0e-41e7-be2d-78081c6197be","queued":false,"queuedMessageUuid":null} second={"ok":true,"runId":"fc68339b-545f-404e-ad31-cef259b4ee3e","queued":true,"queuedMessageUuid":"8aa1efa4-e1e0-49dc-b7b9-b43def0f8d0d"} queue=["8aa1efa4-e1e0-49dc-b7b9-b43def0f8d0d"]
control-queue (b) round1RunId=40e89de8-5274-4702-8795-fde3aee653bf round1Complete=true round2RunId=75938a19-53a4-4ff6-a084-1d9d419f1620 round2Source=unattended round2Text="second" round2Complete=true openedRounds=1
control-queue (c) verdict=withdrawn uuid=9e15a8cf-59bd-46f1-974f-a73fd3c4fa9d queueAfterCancel=[] queueHeld=false openedRounds=0 round1Complete=true pidBefore=null pidAfter=null
control-queue (d) uuid=0b2c5efc-c6c8-412f-9b78-c56bbac73deb queueAfterDequeue=[] queueHeld=false verdict=already-started openedRounds=1
control-queue (e) socketReferences=[]
```

### AC2 同一命令在开关未设时

```
env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/debug-agent/tests/debug-agent-control-queue.test.ts
```

⇒ `EXIT=0`，`tests 5 / pass 5 / fail 0`（`duration_ms 34866.235694`）。四条读数与 (e) 同语义：`(a)` 的 `queuedMessageUuid` 仍是驱动队列末条；`(b)` 两个不同 `runId`、两轮 `Complete=true`；`(c)` `verdict=withdrawn`、`openedRounds=0`；`(d)` `verdict=already-started`；`(e) socketReferences=[]`。

### AC3 负向控制（先提交 `de78a8ca9`，再 `git checkout d67638f63 -- <判据文件>` 移回未钉住版本，备份在 `/tmp/ac238-pinned-backup.test.ts`）

```
RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/debug-agent/tests/debug-agent-control-queue.test.ts
```

⇒ `EXIT=1`，`tests 5 / pass 1 / fail 4`。逐字失败行：

```
✖ (a) a busy resident send queues and hands over the driver queue tail (7264.709871ms)
  Error: probe child (queue) exited non-zero.
  Warning: Detected unsettled top-level await at /data/home/yale/work/claudecodeui-worktrees/gap-ac238-debug-agent-control-queue-hermetic/server/modules/debug-agent/tests/debug-agent-control-queue.test.ts:492
```

(b)/(c)/(d) 同形（`probe child (not-withdrawn|withdrawn|already-started) exited non-zero`），(e) 仍绿。恢复命令：`git checkout HEAD -- server/modules/debug-agent/tests/debug-agent-control-queue.test.ts`（`diff -q` 与备份一致），恢复后重跑 AC1 ⇒ `EXIT=0`、`tests 5 / pass 5 / fail 0`。

### AC4 读数与断言未被改动

`git diff develop...HEAD -- server/modules/debug-agent/tests/debug-agent-control-queue.test.ts` 只含 `import test, { after } from 'node:test'`、模块级保存/删除、`after` 恢复与说明注释（28 行变更：27 insertions / 1 deletion）；五个 `test(...)` 与全部 `assert*` 行逐字未动。AC1 运行仍逐字打印上面五条读数。

### AC5 恢复语义

临时打印（验证后已移除），以 `--test-name-pattern='(e)'` 加速触发 `after`：

- 进进程 `RESIDENT_RUN_IS_TURN=1`：`PIN incoming="1" inFile=undefined` → 退出前 `PIN restored="1"`，即 `进进程原值 "1" → 文件内值 undefined → 退出前恢复值 "1"`。
- 进进程未设：`PIN incoming=undefined inFile=undefined` → 退出前 `PIN restored=undefined`，即 `进进程原值 undefined → 文件内值 undefined → 退出前恢复值 undefined`。

### AC6 无实现改动

`git diff --stat develop...HEAD` 只列 `server/modules/debug-agent/tests/debug-agent-control-queue.test.ts` 与 `tasks/gap-ac238-debug-agent-control-queue-hermetic.md`；`git diff develop...HEAD -- server/ ':!server/modules/debug-agent/tests/debug-agent-control-queue.test.ts'` 无输出（0 行）。

### AC7 不回归

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/debug-agent/tests/debug-agent-host-driver.test.ts` ⇒ `EXIT=0`，`tests 5 / pass 5 / fail 0`（`duration_ms 20273.998553`）。
- `npm run typecheck` ⇒ `EXIT=0`（`tsc --noEmit` 三次全部通过）。
- `npm run lint` ⇒ `EXIT=0`，输出中 `: error ` 计数 = `0`。

ADR-007 暗轴记录：

该轴仍暗,理由:只钉住测试进程的环境变量，未改模块依赖图与服务实现。

## Touches

- server/modules/debug-agent/tests/debug-agent-control-queue.test.ts
- tasks/gap-ac238-debug-agent-control-queue-hermetic.md
