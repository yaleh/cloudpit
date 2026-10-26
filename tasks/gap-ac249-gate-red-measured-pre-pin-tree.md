---
id: gap-ac249-gate-red-measured-pre-pin-tree
title: AC-249 台账红拍测量的是无 RESIDENT_RUN_IS_TURN 自钉的旧树（treeSha 53135d38 =
  40c67f665）；current HEAD 709e120bd 裸跑与 anchor 环境 flag=1 均 8/8
  绿，verification-only 归因
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-249
---
## Proposal

来源：本轮 gap-filing 交办 GOAL-020 / AC-249 为 CURRENTLY FALSE。判据物（逐字取自 AC 记录 `criterion:`）：

```
for f in server/modules/mcp-gateway/tests/mcp-session-send.test.ts; do [ -f "$f" ] || { echo "缺判据文件：$f" >&2; exit 1; }; done; npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-send.test.ts
```

**立案直接现测（主检出 `/data/home/yale/work/claudecodeui`，`git rev-parse HEAD` = `709e120bd`，tree `0a91e5d0`，`git status --porcelain -- server shared src package.json package-lock.json` 空）：判据绿。** 两次读数：

| 环境 | exit | tests | pass | fail | duration_ms |
| --- | --- | --- | --- | --- | --- |
| 裸跑（shell 未带 flag） | **0** | 8 | 8 | 0 | 20423.168961 |
| `RESIDENT_RUN_IS_TURN=1`（= anchor 实际环境） | **0** | 8 | 8 | 0 | 20445.971261 |

anchor 进程 `pid 416623` 的 `/proc/416623/environ` 里逐字有 `RESIDENT_RUN_IS_TURN=1`，所以第二行就是 gate 实际所处的环境。八条用例逐字通过：

- `(a)/(b) session_send returns while running, with source mcp and the token owner as caller`
- `(c) a busy resident session queues and hands over the driver queue-tail uuid`
- `(d) a busy per-run session is refused with the in-flight runId and a run_get hint`
- `(e) waitSeconds returns early with the closing assistant message`
- `(f) a token lacking the write scope is denied, audits one denied row, and never calls the control service`
- `(g) the WebSocket chat.send and the MCP session_send reach the same control service`
- `(h) a queued send reports the pending request blocking it, byte-identical to approvals_list and session_get`
- `the stage-4 write table is exactly the five SPEC tools`

**机制：两拍红测量的是 pre-pin 树，不是 AC-249 回归。**

- `.quay/gate-events.jsonl` 最近两拍 AC-249 红：`2026-10-26T12:55:21.267Z` 与 `2026-10-26T13:00:14.541Z`，两拍的 `payload.treeSha` 都是 `53135d38ef3ac8d9908ba08438f1c1ab6e4ace77`。
- `53135d38` 正是 `40c67f665` 的 tree：`git log --all --format='%H %T %cI %s' | grep 53135d38` 唯一命中 `40c67f665 … 2026-10-26T20:55:31+08:00 tasks: gap-ac249-session-send-criterion-hermetic task_write by cli:3833691`。
- `git show 40c67f665:server/modules/mcp-gateway/tests/mcp-session-send.test.ts | grep -c incomingResidentRunIsTurn` = **0**；`git show 709e120bd:… | grep -c …` = **3**。`git diff 40c67f665 709e120bd -- server/modules/mcp-gateway/tests/mcp-session-send.test.ts` 的 diff 恰为 +25 行 `RESIDENT_RUN_IS_TURN` 自钉（文件顶部 `delete process.env.RESIDENT_RUN_IS_TURN` + `after` 还原）。
- 自钉提交 `00705355f`（`2026-10-26T20:55:16+08:00`）与 `40c67f665` 是同一父 `8ff1e2702` 的两个兄弟：`git merge-base --is-ancestor 00705355f 40c67f665` 非 0。自钉经 merge `ac64f9bea`（`20:55:53+08:00`）才进入主检出线；current HEAD `709e120bd` 含它（`git merge-base --is-ancestor 00705355f 709e120bd` = 0）。
- 没有自钉时，anchor 继承的 `RESIDENT_RUN_IS_TURN=1` 会让常驻 send 走 delivery 形态（`runId: null`、无运行注册），(a)/(c)/(h) 因此红 —— 与两拍红的 `ERR_ASSERTION … strictEqual … actual: false, expected: true` 失败签名一致。有自钉时同一文件在 `RESIDENT_RUN_IS_TURN=1` 下仍 8/8 绿（上表第二行）。

