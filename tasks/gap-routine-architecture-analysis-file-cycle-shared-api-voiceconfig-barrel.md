---
id: gap-routine-architecture-analysis-file-cycle-shared-api-voiceconfig-barrel
title: "architecture-analysis: File-level value SCC of 2 (voiceConfig.ts imports
  the `api` object from its own package barrel at line 33 while index.ts
  value-imports readVoiceConfig/voiceC"
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
File-level value SCC of 2 (voiceConfig.ts imports the `api` object from its own package barrel at line 33 while index.ts value-imports readVoiceConfig/voiceConfigHeaders back at line 22) — invisible to both ratchets because frontend-import-cycle-budget collapses directory/module nodes and AC-394's server budget does not scan src/shared.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1794055077651` · ts `2026-11-07T12:37:57.651Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`api`、`readVoiceConfig`、`voiceConfigHeaders`、`whenVoiceConfigReady`
- 涉及文件：
- `src/shared/api/voiceConfig.ts:33`
- `src/shared/api/index.ts:22`
- `src/shared/api/index.ts:306`
- kind：`dependency-cycle`
- verdict：`confirmed`

## Requested action
Extract the `api` object (index.ts:306) into src/shared/api/client.ts, re-export it from index.ts and have voiceConfig.ts import ./client; AC: a file-level value-SCC scan over src/shared reports 0 cycles and src/shared/tests/voiceConfig*.test.ts stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-07T12:37:57.651Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `file-cycle-shared-api-voiceconfig-barrel`（routine `architecture-analysis`，runId `architecture-analysis-1794055077651`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/shared/api/voiceConfig.ts`
- `src/shared/api/index.ts`
- `tasks/gap-routine-architecture-analysis-file-cycle-shared-api-voiceconfig-barrel.md`