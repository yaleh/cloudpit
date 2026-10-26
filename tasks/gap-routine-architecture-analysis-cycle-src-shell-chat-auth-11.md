---
id: gap-routine-architecture-analysis-cycle-src-shell-chat-auth-11
title: "architecture-analysis: Largest package SCC in src (11 modules): auth ->
  onboarding -> provider-auth -> standalone-shell -> shell -> chat ->
  chat/voice-realtime -> auth, with chat -"
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
Largest package SCC in src (11 modules): auth -> onboarding -> provider-auth -> standalone-shell -> shell -> chat -> chat/voice-realtime -> auth, with chat -> task-master -> context -> auth and modals -> shell also inside the same component.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793004199503` · ts `2026-10-26T08:43:19.503Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`ProtectedRoute`、`Onboarding`、`ProviderLoginModal`、`StandaloneShell`、`Shell`、`ChatInterface`、`useVoiceRealtimeSession`、`TaskMasterContext`、`TaskMasterSetupModal`
- 涉及文件：
- `src/modules/auth/ProtectedRoute.tsx:6`
- `src/modules/onboarding/Onboarding.tsx:7`
- `src/modules/provider-auth/ProviderLoginModal.tsx:4`
- `src/modules/standalone-shell/StandaloneShell.tsx:4`
- `src/modules/shell/Shell.tsx:10`
- `src/modules/chat/ChatInterface.tsx:50`
- `src/modules/chat/voice-realtime/useVoiceRealtimeSession.ts:3`
- `src/modules/chat/ChatInterface.tsx:5`
- `src/modules/task-master/context/TaskMasterContext.tsx:4`
- `src/modules/task-master/modals/TaskMasterSetupModal.tsx:6`
- kind：`cycle`
- verdict：`confirmed`

## Requested action
Invert the shell<->chat and chat/voice-realtime -> auth edges behind injected ports/context values; AC: archguard_detect_cycles(scope=src, outputScope=package) reports max SCC size < 11 and no cycle contains both modules/auth and modules/chat.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-26T08:43:19.503Z

## AC
- [ ] `.quay/routine-findings.jsonl` 中 finding `cycle-src-shell-chat-auth-11`（routine `architecture-analysis`，runId `architecture-analysis-1793004199503`）所描述的问题被复核并处置
- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [ ] 上面的判据实跑通过
- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/auth/ProtectedRoute.tsx`
- `src/modules/onboarding/Onboarding.tsx`
- `src/modules/provider-auth/ProviderLoginModal.tsx`
- `src/modules/standalone-shell/StandaloneShell.tsx`
- `src/modules/shell/Shell.tsx`
- `src/modules/chat/ChatInterface.tsx`
- `src/modules/chat/voice-realtime/useVoiceRealtimeSession.ts`
- `src/modules/task-master/context/TaskMasterContext.tsx`
- `src/modules/task-master/modals/TaskMasterSetupModal.tsx`
- `tasks/gap-routine-architecture-analysis-cycle-src-shell-chat-auth-11.md`