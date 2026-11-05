---
id: gap-routine-architecture-analysis-god-package-src-shared
title: "architecture-analysis: archguard snapshot 2026-11-03 (scope src
  93e0a992) flags shared with all four reasons: fanIn 1630 / fanOut 202 / 31
  direct files / 170 entities; the 31 root "
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
archguard snapshot 2026-11-03 (scope src 93e0a992) flags shared with all four reasons: fanIn 1630 / fanOut 202 / 31 direct files / 170 entities; the 31 root files are a grab bag of voice (10 files), settings+device (6) and API/identity (15) with a 17-line barrel, so every consumer deep-imports unrelated concerns from one package.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793882215773` · ts `2026-11-05T12:36:55.773Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readDeviceName`、`authenticatedFetch`、`decodeVoiceBlob`、`voiceConfigSignature`、`readMcpNavigationPolicy`
- 涉及文件：
- `src/shared/index.ts:1`
- `src/shared/userSettings.ts:462`
- `src/shared/api.ts:1`
- `src/shared/voiceConfig.ts:1`
- `src/shared/mcpNavigationPolicy.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split the root into src/shared/voice/ and src/shared/settings/ subpackages behind re-export barrels, and register those directories in .oxlintrc.json boundaries/elements; AC: archguard_detect_god_packages no longer lists shared for tooManyFiles or tooManyEntities (fanIn recorded as residual), tsc --noEmit -p tsconfig.json exit 0, and the src/shared tests plus src/modules/sidebar and src/modules/chat-composer tests stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-05T12:36:55.773Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-src-shared`（routine `architecture-analysis`，runId `architecture-analysis-1793882215773`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/shared/index.ts`
- `src/shared/userSettings.ts`
- `src/shared/api.ts`
- `src/shared/voiceConfig.ts`
- `src/shared/mcpNavigationPolicy.ts`
- `tasks/gap-routine-architecture-analysis-god-package-src-shared.md`