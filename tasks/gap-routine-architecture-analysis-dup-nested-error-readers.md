---
id: gap-routine-architecture-analysis-dup-nested-error-readers
title: "architecture-analysis: archguard_detect_duplicates group a9f71260a1:
  6-statement / 64-token same-file clone pair whose bodies differ only in the
  member key read; re-measured 2026-1"
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

## Evidence
- 复核（develop `36ca2b14b`，archguard `detectDuplicates(root=主检出, sources=['server'], minStatements=6, minTokens=50, includeTests=false)`）：`scannedFiles=603 scannedFunctions=7810 totalGroups=1`，唯一组即 `a9f71260a1e2ca6c`（`nestedErrorCode` :282-287 ↔ `nestedErrorMessage` :290-295，6 statements / 64 tokens）。
- 修复（本任务 worktree，同一命令与同一 scope/阈值）：`scannedFiles=603 scannedFunctions=7809 totalGroups=0`，`a9f71260a1e2ca6c` 不再出现在任何组。
- 单测实跑：`npx tsx --tsconfig server/tsconfig.json --test server/modules/voice-realtime/tests/voice-realtime-tts.test.ts` → `tests 11 / pass 11 / fail 0`。新增两腿分别覆盖非 2xx 响应体与 200 流内事件里的嵌套 `error.code` / `error.message` 抽取路径。
- 处置结论：修掉。`nestedErrorCode` / `nestedErrorMessage` 合并为唯一的 `nestedErrorField(record, key)`；两处消费者（`upstreamFailure` 与 `readSynthesisEvent`）的 code/message 读取都经它。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-nested-error-readers`（routine `architecture-analysis`，runId `architecture-analysis-1794055077651`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过：archguard 同命令复扫 `totalGroups=0`（`a9f71260a1e2ca6c` 消失），TTS 单测 11/11 pass、0 fail。
- [x] ⛔ 探针只立案不执行：例程只写 finding 与任务，复核与修复由派发链的 worker 执行。

## ADR-007 暗轴记录
- L_G archguard: duplicateGroups=0 (develop 对照 duplicateGroups=1, group a9f71260a1e2ca6c); scannedFiles=603; scannedFunctions=7809; scope=server; minStatements=6; minTokens=50
- L_D 该轴仍暗,理由:本任务只折叠同一文件内的重复读取器，不改变文档/代码线比例，没有可分离的 L_D 读数。

## Touches
- `server/modules/voice-realtime/voice-realtime-tts.ts`
- `server/modules/voice-realtime/tests/voice-realtime-tts.test.ts`
- `tasks/gap-routine-architecture-analysis-dup-nested-error-readers.md`