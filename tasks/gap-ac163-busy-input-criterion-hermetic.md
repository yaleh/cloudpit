---
id: gap-ac163-busy-input-criterion-hermetic
title: AC-163 判据文件自钉 RESIDENT_RUN_IS_TURN 关态：裸 goal-gate 命令在 anchor 继承该开关时仍 1/1
  绿，五条取假形态与四条读数不变
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-163
---
## Proposal

<!-- dedup-ref --> 机制去重（立案时实测，2026-10-26）：`grep -l '^goal_ac: *AC-163' tasks/*.md` 只命中 `tasks/gap-claude-resident-busy-input.md`（status `done`，按 gap 重立规则它不是重复，而是上一轮修复没撑住的证据）；`grep -lF "claude-resident-busy-input.test.ts" tasks/*.md` 的 13 个命中全部 `status: done`，`todo`/`ready`/`needs-human` 中 0 命中本判据文件；`ls tasks/gap-ac163-*` 无同名文件。同机制兄弟 `gap-ac231-resident-run-flag-hermetic`（done，提交 `8a60fdb75`，修的是 `server/modules/websocket/tests/chat-control-busy.test.ts`）与 `gap-ac238-debug-agent-control-queue-hermetic`（ready，修的是 debug-agent 判据文件）都是不同文件、验收独立 ⇒ **separate**。粒度工具：`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/providers/tests/claude-resident-busy-input.test.ts --json` ⇒ `peers: []`、`mentions: []`。

### 本轮直接复测（不是账本尾巴）

AC-163 的判据命令（goal store 原文）：

```
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-busy-input.test.ts
```

在 `/data/home/yale/work/claudecodeui` 的干净树上当场跑（`git status --porcelain -- server/` 为空）：

- 裸命令（本会话环境带 `RESIDENT_RUN_IS_TURN=1`，`echo ${RESIDENT_RUN_IS_TURN:-<unset>}` 逐字读数 `1`；来源是 quay anchor 从 live server 的 systemd drop-in `~/.config/systemd/user/claudecodeui-server.service.d/40-resident-run-is-turn.conf` 继承，`scripts/test.sh:63` 的 host-env 隔离注释记录了同一个来源）⇒ `EXIT=1`，`tests 1 / pass 0 / fail 1`；逐字读数：`[readings] waitFor timed out after 10000ms: the leg-2 frame to be written into the process`，失败行 `AssertionError [ERR_ASSERTION]: the leg-2 frame must be readable with its own uuid`（判据文件 `:988`，经 `withBusyHarness` `:508` / `TestContext.<anonymous>` `:872`），duration ≈ 11.8s。
- 同一命令 `env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-busy-input.test.ts` ⇒ `EXIT=0`，`tests 1 / pass 1 / fail 0`，duration ≈ 7.6s；五条取假形态逐字打印 `fake (a): red` / `fake (b): red` / `fake (c): red` / `fake (d): red (verdict-from-control-response=unknown)` / `fake (e): red (sessionStateChanged=0, realTurnBoundaries=4)`，两条腿读数 `leg=unattended … frame.priority=later … before=true`、`messageInRun=true`、`turnBoundaries=4`。

⇒ 红/绿的唯一差别是宿主导出的 `RESIDENT_RUN_IS_TURN`，不是忙时输入实现的回归。AC 的判据命令是裸 `npx tsx`，不经过 `scripts/test.sh`，因此运行器的 unset 修复覆盖不到它。

### 为什么上一轮的修复没有撑住（必写）

1. 原任务 `gap-claude-resident-busy-input`（done，实现 `35e940195`、`bf190098d`）落地时判据 1/1，但那次绿是在 `RESIDENT_RUN_IS_TURN` 不存在的环境里取得的；判据文件本身没有免疫宿主 env。
2. `gap-test-runner-unsets-host-live-voice-and-s2-env`（done，`cc9ad6fa9`）把同一类红集的修复放在**运行器** `scripts/test.sh`（`unset RESIDENT_RUN_IS_TURN VOICE_CAPTURE` 等）。而 goal gate 按 AC 的字面命令在 anchor 继承的环境里跑，不经过 test.sh，所以同一个泄漏在复验环上继续把 AC-163 判红。
3. 本轮用临时插桩（`openUnattendedTurnIfOwn` 早退分支、`chatRunRegistry.startRun` 拒绝点、`sessionHostManager.openUnattendedRun`；均已恢复，`git status --porcelain -- server/` 为空）读到确切机制：flag 为 `1` 时驱动走 `this.host.openTurn(...)`（run=turn 缝），而本判据的装配只装了 `sessionHostManager.setUnattendedRunOpener(...)`，从未装 `setTurnOpener(...)`，于是 `openTurn` 返回 null；台账已开 `turn-3 kind=unattended open=true`，但 `unattendedReading.unattendedCommandUuid=null`，`state.unattended` 永不置位。leg 2 的 `chat.send` 因此被当成新的一轮派发（新起 run、冷写入），而不是写进 CLI 队列的 `priority=later` 帧。
4. 即使额外补装 `setTurnOpener`，判据仍在更后面红：`AssertionError: the user message must be recorded in the run of the turn it started`，读数 `messageInRun=false`、`ackFrames user={count=0 withSeq=0 kinds=[]}`——本文件的「被记入该轮 run」读法是 flag-off 世界的 seq 读法。⇒ 这个判据是为一个世界写的，却从未把这个世界钉住。

