---
id: gap-goal-051-turn-steer-not-an-ac
title: GOAL-051 范围第 3 条的 turn/steer 无在域 AC 覆盖：提议新增 AC-444（忙时 steer 改当前
  turn、不排队列、不开新 turn），交人裁定
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
  needs_human_cause: human-adjudication
  park_reason: GOAL-051 充分性判官确定 verdict=insufficient（key d4de3177…，since
    2026-10-29T09:53:24.039Z，cache 同 key 于 09:34:43Z 记 insufficient；round
    801/802 均为 insufficient）。判官输入含 `## 范围`（goal-driver.ts buildSufficiencyPrompt
    明令『judge the AC set against it』），而范围第 3 条逐字列出的 `turn/steer` 在 9 条在域 AC 的
    title/expect 中零覆盖：`grep -l 'steer' goals/AC-*.md` = 0，`grep -l 'steer'
    tasks/*.md` = 0。本任务只提议新增 AC-444 把 steer 语义机械化，不改 goals/*.md、不改任何 GOAL/AC 状态。
---
## Proposal

**提案选型： (a) 新增一条在域 AC（建议编号 AC-444），由人 yale 裁定。** 本 agent 不改 `goals/*.md`、不改任何 GOAL/AC 的状态、不实现 steer；本任务只提议。

### 未被覆盖的部分（逐字引用）

GOAL-051 `## 退出条件`（`goals/GOAL-051-codex-常驻会话-app-server-长驻进程跨轮存活-忙时输入进队列-中止不杀进程-后台与审批与空闲重启语义明确.md:46`）逐字：

> - AC-435..AC-442（pre-merge，判据 worktree 上求值）+ AC-443（post-merge，真实浏览器，主检出上求值）。

GOAL-051 标题（同文件 `:3`）逐字：

> Codex 常驻会话：app-server 长驻进程跨轮存活、忙时输入进队列、中止不杀进程、后台与审批与空闲重启语义明确

判官的输入不只退出条件一行：`buildSufficiencyPrompt()`（`/data/home/yale/.claude/plugins/marketplaces/quay/plugin/scripts/goal-driver.ts:1249-1253`）把 `## 退出条件`、`## 范围*`、在域 AC 的 (id,title,expect) 一起喂给判官，并逐字要求：

> The scope section, when present, is where that decomposition is actually written down — judge the AC set against it, not against the exit conditions alone.

GOAL-051 `## 范围` 第 3 条（同文件 `:27`）逐字：

> - thread/start|resume、turn/start|steer|interrupt、thread/queue/add|list|delete|start、thread/settings/update。

**当前未被覆盖的碎片 = 范围第 3 条里的 `turn/steer`**（标题「忙时输入进队列」所指的忙时输入路径之一；GOAL 背景 `:21` 也逐字把 `steer` 列为 app-server 相对 SDK 多出的原语之一：「SDK 只有 startThread/resumeThread/runStreamed，没有 queue/steer/status/background terminals/goals」）。范围第 3 条列出 4 组原语：`thread/start|resume`、`turn/start|steer|interrupt`、`thread/queue/*`、`thread/settings/update`。前三组里的 start/resume/interrupt、queue/add|list|delete|start、settings 各有 AC；**唯独 `turn/steer` 没有任何 AC 的 title 或 expect 认领**。

### 为何现有在域 AC 集不覆盖它（机械读数，不是推断）

在域 AC = `goals/` 中 `goal: GOAL-051` 的 9 条（`grep -l '^goal: GOAL-051' goals/AC-*.md | wc -l` → 9）：AC-435..AC-443。逐条读 title/expect：

- AC-435「常驻进程跨轮存活、resume、中止不杀进程」→ `thread/start|resume|interrupt`、pid/threadId 三读数；
- AC-436「忙时输入进队列、可撤回、中断后显式 start」→ 只认领 `thread/queue/add|list|delete|start`（active 时不返回 RUN_IN_PROGRESS、queue/list 深度、queue/delete、自动排水、interrupt 后保留不自动排水）；**expect 全文无 `steer`**；
- AC-437 → `thread/settings/update` / `turn/settings/update`；
- AC-438 → 五类 server request；
- AC-439 → processHandle 后台 lease；
- AC-440 → experimentalApi 与未知 notification；
- AC-441 → 宿主层 lease/busy-idle/close/idle/restore；
- AC-442 → capabilities；
- AC-443 → 真实浏览器常驻开关/忙时撤回/状态栏/Shell。

机械读数（本轮直跑，不是推断）：

- `grep -l 'steer' goals/AC-*.md | wc -l` → **0**（`steer` 在 `goals/` 里只出现在 GOAL-051 正文 `:21` 与 `:27`）；
- `grep -l 'steer' tasks/*.md | wc -l` → **0**（无在飞任务认领 steer）；
- `grep -rn 'steer' server/ src/ e2e/` → 只有无关散文（`mcp-ui-clients-list.ts`、`reply-suggestions-draw.ts`、`context-events/*`、`CockpitRemote.tsx`），`server/modules/providers/list/codex/` 零命中 ⇒ 今天没有 steer 实现；
- `grep -rln 'AC-444' goals/ tasks/` → **0**；`ls goals/ | grep -E '^AC-44[4-9]'` → 空，现行最大编号 AC-443 ⇒ AC-444 是下一个空闲号。

⇒ 如果 AC-435..AC-443 全部落地，`turn/steer` 仍会完全未实现，而范围第 3 条明确要求它。这正是判官在「9 条在域 AC」上判 `insufficient` 的一个结构性缺口。

充分性实例读数（`.quay/`）：`goal-sufficiency-followup.json` 的 `entries["GOAL-051"] = {key: d4de3177c1903dfef612774ca09b7e59c85bcb3ea0eb8242e9eb4755ae572d99, since: 2026-10-29T09:53:24.039Z, filedAt: null}`；`goal-sufficiency-cache.json` 同 key 的 `{verdict: "insufficient", ts: "2026-10-29T09:34:43.392Z"}`（两次采样一致）；`goal-round.jsonl` round 801（09:32:22Z，在域 AC 0 条）与 round 802（09:53:24Z，在域 AC 9 条）都记 `insufficient`。⇒ round 801 的 0 条是 AC 尚在逐条激活，round 802 的 9 条才是本提案针对的语义裁决。

### 本提案（选 a：新增 AC-444）

建议由被授权的 goal 写入路径创建 `goals/AC-444-codex-resident-turn-steer-改当前-turn-不排队列-不开新-turn.md`（`goal: GOAL-051`、`kind: criterion`、`status: active`、`phase: pre-merge`，与 AC-435..442 同形），并把 GOAL-051 `## 退出条件` 的编号范围改到含 AC-444（见 AC1 的裁定项）。

**title（建议逐字）：** 忙时 steer：`turn/steer` 改当前 turn、不排队列、不开新 turn

**criterion（建议逐字）：**

```
npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-steer.test.ts
```

**expect（建议逐字）：** 假 app-server transport（不真起 codex）：同一 resident 会话 active turn 中 `turn/steer {threadId, expectedTurnId, input}` 返回的 `turnId` 等于当前 turn id（不开新 turn），该 turn 终态 `completed`，且最终产物体现 steer 输入（REPORT E8 实测最终 assistant 文本被改写为 `STEERED`）；steer 期间与之后宿主 pid、threadId 不变；`thread/queue/list` 深度不增（steer 改当前 turn，queue 排后续 turn）；steer 完成后下一轮同 pid 继续。假 transport 对 `turn/steer` 回 JSON-RPC 错误（模拟 `expectedTurnId` 与当前 turn 不符）时，驱动把错误显式传回调用方并 fail-closed：不吞掉、不回落成 `thread/queue/add`、也不 `turn/start` 开新 turn。假形态：把 steer 落到 `thread/queue/add`（`queue/list` 深度 +1）必须红；用 `turn/start` 开新 turn（返回 `turnId` ≠ 当前 turn id）必须红；stale `expectedTurnId` 被接受（错误未传回）必须红。

判据形态与 AC-435/436/437/438/440 一致：注入内存假 transport，不 spawn 真 codex、不碰 DB/网络；不是 e2e，按 pre-merge 在 worktree 上求值。**红态基线（本轮直跑，不是推断）：** 上述 criterion 当前 exit **1**，文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-steer.test.ts'`（判据文件尚未存在，与 AC-435..442 的红先行一致）。

**实测依据（为什么这条 AC 写得出可运行判据）：** `tmp/codex-appserver-exp-NuPHhk/REPORT.md` E8（`:146-153`）逐字：

> ## E8 turn/steer（额外）
> 脚本 `e8-steer.mjs`，读数 `e8-reading.json`。
> - active turn 中 `turn/steer {threadId, expectedTurnId, input}`：
>   - 返回 `{turnId}`
>   - 最终 assistant 文本变为 `STEERED`，turn `completed`
> - 这与 `thread/queue/add` 不同：steer 改当前 turn；queue 排后续 turn。

报告摘要表（`:29`）也逐字记「turn steer | `turn/steer` 返回 `{turnId}`，最终文本被改写为 `STEERED` | 成立（额外实验）」。

### 为何这样覆盖了它

范围第 3 条要求的 `turn/steer` 从「未实现的散文」变成一条可执行判据：criterion 固定一个测试文件，expect 把 steer 与 queue、turn/start 三者**可分辨**地钉开——steer 返回当前 turnId、queue 深度不增、pid/threadId 不变、错误路径 fail-closed。任一把实现做成 queue 或新 turn 的形态都会被打红，因此它不是「功能存在即绿」的空门。落地后 AC-444 进入在域 AC 集，判官输入（`buildSufficiencyPrompt` 的 acLines）第一次包含 steer。

### 为何选 (a) 而不是 (b)

`turn/steer` 不是「退出条件写得比本目标该做的多」：它在 `## 范围` 里逐字列出，在 GOAL 背景 `:21` 里被点名为 app-server 相对 SDK 新增的原语，REPORT E8 已实测成立。缺的是**在域 AC 覆盖**（一个 AC 号 + 一个判据文件），不是文本多余。改退出条件/范围文本来把 steer 排除，会削掉人 yale 在范围里明确写下的能力。故选 (a)：**再立一条 AC**。

### 顺带发现（登记供人裁定，不构成本条提案第二项）

判官同时读 `## 范围` 全文，除 `turn/steer` 外还有三处范围条目没有在域 AC 的 title/expect 认领。它们**不是**本提案的提案对象（本任务只立一条 AC），但如果 AC-444 落地后判官仍为 `insufficient`，下一轮跟进应先读这三处、不要重复怀疑 steer：

1. 范围第 1 条末「退出与日志」（长驻连接的退出路径与日志）——9 条在域 AC 无 title/expect 提及；
2. 范围第 2 条「multiplexedHost=false，一会话一 app-server」——`provider-capabilities.service.ts` 里 codex 的 `multiplexedHost: false` 是静态值，`resident-host.service.ts:151` 的拒绝机制在宿主层，但**没有一条 GOAL-051 在域 AC 断言两会话各自独立、杀其一不影响另一**；
3. 范围第 10 条「新增 Codex 错误文案」——AC-443 的 expect 只到常驻开关/忙时撤回/状态栏/Shell，无错误文案。

另：范围第 9 条「进程 containment：复用 claudecodeui-session-* scope 与启动清扫」在 GOAL-051 在域 AC 里同样无认领，但该机制**已被 AC-167（GOAL-013，achieved）以 provider 中立方式钉住**（`server/modules/session-hosts/tests/process-containment.test.ts`），故不建议为它重复立 AC，建议人裁定在退出条件/范围里显式登记「由 AC-167 机制覆盖」。

### 红态基线与去重读数

- 红态基线：见上，criterion 当前 exit 1，文案逐字 `Could not find 'server/modules/providers/tests/codex-host-driver-steer.test.ts'`。
- 机制去重（本轮实测）：
  - `grep -rln 'GOAL-051' tasks/*.md` → **0**（本仓 `tasks/` 无任何 GOAL-051 相关的充分性/退出条件提案）；
  - `grep -rln 'steer' tasks/*.md` → **0**；
  - `grep -rln 'AC-444' goals/ tasks/` → **0**；
  - 在飞同目标任务 `gap-ac435-codex-resident-host-driver-persistent`（ready）、`gap-ac436-codex-resident-queue-busy-input`、`gap-ac437-codex-resident-live-settings`、`gap-ac438-codex-resident-approvals-broker`、`gap-ac439-codex-resident-background-leases`、`gap-ac440-codex-app-server-protocol-gate` 六条都只实现各自既有 AC（`goal_ac: AC-435..AC-440`），**无一条**提议新增 AC 或改退出条件文本，`grep -ril 'steer'` 对这六条 → 0。
  - 粒度工具 `task-granularity-advice.js --touches goals/AC-444-… --touches goals/GOAL-051-… --json` → `peers: []`、`mentions: []`、`reasons: []`。
  ⇒ 无在飞重复提案；本任务是该缺口的第一份提案。

## AC

- [ ] AC1 **人（yale）已裁定并被记录**：本任务 `## Resolution` 小节写明 (i) 是否采纳新增 AC-444（turn/steer），(ii) 若采纳，GOAL-051 `## 退出条件` 第 46 行如何改（建议逐字改为 `- AC-435..AC-444（pre-merge，判据 worktree 上求值）+ AC-443（post-merge，真实浏览器，主检出上求值）。`，明确 AC-443 仍是 post-merge），(iii) 上文「顺带发现」里三处范围欠账（退出与日志 / 一会话一 app-server / Codex 错误文案）与 containment 的处置。三者缺一即本 AC 不满足。该行只能由人 yale 写入（待外部）
- [ ] AC2 **新 AC 记录落地且判据可跑**：`goals/AC-444-codex-resident-turn-steer-改当前-turn-不排队列-不开新-turn.md` 由被授权的 goal 写入路径创建（`goal: GOAL-051`、`kind: criterion`、`status: active`、`phase: pre-merge`），`criterion` 与 `expect` 逐字取本 Proposal；实现落地后同一条 `npx tsx --tsconfig server/tsconfig.json --test server/modules/providers/tests/codex-host-driver-steer.test.ts` 退出 0 且 `fail 0`，并把红态基线（exit 1 + 逐字 `Could not find '…codex-host-driver-steer.test.ts'`）与绿态读数一起记录。该行只能由 goal 写入路径与后续实现任务落地（待外部）
- [ ] AC3 **判据非恒真**：按 expect 的三条假形态逐条变异并实测，每条必须令 criterion 退出非 0 且失败落在被点名的腿：(a) steer 落到 `thread/queue/add` ⇒ `queue/list` 深度断言红；(b) 用 `turn/start` 开新 turn ⇒ 返回 `turnId` ≠ 当前 turn id 断言红；(c) stale `expectedTurnId` 被接受/错误被吞 ⇒ fail-closed 断言红。逐条记录变异 diff、逐字失败行、恢复命令与恢复后重新绿；三条全绿（未红）即本 AC 不满足。该行须 AC2 落地后由实现任务求值（待外部）
- [ ] AC4 **判官输入已含 steer，且不把「仍 insufficient」读成提案失败**：AC-444 落地后实测 `grep -l '^goal: GOAL-051' goals/AC-*.md | wc -l` = **10** 且 `grep -l 'turn/steer' goals/AC-444-*.md` 非空；打印现役 dist 的 `sufficiencyCacheKey`（含 10 条在域 AC）作为旁证，并打印 `.quay/goal-round.jsonl` 中 GOAL-051 的 `goal-sufficiency` 序列最后两条与其时间戳，要求至少一条事实的时间晚于 AC-444 落地。若仍为 `insufficient`，`## Resolution` 必须逐字登记剩余缺口属于哪一处范围条目（turn/steer 不在其中），不得据此判本提案失败。**本 AC 不把 key 变化当判据**（key 会随构建/输入单独漂移，见记忆 `sufficiency-followup-ac-anchored-on-the-verdict-instance-key-goes-vacuous`），只把「10 条在域 AC + AC-444 的 expect 含 turn/steer + 新一轮事实」当承重读数。该行只能由 goal-driver 后续轮次产生（待外部）

## DoD

人工授权后，由**被授权的 goal 写入路径**（而非本 agent）创建 AC-444 并把 GOAL-051 的退出条件编号范围改到含 AC-444；随后在**真实 round log** 中观察到判官在含 AC-444 的 10 条在域 AC 上重新裁决。**仅有本任务落地、没有 AC-444 创建与后续裁决观察，不算完成。**

承重性由三件事正面证明：

(a) **缺口被指名，不是猜的** —— 判官输入含 `## 范围`（`goal-driver.ts:1250-1253` 逐字要求 judge against it）；范围第 3 条逐字列出 `turn/steer`；9 条在域 AC 的 title/expect 里 `steer` 零命中（`grep -l 'steer' goals/AC-*.md` = 0），代码里也零实现（`grep -rn 'steer' server/modules/providers/list/codex/` = 空）。

(b) **机制已实测** —— REPORT E8 与摘要表逐字记录 `turn/steer` 返回 `{turnId}`、最终文本被改写为 `STEERED`、turn `completed`，且与 `thread/queue/add` 不同（steer 改当前 turn；queue 排后续 turn）。

(c) **判据真会红** —— AC3 的三条假形态分别把「做成 queue」「做成新 turn」「吞掉 stale expectedTurnId 错误」打红，不是「文件不存在」式的红。

另需如实登记：本任务**不**让 AC-435..AC-443 中任何一条转绿（实现由各自派工任务承担），**不**改任何 GOAL/AC 状态，**不**实现 steer；本任务由充分性跟进 agent 只提议：不改 `goals/*.md`、不改任何 GOAL/AC 状态、不把任何 AC 标 achieved / active / draft / retired。

## Touches

- goals/AC-444-codex-resident-turn-steer-改当前-turn-不排队列-不开新-turn.md (new)
- goals/GOAL-051-codex-常驻会话-app-server-长驻进程跨轮存活-忙时输入进队列-中止不杀进程-后台与审批与空闲重启语义明确.md
- tasks/gap-goal-051-turn-steer-not-an-ac.md
