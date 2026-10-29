---
id: gap-ac438-codex-resident-approvals-broker
title: AC-438 Codex 常驻：五类 server request 审批 broker（permission_request
  帧、accept/decline 路由、waitingOnApproval、无人值守不挂起）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac435-codex-resident-host-driver-persistent
goal_ac: AC-438
---
## Proposal

<!-- dedup-ref --> 机制去重与粒度（本轮实测，2026-10-29）：`grep -rl 'goal_ac: AC-438' tasks/` → **0** 个文件；`grep -ril 'requestApproval\|requestUserInput\|waitingOnApproval\|mcpServer/elicitation' tasks/` → **0** 个文件（Codex 侧没有任何审批实现或认领）。同 goal 的 `gap-ac435…` / `gap-ac436…` / `gap-ac437…` 只在正文里把审批面明确划出自己的范围（AC-436、AC-437 的“非目标”逐字写着“审批 broker（AC-438）”），它们都不认领它。Claude 侧的同类机制已由 `gap-claude-resident-permission-interception`（AC-168，status: done）落地，是本条的**形态先例而非重复**。

**来源与判据物。** criterion 逐字取自 `goals/AC-438-审批-broker-五类-server-request-accept-decline-无人值守不挂起.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-approvals.test.ts`。红态基线（本轮直跑，不是推断）：该命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-resident-approvals.test.ts'`。

**要建的东西**

1. **共享审批请求服务**：新建 `server/modules/providers/shared/base/approval-requests.service.ts`，从 `claude-runtime.provider.ts` 迁出 pending 注册表、held/decision 两个有界账本、`waitForToolApproval` 的 arming/超时/abort 逻辑与 `requestClientToolDecision`。`provider`、`timeoutMs` 是新参数；Claude 调用点不传时行为与今天逐字一致。**该文件第二轮从 `providers/services/` 移来**：`services` 已经导入 `list/codex/codex-transcript-format.js`，Codex 侧再静态导入 `services` 就会闭合成新的目录环（AC-394 ratchet），而 `providers/shared/base` 是 providers 组件的叶子，两个 provider 实现都可导入它且不进入 SCC。
2. **连接回写**（`codex-app-server.connection.ts`）：`respond(id, result)` / `respondError(id, code, message)`，id 原样回显（含数字 `0`）；`closed` / 进程已退出时 no-op 且不抛。
3. **Codex 驱动审批 broker**（`codex-approval-broker.ts` + `codex-host-driver.provider.ts` 接线）：五类方法分派与响应映射、无人值守判定、有界超时、生命周期清理、非审批 server request、`readSession()` 读数扩展。
4. **新判据** `server/modules/providers/tests/codex-resident-approvals.test.ts`（hermetic：内存假 transport + 固定假 pid；`resolveToolApproval` 走真实共享服务）。

## Plan

1. 抽出 `approval-requests.service.ts`（落点为 `providers/shared/base/`，见 Proposal 第 1 条），Claude 面保持原样 re-export。
2. 给 `codex-app-server.connection.ts` 加 `respond` / `respondError`。
3. 在 `codex-approval-broker.ts` 落地五类映射、等待/超时/生命周期清理，`codex-host-driver.provider.ts` 只做接线并保持 ≤800 行 ratchet。
4. 给 `codexRuntime` 加 permissions facet；用 `createProviderRuntimeService` 验证扇出。
5. 写判据：先打印每类帧/响应/读数，再收紧断言；跑 criterion 到 exit 0、`fail 0`。
6. 跑 Claude 回归（`claude-resident-permissions.test.ts`、`claude-turn-phase.test.ts`）、`codex-host-driver-persistent.test.ts`、`npm run typecheck`。
7. 实测 A/B/C/D 四个假形态。
8. `git diff --name-only` 核对只落在 Touches。