### 要交付的修复（只改判据文件）

在 `server/modules/providers/tests/claude-resident-busy-input.test.ts` 模块顶层、测试定义之前：保存进进程时的 `process.env.RESIDENT_RUN_IS_TURN`，随后 `delete` 它（factory default = off；`server/shared/utils.ts:76-77` 的 `residentRunIsTurn()` 只认 `'1'`，且在调用时读）；用 `node:test` 的顶层 `after` 钩子恢复原值（原本未设则保持删除）。注释写清三件事：本判据断言的是 flag-off 世界；`scripts/test.sh` 的 `unset RESIDENT_RUN_IS_TURN` 与 AC-385 判据文件里「this criterion's world」的写法是同一件事；goal gate 不经过 test.sh，所以文件必须自己钉住。不碰服务实现、不碰 goal store 的 criterion 文本/命令、不碰 `scripts/test.sh`、不改 systemd drop-in、不放宽/删除任何 `assert*`。

**拒绝的替代方案**：补装 `setTurnOpener` 并把断言改写成两种世界都过——那会改变 AC-163 实际断言的语义（run=turn 世界的 run/delivery 归属由 AC-382/383/384 判据自己设 flag 负责），且需要重写 seq 读法，风险是把判据改松。关闭 live server 的 drop-in 则是在改出厂行为，超出本任务边界。

**边界**：只改判据文件与任务文件自身。

## AC

- [x] AC1 裸判据命令在「宿主继承开关」的环境下退出 0：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-busy-input.test.ts` ⇒ `EXIT=0`、`tests 1 / pass 1 / fail 0`；逐字抄命令行、退出码与计数。
- [x] AC2 同一命令在开关未设时也退出 0：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-busy-input.test.ts` ⇒ `EXIT=0`、`tests 1 / pass 1 / fail 0`。两种宿主环境同一读数，判据不再依赖调用者环境。
- [x] AC3 钉子承重（负向控制）：先把 env 钉住块临时移除（备份文件或用 `git diff` 保存补丁），再以 `RESIDENT_RUN_IS_TURN=1` 跑同一命令 ⇒ `EXIT=1`，逐字失败读数为 `[readings] waitFor timed out after 10000ms: the leg-2 frame to be written into the process` 与 `AssertionError [ERR_ASSERTION]: the leg-2 frame must be readable with its own uuid`；恢复钉子后 AC1 重新 1/1。证明绿来自钉住的世界，不是把断言改松。
- [x] AC4 五条取假形态与全部断言未被改动：`git diff develop...HEAD -- server/modules/providers/tests/claude-resident-busy-input.test.ts` 只含 env 钉住（保存/删除/恢复 + 注释）与 import 行；五个 `fake (...)` 臂的 `assert*` 行逐字不变；AC1 的运行里五条仍逐字打印 `fake (a): red` 至 `fake (e): red`，且 `[readings] leg=… messageInRun=true`、`turnBoundaries=4`、`sessionStateChanged=0` 照常出现。把五条 fake 读数与 diff 逐字抄进完成记录。
- [x] AC5 恢复语义：`after` 钩子把 `RESIDENT_RUN_IS_TURN` 恢复为进进程时的原值（原本未设则删除）；完成记录里写下「进进程原值 → 文件内值 → 退出前恢复值」三项读数（用同进程小脚本或临时打印证明；临时打印若留在判据里必须不影响 AC4 的逐字断言）。
- [x] AC6 不外溢：在独立进程里跑同目录的 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-control-queue.test.ts` ⇒ `EXIT=0`、fail 0（该文件不读本文件的 env 钉住；node --test 每个文件独立子进程）。
- [x] AC7 对齐与仓库门：`git diff --stat develop...HEAD` 与 `## Touches` 逐条一致；`npm run typecheck` 退出 0；`npm run lint` 无 `: error `（写下 error 计数）。

