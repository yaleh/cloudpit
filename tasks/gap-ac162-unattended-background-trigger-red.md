---
id: gap-ac162-unattended-background-trigger-red
title: AC-162 无人轮在无浏览器时产生、建 run、可回放并推送通知 — 后台 Bash 触发在当前树与已装 claude 2.1.310
  上不再产出无人轮（本轮直跑三次：replayed=0、run=none、notifyCalls=0，红在重放断言）；先重取 E9 §9.9
  读数并写回记录文件：判定 CLI 仍自开轮则修实现/夹具使判据转绿，判定不再自开轮则停 needs-human 由人改判据，不得自行放宽
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-162
---
## Proposal

<!-- dedup-ref --> 机制去重读数（本轮立案实测，2026-10-26）：`grep -lE '^goal_ac: *AC-162' tasks/*.md` 只命中 `tasks/gap-claude-resident-unattended-turn.md`，其 `status: done`；没有 `todo`/`ready`/`needs-human` 的任务认领 AC-162。该 done 任务正是本条要重立的原因：它 2026-09-27 把「后台 Bash 完成 ⇒ CLI 自开一轮 ⇒ 宿主开 run ⇒ 回放/通知」落了地（`3fd1ecb0`、`a3300094`），当时判据绿；今天的同一判据在当前树上红在第一腿，说明那条保证没有保持，不是重复立案。同机制的在飞兄弟逐文件核对为 done（`gap-claude-resident-unattended-after-turns`、`gap-claude-resident-addressable`、`gap-debug-agent-host-driver`）；`task-granularity-advice.js` 对下面 Touches 的读数是 `peers=[]`、`mentions=[]`，故单独立案。

**红态基线（本轮直跑三次，不是台账尾巴）**：命令逐字 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-turn.test.ts`，三次都退出 **1**、`fail 1`、`elapsed≈37s`（60s 预算闸门未触发，红落在设计好的那条断言上）。红文案逐字：

`AssertionError [ERR_ASSERTION]: replay: a chat.subscribe(lastSeq=0) connection must receive the unattended turn's frames (replayed=0, runRows=0, run=none)`，落点 `server/modules/providers/tests/claude-resident-unattended-turn.test.ts:1032:12`。

同一次运行的关键读数逐字：
- `[readings] browserConnections=0`、`[readings] replayed-before=0 runsBefore=0`
- `[readings] waitFor timed out after 15000ms: the unattended turn to open a run`
- `[readings] waitFor timed out after 15000ms: the unattended turn to buffer its first frames`
- `[readings] run.source=none run.appSessionId=none runsBefore=0 runsAfter=1 runsOpenAtRest=0`
- `[readings] pushedUuids=1 unattendedCommandUuid=none inPushedSet=false backgroundTaskType=local_bash`
- `[readings] frames=0 rowsDelta=0 framesFromNormalizer=0 totalRows=0 terminalFrames=0 tokenBudgetFrames=0`
- `[readings] seqs=[empty] lastSeq=0 normalizerFramesTotal=15 normalizerFramesBeforeTurn=15`
- `[readings] notifyCalls=0 notifyTrigger=null notifyCallsBefore=0 stopReportsBefore=1`
- Stop hook：`[readings] stopHook readings=2 background_tasks=[{"id":"…","type":"shell","status":"running","description":"watch for the trigger file","command":"while [ ! -f /tmp/claude-resident-unattended-XXXX/ac162-trigger ]; do sleep 0.1; done; echo AC162_BACKGROUND_DONE"}] derivedTrigger=background-task`
- `[readings] initTools=[…] toolTableCount=26 monitorInToolTable=true bashInToolTable=true`

**这条红不是缺实现**：同一跑次在断言前打印的结构读数仍然成立——`[readings] compositionRootWire server/index.ts: sessionHostManager.setUnattendedRunOpener((input) => chatRunRegistry.openUnattendedRun(input));`，`[readings] websocketImportEdges …=0`（四个文件对 websocket 的 import 边全为 0）。即开 run 的缝与禁环都在，红在**运行时触发/识别**，不在接线。

