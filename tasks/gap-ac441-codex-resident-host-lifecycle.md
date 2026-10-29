---
id: gap-ac441-codex-resident-host-lifecycle
title: AC-441 Codex 常驻宿主层契约：openHost 持 resident-policy lease、turn
  busy/idle、closeHost/unbind 原因、idle 超时、restore 走 startResidentSession
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac435-codex-resident-host-driver-persistent
goal_ac: AC-441
---
## Proposal

<!-- dedup-ref --> 机制去重与粒度（本轮实测，2026-10-29）：`grep -rl '^goal_ac:[[:space:]]*AC-441' tasks/` → **0** 个文件；`grep -ril 'codex-resident-lifecycle\|startResidentSession' tasks/*.md` → 只命中 5 条与 Codex 无关的历史任务（`gap-ac236-resident-host-service`、`gap-fork-inherits-lifecycle-mode`、`gap-resident-ondemand-start-uses-bind-session`、`gap-resident-restore-after-restart`、`gap-resident-edit-send-truncates-in-place`），没有一条认领 Codex 宿主层生命周期。`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/providers/list/codex/codex-host-driver.provider.ts --touches server/modules/providers/list/codex/codex.provider.ts --touches server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts --json` 返回 peers `[gap-ac435…(ready), gap-ac436…, gap-ac437…, gap-ac438…, gap-ac439…, gap-ac440…]`（全部只共享 `codex-host-driver.provider.ts`）、mentions `[]`、reasons `[]`。**决定：separate，不 merge** —— 本条有独立判据文件与独立验收（宿主层生命周期 ≠ 队列 / 设置 / 审批 / 后台账本 / 协议门控）；driver 由 gap-ac435 产出，关系边用顶层 `depends_on` 登记（SQL 关系边，不是散文前置）；与 AC-436…AC-440 只共享 driver 文件，由调度器按 Touches 串行。

**来源与判据物。** criterion 逐字取自 `goals/AC-441-宿主层契约-resident-policy-lease-busy-idle-关闭与-idle-超时.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts`。红态基线（本轮直跑，不是推断）：该命令在当前主检出 `9c6c5c386` 上 exit **1**，文案逐字 `Could not find 'server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts'`。`.quay/gate-events.jsonl` 里 AC-441 最近四条 fail 的 `treeSha` 都是 `89f5a7c4…`（goal 工作树），与主检出树不同；本轮已在主检出按原命令重跑，仍 exit 1，且 `git cat-file -e develop:<path>` / `HEAD:<path>` / `783215f0f:<path>` 三处都 ABSENT ⇒ 红是真的，不是过期读数。

**现状（本轮读的读数）**

- **宿主层已经具备全部通用语义，缺的是 Codex 这一侧的接线与读数。**
  - `session-host-manager.service.ts:1228`：`createBinding` 在 `mode === 'resident'` 时直接发 `leases: [{ kind: 'resident-policy' }]`，所以 resident host 一打开就持该 lease。
  - `session-host-manager.service.ts:667`：`applyDerivedState` 以 `turn` lease 决定 `busy`，turn lease 清空后只剩 `resident-policy` ⇒ `idle` 并 arm quiet close。
  - `session-host-manager.service.ts:636`：quiet ceiling 到期按 **mode** 命名 close：resident ⇒ `closeReason 'idle'`。
  - `session-host-manager.service.ts:1160-1186`：`unbindSession(appSessionId, reason)` 先 `await driver.unbind(host, appSessionId, reason)`，最后一个 binding 离开时 `closeHostAndWait(host.hostId, reason)`——driver 收到原因、host 记录同一个原因。
  - 结论：manager 侧不需要新机制；本条要证明 Codex driver 真的把 turn lease 报进 sink、真的接收并保留 close/unbind 原因、真的能在 idle 到期时被关。
