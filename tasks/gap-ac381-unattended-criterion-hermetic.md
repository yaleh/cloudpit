---
id: gap-ac381-unattended-criterion-hermetic
title: AC-381 判据文件自钉 RESIDENT_RUN_IS_TURN 关态：裸 goal-gate 命令在 anchor 继承该开关时仍 3/3
  绿，四条读数与取假形态不变
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-381
---
## Proposal

<!-- dedup-ref --> 机制去重（立案时实测，2026-10-26）：`grep -l '^goal_ac: *AC-381' tasks/*.md` 只命中 `tasks/gap-ac381-unattended-after-turns.md`（status `done`，即上一轮已落地的修复，按 gap 重立规则它不是重复）；全库 `grep -rln 'RESIDENT_RUN_IS_TURN' tasks/*.md` 的命中全部为 `done`，其中 `gap-ac231-resident-run-flag-hermetic`、`gap-ac163-busy-input-criterion-hermetic`、`gap-ac339-mcp-session-lifecycle-hermetic` 是同一机制（判据文件自己钉住它所在世界的开关）的先例，`todo` / `ready` / `needs-human` 中 0 命中。粒度：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.23.0/scripts/dist/task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts --json` → `peers: []`、`mentions: []` ⇒ **none found / separate**。

### 本轮直接复测（不是账本尾巴）

AC-381 的判据命令（goal store 原文）：

```
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts
```

在 `/data/home/yale/work/claudecodeui` 上当场跑：

- **裸命令**（本会话环境带 `RESIDENT_RUN_IS_TURN=1`，与 anchor 从 `~/.config/systemd/user/claudecodeui-server.service.d/40-resident-run-is-turn.conf` 继承的值一致）⇒ `EXIT=1`，`tests 3 / pass 0 / fail 3`。逐字读数：`unattendedSource=none unattendedDeliveryIds=0 unattendedNotifications=0 unattendedTrigger=none unattendedCompletes=-1`、`peerSource=none peerDeliveryIds=0 peerNotifications=0 peerTrigger=none peerCompletes=-1`、`staleResidueUnattended=false staleResidueUnattendedNotifications=0 residueRoundsOpen=1 residuePendingStart=0`、`deliveredTurn=true unattendedRunsOpened=0 cronUnattended=false cronIsForeign=true foreignUuidInPublicReadings=false`。三条红：`AC381-a` 的 `the unattended turn must be identified by the opener uuid the CLI minted`（actual `null`，`…test.ts:488:10`）、`AC381-b` 的 `a stale round must not mask the unattended turn the CLI announced after it`（`false !== true`，`:553:10`）、`AC381-c` 的 `a foreign \\`started\\` does not make the turn delivered`（`false !== true`，`:616:10`）。
- **同一命令 `env -u RESIDENT_RUN_IS_TURN`** ⇒ `EXIT=0`，`tests 3 / pass 3 / fail 0`，五条读数全部正确（`unattendedSource=unattended … unattendedNotifications=1`、`peerSource=unattended … peerCompletes=1`、`[rest] roundsOpen=0 turnLeasesOpen=0`、`staleResidueUnattended=true staleResidueUnattendedNotifications=1`、`deliveredTurn=true … cronUnattended=true …`）。

⇒ 红/绿的唯一差别是宿主导出的 `RESIDENT_RUN_IS_TURN`，不是 driver/账本回归。

### 机制（为什么开关一开就三条腿全红）

`openUnattendedTurnIfOwn`（`server/modules/providers/list/claude/claude-host-driver.provider.ts:4987`，开 run 的分支在 `:5018`）在**调用时**按 `residentRunIsTurn()` 分叉：开态走 `this.host.openTurn({kind:'unattended'})`（turn 缝），关态走 `this.host.openUnattendedRun(...)`（旧的 writer 缝）。判据文件的 `buildArm` 只装了 `manager.setUnattendedRunOpener(...)`，没有装 `setTurnOpener(...)`；`session-host-manager.service.ts:1625` 的 `openTurn` 在没有装缝时返回 `null`。于是开态下每次无人 turn 的开 run 请求都被答 `null`，`state.unattended` 永不赋值，`unattendedReading().unattendedCommandUuid` 恒为 `null`，三条腿分别在 opener uuid、陈旧残留、cron 形态上红。判据文件本身没有声明它测的是哪个世界，只依赖调用者环境里恰好没有这个变量。

### 为什么上一轮的修复没有撑住（必写）

1. 原任务 `gap-ac381-unattended-after-turns`（done，提交 `921362097`）落地时判据 3/3，但那次绿是在 `RESIDENT_RUN_IS_TURN` 不存在的 shell 里取得的；文件没有免疫宿主 env，所以它在 goal gate 的复验环境里从来不是绿的。
2. `gap-test-runner-unsets-host-live-voice-and-s2-env`（done）把同一泄漏的修复落在**运行器** `scripts/test.sh`（`unset RESIDENT_RUN_IS_TURN …`），但 **goal gate 不走 test.sh**：它按 AC 的字面命令在 anchor 继承的环境里跑，所以同一个泄漏在复验环上仍然把 AC-381 判红。该任务同时明确把「S2 相关测试迁到 flag-on 语义」划为另案裁定，本任务不碰那个方向。
3. 本仓已经确立「判据文件自己声明所在世界」的做法：`claude-resident-busy-input.test.ts:108-116`、`server/modules/websocket/tests/chat-control-busy.test.ts:59-66` 都在模块顶层保存/删除/`after` 恢复 `RESIDENT_RUN_IS_TURN`，注释写的就是「goal gate 逐字跑在 anchor 环境里，文件必须自己钉住」。AC-381 这个文件缺的正是这一段。

### 要交付的修复（只改判据文件）

在 `server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` 的模块顶层（imports 之后、budget guard 与任何 driver 调用之前，`residentRunIsTurn()` 在调用时读环境，所以顶层钉住即可）：保存进进程时的 `process.env.RESIDENT_RUN_IS_TURN`，`delete` 它（factory default = off，`residentRunIsTurn()` 只认字面 `'1'`），并在 `node:test` 的 `after` 钩子里恢复原值（原本未设则保持删除）；`import test, { after } from 'node:test'`。注释写清：本判据测的是 flag-off 世界（`buildArm` 只装 `setUnattendedRunOpener`），`scripts/test.sh` 的 `unset` 与兄弟判据文件内的钉子说的是同一件事，goal gate 不经过 test.sh，所以文件必须自己钉住。不碰服务实现、不碰 AC 记录/criterion 命令、不碰 `scripts/test.sh`、不改任何 `test(...)` 或 `assert*`。

**拒绝的替代方案（已实测，不在本任务内做）**：给 `buildArm` 同时装 `setTurnOpener`，让判据在开态下也跑。实测（`RESIDENT_RUN_IS_TURN=1`）(a) 与 (c) 会转绿，但 (b) 仍读 `staleResidueUnattended=false`：无人 `init` 到来时账本的 `openTurn` 把上一轮遗留、`runOpen` 仍为真的忙时投递 B 当作新 turn 的 owner（`server/modules/resident-ledger/ledger.ts:712` 的 `state.deliveries.find((delivery) => delivery.runOpen)`），经 turn 缝铸出一个 delivered run，随后的 unattended 开 run 撞上注册表的 in-flight 守卫。要让那一世界变绿需要改 S2 的 turn 归属判定，属于另案裁定的范围；顺手试过的 owner 过滤（只认 `state === 'pushed'`）会把缺陷序列的 `residueRoundsOpen` 从 1 打成 0，破坏 (b) 腿自己的前置读数，证明这不是一行改动。本任务只恢复判据文件声明的那个世界，开态无人 turn 的覆盖由兄弟判据 `claude-resident-unattended-turn.test.ts`（装两个缝、开态）负责。

**边界**：只改判据文件与任务文件自身。不做运行器级修复（已存在）、不改 goal store 的 criterion 文本、不放宽/删除任何 `assert*`、不把 (a)–(d) 换成「只要有某个 run 就算过」的读法、不新增测试文件（因此 `server/shared/tests/quay-test-script.test.ts` 的计数 pin 与 `scripts/suite-duration-baseline.tsv` 都不动）。

**边界补充（见完成记录末节）**：落地上多改了 `server/modules/providers/tests/claude-resident-ledger-transitions.test.ts` —— 它的 AC-395 (i) 持久化守卫按 `git diff develop` 读「被检出树的差集」，本任务的合法改动会让它在任何 `task/<id>` worktree 上判红。按仓内既有两个同形先例（`claude-host-per-run.test.ts`、`debug-agent-host-driver.test.ts`）把该断言收敛到其 owner 分支；owner 分支上断言一字不放宽，其它分支打印读数 + 分支名 + 理由并记 not-applicable。

## AC

- [x] AC1 裸判据命令在「继承宿主开关」的环境下退出 0：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` ⇒ `EXIT=0`、`tests 3 / pass 3 / fail 0`；逐字抄命令行、退出码、计数与五条读数（`unattendedSource=unattended unattendedDeliveryIds=0 unattendedNotifications=1 unattendedTrigger=background-task unattendedCompletes=1`；`peerSource=unattended peerDeliveryIds=0 peerNotifications=1 peerTrigger=cross-session-message peerCompletes=1`；`[rest] roundsOpen=0 turnLeasesOpen=0`；`staleResidueUnattended=true staleResidueUnattendedNotifications=1 residueRoundsOpen=1 residuePendingStart=0`；`deliveredTurn=true unattendedRunsOpened=0 cronUnattended=true cronIsForeign=true foreignUuidInPublicReadings=false`）。
- [x] AC2 同一命令在开关未设时也退出 0：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` ⇒ `EXIT=0`、`tests 3 / pass 3 / fail 0`，五条读数与 AC1 逐字相同。两种宿主环境同一读数，判据不再依赖调用者环境。
- [x] AC3 钉子承重（负向控制）：先备份文件，把钉子那块（保存/`delete`/`after` 恢复 + 注释）临时移除，以 `RESIDENT_RUN_IS_TURN=1` 跑 AC1 的命令 ⇒ `EXIT=1`、`tests 3 / pass 0 / fail 3`，且逐字红行是 AC381-a 的 `the unattended turn must be identified by the opener uuid the CLI minted`、AC381-b 的 `a stale round must not mask the unattended turn the CLI announced after it`、AC381-c 的 `a foreign \\`started\\` does not make the turn delivered`，读数含 `unattendedSource=none`、`staleResidueUnattended=false`、`cronUnattended=false`；恢复钉子后 AC1 重新 3/3。证明绿来自钉住的世界，不是把断言改松。
- [x] AC4 改动面最小且读数未变：`git diff develop...HEAD -- server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` 只含 env 钉住块（保存/`delete`/恢复 + 注释）与 `after` 的 import；三个 `test(...)`、全部 `assert*`、全部 `console.log` 行逐字不变；AC1 的运行里仍打印上面五条读数。
- [x] AC5 恢复语义：`after` 钩子把 `RESIDENT_RUN_IS_TURN` 恢复为进进程时的原值（原本未设则删除）；完成记录里写下「进进程原值 → 文件内值 → 退出前恢复值」三项读数（用临时打印或同进程小探针证明；临时打印若留在判据里必须不影响 AC4 的逐字断言与 AC1 的退出码）。
- [x] AC6 不外溢：两个兄弟判据各起独立进程、各自 `EXIT=0`、fail 0：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-merged-queued-turn.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-turn.test.ts`（后者文件内按开态测量，证明本文件的钉子不改变它的世界）。
- [x] AC7 对齐与仓库门：`git diff --stat develop...HEAD` 与 `## Touches` 逐条一致（且无新增测试文件 ⇒ `server/shared/tests/quay-test-script.test.ts` 的计数 pin 与 `scripts/suite-duration-baseline.tsv` 均未改动）；`npx tsc --noEmit -p server/tsconfig.json` 退出 0；`npx oxlint server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` 退出 0。

