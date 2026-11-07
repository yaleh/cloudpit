---
id: gap-routine-architecture-analysis-dup-nested-error-readers
title: "architecture-analysis: archguard_detect_duplicates group a9f71260a1:
  6-statement / 64-token same-file clone pair whose bodies differ only in the
  member key read; re-measured 2026-1"
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
archguard_detect_duplicates group a9f71260a1: 6-statement / 64-token same-file clone pair whose bodies differ only in the member key read; re-measured 2026-11-07 at the same lines, so it survived the 2026-10-31 voice-realtime god-package disposition that recorded it.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794055077651` · ts `2026-11-07T12:37:57.651Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`nestedErrorCode`、`nestedErrorMessage`
- 涉及文件：
- `server/modules/voice-realtime/voice-realtime-tts.ts:282`
- `server/modules/voice-realtime/voice-realtime-tts.ts:290`
- kind：`duplicate-code`
- verdict：`confirmed`

## Requested action
Collapse into one helper parameterised by the field key; AC: the duplicate scan no longer reports a9f71260a1 and the unit test covers both the code and message extraction paths.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-07T12:37:57.651Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-nested-error-readers`（routine `architecture-analysis`，runId `architecture-analysis-1794055077651`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `server/modules/voice-realtime/voice-realtime-tts.ts`
- `tasks/gap-routine-architecture-analysis-dup-nested-error-readers.md`