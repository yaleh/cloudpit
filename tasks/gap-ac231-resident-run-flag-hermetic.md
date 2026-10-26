---
id: gap-ac231-resident-run-flag-hermetic
title: AC-231 判据文件自钉 RESIDENT_RUN_IS_TURN 关态：裸 goal-gate 命令在 anchor 继承该开关时仍 5/5
  绿，四条读数与取假形态不变
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-231
---
## Proposal

<!-- dedup-ref --> 机制去重（立案时实测，2026-10-26）：`grep -l '^goal_ac: *AC-231' tasks/*.md` 只命中 `tasks/gap-ac231-control-busy-queue-cancel.md`（status `done`，即上一轮已落地的修复，按 gap 重立规则它不是重复）；全库扫 `RESIDENT_RUN_IS_TURN` / 宿主 env 泄漏，`todo` / `ready` / `needs-human` 中 0 命中。粒度：`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/websocket/tests/chat-control-busy.test.ts --json` → `peers: []`、`mentions: []` ⇒ **none found / separate**。

### 本轮直接复测（不是账本尾巴）

AC-231 的判据命令（goal store 原文）：

```
for f in server/modules/websocket/tests/chat-control-busy.test.ts; do [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; done; npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-control-busy.test.ts
```

在 `/data/home/yale/work/claudecodeui` 上当场跑：

- 裸命令（本会话环境带 `RESIDENT_RUN_IS_TURN=1`，与 anchor pid 416623 的 `/proc/<pid>/environ` 读数一致）⇒ `EXIT=1`，`tests 5 / pass 4 / fail 1`；逐字失败行：`✖ (a) a resident busy session queues the second send and mints a second queryable run` + `AssertionError [ERR_ASSERTION]: runId must be a non-empty string (got null)`（经 `assertNonEmptyString` → `chat-control-busy.test.ts:231`，`withHarness` 打印 `Migrated legacy database` 后停下）。
- 同一命令 `env -u RESIDENT_RUN_IS_TURN npx tsx … --test …` ⇒ `EXIT=0`，`tests 5 / pass 5 / fail 0`（6.0s）。

⇒ 红/绿的唯一差别是宿主导出的 `RESIDENT_RUN_IS_TURN`，不是实现回归。

### 为什么绿不了：AC-385 的 S3 翻转 + 判据文件没有自述它所在的世界

- AC-385（`gap-ac385-send-deliveryid-runid-compat-window`，done，提交 `5ec056496`）把 `send()` 成功返回的 `runId` 放宽为 `string | null`。`server/modules/websocket/services/chat-control.service.ts` 里 resident 分支的读法是 `boundTurnRunId ?? (isRunIdCompatWindowOpen(now) ? deliveryId : null)`，且该分支只在 `residentRunIsTurn()` 为真时进入；`server/shared/utils.ts:76-77` 的 `residentRunIsTurn()` 在**调用时**读 `process.env.RESIDENT_RUN_IS_TURN === '1'`。
- 本判据的假运行时没有 resident delivery 账本条目，于是 `readAcceptedDelivery` 轮询到 2s 上界后 `deliveryId = null`，`boundTurnRunId` 也为 null，**第一次与第二次 resident `send` 的 `runId` 都读成 null**（(a) 第一条 `assertNonEmptyString(first.runId)` 就红，实测 2.3s ≈ 2s 交接上界）。
- 判据文件自己写明它是 flag-off 世界（`chat-control-busy.test.ts` 中 AC-385 加的注释：「With the run=turn flag off — this criterion's world」），却**从未把这个世界钉住**——它依赖调用者环境里恰好没有该变量。

### 为什么上一轮的修复没有撑住（必写）

1. 原始 AC-231 任务 `gap-ac231-control-busy-queue-cancel`（done，实现 `2db6ce93f`）落地时判据 5/5，但那次绿是在 `RESIDENT_RUN_IS_TURN` 不存在的环境里取得的；判据本身没有免疫宿主 env。
2. `gap-server-suite-red-set-15-files`（done）把同一红集归因到这个宿主 env 泄漏，修复落在**运行器** `scripts/test.sh`（`cc9ad6fa9`：`unset RESIDENT_RUN_IS_TURN VOICE_CAPTURE` + `VOICE_REALTIME_*`/`SENSEVOICE_*`），并在任务里记录了 `chat-control-busy` 是 15 个假钉之一。但 **goal gate 不走 test.sh**：它按 AC 的字面命令在 anchor 继承的环境里跑，所以同一个泄漏在复验环上仍然把 AC-231 判红。
3. AC-385 的判据（`mcp-session-send-delivery.test.ts`）在文件内 `process.env.RESIDENT_RUN_IS_TURN = '1'`，即本仓已经确立「判据文件自己声明所在世界」的做法；AC-231 这个文件缺的正是这一行。

