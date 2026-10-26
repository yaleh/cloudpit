---
id: gap-ac339-mcp-session-lifecycle-hermetic
title: AC-339 网关兼容腿（mcp-session-lifecycle）判据文件未自钉 RESIDENT_RUN_IS_TURN 关态：anchor
  继承开关时 (a)/(d) 红，AC-339 (c) 项无法成立
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-339
---
## Proposal

<!-- dedup-ref --> 机制去重（立案时实测，2026-10-26）：`grep -lE '^goal_ac: *AC-339' tasks/*.md` 只命中 `tasks/gap-live-voice-interrupt-audit-intent-trigger.md`（status `done`，按 gap 重立规则它不是重复，而是上一轮修复没撑住的证据）；`grep -lF "mcp-session-lifecycle.test.ts" tasks/*.md | xargs grep -lE '^status: (todo|ready|needs-human)$'` 0 命中，`grep -lF "RESIDENT_RUN_IS_TURN" tasks/*.md | xargs grep -lE '^status: (todo|ready|needs-human)$'` 0 命中。同机制的兄弟任务 `gap-ac238-debug-agent-control-queue-hermetic`（done）修的是 `server/modules/debug-agent/tests/debug-agent-control-queue.test.ts`，`gap-ac231-resident-run-flag-hermetic`（done）修的是 `server/modules/websocket/tests/chat-control-busy.test.ts`，两者与本任务无文件重叠、验收独立 ⇒ **separate**。粒度工具 `task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts --json` ⇒ `peers: []`、`mentions: []`。

### 本轮直接复测（不是账本尾巴）

AC-339 的判据命令（goal store 原文）：

```
f=server/modules/voice-realtime/tests/voice-realtime-interrupt-audit.test.ts; [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; npx tsx --tsconfig server/tsconfig.json --test "$f" server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts
```

在 `/data/home/yale/work/claudecodeui` 上当场实跑：

- 判据的前一条腿 `voice-realtime-interrupt-audit.test.ts` 绿：`tests 4 / pass 4 / fail 0`，DoD 的 journal 行照常写出。
- 后一条腿 `mcp-session-lifecycle.test.ts` 在本会话环境（`env | grep` 逐字读数 `RESIDENT_RUN_IS_TURN=1`）下红：`EXIT=1`，`tests 15 / pass 13 / fail 2`。两条失败逐字为：
  - `(a) session_create with a message returns the live runId; without one it starts nothing` → `AssertionError: the returned runId must be the registry current run verbatim`，`actual: 'null'` / `expected: 'c4d16721-…'`（`mcp-session-lifecycle.test.ts:717`）。
  - `(d) session_interrupt aborts the running resident turn and leaves the host pid unchanged` → `AssertionError: the run registry must record the aborted terminal state`，`actual: 'unknown'` / `expected: 'aborted'`（`mcp-session-lifecycle.test.ts:862`）。
- 同一命令加 `env -u RESIDENT_RUN_IS_TURN` ⇒ `EXIT=0`、`tests 15 / pass 15 / fail 0`（约 32s）。⇒ 红/绿的唯一差别是继承来的 `RESIDENT_RUN_IS_TURN`，不是产品实现回归。

### 为什么绿不了：判据文件没有自述它所在的世界

- AC-385（`gap-ac385-send-deliveryid-runid-compat-window`，done，提交 `5ec056496`）改了 resident 的 `send` 回答形状：`server/modules/websocket/services/chat-control.service.ts` 在 `residentRunIsTurn()` 为真且会话 resident 时，先快照 `readSessionDeliveries(sessionId)`，dispatch 后轮询直到出现一条**新** delivery（上限 `DELIVERY_ID_HANDOVER_TIMEOUT_MS = 2000`）。`runId` 改为：绑定到 turn ⇒ 该 turn 的 run id；未绑定但兼容窗口内 ⇒ 回填 `deliveryId`；窗口外 ⇒ `null`（`server/shared/types.ts` 的 `RUN_ID_COMPAT_WINDOW_END_MS` 是 2027-01-15，今天仍在窗口内）。`residentRunIsTurn()`（`server/shared/utils.ts:76-77`）在**调用时**读 `process.env.RESIDENT_RUN_IS_TURN === '1'`。
- 本判据的 resident 会话走调试 agent 的 host driver。调试 agent **只在 busy push 时**写 delivery 账本（`debug-agent.provider.ts` 的 `recordQueuedDelivery`，调用点约 :684），**首轮 turn 的 send 不写 delivery**；它也不 `registerTurnRun`。于是 flag-on 下首轮 `send` 等一条永远不出现的 delivery，2s 后 `deliveryId` 为 `null`，`runId` 落到 `deliveryId`（窗口内）也是 `null`。
- 两个失败同源：`(a)` 的 `String(payload.runId)` 得到字符串 `'null'`，不等于 `chatRunRegistry.getRun(sessionId)?.runId`；`(d)` 把同一个 `'null'` 传给 `chatRunRegistry.getRunById('null')`，命中 `{ status: 'unknown', reason: 'unknown' }`（`chat-run-registry.service.ts:806-810`），于是读出 `statusAfter='unknown'`。abort 本身已经成功——失败点只在用 runId 回读 registry 的那条断言。

