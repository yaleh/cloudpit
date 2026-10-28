---
id: gap-routine-architecture-analysis-dup-voice-concatfloat
title: "architecture-analysis: Identical Float32Array concatenation helper (11
  lines, 86 tokens) implemented in the chat hook and in the voice util tier; the
  util tier already owns `voiceS"
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

## 处置结论
处置：**修掉**。finding 记录的两处重复 `concatFloat` 已消除：

- 唯一实现：`src/modules/chat/utils/voice/voiceSegments.ts` 导出 `concatFloat`；`grep -rn "function concatFloat" src/` 在本次实现后只命中该一处。
- 两个原站点改为导入：`src/modules/chat/hooks/useVoiceInput.ts`（no-VAD whole-buffer 路径）与 `src/modules/chat/utils/voice/voiceLiveSegmenter.ts`（whole-buffer pass）。
- 行为等价：函数体逐字保留（累加总长度 → 依次 `out.set`），仅参数名与所在模块变化。

实跑读数（worktree `gap-routine-architecture-analysis-dup-voice-concatfloat`）：
- `grep -rn "function concatFloat" src/` → 1 处（`voiceSegments.ts:133`）。
- `tsc --noEmit -p tsconfig.json` → 退出码 0。
- `oxlint` 三个改动文件 → 退出码 0（仅既有 warning，无新增）。
- `vitest run src/modules/chat/utils/tests/voiceSegments.test.ts src/modules/chat/utils/tests/voiceLiveSegmenter.test.ts` → `2 passed`，`36 passed | 1 skipped`，退出码 0。
- finding 复核：`.quay/routine-findings.jsonl:48` 存在 `findingId:"dup-voice-concatfloat"`、`runId:"architecture-analysis-1793208251918"`、`verdict:"confirmed"`，与本任务载体记录一致。

- L_D 该轴仍暗,理由:本任务只把一处重复实现收敛为单一定义，不新增领域数据能力，没有可读的领域数据轴读数。
- L_G 该轴仍暗,理由:本任务不改变识别文本与生成行为，重构前后同一音频的转写路径不变，没有生成质量轴读数。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-voice-concatfloat`（routine `architecture-analysis`，runId `architecture-analysis-1793208251918`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/chat/hooks/useVoiceInput.ts`
- `src/modules/chat/utils/voice/voiceLiveSegmenter.ts`
- `src/modules/chat/utils/voice/voiceSegments.ts`
- `tasks/gap-routine-architecture-analysis-dup-voice-concatfloat.md`