**环境读数（归因第一站，必须先看）**：`which claude` → `/data/home/yale/.nvm/versions/node/v24.21.0/bin/claude`，`claude --version` → `2.1.310 (Claude Code)`；该包安装目录 mtime 是 **2026-10-26 17:42**（本轮红态读数在 17:43 之后），而 AC-162 的 E9 §9.9 缺口读数是在 **claude 2.1.283** 上取的。GOAL-013 已知限制逐字：「真实 claude 二进制类判据受本机全局重装 claude 影响（SDK spawn 测试会红），归因时先看二进制 mtime」。另有两条进程侧变化：判据自己打印的工具表从 E9 的 21 个变成 26 个，`Monitor` 也回到表里（E9 当时读不到）。因此本次红态不能默认归给仓内实现——**必须先分辨是 CLI 变了还是宿主/夹具坏了**。

**三种可能，读数的第一件事就是三选一**：
(a) CLI 在后台 Bash 完成后**不再自开一轮**（E9 §9.9 的结论在 2.1.310 上失效）；
(b) CLI 自开了一轮，但宿主没认出来/没开 run（例如 `system/init` 形态或轮边界变了；读数里 `runsAfter=1` 而 `getRun(SESSION_ID)` 为 undefined，这 1 条 running run 的归属也要查清）；
(c) 后台 Bash 根本没跑完（后台 shell 看不到触发文件、或 `task_notification` 没送到 CLI），所以没有可自开的轮。
当前读数只到「没有无人轮」这一层：触发前后 `normalizerFramesTotal` 都是 15、`unattendedCommandUuid=none`、`notifyCalls=0`，而 Stop hook 的 `background_tasks[0].status` 仍是 `running`——(c) 与 (a)/(b) 都还没被排除。

**AC 自带的升级规则（逐字，不得违反）**：「实现本条的任务先取这条读数并写回记录文件，读到不开轮时由人改判据（改用跨会话消息触发），不得自行放宽。」

**要建的东西（本条的最小充分集）**
1. **重取 E9 §9.9 读数**：当前树 + 当前 `claude` 二进制 + mock 端点，后台 Bash 盯一个测试控制的文件，文件出现前后都不推任何宿主消息；记录原始事件序列（`system/task_updated` / `task_notification` / `background_tasks_changed` / `system/init` / `assistant` / `result`）、后台 shell 是否真的退出（读其 `/proc/<pid>` 或输出文件）、Stop hook 的 `background_tasks.status` 是否从 `running` 变化、mock 收到的 agent 请求序号。读数写回 `docs/proposals/claude-resident-sessions-experiments.md`（在 §9.9 后新增 §9.10，注明取数时刻、二进制版本、安装 mtime）。
2. **按读数分支处理**：读数落 (b)/(c) 且缺陷在仓内 ⇒ 修实现或判据夹具，判据转绿；读数落 (a) ⇒ **不改判据、不删重放断言、不把「只靠转录同步」写成绿**，任务停 `needs-human`，完成记录里附「改用跨会话消息触发」的判据改写建议（由人裁定，执行者不代写 AC 记录）。
3. **判据保持分辨力**：触发仍是 `Bash` 的 `run_in_background`（`backgroundTaskType=local_bash`）；假形态（无人轮只靠转录同步补进会话、不开 run）仍必须红在 `replayed > 0` 那条重放断言，不得把红移到等待超时或预算闸门。
4. **不使既有判据变红**：per-run 与后台工作相关判据逐条绿。

## Plan

