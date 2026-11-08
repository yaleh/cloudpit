---
id: gap-voice-vad-user-toggle-and-cap-split
title: 语音输入 VAD 用户开关：会话页右上角菜单 + 设置页 Voice 输入 tab；默认开，关闭时不做 VAD 切段/首尾静音裁剪，仅按 60s 上限分片
status: ready
labels:
  - gap
  - feature
parent: null
children: []
extra:
  schema: execution
---
## Proposal

需求：给普通听写（`useVoiceInput`）一个**用户级 VAD 开关**，默认开；关闭时表示“用户认为当前环境不应使用 VAD”。入口同时放在**会话页右上角 `WorkspaceMenu` 的「输入设置」组**和**设置页 Settings → Voice → 输入 tab**，两个入口读写同一份用户偏好。

已由用户（yale）确认的三项决策：
1. **关闭语义 = 按上限分片**：不做 VAD 切段、不做首尾静音裁剪，但仍按单次请求上限 `DEFAULT_MAX_SEGMENT_SEC`（60 s）分片，保证长录音不会超过识别器的请求体上限。
2. **该设置与 `voiceDebug` 正交**：它是普通用户设置，**始终读取，不被 `voiceDebug` 门控**；含义是用户判断当前环境不应使用 VAD，与调试无关。现有 `voiceVad` 调试开关继续只服务 A/B：仅当 `voiceDebug` 打开且该开关被显式设置时才作为 A/B 覆盖；`voiceDebug` 关闭时，历史遗留的 `voiceVad` 存储值不再影响正常使用。
3. **菜单 + 设置页都放**，同一个 `UiPreferences` 键、同一份 `auth.db` 持久化，不做第二份存储。

现状（读代码确认）：
- 听写路径每次开始录音读 `isVoiceVadEnabled()`（`src/modules/chat-voice/hooks/useVoiceInput.ts`），VAD 开时走 `LiveSegmenter`；关闭（`voiceVad=off`）时走 `wholeBuffer`，但 `enqueueSegment` 仍调用 `trimSegmentEdges`，且整段一个请求会绕过 60 s 上限。
- `WorkspaceMenu` 已有「输入设置」组和 `voiceEnabled` 行（`INPUT_TOGGLES`），行只在该用户开启语音后出现；设置页 Voice 输入 tab 也已经有 `voiceEnabled` 开关。`UiPreferences` 通过 `UiPreferencesContext` 写 `auth.db` 的 `user_preferences`，跨标签页/跨设备同步（`src/shared/settings/uiPreferences.ts` / `src/shared/context/UiPreferencesContext.tsx`）。
- `scripts/voice-settings-single-surface-check.mjs` 锁定的是 `VoiceSettings` 文档的字段声明；本设置放进 `UiPreferences`，不碰该文档，因此不触发该判据。

设计：
1. `UiPreferences` 新增 `voiceVadEnabled: boolean`，默认 `true`；偏好读写沿用现有 reducer/context，无新接口。
2. 菜单：`INPUT_TOGGLES` 增加一行 `{ key: 'voiceVadEnabled', icon: AudioLines }`，仅在 `preferences.voiceEnabled` 为真时渲染；`role="menuitemcheckbox"`、`aria-checked`、`data-workspace-menu-item="voiceVadEnabled"`，label 用「语音活动检测（VAD）」并在 `title` 放完整说明。更新 `MENU_ESTIMATED_HEIGHT_PX`。
3. 设置页：Voice → 输入 tab 增加同一开关（label + description），读写同一个 `voiceVadEnabled` 键；两处状态实时互通（同一个 context），刷新后从 `auth.db` 恢复。
4. 运行时：`useVoiceInput` 增加模式选项（如 `vadMode: 'vad' | 'no-vad-capped' | 'no-vad-whole'`），在每次开始听写时解析一次；麦克风和文件上传入口共用。
   - 用户设置为开 → `vad`（现状不变）。
   - 用户设置为关 → `no-vad-capped`：不做 VAD 切段、不调 `trimSilenceEdges`，按 `DEFAULT_MAX_SEGMENT_SEC` 切成等长 PCM 片段（最后一片可短），每片独立 WAV 上传；文本在停止时一次提交（关闭流式提交）。
   - 调试 `voiceDebug=1` 且 `voiceVad=off` → `no-vad-whole`：保留现有 A/B 的“整段一个请求”语义，用于读数对照。
   - 解析优先级：`voiceDebug` 打开且 `voiceVad` 显式设置 → 调试值；否则 → `voiceVadEnabled`；两者都不设置 → 开。
