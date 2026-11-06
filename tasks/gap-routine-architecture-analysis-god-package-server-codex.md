---
id: gap-routine-architecture-analysis-god-package-server-codex
title: "architecture-analysis: archguard 0.1.45 fresh run 2026-11-06 (scope
  server, defaults minFiles 20 / minEntities 50): modules/providers/list/codex =
  32 source files / 10,337 LOC / 73"
status: todo
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard 0.1.45 fresh run 2026-11-06 (scope server, defaults minFiles 20 / minEntities 50): modules/providers/list/codex = 32 source files / 10,337 LOC / 73 entities, fanOut 346 (maximum in the server scope); codex-sessions.provider.ts alone is 2,333 lines and codex-app-server.connection.ts 22 KB.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793968645263` · ts `2026-11-06T12:37:25.263Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`CodexSessionsProvider`、`CodexHostDriver`、`CodexAppServerConnection`、`collectModelPages`
- 涉及文件：
- `server/modules/providers/list/codex/codex-sessions.provider.ts:1829`
- `server/modules/providers/list/codex/codex-host-driver.provider.ts:89`
- `server/modules/providers/list/codex/codex-app-server.connection.ts:133`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split into codex/sessions, codex/host and codex/app-server subpackages behind barrels, registering each new directory in server-import-cycle-budget.baseline.json and the cloudpit-goal-exit-gate GATE_DIRECTORY_PIN in the same change; AC: archguard_detect_god_packages(scope=server) no longer lists modules/providers/list/codex for tooManyFiles/tooManyEntities, no new directory SCC appears, typecheck exit 0.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T12:37:25.263Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-server-codex`（routine `architecture-analysis`，runId `architecture-analysis-1793968645263`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/providers/list/codex/codex-sessions.provider.ts`
- `server/modules/providers/list/codex/codex-host-driver.provider.ts`
- `server/modules/providers/list/codex/codex-app-server.connection.ts`
- `tasks/gap-routine-architecture-analysis-god-package-server-codex.md`