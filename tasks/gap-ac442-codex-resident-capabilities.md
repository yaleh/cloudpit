---
id: gap-ac442-codex-resident-capabilities
title: AC-442 Codex 常驻 capabilities：codex 声明 resident + 实测 residentFeatures，其他
  provider 写 resident 仍被 LIFECYCLE_MODE_NOT_SUPPORTED 拒绝
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac441-codex-resident-host-lifecycle
goal_ac: AC-442
---
## Proposal

<!-- dedup-ref --> 机制去重与粒度（本轮实测，2026-10-29）：`grep -rl '^goal_ac:[[:space:]]*AC-442' tasks/*.md` → **0** 个文件（exit 1）；`task_list search='codex resident capabilities'` → 0 条。`task-granularity-advice.js --root /data/home/yale/work/claudecodeui --touches server/modules/providers/services/provider-capabilities.service.ts --touches server/modules/providers/tests/codex-resident-capabilities.test.ts --touches server/modules/session-hosts/tests/lifecycle-mode.test.ts --json` 返回 `peers: []`、`mentions: []`、`reasons: []`。**决定：separate，不 merge** —— 本条有独立判据文件与独立验收（capability 声明与拒绝 ≠ 驱动生命周期 AC-441 ≠ 队列/设置/审批 AC-436…AC-439）。resident 声明只有在 AC-441 把 `CodexHostDriver` 挂到 `CodexProvider` 之后才不是一句空话（矩阵自己的契约写在 `provider-capabilities.service.ts:68-83`：「written here only when the driver the provider mounts really serves that mode」），关系边用顶层 `depends_on` 登记（SQL 关系边，不是散文前置）。

**来源与判据物。** criterion 逐字取自 `goals/AC-442-capabilities-codex-声明-resident-其他-provider-拒绝.md`：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-capabilities.test.ts`。红态基线（本轮直跑，不是推断）：该命令在当前主检出 `81eba8b36` 上 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-resident-capabilities.test.ts'`。

**现状（本轮读的读数）**

- `server/modules/providers/services/provider-capabilities.service.ts:206-224` 的 codex 行今天只有 `lifecycleModes: ['per-run']`，没有 `residentFeatures`，`multiplexedHost: false`。
- 拒绝已经是通用实现，不在 provider 分支里：`server/modules/providers/services/sessions.service.ts:1246-1260` 在写 preference 之前读 **session 自己的 provider** 的 `lifecycleModes`，不在列表内就抛 `AppError` `{ code: 'LIFECYCLE_MODE_NOT_SUPPORTED', statusCode: 409 }`。所以本条不新写拒绝逻辑，只让矩阵说真话并用判据钉住它。
- 反面钉子会随声明移动：`server/modules/session-hosts/tests/lifecycle-mode.test.ts:65` 的 `PER_RUN_ONLY_PROVIDERS = ['codex','cursor','opencode']` 被三处使用 —— (2) 的拒绝循环（:464）、(2) 的「同一 codex session 经 claude path 仍拒绝」(:482)、(4c) 的「这些 provider 都不挂 driver」(:611)。codex 一旦声明 resident，前两处必红；AC-441 挂载 driver 后第三处也会红。本条必须把这三处改到仍然 per-run-only 的 provider（cursor/opencode），并保持 AC-169 原有读数语义不变。
- 驱动今天还不存在：`server/modules/providers/list/codex/codex.provider.ts` 没有 `hostDriver` 槽（AC-441 加）。所以「声明 resident」以 AC-441 的挂载为前置，见 depends_on。
- 新判据文件会撞两条随树移动的钉子：当前 `find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | wc -l` = **464**，`scripts/suite-duration-baseline.tsv` 数据行 **418**（418/464 = 90.09%，贴着 90% 地板），`server/shared/tests/quay-test-script.test.ts` 的两条 pin 是 `unknown=461` / `unknown=463`（本行读数：该文件第 394、477 行）。新增一个 `server/**/*.test.ts` ⇒ 465 收集、418/465 = 89.89% ⇒ AC7 红，两条 pin 各差 1。两处都要在本条里补/移动（AC9）。

