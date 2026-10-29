---
id: gap-goal-051-exit-and-logging-not-an-ac
title: GOAL-051 范围第 1 条的「退出与日志」无在域 AC 覆盖：提议新增 AC-445（app-server 自行退出被记录、主动关闭不误报），交人裁定
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  needs_human_cause: human-adjudication
  park_reason: GOAL-051 充分性判官（.quay/goal-sufficiency-followup.json
    entries[GOAL-051] key df8439…, since 2026-10-29T16:16:07.544Z, filedAt
    null）在 10 条在域 AC 上仍判 insufficient（.quay/goal-round.jsonl round 880,
    2026-10-29T16:16:07.546Z）。判官输入含 `## 范围`（goal-driver.ts
    buildSufficiencyPrompt 明令 judge the AC set against it），而范围第 1 条的「退出与日志」在 10
    条在域 AC 的 title/expect 中零覆盖：`grep -l 日志 goals/AC-*.md` 对 GOAL-051 在域 AC =
    0；实现层 handleExit 首行 `void reason;` 丢弃连接层已采集的退出原因，且无日志出口。本任务只提议新增 AC-445，不改
    goals/*.md、不改任何 GOAL/AC 状态。
---
## Proposal

**提案选型：(a) 新增一条在域 AC（建议编号 AC-445），由人 yale 裁定。** 本 agent 不改 `goals/*.md`、不改任何 GOAL/AC 状态、不实现日志；本任务只提议。

### 未被覆盖的部分（逐字引用）

GOAL-051 `## 范围` 第 1 条（`goals/GOAL-051-codex-常驻会话-app-server-长驻进程跨轮存活-忙时输入进队列-中止不杀进程-后台与审批与空闲重启语义明确.md:25`）逐字：

> - CodexAppServerConnection：长驻 stdio JSON-RPC，initialize 声明 capabilities.experimentalApi=true（thread/queue 必需），request/notification/server-request 分发，退出与日志。

**未被覆盖的碎片 = 这条最后的「退出与日志」。** 它要求两件今天都没有的事：(i) app-server **自行退出**（不是我们主动关闭）时，退出原因（exit code/signal 与 stderr 尾巴）被检测并留下可读日志；(ii) **主动关闭不得被误报**成进程自行退出。

GOAL 标题（同文件 `:3`）逐字把长驻进程生命周期列为本目标本身：

> Codex 常驻会话：app-server 长驻进程跨轮存活、忙时输入进队列、中止不杀进程、后台与审批与空闲重启语义明确

判官输入不只退出条件一行：`buildSufficiencyPrompt()`（`/data/home/yale/.claude/plugins/marketplaces/quay/plugin/scripts/goal-driver.ts:1225-1260`）把 `## 退出条件`、`## 范围*`、在域 AC 的 (id,title,expect) 一起喂给判官，并逐字要求：

> The scope section, when present, is where that decomposition is actually written down — judge the AC set against it, not against the exit conditions alone.

### 为何现有在域 AC 集不覆盖它（机械读数，不是推断）

在域 AC = `goals/` 中 `goal: GOAL-051` 的 10 条（AC-435..AC-444，`grep -l '^goal: GOAL-051' goals/AC-*.md | wc -l` → 10）。逐条读 title/expect：

- **AC-440** 是唯一一条连接层 AC，title「协议门控：experimentalApi 声明与未知通知放过」；expect 只认领 initialize/experimentalApi/fail-closed/未知 notification——**全文无「退出」「日志」**。
- **AC-441** 的 expect 有「closeHost/unbind 原因正确」，但那钉的是宿主 closeReason 枚举（`HostCloseDetail = 'oom' | 'signal' | 'error' | 'forced'`，`server/shared/types.ts:2755`），不携带任何进程文本，也不要求写日志；它无法承载 stderr 尾巴。
- AC-435/436/437/438/439/442/443/444 分别是跨轮存活/队列/设置/审批/后台 lease/capabilities/浏览器/steer，无一涉及「进程自行退出后的诊断记录」。

机械读数（本轮直跑）：

- 10 条在域 AC 文件里 `grep -l "日志"` → 0；`grep -l "退出"` → 0；`grep -l "log"` → 0。
- 实现层也确实是缺口，不是「AC 没写但代码已有」：
  - 连接层已采集数据：`server/modules/providers/list/codex/codex-app-server.connection.ts:517-519` 把 `exited (code …, signal …) — <stderr 最后一行>` 组进 reason，`:321` 经 `onExit` 交出去；
  - 驱动层丢弃：`server/modules/providers/list/codex/codex-host-driver.provider.ts:766-767` 的 `handleExit(reason: string)` 第一行就是 `void reason;`；
  - `:783` 只上报 `this.sink?.exited({ hostId, detail: 'error' })`，reason 不进任何可读通道；
  - `CodexHostDriverOptions`（`server/modules/providers/list/codex/codex-host-driver.contract.ts:56-78`）没有日志出口。
  ⇒ **数据存在、驱动丢弃、日志不存在。**

### 本提案（选 a：新增 AC-445）

建议由被授权的 goal 写入路径创建 `goals/AC-445-连接退出可诊断-自行退出被记录-主动关闭不误报.md`（`goal: GOAL-051`、`kind: criterion`、`status: active`、`phase: pre-merge`，与 AC-435..442 同形），并把 GOAL-051 `## 退出条件`（`:46`）的编号范围改到含 AC-445，建议逐字：

> - AC-435..AC-445（pre-merge，判据 worktree 上求值）+ AC-443（post-merge，真实浏览器，主检出上求值）。

**title（建议逐字）：** 连接退出可诊断：app-server 自行退出被记录（code/signal + stderr 尾巴），主动关闭不误报

**criterion（建议逐字）：**

```
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-exit-and-logging.test.ts
```

**expect（建议逐字）：** 假 app-server transport（不真起 codex）：注入的 transport 自行退出（exit code 1 + 非空 stderr 末行）时，(1) `CodexHostDriver` 经可注入的日志出口（`logSink`，与 `claude-host-driver.provider.ts:909` 同名同形，默认空操作）恰好写出一行，行内同时含 exit code/signal 与 stderr 最后一行；(2) 该会话在飞 turn 被 settle 为 failed、队列/审批/后台 lease 全部结算（不是永久挂起），在飞请求以含同一 reason 的可读 AppError 拒绝，宿主以 `closeReason=exited`、`detail=error` 上报；(3) 主动 `closeHost`/`terminate` 不写这条退出日志、不把主动关闭报成 `exited`；(4) 退出后再发送被本地 fail-closed 拒绝且向已死 transport **零帧**写出、不挂起。假形态：(a) 驱动继续 `void reason`，或日志行缺 stderr 尾巴/exit code ⇒ (1) 必须红；(b) 自行退出后该 turn 仍 pending（直到超时或永久挂起）⇒ (2) 必须红；(c) 主动关闭也写退出日志或把 closeReason 记成 exited ⇒ (3) 必须红；(d) 退出后的写仍到达已死 transport 或挂起 ⇒ (4) 必须红。

判据形态与 AC-435/436/437/438/440 一致：注入内存假 transport，不 spawn 真 codex、不碰 DB/网络；不是 e2e，按 pre-merge 在 worktree 上求值。**红态基线（本轮直跑，不是推断）：** 上述 criterion 当前 exit 1，文案逐字 `Could not find 'server/modules/providers/tests/codex-resident-exit-and-logging.test.ts'`（判据文件尚未存在，与 AC-435..442/AC-444 的红先行一致）。

**依据（为什么这条 AC 写得出可运行判据）：** 这条 AC 钉的是我们自己驱动/连接层的可观测性契约，不需要真 codex 的新实测；它的数据源（exit code/signal、stderr 尾巴）已在生产 code path 上采集（`codex-app-server.connection.ts:517-519`），只是被 `handleExit` 丢弃。日志出口的形态沿用同仓常驻驱动既有先例：`claude-host-driver.provider.ts:909` 的 `logSink?: (line: string) => void`，其注释说明它是「不捕获全局 console 的额外可观测通道」。

### 为何这样覆盖了它

「退出与日志」从一句散文变成一条可执行判据，且四个可分辨的假形态各自能打红：缺日志/缺 stderr 尾巴、退出后挂起、主动关闭误报、向死连接继续写。任一把实现做成「只有 closeReason 枚举、没有诊断记录」的形态都会被打红，因此它不是「有 `exited` 回调即绿」的空门。落地后 AC-445 进入在域 AC 集，判官输入的 acLines 第一次包含「退出」「日志」。

### 为何选 (a) 而不是 (b)

「退出与日志」不是退出条件写得比本目标该做的多：它在 `## 范围` 第 1 条逐字列出，且今天代码里明确是丢弃（`void reason;`）+ 无日志出口。缺的是**在域 AC 覆盖**（一个 AC 号 + 一个判据文件），不是文本多余。改范围文本来删掉它，会削掉人 yale 在范围里写下的长驻进程可诊断性要求。故选 (a)。

### 顺带发现（登记供人裁定，不构成本条提案第二项）

判官同时读 `## 范围` 全文。除「退出与日志」外，剩余三处今天也没有在域 AC 的 title/expect 认领；若 AC-445 落地后判官仍为 `insufficient`，下一轮跟进应先读这三处，不要重复怀疑本条的退出/日志：

1. 范围第 2 条「multiplexedHost=false，一会话一 app-server」——对 10 条在域 AC `grep -l multiplexedHost` → 0；不过绑定的通用规则已由 AC-158（GOAL-013，achieved，`server/modules/session-hosts/tests/session-host-bindings.test.ts`）以 provider 中立方式钉住，codex 行 `multiplexedHost: false` 也在 AC-442 的判据文件里断言（只是 AC-442 的 expect 文本没写）。建议人裁定在范围里登记这层覆盖，而不是重复立 AC。
2. 范围第 9 条「进程 containment：复用 claudecodeui-session-* scope 与启动清扫」——已被 AC-167（GOAL-013，achieved，`server/modules/session-hosts/tests/process-containment.test.ts`）以 provider 中立方式钉住；同上，建议登记而非重复立 AC。
3. 范围第 10 条「新增 Codex 错误文案」——AC-443 的 expect 只到常驻开关/忙时撤回/状态栏/Shell，无错误文案；这是除本条外唯一另一处需要独立 AC 的碎片。

### 去重与红态基线

<!-- dedup-ref -->
同类提案只此一份：`grep -rln 'AC-445' goals/ tasks/` → 0；`tasks/gap-ac444-codex-resident-turn-steer.md`（ready）与本提案 Touches 在 `codex-host-driver.provider.ts` / `codex-host-driver.contract.ts` 上重叠，但机制不同（steer 改当前 turn vs 退出诊断日志），**separate：独立验收，且该 peer 已 ready、即将 dispatch**。上一份充分性提案 `tasks/gap-goal-051-turn-steer-not-an-ac.md` 提议的 AC-444 已由人 yale 接受并落地（`goals/AC-444-忙时-steer-turn-steer-改当前-turn-不排队列-不开新-turn.md` 存在且 status active），其缺口已关闭，不构成重复。

- 红态基线：见上，criterion 当前 exit 1，文案逐字 `Could not find 'server/modules/providers/tests/codex-resident-exit-and-logging.test.ts'`。
- 判官现状（读 `.quay/`，不是推断）：`.quay/goal-sufficiency-followup.json` 的 `entries["GOAL-051"] = {key: df8439596daa41c5f467a02b8eb8f43e8422fccc85461c60a77246253285d839, since: 2026-10-29T16:16:07.544Z, filedAt: null}`；`.quay/goal-round.jsonl` 的 GOAL-051 `goal-sufficiency` 最新事实 round 880（2026-10-29T16:16:07.546Z）为 `insufficient`，reason 逐字「sufficiency=insufficient（在域 AC 10 条）」；round 879 为 `not-evaluated（cause=samples-disagree）`，round 878 为 `insufficient（在域 AC 9 条）`。

## AC

- [ ] AC1 **人（yale）已裁定并被记录**：本任务 `## Resolution` 小节写明 (i) 是否采纳新增 AC-445（连接退出可诊断：自行退出记录、主动关闭不误报），(ii) 若采纳，GOAL-051 `## 退出条件` 第 46 行如何改（建议逐字改为 `- AC-435..AC-445（pre-merge，判据 worktree 上求值）+ AC-443（post-merge，真实浏览器，主检出上求值）。`，明确 AC-443 仍是 post-merge），(iii) 上文「顺带发现」三处（multiplexedHost/一会话一 app-server、containment、Codex 错误文案）的处置。三者缺一即本 AC 不满足。该行只能由人 yale 写入（待外部）
- [ ] AC2 **新 AC 记录落地且判据可跑**：`goals/AC-445-连接退出可诊断-自行退出被记录-主动关闭不误报.md` 由被授权的 goal 写入路径创建（`goal: GOAL-051`、`kind: criterion`、`status: active`、`phase: pre-merge`），`criterion` 与 `expect` 逐字取本 Proposal；实现落地后同一条 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-resident-exit-and-logging.test.ts` 退出 0 且 `fail 0`，并把红态基线（exit 1 + 逐字 `Could not find '…codex-resident-exit-and-logging.test.ts'`）与绿态读数一起记录。该行只能由 goal 写入路径与后续实现任务落地（待外部）
- [ ] AC3 **判据非恒真**：按 expect 的四条假形态逐条变异并实测，每条必须令 criterion 退出非 0 且失败落在被点名的腿：(a) `handleExit` 重新 `void reason` / 日志行改为不含 stderr 尾巴或 exit code ⇒ (1) 红；(b) 自行退出后不 settle 在飞 turn（继续 pending）⇒ (2) 红；(c) `closeHost` 路径也写退出日志 / 把 closeReason 记成 `exited` ⇒ (3) 红；(d) 退出后的写仍落到已死 transport 或挂起 ⇒ (4) 红。逐条记录变异 diff、逐字失败行、恢复命令与恢复后重新绿；四条全绿（未红）即本 AC 不满足。该行须 AC2 落地后由实现任务求值（待外部）
- [ ] AC4 **判官输入已含「退出/日志」，且不把「仍 insufficient」读成提案失败**：AC-445 落地后实测 `grep -l '^goal: GOAL-051' goals/AC-*.md | wc -l` = **11** 且 `grep -l '日志' goals/AC-445-*.md` 非空；打印 `.quay/goal-round.jsonl` 中 GOAL-051 的 `goal-sufficiency` 序列最后两条与时间戳，要求至少一条事实的时间晚于 AC-445 落地。若仍为 `insufficient`，`## Resolution` 必须逐字登记剩余缺口属于哪一处范围条目（「退出与日志」不在其中），不得据此判本提案失败。**本 AC 不把缓存 key 当判据**（key 会随构建/输入单独漂移），只把「11 条在域 AC + AC-445 的 expect 含「日志」+ 新一轮事实」当承重读数。该行只能由 goal-driver 后续轮次产生（待外部）

## DoD

人工授权后，由**被授权的 goal 写入路径**（而非本 agent）创建 AC-445 并把 GOAL-051 的退出条件编号范围改到含 AC-445；随后在**真实 round log** 中观察到判官在含 AC-445 的 11 条在域 AC 上重新裁决。**仅有本任务落地、没有 AC-445 创建与后续裁决观察，不算完成。**

承重性由三件事正面证明：

(a) **缺口被指名，不是猜的** —— 范围第 1 条逐字含「退出与日志」；10 条在域 AC 的 title/expect 里「日志」零命中；实现里 `handleExit` 第一行 `void reason;` 把连接层已采集的 reason 丢弃，驱动没有任何日志出口。

(b) **数据源已存在** —— `codex-app-server.connection.ts:517-519` 的生产 code path 已把 exit code/signal 与 stderr 尾巴组进 reason，`:321` 交给 `onExit`；本 AC 只要求它在驱动层兑现为可观测日志，不要求真 codex 新协议实测。

(c) **判据真会红** —— AC3 的四条假形态分别把「丢弃 reason/缺 stderr 尾巴」「退出后挂起」「主动关闭误报」「向死连接写」打红，不是「文件不存在」式的红。

另需如实登记：本任务**不**让 AC-435..AC-444 中任何一条转绿（实现由各自派工任务承担），**不**改任何 GOAL/AC 状态，**不**实现日志；本任务由充分性跟进 agent 只提议：不改 `goals/*.md`、不改任何 GOAL/AC 状态、不把任何 AC 标 achieved / active / draft / retired。实现任务若新增 server 测试文件，需按既有门同步测试脚本/时长基线（见记忆 `adding-a-server-test-file-bumps-the-quay-test-script-unknown-pin`、`new-server-test-file-can-red-the-duration-baseline-coverage-floor`）。

## Touches

- goals/AC-445-连接退出可诊断-自行退出被记录-主动关闭不误报.md (new)
- goals/GOAL-051-codex-常驻会话-app-server-长驻进程跨轮存活-忙时输入进队列-中止不杀进程-后台与审批与空闲重启语义明确.md
- server/modules/providers/list/codex/codex-host-driver.contract.ts
- server/modules/providers/list/codex/codex-host-driver.provider.ts
- server/modules/providers/tests/codex-resident-exit-and-logging.test.ts (new)
- tasks/gap-goal-051-exit-and-logging-not-an-ac.md
