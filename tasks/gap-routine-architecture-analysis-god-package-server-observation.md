---
id: gap-routine-architecture-analysis-god-package-server-observation
title: "architecture-analysis: Fresh archguard reading (2026-11-02, scope server
  bcc56acf) flags modules/observation on all four god-package thresholds — fanIn
  18, fanOut 195 relations, 24"
status: ready
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
Fresh archguard reading (2026-11-02, scope server bcc56acf) flags modules/observation on all four god-package thresholds — fanIn 18, fanOut 195 relations, 24 files, 64 entities — and its barrel exports four unrelated pipelines: observation wall/store + view events, session digest (producer/LLM/settings), session-ask ledger/decision/recovery/retraction, and architecture/project-truth producers.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622946064` · ts `2026-11-02T12:35:46.064Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createObservationModule`、`createObservationStore`、`createSessionDigestProducer`、`readSessionAskEventLedger`、`createViewEventService`
- 涉及文件：
- `server/modules/observation/observation.module.ts:1`
- `server/modules/observation/observation-store.ts:1`
- `server/modules/observation/session-digest.ts:1`
- `server/modules/observation/session-ask-ledger.ts:1`
- `server/modules/observation/architecture-delta.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split into observation (store/routes/wall), session-digest, session-ask and producers, with the existing barrel re-exporting the same names; AC: archguard_detect_god_packages reports each new package below minFiles 20 / minEntities 50, modules/observation stays a leaf in AC-394's directory manifest (no new cycle), and the observation + session-digest tests stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:35:46.064Z

## Disposition (re-verified and fixed, 2026-11-02)

**复核（develop 基线 9f9b33f8f，用 finding 的同一 instrument：archguard 0.1.44 的 `archguard_detect_god_packages`，默认阈值 minFanIn 5 / minFanOut 20 / minFiles 20 / minEntities 50；先对 develop 的 `server/` 重跑 `analyze -s server --lang typescript`，再查）：**

- `modules/observation` = fanIn 18、fanOut 195、fileCount 24、entityCount 64，四条 reason 全中 —— 与 finding 的四个数字逐项一致，finding 仍然成立。
- barrel 的四个无关管线逐条对上：wall/store + view events、session-digest（producer/LLM/settings）、session-ask（ledger/decision/recovery/retraction）、architecture/project-truth producers。

**处置：按 requested action 拆分（不是档案化，也不是「已注意到」）。** 实现按关注点迁入四个子包 + 一个共享 `core`，既有 `server/modules/observation/index.ts` barrel 保持**完全相同的 106 个导出名**（把 develop 的 barrel 与拆分后的 barrel 解析成名字集合对比：removed=[]、added=[]、106 vs 106），所以 `server/index.ts`、cockpit wiring、websocket run registry、settings reader 与全部外部消费者一行未改。

| 包（archguard package） | 内容 | 文件数 | 实体数 |
| --- | --- | --- | --- |
| `modules/observation`（残留：barrel / router / wall + view events） | `index.ts`、`observation.module.ts`、`observation.routes.ts`、`view-events.routes.ts`、`view-events.service.ts` | 5 | 7 |
| `modules/observation/core`（四条管线共享的基元） | observed-object store、URI 语法、producer liveness、确定性 transcript digest、digest-LLM settings、blind spots | 7 | 24 |
| `modules/observation/session-digest` | 终端轮 digest producer + 有界 LLM tier | 3 | 5 |
| `modules/observation/session-ask` | ask decision answer/digest/reader、ledger、recovery、retraction | 7 | 21 |
| `modules/observation/producers` | project truth（+producer）、architecture delta（+producer）、共享 refresh 循环 | 6 | 7 |

