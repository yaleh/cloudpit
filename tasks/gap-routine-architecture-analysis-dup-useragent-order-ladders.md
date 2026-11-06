---
id: gap-routine-architecture-analysis-dup-useragent-order-ladders
title: "architecture-analysis: archguard_detect_duplicates(scope=src,
  2026-11-06) group = 79 tokens / 11 statements / 18 lines: two identical
  ordered if-ladders (return first matching labe"
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
archguard_detect_duplicates(scope=src, 2026-11-06) group = 79 tokens / 11 statements / 18 lines: two identical ordered if-ladders (return first matching label, else a default) differing only in their regex table and labels; also reported by the 2026-11-05 run and rejected then only by the rate cap.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793968645263` · ts `2026-11-06T12:37:25.263Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`detectBrowserName`、`detectOsName`
- 涉及文件：
- `src/shared/settings/userSettings.ts:449`
- `src/shared/settings/userSettings.ts:472`
- kind：`duplicate`
- verdict：`confirmed`

## Requested action
Extract firstMatchingLabel(userAgent, table) and keep the two ordered tables declarative; AC: the group disappears from archguard_detect_duplicates(scope=src) and the userSettings/device-name tests stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T12:37:25.263Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-useragent-order-ladders`（routine `architecture-analysis`，runId `architecture-analysis-1793968645263`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
- 实现提交 `1ae98f0d5`：`src/shared/settings/userSettings.ts`（+37 / −36）。抽出 `firstMatchingLabel(userAgent, table)`，把两个有序 if-ladder 改成声明式表 `BROWSER_LABEL_TABLE` / `OS_LABEL_TABLE`（末行 `pattern: null` 为默认标签）；`detectBrowserName` / `detectOsName` 退化为一行委托，行为与顺序不变（Edge/Opera 先于 Chrome，Android/iOS 先于 Linux/macOS）。
- `archguard_detect_duplicates(scope=src)`（minStatements=6 / minTokens=50，默认阈值）实测：改前 `groupCount=2`，含 `fbbedd69b6edc6a3 tokens=79 stmts=11 lines=18 :: src/shared/settings/userSettings.ts:449-466 detectBrowserName | src/shared/settings/userSettings.ts:472-489 detectOsName`；改后 `groupCount=1`，该组消失，仅剩与本任务无关的 `f238325ed6daed28`（`useSidebarConversationSearch.ts` 两个匿名函数）。
- `bash scripts/with-memory-cap.sh npx vitest run src/modules/settings/tests/mcpNavigationSettings.test.tsx src/shared/tests/userSettings.test.ts` → 2 files / 18 tests passed。
- `npx tsc --noEmit -p tsconfig.json` → exit 0。

## ADR-007 暗轴
- L_G: 该轴仍暗,理由:worktree 内没有 `.archguard/query/manifest.json`（该产物被 gitignore、只存在于主检出），本任务的结构结论由上面的 duplicates 读数承担，无依赖边/环读数可采

## Touches
- `src/shared/settings/userSettings.ts`
- `tasks/gap-routine-architecture-analysis-dup-useragent-order-ladders.md`