## AC

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-approvals.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 15`（实测 tests 18 / pass 18 / fail 0）。
- [x] AC2 连接回写帧：判据打印 `respondFrame={"jsonrpc":"2.0","id":7,"result":…}`、`respondErrorFrame={"jsonrpc":"2.0","id":8,"error":{"code":-32000,"message":"…"}}`、`zeroIdFrame={"jsonrpc":"2.0","id":0,"result":…}`；`closedNoop=true`。
- [x] AC3 五类都产生 `permission_request` 帧：每个 method 打印 `frames=1 provider=codex toolName=… inputMethod=… requestIdNonEmpty=true`；`parkedResponses=0`。
- [x] AC4 accept 路由：五类逐字响应断言通过；每类一条 `permission_resolved`，`pendingLeft=0`。
- [x] AC5 decline 路由：五类逐字响应断言通过；`turnContinued=true interrupts=0`。
- [x] AC6 cancel 映射：commandExecution/fileChange `{"decision":"cancel"}`、elicitation `{"action":"cancel",…}`、permissions/userInput 回落为 deny 形状；pid 不变、`interrupts=0`。
- [x] AC7 waitingOnApproval 状态：`parkedWaiting=true parkedPending=1 activeFlags=["waitingOnApproval"]` → `settledWaiting=false settledPending=0`；无人值守读数 `unattendedWaiting=false unattendedPending=0`。
- [x] AC8 无人值守不挂起：五类 `unattendedResponse=<拒绝形状> elapsedMs=0 frames=0`，均在 1000ms 内；5 条 `permission.unattended_refused`（provider `codex`）、pending 为空。
- [x] AC9 有界超时：`approvalTimeoutMs: 40`、有人但不应答 → `timeoutResponse={"decision":"decline"} elapsedMs=39 parked=false`，turn 继续。
- [x] AC10 非审批 server request：`currentTimeAt` 数字、`token` 字符串、未知 `{}`，均在 1000ms 内。
- [x] AC11 生命周期清理：`interruptAnswered={"decision":"cancel"} pending=0 pidBefore=424242 pidAfter=424242`；`unbindDrained=true`；`closeDrained=true afterCloseWrites=0`。
- [x] AC12 provider runtime 扇出：`fanoutSettled=true pendingViaRuntime=1 decisionRecorded=true secondResolveNoop=true`。
- [x] AC13 反向控制可达：两次 `negativeControlThrew=true`。
- [x] AC14 Claude 面零漂移：六个名字仍从原路径（`claude-runtime.provider.ts`）导入且与共享服务同源（4 个函数对象 `===`，`requestClientToolDecision` 为函数，`TOOL_APPROVAL_TIMEOUT_MS=55000`）；三个回归与 `npm run typecheck` 均 exit 0。
- [x] AC15 四个假形态承重：A/B/C/D 各让 criterion 退出 **1**（逐字红态见完成记录）；还原后 criterion exit 0、`git status --short` 无残留。
- [x] AC16 范围不越界：实现提交 `093ec0516` 恰为 7 个代码文件；第二轮收敛提交 `071ec532f` 只改该 7 个文件中的 5 个（含把共享服务从 `providers/services/` 移到 `providers/shared/base/`，旧路径在提交历史里按删除计入）、判据文件与两份 pin 文件（`server/shared/tests/quay-test-script.test.ts`、`scripts/suite-duration-baseline.tsv`），全部在 Touches 内；排除 grep 只命中 `codex-runtime.provider.ts`；`codex.provider.ts` / `provider-capabilities.service.ts` / `provider-runtime.service.ts` / `codex-app-server.client.ts` 零改动；退出前 anti-drift 读数为 `ANTI-DRIFT OK: task gap-ac438-codex-resident-approvals-broker — 11 actual file(s), all within declared Touches (11 glob(s))`（逐字读数见完成记录 (n)）。

## DoD

判据在落地后的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录见下。

## Touches

- server/modules/providers/shared/base/approval-requests.service.ts (new; moved here from providers/services/ in the convergence commit)
- server/modules/providers/services/approval-requests.service.ts (the pre-move path of that same file, deleted by the move — commit history still names it)
- server/modules/providers/list/codex/codex-approval-broker.ts (new)
- server/modules/providers/list/claude/claude-runtime.provider.ts
- server/modules/providers/list/codex/codex-app-server.connection.ts
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/list/codex/codex-runtime.provider.ts
- server/modules/providers/tests/codex-resident-approvals.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-ac438-codex-resident-approvals-broker.md

## 完成记录

**落地形态。** 共享服务 `approval-requests.service.ts`（355 行，唯一 owner 实例、`resolve` 幂等，第二轮落在 `providers/shared/base/`）；Codex 侧 `codex-approval-broker.ts`（五类方法表 + 纯映射 + broker，449 行，独占 writers/pending/notifications/threadStatuses）；driver 只做接线，`codex-host-driver.provider.ts` 800 行（ratchet ≤800 通过，`architecture-ratchet.test.ts` 6 pass / 0 fail）；连接新增 `respond`/`respondError`；`codexRuntime.permissions` 指向同一共享实例。

**判据读数（落地后重跑，merge develop 之后）。**

(a) 五类 `permission_request` 帧：
```
method=item/commandExecution/requestApproval frames=1 provider=codex toolName=commandExecution inputMethod=item/commandExecution/requestApproval requestIdNonEmpty=true
method=item/fileChange/requestApproval frames=1 provider=codex toolName=fileChange inputMethod=item/fileChange/requestApproval requestIdNonEmpty=true
method=item/permissions/requestApproval frames=1 provider=codex toolName=permissions inputMethod=item/permissions/requestApproval requestIdNonEmpty=true
method=mcpServer/elicitation/request frames=1 provider=codex toolName=mcpElicitation inputMethod=mcpServer/elicitation/request requestIdNonEmpty=true
method=item/tool/requestUserInput frames=1 provider=codex toolName=requestUserInput inputMethod=item/tool/requestUserInput requestIdNonEmpty=true
parkedResponses=0（每类回答前）
```

(b) accept 五条逐字：
```
accept commandExecution {"decision":"accept"}
accept fileChange {"decision":"accept"}
accept permissions {"permissions":{"network":{"enabled":true}},"scope":"session"}
accept mcpElicitation {"action":"accept","content":{"confirm":true},"_meta":null}
accept requestUserInput {"answers":{"q1":{"answers":["yes"]}}}
permissionResolvedFrames=5 pendingLeft=0
```

(c) decline 五条逐字：
```
decline commandExecution {"decision":"decline"}
decline fileChange {"decision":"decline"}
decline permissions {"permissions":{},"scope":"turn"}
decline mcpElicitation {"action":"decline","content":null,"_meta":null}
decline requestUserInput {"answers":{}}
turnContinued=true interrupts=0
```

(d) cancel 映射与 pid/turn：
```
cancelMappings=[commandExecution={"decision":"cancel"};fileChange={"decision":"cancel"};permissions={"permissions":{},"scope":"turn"};mcpElicitation={"action":"cancel","content":null,"_meta":null};requestUserInput={"answers":{}}]
pidBefore=424242 pidAfter=424242 interrupts=0
```

(e) waiting 读数：
```
parkedWaiting=true parkedPending=1 activeFlags=["waitingOnApproval"]
settledWaiting=false settledPending=0
unattendedWaiting=false unattendedPending=0
```

(f) 无人值守五条：
```
method=item/commandExecution/requestApproval unattendedResponse={"decision":"decline"} elapsedMs=0 frames=0
method=item/fileChange/requestApproval unattendedResponse={"decision":"decline"} elapsedMs=0 frames=0
method=item/permissions/requestApproval unattendedResponse={"permissions":{},"scope":"turn"} elapsedMs=0 frames=0
method=mcpServer/elicitation/request unattendedResponse={"action":"decline","content":null,"_meta":null} elapsedMs=0 frames=0
method=item/tool/requestUserInput unattendedResponse={"answers":{}} elapsedMs=0 frames=0
unattendedNotifications=5 providers=["codex"] pending=0
```

(g) 有界超时：
```
timeoutResponse={"decision":"decline"} elapsedMs=39 parked=false
```

(h) 非审批三条：
```
currentTimeResponse={"currentTimeAt":1793284486}
attestationResponse={"token":""}
unknownResponse={}
auxiliaryElapsedMs=0
```

(i) 生命周期清理：
```
interruptAnswered={"decision":"cancel"} pending=0 pidBefore=424242 pidAfter=424242 interrupt=true
unbindAnswered={"decision":"cancel"} unbindDrained=true
closeAnswered={"decision":"cancel"} closeDrained=true afterCloseWrites=0
```

(j) provider-runtime 扇出与幂等：
```
fanoutSettled=true pendingViaRuntime=1 decisionRecorded=true secondResolveNoop=true
```

(k) 两个反向控制：
```
negativeControlThrew=true
negativeControlThrew=true
```

(l) A/B/C/D 四次假形态（每次临改实现 → 跑 criterion → 还原）：
```
A（无人值守静默不回）exit 1；逐字红态：
  Error: timed out waiting for the unattended answer
  Error: timed out waiting for commandExecution unattended answer
