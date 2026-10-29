---
id: gap-routine-architecture-analysis-dup-quay-json-field-readers
title: "architecture-analysis: archguard_detect_duplicates(scope=server) reports
  readNullableNumber as an exact structural clone (hash 95e46f038385c213, 96
  tokens, 10 lines) at both sites;"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard_detect_duplicates(scope=server) reports readNullableNumber as an exact structural clone (hash 95e46f038385c213, 96 tokens, 10 lines) at both sites; readNullableString is byte-identical too, and backend-module-standards requires a helper used in 2+ files to live in server/shared/utils.ts.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793294690736` · ts `2026-10-29T17:24:50.736Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`readNullableNumber`、`readNullableString`
- 涉及文件：
- `server/modules/quay/quay.service.ts:1309`
- `server/modules/quay/quay.service.ts:1314`
- `server/modules/quay/quay-suite-fanin-reader.ts:105`
- `server/modules/quay/quay-suite-fanin-reader.ts:109`
- kind：`duplicate`
- verdict：`confirmed`

## Requested action
Move both readers to server/shared/utils.ts beside readOptionalString and import them from the two quay files; AC: archguard_detect_duplicates(scope=server) returns no group containing readNullableNumber/readNullableString and `grep -rn 'function readNullable[NS]' server/ | wc -l` = 2.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-29T17:24:50.736Z

## 处置记录
- 复核：develop 上 `quay.service.ts:1309/1314` 与 `quay-suite-fanin-reader.ts:105/109` 是逐字相同的两份 `readNullableString` / `readNullableNumber`；archguard 的 `hash 95e46f038385c213` 组正是它们（修复前复扫确认）。
- 处置：已修掉。两个读取器提到 `server/shared/utils.ts`（紧邻 `readOptionalString`）并导出，两个 quay 文件改为 `import { readNullableNumber, readNullableString } from '@/shared/utils.js'`；提交 `ee6ed33e2`。
- 复扫：`archguard_detect_duplicates(scope=server)`（对 worktree 重新 `archguard analyze` 后）返回 3 组，均不含 `readNullableNumber` / `readNullableString`；`grep -rn 'function readNullable[NS]' server/ | wc -l` = 2（两条声明都在 `server/shared/utils.ts`）。
- 副作用：`server/shared/utils.ts` 由 1900 行长到 1930 行，越过已基线的 800 行门槛，因此按 AC-394 的 RECORDED CHANGE 格式在 `server/shared/tests/architecture-ratchet.baseline.json` 记一条并上调该条目；两个 quay 文件分别缩短 16 / 14 行。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-quay-json-field-readers`（routine `architecture-analysis`，runId `architecture-analysis-1793294690736`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案 —— 已修掉，读数见上「处置记录」。

## DoD
- [x] 上面的判据实跑通过：`npm run typecheck` 0；`quay-suite-fanin-reader.test.ts` + `quay.service.test.ts` 共 48 tests、47 pass、1 skip（无已安装插件）、0 fail；`architecture-ratchet.test.ts` 6/6、`server-import-cycle-budget.test.ts` 11/11；oxlint 改动文件无告警；archguard 复扫与 grep 读数如上。
- [x] ⛔ 探针只立案不执行：例程只写了 finding 与任务，修复由派发链的 worker 执行。

## ADR-007 暗轴记录
- L_G archguard: duplicateGroups=3; readNullableGroups=0; scannedFunctions=6921
- L_D 该轴仍暗,理由:本任务只把跨文件重复的读取器收敛到共享 helper，不改变文档/代码线比例，也没有可分离的 L_D 读数。

## Touches
- `server/modules/quay/quay.service.ts`
- `server/modules/quay/quay-suite-fanin-reader.ts`
- `server/shared/utils.ts`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `tasks/gap-routine-architecture-analysis-dup-quay-json-field-readers.md`