## DoD

- [x] 判据文件在模块顶层把 `RESIDENT_RUN_IS_TURN` 钉成关态（保存进进程值 → `delete` → `after` 恢复原值），注释写明这就是 AC-163 判据所在的世界、与 `scripts/test.sh:63` 的 `unset RESIDENT_RUN_IS_TURN` 是同一件事，且 goal gate 不经过 test.sh 所以文件必须自己钉住。
- [x] 实现只改判据文件：`git diff develop...HEAD` 的该文件仅含 env 钉住块（保存/删除/恢复 + 注释）与 `import test, { after } from 'node:test'`；五个 `test(...)`、全部 `assert*`、五条取假形态与四条读数未改动（AC4）。
- [x] 裸判据命令在「宿主带 `RESIDENT_RUN_IS_TURN=1`」与「开关未设」两种环境下均 `EXIT=0`、`tests 1 / pass 1 / fail 0`（AC1/AC2）。
- [x] 负向控制的变异 diff、逐字失败行、恢复命令，以及恢复语义三项读数，均逐字记录在 `## 完成记录`（AC3/AC5）。
- [x] 兄弟判据 `claude-resident-control-queue.test.ts` 在独立进程里 `EXIT=0`、fail 0，本文件的钉住不外溢（AC6）。
- [x] `## Touches` 与 `git diff --stat develop...HEAD` 一致；`npm run typecheck` 退出 0、`npm run lint` 无 `: error `（AC7）。
- [x] 后端判据改动按 `$backend-module-standards`（`.agents/skills/backend-module-standards/SKILL.md`）自查：测试只经公开读数断言，不新增模块级可变状态；不修改任何被测实现。

## 完成记录

实现提交：`aee950674`（分支 `task/gap-ac163-busy-input-criterion-hermetic`，起点 `develop` `d7228f9db`）。
退出前 `git merge --no-edit develop`：首次（task_write 前）develop `d7228f9db` ⇒ `Already up to date.`；task_write 提交 `3638140fa` 落到 develop 后 develop 前进到 `6cd30d935`，再 merge ⇒ 合并提交 `57129a236`（带 `tasks/gap-ac163-…md` 的勾选）。

### AC1 — 宿主带 `RESIDENT_RUN_IS_TURN=1`

命令（逐字）：

```
RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-busy-input.test.ts
```

读数：`EXIT=0`；`ℹ tests 1` / `ℹ pass 1` / `ℹ fail 0`；`ℹ duration_ms 16039.091267`。合入 develop `6cd30d935` 后的最终树复跑：`EXIT=0`；`ℹ tests 1` / `ℹ pass 1` / `ℹ fail 0`；`ℹ duration_ms 17431.148046`。

### AC2 — 开关未设

命令（逐字）：

```
env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-busy-input.test.ts
```

读数：`EXIT=0`；`ℹ tests 1` / `ℹ pass 1` / `ℹ fail 0`；`ℹ duration_ms 15528.42116`。合入 develop `6cd30d935` 后的最终树复跑：`EXIT=0`；`ℹ tests 1` / `ℹ pass 1` / `ℹ fail 0`；`ℹ duration_ms 21848.752083`。

### AC3 — 钉子承重（负向控制）

变异方式：文件备份为 `pinned.ts`（sha256 `755683de0d93dcc8491976b6410e492b975683d88a9274d059fe95979fba7c17`），把 env 钉住块整段移除（保留 `import test, { after }`），得到 `mutated.ts`。变异 diff 逐字：

