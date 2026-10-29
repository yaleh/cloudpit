---
id: gap-ac439-codex-resident-background-leases
title: AC-439 Codex 常驻：processHandle 后台 lease
  账本（process/spawn→process/exited），thread/backgroundTerminals/list 不是 client
  进程账本
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac435-codex-resident-host-driver-persistent
goal_ac: AC-439
---
## Proposal

<!-- dedup-ref --> 机制去重与粒度（本轮实测，2026-10-29）：`grep -rl 'goal_ac: AC-439' tasks/` → **0** 个文件；`grep -ril 'processHandle\|process/spawn\|process/exited\|backgroundTerminals' tasks/` → 仅 `gap-ac436-codex-resident-queue-busy-input.md` / `gap-ac437-codex-resident-live-settings.md` / `gap-ac438-codex-resident-approvals-broker.md` 的正文把 background lease 明确划出自己的范围，没有一条认领它。`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/providers/list/codex/codex-background-lease-ledger.ts --touches server/modules/providers/list/codex/codex-host-driver.provider.ts --touches server/modules/providers/tests/codex-resident-background-leases.test.ts --json` 返回 peers `[gap-ac435…（共享 driver）, gap-ac436…, gap-ac437…, gap-ac438…（都只共享 driver）]`、mentions `[]`。**决定：separate，不 merge** —— 本条有独立判据文件与独立验收（进程账本 ≠ 队列 / 实时设置 / 审批），长驻 driver 由 gap-ac435 产出；与 AC-436/437/438 只共享 driver，由调度器按 Touches 串行。关系边用顶层 `depends_on` 登记（SQL 关系边，不是散文前置）。

**来源与判据物。** criterion 逐字取自 `goals/AC-439-后台-lease-processhandle-账本-不依赖-backgroundterminals-list.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-background-leases.test.ts`。红态基线（本轮直跑，不是推断）：该命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-resident-background-leases.test.ts'`。

**现状（本轮读的读数）**

- `server/modules/providers/list/codex/codex-app-server.connection.ts`（gap-ac435 分支 `90901930f`）已有 `request` / `notify` / `onNotification` / `onServerRequest` / `onExit` / `pid`，通知帧全量分发给订阅者。**没有任何 process 面的封装**。
- `server/modules/providers/list/codex/codex-host-driver.provider.ts` 的 `handleNotification` 第一道闸是 `if (!isRecord(params) || typeof params.threadId !== 'string') return;`（约 342 行）⇒ `process/exited`、`process/outputDelta` 这类**不带 threadId** 的进程通知今天被静默丢弃；`ResidentSession` 也只有 thread/turn 字段，没有 lease 账本。
- sink ABI（`server/shared/interfaces.ts:321`）只有 `leaseAdded(appSessionId, lease)` 与 `leaseRemoved(appSessionId, kind)`；manager 端 `addLease` 以 `(kind,id)` 为键替换、`removeLease` **按 kind 删除该 kind 的全部**（`session-host-manager.service.ts:851,876`）。⇒ 多 handle 账本只释放其中一个 handle 时，driver 必须先 `leaseRemoved(kind)`、再把存活者以**原 `since`** 逐个 `leaseAdded` 回去；否则 manager-view 要么残留已退出 handle，要么把存活者的 `since` restamp。两步必须在同一同步回合完成（中间不 await），否则空闲关闭窗口可能先到。
- 协议读数来自 `tmp/codex-appserver-exp-NuPHhk/REPORT.md` E5 与 `e5-reading.json`（锁定版 `@openai/codex 0.153.4`）：`process/spawn` 的 `processHandle` **由 client 提供**（请求参数，不是返回值）；短进程收到 `process/outputDelta {deltaBase64}` 后收到 `process/exited {processHandle, exitCode:0}`；长进程 `process/kill {processHandle}` 回 `{}`，随后 `process/exited {exitCode:137}`；两次 `thread/backgroundTerminals/list {threadId}` 都返回 `{data:[]}` —— **client 进程不在该列表里**（REPORT：「process/spawn 是 client-owned 进程 API；thread/backgroundTerminals/list 是 agent-owned 后台终端账本」）。

**要建的东西**