- **Codex driver 只有 AC-435 分支版本**：文件 `server/modules/providers/list/codex/codex-host-driver.provider.ts` 只存在于 `task/gap-ac435-codex-resident-host-driver-persistent` 的 `90901930f`，develop / HEAD 都 ABSENT（本轮 `git log` 与 `git cat-file` 实测）。它有 `startHost/bind/submit/interrupt/reconfigure/unbind/closeHost/run`，但：
  - `submit()` 只调 `this.sink?.activity(appSessionId)`（第 172 行），**从不 `leaseAdded({kind:'turn'})` / `leaseRemoved('turn')`** ⇒ 宿主层永远看不到 turn，host 永远不会 `busy`，`idle` 超时窗口在提交期间也不会被 cancel。
  - 没有 `startResidentSession`，也**没有 host port**（构造函数只接受 `createConnection` / `launch` / `thread`）⇒ 无法 `openHost`，restore 与 on-demand start 都到不了它。
  - `run()` 开头 `const host = this.host; if (!host) throw AppError('CodexHostDriver.run was called before a host was started.')` ⇒ 冷会话的首轮经 provider-runtime 派发时没有进程可写。
  - `bind()` 只从 `binding.providerSessionId` 取 threadId，而 manager 的 `createBinding` 把 `providerSessionId` 初始化为 `null`（`session-host-manager.service.ts:1226`）⇒ 即使 restore 走到 driver，也不会 adopt 会话原有的 thread，而会 `thread/start` 新开一条。恢复语义必须由 `launch.context.resolveProviderSessionId(appSessionId)` 补上。
- **`codex.provider.ts` 没有 `hostDriver` 槽**：当前只有 `ClaudeProvider` 有（`claude.provider.ts:112-183`，`residentHostDriver` + `hostDriver: IProviderHostDriver = this.residentHostDriver`）。AC-435 的完成记录明确把「挂载」留给本条。
- **能到达 driver 的两条生产入口都读 `provider.hostDriver`**：`provider-runtime.service.ts:1151-1168` 的 `startResidentSession(providerName, sessionId)` 取 `provider.hostDriver.startResidentSession` 并用 `resolveResidentLaunchOptions` + `createRuntimeContext` 组装 `HostResidentLaunch`；`resident-restore.service.ts:250-265` 的 `skipReasonFor` 以 `typeof driver.startResidentSession === 'function'` 决定是否 `no-resident-driver`。挂载 + 实现该动词后，`server/index.ts:1982-1984 / 2370-2372 / 2824-2832` 的三处既有 wiring 无需改动。
- **capabilities 不动**：`provider-capabilities.service.ts:222` 的 codex 仍是 `lifecycleModes: ['per-run']`，`lifecycle-mode.test.ts:65` 的 `PER_RUN_ONLY_PROVIDERS` 仍含 codex——这是 AC-442 的范围。本条不声明 resident、不碰 capability 表；判据不得断言 codex 的 `lifecycleModes`（AC-442 落地后必须仍为绿）。
- **既有「codex 不挂驱动」夹具都是字面 resolver**：`server/modules/session-hosts/tests/resident-host-service.test.ts:200-203`、`resident-ondemand-start-route.test.ts:326`、`server/modules/mcp-gateway/tests/mcp-session-host-control.test.ts:344` 都返回 `provider === '<某 id>' ? driver : null`，不读 provider registry ⇒ 挂载本身不会让它们变红；本轮不改写它们的 message 钉子，除非它们真的变红。

**要建的东西**

1. `server/modules/providers/list/codex/codex.provider.ts`（改）—— 镜像 Claude 的挂载方式：
   - `readonly residentHostDriver: CodexHostDriver = new CodexHostDriver({ host: sessionHostManager });`（`host` 是本条给 driver 新增的构造选项；connection 仍由 `requireConnection` 惰性创建，模块加载不 spawn 进程）；
   - `readonly hostDriver: IProviderHostDriver = this.residentHostDriver;`，import `sessionHostManager` 自 `@/modules/session-hosts/index.js`（与 `claude.provider.ts:19` 同一条既有边）；
   - **不改** `provider-capabilities.service.ts`，不改 `lifecycleModes` / `residentFeatures`。
