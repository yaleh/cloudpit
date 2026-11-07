---
id: gap-routine-architecture-analysis-dup-parse-observation-uri
title: "architecture-analysis: archguard_detect_duplicates group d287c4c96e:
  structurally identical 14-statement / 225-token URI parser implemented once
  per side of the client/server bound"
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
archguard_detect_duplicates group d287c4c96e: structurally identical 14-statement / 225-token URI parser implemented once per side of the client/server boundary (a 2026-10-30 run found the same clone at 153 tokens; it has since grown and both paths moved), so the addressing grammar can drift with no test noticing.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794055077651` · ts `2026-11-07T12:37:57.651Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`parseObservationUri`
- 涉及文件：
- `server/modules/observation/core/observation-uri.ts:100`
- `src/modules/cockpit-contract/observationUri.ts:91`
- kind：`duplicate-code`
- verdict：`confirmed`

## Requested action
Move the grammar into the repo-root shared/ tree both tsconfigs compile (ADR-004) and re-export from both sides; AC: one implementation (grep finds a single parseObservationUri body) plus a parity test on a shared fixture.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-07T12:37:57.651Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-parse-observation-uri`（routine `architecture-analysis`，runId `architecture-analysis-1794055077651`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/observation/core/observation-uri.ts`
- `src/modules/cockpit-contract/observationUri.ts`
- `tasks/gap-routine-architecture-analysis-dup-parse-observation-uri.md`