1. `server/modules/providers/list/codex/codex-background-lease-ledger.ts`（new）—— `processHandle` 账本。`createCodexBackgroundLeaseLedger({ now? })` 返回一个闭包持有 `Map<appSessionId, Map<processHandle, CodexBackgroundLease>>` 的 typed object（无模块级可变状态）：`add(appSessionId, processHandle)`（同一 handle 幂等，保留首次 `since`；新 handle 用注入时钟打 `since`）、`release(appSessionId, processHandle)`（**只删该 handle**，返回 `{ released, remaining }`，remaining 稳定排序）、`releaseAll(appSessionId)`（删全部并返回被删 lease，用于进程退出/关闭，保证不泄漏）、`list(appSessionId)`（稳定排序读数）。导出 `CodexBackgroundLease = { processHandle: string; since: number }`。
2. `server/modules/providers/list/codex/codex-host-driver.provider.ts` —— 薄接线（账本逻辑留在上面那个 sibling 文件，避免把已超行的 driver 继续堆大）：
   - `spawnBackgroundProcess(appSessionId, spec)`：`processHandle = spec.processHandle ?? 本实例自增 'bg-<n>'`；发 `process/spawn`，params 只写 `processHandle`、`command` 与 spec 里实际给出的 `cwd` / `streamStdoutStderr` / `streamStdin` / `outputBytesCap` / `timeoutMs`；**请求成功后才** `ledger.add` 并 `sink.leaseAdded(appSessionId, { kind:'background-task', id: handle, since })`；请求失败不留账、不报 lease。E5 帧序是 spawn 响应先于 `process/exited`，故不引入 pending 态。
   - `readBackgroundLeases(appSessionId)`：返回 ledger 的稳定读数（判据与调用方都读它）。
   - 通知分派在 threadId 过滤**之前**拦 `process/exited`：从 params 取 `processHandle`，在会话表里找到持有它的那一个 → `ledger.release`；释放成功则同一同步回合 `sink.leaseRemoved(appSessionId,'background-task')`，再对 `remaining` 逐个 `sink.leaseAdded(…{ id, since })`。`process/outputDelta` 本条不建账、不转写（帧归一化属 AC-440）。
   - `handleExit`（进程自行退出）与 `closeHost`（manager 关闭）：对每个会话 `releaseAll`；进程自行退出后不再报 `leaseAdded`。
3. `server/modules/providers/tests/codex-resident-background-leases.test.ts`（new；hermetic：复用 AC-435 形态的可注入内存假 transport，固定假 pid，不 spawn 真 codex、不碰 DB/网络）。假 transport 实现 `initialize`、`thread/start`、`turn/start`、`process/spawn`（成功回 `{}`；按测试指令回 JSON-RPC error）、`process/kill`（回 `{}`，**不自动发 exited**）、`thread/backgroundTerminals/list`（按测试指令回 `{data:[]}` 或一条 agent-owned 行），并能主动发 `process/exited {processHandle, exitCode}` 与 `process/outputDelta`；记录方法调用序列与每次 params。假 sink 记录 `leaseAdded`/`leaseRemoved`，并用与 `session-host-manager.addLease/removeLease` 相同的语义重放出一份 manager-view（`(kind,id)` 替换、按 kind 全删、lease 自带 `since` 优先），使断言比较的是「driver 报给 manager 的集合」而不只是调用次数。
4. 非目标：不扩展 `IProviderHostDriver` / `IProviderHostDriverSink`（不把 remove 变成按 id，也不动 manager）；不挂 `codex.provider.ts` 的 `hostDriver`、不改 capabilities（AC-441/442）；不做 queue / settings / approvals / restore / E2E（AC-436…AC-438、AC-440、AC-443）；不改 per-run `codex-runtime.provider.ts`、fork 客户端 `codex-app-server.client.ts`；不把 `process/outputDelta` 归一化成 UI 帧。

**两个假形态（实测，只改实现不改判据文件）**

- A 把 `thread/backgroundTerminals/list` 当账本：`spawnBackgroundProcess` 不写 ledger，`readBackgroundLeases` 改成读该列表（假 transport 回 `[]`）⇒ criterion 退出 **1**，红在「spawn 后应持 1 条 lease」。
- B 用单一布尔/按 kind 的账本：任一 `process/exited` 就清空该会话全部 background-task ⇒ criterion 退出 **1**，红在「只释放退出的 handle，另一个仍在」。

