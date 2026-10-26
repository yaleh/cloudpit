---
id: gap-routine-architecture-analysis-cycle-src-shared-file-tree-7
title: "architecture-analysis: The shared layer imports upward:
  src/shared/projectIdentifiers.ts:27 imports loadProjectFileIndex from
  '@/modules/file-tree', closing a 7-package SCC (shared"
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
The shared layer imports upward: src/shared/projectIdentifiers.ts:27 imports loadProjectFileIndex from '@/modules/file-tree', closing a 7-package SCC (shared, shared/hooks, shared/context, shared/ui <-> file-tree, file-tree/hooks, file-tree/utils).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793004199503` · ts `2026-10-26T08:43:19.503Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`loadProjectFileIndex`、`projectIdentifiers`、`FileTree`、`useFileTreeData`、`fileTreeUtils`
- 涉及文件：
- `src/shared/projectIdentifiers.ts:27`
- `src/modules/file-tree/FileTree.tsx:6`
- `src/modules/file-tree/hooks/useFileTreeData.ts:3`
- `src/modules/file-tree/utils/fileTreeUtils.ts:3`
- kind：`cycle`
- verdict：`confirmed`

## Requested action
Take the file index as a parameter/port instead of importing the feature module, keeping shared lower than src/modules; AC: `grep -rn "@/modules/" src/shared` returns 0 hits and detect_cycles(shared) is empty.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T08:43:19.503Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `cycle-src-shared-file-tree-7`（routine `architecture-analysis`，runId `architecture-analysis-1793004199503`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/shared/projectIdentifiers.ts`
- `src/modules/file-tree/FileTree.tsx`
- `src/modules/file-tree/hooks/useFileTreeData.ts`
- `src/modules/file-tree/utils/fileTreeUtils.ts`
- `tasks/gap-routine-architecture-analysis-cycle-src-shared-file-tree-7.md`