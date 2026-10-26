---
id: gap-ac249-session-send-criterion-hermetic
title: AC-249 判据文件自钉 RESIDENT_RUN_IS_TURN 关态：裸 goal-gate 命令在 anchor 继承该开关时仍 8/8
  绿，(a)/(c)/(h) 读数不变
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-249
---
## Proposal

<!-- dedup-ref --> 机制去重（立案时实测，2026-10-26，`git rev-parse HEAD`=`9dfcc863e`）：`grep -l '^goal_ac: *AC-249' tasks/*.md` 只命中两条 —— `tasks/gap-ac249-session-send-immediate-runid.md` 与 `tasks/gap-ac249-criterion-ledger-red-is-merge-race.md`，两条 `status:` 逐字均为 `done` ⇒ 在飞（todo/ready/needs-human）认领者 **0**，本条不是重复，而是上一轮修复在 goal gate 环境里没撑住的证据。同为「判据文件自钉 flag 关态」机制的在飞兄弟有 `gap-ac381-unattended-criterion-hermetic`、`gap-ac390-reconcile-criterion-hermetic`、`gap-ac339-mcp-session-lifecycle-hermetic`，各自是别的 AC、别的判据文件，独立验收。粒度：`node /data/home/yale/.claude/plugins/cache/quay/quay/0.23.0/scripts/dist/task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/mcp-gateway/tests/mcp-session-send.test.ts --json` ⇒ `peers: []`、`mentions: []` ⇒ **separate**。

### 本轮直接复测（不是账本尾巴）

AC-249 的判据命令（goal store 原文，含存在性闸）：

```bash
for f in server/modules/mcp-gateway/tests/mcp-session-send.test.ts; do [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; done
npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-send.test.ts
```

在 `/data/home/yale/work/claudecodeui` 当场跑：

- **裸命令**（本会话与 anchor 都继承 `RESIDENT_RUN_IS_TURN=1`，来源 `~/.config/systemd/user/claudecodeui-server.service.d/40-resident-run-is-turn.conf`）⇒ `EXIT=1`、`tests 8 / pass 5 / fail 3`：
  - `✖ (a)/(b) session_send returns while running, with source mcp and the token owner as caller` —— `AssertionError [ERR_ASSERTION]: the run must still be running when the tool returns`，`'completed' !== 'running'`，落 `mcp-session-send.test.ts:623:12`；同轮读数 `(a) payload={"deliveryId":null,"runId":null,"queued":false,...}`、`(a) registry.byId={"status":"unknown","reason":"unknown"}`、`(a) listRunningRuns(for session)=[]`。
  - `✖ (c) a busy resident session queues and hands over the driver queue-tail uuid` —— `AssertionError [ERR_ASSERTION]: a resident busy send reports queued`，`false !== true`，落 `:670:12`；同轮读数 `(c) second={"deliveryId":null,"runId":null,"queued":false,...}`、`queue={"list":[],"tail":null}`。
  - `✖ (h) a queued send reports the pending request blocking it, byte-identical to approvals_list and session_get` —— 同一条 `AssertionError: a busy resident send reports queued`，`false !== true`，落 `:871:12`。
- **同一命令 `env -u RESIDENT_RUN_IS_TURN`** ⇒ `EXIT=0`、`tests 8 / pass 8 / fail 0`；关键读数逐字：`(a) payload={"deliveryId":null,"runId":"64db2139-…","queued":false,...,"source":"mcp",...}`、`(a) registry.current={"runId":"64db2139-…","source":"mcp","status":"running"}`、`(a) listRunningRuns(for session)=[{"sessionId":"8d58a441-…",...}]`、`(c) second={"deliveryId":"e6625b72-…","runId":"9dbca528-…","queued":true,"queuedMessageUuid":"e6625b72-…",...}`、`(c) queue={"list":["e6625b72-…"],"tail":"e6625b72-…"}`、`(h) approval_answer requestId=ac-h-blocker ok=true`。

⇒ 红/绿的唯一差别是宿主导出的 `RESIDENT_RUN_IS_TURN`，不是实现回归。

### 机制

`server/modules/websocket/services/chat-run-registry.service.ts:24` 注明 `RESIDENT_RUN_IS_TURN` 打开 SPEC §6「常驻会话的 run 就是它的 turn」。开态下常驻 `session_send` 走 delivery 形状（`runId:null`、不登记 running run），由 AC-385 自己的判据覆盖；因此本判据 (a) 的「返回时 run 仍 running 且 `runId` 非空」、(c)/(h) 的「常驻忙时 `queued:true`」在开态世界里根本不成立。判据文件从头到尾按出厂默认（flag-off；`residentRunIsTurn()` 只认字面 `'1'`）写，却没有把这条默认钉进进程，于是它的绿依赖调用者环境恰好没有这个变量。

### 为什么上一轮的修复没有撑住

1. `tasks/gap-ac249-session-send-immediate-runid.md`（done）落地时判据在未设该变量的 shell 里绿，但文件没有免疫宿主 env。
2. `scripts/test.sh` 会 `unset RESIDENT_RUN_IS_TURN`，可 **goal gate 不走 test.sh**：它按 AC 字面命令在 anchor 继承的环境里跑。
3. 宿主的 `40-resident-run-is-turn.conf` 把 `RESIDENT_RUN_IS_TURN=1` 导给服务及 anchor，于是判据在复验环境里确定性红。
4. 本仓同形先例：`server/modules/debug-agent/tests/debug-agent-control-queue.test.ts:89-97`、`server/modules/websocket/tests/chat-control-busy.test.ts`、`server/modules/providers/tests/claude-resident-unattended-after-turns.test.ts:110-118`，以及刚落的 `server/modules/mcp-gateway/tests/mcp-session-lifecycle.test.ts`（提交 `79b13597a`）都做「保存 / `delete` / `after` 恢复」这一段。

