---
id: gap-routine-architecture-analysis-dup-voice-concatfloat
title: "architecture-analysis: Identical Float32Array concatenation helper (11
  lines, 86 tokens) implemented in the chat hook and in the voice util tier; the
  util tier already owns `voiceS"
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
Identical Float32Array concatenation helper (11 lines, 86 tokens) implemented in the chat hook and in the voice util tier; the util tier already owns `voiceSegments.ts` as the natural home.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793208251918` · ts `2026-10-28T17:24:11.918Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`concatFloat`
- 涉及文件：
- `src/modules/chat/hooks/useVoiceInput.ts:396`
- `src/modules/chat/utils/voice/voiceLiveSegmenter.ts:249`
- kind：`duplicate`
- verdict：`confirmed`

## Requested action
Export `concatFloat` from `src/modules/chat/utils/voice/voiceSegments.ts` and import it in both sites; AC: single definition of `function concatFloat` under `src/`.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-28T17:24:11.918Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-voice-concatfloat`（routine `architecture-analysis`，runId `architecture-analysis-1793208251918`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/chat/hooks/useVoiceInput.ts`
- `src/modules/chat/utils/voice/voiceLiveSegmenter.ts`
- `tasks/gap-routine-architecture-analysis-dup-voice-concatfloat.md`