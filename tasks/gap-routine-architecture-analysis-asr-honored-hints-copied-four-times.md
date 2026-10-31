---
id: gap-routine-architecture-analysis-asr-honored-hints-copied-four-times
title: "architecture-analysis: archguard scope `shared` (76d67c2a) reports group
  c4ddbc765577af76: 4 byte-identical `honoredHints` bodies (10 statements / 137
  tokens, 24 savable lines) tha"
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
archguard scope `shared` (76d67c2a) reports group c4ddbc765577af76: 4 byte-identical `honoredHints` bodies (10 statements / 137 tokens, 24 savable lines) that apply each adapter's `capabilities.honors` declaration to the outgoing hints; the prose in each copy even says it exists 'exactly as the second adapter does it', so a drift in one copy silently makes a different adapter honour a different hint set than it declares.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793467541319` · ts `2026-10-31T17:25:41.319Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`honoredHints`
- 涉及文件：
- `shared/asr/list/multimodal/multimodal.asr-provider.ts:194`
- `shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts:106`
- `shared/asr/list/sensevoice-local/sensevoice-local.asr-provider.ts:266`
- `shared/asr/list/sensevoice-wasm/sensevoice-wasm.asr-provider.ts:275`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract one `honoredHints` into `shared/asr/asrContract.ts` (or a new `shared/asr/asrAdapterHelpers.ts`) and import it from all four adapters; AC: archguard duplicates for scope `shared` lists no group containing `honoredHints`, and an adapter-invariant test drives each adapter's declared `honors` against the shared helper.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-31T17:25:41.319Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `asr-honored-hints-copied-four-times`（routine `architecture-analysis`，runId `architecture-analysis-1793467541319`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `shared/asr/list/multimodal/multimodal.asr-provider.ts`
- `shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts`
- `shared/asr/list/sensevoice-local/sensevoice-local.asr-provider.ts`
- `shared/asr/list/sensevoice-wasm/sensevoice-wasm.asr-provider.ts`
- `tasks/gap-routine-architecture-analysis-asr-honored-hints-copied-four-times.md`