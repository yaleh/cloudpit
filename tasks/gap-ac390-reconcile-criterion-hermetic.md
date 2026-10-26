---
id: gap-ac390-reconcile-criterion-hermetic
title: AC-390 判据文件自钉 RESIDENT_RUN_IS_TURN 关态：裸 goal-gate 命令在 anchor 继承该开关时仍
  21/21 绿，(e1) 的 forwarded 行读数与取假形态不变
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-390
---
## Proposal

<!-- dedup-ref --> 机制去重（立案时实测，2026-10-26）：`grep -l '^goal_ac: *AC-390' tasks/*.md` 只命中 `tasks/gap-ac390-resident-reconcile-observability.md`（status `done`，即上一轮已落地的修复，按 gap 重立规则它不是重复）；扫 todo/ready/needs-human 任务的 Touches 里声明 `claude-resident-reconcile.test.ts` 的 ⇒ **0**。同机制（判据文件自己钉住所在世界的开关）的在飞任务只有 `gap-ac381-unattended-criterion-hermetic`（ready，另一 AC、另一文件，不合并）。粒度：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.23.0/scripts/dist/task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/providers/tests/claude-resident-reconcile.test.ts --json` → `peers: []`、`mentions: []` ⇒ **separate**。

### 本轮直接复测（不是账本尾巴）

AC-390 的判据命令（goal store 原文）：

```
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-reconcile.test.ts
```

在 `/data/home/yale/work/claudecodeui` 上当场跑：

- **裸命令**（本会话环境带 `RESIDENT_RUN_IS_TURN=1`，与 anchor 从 `~/.config/systemd/user/claudecodeui-server.service.d/40-resident-run-is-turn.conf` 继承的值一致）⇒ `EXIT=1`，`tests 21 / pass 20 / fail 1`。唯一红：`AC390 (e1) command_lifecycle forwarded carries session=`，逐字 `AssertionError [ERR_ASSERTION]: one frame, one line (read 0)` / `0 !== 1` / `claude-resident-reconcile.test.ts:1110:10`。
- **同一命令 `env -u RESIDENT_RUN_IS_TURN`** ⇒ `EXIT=0`，`tests 21 / pass 21 / fail 0`，`[readings] elapsed=3441ms budget=50000ms`。

⇒ 红/绿的唯一差别是宿主导出的 `RESIDENT_RUN_IS_TURN`，不是实现回归；(a)–(d)、(e2)、(f)、TURNC、BEAT 各腿在两种环境下读数一致。

### 机制（为什么开关一开 (e1) 就红）

`server/modules/websocket/services/chat-run-registry.service.ts:548`：当 `residentRunIsTurn()` 为真，`command_lifecycle` 帧走 SPEC §7.3 的过渡窗口——返回会话级帧（去掉 `runId`/`seq`），**不进入 run 的 event 缓冲、不写转发日志**（`lifecycleLog` 的调用在 :591-600，位于该早返回之后）。因此判据 (e1) 经注入 `lifecycleLog` 递一帧 `command_lifecycle` 时得到 `collected.length=0`。

判据文件从 (a) 到 (e2) 都按出厂默认（flag-off）写——文件内 `withRunIsTurn` 的注释自己写明「The rest of the file runs with the shipped default (off)」——但没有把这条默认钉进进程，于是它的绿依赖调用者环境里恰好没有这个变量。

### 为什么上一轮的修复没有撑住（必写）

1. 原任务 `gap-ac390-resident-reconcile-observability`（done，提交 `492fa26f5` 等）落地时判据绿，但那是在 `RESIDENT_RUN_IS_TURN` 未设置的 shell 里取得的；文件没有免疫宿主 env，所以它在 goal gate 的复验环境里从未稳定为绿。
2. `gap-test-runner-unsets-host-live-voice-and-s2-env`（done，提交 `cc9ad6fa9`）把同一泄漏的修复落在**运行器** `scripts/test.sh`（:82 `unset RESIDENT_RUN_IS_TURN …`），但 **goal gate 不走 test.sh**：它按 AC 的字面命令在 anchor 继承的环境里跑。
3. 后续 S2 落地的 run=turn 过渡窗口（AC-382 / AC-383）让 flag-on 下这条 forwarded 行**根本不再产生**，于是 (e1) 从「可能恰好绿」变成确定性红。
4. 本仓已有同形先例：`server/modules/providers/tests/claude-resident-busy-input.test.ts:108-116`、`server/modules/websocket/tests/chat-control-busy.test.ts:59-66` 都在模块顶层保存/删除/`after` 恢复该变量；在飞兄弟 `gap-ac381-unattended-criterion-hermetic` 对 AC-381 做同一件事。AC-390 这个文件缺的正是这一段。

### 要交付的修复（只改判据文件）

在 `server/modules/providers/tests/claude-resident-reconcile.test.ts` 的模块顶层（imports 之后、进程预算守卫与任何 driver 调用之前；`residentRunIsTurn()` 在调用时读环境，顶层钉住即可）：保存进进程时的 `process.env.RESIDENT_RUN_IS_TURN`，`delete` 它（出厂默认 = off，`residentRunIsTurn()` 只认字面 `'1'`），并在 `node:test` 的 `after` 钩子里恢复原值（原本未设则保持删除）；`import test, { after } from 'node:test'`。注释写清：本判据的 (a)–(e2) 腿测的是 flag-off 世界，flag-on 下 (e1) 的 forwarded 行由 SPEC §7.3 过渡窗口主动不产生；`scripts/test.sh` 的 `unset` 与这里的钉子说的是同一件事，goal gate 不经过 test.sh，所以文件必须自己钉住。不碰服务实现、不碰 AC 记录/criterion 命令、不碰 `scripts/test.sh`、不改任何 `test(...)` 标题或 `assert*`、不改任何 `console.log` 读数。

**拒绝的替代方案**：把 (e1) 改成开态语义（例如断言快照里的会话级帧）。那会改变 AC 期望文本的读数（AC (e) 要求 `command_lifecycle forwarded` 行含 `session=`），且开态行为已由 AC-382/383 的判据覆盖；本任务只恢复判据文件声明的那个世界。

**边界**：只改判据文件与任务文件自身。不新增测试文件（因此 `server/shared/tests/quay-test-script.test.ts` 的计数 pin 与 `scripts/suite-duration-baseline.tsv` 都不动）。

## AC

- [x] AC1 裸判据命令在「继承宿主开关」的环境下退出 0：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-reconcile.test.ts` ⇒ `EXIT=0`、`tests 21 / pass 21 / fail 0`；逐字抄命令行、退出码、计数，并抄 `AC390 (e1)` 打印的 `forwardedLines=1 line=[ChatRunRegistry] command_lifecycle forwarded uuid=… state=queued runId=… connections=… session=ac390-e1-registry-session`（按实际行逐字）。
- [x] AC2 同一命令在开关未设时也退出 0：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-reconcile.test.ts` ⇒ `EXIT=0`、`tests 21 / pass 21 / fail 0`，AC1 抄下的各腿读数逐字相同（尤其 `(a) reconcileLineCount=1 runsAfter=1 leasesAfter=1`、`(b) phantomRunOutcome=aborted reason=reconciled runsAfter=0`、`(c) longTurnClosed=false` 两模式、`(f)` 取假形态注入后的红与还原后的绿）。⇒ 判据不再依赖调用者环境。
- [x] AC3 钉子承重（负向控制）：用 `cp` 备份判据文件，把钉子那块（保存/`delete`/`after` 恢复 + 注释）临时移除，以 `RESIDENT_RUN_IS_TURN=1` 跑 AC1 的命令 ⇒ `EXIT=1`、`tests 21 / pass 20 / fail 1`，且逐字红行是 `AC390 (e1) command_lifecycle forwarded carries session=` 的 `one frame, one line (read 0)`（`0 !== 1`，落在那条 `assert.strictEqual(collected.length, 1, …)`）；恢复钉子后 AC1 重新 21/21。证明绿来自钉住的世界，不是把断言改松。
- [x] AC4 改动面最小且读数未变：`git diff develop...HEAD -- server/modules/providers/tests/claude-resident-reconcile.test.ts` 只含 env 钉住块（保存/`delete`/`after` 恢复 + 注释）与 `after` 的 import；全部 `test(...)` 标题、全部 `assert*` 调用、全部 `console.log` 行逐字不变；`git diff --name-only develop...HEAD` 只含该判据文件与 `tasks/gap-ac390-reconcile-criterion-hermetic.md`。
- [x] AC5 恢复语义：`after` 钩子把 `RESIDENT_RUN_IS_TURN` 恢复为进进程时的原值（原本未设则删除）。完成记录写下「进进程原值 → 文件内值 → 退出前恢复值」三项读数（临时打印或同进程小探针证明；临时打印若留在判据里不得影响 AC4 的逐字断言与 AC1 的退出码）。

## DoD

真实落地判据（不是「测试存在」）：在交付的树上用 goal gate 的字面命令、在**继承宿主 `RESIDENT_RUN_IS_TURN=1` 的环境里**跑 `server/modules/providers/tests/claude-resident-reconcile.test.ts` ⇒ 退出 0、21/21，且 (e1) 打印 `forwardedLines=1` 的完整行含 `session=`；(a) log 模式只记不改、(b) enforce 关闭幽灵 run、(c) 真实长 turn 两模式都不关、(d) 四个异常码各一行、(e2) `[ledger]`/`[turn]` 计数、(f) 取假形态仍可复现——全部读数与开态环境无关。临时移除钉子 ⇒ 同一条命令在 `RESIDENT_RUN_IS_TURN=1` 下按 (e1) 确定性红，还原后恢复 21/21。全程不启真实 `claude` 二进制、不重启服务；`git diff` 只含判据文件的 env 钉住块与注释（外加本任务文件），没有服务实现、运行器、AC 记录或断言改动。

## ADR-007 轴记录

- 该轴仍暗,理由:本任务只改判据文件的 env 钉住块（保存/delete/after 恢复）与一行 import，不新增或移动模块、目录或依赖边，无架构轴读数。

## 完成记录

- AC1：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-reconcile.test.ts` ⇒ `EXIT=0`、`tests 21 / pass 21 / fail 0`；`forwardedLines=1 line=[ChatRunRegistry] command_lifecycle forwarded uuid=e1-command state=queued runId=8f98fcd6-8657-4076-82a8-34c91e996592 connections=0 session=ac390-e1-registry-session`。
- AC2：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-reconcile.test.ts` ⇒ `EXIT=0`、`tests 21 / pass 21 / fail 0`；`(a) reconcileLineCount=1 reconcileSinkLineCount=1 readingMode=log readingAnomaly=phantom-run …`、`(b) runsBefore=1 runsAfter=0 phantomRunOutcome=aborted reason=reconciled closes=1 reconcileLineCount=1 …`、`(c) longTurnClosed=false` 两模式（`mode=enforce` / `mode=log`，`turnOpen=true leasesAtOpen=1 phantomLines=0`）、`(f)` 取假形态（beat 关闭时 `disabled beatTicks=0 logLines=0 runsAfter=1`，启用后 `logLines=1`）可复现；与 AC1 各腿逐字一致（仅随机 uuid 与耗时不同）。
- AC3：`cp` 备份后用 Edit 移除钉子块，同一命令在 `RESIDENT_RUN_IS_TURN=1` 下 ⇒ `EXIT=1`、`tests 21 / pass 20 / fail 1`；唯一红为 `✖ AC390 (e1) command_lifecycle forwarded carries session=`，`forwardedLines=0 line=`，`AssertionError [ERR_ASSERTION]: one frame, one line (read 0)` / `0 !== 1`，落在 `claude-resident-reconcile.test.ts:1110:10`。从备份还原后同一命令重新 `EXIT=0`、21/21。
- AC4：`git diff --name-only develop...HEAD` 只有 `server/modules/providers/tests/claude-resident-reconcile.test.ts`；对 `test(` / `assert.` / `console.log` 的增删行 grep 为零命中。任务文件由 task_write 自身提交送达（不在 worktree 分支 diff 中）。
- AC5：临时 `[pin-probe]` 打印读数——进进程原值 `1` → 文件内值 `undefined`（已删除）→ 退出前恢复值 `1`；进进程原值未设时 `undefined` → `undefined` → `undefined`（保持删除）。探针取数后已移除，最终 diff 不含该打印。

## Touches

- `server/modules/providers/tests/claude-resident-reconcile.test.ts` （判据文件：模块顶层保存/删除/after 恢复 RESIDENT_RUN_IS_TURN，钉住 flag-off 世界；不改编排与断言）
- `tasks/gap-ac390-reconcile-criterion-hermetic.md` （自触）