两次退出码与红态文案抄进完成记录，随后 `git checkout --` 还原并确认 `git status --short` 只剩 Touches。

## Plan

1. 读 gap-ac435 分支的 `codex-app-server.connection.ts` / `codex-host-driver.provider.ts` 与 `REPORT.md` E5 / `e5-reading.json`，确认 process 帧的 params（`processHandle` 由 client 给）与 `thread/backgroundTerminals/list` 的空读数出处。
2. 写 `codex-background-lease-ledger.ts`：闭包账本、注入时钟、按 handle 释放、releaseAll、稳定排序。
3. 接线 driver：`spawnBackgroundProcess`、`readBackgroundLeases`、`process/exited` 抢在 threadId 过滤前、release+re-add 存活者的同步回合、`handleExit`/`closeHost` 的 releaseAll。
4. 写判据：假 transport + 假 sink（含 manager-view 重放）+ (a)…(g) 七组腿；先单跑打印方法序列与每步 ledger/manager-view，再收紧断言。
5. 跑 criterion 至退出 0；跑 `codex-host-driver-persistent.test.ts`、`npm run typecheck`。
6. 实测 A/B 两个假形态（临改实现 → 退出 1 → 记录文案 → 还原），确认 diff 只落在 Touches。

## AC

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-background-leases.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 7`。红态基线已测：同命令当前 exit 1、文案逐字 `Could not find 'server/modules/providers/tests/codex-resident-background-leases.test.ts'`。
- [x] AC2 spawn 建账：以显式 handle `bg-1` 调 `spawnBackgroundProcess`，打印 `handle=bg-1 spawnParams=… ledger=… leaseAdded=…`；`process/spawn` 的 `params.processHandle == 'bg-1'`、`params.command` 与 spec 逐字相等；`readBackgroundLeases` 恰 1 条且 id 为 `bg-1`、`since == 注入时钟的 1000`；sink `leaseAdded` 恰 1 次、payload `{kind:'background-task',id:'bg-1',since:1000}`。
- [x] AC3 spawn 失败不建账：假 transport 对 `process/spawn` 回 JSON-RPC error，`spawnBackgroundProcess` 必须 reject；打印 `spawnError=… ledger=[] leaseAdded=0`；`readBackgroundLeases` 为空且 sink 没有 `leaseAdded`。
- [x] AC4 按 handle 释放：先后 spawn `bg-1`（t=1000）与 `bg-2`（t=2000）；发 `process/exited {processHandle:'bg-1', exitCode:0}` 后打印 `ledger=[bg-2 since=2000] managerView=[bg-2 since=2000]`；两者都只含 `bg-2` 且 `since` 仍是 2000（证明 re-add 带原 `since`，没有用假时钟 9999 restamp），`bg-1` 不在任何读数里。
- [x] AC5 list 不是账本：`bg-1` 存活、假 `thread/backgroundTerminals/list` 回 `{data:[]}`；打印 `listCalls=0 listData=[] ledger=[bg-1]`；driver 从未调用 `thread/backgroundTerminals/list`（调用计数 0），且 ledger 仍持有 `bg-1`。
- [x] AC6 kill 响应不释放：`process/kill {processHandle:'bg-1'}` 回 `{}` 但假 transport 暂不发 `process/exited`；kill resolve 后打印 `afterKill=[bg-1]`；随后发 `process/exited {processHandle:'bg-1', exitCode:137}` 打印 `afterExited=[]`；两读数按上列值断言。
- [x] AC7 进程退出清空全部：`bg-1`/`bg-2` 存活后假 transport `die('signal')`；打印 `released=[bg-1,bg-2] ledgerAfterExit=[] leaseAddedAfterExit=0`；每个 handle 恰被释放一次，退出后 ledger 为空且不再出现 `leaseAdded`。
- [x] AC8 反向控制可达：把同一组 `process/exited` 帧喂给一个「以 `thread/backgroundTerminals/list` 为账本」的参考读数（假 list 回 `[]`，另一次回一条 agent-owned 行），打印 `listBased=0 handleBased=1 rejected=true`；同一个 `assertLeaseHeld` 对 list-based 读数必须 reject，证明主读数不是恒真。
- [x] AC9 假形态 A 承重（list 当账本）：临时把实现改成以 `thread/backgroundTerminals/list` 为账本，criterion 退出 **1**，逐字记录红态文案；还原后 `git status --short` 无残留。
- [x] AC10 假形态 B 承重（不按 handle 释放）：临时改成任一 `process/exited` 清空该会话全部 background-task lease，criterion 退出 **1**，逐字记录红态文案；还原后 `git status --short` 无残留。
- [x] AC11 生产实现不引用该列表：`grep -rn 'backgroundTerminals' server/modules/providers/list/codex/` 输出为空（假 transport 在 `tests/` 下，不在此目录）；与 AC5 的 `listCalls=0` 一起从静态面与行为面钉住同一条约束。
- [x] AC12 接口与类型：测试内 `const conformance: IProviderHostDriver = driver` 随 `npm run typecheck` 通过（退出 0）；打印 `multiplexedHost=false`；`codex-background-lease-ledger.ts` 无模块级 `let`/可变缓存（账本状态在工厂闭包内）。
- [x] AC13 无回归：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 0；`npm run typecheck` 退出 0。
- [x] AC14 范围不越界：`git diff --name-only develop...HEAD` 仅含 Touches 列出的文件；`git diff --name-only develop...HEAD | grep -E 'codex\.provider\.ts|provider-capabilities\.service\.ts|provider-runtime\.service\.ts|codex-runtime\.provider\.ts|codex-app-server\.client\.ts|session-host-manager\.service\.ts|shared/interfaces\.ts'` 输出为空。
- [x] AC15 如实登记：完成记录写明假 transport 与假 sink（含 manager-view 重放）形态、锁定协议版本（0.153.4）、E5 的帧序与 `thread/backgroundTerminals/list` 空读数出处、A/B 两个假形态的实测退出码与逐字红态文案、以及未实现项（host driver 挂载、capabilities、queue/settings/approvals、outputDelta 归一化、restore/E2E）。

## DoD

判据在完成时的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录里贴出 (a) `bg-1` 的 spawn params 与 ledger/leaseAdded 读数、(b) spawn 失败后的空账本、(c) 两个 handle 中只释放一个后的 ledger 与 manager-view（含 `since` 保持 2000）、(d) `listCalls=0` 与 list 的空读数、(e) kill 前后与 exited 前后的 ledger、(f) 进程退出后的清空与释放次数、(g) list-based 参考被同一断言 reject 的判定、(h) A/B 两个假形态的退出码与逐字红态文案。`codex-host-driver-persistent.test.ts` 与 `npm run typecheck` 退出 0。改动只落在 Touches；`codex.provider.ts` / capabilities / `provider-runtime.service.ts` / per-run runtime / fork client / `session-host-manager.service.ts` / `shared/interfaces.ts` 零改动。完成后 goal driver 下一轮以 `goal_ac: AC-439` 独立复跑原 criterion 时由红翻绿；且翻绿有分辨力：把 `thread/backgroundTerminals/list` 当账本的变体必红，不按 processHandle 释放的变体必红。


## 完成记录

**判据重跑（完成时的树：worktree `task/gap-ac439-codex-resident-background-leases`，已 merge develop，merge commit `d312d31cc`）**

- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-background-leases.test.ts` → exit **0**，`pass 8` / `fail 0`（要求 `pass >= 7`）。
- `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` → exit **0**，`pass 5` / `fail 0`。
- `npm run typecheck` → exit **0**。

