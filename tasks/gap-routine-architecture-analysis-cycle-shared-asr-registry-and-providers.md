---
id: gap-routine-architecture-analysis-cycle-shared-asr-registry-and-providers
title: "architecture-analysis: A 7-file SCC with 13 value-level edges:
  asrRegistry.ts imports every adapter (lines 28/36/43/48/53/60) while the
  adapters import its guard helpers (baseMimeT"
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
A 7-file SCC with 13 value-level edges: asrRegistry.ts imports every adapter (lines 28/36/43/48/53/60) while the adapters import its guard helpers (baseMimeType, classifyUpstreamFailure, declaredAcceptsMime), and the registry's own header calls the contract split 'a pure move with no behaviour in it'.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793294690736` · ts `2026-10-29T17:24:50.736Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`asrRegistry`、`baseMimeType`、`classifyUpstreamFailure`、`declaredAcceptsMime`
- 涉及文件：
- `shared/asr/asrRegistry.ts:28`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts:89`
- `shared/asr/list/dashscope-omni-relay/dashscope-omni-relay.asr-provider.ts:40`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts:68`
- kind：`cycle`
- verdict：`confirmed`

## Requested action
Extract the AsrAdapter contract types and the three guard helpers into a leaf shared/asr/asrContract.ts imported by both sides, leaving asrRegistry.ts as only the address book; AC: a file-level SCC scan over shared/asr reports 0 cycles and `npm run typecheck` passes under both the root and server tsconfig.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T17:24:50.736Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `cycle-shared-asr-registry-and-providers`（routine `architecture-analysis`，runId `architecture-analysis-1793294690736`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `shared/asr/asrRegistry.ts`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts`
- `shared/asr/list/dashscope-omni-relay/dashscope-omni-relay.asr-provider.ts`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts`
- `tasks/gap-routine-architecture-analysis-cycle-shared-asr-registry-and-providers.md`