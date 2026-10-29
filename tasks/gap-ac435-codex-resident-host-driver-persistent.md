---
id: gap-ac435-codex-resident-host-driver-persistent
title: AC-435 Codex 常驻：长驻 app-server 跨 3 轮 threadId/pid 不变、首轮后 resume、零轮次回退
  thread/start、interrupt 不杀进程
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-435
---
## Proposal

<!-- dedup-ref --> 机制去重（本轮实测，2026-10-29）：`grep -rl 'goal_ac: AC-435' tasks/` → 0 个文件；`grep -ril 'app-server\|appserver' tasks/` → 只有 `gap-ac352-criterion-harden-against-repo-dotenv.md`（无关，dotenv 夹具）；`grep -ril 'codex.*resident\|常驻.*codex\|codex-host\|CodexHostDriver' tasks/` → 命中项全是 Claude 常驻与宿主层通用任务，没有一条认领 Codex 常驻 app-server。`task-granularity-advice.js` 对草案 Touches 返回 `peers: []`、`mentions: []`。同 goal 的 AC-436…AC-443 各有自己的判据文件，本条只认领 AC-435。

**来源与判据物。** criterion 逐字取自 `goals/AC-435-常驻进程跨轮存活-resume-中止不杀进程.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts`。红态基线（本轮直跑，不是推断）：该命令 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-persistent.test.ts'`。

**现状（本轮读的读数）**

- `server/modules/providers/list/codex/` 今天只有 per-run SDK 面：`codex-runtime.provider.ts` 每轮一个 `codex exec`（`startThread`/`resumeThread`/`runStreamed`）；`codex-app-server.client.ts` 是给 fork 用的**短命**连接，`withAppServer()` 每次操作 spawn 一个 `codex app-server` 并在 `finally` 里 `child.kill()`。没有长驻连接，没有 host driver。
- `codex.provider.ts` 没有 `hostDriver` 槽位；`provider-capabilities.service.ts` 里 codex 的 `lifecycleModes: ['per-run']`。
- 两条既有判据把「codex 不挂驱动」钉住：`server/modules/session-hosts/tests/resident-host-service.test.ts:297,323`（seed codex 后断言 `Provider "codex" mounts no host driver`）与 `server/modules/session-hosts/tests/resident-ondemand-start-route.test.ts:508`。所以本条**不挂载** driver、不改 capabilities —— 挂载与 resident 声明属 AC-441 / AC-442；本条只落地类与它的判据，保持上述两条钉子为绿。
- 协议读数来自 `tmp/codex-appserver-exp-NuPHhk/REPORT.md`（锁定版 `@openai/codex 0.153.4`）：E1 同进程内 `thread/resume` 同 id、首轮之前 resume 报 `no rollout found for thread id ...`；E3 `turn/interrupt` 后该 turn `status=interrupted` 且 app-server pid 不变，随后同一线程可继续；E6 换进程 resume 仍是同 thread id（pid 会变，那属 AC-441 的重启恢复语义，不在本条）。

**要建的东西**

1. `server/modules/providers/list/codex/codex-app-server.connection.ts`（new）—— 长驻 stdio JSON-RPC 连接：`initialize` 握手；按请求 id 关联响应；notification 与 server-request 分发到回调；暴露 `pid`；进程退出让所有 pending 以可读错误失败；`close()` 幂等且只杀一次。**进程/传输工厂必须可注入**：判据注入一个内存双工假 transport（固定假 pid），不真起 codex。本条只做 persistent / resume / interrupt 需要的协议面；`experimentalApi`、queue、settings、approval、background 属 AC-436/437/438/439/440。
2. `server/modules/providers/list/codex/codex-host-driver.provider.ts`（new）—— `CodexHostDriver implements IProviderHostDriver`，`multiplexedHost = false`（人 yale 裁定 ①：一会话一 app-server）。每 app session 的 resident 状态持有 `threadId`、`activeTurnId`、`turnStatus`、`pid`。线程选择规则：
   - 无 `threadId` → `thread/start`，存返回 id；
   - 已有 `threadId` → `thread/resume`；错误信息含 `no rollout found` 时回退 `thread/start` 并用新 id 覆盖（零轮次线程的恢复路径）；
   - 每轮 `turn/start {threadId, input}`，从响应与 `turn/started` 记 `turnId`；`turn/completed` / `turn/failed` / `turn/interrupted` 结算该轮；
   - `interrupt` → `turn/interrupt {threadId, turnId}`，等该轮终态 `interrupted`，**不碰进程**；
   - 只有 `closeHost` 关闭连接 / 杀进程，且只关一次；
   - 另带 `run(appSessionId, turn, writer, context)` 结构化常驻轮入口（`provider-runtime.service.ts` 的 `ResidentTurnEntry` 形状），一轮的 writer 帧由同一 driver 产出，`submit` 与 `run` 都等到本轮结算才 resolve。