**实现**

- 新增 `server/modules/providers/list/codex/codex-background-lease-ledger.ts`：`createCodexBackgroundLeaseLedger({ now? })` 返回闭包持有 `Map<appSessionId, Map<processHandle, CodexBackgroundLease>>` 的 typed object；`add` 同 handle 幂等并保留首次 `since`，`release` 只删该 handle 并返回 `{released, remaining}`（remaining 按 handle 稳定排序），`releaseAll` 删全部并返回被删项，`list` 稳定排序。无模块级 `let`／可变缓存（判据打印 `moduleMutableState=0` 一并机械钉住）。
- `codex-host-driver.provider.ts` 薄接线：`spawnBackgroundProcess`（`process/spawn` 成功后才 `ledger.add` + `leaseAdded`）、`killBackgroundProcess`（只发 `process/kill`，不释放——释放只认 `process/exited`）、`readBackgroundLeases`；`handleNotification` 在 threadId 过滤**之前**拦 `process/exited`，释放成功后同一同步回合先 `leaseRemoved(appSessionId,'background-task')`、再按原 `since` 逐个 re-add 存活者；`handleExit`／`unbind`／`closeHost` 走 `releaseAll`。没有扩展 `IProviderHostDriver`／`IProviderHostDriverSink`，没有改 manager。

