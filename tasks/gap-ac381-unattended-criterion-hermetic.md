---
id: gap-ac381-unattended-criterion-hermetic
title: AC-381 判据文件自钉 RESIDENT_RUN_IS_TURN 关态：裸 goal-gate 命令在 anchor 继承该开关时仍 3/3
  绿，四条读数与取假形态不变
status: todo
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

- **裸命令**（本会话环境带 `RESIDENT_RUN_IS_TURN=1`，与 anchor 从 `~/.config/systemd/user/claudecodeui-server.service.d/40-resident-run-is-turn.conf` 继承的值一致）⇒ `EXIT=1`，`tests 3 / pass 0 / fail 3`。逐字读数：`unattendedSource=none unattendedDeliveryIds=0 unattendedNotifications=0 unattendedTrigger=none unattendedCompletes=-1`、`peerSource=none peerDeliveryIds=0 peerNotifications=0 peerTrigger=none peerCompletes=-1`、`staleResidueUnattended=false staleResidueUnattendedNotifications=0 residueRoundsOpen=1 residuePendingStart=0`、`deliveredTurn=true unattendedRunsOpened=0 cronUnattended=false cronIsForeign=true foreignUuidInPublicReadings=false`。三条红：`AC381-a` 的 `the unattended turn must be identified by the opener uuid the CLI minted`（actual `null`，`…test.ts:488:10`）、`AC381-b` 的 `a stale round must not mask the unattended turn the CLI announced after it`（`false !== true`，`:553:10`）、`AC381-c` 的 `a foreign \`started\` does not make the turn delivered`（`false !== true`，`:616:10`）。
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

## AC

- [ ] AC1 裸判据命令在「继承宿主开关」的环境下退出 0：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` ⇒ `EXIT=0`、`tests 3 / pass 3 / fail 0`；逐字抄命令行、退出码、计数与五条读数（`unattendedSource=unattended unattendedDeliveryIds=0 unattendedNotifications=1 unattendedTrigger=background-task unattendedCompletes=1`；`peerSource=unattended peerDeliveryIds=0 peerNotifications=1 peerTrigger=cross-session-message peerCompletes=1`；`[rest] roundsOpen=0 turnLeasesOpen=0`；`staleResidueUnattended=true staleResidueUnattendedNotifications=1 residueRoundsOpen=1 residuePendingStart=0`；`deliveredTurn=true unattendedRunsOpened=0 cronUnattended=true cronIsForeign=true foreignUuidInPublicReadings=false`）。
- [ ] AC2 同一命令在开关未设时也退出 0：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` ⇒ `EXIT=0`、`tests 3 / pass 3 / fail 0`，五条读数与 AC1 逐字相同。两种宿主环境同一读数，判据不再依赖调用者环境。
- [ ] AC3 钉子承重（负向控制）：先备份文件，把钉子那块（保存/`delete`/`after` 恢复 + 注释）临时移除，以 `RESIDENT_RUN_IS_TURN=1` 跑 AC1 的命令 ⇒ `EXIT=1`、`tests 3 / pass 0 / fail 3`，且逐字红行是 AC381-a 的 `the unattended turn must be identified by the opener uuid the CLI minted`、AC381-b 的 `a stale round must not mask the unattended turn the CLI announced after it`、AC381-c 的 `a foreign \`started\` does not make the turn delivered`，读数含 `unattendedSource=none`、`staleResidueUnattended=false`、`cronUnattended=false`；恢复钉子后 AC1 重新 3/3。证明绿来自钉住的世界，不是把断言改松。
- [ ] AC4 改动面最小且读数未变：`git diff develop...HEAD -- server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` 只含 env 钉住块（保存/`delete`/恢复 + 注释）与 `after` 的 import；三个 `test(...)`、全部 `assert*`、全部 `console.log` 行逐字不变；AC1 的运行里仍打印上面五条读数。
- [ ] AC5 恢复语义：`after` 钩子把 `RESIDENT_RUN_IS_TURN` 恢复为进进程时的原值（原本未设则删除）；完成记录里写下「进进程原值 → 文件内值 → 退出前恢复值」三项读数（用临时打印或同进程小探针证明；临时打印若留在判据里必须不影响 AC4 的逐字断言与 AC1 的退出码）。
- [ ] AC6 不外溢：两个兄弟判据各起独立进程、各自 `EXIT=0`、fail 0：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-merged-queued-turn.test.ts` 与 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-turn.test.ts`（后者文件内按开态测量，证明本文件的钉子不改变它的世界）。
- [ ] AC7 对齐与仓库门：`git diff --stat develop...HEAD` 与 `## Touches` 逐条一致（且无新增测试文件 ⇒ `server/shared/tests/quay-test-script.test.ts` 的计数 pin 与 `scripts/suite-duration-baseline.tsv` 均未改动）；`npx tsc --noEmit -p server/tsconfig.json` 退出 0；`npx oxlint server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` 退出 0。

## DoD

- [ ] 判据文件在模块顶层把 `RESIDENT_RUN_IS_TURN` 钉成关态（保存进进程值 → `delete` → `after` 恢复原值），注释写明这就是 AC-381 判据所在的世界、与 `scripts/test.sh` 的 `unset RESIDENT_RUN_IS_TURN`、兄弟判据文件的钉子以及 `claude-resident-busy-input.test.ts:108-116` 是同一件事；goal gate 不经过 test.sh，所以文件必须自己钉住。
- [ ] 实现只改判据文件：`git diff develop...HEAD` 的该文件仅含 env 钉住块与 `after` import；三个 `test(...)`、全部 `assert*` 与五条读数未改动（AC4）。
- [ ] 裸判据命令在「宿主带 `RESIDENT_RUN_IS_TURN=1`」与「开关未设」两种环境下均 `EXIT=0`、`tests 3 / pass 3 / fail 0`（AC1/AC2），五条读数逐字贴进 `## 完成记录`。
- [ ] 负向控制（去掉钉子 ⇒ 三条腿红，逐字失败行与读数）、恢复语义三项读数、两个兄弟判据的 exit 0，均逐字记录在 `## 完成记录`（AC3/AC5/AC6）——只写「已通过」不算完成。

## Touches

- `server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts` （模块顶层钉住 `RESIDENT_RUN_IS_TURN` 关态：保存/delete/`after` 恢复 + 注释 + `after` import；断言与读数一行不动）
- `tasks/gap-ac381-unattended-criterion-hermetic.md` （自触）
