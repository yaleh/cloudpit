---
id: gap-routine-architecture-analysis-god-package-server-providers-claude
title: "architecture-analysis: archguard god-package:
  modules/providers/list/claude = 19 files / 73 entities, fanIn 6, fanOut 432;
  ClaudeResidentHostDriver alone has 86 methods, fanIn 130 "
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
archguard god-package: modules/providers/list/claude = 19 files / 73 entities, fanIn 6, fanOut 432; ClaudeResidentHostDriver alone has 86 methods, fanIn 130 and outDegree 192, and claude-host-driver.provider.ts is 5896 lines.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793709366225` · ts `2026-11-03T12:36:06.225Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`ClaudeResidentHostDriver`、`ClaudePerRunHostDriver`、`ClaudeSessionSynchronizer`
- 涉及文件：
- `server/modules/providers/list/claude/claude-host-driver.provider.ts:2983`
- `server/modules/providers/list/claude/claude-runtime.provider.ts:1`
- `server/modules/providers/list/claude/claude-sessions.provider.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Extract the driver's turn/lifecycle collaborator entities into a lifecycle/ subdirectory; AC: archguard_detect_god_packages(scope=server) reports fileCount<=24 and entityCount<=50 for this package (fanOut recorded as residual, not claimed reducible), claude-host-driver.provider.ts<=2500 lines, G1 cycle pin unchanged-or-shrunk, and the new directory recorded in cloudpit-goal-exit-gate pin+JSON and AC-394 MANIFEST_PIN+baseline in the same commit.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-03T12:36:06.225Z

## Disposition (re-verified and fixed, 2026-11-03)

**复核（任务起点树 1b1c7da66，同一 instrument：archguard 0.1.44 `analyze -s server --lang typescript` + `query --package-stats`，包 fan 读数用同一 `computePackageFanMetricsFromRelations` 公式，并以 `getPackageStats` + `evaluateGodPackages` 复现 `archguard_detect_god_packages`）：**

- `modules/providers/list/claude` = 19 files / 73 entities，fanIn 6 / fanOut 432；`claude-host-driver.provider.ts` = 5896 行，`ClaudeResidentHostDriver` 85 个方法 + 26 个字段。四个数字与 finding 逐项一致，finding 仍然成立。

**处置：按 requested action 拆分（不是档案化，也不是「已注意到」）。** 驱动器的 turn/lifecycle 协作实体迁入新子包 `server/modules/providers/list/claude/lifecycle/`：

| 结果 | 内容 | files | entities | fanIn | fanOut |
| --- | --- | --- | --- | --- | --- |
| `modules/providers/list/claude`（根，残留） | 具体驱动类 + `createSdkResidentProcess` + `publishSessionDeliveries` + `buildResidentSdkOptions` 之外的 6 个兼容 barrel | 19 | **49** | 6 | 355 |
| `modules/providers/list/claude/lifecycle` | 类型/常量/纯函数（`resident-process.types`、`resident-settings`、`resident-turn.types`、`resident-ledger-runtime`、`resident-deliveries`、`resident-host.types`、`resident-launch`）+ 5 层 protected 基类链（`resident-host.base` → `resident-readings.base` → `resident-turn.base` → `resident-run.base` → `resident-stream.base`）+ 迁入的 6 个协作文件 | 18 | 46 | 61 | 126 |

- **size AC（实跑读数）：** `modules/providers/list/claude` = **19 files / 49 entities**，满足 fileCount<=24、entityCount<=50；拆分前同包是 19 files / 73 entities。复现 `archguard_detect_god_packages` 的 reasons 从 `[highFanIn, highFanOut, tooManyEntities]` 变为 `[highFanIn, highFanOut]` —— **`tooManyEntities` 与 `tooManyFiles` 均已消失**。
- **`claude-host-driver.provider.ts` 行数：** 5896 → **1687**（AC <=2500）。拆分方式是最小侵入的**继承链**：基类方法体逐字搬迁、只把 `private` 放宽为 `protected`；6 个依赖 claude 包内符号（`claude-runtime` / 逐次运行驱动 / outcome registry）的方法留在具体驱动里，以 `protected abstract` 声明回链。没有任何逻辑改写。
- **fanOut（诚实记录为 residual，不声称可降）：** 432 → 355；fanIn 不变（6）。archguard 的 fanOut 计的是跨包实体关系，拆分本身不保证下降，这里只记录实测值，AC 未点名它。
- **G1 cycle pin unchanged：** `server/shared/tests/server-import-cycle-budget.test.ts` 的 `CYCLE_GROUPS` 仍为 `[modules/providers, modules/providers/list/claude, modules/providers/services]`，G2/G3 为空。`lifecycle/` 不在任何 SCC：它只 import `server/shared/**`、`modules/resident-ledger`、`modules/notifications`、`modules/session-hosts`（四者都没有指回 `lifecycle/` 的边），唯一的入边是 `modules/providers/list/claude -> lifecycle`，正是抽出的形状。`modules/providers/services -> modules/providers/list/claude` 的既有边（`provider-token-usage.service.ts` 读 `claude-token-usage.provider.js`）与根包出口未变，G1 成员逐项不变。
- **新目录 recorded change（同一提交）：**
  - AC-455：`cloudpit-goal-exit-gate.test.ts` 的 `GATE_DIRECTORY_PIN` 63 条 + `cloudpit-goal-exit-gate.baseline.json.moduleDirectories` 63 条（Second recorded change 注释点明本任务）。
  - AC-394：`server-import-cycle-budget.test.ts` 的 `MANIFEST_PIN` 与 `server-import-cycle-budget.baseline.json.directoryManifest` / `nodeCount=63`（FIFTEENTH RECORDED CHANGE 段落点明本任务）。
- **既有机制失败点（诚实记录）：** 这些门只守体量/目录/环，不守方法粒度；`ClaudeResidentHostDriver` 仍有 85 个方法（基类链 + 具体类合计），在 archguard 的实体口径下不构成一个 entity，因此本 finding 的方法数维度没有对应的机械判据，只能靠本次抽出的内聚边界（turn/ledger/stream/run/readings）约束。
- **探针只立案不执行：** 复核、拆分与验证全部由派发链（worker 会话）执行，例程未代跑。

## ADR-007 dark-axis record
- L_D archguard: claudeFileCount=19 claudeEntityCount=49 hostDriverLines=1687 (develop 19/73, 5896)
- L_G archguard: directoryCycleGroups=3 (pinned G1=3,G2=0,G3=0), newCycleGroups=0

## Evidence
- 复核（任务起点树）：`node /data/home/yale/.claude/plugins/npm-cache/node_modules/@yalehwang/archguard/dist/cli/index.js analyze -s server --lang typescript --work-dir /tmp/ag-claude-before -f json` → `query --package-stats` 读 `modules/providers/list/claude`：fileCount=19、entityCount=73；同 instrument 的 fan 公式：fanIn=6、fanOut=432；`evaluateGodPackages` reasons=[highFanIn, highFanOut, tooManyEntities]。
- 拆分后：同一 analyze + 同一 `getPackageStats`/`evaluateGodPackages` 复现：`modules/providers/list/claude` = 19 files / 49 entities / fanIn 6 / fanOut 355，reasons=[highFanIn, highFanOut]；`modules/providers/list/claude/lifecycle` = 18 files / 46 entities / fanIn 61 / fanOut 126。
- 行数：`wc -l server/modules/providers/list/claude/claude-host-driver.provider.ts` → 1687；`lifecycle/*.base.ts` 最长 739 行（oversize ratchet 的 800 线以下）。
- 结构棘轮（单跑）：`QUAY_MEMORY_MAX=6G bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/server-import-cycle-budget.test.ts server/shared/tests/architecture-ratchet.test.ts server/shared/tests/cloudpit-goal-exit-gate.test.ts` → 21 pass / 0 fail；AC-455 读数 `[ac455] directory arm: measured=63 frozen=63 cycleManifest=63 extra=[] missing=[]`、`pin=63 baselineOutsidePin=[] duplicatePinEntries=0`。
- 既有 legacy 棘轮：`resident-legacy-path-ratchet.test.ts` + `resident-run-is-turn-single-reader.test.ts` → 8 pass / 0 fail（`rounds(driver)=3` 为下降，`resultTimes=9` 不变）。
- 模块测试：`claude-resident-outcome-registry` / `claude-resident-lifecycle-outcome-registry` / `claude-transcript-format` / `provider-shell-facet` / `claude-resident-ledger-transitions` / `claude-resident-ledger-invariants` → 30 pass / 0 fail。
- 真二进制：`claude-resident-process.test.ts` → 10 pass / 0 fail；`claude-resident-remote-control-isolation` + `claude-resident-control-queue` + `claude-resident-dispatch-hook` + `claude-resident-idle` → 15 pass / 0 fail。
- 组合/能力面：`provider-runtime.service` + `provider-capabilities-cancel-queued` + `debug-agent-control-queue` + `server-composition-startup` → 21 pass / 0 fail。
- 静态门：`npx tsc --noEmit -p server/tsconfig.json` → 0 error；`npx oxlint server/modules/providers/list/claude/` → 0 error（仅 `claude-runtime.provider.ts` 既有 warning）。
- **续做轮（2026-11-03，suite 单文件红复核与修复）：** 上一轮 fan-in 的唯一红 `server/modules/resident-ledger/tests/resident-ledger-leaf-module.test.ts` **可复现**（并非负载假红），且两条红均系本次拆分引入，已修：
  - **(a) barrel consumer 漂移：** `ledgerForeign` / `ledgerAnomalies` 的 `// consumer:` 仍指向拆分前的根文件 `claude-resident-outcome-handlers.ts`（现为纯转发 shim），真实消费者已随实现迁至 `lifecycle/claude-resident-outcome-handlers.ts`。注释改指真实消费者（`server/modules/resident-ledger/index.ts`），判据读数 `exportsWithoutLiveConsumer=0`。
  - **(d) `ResidentRound` 位置：** 该类型是 dispatcher 自身记录，随 turn/lifecycle 协作代码从具体驱动文件迁入 `lifecycle/resident-ledger-runtime.ts`，原读数「driver 文件之外零引用」变成 14 处（全在 `lifecycle/` 基类链内）。判据语义改为「claude driver 包（根 + `lifecycle/`）之外零引用」，保留本条真正守护的不变式：ledger 模块对新模块引用 0 次（`newModuleResidentRoundRefs=0`）、包外任何文件（尤其 ledger）不命名它 —— 而不是靠改名让断言真空绿。
  - 单跑修复后的判据：`server/modules/resident-ledger/tests/resident-ledger-leaf-module.test.ts` → **8 pass / 0 fail**，读数 `exportsTotal=11 exportsWithoutLiveConsumer=0`、`dirFiles=3 modulesEdges=0 sccMembership=none`、`driverBarrelImports=2 driverDeepImports=0`、`legacyPath=absent driverLedgerTypeDecls=0 newModuleResidentRoundRefs=0 residentRoundRefsOutsideDriver=0`；三条内存取假形态仍各自打红同一断言。
  - 兄弟判据：`server-import-cycle-budget` + `claude-resident-ledger-transitions` + `claude-resident-ledger-invariants` + `claude-resident-interrupt-ledger` + `claude-resident-unattended-after-turns` + `terminal-state` → **46 pass / 0 fail**；结构棘轮 `architecture-ratchet` + `cloudpit-goal-exit-gate` + `resident-legacy-path-ratchet` + `resident-run-is-turn-single-reader` → **9 pass / 0 fail**（AC-455 读数不变：`measured=63 frozen=63`、`pin=63 baselineOutsidePin=[]`）。
  - 静态门：`npx tsc --noEmit -p server/tsconfig.json` → 0 error；`npx oxlint server/modules/resident-ledger/` → 0 error。
- 探针只立案不执行：本次拆分与验证全部由派发链（worker 会话）执行，例程未代跑。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-server-providers-claude`（routine `architecture-analysis`，runId `architecture-analysis-1793709366225`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过（复核读数、拆分后 file/entity/fan 读数、真 `archguard_detect_god_packages` reasons、driver 行数、AC-394/AC-455 棘轮、模块与组合测试、tsc、oxlint 均见 Evidence）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/providers/list/claude/**`
- `server/modules/resident-ledger/index.ts`
- `server/modules/resident-ledger/tests/resident-ledger-leaf-module.test.ts`
- `server/shared/tests/server-import-cycle-budget.test.ts`
- `server/shared/tests/server-import-cycle-budget.baseline.json`
- `server/shared/tests/cloudpit-goal-exit-gate.test.ts`
- `server/shared/tests/cloudpit-goal-exit-gate.baseline.json`
- `tasks/gap-routine-architecture-analysis-god-package-server-providers-claude.md`