**判据形态**

- 假 transport：内存 JSON-RPC，固定假 pid `4242424`，不 spawn 真 codex、不碰 DB／网络；实现 `initialize`、`thread/start`、`thread/resume`、`process/spawn`（成功回 `{}`，`spawnError` 时回 JSON-RPC error）、`process/kill`（回 `{}` 且**不自动发 exited**）、`thread/backgroundTerminals/list`（按测试指令回 `{data:[…]}`），并能主动发 `process/exited {processHandle, exitCode}` 与 `process/outputDelta`；记录每次 method 与 params。
- 假 sink：记录 `leaseAdded`／`leaseRemoved`，并按 `session-host-manager.addLease/removeLease` 的语义重放 manager-view（`(kind,id)` 替换、按 kind 全删、lease 自带 `since` 优先），断言比较的是「driver 报给 manager 的集合」而不只是调用次数。
- 锁定协议版本 `@openai/codex 0.153.4`；E5 帧序：`process/spawn`（`processHandle` 由 client 给）→（短进程）`process/outputDelta {deltaBase64}` → `process/exited {exitCode:0}`；长进程 `process/kill` 回 `{}` → `process/exited {exitCode:137}`；两次 `thread/backgroundTerminals/list {threadId}` 都返回 `{data:[]}`（出处 `tmp/codex-appserver-exp-NuPHhk/REPORT.md` E5 与 `e5-reading.json`）。

**DoD 读数**

- (a) `handle=bg-1 spawnParams={"processHandle":"bg-1","command":["bash","-lc","sleep 6; echo BG_DONE"],"cwd":"/fake/workspace","streamStdoutStderr":true} ledger=[bg-1 since=1000] leaseAdded=1 payload=[{"kind":"background-task","id":"bg-1","since":1000}]`
- (b) `spawnError=spawn refused: command not allowed ledger=[] leaseAdded=0`
- (c) `ledger=[bg-2 since=2000] managerView=[bg-2 since=2000]`（时钟 1000→2000，发 `process/exited` 前把注入时钟推进到 9999，`since` 仍是 2000）
- (d) `listCalls=0 listData=[] ledger=[bg-1 since=1000]`
- (e) `afterKill=[bg-1 since=1000]` / `afterExited=[]`
- (f) `released=[bg-1,bg-2] ledgerAfterExit=[] leaseAddedAfterExit=0`（manager-view 的 removedHandles 恰为 `bg-1`、`bg-2` 各一次；该会话只报一次 kind 级 `leaseRemoved`）
- (g) `listBased=0 handleBased=1 rejected=true agentOwned=agent-terminal-1 agentRowRejected=true`（同一 `assertLeaseHeld` 对 list-based 读数与 agent-owned 行都 reject）
- (h) 假形态 A：criterion exit **1**（`pass 2` / `fail 6`），首红逐字见下；假形态 B：criterion exit **1**（`pass 7` / `fail 1`，唯一红在 AC4）；两次还原后 `git status --short` 为空。

假形态 A 首红（AC2，逐字）：

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

+ []
- [
-   {
-     processHandle: 'bg-1',
-     since: 1000
-   }
- ]
    actual: [],
    expected: [ { processHandle: 'bg-1', since: 1000 } ],
    operator: 'deepStrictEqual'
```

假形态 B 唯一红（AC4，逐字）：

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
+ actual - expected

+ []
- [
-   {
-     processHandle: 'bg-2',
-     since: 2000
-   }
- ]
    actual: [],
    expected: [ { processHandle: 'bg-2', since: 2000 } ],
    operator: 'deepStrictEqual'
```

**范围（AC14）**