### 要交付的修复（只改判据文件）

在 `server/modules/mcp-gateway/tests/mcp-session-send.test.ts` 的模块顶层、任何 `await import('@/…')` 之前（现有 env 块 `process.env[GATE_VAR] = 'on'` 一带）：保存进进程时的 `process.env.RESIDENT_RUN_IS_TURN`，`delete` 它（出厂默认 = off），并在已有的 `after` 钩子（当前只 `rmSync(SCRATCH)`）里恢复原值（原本未设则保持删除）。`after` 已从 `node:test` 导入，不需要改 import。注释写清：本判据 (a)–(h) 腿测的是 flag-off 世界；flag-on 下常驻 send 是 delivery 形状（`runId:null`），由 AC-385 判据覆盖；`scripts/test.sh` 的 `unset` 与这里的钉子说的是同一件事，goal gate 不经过 test.sh，所以文件必须自己钉住。不碰服务实现、不碰 AC 记录/criterion 命令、不碰 `scripts/test.sh`、不改任何 `test(...)` 标题或 `assert*` 或 `console.log` 读数。

**拒绝的替代方案**：把 (a)/(c)/(h) 改成开态断言（`deliveryId` / `runId:null`）。那会改变 AC 期望文本的读数，且开态行为已由 AC-385 的判据覆盖；本任务只恢复判据文件声明的那个世界。也不改 AC 的 criterion 命令去加 `env -u` —— 判据本体与 AC 记录保持逐字不变，钉子放在文件里（与 AC-231/238/381/390 同一做法）。

**边界**：只改判据文件与任务文件自身。不新增测试文件（因此 `server/shared/tests/quay-test-script.test.ts` 的计数 pin 与 `scripts/suite-duration-baseline.tsv` 都不动）。AC-249 的取假形态 (i)–(iv) 记录属于原实现任务，本任务不重做、也不改断言。

## AC

- [ ] AC1 裸判据命令在「继承宿主开关」的环境下退出 0：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-send.test.ts` ⇒ `EXIT=0`、`tests 8 / pass 8 / fail 0`；逐字抄命令行、退出码、计数，并抄 `(a) payload=`（`runId` 非空、`source:"mcp"`）、`(a) registry.current=`（`status:"running"`）、`(c) second=`（`queued:true`、`queuedMessageUuid` 等于 `queue.tail`）、`(h) approval_answer requestId=ac-h-blocker ok=true`。
- [ ] AC2 同一命令在开关未设时也退出 0：`env -u RESIDENT_RUN_IS_TURN npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-send.test.ts` ⇒ `EXIT=0`、`tests 8 / pass 8 / fail 0`，各腿读数与 AC1 逐字一致（仅随机 uuid 与耗时不同）⇒ 判据不再依赖调用者环境。
- [ ] AC3 钉子承重（负向控制）：`cp` 备份判据文件，把钉住块（保存/`delete`/`after` 恢复 + 注释）临时移除，同一命令在 `RESIDENT_RUN_IS_TURN=1` 下 ⇒ `EXIT=1`、`tests 8 / pass 5 / fail 3`，逐字红行为 `the run must still be running when the tool returns`（`'completed' !== 'running'`，`:623:12`）与 `a resident busy send reports queued`（`false !== true`，`:670:12`、`:871:12`）；从备份还原后 AC1 重新 8/8。证明绿来自钉住的世界，不是把断言改松。
- [ ] AC4 改动面最小且读数未变：`git diff develop...HEAD -- server/modules/mcp-gateway/tests/mcp-session-send.test.ts` 只含 env 钉住块（保存/`delete`/`after` 恢复 + 注释）；全部 `test(...)` 标题、全部 `assert*` 调用、全部 `console.log` 行逐字不变；`git diff --name-only develop...HEAD` 只含该判据文件与本任务文件。

## DoD

真实落地判据（不是「测试存在」）：在交付的树上，用 AC-249 的**字面判据命令**、在**继承宿主 `RESIDENT_RUN_IS_TURN=1` 的环境里**跑 `server/modules/mcp-gateway/tests/mcp-session-send.test.ts` ⇒ 退出 0、8/8，且读数齐备：(a) `runId` 非空、注册表 `source:"mcp"`、`listRunningRuns` 含该会话、REST running 列表含该会话；(b) 调用者是令牌所属用户、`via:"mcp"`；(c) 常驻忙时 `queued:true` 且 uuid 等于 driver 队列 tail；(d) 按次进程忙时结构化忙错误带在飞 runId 与 `run_get` 提示；(e) `waitSeconds` 提前返回最终消息；(f) 只读令牌被拒、写一行 `denied` 审计、控制服务发送计数 0；(g) WebSocket 与 MCP 打到同一控制服务实例——全部读数与「开关未设」时一致；临时移除钉子 ⇒ 同一命令在开关=1 下按 (a)/(c)/(h) 确定性红，还原后恢复 8/8。`git diff` 只含判据文件的 env 钉住块与注释（外加本任务文件），没有服务实现、运行器、AC 记录或断言改动。

## ADR-007 轴记录

- 该轴仍暗,理由:本任务只改判据文件顶层的 env 钉住块与 `after` 恢复，不新增/移动模块、目录或依赖边，无架构轴读数。

## Touches

- `server/modules/mcp-gateway/tests/mcp-session-send.test.ts` （判据文件：模块顶层保存/删除/after 恢复 RESIDENT_RUN_IS_TURN，钉住 flag-off 世界；不改断言与读数）
- `tasks/gap-ac249-session-send-criterion-hermetic.md` （自触）