**实测值从哪来（锁定版 `@openai/codex 0.153.4`，`tmp/codex-appserver-exp-NuPHhk/REPORT.md` E1–E8）**

| `residentFeatures` 字段 | 值 | 读数出处 |
|---|---|---|
| `interruptKeepsProcess` | `true` | E3：`turn/interrupt` 后该 turn `status=interrupted`，app-server pid 全程不变 |
| `liveReconfigure` | `['model','effort']` | E4：`thread/settings/update` 在 idle 与 active 都被接受并回 `thread/settings/updated`；`turn/settings/update` 需要 `step_model_switching`（0.153.4 `under development false`）⇒ 不列 `permissionMode`（E4 只测了 approvalPolicy/sandboxPolicy 两个字段的直接更新，没有 `permissionMode → (approvalPolicy,sandboxPolicy)` 映射的在线读数；那属 AC-437） |
| `unattendedTurns` | `true` | E2：正常 `turn/completed` 后队列自动起下一 turn，无需客户端动作 |
| `addressable` | `true` | E1/E6：同一 thread id 在首轮后 resume、跨 app-server 进程仍可 resume |
| `inputWhileBusy` | `true` | E2：`status=active` 时 `thread/queue/add` 被接受 |
| `cancelQueuedInput` | `true` | E2：`thread/queue/delete` 删掉指定条目，`queue/list` 只剩另一条 |
| `backgroundTasks` | `false` | E5b：agent 发起的后台终端**未观测到**（读数缺口）；E5 的 `process/spawn` 是 client-owned，且不在 `thread/backgroundTerminals/list` 里 |
| `authoritativeLeases` | `false` | 没有 CLI 事件声明保活原因；busy 由 driver 从 turn 流推导（AC-441） |
| `stopTask` | `false` | E5 的 `process/kill` 只证明 client-owned 进程可杀；resident 后台任务账本在 AC-438/439，未接线前不得声明 |
| `remoteControl` | `false` | 未测 |

**要建的东西**

1. `server/modules/providers/services/provider-capabilities.service.ts`（改）—— codex 行：
   - `lifecycleModes: ['per-run', 'resident']`；`multiplexedHost: false` 不变（人 yale 裁定 ① 一会话一 app-server）；
   - 新增 `residentFeatures`，字段与值严格照上表，每个字段旁写实验编号（`// E3` …），未测字段写明「unmeasured ⇒ false」的理由。**不**改 claude / cursor / opencode 行。
2. `server/modules/providers/tests/codex-resident-capabilities.test.ts`（new；hermetic：不 spawn 真 codex、不碰网络；DB 用 `mkdtemp` + `DATABASE_PATH` + `initializeDatabase`，与 `claude-cross-session-message.test.ts:41-61` 同形）。判据腿：
   - (a) **矩阵读数**：`providerCapabilitiesService.getProviderCapabilities('codex')`；`[...lifecycleModes].sort()` 严格等于 `['per-run','resident']`；`multiplexedHost === false`；`assert.deepEqual(residentFeatures, 上表)`（含 `stopTask:false`）。逐字段打印。
   - (b) **拒绝 + 正控制**：每个 per-run-only provider（`['cursor','opencode']`）seed 一条 session，调 `sessionsService.switchSessionLifecycleMode(provider, sessionId, 'resident')`；用 predicate 断言抛出的 `AppError` 满足 `code === 'LIFECYCLE_MODE_NOT_SUPPORTED' && statusCode === 409`（**不要**用全文案相等）；`sessionsDb.getSessionLifecycleMode(sessionId)` 仍为 `per-run`（拒绝不落库）。正控制：codex 与 claude 的 session 同一调用不抛、读回 `resident`。每个 provider 打印 `provider=… code=… status=… stored=…`。
   - (c) **path-vs-session**：cursor 的 session 用 provider 参数 `'codex'` 调同一服务，仍被拒绝（矩阵跟随 `session.provider`，不是 URL）；打印 `pathProvider=codex sessionProvider=cursor code=…`。
   - (d) **声明必须由挂载的驱动承担**：`providerRegistry.resolveProvider('codex')` 的 `hostDriver` 存在、`multiplexedHost === false`、`typeof hostDriver.startResidentSession === 'function'`（AC-441 提供）；反向控制：把同一断言喂给 `{ id:'codex', hostDriver: undefined }` 必须 reject，打印 `mounted=… multiplexedHost=… reverseRejected=true`。
   - (e) **未实测能力必须红（假形态，内建持久）**：把 shipping 的 `provider-capabilities.service.ts` 读成文本，复制到 `server/modules/providers/services/__criterion-falsify-resident-features-<pid>.ts`，只把 `backgroundTasks: false` 改成 `true`（另加一臂 `authoritativeLeases: false`→`true`），动态 import 副本并用 (a) 的**同一个**断言函数读它 → 必须 reject；shipping 读绿；`finally` 删除副本并断言不存在。命中数用全局 match 断言恰 1 次（替换零处会让假形态变空转）。`server/tsconfig.json:92-101` 已按 `./**/__criterion-falsify-*` 排除该副本。打印 `shippingBackgroundTasks=false falsifiedBackgroundTasks=true redOnCraft=true`。
   - (f) **liveReconfigure 不越界**：`assert.deepEqual(features.liveReconfigure, ['model','effort'])`；`features.liveReconfigure` 不含 `'permissionMode'`，注释写明 E4 与 `step_model_switching` 的读数。