5. 纯函数分片器放在 `src/modules/chat-voice/utils/voice/voiceLiveSegmenter.ts`（同包、可被 barrel 导出），不新增可变模块状态；`useVoiceInput` 里删除旧的 `wholeBufferSegment`，把整段/分片统一交给该函数，尽量保持该文件净行数不增。

架构/棘轮约束（执行时必须遵守）：
- `src/modules/chat-voice/hooks/useVoiceInput.ts` 当前 **1609 行 = `server/shared/tests/architecture-ratchet.baseline.json` 的 `oversizeFiles` 基线，无任何新增空间**；`moduleMutableState` 基线为 1，禁止新增模块级可变状态。实现应以“删除 `wholeBufferSegment` + 抽到纯函数模块”做到净零或净减；若确实需要增加，必须按 AC-394 的 `RECORDED CHANGE` 格式在基线 note 中记录并同步基线，不能静默上调。
- 前端改动遵循 `.agents/skills/frontend-module-standards/SKILL.md`；跨模块只走 barrel。
- i18n：`settings` 命名空间的 `quickSettings` 组存在于 12 个 locale（de/en/es/fr/id/it/ja/ko/ru/tr/zh-CN/zh-TW），新键需全部补齐，不允许只补英文。

<!-- dedup-ref -->
与 `gap-voice-live-vad-readings`（调试 A/B 读数与 `voiceVad=off` 开关）、`gap-live-voice-uplink-vad-production-arm-point`（Live Voice 服务端上行 VAD）、`gap-voice-pre-vad-raw-capture`（语料留存）机制不同：本条是普通听写路径的用户级设置，不改 A/B 读数、不碰 realtime 上行、不碰语料。`task-granularity-advice` 对本任务 Touches 的 `peers`/`mentions` 均为空，故单独立案。

- 该轴仍暗,理由:本任务只新增一个用户偏好、两个入口和分片路径，不新增领域数据能力；L_D/L_G 没有可读的领域读数。

## AC

- [x] `npx vitest run src/shared/tests/uiPreferences.test.ts` exit 0：`voiceVadEnabled` 默认 `true`；写入 `false` 后 `readStoredUiPreferences()` 读回 `false`；旧数据缺该键时回落 `true`。
- [x] `npx vitest run src/modules/project-workspace/tests/workspaceMenuVoiceVad.test.tsx` exit 0：`voiceEnabled=false` 时行不渲染；`voiceEnabled=true` 时行渲染、`aria-checked` 等于偏好、点击后偏好翻转且 `data-workspace-menu-item="voiceVadEnabled"` 存在。
- [x] `npx vitest run src/modules/settings/tests/voiceVadSettingSurface.test.tsx` exit 0：设置页 Voice → 输入 tab 渲染同一开关，点击写同一个 `voiceVadEnabled` 键；菜单与设置页在同一个 mock store 下读写一致。
- [x] `npx vitest run src/modules/chat/utils/tests/voiceLiveSegmenter.test.ts` exit 0：新增分片器用例——输入 25 s / 61 s / 125 s 时返回 1 / 2 / 3 片，每片 ≤ 60 s，最后一片为余数，片段拼接的样本数/时长严格等于输入；分片过程不调用 VAD、不裁首尾静音。
- [x] `npx vitest run src/modules/chat/tests/voiceVadPreference.test.tsx` exit 0，覆盖：
  - 设置为开：仍走 `LiveSegmenter`，既有段数/请求数读数不变（正控制）。
  - 设置为关：一段含“语音 + 长内部静音 + 尾部静音”的输入上传后，拼接时长 == 输入时长（不裁边、不丢内部静音），请求数 == `ceil(duration / 60)`（短样本为 1）。
  - 设置为关 + 125 s 输入：2 片、每片 ≤ 60 s、拼接 == 输入。
  - 优先级：`voiceDebug=0` 且 localStorage 里有陈旧的 `voiceVad=off` → 仍按 `voiceVadEnabled`（陈旧调试值不生效）；`voiceDebug=1&voiceVad=off` → 整段一个请求（A/B 语义）；`voiceDebug=1&voiceVad=1` + 设置为关 → VAD 开（调试值覆盖）。
  - 文件上传入口 `transcribeFile` 与麦克风入口使用同一模式。
