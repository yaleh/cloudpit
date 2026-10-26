---
id: gap-ac271-criterion-hermetic
title: AC-271 判据自钉 RESIDENT_RUN_IS_TURN 关态：裸 goal-gate 命令在 anchor 继承该开关时仍
  6/6，四条读数与取假形态不变
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-271
---
## Proposal

<!-- dedup-ref --> 机制去重（立案时实测，2026-10-26，`git rev-parse --short HEAD`=`f52e9cf01`）：`grep -l '^goal_ac: *AC-271' tasks/*.md` 只命中 `tasks/gap-ac271-mcp-session-cancel-queued.md`（`status: done`）。按 gap 重立规则，done 不是重复，而是「上一轮修复在 goal gate 的环境里没撑住」的证据；在飞（todo/ready/needs-human）认领者 **0**。同机制兄弟 `gap-ac238-debug-agent-control-queue-hermetic`、`gap-ac249-session-send-criterion-hermetic`、`gap-ac231-resident-run-flag-hermetic` 各自钉别的判据文件、验收独立 ⇒ **separate**。粒度工具 `node /data/home/yale/.claude/plugins/cache/quay/quay/0.23.0/scripts/dist/task-granularity-advice.js --touches server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts --json` ⇒ `peers: []`、`mentions: []`。

### 本轮直接复测（不是账本尾巴）

AC-271 的判据命令（goal store 原文）：

```bash
for f in server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts; do [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; done
npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts
```

（AC 记录末尾「当前必红：判据文件不存在」是立项时的旧读数；判据文件现已存在，本轮的红是断言失败，不是存在性闸。）

在 `/data/home/yale/work/claudecodeui` 当场跑：

- **裸命令**（本会话与 anchor 都继承 `RESIDENT_RUN_IS_TURN=1`：`env | grep RESIDENT_RUN_IS_TURN` 逐字 `RESIDENT_RUN_IS_TURN=1`，来源是 anchor 从 `claudecodeui-server.service` 的 `40-resident-run-is-turn.conf` 继承，见 `scripts/test.sh` 的 host-env 隔离注释）⇒ `EXIT=1`，`tests 6 / pass 3 / fail 3`：
  - `✖ (a) a queued withdrawal reports cancelled, never becomes a round, and keeps the host pid` — `AssertionError [ERR_ASSERTION]: the busy send must hand over a queuedMessageUuid`，落 `mcp-cancel-queued.test.ts:521:12`（经 `withHarness` `:464:5`、测试体 `:511:3`）；同轮 DebugAgent 自检逐字 `rows: the run wrote 2 row(s) (3 -> 5); the scenario expects 1`。
  - `✖ (b) withdrawing an already-dequeued message is already-started (not cancelled) and the message really started` — 同一条 `the busy send must hand over a queuedMessageUuid`，落 `:573:12`（测试体 `:565:3`）；DebugAgent 自检两次逐字 `rows: the run wrote 1 row(s) (3 -> 4); the scenario expects 2`。
  - `✖ (c) a never-returned uuid and another session uuid are both QUEUED_MESSAGE_NOT_FOUND and leave both queues verbatim` — `AssertionError [ERR_ASSERTION]: A's busy send must hand over a uuid`，落 `:619:12`（测试体 `:604:3`）。
- **同一命令 `env -u RESIDENT_RUN_IS_TURN`** ⇒ `EXIT=0`，`tests 6 / pass 6 / fail 0`（约 17.6s）。绿读数逐字（该轮 uuid）：`(b) cancel={"outcome":"already-started","session":"332cc61d-…","messageUuid":"feee4cbb-…","message":"The message is no longer in the queue (it was taken out to start executing) and can no longer be withdrawn."}`；`(c) aSecond={"deliveryId":"e618576d-faa4-40f0-ab84-ce337adb6641","runId":"2408c2ae-3055-4e2b-a4f8-97ac168ce0c0","queued":true,"queuedMessageUuid":"e618576d-faa4-40f0-ab84-ce337adb6641","source":"mcp","blockedBy":null}`；`(c) never={"code":"QUEUED_MESSAGE_NOT_FOUND",…} isError=true`；`(c) crossSession(uuidB against A)={"code":"QUEUED_MESSAGE_NOT_FOUND",…} isError=true` 且两队列前后逐字不变；`(d)` `cancelCallsBefore=0 cancelCallsAfter=0`，新增恰好一行 `tool='session_cancel_queued'`/`outcome='denied'`/`error_code='INSUFFICIENT_SCOPE'` 审计。