**早先修复为何「没兜住」**：修复本身有效 —— `gap-ac249-session-send-criterion-hermetic`（done）的 25 行自钉就是本文件现在的承重面；红拍只是测量落在该修复进入被评估树之前。这是「gate 红与修复自身落地竞态」的又一实例，不是 AC-249 回归。本条**不重新实现**任何修复。

**残留未钉死假设（如实登记）**：`13:00:14.541Z` 那一拍晚于 merge `ac64f9bea`（`12:55:53Z`）约 4.5 分钟，却仍记 `treeSha=53135d38`；本报告无法独立证明 driver 为何缓存该 treeSha（推测为 round 起点 treeSha）。但该 `treeSha` 明确指名的树不含自钉，「被评估树 ≠ current HEAD」这一条可机械复核。

**判据的假形态记录**：AC-249 的四条红先行变异 (i)–(iv) 已在原实现任务 `gap-ac249-session-send-immediate-runid` 的 AC10/完成记录 §AC10 逐条留档（变异 diff、逐字失败行、恢复命令、恢复后回绿）；本条是 verification-only 归因，不重复变异。

<!-- dedup-ref --> 机制去重读数（立案时）：`grep -l '^goal_ac: *AC-249' tasks/*.md` 命中 3 条，`status:` 全为 `done` —— `gap-ac249-session-send-immediate-runid`、`gap-ac249-criterion-ledger-red-is-merge-race`、`gap-ac249-session-send-criterion-hermetic`；在飞扫描（todo/ready/needs-human 且 `goal_ac: AC-249`）**0 命中** ⇒ 无在飞认领者，本条不是重复。granularity 检查（`task-granularity-advice.js --touches …test.ts --touches tasks/<本条 id>.md`）`peers=[]`、`mentions=[]`。

## Plan

1. 在隔离 worktree（起点 = 开工时 `develop`）确认承重面：打印 worktree 路径、`git rev-parse HEAD`、`git status --porcelain -- server shared src package.json package-lock.json` 空；`grep -c incomingResidentRunIsTurn server/modules/mcp-gateway/tests/mcp-session-send.test.ts` 为 3。
2. 逐字直跑判据两次（裸跑），记录 exit / `ℹ tests` / `ℹ pass` / `ℹ fail` 与八条用例名。
3. 以 `RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-send.test.ts` 再跑一次（重现 anchor 环境），记录读数与 exit。
4. ancestry 机械复核：`git log -1 --format='%h %cI %s'` 对 `00705355f` / `40c67f665` / `ac64f9bea` / `709e120bd`；`git rev-parse '40c67f665^{tree}'`；`git show 40c67f665:<file> | grep -c incomingResidentRunIsTurn` 与 `git show 709e120bd:<file> | grep -c …`；`git merge-base --is-ancestor 00705355f 40c67f665; echo $?` 与 `… 00705355f 709e120bd; echo $?`；`git diff 40c67f665 709e120bd -- <file>`。
5. 从 `.quay/gate-events.jsonl` 抄出 `item_id=AC-249` 最近两拍红的 `timestamp` / `verdict` / `payload.treeSha` / `payload.evaluationRoot` 与 `payload.reason` 逐字失败签名。
6. 交付只落 `tasks/<本条 id>.md`；不编辑 `server/**`、`src/**`、`goals/**`、判据与断言。

