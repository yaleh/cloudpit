---
id: gap-voice-keyboard-shortcut-toggle
title: voice 键盘快捷键 toggle：可配置键映射同键开关 voice input（听写）与 live voice
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

现状（2026-10-27 复核，带 file:line）：两个语音面各有 toggle 接缝——voice input（听写）的 `handleVoiceToggle`（`src/modules/chat/composer/ChatComposer.tsx:676`，idle→记录需取光标+文本，其余 `toggle()`）、live voice 的 `enterVoiceMode`/`exitVoiceMode`（`src/modules/chat/ChatInterface.tsx:483`/`:587`）。两者都被 `voiceEnabled` 偏好 + `useVoiceAvailable()` 门控。仓库无任何 `mediaSession` 代码，也无可配置键盘快捷键；蓝牙耳机手势走 OS 媒体会话通道，纯 Web 需占位播放才可接——本任务走零占位路径：OS/耳机 App 把手势重映射成普通键盘键，页面监听 `keydown`。

方案：新增可配置键盘快捷键，同键开关（toggle 语义），两条绑定分别切听写与 live voice。键按 `event.code`（物理键）+ 修饰键布尔匹配，忽略 `event.repeat`/`event.defaultPrevented`，沿用 `handleGlobalEscape` 的浮层守卫。配置为 per-user 偏好：新增 `voiceShortcuts` blob（`enabled` + `dictationChord` + `liveVoiceChord`），存 `auth.db` + localStorage 镜像（同 `uiPreferences` 通道），提供 key-capture 设置 UI。架构按 frontend standards：React-free controller + hook 绑定，配置解析放 `src/shared/voiceShortcuts.ts`（镜像 `uiPreferences.ts`）。

查重：无同机制任务（键盘快捷键 toggle voice）；`task-granularity-advice` 报告 peers=[] 无 Touches 重叠，独立立案。

## Plan

1. `src/shared/voiceShortcuts.ts`：`VoiceShortcuts` 类型、默认值、`readStoredVoiceShortcuts`、规约/reducer、`canonicalChord`/`matchesChord`（`event.code`+修饰键）、冲突等级表（高危键告警）；单测 `src/shared/tests/voiceShortcuts.test.ts`。
2. `src/modules/chat/utils/voiceShortcutController.ts`：`createVoiceShortcutController(deps)`，注入 `addKeydown`/`readBindings`/两个命令/两个可用性读数，暴露 `start`/`stop`/`setCommands`/`getSnapshot`；守卫规则全在 controller；单测 `src/modules/chat/tests/voiceShortcutController.test.ts`。
3. `src/modules/chat/hooks/useVoiceShortcuts.ts`：薄绑定（`useSyncExternalStore`）。
4. 接线：`ChatInterface` 挂 controller+listener，注入 `toggleDictation`（来自 ChatComposer 上抛的 `registerDictationToggle`）与 `toggleLiveVoice`（非 voice 模式→`enterVoiceMode`，否则→`exitVoiceMode`）；`ChatComposer` 新增 `registerDictationToggle` prop，每渲染把最新 `handleVoiceToggle` 注册上来。
5. 设置 UI：`VoiceSettingsTab` 加「快捷键」小节——总开关 `enabled` + 每面一个 key-capture 输入框（按下目标键规约显示、可清除）+ 高危键告警；新 UI 文案用内联 `defaultValue`（不新增 locale key，避开 locale digest 钉）；组件测试 `src/modules/settings/tests/voiceShortcutsSettings.test.tsx`。
6. 验证：窄测试 → `npm run typecheck` → 新文件 scoped lint → MCP 浏览器实操（见 DoD）。

## AC

- [ ] `npx vitest run src/modules/chat/tests/voiceShortcutController.test.ts` 退出 0：覆盖 `event.code`+修饰键匹配、忽略 `repeat`/`defaultPrevented`、`enabled=false` 不派发、浮层打开不派发、命令按绑定路由到 toggleDictation/toggleLiveVoice。
- [ ] `npx vitest run src/shared/tests/voiceShortcuts.test.ts` 退出 0：覆盖默认值、规约、`canonicalChord`/`matchesChord`、冲突等级判定。
- [ ] `npx vitest run src/modules/settings/tests/voiceShortcutsSettings.test.tsx` 退出 0：覆盖总开关持久化、key-capture 显示与清除、高危键告警渲染。
- [ ] `npm run typecheck` 退出 0。
- [ ] `npx oxlint src/shared/voiceShortcuts.ts src/modules/chat/utils/voiceShortcutController.ts src/modules/chat/hooks/useVoiceShortcuts.ts src/modules/chat/tests/voiceShortcutController.test.ts src/shared/tests/voiceShortcuts.test.ts src/modules/settings/tests/voiceShortcutsSettings.test.tsx` 退出 0。

## DoD

- [ ] MCP 浏览器真实页面实操并截图存 `tmp/`：Settings → Voice → 快捷键小节开启总开关、为听写与 live voice 各捕获一键；composer 按听写键开/关听写麦克风、按 live voice 键进/出 Live Voice；截图贴回任务。
- [ ] 存在可用场景时跑 `node scripts/ui-scenario.mjs <scenario.json> …` 并贴 JSON 报告与检查点截图；无匹配场景则在本项注明「无可用场景」。

## Touches

- src/shared/voiceShortcuts.ts (new)
- src/shared/tests/voiceShortcuts.test.ts (new)
- src/modules/chat/utils/voiceShortcutController.ts (new)
- src/modules/chat/hooks/useVoiceShortcuts.ts (new)
- src/modules/chat/tests/voiceShortcutController.test.ts (new)
- src/modules/chat/ChatInterface.tsx
- src/modules/chat/composer/ChatComposer.tsx
- src/modules/settings/tabs/VoiceSettingsTab.tsx
- src/modules/settings/tests/voiceShortcutsSettings.test.tsx (new)
- tasks/gap-voice-keyboard-shortcut-toggle.md