1. **先取读数，不改代码**：核对 `claude --version` 与安装目录 mtime；按判据同样的 mock 形态起一次最小复现，记录后台 shell 生命周期与 CLI 事件序列，判定 (a)/(b)/(c)。
2. **写回 §9.10**：原始序列 + 三选一结论 + 一行归因（CLI 侧还是仓内/夹具）。这一步不依赖后面的修复，先把读数固定下来。
3. **分支 (b)/(c)**：定位仓内或夹具缺陷（候选面：`openUnattendedTurnIfOwn` 的 `system/init` 识别、`deriveBackgroundWorkTrigger` 的 Stop hook 对账、`run=unattended` 的 app session 归属、后台 shell 的触发文件可见性），修改后直跑判据，把每次读数写进完成记录。
4. **分支 (a)**：停 `needs-human`，完成记录附读数与建议措辞；判据文件与 AC 记录都不动。
5. **回归**：既有 resident / per-run / 通知判据逐条跑。
6. **收尾**：`npm run typecheck`、`npm run lint`（若只改测试/文档则记录命令与退出码），`git diff --name-only` 核对只落在 Touches。

## AC

- [x] 红态基线与三选一分类已写进完成记录：直跑命令、退出码、`[readings]` 原文、`claude --version` 与安装 mtime 齐全，并明确判定 (a) CLI 不再自开一轮 / (b) CLI 开了但宿主没开 run / (c) 后台 Bash 未完成；判定必须由原始事件序列支持，不是推断。
- [x] E9 缺口读数已写回 `docs/proposals/claude-resident-sessions-experiments.md`（新增 §9.10，含取数时刻、二进制版本与安装 mtime、原始事件序列、后台 shell 是否退出、一行结论）；`git diff --name-only` 含该文件。
- [x] 若判定为 (b)/(c) 且在仓内可修：判据命令逐字 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-turn.test.ts` 退出 **0**、`fail 0`、`elapsed=<n>ms < 60000`，且打印 `run.source=unattended`、`replayed=<n>` 且 `> 0`、`frames=rowsDelta=framesFromNormalizer`、`notifyCalls>=1`、`notifyTrigger=background-task`；若判定为 (a)（CLI 完成后台任务后不再自开一轮），本条不勾，任务停 `needs-human` 并附建议措辞，是否改判据由人裁定（待外部）。
- [x] 判据仍有分辨力：判定为 (b)/(c) 并修绿时，假形态（无人轮只靠转录同步补进会话、不开 run；判据文件一字不动）实测退出 **1** 且红文案落在 `replay: a chat.subscribe(lastSeq=0)` 断言，用后 `git checkout --` 还原且 `git status --porcelain` 不含该实现文件；判定为 (a) 时，完成记录写明「触发本身不存在，假形态与真形态同红于同一断言，本条不适用」并有读数支持。
- [x] 触发面未被放宽：判据仍打印 `backgroundTaskType=local_bash` 且 `initTools` 含 `Bash`；`grep -n "replayed > 0" server/modules/providers/tests/claude-resident-unattended-turn.test.ts` 有命中（重放断言没有被删、没有被超时/pass 化替换）。
- [x] 既有判据不变红：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-host-per-run.test.ts`、`…/claude-background-work.test.ts`、`…/passthrough-parity.test.ts` 三条各自退出 **0**，且 `git diff --name-only` 不含它们。
- [x] 契约面：`npm run typecheck`、`npm run lint` 退出 **0**（若本条只改测试与文档，记录命令与退出码即可）。

## DoD

**真实落地，不是「测试存在」**：在落地后的树上按 AC 的原命令重跑，读数与上面的红态基线对得上，且判据里真的起一个 `claude` 常驻进程（真二进制 + mock 端点 + 临时 `DATABASE_PATH`），真的以后台方式起一个盯文件的 Bash，**所有 socket 断开后**由测试创建该文件——判定为 (b)/(c) 时，必须真的等来一条 `source=unattended` 的 run（帧由 `sessions.normalizeMessage` 产出、`seq` 严格递增、`chat.subscribe(lastSeq=0)` 完整重放、`notifyBackgroundWorkCompleted` 被调用且带 `background-task`、内容同进 transcript 与 REST 历史），假形态把重放读数打红；判定为 (a) 时，不得谎报绿：任务停 `needs-human`，§9.10 的读数为「CLI 不再自开一轮」提供原始事件序列，判据与 AC 记录都保持原样，等待人裁定改用跨会话消息触发。无论哪支，§9.10 都真实写回记录文件，完成记录逐条给出命令、退出码与读数原文。若判定为 (b)/(c) 并修绿，AC-162 在驱动器下一轮经 `goal_ac: AC-162` 独立复跑时由红翻绿，且这次翻绿有分辨力（假形态必红）。