- 本任务自有改动集：`git log --format= --name-only HEAD --not goal/GOAL-051 develop`（anti-drift 的 actual-files 口径）与 `git diff --name-only goal/GOAL-051..448686522` 均为 3 个文件，正好是 Touches 的三个源码／测试文件；`tasks/gap-ac439-codex-resident-background-leases.md` 由 task_write 单独提交。
- AC14 字面的 `git diff --name-only develop...HEAD` 在 goal 分支任务上会含 goal 分支继承的 AC-435 基线文件（`codex-app-server.connection.ts`、`codex-host-driver-persistent.test.ts` 等）：anti-drift 工具自身把这条 `develop...HEAD` 差集称为 mainline divergence，不是本任务写入。按任务自有改动口径读数恰为 Touches 三文件，禁改清单的 grep 为空。
- merge develop 后的 anti-drift Touches 闸：`ANTI-DRIFT OK: task gap-ac439-codex-resident-background-leases — 3 actual file(s), all within declared Touches (4 glob(s))`。
- AC11：`grep -rn 'backgroundTerminals' server/modules/providers/list/codex/` 输出为空（exit 1）；该字面只出现在 `tests/` 下的假 transport。

**续跑轮 2026-10-29（suite 红修复：server 测试文件计数 pin 与 90% 覆盖率地板）**

- 失败读数：fan-in 机械 suite 报 `__PERFILE__ ... server/shared/tests/quay-test-script.test.ts passed=false`（pool rc=1，isolated 复跑仍 rc=1 ⇒ 确定性红，不是负载抖动）。
- 真因：本任务新增 `server/modules/providers/tests/codex-resident-background-leases.test.ts`，worktree 收集数 465 → **466**；该测试文件在 AC2/AC3 钉住精确 `known=3 unknown=462` / `known=1 unknown=464`（对应 465），并把 `scripts/suite-duration-baseline.tsv` 的 419 行覆盖率断言为 `>= collected*0.9`（419/466 = 89.91% < 90%）。两条腿都是「测试输入是整棵树」的移动目标，与 delta-relatedness 的 UNRELATED 提示无关。
- 修复：两条 pin 移 `462→463`、`464→465` 并补注释记录 `gap-ac439… added its criterion … (465 + 1 = 466)`；baseline 追加本任务判据文件的实测行 `2674`（单文件 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-background-leases.test.ts` 的 `duration_ms 2674.08`），420/466 = 90.13% ≥ 90%。
- 复验（本 worktree，修后单文件）：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` → exit **0**，`tests 14 / pass 14 / fail 0`，`duration_ms 89962`。
- 因这两个文件参与修复，已通过 task_write 把 `server/shared/tests/quay-test-script.test.ts` 与 `scripts/suite-duration-baseline.tsv` 补进 `## Touches`（anti-drift 读的是 task 文件里的 Touches）。

**未实现项（非目标）**

- 未挂 `codex.provider.ts` 的 `hostDriver`、未改 capabilities（AC-441/442）。
- 未做 queue／live settings／approvals（AC-436/437/438）、未做 restore／E2E（AC-443）。
- `process/outputDelta` 不建账、不归一化成 UI 帧（AC-440）。
- 未改 `IProviderHostDriver`／`IProviderHostDriverSink`、`session-host-manager.service.ts`、`shared/interfaces.ts`、per-run `codex-runtime.provider.ts`、fork 客户端 `codex-app-server.client.ts`。

该轴仍暗,理由:本条是进程账本原语，判据为行为测试，本轮未产生 L_D/L_G 可量化读数

## Touches

- server/modules/providers/list/codex/codex-background-lease-ledger.ts (new)
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/tests/codex-resident-background-leases.test.ts (new)
- server/shared/tests/quay-test-script.test.ts
- scripts/suite-duration-baseline.tsv
- tasks/gap-ac439-codex-resident-background-leases.md

## Blocker

**2026-10-29T11:15:20.009Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: __PERFILE__ duration_ms=87075 server/shared/tests/quay-test-script.test.ts passed=false end_ms=1793272083364 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the goal/GOAL-051 baseline red set: added=server/shared/tests/quay-test-script.test.ts,server/shared/tests/quay-test-script.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：d36183ad-94bf-4dde-b6e7-de699765f838