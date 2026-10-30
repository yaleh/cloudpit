---
id: gap-routine-architecture-analysis-god-package-src-chat
title: "architecture-analysis: src/modules/chat is 46,357 LOC over 175 source
  files with module fan-out 41 (archguard god-package defaults: minFiles 20,
  minFanOut 20) — 1.5x the next modul"
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
src/modules/chat is 46,357 LOC over 175 source files with module fan-out 41 (archguard god-package defaults: minFiles 20, minFanOut 20) — 1.5x the next module and 7x the median; chat/hooks alone is 15,689 LOC over 34 files.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793381097836` · ts `2026-10-30T17:24:57.836Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`useSessionStore`、`useChatSessionState`、`useVoiceRealtimeSession`
- 涉及文件：
- `src/modules/chat/hooks/useSessionStore.ts:1`
- `src/modules/chat/hooks/useChatSessionState.ts:1`
- `src/modules/chat/voice-realtime/useVoiceRealtimeSession.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split chat into chat-session (state hooks), chat-transcript, chat-composer and chat-voice leaves behind a narrow index barrel; AC: chat fan-out drops below 20 and no single chat directory exceeds 10k LOC.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T17:24:57.836Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `god-package-src-chat`（routine `architecture-analysis`，runId `architecture-analysis-1793381097836`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/chat/hooks/useSessionStore.ts`
- `src/modules/chat/hooks/useChatSessionState.ts`
- `src/modules/chat/voice-realtime/useVoiceRealtimeSession.ts`
- `tasks/gap-routine-architecture-analysis-god-package-src-chat.md`