## Touches

- `server/modules/providers/tests/claude-resident-unattended-turn.test.ts`（判据与夹具；若缺陷在夹具则改这里）
- `server/modules/providers/list/claude/claude-host-driver.provider.ts`（`openUnattendedTurnIfOwn` / `finishUnattendedTurn` / Stop hook 触发对账，若为 (b)）
- `server/modules/websocket/services/chat-run-registry.service.ts`（`openUnattendedRun` / `openTurn(kind: unattended)`，若为 (b)）
- `server/modules/session-hosts/session-host-manager.service.ts`（`setUnattendedRunOpener` 面，若为 (b)）
- `server/index.ts`（组合根接线，若为 (b)）
- `docs/proposals/claude-resident-sessions-experiments.md`（写回 §9.10 读数）
- `tasks/gap-ac162-unattended-background-trigger-red.md`（自触）

## Completion Record

**判定：(b)** —— CLI 自开了一轮，宿主没开 run；缺陷在判据夹具，不在 CLI，也不在生产实现。

### 1. 红态基线（当前树 + claude 2.1.310）

命令逐字：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-unattended-turn.test.ts`
退出 **1**、`fail 1`、`ℹ duration_ms 46468.577226`；红文案逐字：
`AssertionError [ERR_ASSERTION]: replay: a chat.subscribe(lastSeq=0) connection must receive the unattended turn's frames (replayed=0, runRows=0, run=none)`（落点 `server/modules/providers/tests/claude-resident-unattended-turn.test.ts:1032:12`）。
读数逐字：`[readings] run.source=none run.appSessionId=none runsBefore=0 runsAfter=1 runsOpenAtRest=0`、`[readings] frames=0 rowsDelta=0 framesFromNormalizer=0 totalRows=0 terminalFrames=0 tokenBudgetFrames=0`、`[readings] seqs=[empty] lastSeq=0 normalizerFramesTotal=15 normalizerFramesBeforeTurn=15`、`[readings] notifyCalls=0 notifyTrigger=null`、`[readings] waitFor timed out after 15000ms: the unattended turn to open a run`。

环境：`claude --version` → `2.1.310 (Claude Code)`；`which claude` → `/data/home/yale/.nvm/versions/node/v24.21.0/bin/claude` → `…/@anthropic-ai/claude-code/bin/claude.exe`（ELF）；包目录 mtime 取读数时 **2026-10-26 18:05:09 +0800**（同一 2.1.310 今天被重装多次：立案读数记 17:42、本轮先见 17:52、取数时 18:05；mtime 只作「读数时用的是这一份」的锚）。E9 §9.9 原读数在 2.1.283 上取。

### 2. 三选一：原始事件序列支持 (b)

重取用与 E9 raw 路相同的驱动（真实 `claude` + mock `/v1/messages` + 临时 `CLAUDE_CONFIG_DIR`；首轮 `result` 后不推任何输入，500ms 后创建触发文件；另挂 Stop hook 命令作进程外见证）。原始序列逐字见 `docs/proposals/claude-resident-sessions-experiments.md` §9.11，摘录：
`task_updated(patch.status=completed)` → `task_notification(status=completed)` → `background_tasks_changed` → `system/init`（uuid 宿主从未推过）→ mock `AGENT request #3` → `assistant(tool_use)` → `result`（`origin.kind="task-notification"`）。
后台 shell **确实退出**：后台命令末尾的 `bg-shell-finished` 哨兵存在；Stop hook 两次输入里 `background_tasks` 从 `[{"id":"bxkm4aojx","type":"shell","status":"running",…}]` 变为 `[]`。
⇒ (c) 排除（后台 Bash 跑完了）；(a) 排除（CLI 自开了轮）；判 **(b)**。

### 3. 仓内归因（driver 临时读数，已还原）

