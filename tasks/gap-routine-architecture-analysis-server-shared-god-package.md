---
id: gap-routine-architecture-analysis-server-shared-god-package
title: "architecture-analysis: archguard 2026-11-08 (scope server, fresh at HEAD
  b5cf28d): server/shared = 18 files / 12,388 LOC / 149 entities, fanIn 1,846
  relations / fanOut 99 — over to"
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
archguard 2026-11-08 (scope server, fresh at HEAD b5cf28d): server/shared = 18 files / 12,388 LOC / 149 entities, fanIn 1,846 relations / fanOut 99 — over tooManyEntities (149>=50); types.ts alone is 5,693 lines and utils.ts 1,930; no prior god-package task or routine finding covers server/shared.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794141478281` · ts `2026-11-08T12:37:58.281Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`residentRunIsTurn`、`createApiSuccessResponse`、`asyncHandler`、`bearerToken`、`IProviderRuntime`
- 涉及文件：
- `server/shared/types.ts:29`
- `server/shared/utils.ts:79`
- `server/shared/interfaces.ts:44`
- `server/shared/index.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split server/shared/types.ts and utils.ts by domain into server/shared/types/* and server/shared/<domain>/* subpackages behind barrels, then lower the oversize ratchet baseline for types.ts/utils.ts in the same commit; AC: detect_god_packages(scope=server) no longer lists shared for tooManyEntities, no new directory SCC, server typecheck + tests green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-08T12:37:58.281Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `server-shared-god-package`（routine `architecture-analysis`，runId `architecture-analysis-1794141478281`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/shared/types.ts`
- `server/shared/utils.ts`
- `server/shared/interfaces.ts`
- `server/shared/index.ts`
- `tasks/gap-routine-architecture-analysis-server-shared-god-package.md`