### 为什么上一轮的修复没有撑住（必写）

1. 原始 AC-339 任务（`gap-live-voice-interrupt-audit-intent-trigger`，done）落地时 `mcp-session-lifecycle.test.ts` 是绿的，但那次绿是在 `RESIDENT_RUN_IS_TURN` 不存在/为关的环境里取得的；判据文件本身从未把「flag-off 世界」钉住，只是恰好继承了干净环境。
2. AC-385 把 resident send 改成 delivery 形状后，没有同步这个兄弟判据；它的 flag-on 世界由自己的 `mcp-session-send-delivery.test.ts`（文件内 `process.env.RESIDENT_RUN_IS_TURN = '1'`）覆盖，而 `mcp-session-lifecycle.test.ts` 仍是一份未声明世界的 flag-off 判据。
3. `scripts/test.sh` 的 `unset RESIDENT_RUN_IS_TURN` 只保护走 test.sh 的运行；**goal gate 不走 test.sh**，它按 AC 字面命令在 anchor 继承的环境里跑（anchor 从 `claudecodeui-server.service` 的 `40-resident-run-is-turn.conf` 继承 `RESIDENT_RUN_IS_TURN=1`）⇒ 泄漏在复验环上把 AC-339 判红。
4. 同机制的兄弟判据已经在文件内自钉（AC-238 的 `debug-agent-control-queue.test.ts`、AC-231 的 `chat-control-busy.test.ts`、AC-385 的 `mcp-session-send-delivery.test.ts`）；本文件缺的正是这行「声明自己的世界」。

### 要交付的修复（只改判据文件）

在 `server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` 的环境设置块（`mkdirSync(FIXTURE_HOME, …)` 之后、任何 aliased 模块被动态 import 之前）保存进进程时的 `process.env.RESIDENT_RUN_IS_TURN`，`delete process.env.RESIDENT_RUN_IS_TURN`（出厂默认关；`residentRunIsTurn()` 只认 `'1'`），并在已有的 `after(() => …)` 钩子（该文件第 1238 行，`after` 已 import）里恢复原值（原本未设则保持删除）。注释写清：这就是 `scripts/test.sh` 的 `unset RESIDENT_RUN_IS_TURN` 与 AC-385 判据「this criterion's world」的同一件事；goal gate 不经过 test.sh，所以文件必须自己钉住。

本轮的可行性验证（临时补丁，已 `git checkout --` 回滚）：上述模块级保存/删除补丁在**环境仍带 `RESIDENT_RUN_IS_TURN=1`** 时跑该文件 ⇒ `EXIT=0`、`tests 15 / pass 15 / fail 0`。

**拒绝的替代方案**：给调试 agent 的首轮 send 补 `recordQueuedDelivery` / `registerTurnRun`，或改 `chat-control.service.ts` 的 delivery 形状。前者是把判据推进 AC-385 的 S2 语义（flag-on 下 `send().runId` 是 nullable、busy send 复用当前 run），后者的 flag-on 世界已由 AC-385 自己的判据覆盖；两者都会让本判据失去它原本要读的 flag-off 世界，且属于产品/兄弟判据范围蔓延。

**边界**：只改判据文件与任务文件自身。不做 `scripts/test.sh` 级修复（已存在）、不改 goal store 的 criterion 文本、不碰 `chat-control.service.ts` / `debug-agent.provider.ts` / `chat-run-registry.service.ts`、不放宽或删除任何 `assert*`、不把 (a)/(d) 改写成「只要有某个 run 就算过」。不跳过失败腿。

## Plan