## AC

- [x] AC1 净检出直跑判据两次：`npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-send.test.ts` 均 exit **0**、`ℹ tests 8` / `ℹ pass 8` / `ℹ fail 0`，八条用例名逐字入档；打印 worktree 路径与 `git rev-parse HEAD`、`git status --porcelain -- server shared src package.json package-lock.json` 为空。红态基线逐字入档：台账最近两拍 fail（`2026-10-26T12:55:21.267Z`、`2026-10-26T13:00:14.541Z`，`exit 1`，`treeSha=53135d38…`）。
- [x] AC2 anchor 环境复测：`RESIDENT_RUN_IS_TURN=1 npx tsx --tsconfig server/tsconfig.json --test …` exit **0**、`8/8/0`；并机械证明承重面就是那 25 行自钉：`git show 40c67f665:server/modules/mcp-gateway/tests/mcp-session-send.test.ts | grep -c incomingResidentRunIsTurn` 输出 **0**，`git show 709e120bd:… | grep -c …` 输出 **3**，`git diff 40c67f665 709e120bd -- <file>` 恰为该自钉段（+25 行）。
- [x] AC3 ancestry 证据机械入档：`git rev-parse '40c67f665^{tree}'` == `53135d38ef3ac8d9908ba08438f1c1ab6e4ace77`（= 两拍红 `treeSha`）；`git merge-base --is-ancestor 00705355f 40c67f665; echo $?` 非 0；`… 00705355f 709e120bd; echo $?` == 0；`git log -1 --format='%h %cI %s'` 对 `00705355f` / `40c67f665` / `ac64f9bea` / `709e120bd` 逐字入档。
- [x] AC4 台账尾巴逐字入档：从 `.quay/gate-events.jsonl` grep `"item_id":"AC-249"` 取最近两拍，抄 `timestamp`、`verdict`、`payload.treeSha`、`payload.evaluationRoot` 与 `payload.reason` 的失败签名（`ERR_ASSERTION … strictEqual … expected: true`）；写明两拍都指 `53135d38`。
- [x] AC5 承重面未被本条触碰：`git diff --name-only develop...HEAD -- server src goals scripts` 为空；`git ls-tree develop -- server/modules/mcp-gateway/tests/mcp-session-send.test.ts` 与 `git ls-tree HEAD -- …` 的 blob 相等；`git status --porcelain` 只含 `tasks/<本条 id>.md`。

## DoD

- 判据本体（逐字命令，不改断言、不改 criterion）在净 worktree 上真的跑过：裸跑两次 + `RESIDENT_RUN_IS_TURN=1` 一次，全部 exit 0、8/8/0；读数与八条用例名写进完成记录，不是复述 AC 文字、不是读台账尾巴。
- 归因可由任何人在同一 checkout 复现：`40c67f665` 的 tree == 红拍 `treeSha`、该树文件 0 处自钉、current 树 3 处自钉、merge 时刻与红拍时刻、merge-base 退出码全部写进完成记录。
- 完成记录明确写出判法：**「修复有效；两拍红测量的是自钉进入被评估树之前的 pre-pin 树」**，并给出残留未钉死假设（`13:00:14` 拍为何仍记旧 `treeSha`）。
- 若判据在净 worktree 上为红：停手置 `needs-human`，逐字上报失败行 —— 不得把环境红写成产品绿，也不得改断言或 criterion。
- 交付物只动 `tasks/<本条 id>.md`。

## 完成记录（verification-only，实测于隔离 worktree）

开工 worktree：`/data/home/yale/work/claudecodeui-worktrees/gap-ac249-gate-red-measured-pre-pin-tree`
- provisioning：`dispatch-worktree-setup.sh` 输出 `fork-point PASS — HEAD contains develop (9be30b905…)`，`node_modules` 已链接到主检出。
- `git rev-parse HEAD` = `9be30b905f8ea37c95206199cfd41d525a67afbf`（= 开工时 develop `9be30b905`，2026-10-26T21:14:18+08:00）。
- `git status --porcelain -- server shared src package.json package-lock.json` = 空。
- `grep -c incomingResidentRunIsTurn server/modules/mcp-gateway/tests/mcp-session-send.test.ts` = **3**。