### 要交付的修复（只改判据文件）

在 `server/modules/websocket/tests/chat-control-busy.test.ts` 模块顶层、测试定义之前：保存进进程时的 `process.env.RESIDENT_RUN_IS_TURN`，删除它（factory default = off；`residentRunIsTurn()` 只认 `'1'`），并在 `node:test` 的 `after` 钩子里恢复原值（原本未设则保持删除）。注释写清：调 `test.sh` 的 host-env 隔离（`unset RESIDENT_RUN_IS_TURN`）与 AC-385 注释里的「this criterion's world」是同一件事；goal gate 不经过 test.sh，所以文件必须自己钉住。不碰服务实现、不碰 AC 记录/criterion 命令、不碰 `scripts/test.sh`、不改任何既有断言。

**拒绝的替代方案**：让假运行时写 resident delivery 账本，使 flag-on 下 `deliveryId` 可命名。那样 `runId` 会等于 deliveryId（而不是第二个 run 的 id），且 `chatRunRegistry.getRunById(deliveryId)` 按 run 索引会 miss，AC 的「产生第二个 runId，且注册表里两次运行都按各自 id 可查」就被悄悄削弱；run=turn 世界归 AC-385 判据负责，它自己设 flag。

**边界**：只改判据文件与任务文件自身。不做 `scripts/test.sh` 级修复（已存在）、不改 goal store 的 criterion 文本、不放宽/删除任何 `assert*`、不把 (a)–(d) 换成「只要有某个 run 就算过」的读法。

## AC

- [x] AC1 裸判据命令在「继承宿主开关」的环境下退出 0：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-control-busy.test.ts` ⇒ `EXIT=0`、`tests 5 / pass 5 / fail 0`。逐字抄命令行、退出码与计数。
- [x] AC2 同一命令在开关未设时也退出 0：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-control-busy.test.ts` ⇒ `EXIT=0`、`tests 5 / pass 5 / fail 0`。两种宿主环境同一读数，判据不再依赖调用者环境。
- [x] AC3 钉子承重（负向控制）：先把钉子两行临时移除（备份文件或用 `git diff` 保存补丁），再以 `RESIDENT_RUN_IS_TURN=1` 跑同一命令 ⇒ `EXIT=1`，且逐字失败行是 `✖ (a) a resident busy session queues the second send and mints a second queryable run` + `AssertionError [ERR_ASSERTION]: runId must be a non-empty string (got null)`；恢复钉子后 AC1 重新 5/5。证明绿来自钉住的世界，不是把断言改松。
- [x] AC4 四条读数与无 socket 守卫未被改动：`git diff develop...HEAD -- server/modules/websocket/tests/chat-control-busy.test.ts` 只含 env 钉住（保存/删除/恢复 + 注释），五个 `test(...)` 与全部 `assert*` 行逐字不变；AC1 的运行里仍打印 `(a) firstSend=… secondSend=… queue=…`、`(b) uuid=… verdict=cancelled …`、`(c) secondSend={"ok":false,"code":"RUN_IN_PROGRESS",…}`、`(d) neverUuid=… verdict=unknown …`、`(e) socketReferences=[]`。五条读数逐字抄进完成记录。
- [x] AC5 四条取假形态在钉住的世界里仍各自必红（先提交实现再变异，逐条记录变异 diff、逐字失败行、恢复命令）：(i) `chat-websocket.service.ts` 忙时分支改 `if (!run && false) {` ⇒ (a) 红；(ii) 同处改 `if (!run) {` ⇒ (c) 红；(iii) `chat-control.service.ts` 的 `queuedMessageUuid` 改成 `randomUUID()` ⇒ (b) 红；(iv) `cancelQueued` 驱动判决透传改成 `return 'cancelled';` ⇒ (d) 红。每条跑完 `git checkout -- <被变异文件>` 恢复并重跑 AC1 绿。若某条因更晚改动无法按原文变异，逐字写下实际 diff 与失败行并说明替代，不得跳过。
- [x] AC6 恢复语义：`after` 钩子把 `RESIDENT_RUN_IS_TURN` 恢复为进进程时的原值（原本未设则删除）；完成记录里写下「进进程原值 → 文件内值 → 退出前恢复值」三项读数（用同进程小脚本或临时打印证明；临时打印若留在判据里必须不影响 AC4 的逐字断言）。
- [x] AC7 不外溢：`npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-control-send.test.ts`（与 AC-231 共用装配）与 `... --test server/modules/websocket/tests/chat-run-turn-semantics.test.ts`（文件内钉住开关开态）各 `EXIT=0`，fail 0。两文件各起独立进程，证明本文件的钉住不外溢。
- [x] AC8 对齐与仓库门：`git diff --stat develop...HEAD` 与 `## Touches` 逐条一致；`npm run typecheck` 退出 0；`npm run lint` 无 `: error `（写下 error 计数）。