⇒ 红/绿的唯一差别是宿主导出的 `RESIDENT_RUN_IS_TURN`，不是实现回归。

### 机制

- `residentRunIsTurn()`（`server/shared/utils.ts`）在**调用时**读 `process.env.RESIDENT_RUN_IS_TURN === '1'`；出厂默认是关（只认字面 `1`）。
- AC-385（`gap-ac385-send-deliveryid-runid-compat-window`，done，`5ec056496`）给 `server/modules/websocket/services/chat-control.service.ts` 的 resident `send` 加了 `readAcceptedDelivery`：flag 开且会话 resident 时，`send` 先快照 resident 账本，再轮询直到出现一条新 delivery，上界 `DELIVERY_ID_HANDOVER_TIMEOUT_MS = 2000`。
- 调试 agent 只在 **busy push** 时记 delivery（`recordQueuedDelivery`），**首轮 turn 的 send 不写 delivery**。于是 flag 开时第一次 `send` 会轮询满 2s。
- 本判据三段 arm 的第一轮 hold 只有 `holdMs` = 200 / 1500 / 2000ms；2s 的 delivery 轮询活过了第一轮。第一次 `send` 返回时第一轮已结束，第二次 `send` 因此**不再 busy**，被当成普通 send 立即起一轮 ⇒ `queued:false`、`queuedMessageUuid:null` ⇒ (a)/(b)/(c) 在 `queuedMessageUuid` 断言处红。计数也与 DebugAgent 自检吻合：多出来的是真实开始的轮次。

### 为什么上一轮的修复没有撑住（必写）

1. `gap-ac271-mcp-session-cancel-queued`（done）落地实现与判据时，判据在一台**没有** `RESIDENT_RUN_IS_TURN` 的 shell 里绿；文件本身从未把「flag-off 世界」钉进进程。
2. `scripts/test.sh` 第 82 行有 `unset RESIDENT_RUN_IS_TURN VOICE_CAPTURE`，所以整套 suite 不受影响；但 **goal gate 不走 test.sh**：它按 AC 字面命令在 anchor 继承的环境里跑。
3. 宿主的 `40-resident-run-is-turn.conf` 把 `RESIDENT_RUN_IS_TURN=1` 导给服务与 anchor，于是复验环上判据确定性红。
4. flag-on 世界归 AC-385 自己的判据（`mcp-session-send-delivery.test.ts` 显式设 `RESIDENT_RUN_IS_TURN=1`）；AC-271 这个文件从头到尾按出厂默认写。同形判据今天已逐个补钉（AC-231 的 `chat-control-busy.test.ts`、AC-238 的 `debug-agent-control-queue.test.ts` 于 `de78a8ca9`、AC-249 的 `mcp-session-send.test.ts`、AC-339 的 `mcp-session-lifecycle.test.ts`），AC-271 这一份被漏掉。

### 要交付的修复（只改判据文件）

在 `server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts` 的既有环境块（`process.env.HOME`/`DEBUG_AGENT`/`JWT_SECRET` 那几行，约 :78–:90，**在第一个 `await import('@/modules/…')` 之前**）加：

```ts
// 本判据是 run=turn 开关关态的世界……
const incomingResidentRunIsTurn = process.env.RESIDENT_RUN_IS_TURN;
delete process.env.RESIDENT_RUN_IS_TURN;
```

并在文件末尾既有的 `after(() => { rmSync(SCRATCH, …) })`（约 :731）里、或紧随其后的独立 `after` 里恢复：

```ts
if (incomingResidentRunIsTurn === undefined) {
  delete process.env.RESIDENT_RUN_IS_TURN;
} else {
  process.env.RESIDENT_RUN_IS_TURN = incomingResidentRunIsTurn;
}
```

`after` 已在 :56 从 `node:test` 导入，无需改 import。注释写清：`scripts/test.sh` 会 unset，但 goal gate 按 AC 字面命令在 anchor 继承的环境里跑，所以文件必须自己声明世界；出厂默认关（`residentRunIsTurn()` 只认 `'1'`），删除即关态；`after` 恢复调用者的值，钉不能活过本文件。

**拒绝的替代方案**：

