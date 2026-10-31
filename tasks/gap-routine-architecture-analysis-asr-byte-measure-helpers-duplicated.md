---
id: gap-routine-architecture-analysis-asr-byte-measure-helpers-duplicated
title: "architecture-analysis: Same archguard run reports three further
  cross-adapter clone groups — `measureRequestBytes` ×3 (d2b08b77e331b8e4, 14
  savable lines), `base64Encode` ×2 (3c3a9"
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
Same archguard run reports three further cross-adapter clone groups — `measureRequestBytes` ×3 (d2b08b77e331b8e4, 14 savable lines), `base64Encode` ×2 (3c3a920a4032ca45, 13) and `utf8ByteLength` ×2 (c84e98d9d48fd1af, 13) — so the request-budget arithmetic that must agree with the wire encoding exists in 2-3 places per adapter family.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793467541319` · ts `2026-10-31T17:25:41.319Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`measureRequestBytes`、`base64Encode`、`utf8ByteLength`
- 涉及文件：
- `shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts:127`
- `shared/asr/list/sensevoice-local/sensevoice-local.asr-provider.ts:257`
- `shared/asr/list/sensevoice-wasm/sensevoice-wasm.asr-provider.ts:266`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts:483`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts:264`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts:466`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts:247`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Move the three byte/encoding helpers into the same shared asr helper module as `honoredHints`; AC: the four duplicate groups over `shared/asr/list/**` collapse to at most one, and the existing request-budget criteria keep passing against the shared helper.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-31T17:25:41.319Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `asr-byte-measure-helpers-duplicated`（routine `architecture-analysis`，runId `architecture-analysis-1793467541319`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `shared/asr/list/openai-compatible/openai-compatible.asr-provider.ts`
- `shared/asr/list/sensevoice-local/sensevoice-local.asr-provider.ts`
- `shared/asr/list/sensevoice-wasm/sensevoice-wasm.asr-provider.ts`
- `shared/asr/list/dashscope-omni/dashscope-omni.asr-provider.ts`
- `shared/asr/list/multimodal/multimodal.asr-provider.ts`
- `tasks/gap-routine-architecture-analysis-asr-byte-measure-helpers-duplicated.md`