## 完成记录

实现提交：`8a60fdb75 test(websocket): pin chat-control-busy to the run=turn flag-off world`（仅在 `server/modules/websocket/tests/chat-control-busy.test.ts` 增加 26 行、改 1 行：`import test, { after }` + 保存/删除/`after` 恢复 + 注释）。

### AC1 — 继承宿主开关

命令：

```
RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-control-busy.test.ts
```

`EXIT=0`，`tests 5 / pass 5 / fail 0`。

### AC2 — 开关未设

命令：

```
env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-control-busy.test.ts
```

`EXIT=0`，`tests 5 / pass 5 / fail 0`。两种宿主环境同一读数。

### AC3 — 负向控制（移除钉子两行再跑）

变异（临时移除 `const incomingResidentRunIsTurn = process.env.RESIDENT_RUN_IS_TURN;` 与 `delete process.env.RESIDENT_RUN_IS_TURN;` 及 `after` 钩子，即回到未钉住文件）：

```diff
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
```

`RESIDENT_RUN_IS_TURN=1` 下 `EXIT=1`，`tests 5 / pass 4 / fail 1`，逐字失败行：

```
✖ (a) a resident busy session queues the second send and mints a second queryable run
  AssertionError [ERR_ASSERTION]: runId must be a non-empty string (got null)
```

恢复钉子后重跑 AC1：`EXIT=0`，`tests 5 / pass 5 / fail 0`。

### AC4 — diff 只含 env 钉住 + 五条读数逐字

`git diff develop...HEAD -- server/modules/websocket/tests/chat-control-busy.test.ts` 仅含：`import test, { after } from 'node:test';` 与保存/删除/`after` 恢复块及注释；五个 `test(...)` 与全部 `assert*` 行未出现于 diff。

AC1 运行的读数（逐字）：

```
control-busy (a) firstSend={"ok":true,"deliveryId":null,"runId":"580500f1-3d69-4c6d-88ae-53f067f3ee92","queued":false,"queuedMessageUuid":null,"completion":{}} secondSend={"ok":true,"deliveryId":"ffbb2c97-0d35-4e33-a4bb-acd87b40b6ea","runId":"7d2a3a15-188c-41bb-a03c-533190be9c3b","queued":true,"queuedMessageUuid":"ffbb2c97-0d35-4e33-a4bb-acd87b40b6ea","completion":{}} queue=["7238f8ba-aca8-4789-a2c0-eb96d2984373","ffbb2c97-0d35-4e33-a4bb-acd87b40b6ea"]
control-busy (a) getRunById(runId1)={"runId":"580500f1-3d69-4c6d-88ae-53f067f3ee92","status":"running"} getRunById(runId2)={"runId":"7d2a3a15-188c-41bb-a03c-533190be9c3b","status":"running"}
control-busy (b) uuid=419c323a-6d81-4006-aafc-1ff23e543afb verdict=cancelled before=["4b152031-f5cb-4e73-b25f-71dd582f6724","419c323a-6d81-4006-aafc-1ff23e543afb"] after=["4b152031-f5cb-4e73-b25f-71dd582f6724"]
control-busy (c) secondSend={"ok":false,"code":"RUN_IN_PROGRESS","message":"Session \"control-busy-session\" already has a run in progress."} runCallsBefore=1 runCallsAfter=1 currentRunId=b1126041-517a-4fcd-9b02-f5b5d0e64532 runningForSession=1 getRunById(runId1)=b1126041-517a-4fcd-9b02-f5b5d0e64532
control-busy (d) neverUuid=523ca97d-eacc-404d-87ff-cf7e85b2c3e8 verdict=unknown before=["109c1e6f-6a82-4626-a194-69f3a86ac415","b8115a7c-167b-4cdf-8441-8a237e2bb73f"] after=["109c1e6f-6a82-4626-a194-69f3a86ac415","b8115a7c-167b-4cdf-8441-8a237e2bb73f"]
control-busy (e) socketReferences=[]
```

### AC5 — 四条取假形态（每条跑完 `git checkout -- <文件>` 恢复并重跑 AC1 绿）

(i) `server/modules/websocket/services/chat-websocket.service.ts` 忙时分支：

```diff
-    if (!run && busyInputAccepted) {
+    if (!run && false) {
```

`EXIT=1`，`tests 5 / pass 2 / fail 3`；(a) 逐字失败行：