- [x] i18n 机械检查 exit 0：`node -e "const fs=require('fs');const ls=['de','en','es','fr','id','it','ja','ko','ru','tr','zh-CN','zh-TW'];const bad=ls.filter(l=>{const v=JSON.parse(fs.readFileSync('src/modules/i18n/locales/'+l+'/settings.json','utf8')).quickSettings||{};return !v.voiceVadEnabled||!v.voiceVadEnabledDescription});if(bad.length){console.error('missing:',bad);process.exit(1)}console.log('ok')"` 输出 `ok`、exit 0。
- [x] `wc -l src/modules/chat-voice/hooks/useVoiceInput.ts` 输出 ≤ 1609；`npx tsx --tsconfig server/tsconfig.json --import ./scripts/undici-blocked-ports-preload.mjs --test server/shared/tests/architecture-ratchet.test.ts` exit 0（oversize / moduleMutableState 不越线；若做了 RECORDED CHANGE，须在基线 note 中写明 dated 旧→新与理由）。
- [x] `npm run typecheck` exit 0；`npm run lint` exit 0。
- [x] `npx playwright test e2e/voice-vad-user-setting.spec.ts` exit 0：真实 Chromium + fake mic，菜单关闭 → 录音 → 请求数/字节读数符合“不切段、不裁边、按 60 s 分片”；刷新后开关仍为关；设置页与菜单显示同一状态；打开后恢复既有 VAD 段数行为。

## DoD

真实落地判据（不是“测试存在”）：

1. 在**隔离实例**（独立 `DATABASE_PATH`、独立端口，不用 :3001）上启动真实前端 + 后端；用 MCP 浏览器实际操作一遍。
2. 打开一个真实会话页 → 右上角 `...` → 「输入设置」→ 关闭「语音活动检测（VAD）」；截图存 `tmp/voice-vad-menu-off.png` 并贴出。再打开 Settings → Voice → 输入 tab，确认同一开关为关，截图 `tmp/voice-vad-settings-off.png`；刷新页面后两处仍为关（`auth.db` 恢复）。
3. 用 fake mic 录一段“说话 2 s + 静音 12 s + 说话 2 s + 尾部静音 3 s”，在关闭态下从服务端/STT 桩读出：请求数、每个上传 WAV 的时长/字节、拼接时长与原始缓冲一致，且**没有任何 VAD 段边界**；贴出原始读数。再打开开关录同样的样本，贴出 VAD 段数/请求数作为对照。
4. 长录音上限：用 125 s 合成 PCM 走分片器单元判据贴出 2 片/每片 ≤60 s 的读数；如果能在真实页面录满 >60 s，再补一条真实请求读数；不能就如实写“真实 >60 s 未测，判据为单元读数”。
5. 取假形态（至少两条，必须真实变红后才通过）：(a) 菜单开关只写内存/localStorage → 刷新后状态丢失（红在持久化判据）；(b) 关闭态仍调用 `trimSilenceEdges` 或 VAD 切段 → 拼接时长 < 输入或请求数不等（红在分片/不裁边判据）；(c) 关闭态仍把 >60 s 作为单请求 → 红在上限判据。
6. 报告落地 commit sha，以及运行实例是否已重新构建/重启加载这份代码（没加载就如实写“代码已合入 develop，运行进程仍是旧代码”）。UI 验证按 AGENTS.md：MCP 浏览器实际操作 + 截图；若存在可用场景则同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴 JSON 报告，没有就如实写明。

## Evidence

- 落地 commit：`ca8d28d32`（task 分支 `task/gap-voice-vad-user-toggle-and-cap-split`）；e2e 的 WebServer 由 `playwright.config.ts` 从**本 worktree 树**启动（日志 `config-root=…/gap-voice-vad-user-toggle-and-cap-split`，`server=14453 client=29433`，独立 `QUAY_E2E_DATA_DIR`），即真实运行的是这份代码。
- AC 逐条读数：uiPreferences 10 passed；workspaceMenuVoiceVad 2 passed；voiceVadSettingSurface 2 passed；voiceLiveSegmenter 29 passed（含新增 segmentCapped 用例）；voiceVadPreference 6 passed（正控制 + 关闭态 19 s 整段 + 125 s 60/60/5 + 三条优先级 + 文件入口）；i18n `ok`；`wc -l` = 1602（≤1609）；architecture-ratchet 6 passed；typecheck/lint exit 0；e2e 2 passed。
- DoD-2（真实页面 + 截图）：`tmp/voice-vad-menu-off.png`（会话页 `...` → 输入设置，VAD 行未勾选）与 `tmp/voice-vad-settings-off.png`（Settings → Voice → Voice Input，同一开关关闭）由 e2e 在**真实 Chromium**上截取；spec 内先关闭 → 整页 reload → 再开菜单与设置页，两处仍为 off（`auth.db` 持久化读数）。⛔ 本 worker 会话没有 MCP 浏览器工具（ToolSearch 无 browser/playwright MCP），故用 Playwright 真实浏览器完成同一操作与截图，未使用 MCP 浏览器；这是工具可得性差异，不是跳过验证。
- DoD-3（fake mic 原始读数，来自 e2e 日志与请求体 WAV 声明长度）：
  - 关闭态：`requests=1 uploadSec=19.00`（同一段 2+12+2+3 s 一次请求上传，无 VAD 边界、无首尾裁剪）。
  - 打开态：`requests=2 segmentSec=2.00,2.00`（既有 VAD flush + stop flush 行为）。