3. `server/modules/session-hosts/tests/lifecycle-mode.test.ts`（改）—— 只改夹具与断言的 subject，不改 AC-169 的语义：
   - `PER_RUN_ONLY_PROVIDERS` → `['cursor','opencode']`（:65）；
   - (2) 的 disguised 臂（:482）改成用 cursor（或 opencode）的 session 经 claude path 写 resident，仍是「拒绝且不落库」；
   - (4c)（:611）保留「真实 registry 里这些 provider 不挂 driver」的断言，session 也 seed 成 cursor/opencode（codex 挂上 driver 后不能再当「no driver」的例子）；若 AC-441 已改过这处，保持其形状、只确认 cursor/opencode 仍在集合内。
4. **新测试文件预算**（见按记忆的系统性钉子）：
   - 单文件跑一次新判据量 `duration_ms`，把 `<ms>\t<path>` **追加**到 `scripts/suite-duration-baseline.tsv` 末尾，并在文件头来源说明里记一条 `measured one file at a time on 2026-10-29`；
   - `server/shared/tests/quay-test-script.test.ts` 的两条 `unknown=` pin 各 +1（本文件计入后应重新用 `find … | wc -l` 在**最终合并树**上实测：当前 464 + 本文件 = 465，但兄弟任务 AC-435…AC-441 也各加判据文件，必须按合并后的并集重算，不要按任一侧的 465 硬写）；
   - 两个文件都写进 Touches（否则 anti-drift 报 `out-of-declared`）。
5. 非目标：不改 `codex.provider.ts` / `codex-host-driver.provider.ts`（AC-441）；不改 `sessions.service.ts` 的拒绝逻辑；不改 `ResidentFeatures` 形状（`stopTask` 仍走本 service 的扩展类型）；不做 queue / settings / approvals / background lease（AC-436…AC-439）；不写 E2E（AC-443）。

**假形态（只临时改实现，不改判据文件；测后 `git checkout --` 还原并记录逐字红态）**

- A：从 codex 的 `lifecycleModes` 去掉 `'resident'` ⇒ criterion exit **1**，红在 (a)（同时 (b) 的 codex 正控制也红）；
- B：把 shipping 的 `backgroundTasks: false` 改成 `true` ⇒ criterion exit **1**，红在 (e) 的 false form 与 (a) 的 deepEqual；
- C（可选）：临时删掉 AC-441 的 `hostDriver` 挂载 ⇒ (d) 红（该文件属 AC-441，测完必须还原）。

## AC