2. `server/modules/providers/list/codex/codex-host-driver.provider.ts`（改）：
   - 新增构造选项 `host: CodexResidentHostPort`，类型为 `Pick<SessionHostManager, 'openHost' | 'snapshot'>`（与 `ClaudeResidentHostPort` 同型收窄，避免 import 整个 manager 面）。
   - **turn lease**：`submit()` 在 `turn/start` 之前 `sink.leaseAdded(appSessionId, { kind: 'turn', runId })`；`runId` 每轮唯一（driver 自增即可，如 `codex-turn-<n>`）；在 `settleTurn` 的**唯一结算点** `sink.leaseRemoved(appSessionId, 'turn')`，且每个 lease 只移除一次；`turn/start` 请求抛错时同样移除（catch 内移除后 rethrow）。`unbind` / `closeHost` 清理未结算轮时也移除。这样 `applyDerivedState` 能在 turn 期间给出 `busy`、结束后回到 `idle`，idle 窗口才会在提交期间被 `clearQuietClose` 取消、结束后重新 arm。
   - **原因读数**：`closeHost(host, reason)` 记录 `lastCloseReason = reason`，`unbind(host, appSessionId, reason)` 记录 `lastUnbindReason = reason`（公开只读；`readSession` 形状可加字段，AC-435 测试不做 deepEqual，widening 安全）。这是判据读「driver 收到的原因与 manager 记录的原因相同」的观测面，不改变 `IProviderHostDriver` 签名。
   - **`startResidentSession(appSessionId, launch)`**（实现接口可选动词，幂等）：
     - 已有 live host（`this.host` 且未 closed，或 `host.snapshot()` 里该 session 有非 closed binding）⇒ 直接回 `{ hostId, pid }`，不再开第二个进程；
     - 否则从 `launch.context.resolveProviderSessionId(appSessionId)` 读 provider-native id，作为该 session 的初始 `threadId`（有值才 resume；无值走 `thread/start`），从 `launch.options` 取 `cwd` / `model` 作为 `thread/start` 默认；
     - `await this.hostPort.openHost({ provider: 'codex', mode: 'resident', appSessionId, driver: this })`，等 `startHost` 把 pid 写进 host 记录后回 `{ hostId, pid }`。
   - **冷启动 `run()`**：`this.host` 为空时先走同一个 `startResidentSession`（用本轮 `options`/`context` 组装 launch），再 `submit`；已有 host 时行为不变。冷启动与 on-demand start 共用一条 launch 路径。
   - 仍然 `multiplexedHost = false`；`interrupt` 仍只 `turn/interrupt`，不碰进程。