3. `server/modules/providers/tests/codex-host-driver-persistent.test.ts`（new）—— 假 app-server transport：一个 JSON-RPC 服务器桩，处理 `initialize` 握手、`thread/start`（每次新 id）、`thread/resume`（仅在首轮后成功；未跑过轮的 id 回 `no rollout found for thread id ...`）、`turn/start`（发 `turn/started`，按测试指令发 `turn/completed`）、`turn/interrupt`（发终态 `status=interrupted`）；记录方法调用序列与固定假 pid；测试结束断言连接已关闭。判据腿：
   - (a) 同一 resident 会话连续 3 轮：3 轮 `threadId` 相同、`host.pid` 3 轮相同、假 transport 的 pid 全程不变；
   - (b) 首轮后 `thread/resume` 用同一 id：第 1 轮只有 `thread/start`，第 2/3 轮各一次 `thread/resume` 且参数 id == 首轮 id；
   - (c) 零轮次 `thread/resume` 报 `no rollout found`：driver 回退 `thread/start`，新 id 被用于随后 `turn/start`，旧 id 不被写回；
   - (d) `turn/interrupt`：被中断轮终态 `status=interrupted`；`pid` 不变；下一轮用同一 `threadId` + 同一 pid 继续；interrupt 前后 transport 都报告进程存活；
   - (e) 反向控制（内建、持久）：把「threadId 每轮变化」的读数喂给身份断言必须 reject；把「interrupt 后 pid 变化/进程消失」的读数喂给存活断言必须 reject；两者各自打印判定；
   - (f) 接口一致性：`const _conformance: IProviderHostDriver = new CodexHostDriver({ ... })`（或 `satisfies`）随测试文件类型检查通过；打印 `multiplexedHost=false`。
4. 非目标：不改 `codex.provider.ts` 的 `hostDriver` 槽、不改 capabilities 的 `lifecycleModes`（AC-441/442）；不做 queue / settings / approvals / background lease / restore / E2E（AC-436…AC-443）；不改 `codex-runtime.provider.ts` 的 per-run 主路径与 `codex-app-server.client.ts` 的 fork 路径。

**两个假形态（实测，只改实现不改判据文件）**

- 真实现临时改成「每轮 `thread/start`」⇒ criterion 退出 **1**，红在 threadId 漂移；
- 真实现临时把 `interrupt` 改成关闭连接 / 杀进程 ⇒ criterion 退出 **1**，红在 pid / 存活。

两次退出码与红态文案抄进完成记录，随后 `git checkout --` 还原并确认 `git status --short` 只剩 Touches。

## Plan