```
--- /data/home/yale/work/claudecodeui-worktrees/.ac163-mutation/pinned.ts	2026-10-26 18:23:19.909294593 +0800
+++ /data/home/yale/work/claudecodeui-worktrees/.ac163-mutation/mutated.ts	2026-10-26 18:23:19.924294544 +0800
@@ -83,39 +83,6 @@
 import type { ClaudeResidentHostDriver } from '@/modules/providers/list/claude/claude-host-driver.provider.js';
 import type { ProviderModelEnvRow } from '@/shared/types.js';
 
-// ---------------------------------------------------------- pin the world ---
-//
-// This criterion is the run=turn flag OFF world: a busy send is answered by the
-// process's own input queue and the message is recorded in the run of the turn
-// it starts, which is what the seq readings below assert. With
-// `RESIDENT_RUN_IS_TURN=1` the driver takes the run=turn seam instead, so the
-// leg-2 frame is never written into the process and the reading that fails is
-// `the leg-2 frame must be readable with its own uuid` — not a busy-input
-// regression. The flag-on world belongs to AC-382/383/384's criteria, which set
-// the flag in their own files.
-//
-// `scripts/test.sh` isolates this file with `unset RESIDENT_RUN_IS_TURN`, but
-// the goal gate runs the criterion command verbatim in whatever environment the
-// anchor inherited (this host's anchor inherits
-// `40-resident-run-is-turn.conf` from the live server). The gate never goes
-// through test.sh, so the file has to pin the world it measures rather than
-// trust its caller — the same declaration AC-231's chat-control-busy criterion
-// and AC-238's debug-agent criterion make for their own flag-off worlds.
-// `residentRunIsTurn()` reads the flag at call time and the shipped default is
-// off (it only accepts the literal `1`), so deleting it here is the off state.
-// The `after` hook puts the caller's value back before the process exits, so the
-// pin cannot outlive this file.
-const incomingResidentRunIsTurn = process.env.RESIDENT_RUN_IS_TURN;
-delete process.env.RESIDENT_RUN_IS_TURN;
-
-after(() => {
-  if (incomingResidentRunIsTurn === undefined) {
-    delete process.env.RESIDENT_RUN_IS_TURN;
-  } else {
-    process.env.RESIDENT_RUN_IS_TURN = incomingResidentRunIsTurn;
-  }
-});
-
 const HERE = path.dirname(fileURLToPath(import.meta.url));
 /** The checkout this criterion measures: its own repository root. */
 const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
```

变异后以 `RESIDENT_RUN_IS_TURN=1` 跑同一命令 ⇒ `EXIT=1`；`ℹ tests 1` / `ℹ pass 0` / `ℹ fail 1`；`ℹ duration_ms 19412.496641`。逐字失败读数：

```
[readings] waitFor timed out after 10000ms: the leg-2 frame to be written into the process
AssertionError [ERR_ASSERTION]: the leg-2 frame must be readable with its own uuid
      at <anonymous> (/data/home/yale/work/claudecodeui-worktrees/gap-ac163-busy-input-criterion-hermetic/server/modules/providers/tests/claude-resident-busy-input.test.ts:988:12)
```

恢复命令：`cp .ac163-busy-input.pinned.backup.ts server/modules/providers/tests/claude-resident-busy-input.test.ts`，恢复后 sha256 仍为 `755683de0d93dcc8491976b6410e492b975683d88a9274d059fe95979fba7c17`；重跑 AC1 ⇒ `EXIT=0`、`tests 1 / pass 1 / fail 0`、`duration_ms 16039.091267`。

### AC4 — 五条取假形态与断言未改动

`git diff develop...HEAD -- server/modules/providers/tests/claude-resident-busy-input.test.ts` 逐字：

```
diff --git a/server/modules/providers/tests/claude-resident-busy-input.test.ts b/server/modules/providers/tests/claude-resident-busy-input.test.ts
index a78d2fb97..70b43b269 100644
--- a/server/modules/providers/tests/claude-resident-busy-input.test.ts
+++ b/server/modules/providers/tests/claude-resident-busy-input.test.ts
@@ -60,7 +60,7 @@ import http from 'node:http';
 import type { AddressInfo } from 'node:net';
 import os from 'node:os';
 import path from 'node:path';
-import test from 'node:test';
+import test, { after } from 'node:test';
 import { fileURLToPath } from 'node:url';
 
 import express from 'express';
@@ -83,6 +83,39 @@ import { chatRunRegistry, connectedClients, handleChatConnection } from '@/modul
 import type { ClaudeResidentHostDriver } from '@/modules/providers/list/claude/claude-host-driver.provider.js';
 import type { ProviderModelEnvRow } from '@/shared/types.js';
 
+// ---------------------------------------------------------- pin the world ---
+//
+// This criterion is the run=turn flag OFF world: a busy send is answered by the
+// process's own input queue and the message is recorded in the run of the turn
+// it starts, which is what the seq readings below assert. With
+// `RESIDENT_RUN_IS_TURN=1` the driver takes the run=turn seam instead, so the
+// leg-2 frame is never written into the process and the reading that fails is
+// `the leg-2 frame must be readable with its own uuid` — not a busy-input
+// regression. The flag-on world belongs to AC-382/383/384's criteria, which set
+// the flag in their own files.
+//
+// `scripts/test.sh` isolates this file with `unset RESIDENT_RUN_IS_TURN`, but
+// the goal gate runs the criterion command verbatim in whatever environment the
+// anchor inherited (this host's anchor inherits
+// `40-resident-run-is-turn.conf` from the live server). The gate never goes
+// through test.sh, so the file has to pin the world it measures rather than
+// trust its caller — the same declaration AC-231's chat-control-busy criterion
+// and AC-238's debug-agent criterion make for their own flag-off worlds.
+// `residentRunIsTurn()` reads the flag at call time and the shipped default is
+// off (it only accepts the literal `1`), so deleting it here is the off state.
+// The `after` hook puts the caller's value back before the process exits, so the
+// pin cannot outlive this file.
+const incomingResidentRunIsTurn = process.env.RESIDENT_RUN_IS_TURN;
+delete process.env.RESIDENT_RUN_IS_TURN;
+
+after(() => {
+  if (incomingResidentRunIsTurn === undefined) {
+    delete process.env.RESIDENT_RUN_IS_TURN;
+  } else {
+    process.env.RESIDENT_RUN_IS_TURN = incomingResidentRunIsTurn;
+  }
+});
+
 const HERE = path.dirname(fileURLToPath(import.meta.url));
 /** The checkout this criterion measures: its own repository root. */
 const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');
```

