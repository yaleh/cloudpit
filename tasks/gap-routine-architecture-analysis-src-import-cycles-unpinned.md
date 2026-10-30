---
id: gap-routine-architecture-analysis-src-import-cycles-unpinned
title: "architecture-analysis: 5 non-trivial directory SCCs in src (108 dir
  nodes, 2147 static file edges):
  chat/tools<->chat/tools/ContentRenderers<->chat/transcript;
  cockpit<->cockpit/ho"
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
5 non-trivial directory SCCs in src (108 dir nodes, 2147 static file edges): chat/tools<->chat/tools/ContentRenderers<->chat/transcript; cockpit<->cockpit/hooks<->project-workspace; git-panel<->git-panel/changes<->git-panel/history; architecture<->architecture/hooks; settings/hooks<->settings/tabs. server/ has the AC-394 ratchet but src has no cycle criterion and .oxlintrc.json enables no import/no-cycle rule, so these may widen unmeasured.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793381097836` · ts `2026-10-30T17:24:57.836Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`MarkdownContent`、`ToolRenderer`、`MessageComponent`、`CockpitCardList`、`WorkspaceMain`、`FileChangeItem`、`useCockpitSessionStartSettings`、`useProjectSearch`
- 涉及文件：
- `src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx:3`
- `src/modules/chat/transcript/MessageComponent.tsx:8`
- `src/modules/cockpit/CockpitCardList.tsx:23`
- `src/modules/project-workspace/WorkspaceMain.tsx:12`
- `src/modules/git-panel/changes/FileChangeItem.tsx:6`
- `src/modules/settings/hooks/useCockpitSessionStartSettings.ts:12`
- `src/modules/architecture/hooks/useProjectSearch.ts:3`
- kind：`dependency-cycle`
- verdict：`confirmed`

## Requested action
Add a frontend directory-cycle ratchet test (same Tarjan scanner as server/shared/import-graph.ts, @/->src alias) with a committed src baseline that may only shrink; AC: today's 5 groups are pinned and a planted 2-dir cycle reds the test.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T17:24:57.836Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `src-import-cycles-unpinned`（routine `architecture-analysis`，runId `architecture-analysis-1793381097836`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx`
- `src/modules/chat/transcript/MessageComponent.tsx`
- `src/modules/cockpit/CockpitCardList.tsx`
- `src/modules/project-workspace/WorkspaceMain.tsx`
- `src/modules/git-panel/changes/FileChangeItem.tsx`
- `src/modules/settings/hooks/useCockpitSessionStartSettings.ts`
- `src/modules/architecture/hooks/useProjectSearch.ts`
- `tasks/gap-routine-architecture-analysis-src-import-cycles-unpinned.md`