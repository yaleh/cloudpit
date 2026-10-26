---
id: gap-routine-architecture-analysis-cycle-src-chat-subsystem-9
title: "architecture-analysis: 9-package SCC inside chat: hooks ->
  utils/{session,transcript,voice} (38 edges) while transcript -> hooks (8
  edges) and utils/transcript -> export (chatExpor"
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

## Disposition（复核与处置）
- 复核：本地目录级 import 图（`src/modules/chat`）复现 finding 的 9 包 SCC，节点集合与 finding 完全一致：`activity, export, hooks, tools, tools/ContentRenderers, transcript, utils/session, utils/transcript, utils/voice`。
- 修掉（切断 utils 层两条上行边）：
  1. `utils/transcript/chatExport.ts` 组合 `chat/export/*`，令 utils 依赖 export 功能层。已把下载导出入口移到 `chat/export/chatExport.ts`（消费方 `ChatInterface.tsx` 与两个导出测试同步改路径）。
  2. `utils/voice/voiceContextPack.ts` 从 `@/modules/chat/tools` 桶导入 `shouldHideToolResult`，把整个 tools 包拉到 utils 之下。改为从定义叶 `@/modules/chat/tools/configs/toolConfigs` 读取，与 `toolGrouping` / `workSegmentTitle` 的既有读法一致。
- 复测（finding 的主仪器 archguard）：`archguard_detect_cycles --outputScope package`，scope `c0cb97c7`（`src/modules/chat`）→ `maxScc=3`，唯一环为 `{tools, tools/ContentRenderers, transcript}`；修复前 finding 记录为 9 包 SCC。
- 「make transcript render from props, not hooks」未单独实施：两条上行边切断后，`transcript -> hooks / activity / tools` 均为单向（hooks、activity 已无回到 transcript 的路径），archguard 读数已满足 AC（≤5）。
- 实跑：`transcriptExport.test.tsx`（13）、`transcriptExportWorkSegments.test.tsx`（3）、`voiceContextPack.test.ts`（20）全绿；`tsc --noEmit -p tsconfig.json` 与 `oxlint src/modules/chat` 均通过。

## Architecture axis（ADR-007）
- L_G archguard: maxScc=3, cycles=1, before_maxScc=9 (scope c0cb97c7, src/modules/chat)

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `cycle-src-chat-subsystem-9`（routine `architecture-analysis`，runId `architecture-analysis-1793004199503`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/chat/hooks/useSessionStore.ts`
- `src/modules/chat/hooks/useChatMessages.ts`
- `src/modules/chat/transcript/ChatMessagesPane.tsx`
- `src/modules/chat/utils/transcript/chatExport.ts`
- `src/modules/chat/export/chatExport.ts`
- `src/modules/chat/export/buildTranscriptMarkdown.ts`
- `src/modules/chat/activity/ActivityDockPanel.tsx`
- `src/modules/chat/utils/voice/voiceContextPack.ts`
- `src/modules/chat/tools/ToolRenderer.tsx`
- `src/modules/chat/ChatInterface.tsx`
- `src/modules/chat/tests/transcriptExport.test.tsx`
- `src/modules/chat/tests/transcriptExportWorkSegments.test.tsx`
- `src/modules/chat/utils/tests/voiceContextPack.test.ts`
- `src/modules/chat/utils/transcript/index.ts`
- `tasks/gap-routine-architecture-analysis-cycle-src-chat-subsystem-9.md`