1. 在判据文件的环境块加「保存 → delete」钉住块（放在动态 import 之前）。
2. 在既有 `after` 钩子里恢复进进程原值（原本未设则保持 delete）。
3. 用 AC-339 的逐字判据命令在继承 `RESIDENT_RUN_IS_TURN=1` 的环境下跑，两个文件都绿。
4. 负向控制：先提交，再临时移除钉住块，同一环境下确定性变红于 (a)/(d) 两条原文；恢复后复绿。
5. `npm run typecheck` / `npm run lint` / 相邻 voice-realtime 判据回归。
6. 完成记录写进本任务 `## Notes`。

## AC

- [ ] AC1（AC 尾部直接翻绿）：在**继承 `RESIDENT_RUN_IS_TURN=1`** 的环境下跑 AC-339 的逐字命令 `npx tsx --tsconfig server/tsconfig.json --test server/modules/voice-realtime/tests/voice-realtime-interrupt-audit.test.ts server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` ⇒ `EXIT=0`；逐字抄退出码与每文件计数（预期 audit 4/4、lifecycle 15/15，总 fail 0）。不得经 `scripts/test.sh`，不得用 `env -u`。
- [ ] AC2（关态同读数）：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` ⇒ `EXIT=0`、`tests 15 / pass 15 / fail 0`。两种宿主环境同一读数。
- [ ] AC3（钉子承重，负向控制）：先提交实现，再临时移除钉住块（备份或存 `git diff` 补丁），以 `RESIDENT_RUN_IS_TURN=1` 跑 lifecycle 单文件 ⇒ `EXIT=1`，且逐字失败行是 `✖ (a) session_create with a message returns the live runId; without one it starts nothing` + `the returned runId must be the registry current run verbatim`（actual `'null'`）与 `✖ (d) session_interrupt aborts the running resident turn and leaves the host pid unchanged` + `the run registry must record the aborted terminal state`（actual `'unknown'`）；恢复钉子后 AC1 重新绿。证明绿来自钉住的世界，不是把断言改松。
- [ ] AC4（断言与读数未被改动）：`git diff develop...HEAD -- server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` 只含 env 钉住块与 `after` 恢复（以及必要注释），十五个 `test(...)` 与全部 `assert*` 行逐字不变；AC1 运行里 `(a) … registry.current=…`、`(d) pidBefore=… statusBefore=… statusAfter=aborted …` 等 `say(...)` 读数照常打印并逐字抄进完成记录。
- [ ] AC5（恢复语义）：`after` 钩子把 `RESIDENT_RUN_IS_TURN` 恢复为进进程时的原值。完成记录写下「进进程原值 → 文件内值 → 退出前恢复值」三项读数，分别对 `RESIDENT_RUN_IS_TURN=1` 与未设两种调用各取一次（临时打印验证后可移除）。
- [ ] AC6（无实现改动）：`git diff --stat develop...HEAD` 只列 `server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts` 与 `tasks/gap-ac339-mcp-session-lifecycle-hermetic.md`；`git diff develop...HEAD -- server/ ':!server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts'` 无输出。
- [ ] AC7（不回归）：`npx tsx --tsconfig server/tsconfig.json --test server/modules/voice-realtime/tests/voice-realtime-interrupt-audit.test.ts` ⇒ `EXIT=0`、4/4；`npm run typecheck` 退出 0；`npm run lint` 输出中 `: error ` 计数 = 0。

## DoD

- 裸 goal-gate 判据命令（两文件）在 anchor 继承 `RESIDENT_RUN_IS_TURN=1` 的真实环境下（不借 `scripts/test.sh`、不借 `env -u`）亲手跑出 `EXIT=0`、lifecycle 15/15 与 audit 4/4，并贴出原始命令行与计数。
- 负向控制真实做过：临时移除钉住块后同一环境下确定性变红，逐字失败行与恢复命令写在完成记录里；恢复后重跑绿。
- `(a)`/`(d)` 的读数逐字记录，且语义与 AC-250 原判据一致（(a) 返回的 runId 就是 registry 当前 run、source=mcp、`listRunningRuns` 含该会话；(d) `statusAfter=aborted`、pid 不变、host 仍 live、abort 恰好 1 次）；没有一条断言被删除、放宽或替换成「存在某个 run」。
- 判据不构造云端调用、不跑真 CLI；这次改动只影响测试进程的环境变量，不引入新的外部依赖或新测试文件。
- 遵守 `$backend-module-standards`（这是 `server/` 下的判据文件：只加环境钉住块，不导出无消费者符号）；ADR-007 暗轴无位移（理由是只钉住测试进程的环境变量，未改模块依赖图与服务实现）。

## Touches

- server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts
- tasks/gap-ac339-mcp-session-lifecycle-hermetic.md