五个 `fake (...)` 臂在 AC1 运行里逐字打印：

```
[readings] fake (a): red
[readings] fake (b): red
[readings] fake (c): red
[readings] fake (d): red (verdict-from-control-response=unknown)
[readings] fake (e): red (sessionStateChanged=0, realTurnBoundaries=4)
```

四条读数照常出现（AC1 运行逐字）：

```
[readings] leg=user appearsInTurnRequest#3 inFlightTurn#1 textPresentInCurrentTurn=false run.appSessionId=claude-resident-busy-input-session messageInRun=true
[readings] leg=unattended appearsInTurnRequest#5 inFlightTurn#4 textPresentInCurrentTurn=false run.appSessionId=claude-resident-busy-input-session messageInRun=true
[readings] turnBoundaries=4 fakeBoundaries(sessionStateChanged)=0 terminalsAtQueuedTurn=3 terminalsAtUnattendedTurn=3
[readings] sessionStateChanged=0
```

### AC5 — 恢复语义

用同进程包装器 `tmp/ac5-wrapper.mts`（在 worktree 的 gitignored `tmp/` 下，不进 diff；不在判据文件里）先打印进进程值、1.5s 后打印运行中值、`process.on('exit')` 打印退出前值，再动态 import 判据文件。命令：

```
RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json tmp/ac5-wrapper.mts
```

三项读数逐字：`[ac5] incoming=1` → `[ac5] in-file=<unset>` → `[ac5] restored=1`；同一次运行 `EXIT=0`、`ℹ tests 1` / `ℹ pass 1` / `ℹ fail 0`。

### AC6 — 不外溢

```
env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-control-queue.test.ts
```

读数：`EXIT=0`；`ℹ tests 2` / `ℹ pass 2` / `ℹ fail 0`。合入 develop `6cd30d935` 后的最终树复跑：`EXIT=0`；`ℹ tests 2` / `ℹ pass 2` / `ℹ fail 0`。

### AC7 — 对齐与仓库门

`git diff --stat develop...HEAD` 逐字：

```
 .../tests/claude-resident-busy-input.test.ts       | 35 +++++++++++++++++++++-
 1 file changed, 34 insertions(+), 1 deletion(-)
```

`## Touches` 两条：判据文件（对应上表唯一改动，逐条一致）；`tasks/gap-ac163-busy-input-criterion-hermetic.md`（self-touch，由 `task_write` 在 store 检出上自行提交，不经过本 worktree 的 diff，故不在此 stat 中）。

`npm run typecheck` ⇒ `EXIT=0`（三段 tsc 全过）；合入 develop `6cd30d935` 后的最终树复跑 ⇒ `EXIT=0`。
`npm run lint` ⇒ `EXIT=0`；`: error ` 计数 `0`（只有 warning）；最终树复跑 ⇒ `EXIT=0`、`: error ` 计数 `0`。

### 后端标准自查（$backend-module-standards）

只改判据文件；新增的模块级绑定是不可变 `const incomingResidentRunIsTurn`（保存进进程值），无模块级可变状态、无新类生命周期；断言仍只走公开读数；未修改任何被测实现；未新增依赖边。

### ADR-007 暗轴

- 该轴仍暗,理由:只改判据文件的 env 钉住块，未增删任何模块导入或依赖边，架构 L_D/L_G 轴本任务未测量。

## Touches

- server/modules/providers/tests/claude-resident-busy-input.test.ts (module-top env pin + after restore + comment)
- tasks/gap-ac163-busy-input-criterion-hermetic.md (self-touch)
