---
id: gap-voice-shortcut-options
title: voice 快捷键扩展：停止后即发（仅快捷键）+ 跨面取消 + 清空输入框映射
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

现状（2026-10-27 复核）：`voiceShortcuts` blob 只有 `{enabled, dictationChord, liveVoiceChord}`；`voiceShortcutController` 按 chord 路由到 `toggleDictation`/`toggleLiveVoice` 两条命令；`useVoiceInput` 已有 `stop({ send: true })`（composer 提交按钮录音中即用，`ChatComposer.tsx:1552`）；`handleClearInput` 已存在（`useChatComposerState.ts:976`，Escape 带守卫调用，`:1037-1047`）。

本任务给快捷键加三个选项，全存进 `voiceShortcuts` blob（已确认）：
1. `dictationSendOnStop`（bool，默认 false）：听写**经快捷键停止**时自动发送（`stop({send:true})`）。仅作用于快捷键路径，不覆盖屏幕麦克风按钮，也不含静音 auto-stop（已确认）。
2. `crossSurfaceCancel`（bool，默认 false）：跨面按键改为「取消」。听写录音中按 live voice 键 → 停录**不发**、不进 live voice；live voice 中按听写键 → 退出 live voice（backlog 重注回 composer、mic 连接断开、run 继续，非 abort turn）（已确认）。
3. `clearInputChord`（chord|null，默认 null）：第三个映射，触发清空输入框，复用 `handleClearInput` 并沿用 Escape 守卫（有草稿且 !isLoading 且无 dock turn/菜单）（已确认）。

路由仍放 React-free controller，命令/读数经 `useVoiceShortcuts` 注入；composer 只把 `stopAndSend` 与 `recording` 注册上来。查重：无同机制任务（这是已落地快捷键功能的扩展，非同一机制）；`task-granularity-advice` 报 peers=[]，独立立案。

## Plan

1. `src/shared/voiceShortcuts.ts`：`VoiceShortcuts` 加 `dictationSendOnStop`/`crossSurfaceCancel`/`clearInputChord`；`normalizeVoiceShortcuts` 补默认；单测补新字段规约。
2. `src/modules/chat/utils/voiceShortcutController.ts`：`DictationToggleRegistration` 加 `stopAndSend`+`recording`；`VoiceShortcutCommands` 加 `stopAndSendDictation`/`clearInput`/`isDictationRecording`/`isLiveVoiceActive`/`isClearAvailable`；`handleKeydown` 改三路路由（dictation > live voice > clear）+ cross-cancel 改投 + send-on-stop 分支；单测补路由用例。
3. `src/modules/chat/hooks/useVoiceShortcuts.ts`：选项类型与命令注入补齐。
4. `src/modules/chat/composer/ChatComposer.tsx`：注册对象补 `stopAndSend: () => voiceStop({ send: true })` 与 `recording: voiceState === 'recording'`。
5. `src/modules/chat/ChatInterface.tsx`：注入 `stopAndSendDictation`/`clearInput`（=handleClearInput）/`isDictationRecording`/`isLiveVoiceActive`（composerMode==='voice'）/`isClearAvailable`（镜像 Escape 守卫条件）。
6. `src/modules/settings/tabs/VoiceShortcutsSection.tsx`：加两个 toggle + 第三个 capture；三路去重警示。
7. 验证：窄测试 → typecheck → scoped lint → MCP 浏览器实操（DoD）。

## AC

- [ ] `npx vitest run src/modules/chat/tests/voiceShortcutController.test.ts` 退出 0：覆盖 cross-cancel 双向改投（听写录音中按 live voice 键停录不发、live voice 中按听写键退出）、`dictationSendOnStop` 时录音中按听写键调 `stopAndSendDictation`、clear chord 路由 + `isClearAvailable` 门、三路去重与优先级。
- [ ] `npx vitest run src/shared/tests/voiceShortcuts.test.ts` 退出 0：覆盖三个新字段的默认值与 normalize。
- [ ] `npx vitest run src/modules/settings/tests/voiceShortcutsSettings.test.tsx` 退出 0：覆盖两个新 toggle 持久化、第三个 capture 显示/清除、三路重复警示。
- [ ] `npm run typecheck` 退出 0。
- [ ] `npx oxlint src/shared/voiceShortcuts.ts src/modules/chat/utils/voiceShortcutController.ts src/modules/chat/hooks/useVoiceShortcuts.ts src/modules/settings/tabs/VoiceShortcutsSection.tsx src/shared/tests/voiceShortcuts.test.ts src/modules/chat/tests/voiceShortcutController.test.ts src/modules/settings/tests/voiceShortcutsSettings.test.tsx` 退出 0。

## DoD

- [ ] MCP 浏览器真实页面实操并截图存 `tmp/`：Settings → Voice → 快捷键小节开启三个新选项；录一段听写后按听写键验证自动发送；听写录音中按 live voice 键验证停录且不进 live voice；live voice 中按听写键验证退出且 run 继续；按 clear 键验证清空输入框；截图贴回任务。
- [ ] 存在可用场景时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 并贴 JSON 报告与检查点截图；无匹配场景则在本项注明「无可用场景」。

## Touches

- src/shared/voiceShortcuts.ts
- src/shared/tests/voiceShortcuts.test.ts
- src/modules/chat/utils/voiceShortcutController.ts
- src/modules/chat/hooks/useVoiceShortcuts.ts
- src/modules/chat/tests/voiceShortcutController.test.ts
- src/modules/chat/ChatInterface.tsx
- src/modules/chat/composer/ChatComposer.tsx
- src/modules/settings/tabs/VoiceShortcutsSection.tsx
- src/modules/settings/tests/voiceShortcutsSettings.test.tsx
- tasks/gap-voice-shortcut-options.md