B（帧标 claude）exit 1；逐字红态：
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  'claude' !== 'codex'
  （AC3 五条同时红）
C（accept/decline 反向）exit 1；逐字红态：
  accept commandExecution {"decision":"decline"}
  decline commandExecution {"decision":"accept"}
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
    +   decision: 'decline'
    -   decision: 'accept'
D（waitingOnApproval 不清）exit 1；逐字红态：
  Error: timed out waiting for the cleared status
```
还原后 criterion 重跑 exit **0**、`pass 18 / fail 0`；`git status --short` 只剩任务的 7 个文件（3 新增 + 4 修改），无临改残留。

(m) Claude 三个回归与 typecheck：
```
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-resident-permissions.test.ts  → exit 0（tests 2 / pass 2 / fail 0）
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/claude-turn-phase.test.ts          → exit 0（tests 11 / pass 11 / fail 0）
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts → exit 0（tests 5 / pass 5 / fail 0）
npm run typecheck → exit 0（tsconfig / server/tsconfig / scripts/tsconfig 全过）
npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts → exit 0（6 pass / 0 fail，driver 800 行在 OVERSIZE_LIMIT 内）
```

**AC16 范围读数（合并后如实记录）。** 本任务的实现提交是 `093ec0516`；`git show --name-only --format= 093ec0516` 恰为 7 个代码文件：
```
server/modules/providers/list/claude/claude-runtime.provider.ts
server/modules/providers/list/codex/codex-app-server.connection.ts
server/modules/providers/list/codex/codex-approval-broker.ts
server/modules/providers/list/codex/codex-host-driver.provider.ts
server/modules/providers/list/codex/codex-runtime.provider.ts
server/modules/providers/services/approval-requests.service.ts
server/modules/providers/tests/codex-resident-approvals.test.ts
```
排除 grep 在该提交上只输出 `server/modules/providers/list/codex/codex-runtime.provider.ts` 一行；该文件的 diff 只增 `permissions` facet 与 import。`codex.provider.ts` / `provider-capabilities.service.ts` / `provider-runtime.service.ts` / `codex-app-server.client.ts` 在本提交中零改动。第二轮收敛提交 `071ec532f` 只触及上列文件中的 5 个 + 判据 + 两个 pin 文件，并把这 7 个里的共享服务移到 `providers/shared/base/`（旧路径作为删除仍出现在 task-owned 提交历史里，故两条路径都写进 Touches）。fan-in 的 anti-drift Touches 检查以 merge-target 计读数并通过，见 (n)。

(n) 第二轮（2026-10-29，上一轮 exited-not-landed 的三条 suite 红）逐条定位与修复读数。

1. `server/shared/tests/server-import-cycle-budget.test.ts` (b)：实测 SCC 为 `[modules/providers, modules/providers/list/claude, modules/providers/list/codex, modules/providers/services]`，比钉住的 G1 多出 `list/codex`。根因是本任务新增的 `list/codex -> providers/services` 值导入与既有的 `services -> list/codex` 边（`session-conversations-search.service.ts` 导入 `codex-transcript-format.js`）合成了一个新目录环。修法不是抬基线，而是把共享服务移到 `providers/shared/base/`（providers 组件的叶子：出边只有 `server/shared/**`、`modules/notifications` 与自身）；不新增目录、不改 manifest/pin。移动后单文件读数：`(b) static+dynamic SCC[3] server/modules/providers, server/modules/providers/list/claude, server/modules/providers/services`，`11 pass / 0 fail`。
2. `server/shared/tests/quay-test-script.test.ts` AC2/AC3：本任务新增判据文件使收集数 470→471，两条 pin 实读 `known=3 unknown=468` / `known=1 unknown=470`（旧钉 467 / 469）。按该文件既有记账惯例把 pin 移到 468/470，并在注释里记下本任务的 +1；`scripts/suite-duration-baseline.tsv` 追加本判据一行（实测 `duration_ms=6495`），数据行 424→425 / 471 = 90.2%（地板不破）。单文件复跑 `14 pass / 0 fail`（90.2s）。
3. `lint`：fan-in 汇总行显示的是相邻告警，逐行日志里的真因是本任务判据第 841 行 `claudeRuntime[name]` —— 对导入命名空间的计算属性读取触发 oxlint `import(namespace)` **error**。改为四条静态属性断言（行为不变，`console.log` 仍打印同一 `claudeNames=...` 行），`npm run lint` rc=0、0 error。

移动后复跑：criterion `18 pass / 0 fail`（`duration_ms=6495`）；`claude-resident-permissions` 2/2、`claude-turn-phase` 11/11、`codex-host-driver-persistent` 5/5、`architecture-ratchet` 6/6；`npm run typecheck` rc=0。

**ADR-007 记录。**
该轴仍暗,理由:本任务只落地 server 侧 Codex 审批 broker 与判据，未产生可视 UX 读数（浏览器 UI 属 AC-443）。

## Blocker

**2026-10-29T14:59:24.034Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/shared/tests/server-import-cycle-budget.test.ts:   AssertionError [ERR_ASSERTION]: the measured cycles must match the pinned baseline groups member-for-member [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the goal/GOAL-051 baseline red set: added=lint,server/shared/tests/quay-test-script.test.ts,server/shared/tests/server-import-cycle-budget.test.ts,lint,server/shared/tests/quay-test-script.test.ts,server/shared/tests/server-import-cycle-budget.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：a5c7ad80-0d95-4b2a-8455-446d79858395
- 处置：已在本轮 (n) 逐条修复（共享服务移入叶子目录、两条 pin 重测、lint 错改静态断言）。