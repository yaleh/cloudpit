---
id: gap-routine-architecture-analysis-dup-sidebar-search-sse-handlers
title: "architecture-analysis: archguard_detect_duplicates(scope=src,
  2026-11-06) group = 91 tokens / 8 statements / 13 lines: the SSE 'done' and
  'error' listener bodies are identical (clo"
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
archguard_detect_duplicates(scope=src, 2026-11-06) group = 91 tokens / 8 statements / 13 lines: the SSE 'done' and 'error' listener bodies are identical (close EventSource, clear progress, publish accumulated results); the 2026-11-05 probe filed this and was rejected by the rate gate, not by quality or dedup.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793968645263` · ts `2026-11-06T12:37:25.263Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`useSidebarConversationSearch`
- 涉及文件：
- `src/modules/sidebar/hooks/useSidebarConversationSearch.ts:121`
- `src/modules/sidebar/hooks/useSidebarConversationSearch.ts:135`
- kind：`duplicate`
- verdict：`confirmed`

## Requested action
Extract one finishSearch() closure called by both listeners; AC: archguard_detect_duplicates(scope=src) no longer returns this group and the sidebar conversation-search tests stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-06T12:37:25.263Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-sidebar-search-sse-handlers`（routine `architecture-analysis`，runId `architecture-analysis-1793968645263`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过（archguard duplicates 读数前后翻转 + tsc + sidebar 回归，见 Evidence）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
- 复核：finding 描述的两个匿名监听体确实逐字相同 —— `src/modules/sidebar/hooks/useSidebarConversationSearch.ts` 改前 121-133 与 135-147 行（`done` / `error`），均为 close EventSource、清 progress、发布 accumulated 结果。
- 处置（修掉）：提交 `7caf59715`，`src/modules/sidebar/hooks/useSidebarConversationSearch.ts`（+17 / −20）。新增一个 `finishSearch()` 闭包承担唯一的终止迁移；`done` 与 `error` 监听器在既有 stale-seq 守卫之后同调 `finishSearch()`，行为不变。
- `archguard_detect_duplicates(scope=src)` 实测（archguard 0.1.45 的 `detectDuplicates`，sources=`['src']`，默认 minStatements=6 / minTokens=50 / topN=200）：
  - 改前 `groupCount=2`，含 `hash=f238325ed6daed28 tokens=91 stmts=8 lines=13`，成员 `useSidebarConversationSearch.ts:121-133` 与 `135-147` —— 与 finding 的 91/8/13 完全一致。
  - 改后 `groupCount=1`，`f238325ed6daed28` 与该符号均不再出现；仅剩 `fbbedd69b6edc6a3`（`src/shared/settings/userSettings.ts`），属兄弟任务 `gap-routine-architecture-analysis-dup-useragent-order-ladders` 的范围。
- 类型：`npx tsc --noEmit -p tsconfig.json` → exit 0。
- 回归：`QUAY_MEMORY_MAX=6G bash scripts/with-memory-cap.sh npx vitest run src/modules/sidebar --maxWorkers=2` → 20 files / 126 tests passed。诚实读数：仓库没有专门针对 `useSidebarConversationSearch` 的测试文件（`grep` 全仓无 `searchConversationsUrl`/`EventSource` 的 sidebar 测试），因此「sidebar conversation-search tests stay green」以 sidebar 模块测试集为准。

## ADR-007 暗轴
- 该轴仍暗,理由:本任务只把两个相同的 SSE 终止监听体抽成一个 finishSearch() 闭包，不改变目录级依赖结构，无 L_G（目录级依赖环）读数可采；`.archguard/query/manifest.json` 被 gitignore、只存在于主检出，worktree 内无法解析 scope。

## Touches
- `src/modules/sidebar/hooks/useSidebarConversationSearch.ts`
- `tasks/gap-routine-architecture-analysis-dup-sidebar-search-sse-handlers.md`