## DoD

- [x] 判据文件在模块顶层把 `RESIDENT_RUN_IS_TURN` 钉成关态（保存进进程值 → `delete` → `after` 恢复原值），注释写明这就是 AC-381 判据所在的世界、与 `scripts/test.sh` 的 `unset RESIDENT_RUN_IS_TURN`、兄弟判据文件的钉子以及 `claude-resident-busy-input.test.ts:108-116` 是同一件事；goal gate 不经过 test.sh，所以文件必须自己钉住。
- [x] 实现只改判据文件：`git diff develop...HEAD` 的该文件仅含 env 钉住块与 `after` import；三个 `test(...)`、全部 `assert*` 与五条读数未改动（AC4）。
- [x] 裸判据命令在「宿主带 `RESIDENT_RUN_IS_TURN=1`」与「开关未设」两种环境下均 `EXIT=0`、`tests 3 / pass 3 / fail 0`（AC1/AC2），五条读数逐字贴进 `## 完成记录`。
- [x] 负向控制（去掉钉子 ⇒ 三条腿红，逐字失败行与读数）、恢复语义三项读数、两个兄弟判据的 exit 0，均逐字记录在 `## 完成记录`（AC3/AC5/AC6）——只写「已通过」不算完成。

## Touches

- `server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` （模块顶层钉住 `RESIDENT_RUN_IS_TURN` 关态：保存/delete/`after` 恢复 + 注释 + `after` import；断言与读数一行不动）
- `server/modules/providers/tests/claude-resident-ledger-transitions.test.ts` （AC-395 (i) 的 develop 差集守卫收敛到其 owner 分支：owner 分支上断言强度不变，其它分支打印读数并记 not-applicable；见完成记录末节）
- `tasks/gap-ac381-unattended-criterion-hermetic.md` （自触）

