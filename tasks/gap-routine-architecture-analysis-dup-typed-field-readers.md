---
id: gap-routine-architecture-analysis-dup-typed-field-readers
title: "architecture-analysis: archguard_detect_duplicates(scope=server) groups
  7d2b457cd8c4f750 (70 tokens / 14 lines) and f6a44c5ab6a5e692 (56 tokens / 6
  lines): the same undefined/wrong"
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
archguard_detect_duplicates(scope=server) groups 7d2b457cd8c4f750 (70 tokens / 14 lines) and f6a44c5ab6a5e692 (56 tokens / 6 lines): the same undefined/wrong-type/fallback ladder is written once per field type and once per error style across two files.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793882215773` · ts `2026-11-05T12:36:55.773Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readBoolean`、`readString`、`optionalBooleanField`、`optionalStringField`
- 涉及文件：
- `server/shared/settings-file.ts:168`
- `server/shared/settings-file.ts:188`
- `server/modules/reply-suggestions/reply-suggestions.routes.ts:51`
- `server/modules/reply-suggestions/reply-suggestions.routes.ts:78`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Add one generic readField<T>(record, key, fallback, typeName, guard, onProblem) in server/shared/settings-file.ts and route reply-suggestions optional*Field through it; AC: both groups are gone from archguard_detect_duplicates(scope=server) and server/shared/tests/settings-file.test.ts plus server/modules/reply-suggestions/tests/reply-suggestions-routes.test.ts stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-05T12:36:55.773Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-typed-field-readers`（routine `architecture-analysis`，runId `architecture-analysis-1793882215773`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/shared/settings-file.ts`
- `server/modules/reply-suggestions/reply-suggestions.routes.ts`
- `tasks/gap-routine-architecture-analysis-dup-typed-field-readers.md`