1. 先读 `tmp/codex-appserver-exp-NuPHhk/REPORT.md` 的 E1/E3 与 `e1-persistent-thread.mjs` / `e3-interrupt-keeps-process.mjs` 的原始 JSON-RPC 帧，确认 `thread/start`、`thread/resume`、`turn/start`、`turn/interrupt` 的 params/result 与通知名（`turn/started`、`turn/completed`、`turn/interrupted`、`thread/status/changed`）。
2. 写 `codex-app-server.connection.ts`：可注入 transport、请求/响应关联、通知分发、pid、退出失败、幂等 close。
3. 写 `codex-host-driver.provider.ts`：`IProviderHostDriver` 七动词 + `run`；逐 session 状态机实现 thread 选择、首轮/后续轮、零轮次回退、interrupt、close。
4. 写判据文件：假 transport + (a)…(f) 六组腿；先单跑打印方法序列与三轮读数，再收紧断言。
5. 跑 criterion 至退出 0；跑 `npm run typecheck` 与既有 `codex-runtime.test.ts`、`codex-session-fork.test.ts`。
6. 实测两个假形态（临时改实现 → 退出 1 → 记录文案 → 还原），确认 diff 只剩 Touches。

## AC

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 3`。红态基线已测：同命令当前 exit 1、文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-persistent.test.ts'`。
- [x] AC2 三轮身份稳定：同一 resident 会话连续 3 轮后逐轮打印 `turn=N threadId=… hostPid=… transportPid=…`；三行 threadId 全等、hostPid 全等、transportPid 全等；任一不等时断言以点名差异失败。
- [x] AC3 resume 语义：打印方法调用序列；序列中 `thread/start` 恰 1 次（首轮），`thread/resume` 恰 2 次且两次参数 threadId == 首轮 id。
- [x] AC4 零轮次回退：假 transport 对未跑过轮次的 thread 回 `no rollout found for thread id …`；驱动改调 `thread/start`，随后 `turn/start` 使用新 id；打印 `resumeError=… fallbackThreadId=… turnThreadId=…`，三者与上述关系一致。
- [x] AC5 中止不杀进程：打印 `interruptTurnStatus=… beforePid=… afterPid=… nextTurnPid=… nextTurnThreadId=…`；`interruptTurnStatus == 'interrupted'`、`afterPid == beforePid`、`nextTurnPid == beforePid`、`nextTurnThreadId == 中断前的 threadId`；transport 在 interrupt 前后都报告存活。
- [x] AC6 反向控制可达：测试内把「threadId 每轮变化」读数喂给身份断言、把「interrupt 后 pid 变化/进程消失」读数喂给存活断言，两者都必须 reject；各自打印判定，证明判据不是恒真。
- [x] AC7 实测两个假形态承重：临时把真实现改成每轮 `thread/start`，criterion 退出 **1**；临时把 `interrupt` 改成杀进程，criterion 退出 **1**；两次红态文案逐字记录，还原后 `git status --short` 无残留。
- [x] AC8 接口与声明：测试文件里 `CodexHostDriver` 以 `IProviderHostDriver` 类型赋值通过类型检查（`npm run typecheck` 退出 0）；打印 `multiplexedHost=false`。
- [x] AC9 范围不越界：`git diff --name-only develop...HEAD` 仅含 Touches 列出的文件；`git diff --name-only develop...HEAD | grep -E 'codex\.provider\.ts|provider-capabilities\.service\.ts|codex-runtime\.provider\.ts|codex-app-server\.client\.ts'` 输出为空。
- [x] AC10 既有契约不变：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-runtime.test.ts server/modules/providers/tests/codex-session-fork.test.ts` 退出 0；`npm run typecheck` 退出 0。
- [x] AC11 如实登记：完成记录写明假 transport 形态与锁定协议版本（0.153.4）、每轮通知序列、`no rollout found` 错误形状出处（REPORT E1）、两个假形态的实测退出码与红态文案、未实现项（provider 挂载、capabilities、queue/settings/approvals/background lease/restore/E2E）。

## DoD

判据在落地后的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录里贴出 (a) 三轮 `threadId`/pid 读数、(b) 方法调用序列与 resume 计数、(c) 零轮次回退的三个读数、(d) interrupt 前后终态与 pid 读数、(e) 两个反向控制的判定、(f) `multiplexedHost=false`，以及 AC7 两个假形态的实测退出码与逐字红态文案。`npm run typecheck` 退出 0，`codex-runtime.test.ts` 与 `codex-session-fork.test.ts` 退出 0。改动只落在 Touches 列出的文件上，`codex.provider.ts` / capabilities / per-run runtime / fork client 零改动。完成后 goal driver 下一轮以 `goal_ac: AC-435` 独立复跑原 criterion 时由红翻绿；且这次翻绿有分辨力：每轮换新 thread 的实现变体必红，interrupt 杀进程的实现变体必红。

## Touches

- server/modules/providers/list/codex/codex-app-server.connection.ts (new)
- server/modules/providers/list/codex/codex-host-driver.provider.ts (new)
- server/modules/providers/tests/codex-host-driver-persistent.test.ts (new)
- scripts/suite-duration-baseline.tsv
- server/shared/tests/quay-test-script.test.ts
- tasks/gap-ac435-codex-resident-host-driver-persistent.md

## 完成记录

- 判据原命令（worktree 树）：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-persistent.test.ts` → exit **0**，`tests 5 / pass 5 / fail 0`。
- 假 transport 形态：内存双工 JSON-RPC server 桩（`FakeAppServerTransport`），固定假 pid `424242`，记录方法调用序列；处理 `initialize`、`thread/start`（每次新 id）、`thread/resume`（仅在跑过轮次后成功，未跑过轮次回 `no rollout found for thread id <id>`）、`turn/start`（回 `{turn:{id}}` 并发 `turn/started`，随后按指令发 `turn/completed`）、`turn/interrupt`（回 `{}` 并发终态 `status=interrupted`）。不真起 codex。
- 锁定协议版本：`@openai/codex 0.153.4`；`no rollout found` 错误形状出自 `tmp/codex-appserver-exp-NuPHhk/REPORT.md` E1（首轮之前 resume 失败）。
- 每轮通知序列（本判据的假 transport）：`turn/started` → `turn/completed`。真实 app-server 在这两者之间还会发 `item/started` / `item/completed`（E1/E3 原始帧），那些帧的归一化属 AC-440，本条只做轮次结算。
- (a) 三轮读数：`turn=1 threadId=thread-1 hostPid=424242 transportPid=424242`、`turn=2 threadId=thread-1 hostPid=424242 transportPid=424242`、`turn=3 threadId=thread-1 hostPid=424242 transportPid=424242`；三行全等，`identity=accepted turns=3`。
- (b) 方法序列：`initialize,initialized,thread/start,turn/start,thread/resume,turn/start,thread/resume,turn/start`；`threadStartCount=1 threadResumeCount=2`，两次 resume 的 `params.threadId` 均为首轮 id `thread-1`。
- (c) 零轮次回退：`resumeError=no rollout found for thread id thread-zero-turn fallbackThreadId=thread-1 turnThreadId=thread-1`；随后一轮的 `thread/resume` 参数是新 id `thread-1`，旧 id 未被写回。
- (d) interrupt：`interruptTurnStatus=interrupted beforePid=424242 afterPid=424242 nextTurnPid=424242 nextTurnThreadId=thread-1`；`transportAliveBefore=true transportAliveAfter=true`。
- (e) 反向控制：`reverseIdentityRejected=true reversePidChangeRejected=true reverseProcessGoneRejected=true`；正向腿与反向控制共用同一组断言函数（`assertStableIdentity` / `assertInterruptKeptProcess`），证明判据不是恒真。
- (f) `multiplexedHost=false`；测试内 `const conformance: IProviderHostDriver = driver` 通过 `npm run typecheck`（exit 0）。
- AC7 两个假形态（临时改实现后按原命令实测，随后 `git checkout --` 还原，`git status --short` 无残留）：
  - 「每轮 `thread/start`」变体：exit **1**，`fail 3`；逐字红态 `AssertionError [ERR_ASSERTION]: threadId drifted: turn=2 threadId=thread-2 firstTurn=1 firstThreadId=thread-1`。
  - 「`interrupt` 改成关闭连接/杀进程」变体：exit **1**，`fail 1`；逐字红态 `AssertionError [ERR_ASSERTION]: transport reported the process gone after interrupt`（同时打印 `sessionAfterInterruptError=No Codex resident session is bound for "session-interrupt".`）。