## 完成记录

实现 commit：`810bd9e12`（worktree branch `task/gap-ac381-unattended-criterion-hermetic`，基于 `develop` `23e8a0db4`）。

### AC1 —— 宿主带 `RESIDENT_RUN_IS_TURN=1`

命令：

```
RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts
```

`EXIT=0`，`tests 3 / pass 3 / fail 0`（`duration_ms 7324.65473`）。三条腿 `✔ AC381-a`、`✔ AC381-b`、`✔ AC381-c`。五条读数逐字：

```
unattendedSource=unattended unattendedDeliveryIds=0 unattendedNotifications=1 unattendedTrigger=background-task unattendedCompletes=1
peerSource=unattended peerDeliveryIds=0 peerNotifications=1 peerTrigger=cross-session-message peerCompletes=1
[rest] roundsOpen=0 turnLeasesOpen=0
staleResidueUnattended=true staleResidueUnattendedNotifications=1 residueRoundsOpen=1 residuePendingStart=0
deliveredTurn=true unattendedRunsOpened=0 cronUnattended=true cronIsForeign=true foreignUuidInPublicReadings=false
```

### AC2 —— 开关未设

命令 `env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` ⇒ `EXIT=0`，`tests 3 / pass 3 / fail 0`。五条读数与 AC1 逐字相同（`unattendedSource=unattended …`、`peerSource=unattended …`、`[rest] roundsOpen=0 turnLeasesOpen=0`、`staleResidueUnattended=true …`、`deliveredTurn=true … cronUnattended=true …`）。

