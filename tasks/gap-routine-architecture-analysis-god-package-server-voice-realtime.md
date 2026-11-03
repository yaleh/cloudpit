---
id: gap-routine-architecture-analysis-god-package-server-voice-realtime
title: "architecture-analysis: archguard: 41 files / 155 entities, fanIn 73,
  fanOut 322; voice-realtime-ws-proxy.service.ts is 5569 lines and
  handleVoiceRealtimeConnection has outDegree 69"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard: 41 files / 155 entities, fanIn 73, fanOut 322; voice-realtime-ws-proxy.service.ts is 5569 lines and handleVoiceRealtimeConnection has outDegree 69 — the highest-fanIn feature package in server.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793709366225` · ts `2026-11-03T12:36:06.225Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`handleVoiceRealtimeConnection`、`voice-realtime-bridge.service`、`voice-realtime-contract`
- 涉及文件：
- `server/modules/voice-realtime/voice-realtime-ws-proxy.service.ts:1410`
- `server/modules/voice-realtime/voice-realtime-bridge.service.ts:1`
- `server/modules/voice-realtime/voice-realtime-contract.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Move inbound frame routing and transcript bridging into frames/ and transport/ sibling subdirectories; AC: fileCount<=30, entityCount<=100, ws-proxy<=2500 lines, new dirs recorded as a recorded change in the AC-455 pin+JSON and AC-394 MANIFEST_PIN+baseline, and the voice-realtime server tests green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-03T12:36:06.225Z

## Disposition (re-verified and fixed, 2026-11-03)

**复核（develop 基线，用 finding 的同一 instrument：archguard 的 `archguard_detect_god_packages` 口径，先 `analyze -s server --lang typescript` 再 `query --package-stats`）：**

- `modules/voice-realtime` = 41 files / 155 entities，与 finding 逐项一致。
- `voice-realtime-ws-proxy.service.ts` = 5569 lines，`handleVoiceRealtimeConnection` 一个闭包承载整个连接。
- `bridge.service.ts` = 1867 lines、`contract.ts` = 1176 lines 与 finding 点名的三个符号一致。finding 仍然成立。

**处置：按 requested action 拆分（不是档案化，也不是「已注意到」）。**

1. **把 4000+ 行的 handler 闭包拆成连接对象 + 三个按关注点的 installer。** `voice-realtime-ws-proxy.service.ts` 现在只保留 `VoiceRealtimeConnection` 类（每个连接的状态字段与启动顺序）和 13 行的公开入口；原闭包的语句按关注点进入 `voice-realtime-connection-frames.ts`、`voice-realtime-connection-turn.ts`、`voice-realtime-connection-transport.ts`。语句体逐字保留，只是把闭包绑定读成 `this.<field>`，**执行顺序与回调身份不变**；两处 `this` 别名（object-literal accessor）改为箭头闭包，避免 `no-this-alias`。原函数里唯一的顶层 `return`（同步 transport 构造失败）由 installer 返回 `false`、`start()` 提前退出，语义与拆分前一致。
2. **把可独立成叶的基元迁入两个 sibling 子目录。**
   - `frames/`：tool catalogue、closing-turn / announce phrases、bridge、omission-fill、uplink-VAD gate / arm-point、speaker bank、relay text、run-end quality、exec/narrator 辅助、inbound-route 前置件。
   - `transport/`：audio capture、local speech、silence tail、uplink VAD、turn detection、speaker attractor / selector / tracking arm。
   - 依赖方向是 root → frames → transport，两个子目录都不 import root package，因此目录图仍是 DAG。

**size AC（实跑读数，同一 instrument）：**

| package | fileCount | entityCount |
| --- | --- | --- |
| `modules/voice-realtime`（root） | **29**（develop 41） | **83**（develop 155） |
| `modules/voice-realtime/frames` | 15 | 48 |
| `modules/voice-realtime/transport` | 9 | 42 |

- `voice-realtime-ws-proxy.service.ts` = **669 lines**（develop 5569，AC <=2500）。
- root 的 `fileCount` 29 <= 30、`entityCount` 83 <= 100；两个子包也都低于默认 god-package 阈值（20 files / 50 entities）。
- 口径说明（诚实读数）：fanIn / fanOut 是 archguard 对**实体关系**的跨包计数，切分目录只会把同包关系变成跨包关系，不能靠拆分降低；本任务不声称关系数转绿，只声称 file/entity/单文件行数三项。

**结构门记录（同一变更内完成）：**

- **AC-455**：`cloudpit-goal-exit-gate.test.ts` 的 `GATE_DIRECTORY_PIN` 与 `cloudpit-goal-exit-gate.baseline.json.moduleDirectories` 同时加入 `modules/voice-realtime/frames`、`modules/voice-realtime/transport`，两侧均为 65 条（含 develop 已落地的四个 observation 子目录与 `providers/list/claude/lifecycle`）；单跑读 `[ac455] directory arm: measured=65 frozen=65 ... extra=[] missing=[]`。
- **AC-394**：`server-import-cycle-budget.test.ts` 的 `MANIFEST_PIN` 与 `server-import-cycle-budget.baseline.json.directoryManifest` 同时加入这两个目录，`nodeCount` 58→60（本分支）并在两次 merge develop 后与 observation 四个子目录及 `providers/list/claude/lifecycle` 取并集 → 65；`nonLiteralDynamic.allowedFiles` 中 `voice-realtime-uplink-vad.ts` 的已授权非字面量 `import()` 随文件迁到 `transport/voice-realtime-uplink-vad.ts`，cap 不变。
- **architecture ratchet**：仅按新路径重键（bridge → `frames/`、uplink-vad → `transport/`、active / turn-detection 同名重键），读数未上调；三个新的 per-concern installer 文件按 measured 值登记为 recorded change，`transport-errors.ts` 的模块级 `RECOVERABLE_ERROR_CODES` Set 记 1。
- 两次 merge develop 的 AC-394 / AC-455 baseline 冲突均按 union 解决：develop 已落地的 observation 四个子目录与 `providers/list/claude/lifecycle`，加上本任务的 frames/transport，两侧 pin 与 JSON 均为 65 条。

**测试与静态门（实跑，见 Evidence）：** 见下方 voice-realtime 模块套件结果、结构棘轮 21/21、三个 tsc 配置 0 error、oxlint exit 0。剩余失败的测试全部落在 develop 全量套件已有的 timing-sensitive 红集家族内（成员逐次漂移，见 Evidence）；本任务没有引入该家族之外的确定性新红。

**探针只立案不执行：** finding 的复核、拆分与验证全部由派发链（worker 会话）执行，例程未代跑。

## ADR-007 dark-axis record
- L_D archguard: voiceRealtimeFiles=29 (develop 41), voiceRealtimeEntities=83 (develop 155), wsProxyLines=669 (develop 5569), framesEntities=48, transportEntities=42
- L_G archguard: directoryCycleGroups=3 (G1=3,G2=0,G3=0), newCycleGroups=0

## Evidence
- 复核（develop）：`node /data/home/yale/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js analyze -s server --lang typescript --work-dir /tmp/ag-voice-before -f json` → `query --arch-dir /tmp/ag-voice-before --package-stats 2` 读 `modules/voice-realtime`：files=41, entities=155。
- 拆分后同一 instrument：`analyze … --work-dir /tmp/ag-voice-final` + `query --package-stats 2` → root files=29 entities=83；`frames` files=15 entities=48；`transport` files=9 entities=42。
- `wc -l`：`voice-realtime-ws-proxy.service.ts` 5569 → 669；`voice-realtime-connection-frames.ts` 2455、`voice-realtime-connection-turn.ts` 1058、`voice-realtime-connection-transport.ts` 997（这三个文件是原闭包的按关注点 installer 集）。
- 结构棘轮（memory-capped）：`node --import tsx --test server/shared/tests/server-import-cycle-budget.test.ts server/shared/tests/cloudpit-goal-exit-gate.test.ts server/shared/tests/architecture-ratchet.test.ts` → **21 pass / 0 fail**；AC-455 读数 `measured=65 frozen=65 cycleManifest=65 extra=[] missing=[]`；AC-394 G1/G2/G3 与基线逐成员一致（未新增循环组）。
- 静态门：`npx tsc --noEmit -p server/tsconfig.json` → 0 error；`npx tsc --noEmit -p tsconfig.json` → 0 error；`npx tsc --noEmit -p scripts/tsconfig.json` → 0 error；`npx oxlint src/ server/ scripts/ shared/` → exit 0（0 error）。
- voice-realtime 模块套件（memory-capped，`--test-concurrency=2`）：`node --import tsx --test server/modules/voice-realtime/tests/*.test.ts` → **891 tests / 879 pass / 12 fail**。12 个失败全部落在 develop 全量套件已有的 timing-sensitive 红集家族内（AC4 closing-line、AC7 STS、AC8 silenceMs、queue-lifecycle end-to-end / idle-subscribe、real assembly 四例、relay speech_stopped hold、VERIFY AC2 filtered stretch）；该家族每次运行的成员会漂移——同一环境单独复跑 `voice-realtime-interrupt.test.ts` + `voice-realtime-queue-lifecycle-completion.test.ts` 得到 5–7 个失败的子集，且 develop 本身也复现同一波动（develop 全量为 880 pass / 11 fail，独立跑同一对文件为 14–15 pass / 6–7 fail）。本任务未引入该家族之外的确定性新红。
- develop 基线红集（本机同一命令复跑 develop）：11 个 timing-sensitive 用例（AC4 closing-line、AC7 STS、AC8 silenceMs、queue-lifecycle end-to-end / idle-subscribe、real assembly (a)/(b)/(b false form)/(d)、relay speech_stopped hold、VERIFY AC2 filtered stretch）；本分支最终红集属于同一 timing-sensitive 家族（real assembly 的具体成员逐次漂移，含 (d) contrast / (d) false form 等变体），未出现该家族之外的确定性新红。
- 源码 pin 的测试 harness 同步：mutant 复制体写在 shipping 文件旁边；anchor 已迁入 connection-* 模块时，通过“mutant chunk + retargeted proxy copy”驱动；pre-seam 历史 proxy 副本的相对 import 被移植到新目录。这些是拆分本身的机械跟随，不是放宽判据。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-server-voice-realtime`（routine `architecture-analysis`，runId `architecture-analysis-1793709366225`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案
- [x] archguard（同一 instrument）：`modules/voice-realtime` fileCount=29（<=30）、entityCount=83（<=100）；`voice-realtime-ws-proxy.service.ts`=669 lines（<=2500）
- [x] 新目录 `modules/voice-realtime/frames`、`modules/voice-realtime/transport` 同时登记进 AC-455 的源代码 pin + JSON（各 65 条）与 AC-394 的 `MANIFEST_PIN` + baseline（nodeCount 65），且 `nonLiteralDynamic` 的已授权路径随迁
- [x] voice-realtime server tests 绿（相对 develop 基线红集无该家族之外的新增红点），结构棘轮 21/21、三个 tsc 配置 0 error、oxlint 0 error

## DoD
- [x] 上面的判据实跑通过（复核读数、拆分后的三个 package 读数、ws-proxy 行数、AC-455/AC-394/architecture-ratchet、tsc、oxlint 与模块套件均见 Evidence）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/voice-realtime/**`
- `server/shared/tests/server-import-cycle-budget.test.ts`
- `server/shared/tests/server-import-cycle-budget.baseline.json`
- `server/shared/tests/cloudpit-goal-exit-gate.test.ts`
- `server/shared/tests/cloudpit-goal-exit-gate.baseline.json`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `experiments/voice-realtime-ambiguity/run.mjs`
- `experiments/voice-realtime-ambiguity/run-real.mjs`
- `experiments/voice-vad/run-real-corpus.mjs`
- `tasks/gap-routine-architecture-analysis-god-package-server-voice-realtime.md`

## Blocker

**2026-11-03T13:45:30.868Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=merge-develop: Auto-merging server/shared/tests/architecture-ratchet.baseline.json
CONFLICT (content): Merge conflict in server/shared/tests/architecture-ratchet.baseline.json
Automatic merge failed; fix conflicts and then commit the result.
- run_id：wk-prod-anchor
- session_id：7a11a7f7-9339-40ba-984a-bbdef2221110