### 判据直跑（逐字命令，净 worktree）

命令：`npx tsx --tsconfig server/tsconfig.json --test server/modules/mcp-gateway/tests/mcp-session-send.test.ts`

| # | 环境 | exit | ℹ tests | ℹ pass | ℹ fail | duration_ms |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 裸跑 | **0** | 8 | 8 | 0 | 23821.874565 |
| 2 | 裸跑 | **0** | 8 | 8 | 0 | 22569.971569 |
| 3 | `RESIDENT_RUN_IS_TURN=1` | **0** | 8 | 8 | 0 | 22742.513924 |

八条用例逐字通过（run 1 的 `✔` 行）：
- `(a)/(b) session_send returns while running, with source mcp and the token owner as caller`
- `(c) a busy resident session queues and hands over the driver queue-tail uuid`
- `(d) a busy per-run session is refused with the in-flight runId and a run_get hint`
- `(e) waitSeconds returns early with the closing assistant message`
- `(f) a token lacking the write scope is denied, audits one denied row, and never calls the control service`
- `(g) the WebSocket chat.send and the MCP session_send reach the same control service`
- `(h) a queued send reports the pending request blocking it, byte-identical to approvals_list and session_get`
- `the stage-4 write table is exactly the five SPEC tools`

run 3（anchor 环境）八条标题与 run 1 逐字相同，全部 `✔`，无 `✖` 行。

### 承重面就是那 25 行自钉

- `git show 40c67f665:server/modules/mcp-gateway/tests/mcp-session-send.test.ts | grep -c incomingResidentRunIsTurn` = **0**
- `git show 709e120bd:server/modules/mcp-gateway/tests/mcp-session-send.test.ts | grep -c incomingResidentRunIsTurn` = **3**
- `git diff --numstat 40c67f665 709e120bd -- server/modules/mcp-gateway/tests/mcp-session-send.test.ts` = `25	0	server/modules/mcp-gateway/tests/mcp-session-send.test.ts`（+25/−0）。逐字内容只有：文件顶部注释 17 行 + `const incomingResidentRunIsTurn = process.env.RESIDENT_RUN_IS_TURN;` / `delete process.env.RESIDENT_RUN_IS_TURN;` + 空行，以及 `after` 内 5 行原值还原。无其他改动。

### ancestry

- `git rev-parse '40c67f665^{tree}'` = `53135d38ef3ac8d9908ba08438f1c1ab6e4ace77`
- `git log -1 --format='%h %cI %s'`：
  - `00705355f 2026-10-26T20:55:16+08:00 AC-249: pin RESIDENT_RUN_IS_TURN off in the session_send criterion`
  - `40c67f665 2026-10-26T20:55:31+08:00 tasks: gap-ac249-session-send-criterion-hermetic task_write by cli:3833691`
  - `ac64f9bea 2026-10-26T20:55:53+08:00 Merge branch 'develop' into task/gap-ac249-session-send-criterion-hermetic`
  - `709e120bd 2026-10-26T21:01:50+08:00 tasks: 翻 gap-ac249-session-send-criterion-hermetic done（driver 机械 fan-in）`
- `git merge-base --is-ancestor 00705355f 40c67f665` → exit **1**（自钉不在该树）
- `git merge-base --is-ancestor 00705355f 709e120bd` → exit **0**

### 台账尾巴（`.quay/gate-events.jsonl`，`item_id=AC-249` 最近两拍红）