```
✖ (a) a resident busy session queues the second send and mints a second queryable run
  AssertionError [ERR_ASSERTION]: the busy send must be queued, not refused (got {"ok":false,"code":"RUN_IN_PROGRESS","message":"Session \"control-busy-session\" already has a run in progress."})
```

同一条共享忙时路径上的 (b)/(d) 也随之为红（`The expression evaluated to a falsy value`），(c) 仍绿。恢复：`git checkout -- server/modules/websocket/services/chat-websocket.service.ts`；AC1 重跑 5/5。

(ii) 同处：

```diff
-    if (!run && busyInputAccepted) {
+    if (!run) {
```

`EXIT=1`，`tests 5 / pass 4 / fail 1`；(c) 逐字失败行：

```
✖ (c) a per-run busy session is refused without touching the provider
  AssertionError [ERR_ASSERTION]: a per-run busy session refuses the second send
```

恢复：`git checkout -- server/modules/websocket/services/chat-websocket.service.ts`；AC1 重跑 5/5。

(iii) `server/modules/websocket/services/chat-control.service.ts` 的 `queuedMessageUuid`。实际 diff 多一行 import，因为该文件原本未引入 `randomUUID`（变异所需的实际形态，按 AC5 的「写下实际 diff」记录）：

```diff
+import { randomUUID } from 'node:crypto';
+
...
-      const queuedMessageUuid = await readQueuedMessageUuid(deps.runtime, provider, input.sessionId);
+      const queuedMessageUuid = randomUUID();
```

`EXIT=1`，`tests 5 / pass 4 / fail 1`；(b) 逐字失败行：

```
✖ (b) cancelQueued withdraws exactly the uuid the provider handed over
  AssertionError [ERR_ASSERTION]: the queued message must be withdrawable by the returned uuid
```

恢复：`git checkout -- server/modules/websocket/services/chat-control.service.ts`；AC1 重跑 5/5。

(iv) 同一文件的 `cancelQueued` 判决透传：

```diff
-    const provider = session.provider as LLMProvider;
-    return (
-      (await deps.runtime.cancelQueuedInput?.(provider, input.sessionId, input.messageUuid)) ??
-      'unknown'
-    );
+    return 'cancelled';
```

`EXIT=1`，`tests 5 / pass 3 / fail 2`；(d) 逐字失败行：

```
✖ (d) an unknown uuid answers unknown, not cancelled
  AssertionError [ERR_ASSERTION]: an id the provider never queued cannot be withdrawn
```

同时 (b) 因不再真正撤队而红（`the withdrawn message is gone from the provider queue`）。恢复：`git checkout -- server/modules/websocket/services/chat-control.service.ts`；AC1 重跑 5/5。

### AC6 — 恢复语义三项读数

临时在同一判据文件内加两行 `say`（验证后已移除，最终 diff 中无打印），以

```
RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test …
env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test …
```

分别取得：

```
flag=1:  atEntry="1"         inFile=undefined  beforeExit="1"
unset:   atEntry=undefined   inFile=undefined  beforeExit=undefined
```

即「进进程原值 → 文件内值 → 退出前恢复值」分别为 `"1" → undefined → "1"` 与 `undefined → undefined → undefined`。两次运行均 `tests 5 / pass 5 / fail 0`。

### AC7 — 不外溢

```
env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-control-send.test.ts
⇒ EXIT=0，tests 4 / pass 4 / fail 0
env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/websocket/tests/chat-run-turn-semantics.test.ts
⇒ EXIT=0，tests 2 / pass 2 / fail 0
```

两文件各起独立进程；本文件的钉住只在自身进程内生效。

### AC8 — 对齐与仓库门

`git diff --stat develop...HEAD`（task_write 前）只列：

```
 server/modules/websocket/tests/chat-control-busy.test.ts | 27 +++++++++++++++++++++-
```

与 `## Touches` 的判据文件一致（任务文件由 `task_write` 自身提交进入本分支）。`npm run typecheck` ⇒ `EXIT=0`（三个 tsconfig 全部通过）。`npm run lint` ⇒ `EXIT=0`，`: error ` 计数 **0**（仅既有 warning）。

## ADR-007 暗轴

该轴仍暗,理由:本任务只钉住判据文件的测试环境，未改服务实现与模块依赖图，架构轴无位移。

## Touches

- server/modules/websocket/tests/chat-control-busy.test.ts
- tasks/gap-ac231-resident-run-flag-hermetic.md

## Blocker

**2026-10-26T09:17:59.890Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（AC/DoD 段缺失或无法识别，无法评估 ≠ 合格）——续做需补齐并勾选 AC
- run_id：wk-prod-anchor
- session_id：b50b9802-794f-4d77-b98f-4741d5ad105e