- [x] AC1 判据入口为绿：`npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-capabilities.test.ts` 退出 **0**，输出 `fail 0` 且 `pass >= 5`。红态基线已测：同命令当前 exit 1、文案逐字 `Could not find 'server/modules/providers/tests/codex-resident-capabilities.test.ts'`。
- [x] AC2 codex 声明 resident：判据打印 `provider=codex lifecycleModes=per-run,resident multiplexedHost=false residentFeatures=<json>`；`lifecycleModes` 排序后严格等于 `['per-run','resident']`、`multiplexedHost === false`、`residentFeatures` 存在。
- [x] AC3 residentFeatures 按实测值：判据以 `deepEqual` 钉住 `{interruptKeepsProcess:true, liveReconfigure:['model','effort'], unattendedTurns:true, addressable:true, inputWhileBusy:true, cancelQueuedInput:true, backgroundTasks:false, authoritativeLeases:false, stopTask:false, remoteControl:false}`；完成记录里对每个字段写出 REPORT 实验编号（E1/E2/E3/E4/E5b/E6）与「未测 ⇒ false」字段的理由。
- [x] AC4 其他 provider 写 resident 被拒：判据打印 `provider=cursor code=LIFECYCLE_MODE_NOT_SUPPORTED status=409 stored=per-run` 与 `provider=opencode …`；两臂都抛出 `AppError` 且 `code === 'LIFECYCLE_MODE_NOT_SUPPORTED'`、`statusCode === 409`、数据库读回仍 `per-run`；正控制打印 `provider=codex stored=resident` 与 `provider=claude stored=resident` 且不抛。
- [x] AC5 矩阵跟随 session 而非路径：判据打印 `pathProvider=codex sessionProvider=cursor code=LIFECYCLE_MODE_NOT_SUPPORTED`，即 cursor 的 session 经 `'codex'` 路径写 resident 仍被拒绝且不落库。
- [x] AC6 声明由挂载的驱动承担：判据打印 `mounted=true multiplexedHost=false reverseRejected=true`；`providerRegistry.resolveProvider('codex').hostDriver` 非空、`multiplexedHost === false`、`startResidentSession` 是函数；同一断言喂给无 driver 的合成行必须 reject（反向控制可达）。
- [x] AC7 未实测能力必须红：判据打印 `shippingBackgroundTasks=false falsifiedBackgroundTasks=true redOnCraft=true`；`__criterion-falsify-resident-features-<pid>.ts` 的替换命中数为 **1**（0 命中视为假形态空转，判据自身失败），副本读红、shipping 读绿，`finally` 后副本不存在；`liveReconfigure` 严格等于 `['model','effort']` 且不含 `'permissionMode'`。
- [x] AC8 既有判据不破：`lifecycle-mode.test.ts` 的 `PER_RUN_ONLY_PROVIDERS` 已改为 `['cursor','opencode']`，disguised 臂与 (4c) 的 subject 同步改到这两个 provider；`npx tsx --tsconfig server/tsconfig.json --test <file>` 对 `server/modules/session-hosts/tests/lifecycle-mode.test.ts`、`resident-host-service.test.ts`、`resident-ondemand-start-route.test.ts`、`server/modules/providers/tests/provider-runtime.service.test.ts`、`codex-runtime.test.ts`、`server/modules/session-hosts/tests/session-host-default-wrap.test.ts` **逐个单文件**退出 0；`npm run typecheck` 退出 0。不得起无界多文件 fan-out（见 `docs/operations/process-isolation-and-memory-caps.md`）。
- [x] AC9 新测试文件预算：`scripts/suite-duration-baseline.tsv` 追加了本判据文件实测 `duration_ms` 一行且头部来源说明更新；`server/shared/tests/quay-test-script.test.ts` 两条 `unknown=` pin 在**最终合并树**上按 `find … | wc -l` 重算后各 +1，单文件跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/quay-test-script.test.ts` 退出 0；两文件都在 Touches 里。
- [x] AC10 假形态承重：按上文 A、B 两条各实测一次，criterion 退出 **1**，逐字红态文案写进完成记录；随后 `git checkout --` 还原，`git status --short` 只剩 Touches 列出的改动（外加 C 可选臂的还原）。
- [x] AC11 范围不越界：`git diff --name-only develop...HEAD` 只含 Touches 列出的文件；`git diff --name-only develop...HEAD | grep -E 'codex\\.provider\\.ts|codex-host-driver\\.provider\\.ts|sessions\\.service\\.ts|session-host-manager\\.service\\.ts|shared/types\\.ts'` 输出为空。
- [x] AC12 如实登记：完成记录写明红态基线、逐字段实测值出处、拒绝读数、path-vs-session 读数、挂载/反向控制读数、假形态 A/B 的退出码与逐字文案、baseline 行与 pin 的新值、以及未实现项（驱动挂载属 AC-441，queue/settings/approvals/background lease 属 AC-436…AC-439，E2E 属 AC-443）。

## DoD

判据在落地后的树上按原命令重跑：退出码 0 且 `fail 0`。完成记录贴出 (a) codex 矩阵与 residentFeatures 的逐字段读数、(b) cursor/opencode 的拒绝读数与 codex/claude 正控制、(c) path-vs-session 读数、(d) 挂载与反向控制读数、(e) 假形态的 `shipping=false / falsified=true / redOnCraft` 与替换命中数、(f) `liveReconfigure=['model','effort']`。假形态 A、B 的实测退出码与逐字红态文案各一条。`npm run typecheck` 退出 0，AC8 列出的六个既有判据逐个单文件退出 0，`quay-test-script.test.ts` 单文件退出 0。`scripts/suite-duration-baseline.tsv` 与两条 `unknown=` pin 已按最终合并树更新且两文件在 Touches 内。改动只落在 Touches：`codex.provider.ts` / `codex-host-driver.provider.ts` / `sessions.service.ts` / manager / `shared/types.ts` 零改动。完成后 goal driver 下一轮以 `goal_ac: AC-442` 独立复跑原 criterion 时由红翻绿；且这次翻绿有分辨力：codex 不声明 resident 的变体必红，matrix 声称未实测 `backgroundTasks` 的变体必红，没有挂载驱动的 codex 声明必红。

## Touches

- server/modules/providers/services/provider-capabilities.service.ts (modify: codex lifecycleModes 加 resident、新增实测 residentFeatures)
- server/modules/providers/tests/codex-resident-capabilities.test.ts (new)
- server/modules/session-hosts/tests/lifecycle-mode.test.ts (modify: PER_RUN_ONLY_PROVIDERS、disguised 臂、(4c) subject)
- scripts/suite-duration-baseline.tsv (append: 新判据文件实测 duration 一行)
- server/shared/tests/quay-test-script.test.ts (modify: 两条 unknown= pin 与来源注释)
- server/modules/providers/tests/provider-capabilities-cancel-queued.test.ts (modify: AC-350 假形态改锚到 claude 行——AC-442 的 codex 行按实测同样声明 cancelQueuedInput:true，整文件唯一性 pin 会把两个独立实测读成冲突)
- tasks/gap-ac442-codex-resident-capabilities.md

## 完成记录 (2026-10-29)

**红态基线。** 在 `goal/GOAL-051` 基础上直跑判据命令，exit **1**，逐字：
`Could not find 'server/modules/providers/tests/codex-resident-capabilities.test.ts'`
（文件不存在，与 Proposal 记录一致）。

**落地后判据（最终树：本任务两次提交 + merge develop 之后）。** 同命令 exit **0**，`tests 6 / pass 6 / fail 0`。

**(a) codex 矩阵读数（判据原样输出）。**
`provider=codex lifecycleModes=per-run,resident multiplexedHost=false residentFeatures={"interruptKeepsProcess":true,"liveReconfigure":["model","effort"],"unattendedTurns":true,"addressable":true,"inputWhileBusy":true,"cancelQueuedInput":true,"backgroundTasks":false,"authoritativeLeases":false,"stopTask":false,"remoteControl":false}`

逐字段出处（`tmp/codex-appserver-exp-NuPHhk/REPORT.md` E1–E8，锁定 `@openai/codex 0.153.4`）：

| 字段 | 值 | 出处 / 「未测 ⇒ false」理由 |
|---|---|---|
| interruptKeepsProcess | true | E3：`turn/interrupt` 后该 turn `status=interrupted`，app-server pid 全程不变 |
| liveReconfigure | ['model','effort'] | E4：`thread/settings/update` 在 idle 与 active 都被接受；`turn/settings/update` 需要 `step_model_switching`（0.153.4 under development false）⇒ 不列 permissionMode |
| unattendedTurns | true | E2：正常 `turn/completed` 后队列自动起下一 turn |
| addressable | true | E1/E6：同一 thread id 首轮后可 resume，跨 app-server 进程仍可 resume |
| inputWhileBusy | true | E2：`status=active` 时 `thread/queue/add` 被接受 |
| cancelQueuedInput | true | E2：`thread/queue/delete` 删指定条目，`queue/list` 只剩另一条 |
| backgroundTasks | false | E5b：agent 发起的后台终端未观测到；E5 的 `process/spawn` 是 client-owned，且不在 `thread/backgroundTerminals/list`。未测 ⇒ false |
| authoritativeLeases | false | 没有 CLI 事件声明保活原因；busy 由 driver 从 turn 流推导（AC-441）。未测 ⇒ false |
| stopTask | false | E5 的 `process/kill` 只证明 client-owned 进程可杀；resident 后台任务账本属 AC-438/439，未接线。未测 ⇒ false |
| remoteControl | false | 未测 ⇒ false |

**(b) 拒绝与正控制（判据原样输出）。**
`provider=cursor code=LIFECYCLE_MODE_NOT_SUPPORTED status=409 stored=per-run`
`provider=opencode code=LIFECYCLE_MODE_NOT_SUPPORTED status=409 stored=per-run`
`provider=codex stored=resident`
`provider=claude stored=resident`

**(c) path-vs-session。** `pathProvider=codex sessionProvider=cursor code=LIFECYCLE_MODE_NOT_SUPPORTED stored=per-run`（cursor 的 session 经 codex 路径写 resident 仍被拒且不落库）。

**(d) 挂载与反向控制。** `mounted=true multiplexedHost=false reverseRejected=true`：真实 registry 的 codex `hostDriver` 非空、`multiplexedHost=false`、`startResidentSession` 是函数；同一断言喂给 `{ id:'codex', hostDriver: undefined }` 被拒。

**(e) 未实测能力必须红。** `shippingBackgroundTasks=false falsifiedBackgroundTasks=true redOnCraft=true`；两臂替换命中数各断言恰 1（0 命中判据自身失败）；副本 `finally` 删除并由 `access()` 断言不存在；`liveReconfigure=["model","effort"] includesPermissionMode=false`。每臂用独立副本文件名，避开 ESM 按 URL 缓存。

**(f) liveReconfigure 不越界。** 严格等于 `['model','effort']`、不含 `'permissionMode'`；E4 与 `step_model_switching` 的读数写在 service 注释里。

**假形态 A（从 codex lifecycleModes 去掉 'resident'）。** exit **1**；逐字：
`AssertionError [ERR_ASSERTION]: codex must declare per-run and resident, got per-run`
（红在 (a)；(b) 的 codex 正控制与 (e) 的 shipping 绿臂同红）。`git checkout --` 还原。

**假形态 B（shipping 的 backgroundTasks: false → true）。** exit **1**；逐字：
`AssertionError [ERR_ASSERTION]: the matrix must state exactly the measured features`
（红在 (a) 的 deepEqual 与 (e) 的 shipping 绿臂）。`git checkout --` 还原；`git status --short` 只剩 Touches 的改动。

**新测试文件预算。**
- `scripts/suite-duration-baseline.tsv` 追加 `7308<TAB>server/modules/providers/tests/codex-resident-capabilities.test.ts`（两次 warm run 7721/7308ms），来源说明记 `measured one file at a time on 2026-10-29`；数据行 424/470 = 90.21%，守住 90% 地板。
- `server/shared/tests/quay-test-script.test.ts` 两条 pin 在**最终合并树**按 `find server -name '*.test.ts' -o -name '*.test.js' | grep -v node_modules | wc -l` = **470** 重算：`unknown=466→467`（470-3）、`unknown=468→469`（470-1）；单文件 exit 0、`pass 14 / fail 0`。
- 两文件均在 Touches 内；anti-drift 读数：`ANTI-DRIFT OK — 5 actual file(s), all within declared Touches (6 glob(s))`。

**既有判据（最终树逐个单文件）。** `lifecycle-mode.test.ts` 9/9、`resident-host-service.test.ts` 5/5、`resident-ondemand-start-route.test.ts` 4/4、`provider-runtime.service.test.ts` 9/9、`codex-runtime.test.ts` 12/12、`session-host-default-wrap.test.ts` 6/6，全部 exit 0。`npm run typecheck` exit 0。

**AC11 的读数范围说明。** 工作树根在 `goal/GOAL-051`，该分支已含 AC-441 等兄弟任务代码而 develop 尚未包含，所以字面 `git diff --name-only develop...HEAD` 会带上兄弟任务已落地的文件（`codex.provider.ts` 等），这不是本条的写入。本条自己的两个提交只碰 5 个 Touches 文件（`git show --name-only ebfa6fb98 10078c38a`）；按 owner 分支 `goal/GOAL-051...HEAD` 读，禁用清单 grep 为空，anti-drift 也只认了这 5 个文件。

**未实现项（按设计不在本条）。** 驱动挂载属 AC-441（已落地，本条只声明并用判据钉住）；queue / settings / approvals / background lease 属 AC-436…AC-439；E2E 属 AC-443。`codex.provider.ts` / `codex-host-driver.provider.ts` / `sessions.service.ts` / `session-host-manager.service.ts` / `shared/types.ts` 零改动。


**suite 红修复（2026-10-29，exited-not-landed 轮）。** 上轮 suite 唯一红是 AC-350 的假形态判据 `server/modules/providers/tests/provider-capabilities-cancel-queued.test.ts`：它把 `cancelQueuedInput: true,` 的**整文件**命中数钉成 1，而本条给 codex 行按 E2 实测同样写了 `cancelQueuedInput: true`（AC3 的 deepEqual 要求）⇒ 命中数 2，判据红。这不是环境抖动，单文件复现一致。修法是把假形态锚到本条判据的**主体**——claude 行（E9/E10/U4 的实测对象）：在 claude 行切片内仍断言赋值命中数恰 1，仍按**赋值**（不是注释）匹配，仍写 `__criterion-falsify-cancel-queued-<pid>.ts` 动态 import 读回 false，语义未削弱；只是不再要求「全模块只有一家 provider 声明这个实测值」。该文件因此成为本条的第六个产物，已补进 `## Touches`。修后单文件 `tests 2 / pass 2 / fail 0`；本条判据 `codex-resident-capabilities.test.ts` 6/6 仍绿。
该轴仍暗,理由:本任务只改 capability 声明与判据文件，未触及模块依赖边，未运行 archguard 读数

## Blocker

**2026-10-29T14:20:05.361Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: not ok - server/modules/providers/tests/provider-capabilities-cancel-queued.test.ts:   AssertionError [ERR_ASSERTION]: the false form must flip exactly one field assignment in provider-capabilities.service.ts, found 2 [baseline A/B: HARD RED (task-introduced-red) — the task's red set is NOT a subset of the goal/GOAL-051 baseline red set: added=server/modules/providers/tests/provider-capabilities-cancel-queued.test.ts,server/modules/providers/tests/provider-capabilities-cancel-queued.test.ts changed=-]
- run_id：wk-prod-anchor
- session_id：9f7e2751-6874-4237-ae90-509b338c8474

**2026-10-29T14:34:51.867Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=doc-face-done-sync: propagateDocBranchToDevelop failed (doc→develop ff-only ∧ semantic fallback both failed)
- run_id：wk-prod-anchor
- session_id：9d1f1c56-ca18-48de-acc4-79e3fb9b371d