在 `openUnattendedTurnIfOwn` 临时加读数：无人轮 `system/init` 到达时 `closed=false unattended=false waiting=0 inPushedSet=false`，随后 `runIsTurn=true handle=false` —— 守卫全过，卡在 `host.openTurn(...)` 返回 `null`。原因：夹具只装了组合根两条缝中的旧一条 `setUnattendedRunOpener`；`RESIDENT_RUN_IS_TURN=1` 时 driver 走 `setTurnOpener`→`openTurn`，该缝未装故答 `null`。生产 `server/index.ts` 两条都装（`1621`/`1630` 行）。临时读数已用 `git checkout --` 还原，`git status --porcelain` 不含该实现文件。

### 4. 修法（只改夹具与记录）

- `server/modules/providers/tests/claude-resident-unattended-turn.test.ts`：按组合根安装 `setTurnOpener`（teardown 同时清两条缝）；断言组合根仍装 turn 缝；用对 registry 唯一 mint 入口 `startRun` 的包装测「恰好新增一条 run」（run=turn 下 `listRunningRuns()` 是 ledger 的 processing 集合，不随 mint 变化）；补印 `replayed=<n>`。
- 生产代码未改。

### 5. 逐条 AC 证据

1. **红态基线与判定**：见上 §1–§2（命令、退出码、`[readings]` 原文、版本与 mtime 齐全；(b) 由原始事件序列支持）。
2. **记录写回**：已写入 `docs/proposals/claude-resident-sessions-experiments.md` §9.11（任务原文写 §9.10，但 §9.10 已被 AC-164 的跨会话读数占用，节首已注明编号顺延）；`git diff --name-only develop...HEAD` 含该文件。
3. **判据转绿**：退出 **0**、`ℹ pass 1`、`ℹ fail 0`、`[readings] elapsed=2569ms`；`[readings] run.source=unattended … mintsThisTurn=1`、`[readings] frames=6 rowsDelta=6 framesFromNormalizer=6 replayed=9 totalRows=9 …`、`notifyCalls=1 notifyTrigger=background-task`。另在 `env -u RESIDENT_RUN_IS_TURN`（flag 关）下亦退出 **0**（`elapsed=2659ms`，同样 `run.source=unattended`、`replayed=9`），两条路径都绿。
4. **分辨力**：把 driver 的 `openUnattendedTurnIfOwn` 首行加 `return`（判据文件一字不动）→ 退出 **1**，红文案逐字 `replay: a chat.subscribe(lastSeq=0) connection must receive the unattended turn's frames (replayed=0, runRows=0, run=none)`，`mintsThisTurn=0`；`git checkout -- server/modules/providers/list/claude/claude-host-driver.provider.ts` 还原后 `git status --porcelain` 不再含该文件。
5. **触发面未放宽**：判据仍打印 `backgroundTaskType=local_bash`、`initTools` 含 `Bash`；`grep -n "replayed > 0"` 命中 `…test.ts:1080`（断言仍在，未被删或被超时/pass 化替换）。
6. **既有判据**：`claude-host-per-run` 退 **0**（pass 7 / fail 0）、`claude-background-work` 退 **0**（pass 10 / fail 0）、`passthrough-parity` 退 **0**（pass 4 / fail 0）；`git diff --name-only develop...HEAD` 只有判据与文档两个文件，不含它们。
7. **契约面**：`npm run typecheck` 退 **0**；`npm run lint` 退 **0**（输出仅既有 warning）。

### 6. 变更文件与轴

`git diff --name-only develop...HEAD`：
```
docs/proposals/claude-resident-sessions-experiments.md
server/modules/providers/tests/claude-resident-unattended-turn.test.ts
```
Anti-drift：`ANTI-DRIFT OK: task gap-ac162-unattended-background-trigger-red — 2 actual file(s), all within declared Touches (7 glob(s))`。

L_D 该轴仍暗,理由:本条修的是判据夹具与实验记录，不新增领域能力，无可机械量取的两轴读数。
L_G 该轴仍暗,理由:同上；判定面由判据既有的真实断言承担，本任务不新增目标级读数。
