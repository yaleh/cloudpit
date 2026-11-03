---
id: gap-routine-architecture-analysis-dup-read-text-file-tail
title: "architecture-analysis: archguard_detect_duplicates group
  27e7f3bd441ab838: 198 normalized tokens / 11 statements / 23 lines,
  byte-identical except one comment — the same default IO"
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
archguard_detect_duplicates group 27e7f3bd441ab838: 198 normalized tokens / 11 statements / 23 lines, byte-identical except one comment — the same default IO-bag tail reader is defined twice.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793709366225` · ts `2026-11-03T12:36:06.225Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readTextFileTail`
- 涉及文件：
- `server/modules/providers/list/codex/codex-token-usage-files.ts:43`
- `server/modules/providers/services/provider-token-usage.service.ts:50`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Extract the body into the existing server/shared/fs-bytes.ts and have both IO bags delegate while keeping the injectable seam; AC: archguard_detect_duplicates(scope=server, minTokens=50) no longer reports group 27e7f3bd441ab838, a grep for `Buffer.alloc(maxBytes)` under server returns exactly 1, and the token-usage tests green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-03T12:36:06.225Z

## 处置结论
已修复（commit `f830dc963`）。尾读函数体抽到既有 `server/shared/fs-bytes.ts` 的 `readTextFileTail(filePath, maxBytes)`，两处 IO bag 改为直接引用它；注入 seam 不变——`CodexTokenUsageIo.readTextFileTail` 与 `ProviderTokenUsageDependencies.readTextFileTail` 仍是可覆盖的字段，两处默认实现只是委托共享函数。

复核读数（本任务 worktree，`archguard analyze -s server --lang typescript` 重建 scope `7a8c05c1` = `server (typescript)`，再 `archguard_detect_duplicates(projectRoot=worktree, scope=7a8c05c1, minStatements=6, minTokens=50)`）：
- 修复前（finding 记录）：group `27e7f3bd441ab838`，198 tokens / 11 statements / 23 lines，成员为两处 `readTextFileTail`。
- 修复后（实测）：`scannedFiles=563 scannedFunctions=7735 totalGroups=3`，`27e7f3bd441ab838` 不在任何组；剩余三组与本 finding 无关（`7d2b457cd8c4f750` settings-file readBoolean/readString、`a9f71260a1e2ca6c` nestedErrorCode/nestedErrorMessage、`f6a44c5ab6a5e692` optionalBooleanField/optionalStringField）。scope key 是分析相对值，标签 `server (typescript)` 与 finding 的 `scope=server` 同义。
- grep：`grep -rn "Buffer.alloc(maxBytes)" server/ --include=*.ts` → 恰好 1 命中（`server/shared/fs-bytes.ts:67`）。
- 回归：`provider-token-usage.service.test.ts` 22/22 通过（含大 rollout 只读尾部、尾部无 usage 行回退整文件、半行尾行跳过三条）；`codex-runtime-provider-injection.test.ts` 3/3 通过；`tsc --noEmit -p server/tsconfig.json` exit 0；改动文件 oxlint 无告警。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-read-text-file-tail`（routine `architecture-analysis`，runId `architecture-analysis-1793709366225`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## ADR-007 暗轴
该轴仍暗,理由:只把同一尾读函数搬进既有 server/shared/fs-bytes.ts、两处既有注入 seam 改为委托,包级 modules→shared 依赖本已存在,无目录或目标读数变化,暗轴无可采读数

## Touches
- `server/modules/providers/list/codex/codex-token-usage-files.ts`
- `server/modules/providers/services/provider-token-usage.service.ts`
- `server/shared/fs-bytes.ts`
- `tasks/gap-routine-architecture-analysis-dup-read-text-file-tail.md`