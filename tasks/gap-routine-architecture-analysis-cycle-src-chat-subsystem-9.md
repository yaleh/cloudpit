---
id: gap-routine-architecture-analysis-cycle-src-chat-subsystem-9
title: "architecture-analysis: 9-package SCC inside chat: hooks ->
  utils/{session,transcript,voice} (38 edges) while transcript -> hooks (8
  edges) and utils/transcript -> export (chatExpor"
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
9-package SCC inside chat: hooks -> utils/{session,transcript,voice} (38 edges) while transcript -> hooks (8 edges) and utils/transcript -> export (chatExport.ts:11) -> utils/transcript (buildTranscriptMarkdown.ts:3) close the loop.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793004199503` · ts `2026-10-26T08:43:19.503Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`useSessionStore`、`useChatSessionState`、`ActivityDockPanel`、`ChatMessagesPane`、`buildTranscriptMarkdown`、`chatExport`、`voiceContextPack`、`ToolRenderer`
- 涉及文件：
- `src/modules/chat/hooks/useSessionStore.ts:16`
- `src/modules/chat/hooks/useChatMessages.ts:7`
- `src/modules/chat/transcript/ChatMessagesPane.tsx:12`
- `src/modules/chat/utils/transcript/chatExport.ts:11`
- `src/modules/chat/export/buildTranscriptMarkdown.ts:3`
- `src/modules/chat/activity/ActivityDockPanel.tsx:44`
- `src/modules/chat/utils/voice/voiceContextPack.ts:1`
- `src/modules/chat/tools/ToolRenderer.tsx:18`
- kind：`cycle`
- verdict：`confirmed`

## Requested action
Extract the transcript-export helpers out of the utils layer and make transcript render from props, not hooks; AC: no package-level SCC contains more than 5 chat subpackages.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T08:43:19.503Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `cycle-src-chat-subsystem-9`（routine `architecture-analysis`，runId `architecture-analysis-1793004199503`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/chat/hooks/useSessionStore.ts`
- `src/modules/chat/hooks/useChatMessages.ts`
- `src/modules/chat/transcript/ChatMessagesPane.tsx`
- `src/modules/chat/utils/transcript/chatExport.ts`
- `src/modules/chat/export/buildTranscriptMarkdown.ts`
- `src/modules/chat/activity/ActivityDockPanel.tsx`
- `src/modules/chat/utils/voice/voiceContextPack.ts`
- `src/modules/chat/tools/ToolRenderer.tsx`
- `tasks/gap-routine-architecture-analysis-cycle-src-chat-subsystem-9.md`