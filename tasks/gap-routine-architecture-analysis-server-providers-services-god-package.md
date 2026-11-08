---
id: gap-routine-architecture-analysis-server-providers-services-god-package
title: "architecture-analysis: archguard 2026-11-08 (scope server):
  modules/providers/services = 24 files / 54 entities, fanIn 29 / fanOut 218 —
  violates all four thresholds; already repor"
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
archguard 2026-11-08 (scope server): modules/providers/services = 24 files / 54 entities, fanIn 29 / fanOut 218 — violates all four thresholds; already reported 2026-11-06 (god-package-server-providers-services) but no task exists, so the reading still stands unfiled.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794141478281` · ts `2026-11-08T12:37:58.281Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`createProviderRuntimeService`、`sessionsService`、`sessionConversationsSearchService`、`createClaudeTaskReducer`
- 涉及文件：
- `server/modules/providers/services/provider-runtime.service.ts:633`
- `server/modules/providers/services/sessions.service.ts:391`
- `server/modules/providers/services/session-conversations-search.service.ts:1186`
- `server/modules/providers/services/claude-activity-task-reducer.service.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Extract providers/services/{runtime,sessions,search,claude-activity} subpackages behind barrels; AC: fileCount<20 and entityCount<50, no new directory SCC, provider suites and typecheck stay green.

## Disposition

复核与处置均已完成（2026-11-08）。用同一件仪器（archguard 0.1.45，`analyze --lang typescript --sources server --no-cache`，读取 `extensions.tsAnalysis.moduleGraph` 的 package stats，默认阈值 minFiles 20 / minEntities 50）在任务分支修前/修后各取一次读数：

- 修前 — `modules/providers/services`：files=24 entities=54（classes 4 / functions 50），与 finding 的 24 files / 54 entities 逐字一致。
- 修后 — `modules/providers/services`：files=13 entities=19，两条被点名的 reason（tooManyFiles / tooManyEntities）消失。
  三个子包：`services/runtime` files=5 entities=10；`services/sessions` files=4 entities=4；`services/claude-activity` files=5 entities=21。全部低于 20/50。

处置方式 = 按 Requested action 拆包（不是「已注意到」）：

- 11 个实现文件移入三个子包，每个子包一个 `index.ts` barrel，`providers/index.ts` 改从 barrel 再导出。
  `runtime/` = launch-spec / model-launch-spec / session-model-resolver / session-provider-binding；
  `sessions/` = session-history-cache / cost-view / ui-last-opened-session；
  `claude-activity/` = claude-activity-schedules / claude-activity-task-reducer / claude-session-scope / claude-turn-phase。
  依赖方向单向：root → 三个子包；`runtime/`、`sessions/` 只指向 `server/shared/**` 与 `modules/database`，
  `claude-activity/` 只指向 `server/shared/**` 与 node 内建，没有任何子包回指包根，目录图保持 DAG。

- `session-conversations-search.service.ts` **有意留在包根**：它 import `modules/providers/list/claude`，
  单独成目录会把该目录拉进 AC-394 已钉死的 provider 环（实测模拟为 4 成员 SCC），而 AC-394 的
  cycleGroups 只允许收缩、不允许新增成员。它的 1 file / 1 entity 不影响本条阈值，故按可核的理由记录为残余而不是硬拆。

- 同一次改动内登记新目录：`server-import-cycle-budget.baseline.json` + `MANIFEST_PIN`（nodeCount 74 → 77）
  与 `cloudpit-goal-exit-gate.baseline.json` + `GATE_DIRECTORY_PIN`（AC-455 recorded-change 契约）。
  架构棘轮：被搬移文件的 oversize / moduleMutableState 条目按新路径 re-key（958、2、1、2，数值不变，未上调）。

- 实测门：`tsc --noEmit`（root / server / scripts 三个 project）exit 0；`server/modules/providers/tests/*.test.ts`
  整目录 740 个用例 736 pass / 0 fail（4 skipped）；AC-394 `server-import-cycle-budget`、AC-455
  `cloudpit-goal-exit-gate`、`architecture-ratchet` 均绿（AC-455 读数 measured=77 frozen=77 extra=[]；
  AC-394 的 G1 仍是 `modules/providers` + `modules/providers/list/claude` + `modules/providers/services` 三成员，无新增目录 SCC）。

- 诚实的残余：finding 的关系读数（fanIn 29 / fanOut 218）**不是**本次仪器调用复现出来的数字——同一 moduleGraph
  口径下修前测得 fanIn=2 / fanOut=20，修后 fanIn=2 / fanOut=21（拆包把包内关系变成跨包关系，本来也不能消除耦合）。
  本任务按 Requested action 只钉 fileCount / entityCount；关系阈值若仍需处置，应由探针按其自身口径另立 finding，
  ⛔ 不声称「四阈值全绿」。

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T12:37:58.281Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `server-providers-services-god-package`（routine `architecture-analysis`，runId `architecture-analysis-1794141478281`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Dark axis (ADR-007)
- L_G archguard scope=server modules/providers/services files=13 entities=19 fanIn=2 fanOut=21; runtime files=5 entities=10, sessions files=4 entities=4, claude-activity files=5 entities=21

## Touches
- `server/modules/providers/services/**`
- `server/modules/providers/index.ts`
- `server/modules/providers/provider.routes.ts`
- `server/modules/providers/list/claude/**`
- `server/modules/providers/tests/**`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `server/shared/tests/server-import-cycle-budget.test.ts`
- `server/shared/tests/server-import-cycle-budget.baseline.json`
- `server/shared/tests/cloudpit-goal-exit-gate.test.ts`
- `server/shared/tests/cloudpit-goal-exit-gate.baseline.json`
- `tasks/gap-routine-architecture-analysis-server-providers-services-god-package.md`
