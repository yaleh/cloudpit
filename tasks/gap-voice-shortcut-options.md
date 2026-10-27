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

- [x] `npx vitest run src/modules/chat/tests/voiceShortcutController.test.ts` 退出 0：覆盖 cross-cancel 双向改投（听写录音中按 live voice 键停录不发、live voice 中按听写键退出）、`dictationSendOnStop` 时录音中按听写键调 `stopAndSendDictation`、clear chord 路由 + `isClearAvailable` 门、三路去重与优先级。
  - 证据（worktree `48460a742` + `develop` 6d0449935 已并入）：`Test Files 1 passed (1) / Tests 17 passed (17)`，退出 0。
- [x] `npx vitest run src/shared/tests/voiceShortcuts.test.ts` 退出 0：覆盖三个新字段的默认值与 normalize。
  - 证据：`Test Files 1 passed (1) / Tests 9 passed (9)`，退出 0。
- [x] `npx vitest run src/modules/settings/tests/voiceShortcutsSettings.test.tsx` 退出 0：覆盖两个新 toggle 持久化、第三个 capture 显示/清除、三路重复警示。
  - 证据：`Test Files 1 passed (1) / Tests 8 passed (8)`，退出 0。
- [x] `npm run typecheck` 退出 0。
  - 证据：`tsc --noEmit -p tsconfig.json && tsc --noEmit -p server/tsconfig.json && tsc --noEmit -p scripts/tsconfig.json`，退出 0。
- [x] `npx oxlint src/shared/voiceShortcuts.ts src/modules/chat/utils/voiceShortcutController.ts src/modules/chat/hooks/useVoiceShortcuts.ts src/modules/settings/tabs/VoiceShortcutsSection.tsx src/shared/tests/voiceShortcuts.test.ts src/modules/chat/tests/voiceShortcutController.test.ts src/modules/settings/tests/voiceShortcutsSettings.test.tsx` 退出 0。
  - 证据：退出 0；仅两条既有的 tailwind(classnames-order / no-unnecessary-arbitrary-value) 警告，均在 `VoiceShortcutsSection.tsx:67`（本次未改动的 capture 按钮 class 字符串）。

## DoD

- [x] MCP 浏览器真实页面实操并截图存 `tmp/`：Settings → Voice → 快捷键小节开启三个新选项；录一段听写后按听写键验证自动发送；听写录音中按 live voice 键验证停录且不进 live voice；live voice 中按听写键验证退出且 run 继续；按 clear 键验证清空输入框；截图贴回任务。
  - 无 MCP 浏览器可用，按 `no-mcp-browser-use-throwaway-playwright-spec` 用一次性 Playwright 脚本代替；页面与二进制仍是真实构建产物。
  - 环境：隔离实例 `scripts/isolated-instance.sh`（DB 拷贝、residentRestore 关闭、`CLAUDE_CLI_PATH` 指向 `exit 0` 的桩），`http://127.0.0.1:3199`；真实 Chromium + 假麦克风（`--use-file-for-fake-audio-capture`），识别器用 `page.route('**/api/voice/transcribe')` 在浏览器侧应答。
  - 脚本：`tmp/dod/verify.mjs`（另 `tmp/dod/make-wav.mjs` 生成 1.81s 逐字发声 WAV）。运行结果 **20/20 检查通过**，`tmp/dod/report.json` 中 `"ok": true`。逐条读数：
    - 三个新选项：听写 `Ctrl+Alt+D`、Live Voice `Ctrl+Alt+L`、清空 `Ctrl+Alt+K` 三个 capture 均捕获成功；`Send when stopped by shortcut` 与 `Other voice key cancels` 两个开关置为 `aria-checked=true`；偏好镜像落盘为 `{"enabled":true,...,"dictationSendOnStop":true,"crossSurfaceCancel":true,"clearInputChord":{"code":"KeyK",...}}`。截图 `tmp/dod/shots/01a-settings-shortcuts.png`。
    - 三路重复警示：把清空改绑到 `Ctrl+Alt+D` 后出现红色提示 “Two shortcuts use the same keys. Only Dictation, then Live Voice, then Clear can fire — change one of them.”，改回 `Ctrl+Alt+K` 后消失。截图 `tmp/dod/shots/01b-duplicate-warning.png`。
    - 清空快捷键：输入草稿后按 `Ctrl+Alt+K`，输入框读到 `""`。截图 `tmp/dod/shots/02a-draft-before-clear.png`、`tmp/dod/shots/02b-composer-after-clear.png`。
    - 停止即发：按听写键开录（麦克风按钮 aria-label 变 `Stop recording`），再按同一键后 `send this dictation please` 作为 user 行上屏，聊天 socket 上出现携带该文本的帧；`/api/voice/transcribe` 收到 1 次请求。截图 `tmp/dod/shots/03-send-on-stop.png`。
    - 跨面取消（听写中按 Live Voice 键）：麦克风按钮回到 `Voice input`，voice bar 不出现，user 行数不变（2→2），转写文本留在输入框未发送。截图 `tmp/dod/shots/04-cross-cancel-dictation.png`。
    - Live Voice 中按听写键：voice bar 出现（截图 `tmp/dod/shots/05-live-voice.png`）→ 按 `Ctrl+Alt+D` 后 bar 消失、composer 回来（backlog 重注为草稿），退出期间 socket 只发出 `{"type":"close"}`，无 interrupt/abort 帧。截图 `tmp/dod/shots/06-live-voice-exit.png`。
- [x] 存在可用场景时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 并贴 JSON 报告与检查点截图；无匹配场景则在本项注明「无可用场景」。
  - 无可用场景：`e2e/scenarios/` 下只有 `cockpit-cards-confirm.json`、`cockpit-mode-switch.json`、`quay-wall-focus-pin-utter.json` 三个 cockpit 场景，均不覆盖语音快捷键；未伪造场景。

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

## ADR-007 dark axis

该轴仍暗,理由:本任务只改快捷键路由与设置持久化，接入的是既有 `/api/voice/transcribe` 与既有的 live voice 会话，没有新增或改变任何模型调用路径，无法读出 L_D/L_G 量值。