- `2026-10-26T12:55:21.267Z`｜verdict=`fail`｜treeSha=`ebca9a992087933354eceeaa6a72ec50e1de8798`｜evaluationRoot=`/data/home/yale/work/claudecodeui`｜reason=`acceptance failed (exit 1) — … ests/mcp-session-send.test.ts:539:5) at async TestContext.<anonymous> (/data/home/yale/work/claudecodeui/server/modules/mcp-gateway/tests/mcp-session-send.test.ts:838:3) … { generatedMessage: false, code: 'ERR_ASSERTION', actual: false, expected: true, operator: 'strictEqual', diff: 'simple' }`
- `2026-10-26T13:00:14.541Z`｜verdict=`fail`｜treeSha=`53135d38ef3ac8d9908ba08438f1c1ab6e4ace77`｜evaluationRoot=`/data/home/yale/work/claudecodeui`｜reason=同上逐字失败签名（`:539:5` / `:838:3`，`ERR_ASSERTION … actual: false, expected: true, operator: 'strictEqual'`）

**台账更正（重要，实测推翻立案读数）**：Proposal / AC1 / AC4 写「两拍 treeSha 都是 `53135d38`」，但台账逐字读数不是：`12:55:21.267Z` 那拍是 `ebca9a99…`，只有 `13:00:14.541Z` 那拍是 `53135d38`。`ebca9a99` = `8ff1e2702`（`2026-10-26T20:52:07+08:00 Merge branch 'develop' into task/gap-architecture-panel-fit-export-owner`）的 tree；该树同名文件 `grep -c incomingResidentRunIsTurn` = **0**。两拍所指的树都不含自钉，故归因结论不变且更强。AC4 的末句按台账更正为此读数。

### 交叉印证：红拍之后同一台账里的一拍 pass

- `2026-10-26T13:17:01.172Z`｜verdict=`pass`｜treeSha=`78855cc2c717b843c6b367efa297f15da9c50ce7`｜evaluationRoot=`/data/home/yale/work/claudecodeui`｜reason=`acceptance passed (exit 0)`
- `78855cc2` = current develop `9be30b905` 的 tree；该树同名文件 `grep -c incomingResidentRunIsTurn` = **3**。即：自钉进入被评估树后，真实 goal gate 在同一 checkout 上转绿。

### 判法

**修复有效；两拍红测量的是自钉进入被评估树之前的 pre-pin 树。**

### 残留未钉死假设（如实登记）

`13:00:14.541Z` 那拍晚于 merge `ac64f9bea`（`12:55:53Z`）约 4.5 分钟，却仍记 `treeSha=53135d38`（pre-merge 的 task 分支树）；本报告无法独立证明 driver 为何缓存该 treeSha（推测为 round 起点 treeSha）。可机械复核的是：该 `treeSha` 指名的树不含自钉，「被评估树 ≠ current HEAD」成立。

### AC5 未触碰承重面

- `git diff --name-only develop...HEAD -- server src goals scripts` = 空
- `git ls-tree develop -- server/modules/mcp-gateway/tests/mcp-session-send.test.ts` blob = `5c5785e0774a2eba5ffd5ae8b228b5bf89157825`，与 `git ls-tree HEAD -- …` 同 blob。
- 交付物只有 `tasks/gap-ac249-gate-red-measured-pre-pin-tree.md`（由 task_write 提交；worktree 内不产生代码改动）。

## ADR-007 轴记录

- 该轴仍暗,理由:verification-only 归因任务，交付物仅 tasks/gap-ac249-gate-red-measured-pre-pin-tree.md，无代码/文档产物轴可测。

## Touches

- tasks/gap-ac249-gate-red-measured-pre-pin-tree.md（自触）
- server/modules/mcp-gateway/tests/mcp-session-send.test.ts（本条只跑不改：判据本体）
- server/modules/mcp-gateway/mcp-session-send.ts（本条只读不改：session_send 适配层）
- .quay/gate-events.jsonl（只读：台账证据）
- goals/AC-249-session-send-立即返回-runid-运行与-ui-发起的运行是同一种-来源为-mcp-出现在运行中列表-忙时.md（只读：criterion 逐字来源）