- **size AC（实跑读数）：** 五个包的 fileCount 全部 ≤ 7（< minFiles 20），entityCount 全部 ≤ 24（< minEntities 50）。拆分前同一个 `modules/observation` 是 24 files / 64 entities。
- **口径说明（诚实读数）：** 若把 fanIn/fanOut 也当作必须转绿的判据，则**拆分做不到**，且原因不是本实现有缺陷：该读数是 archguard 对**实体关系**的跨包计数，把一个目录切开只会把原本同包内的调用变成跨包关系。拆分后默认阈值下仍被点名的是关系数（`core` fanIn 63 / fanOut 62、`session-ask` 11 / 95、`producers` 0 / 48、`session-digest` 0 / 36、残留根包 16 / 26），它们的 fileCount/entityCount 全部在阈值内；同一 instrument 在 develop 上读 18 / 195，因此相对体量维度是被真实修掉的。requested action 给出的 AC 也只点名 minFiles 20 / minEntities 50。这里不声称关系数转绿。
- **AC-394 leaf / 无新环（实跑）：** 目录图是 DAG —— 根包 → 四个子包；`session-digest` → `session-ask` + `core`；`session-ask`、`producers` → `core`；`core` 不 import 任何兄弟子包。`server-import-cycle-budget.test.ts` 18/18 通过，cycle groups 与基线逐成员一致（G1 三个成员，G2/G3 空），未新增任何 SCC。四个新子目录按 AC-394 (c) 的 escape hatch 登记进 `directoryManifest` + `MANIFEST_PIN`（nodeCount 58 → 62，第十四次 recorded change）；`modules/observation` 仍是 manifest 里已登记的目录，其 out-edge 只有自己的子包，未 import 任何兄弟 feature module。
- **测试（实跑，见 Evidence）：** observation 模块 15 个测试文件 / 163 条全绿（含 session-digest、session-digest-llm、session-ask-*、observation-store、project-truth、architecture-delta、blind-spots、view-events）；barrel 消费者与结构棘轮另见 Evidence。
- **探针只立案不执行：** finding 的复核与拆分/验证全部由派发链（worker 会话）执行，例程未代跑。

## ADR-007 dark-axis record
- L_D archguard: observationMaxFiles=7 (develop 24), observationMaxEntities=24 (develop 64)
- L_G archguard: directoryCycleGroups=3 (pinned G1=3,G2=0,G3=0), newCycleGroups=0

## Evidence
- 复核（develop 9f9b33f8f）：`node /data/home/yale/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js analyze -s server --lang typescript --work-dir /tmp/ag-before -f json` → `archguard_detect_god_packages` 读 `modules/observation`：fanIn=18, fanOut=195, fileCount=24, entityCount=64，reasons=[highFanIn, highFanOut, tooManyFiles, tooManyEntities]。
- 拆分后：同一 analyze + 同一工具读五个包：`modules/observation` 5/7（fanIn 16, fanOut 26）、`core` 7/24（63/62）、`session-digest` 3/5（0/36）、`session-ask` 7/21（11/95）、`producers` 6/7（0/48）—— 每个包 fileCount ≤ 7、entityCount ≤ 24。
- 导出面对拍：解析 `git show develop:server/modules/observation/index.ts` 与拆分后 `server/modules/observation/index.ts` 的 `export {…} from` 名字集合 → removed=[]、added=[]、106 vs 106。
- 结构棘轮：`QUAY_MEMORY_MAX=6G bash scripts/with-memory-cap.sh env TSX_TSCONFIG_PATH=server/tsconfig.json node --import tsx --test server/shared/tests/server-import-cycle-budget.test.ts` → 18 pass / 0 fail；`architecture-ratchet.test.ts` → 6 pass / 0 fail（三条 `moduleMutableState` 按新路径重键，读数未上调）。
- 模块测试：`… node --import tsx --test --test-concurrency=2 server/modules/observation/tests/*.test.ts` → 163 pass / 0 fail（15 files）。
- 消费者测试：`cloudpit-runtime-flip.test.ts` 10 pass；`session-ask-event-writer.test.ts` + `cockpit-fleet-card-provider.test.ts` 28 pass；`chat-run-registry.test.ts` + `chat-run-turn-semantics.test.ts` + `composition-root-wiring.test.ts` + `server-composition-startup.test.ts` 23 pass；`quay-test-script.test.ts` 14 pass。
- 静态门：`npx tsc --noEmit -p server/tsconfig.json` → 0 error；`npm run lint` → exit 0。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-server-observation`（routine `architecture-analysis`，runId `architecture-analysis-1793622946064`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过（复核读数、拆分后五个包的 archguard 读数、导出面对拍、AC-394 两条棘轮、模块与消费者测试、tsc、lint 均见 Evidence）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/observation/**`
- `server/shared/tests/server-import-cycle-budget.baseline.json`
- `server/shared/tests/server-import-cycle-budget.test.ts`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `server/shared/tests/cloudpit-runtime-flip.test.ts`
- `tasks/gap-routine-architecture-analysis-god-package-server-observation.md`