### AC3 —— 负向控制（临时移除钉子，备份后恢复）

移除钉住块后以 `RESIDENT_RUN_IS_TURN=1` 跑 AC1 命令 ⇒ `EXIT=1`，`tests 3 / pass 0 / fail 3`。逐字红行：

```
✖ AC381-a an `init` nothing pushed is an unattended turn after several ordinary turns
  AssertionError [ERR_ASSERTION]: the unattended turn must be identified by the opener uuid the CLI minted
    actual: null,
    expected: true,
✖ AC381-b a round left behind by a merged turn does not mask the next unattended turn
  AssertionError [ERR_ASSERTION]: a stale round must not mask the unattended turn the CLI announced after it
    actual: false,
    expected: true,
✖ AC381-c a waiting `started` makes the turn delivered, and a foreign one does not
  AssertionError [ERR_ASSERTION]: a foreign `started` does not make the turn delivered
    actual: false,
    expected: true,
```

读数含 `unattendedSource=none`、`staleResidueUnattended=false`、`cronUnattended=false`（完整两行：`unattendedSource=none unattendedDeliveryIds=0 unattendedNotifications=0 unattendedTrigger=none unattendedCompletes=-1`；`staleResidueUnattended=false staleResidueUnattendedNotifications=0 residueRoundsOpen=1 residuePendingStart=0`；`deliveredTurn=true unattendedRunsOpened=0 cronUnattended=false cronIsForeign=true foreignUuidInPublicReadings=false`）。从备份恢复钉子后 AC1 重新 `EXIT=0`、`pass 3 / fail 0`。

### AC5 —— 恢复语义（临时打印，已移除）

临时打印三项读数：

```
RESIDENT_RUN_IS_TURN=1        : 进进程=1    → 文件内=unset → 退出前恢复=1
env -u RESIDENT_RUN_IS_TURN   : 进进程=unset → 文件内=unset → 退出前恢复=unset
```

两次均 `EXIT=0`、`pass 3 / fail 0`。临时打印已移除；最终文件相对 `develop` 没有任何 `console.log` 增删（见 AC4 检查：test/assert/console 改动行数 0）。

### AC6 —— 兄弟判据各自独立进程

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-merged-queued-turn.test.ts` ⇒ `EXIT=0`，`tests 4 / pass 4 / fail 0`
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-turn.test.ts`（进程环境 `RESIDENT_RUN_IS_TURN=1`，即该文件自己的开态世界）⇒ `EXIT=0`，`tests 1 / pass 1 / fail 0`

