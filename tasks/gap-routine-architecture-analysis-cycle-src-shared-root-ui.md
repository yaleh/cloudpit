---
id: gap-routine-architecture-analysis-cycle-src-shared-root-ui
title: "architecture-analysis: src/shared root, ui, hooks and context form a
  4-package SCC whose only root->subdir edge is PROVIDER_DESCRIPTORS carrying
  four React logo components out of c"
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
src/shared root, ui, hooks and context form a 4-package SCC whose only root->subdir edge is PROVIDER_DESCRIPTORS carrying four React logo components out of constants.ts, while ui/hooks/context all import '@/shared/{utils,types,constants}' back.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793090640570` · ts `2026-10-27T08:44:00.570Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`PROVIDER_DESCRIPTORS`、`ClaudeLogo`、`CodexLogo`、`CursorLogo`、`OpenCodeLogo`
- 涉及文件：
- `src/shared/constants.ts:14`
- `src/shared/constants.ts:278`
- `src/shared/ui/LLMProviderLogo.tsx:1`
- `src/shared/ui/DarkModeToggle.tsx:3`
- `src/shared/hooks/useVersionCheck.ts:3`
- kind：`dependency-cycle`
- verdict：`confirmed`

## Requested action
Move the logo ComponentType fields out of src/shared/constants.ts into src/shared/ui/providerLogos.ts (constants keeps ids/labels only) so the root has no edge into ui/; AC: detect_cycles lists src/shared root as its own component and no module under src/shared/{ui,hooks,context} changes its imports.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-27T08:44:00.570Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `cycle-src-shared-root-ui`（routine `architecture-analysis`，runId `architecture-analysis-1793090640570`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/shared/constants.ts`
- `src/shared/ui/LLMProviderLogo.tsx`
- `src/shared/ui/DarkModeToggle.tsx`
- `src/shared/hooks/useVersionCheck.ts`
- `tasks/gap-routine-architecture-analysis-cycle-src-shared-root-ui.md`