- DoD-4（长录音上限）：单元判据读数 125 s → `[60, 60, 5]` 片、每片 ≤60 s、拼接样本数 == 输入；真实页面 >60 s 未录（如实记录：判据为单元读数）。
- DoD-5（假形态，均真实变红后恢复）：
  - (a) 把 `UiPreferencesContext` 的持久化写入改成 no-op（只在内存）→ workspaceMenuVoiceVad + voiceVadSettingSurface 共 3 条断言红（“the click must reach the stored preference” / “the change must reach the stored blob”）。
  - (b) 关闭态仍调用 `trimSegmentEdges` → voiceVadPreference 3 条红（19 s 整段、125 s 分片、文件入口）。
  - (c) `segmentCapped` 忽略 60 s 上限 → 单元判据红（`61s must split into 2 pieces`）。
- DoD-6：`node scripts/ui-scenario.mjs` 可用，但 `ui-scenarios/` 下无语音相关场景（仅 cockpit-cards-*、cockpit-mode-switch、quay-wall-focus-pin-utter），故如实记录“无可用语音场景”。

## Touches

- src/shared/settings/uiPreferences.ts
- src/shared/tests/uiPreferences.test.ts
- src/modules/project-workspace/WorkspaceMenu.tsx
- src/modules/project-workspace/index.ts
- src/modules/project-workspace/tests/workspaceMenuVoiceVad.test.tsx (new)
- src/modules/settings/tabs/VoiceSettingsTab.tsx
- src/modules/settings/tests/voiceVadSettingSurface.test.tsx (new)
- src/modules/chat-voice/hooks/useVoiceInput.ts
- src/modules/chat-voice/index.ts
- src/modules/chat-voice/utils/voice/voiceLiveSegmenter.ts
- src/modules/chat/utils/tests/voiceLiveSegmenter.test.ts
- src/modules/chat/tests/voiceVadPreference.test.tsx (new)
- src/modules/chat/tests/activityIndicatorResponsive.test.tsx
- src/modules/chat/tests/chatInterfaceEscapeAbort.test.tsx
- src/modules/chat/tests/composerModelProviderOption.test.tsx
- src/modules/chat/tests/escapeAbortGuard.test.tsx
- src/modules/chat/tests/forkFromAssistantReply.test.tsx
- src/modules/chat/tests/liveVoiceMicPrewarmEntry.test.tsx
- src/modules/chat/tests/liveVoiceNewSessionEntry.test.tsx
- src/modules/chat/tests/replyItemReferences.test.tsx
- src/modules/chat/tests/voiceClipPlayback.test.tsx
- src/modules/chat/tests/voiceEntryNewSessionSelection.test.tsx
- src/modules/chat/tests/voiceErrorMessages.test.tsx
- src/modules/chat/tests/voiceErrorNoticePersistence.test.tsx
- src/modules/chat/tests/voiceModePermissionBanner.test.tsx
- src/modules/chat/tests/voiceRawCaptureUpload.test.tsx
- src/modules/chat/tests/voiceTransientRefusalRetry.test.tsx
- src/modules/chat/voice-realtime/tests/voiceStopVsExit.test.tsx
- src/modules/cockpit/tests/CockpitPushToTalk.test.tsx
- src/modules/cockpit/tests/CockpitRemote.test.tsx
- src/shared/tests/voiceUpload16k.test.ts
- src/modules/chat-composer/composer/ChatComposer.tsx
- src/modules/cockpit/CockpitRemote.tsx
- src/shared/voice/voiceDebug.ts
- src/modules/i18n/locales/de/settings.json
- src/modules/i18n/locales/en/settings.json
- src/modules/i18n/locales/es/settings.json
- src/modules/i18n/locales/fr/settings.json
- src/modules/i18n/locales/id/settings.json
- src/modules/i18n/locales/it/settings.json
- src/modules/i18n/locales/ja/settings.json
- src/modules/i18n/locales/ko/settings.json
- src/modules/i18n/locales/ru/settings.json
- src/modules/i18n/locales/tr/settings.json
- src/modules/i18n/locales/zh-CN/settings.json
- src/modules/i18n/locales/zh-TW/settings.json
- e2e/voice-vad-user-setting.spec.ts (new)
- tasks/gap-voice-vad-user-toggle-and-cap-split.md