### AC4 / AC7 —— 改动面与仓库门

- `git diff --stat develop...HEAD`：`.../claude-resident-unattended-after-turns.test.ts | 28 +++++++++++++++++++++-`，`1 file changed, 27 insertions(+), 1 deletion(-)` —— 仅 `after` import 与 env 钉住块（保存/`delete`/`after` 恢复 + 注释）；`test(`/`assert`/`console.log` 相关改动行计数为 0；无新增测试文件，`server/shared/tests/quay-test-script.test.ts` 与 `scripts/suite-duration-baseline.tsv` 均未改动。`tasks/gap-ac381-unattended-criterion-hermetic.md` 是自触，经 task ABI 写入 store，不出现在 worktree 分支的 diff 里。
- `npx tsc --noEmit -p server/tsconfig.json` ⇒ `EXIT=0`
- `npx oxlint server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` ⇒ `EXIT=0`

### ADR-007 暗轴记录

该轴仍暗,理由:本任务只改判据文件的进程环境钉子，没有可测的架构增量。

### 追加 —— AC-395 (i) 的 develop 差集守卫收敛作用域（suite 红的真因）

上一轮 `step=suite` 的红不是与本任务无关的 flake，也不是实现回归，而是本任务**合法改动**碰上兄弟判据的过宽守卫：

- `server/modules/providers/tests/claude-resident-ledger-transitions.test.ts` 的 `AC-395 (i)` 断言 `git diff --name-only develop -- <三个 achieved 判据文件>` 为空，而 AC-381 的判据文件正是其中之一。该读数只说明「被检出的这棵树相对 develop 改了哪些文件」，不说明「谁改的」；本任务按设计改 AC-381 判据文件，于是它在任何 `task/<id>` worktree 上必红。
- 仓内已有两处同形修复：`claude-host-per-run.test.ts`（`gap-session-hosts-claude-per-run-driver`）与 `debug-agent-host-driver.test.ts`（`gap-debug-agent-ac10-reads-the-whole-branch-delta`）。两者都把这类断言收敛到 `CRITERION_OWNER_BRANCH`，其它分支打印读数 + 分支名 + 理由并记 not-applicable（不是静默 skip）。
- 本任务按同一形状修：owner 分支 `task/gap-ac395-ledger-transitions-extraction` 上断言保持原强度（`assert.deepEqual(touched, [])` 一字不改）；其它分支打印 `evaluated=false` 与理由。三个文件仍必须存在（`existsSync` 断言不动）。

读数（本 worktree，`task/gap-ac381-unattended-criterion-hermetic`）：

```
AC395-achieved-criteria: diffFiles=1 [server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts] evaluated=false branch=task/gap-ac381-unattended-criterion-hermetic
AC395-achieved-criteria: the develop-delta assertion is NOT evaluated here: this tree is on branch task/gap-ac381-unattended-criterion-hermetic, and that invariant is decided on task/gap-ac395-ledger-transitions-extraction. A criterion file in this branch's delta is a sibling task's declared scope, not a violation of this criterion; the reading above is printed, not asserted.
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-ledger-transitions.test.ts
ℹ tests 10 / pass 10 / fail 0, EXIT=0
```

负向控制（判别性，不删断言）：把 `CRITERION_OWNER_BRANCH` 临时改成 `task/gap-ac381-unattended-criterion-hermetic` 再跑同一文件 ⇒ `evaluated=true`、`tests 10 / pass 9 / fail 1`、`AssertionError [ERR_ASSERTION]: AC-378 / AC-380 / AC-381 must not be modified by this task`、`EXIT=1`；改回 owner 分支 ⇒ 10/10、`EXIT=0`。证明绿来自作用域判据，不是把断言删掉。

更新后的 diff 面（AC7 的逐条一致）：

```
git diff --stat develop...HEAD
.../claude-resident-ledger-transitions.test.ts     | 52 +++++++++++++++++++++-
.../claude-resident-unattended-after-turns.test.ts | 28 +++++++++++-
2 files changed, 77 insertions(+), 3 deletions(-)
```

`npx tsc --noEmit -p server/tsconfig.json` ⇒ `EXIT=0`；`npx oxlint` 两个文件 ⇒ `EXIT=0`（`claude-resident-ledger-transitions.test.ts:36` 的 importx warning 在 develop 上已存在，非本次引入）。