3. `server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts`（new；hermetic：复用 AC-435 的内存双工假 transport，固定假 pid，不 spawn 真 codex、不碰 DB/网络；FakeClock 用 `session-host-lifecycle.test.ts:110-150` 的 `{ now(), schedule() }` 形态）：
   - (a) **resident-policy lease**：`manager.openHost({ provider:'codex', mode:'resident', appSessionId, driver })` 后读 `snapshot()`：host.state `idle`、binding.leases 恰为 `['resident-policy']`、`pid` 等于假 transport 的固定 pid；打印 `open state=… leases=… pid=…`。
   - (b) **busy → idle**：`const turn = driver.submit(host, id, { command:'hi', options:{} })`；等假 transport 收到 `turn/start` 后读 `snapshot()` ⇒ state `busy`、leases `resident-policy+turn`；发 `turn/completed`、`await turn` 后读 ⇒ state `idle`、leases `resident-policy`；打印两行读数与 `leaseAdded/leaseRemoved` 次数。再加一条失败腿：假 transport 对 `turn/start` 回 JSON-RPC error，`submit` reject 后 host 仍回 `idle`（turn lease 不粘住）。
   - (c) **closeHost / unbind 原因**：`manager.closeHost(hostId, 'user')` ⇒ `snapshot()` 的 `closeReason === 'user'`、`driver.lastCloseReason === 'user'`、连接的 `close()` 恰 1 次；另一 case `manager.unbindSession(id, 'user')` ⇒ `driver.lastUnbindReason === 'user'` 且非 multiplexed 的最后一个 binding 使 host `closeReason === 'user'`；再一条 `sink` 路径：假 transport 发进程退出 ⇒ `closeReason === 'exited'` 且 **没有** 回调 `driver.closeHost`（`driver.lastCloseReason` 仍为 null），证明 exit 不走 kill。
   - (d) **idle 超时**：FakeClock + `createSessionHostManager({ now, scheduler, residentPolicy: { quietCeilingMs } })`；打开 resident host、读完 `quietDeadlineAt - quietWindowStartAt === quietCeilingMs` 后把时钟推过 ceiling；断言 host `state 'closed'`、`closeReason 'idle'`、`driver.lastCloseReason === 'idle'`、关闭时 binding 无 `turn` lease；打印 `ceiling=… deadline=… closeReason=…`。
   - (e) **restore 走 startResidentSession**：`createResidentRestoreService({ listRestorableResidentSessions, resolveHostDriver: (p) => p==='codex' ? driver : null, startResidentSession: (p,id) => driver.startResidentSession(id, launch), now, log })`，候选一条 `{ provider:'codex', providerSessionId:'thread-existing', lastActiveAt }`；断言 `outcome.started` 含该 id 且 `skipped` 不含 `no-resident-driver`；driver 动词被调用恰 1 次；host 起来且持 `resident-policy`；随后发一轮，假 transport 的 `thread/resume` 参数 `threadId === 'thread-existing'`（证明恢复 adopt 了原会话，而不是 `thread/start` 新开）。再断言第二次 start 幂等（不再 `openHost`、pid 不变）。
   - (f) **挂载**：`providerRegistry.resolveProvider('codex')` 的 `hostDriver` 是 `CodexHostDriver` 实例、`multiplexedHost === false`；`resolveHostDriver('codex')` 非空。**不断言** `lifecycleModes`（AC-442 的范围）。
4. 两个假形态（只临时改实现，随后 `git checkout --` 还原并记录逐字红态）：
   - 去掉 `settleTurn` 里的 `leaseRemoved('turn')` ⇒ (b) 必红（host 停在 busy / leases 带 turn）；
   - 删除 `startResidentSession`（或让它 `throw`）⇒ (e) 必红（restore 把候选 skip 成 `no-resident-driver` / started 为空）。
5. 非目标：不改 capabilities 与 `lifecycleModes`（AC-442）；不做 queue / settings / approvals / background lease / 协议门控（AC-436…AC-440）；不改 per-run `codex-runtime.provider.ts` 与 fork 客户端 `codex-app-server.client.ts`；不改 manager / `IProviderHostDriver` 接口；不改 `resident-host-service.test.ts` / `resident-ondemand-start-route.test.ts` / `mcp-session-host-control.test.ts` 的字面 resolver 与 message 钉子（除非本条落地后它们真红）；不写 E2E（AC-443）。

