---
id: gap-routine-architecture-analysis-dup-sidebar-search-sse-handlers
title: "architecture-analysis: archguard_detect_duplicates(scope=src,
  2026-11-06) group = 91 tokens / 8 statements / 13 lines: the SSE 'done' and
  'error' listener bodies are identical (clo"
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
- [ ] `.quay/routine-findings.jsonl` 中 finding `dup-sidebar-search-sse-handlers`（routine `architecture-analysis`，runId `architecture-analysis-1793968645263`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/sidebar/hooks/useSidebarConversationSearch.ts`
- `tasks/gap-routine-architecture-analysis-dup-sidebar-search-sse-handlers.md`