- 既有契约：`codex-runtime.test.ts` + `codex-session-fork.test.ts` → `tests 14 / pass 14 / fail 0`，exit 0；`npm run typecheck` exit 0。
- 未实现项（按任务范围留给后续）：未挂载 `CodexProvider.hostDriver`、未改 capabilities 的 `lifecycleModes`（AC-441/442）；queue / settings / approvals / background lease / restore / E2E 未做（AC-436…AC-443）；`codex.provider.ts`、`provider-capabilities.service.ts`、`codex-runtime.provider.ts`、`codex-app-server.client.ts` 零改动。
- 续跑轮（2026-10-29，上一轮 fan-in suite 红 → exited-not-landed 的两条 true cause，均已在本轮修掉并复量）：
  - **本条的测试文件把 quay-test-script 的计数与地板挤红（这个 delta 确实是本条的）。** 上一轮 suite 日志 `/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-ac435-codex-resident-host-driver-persistent~wk-prod-anchor~1793269131729-aa34a6.log` 里 `server/shared/tests/quay-test-script.test.ts` rc=1，三条腿：AC7 `baseline covers 418/465 collected files (< 90%)`（本条新增 server 判据把收集数 464→465，418/465 = 89.9%）、AC2 实读 `unknown=462` vs 钉 `461`、AC3 实读 `unknown=464` vs 钉 `463`。修法：把实测 `duration_ms` 2695 的 baseline 行追加到 `scripts/suite-duration-baseline.tsv`（419/465 = 90.11%），两条 pin 移到 `unknown=462` / `unknown=464` 并在注释里记本条。单文件复跑：`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` → `tests 14 / pass 14 / fail 0`，exit **0**（89.4s）。这两个文件已补进 `## Touches`。
  - **`resident-server-restart.test.ts` 的 SIGTERM 腿超时不是本条的 delta（分支落后 develop 所致）。** 红态：`sigterm-killed killed=0 spared=1` + `Error: Timed out after 20000ms waiting for pid … to leave after SIGTERM`，在 pool 与 isolated 复跑里都复现。真因：满载 anchor 上 `ps -eo pid=,pgid=,ppid=,args=` 超过 Node `spawnSync` 默认 1 MiB，`ENOBUFS` 让 `processTable()` 返回 `[]`，`signalServiceGroup` 因此没给任何进程发信号（`killed=0`），server 从未被停掉；develop 的 `e9ba0da9a` 已修（`PS_MAX_BUFFER_BYTES = 64 MiB` + 读失败抛错而不是当「无此进程」+ AC1c 正控要求表里有本进程）。本轮 `git merge develop` 带入该修复后单文件复跑：`npx tsx --tsconfig server/tsconfig.json --test server/modules/session-hosts/tests/resident-server-restart.test.ts` → `tests 5 / pass 5 / fail 0`，exit **0**（46.2s，其中 `sigterm … gone-after-ms=677`）。
  - **上一轮 `SUITE-INCOMPLETE planned=465 terminal=129 missing=338` 是这两条红的次生结果，不是独立缺陷。** 两个红文件分别耗 240s / 129s，且 test.sh 对 pool 内 flaky 的文件串行隔离复跑（上一轮还有 6 次、约 149s），合起来把 660s 的 `SUITE_MAX_RUNTIME_MS` 撑爆。修掉两条红后重算负载：baseline 419 行实测时长合计 1958254ms（32.6 min），在并发 16 下墙钟约 2.0 min，加 typecheck/lint 阶段远低于 660s 上限。
- 上一轮 `## Blocker`（`worker 未落地`：incomplete suite 338/465）的两个 true cause 已如上述修掉并各自单文件复绿，故清除该条未落地记录。

该轴仍暗,理由:本条只新增两个 codex 私有实现文件与一个判据，未改变模块依赖图，也没有可读的 ArchGuard 周期/重复度量数值。