## AC

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 6`。红态基线已测：同命令当前 exit 1、文案逐字 `Could not find 'server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts'`。
- [x] AC2 resident-policy lease：resident host 打开后打印 `open state=… leases=… pid=…`；`state == 'idle'`、`leases` 恰为 `['resident-policy']`、`pid` 等于假 transport 固定 pid、`driver.startHost` 调用恰 1 次。
- [x] AC3 turn busy/idle：打印 `during state=… leases=…` 与 `after state=… leases=…`；前者 `state=='busy'`、leases 含 `turn` 且含 `resident-policy`，后者 `state=='idle'`、leases 恰为 `['resident-policy']`；`leaseAdded` 与 `leaseRemoved` 各计 1 次（失败腿：`turn/start` 回错后 host 仍回 `idle`，lease 不粘）。
- [x] AC4 关闭原因：打印 `close reason=… driverReason=… closeCalls=…`、`unbind reason=… driverReason=… hostReason=…`、`exit hostReason=… driverCloseCalled=…`；前两组 driver 收到与 manager 记录同一原因，`close()` 恰 1 次；exit 组 `hostReason=='exited'` 且 driver 的 `closeHost` 未被回调。
- [x] AC5 idle 超时：打印 `ceiling=… windowStart=… deadline=… closeReason=… driverReason=…`；`quietDeadlineAt - quietWindowStartAt == quietCeilingMs`，推过 deadline 后 `state=='closed'`、`closeReason=='idle'`、`driver.lastCloseReason=='idle'`，关闭时 binding 不含 `turn` lease。
- [x] AC6 restore 走 startResidentSession：打印 `restore started=… skipped=… calls=… hostLeases=… resumeThreadId=…`；`outcome.started` 含候选、`skipped` 不含 `no-resident-driver`、driver 动词恰 1 次、host 持 `resident-policy`、随后一轮 `thread/resume` 的 `threadId == 'thread-existing'`；重复 start 幂等且 pid 不变。
- [x] AC7 挂载可读：打印 `provider=codex hostDriver=CodexHostDriver multiplexedHost=false`；判据内 `assert.ok(providerRegistry.resolveProvider('codex').hostDriver instanceof CodexHostDriver)` 与 `multiplexedHost === false`；不出现对 `lifecycleModes` 的断言（`grep -n 'lifecycleModes' server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts` 无输出）。
- [x] AC8 假形态承重：临时删 `leaseRemoved('turn')` ⇒ criterion 退出 **1**；临时删/抛 `startResidentSession` ⇒ criterion 退出 **1**；两次逐字红态文案写进完成记录，还原后 `git status --short` 无残留。
- [x] AC9 范围不越界：`git diff --name-only develop...HEAD` 仅含 Touches 列出的文件；`git diff --name-only develop...HEAD | grep -E 'provider-capabilities\.service\.ts|codex-runtime\.provider\.ts|codex-app-server\.client\.ts|session-host-manager\.service\.ts|shared/interfaces\.ts'` 输出为空。
- [x] AC10 既有契约不变：`npx tsx --tsconfig server/tsconfig.json --test <file>` 对 `server/modules/session-hosts/tests/session-host-lifecycle.test.ts`、`resident-host-service.test.ts`、`resident-ondemand-start-route.test.ts`、`resident-restore.service.test.ts`、`lifecycle-mode.test.ts`、`server/modules/providers/tests/codex-runtime.test.ts` 逐个退出 0（逐个单文件跑；如需并发按 `docs/operations/process-isolation-and-memory-caps.md` 用 `with-memory-cap.sh` 限并发）；`npm run typecheck` 退出 0。
- [x] AC11 如实登记：完成记录写明假 transport 形态、fixed pid、FakeClock 注入点、五项读数的逐字输出、两个假形态的退出码与红态文案、以及未实现项（capabilities / queue / settings / approvals / background lease / 协议门控 / E2E）。

## DoD

判据在落地后的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录贴出 (a) 打开后的 state/leases/pid、(b) turn 前后两行 state/leases 与失败腿、(c) closeHost/unbind/exit 三组原因读数、(d) idle ceiling 与 closeReason、(e) restore 的 started/skipped/calls 与 `resumeThreadId=thread-existing`、(f) 挂载读数。两个假形态的实测退出码与逐字红态文案各一条。`npm run typecheck` 退出 0，AC10 列出的六个既有判据逐个退出 0。改动只落在 Touches 列出的文件上，capabilities / per-run runtime / fork client / manager / `IProviderHostDriver` 零改动。完成后 goal driver 下一轮以 `goal_ac: AC-441` 独立复跑原 criterion 时由红翻绿，且这次翻绿有分辨力：不报 turn lease 的实现在 (b) 必红，没有 `startResidentSession` 的实现在 (e) 必红。

## Touches

- server/modules/providers/list/codex/codex-host-driver.provider.ts (modify: turn lease、host port、startResidentSession、冷启动 run、原因读数)
- server/modules/providers/list/codex/codex.provider.ts (modify: 挂载 hostDriver)
- server/modules/providers/index.ts (modify: 导出 CodexHostDriver / CodexAppServerConnection 及两个类型，供跨模块判据经 barrel 访问)
- server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts (new)
- server/modules/session-hosts/tests/lifecycle-mode.test.ts (modify: per-run-only 夹具改为「codex 已挂驱动但未声明 resident」，cursor/opencode 仍无驱动)
- tasks/gap-ac441-codex-resident-host-lifecycle.md

## 完成记录

**落地（本条提交 `c60e587cc`，父提交 `060a431a5` = 创建时的 goal/GOAL-051 tip；随后 `git merge --no-edit develop` 无冲突，合并后重跑下列全部读数）**

- driver：`CodexHostDriver` 新增 `host?: Pick<SessionHostManager, 'openHost' | 'snapshot'>`；`startResidentSession` 幂等（已有 live host 直接回 `{hostId,pid}`），从 `launch.context.resolveProviderSessionId` 取 threadId、从 `launch.options` 取 `cwd`/`model` 作为 `thread/start` 默认；冷启动 `run()` 复用同一路径。
- turn lease：`submit` 在 `turn/start` 前 `leaseAdded({kind:'turn',runId:'codex-turn-<n>'})`，`settleTurn` 为唯一结算点 `leaseRemoved('turn')`，`turn/start` 抛错时 catch 内先移除再 rethrow（`removeTurnLease` 幂等）。
- 原因读数：`closeHost` / `unbind` 分别记录 `lastCloseReason` / `lastUnbindReason`（公开只读），不改 `IProviderHostDriver`。
- 挂载：`codex.provider.ts` 新增 `residentHostDriver: CodexHostDriver = new CodexHostDriver({ host: sessionHostManager })` 与 `hostDriver: IProviderHostDriver = this.residentHostDriver`；capabilities / `lifecycleModes` 未动。
- barrel：`server/modules/providers/index.ts` 导出 `CodexHostDriver`、`CodexAppServerConnection`、`CodexResidentHostPort`、`CodexAppServerTransport`，使 `session-hosts` 模块的判据无需 deep import（边界 lint 强制）。
- `lifecycle-mode.test.ts` 的 (4c) 原本断言真实 registry 对 `PER_RUN_ONLY_PROVIDERS` 全部无 host driver；挂载 codex 后该断言必红，改为正向断言 codex 挂驱动且仍无 resident 声明，cursor/opencode 仍循环断言无驱动（capability 矩阵未动，`PER_RUN_ONLY_PROVIDERS` 未动）。

**判据形态**：`FakeAppServerTransport` 为内存双工假 `codex app-server`（固定 pid `424242`，可配置 `autoCompleteTurn` / `failNextTurnStart` / `die()`，`terminateCalls` 计数）；`createHarness` 包装 `driver.startHost` 计 `startHostCalls`、包装 sink 计 `leaseAdded/leaseRemoved`、包装 `closeHost` 计 `closeHostCalls`；FakeClock 注入 `createSessionHostManager({ now, scheduler, residentPolicy: { quietCeilingMs: 5000 } })`；`ProviderRuntimeContext` 以 `resolveProviderSessionId` 提供 `thread-existing`。不 spawn 真 codex、不碰 DB/网络。

**逐字读数（落地树上运行原命令，exit 0）**

```
open state=idle leases=resident-policy pid=424242
during state=busy leases=resident-policy+turn
after state=idle leases=resident-policy
leaseAdded=1 leaseRemoved=1
rejected state=idle leases=resident-policy
close reason=user driverReason=user closeCalls=1
unbind reason=user driverReason=user hostReason=user
exit hostReason=exited driverCloseCalled=false
ceiling=5000 windowStart=1700000000000 deadline=1700000005000 closeReason=pending driverReason=pending   (exit 腿：exit 不走 quiet close)
ceiling=5000 windowStart=1700000000000 deadline=1700000005000 closeReason=idle driverReason=idle       (AC5 idle 超时)
restore started=session-restore skipped=none calls=1 hostLeases=resident-policy resumeThreadId=thread-existing
provider=codex hostDriver=CodexHostDriver multiplexedHost=false
```

`ℹ tests 9 / ℹ pass 9 / ℹ fail 0`（exit 0）。AC7 的 `grep -n 'lifecycleModes' server/modules/session-hosts/tests/codex-resident-lifecycle.test.ts` 无输出（exit 1）。

**假形态（承重证明）**

1. 注释掉 `settleTurn` 里的 `this.removeTurnLease(session);` → criterion exit **1**，逐字红态：
   `AssertionError [ERR_ASSERTION]: a settled turn returns the resident host to idle` / `'busy' !== 'idle'` / `actual: 'busy', expected: 'idle', operator: 'strictEqual'`。
2. `startResidentSession` 开头 `throw new Error('FALSE FORM ...')` → criterion exit **1**，逐字红态：
   `AssertionError [ERR_ASSERTION]: the restore pass opened a host for the candidate` / `actual: undefined, expected: true, operator: '=='`（restore 的 `started` 为空）。
   两次均以 `git checkout -- <file>` 还原，还原后 `git status --short` 输出为空（无残留），随后重跑 criterion 仍 exit 0 / pass 9。

**既有契约（合并 develop 后逐个单文件跑）**：codex-resident-lifecycle 9 pass、session-host-lifecycle 7 pass、resident-host-service 5 pass、resident-ondemand-start-route 4 pass、resident-restore.service 5 pass、lifecycle-mode 9 pass、codex-runtime 12 pass，全部 exit 0；`npm run typecheck` exit 0；`npm run lint` exit 0（仅既有 warning）。

**AC9 的如实读数（重要）**：在本工作树执行 `git diff --name-only develop...HEAD` 会额外列出 `scripts/suite-duration-baseline.tsv`、`server/modules/providers/list/codex/codex-app-server.connection.ts`、`codex-background-lease-ledger.ts`、`codex-app-server-protocol.test.ts`、`codex-host-driver-persistent.test.ts`、`codex-resident-background-leases.test.ts`、`server/shared/tests/quay-test-script.test.ts` —— 这些是 AC-436…AC-440 在 `goal/GOAL-051` 上、尚未进入 develop 的兄弟任务文件，不是本条写入。本条的自身增量 `git diff --name-only 060a431a5 c60e587cc` 恰为 Touches 的 5 个代码/测试文件；`git diff --name-only develop...HEAD | grep -E 'provider-capabilities\.service\.ts|codex-runtime\.provider\.ts|codex-app-server\.client\.ts|session-host-manager\.service\.ts|shared/interfaces\.ts'` 输出为空（exit 1）。anti-drift Touches 检查（`--merge-target goal/GOAL-051`）在 Touches 补登后通过，是本条范围约束的机械判据。

**未实现项（如实登记）**：capabilities / `lifecycleModes`（AC-442）；queue / settings / approvals / background lease / 协议门控（AC-436…AC-440）；E2E（AC-443）。`multiplexedHost` 仍为 false，`interrupt` 仍只发 `turn/interrupt`。

**ADR-007 暗轴**：该轴仍暗,理由:后端宿主层接线任务，无前端布局(L_D)或图形(L_G)面的可观测改动。