- 把 `holdMs` 拉长到 2s 以上让 flag-on 也能过：改了被测世界、每次 send 还要白等 2s；flag-on 语义归 AC-385 判据。
- 给调试 agent 的首轮 send 补 delivery 账本 / 给 harness 传 `publishDeliveries`：改夹具或产品语义，且会让 (a)(b)(c) 的读数进入 run=turn 世界（`runId` nullable 等），不是本判据写的读数。
- 改 `scripts/test.sh`：已有 unset，且 gate 不经过它。
- 在 AC 命令里写 `env -u`：AC 是逐字命令，不能改；文件自钉才是与兄弟判据一致的做法。

**边界**：只改判据文件与任务文件自身。不改任何发行源码、不改 `chat-control.service.ts` / `debug-agent.provider.ts` / `provider-runtime.service.ts`、不改 goal store 的 criterion 文本、不放宽或删除任何 `assert*`、不改测试标题与夹具、不跳过失败腿。

## AC

- [ ] AC1 红态基线：修复前用 `RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts` 跑一次 ⇒ `EXIT=1`、`tests 6 / pass 3 / fail 3`；逐字抄下 (a)/(b)/(c) 三条失败行与 `queuedMessageUuid` 断言落点（:521/:573/:619）。
- [ ] AC2 修复后同一开态命令退出 0：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts` ⇒ `EXIT=0`、`tests 6 / pass 6 / fail 0`；逐字写出 (a) 的 `second`/`cancel` 读数、(b) 的 `outcome='already-started'`、(c) 的两组 `QUEUED_MESSAGE_NOT_FOUND` 与队列前后、(d) 的一行 `denied` 审计。
- [ ] AC3 关态不回归：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts` ⇒ `EXIT=0`、`tests 6 / pass 6 / fail 0`。
- [ ] AC4 钉子形状机械可读：`grep -n "incomingResidentRunIsTurn\|delete process.env.RESIDENT_RUN_IS_TURN\|process.env.RESIDENT_RUN_IS_TURN = incomingResidentRunIsTurn" server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts` 同时命中保存、删除、恢复三处；删除行号小于第一个 `await import('@/` 的行号；恢复位于 `after(` 之内。
- [ ] AC5 取假形态（先绿后变异）：把 `delete process.env.RESIDENT_RUN_IS_TURN;` 暂时删掉（其余保留），`RESIDENT_RUN_IS_TURN=1 …` 重跑 ⇒ 必须红回 `tests 6 / pass 3 / fail 3` 且三条断言与 AC1 逐字相同；贴出变异 diff 与恢复命令，恢复后重跑 ⇒ 6/6 绿。
- [ ] AC6 没有削弱断言：`git diff develop...HEAD -- server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts | grep -E '^-[^-]'` 输出为空（零删除行；新增只允许是钉子块与 `after` 恢复）；`grep -c '^test(' server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts` ⇒ `6`。
- [ ] AC7 仓库门：`npm run typecheck` 退出 0；`npm run lint` 无 `: error `（写下计数，期望 0）。
- [ ] AC8 改动面与 Touches 对齐：`git diff --stat develop...HEAD` 只列 `server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts` 与 `tasks/gap-ac271-criterion-hermetic.md`（若 `tasks/` 文件不在任务工作树 diff 中，注明 task_write 的自提交），无 Touches 外文件。

## DoD

- 裸 goal-gate 命令在 **anchor 继承 `RESIDENT_RUN_IS_TURN=1`** 的环境下 6/6 绿，读数逐字可复现；同一命令在关态环境也 6/6 绿 —— 两种宿主环境同一读数。
- 绿是「声明世界」换来的，不是「放宽判据」换来的：判据 diff 零删除行、测试标题与六条断言原样、`(a)(b)(c)(d)` 的读数内容不变。
- 钉子不会活过本文件：`after` 把调用者原值放回（原本未设则保持删除）；同一进程里后跑的文件看到原值。
- 取假形态先红后恢复，变异 diff、逐字失败行、恢复命令齐全。
- 只改判据文件与任务文件；不碰发行源码、不碰 `scripts/test.sh`、不改 goal store 的 criterion 文本。

## Touches

- server/modules/mcp-gateway/tests/mcp-cancel-queued.test.ts
- tasks/gap-ac271-criterion-hermetic.md
