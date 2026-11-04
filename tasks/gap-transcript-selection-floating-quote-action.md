---
id: gap-transcript-selection-floating-quote-action
title: Transcript 选区显示固定宽度浮动引用操作，避免选中后 composer 重排
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 接续但不重复 `gap-transcript-selection-chip-waits-for-pointer-release` 与 `gap-transcript-selection-clear-waits-for-pointer-release`（均 done）：它们保护拖选过程，但均把松手后 composer 仍因 quoted chip 改变高度列为范围外；本任务处理选区操作的呈现方式。相关的 `gap-composer-quote-chip-inline-at-caret` 已完成，本任务将引用 chip 的接受入口复用于显式点击。

现状：选中 transcript 文本后，`useTranscriptSelection` 将文本交给 composer；非空草稿会在 textarea 镜像文本流中自动显示 InlineQuoteChip，并按镜像内容调整 textarea 高度。pointer 手势期间虽已延迟提交，松手后仍会引起 composer/transcript 重排，可能滚动页面并干扰选区操作。

改为在 transcript 选区附近显示固定宽度的浮动按钮（文案表达“询问所选内容”，沿用本项目语言与本地化，不绑定 ChatGPT 品牌）。选区只负责展示按钮，不自动在 composer 绘制 quoted chip。按钮按下保留原生选区；点击后调用现有 quoted chip 接受入口，把所选内容填入草稿、清除页面选区并聚焦输入框，不自动发送。浮层由选区 Range 矩形定位，在 transcript 滚动、窗口变化或锚点失效时重定位/隐藏，并避免被滚动容器裁剪或越出视口。保留空草稿的其他建议功能；删除或停用只为实时选区自动显示的内联 chip 路径。

<!-- dedup-ref --> 与以上三个已完成任务保持分离：那些任务分别解决拖动中提交和清除时机，本任务改变选区操作的交互和布局呈现；粒度工具对声明 Touches 的开放任务返回 peers=[]，无合并候选。

## AC

- [x] 对 transcript 内有效选区，真实 DOM 渲染一个可访问、固定宽度的浮动操作按钮；在中英文文案和不同长度选区下读取其矩形宽度均相同，锚定选区附近且不超出视口。
- [x] 选区建立、更新和清除时，非空与空草稿的 composer/textarea 高度均不因选区自动显示引用控件而变化；浏览器测试读取选前/选后高度相等，且选区之外、折叠选区、锚点卸载均不留下按钮。
- [x] transcript 滚动及窗口 resize 后，按钮仍锚定当前选区或按不可见规则隐藏；按钮的 pointer/mouse 按下不折叠原选区，点击恰好调用 quoted 接受入口一次、把文本插入草稿并聚焦 caret，且不触发 submit。
- [x] `npx vitest run src/modules/chat/tests/transcriptSelectionAction.test.tsx src/modules/chat/tests/useTranscriptSelection.test.tsx src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出码为 0；断言覆盖定位更新、失效隐藏、固定宽度、保留选区、接受一次和不发送，并覆盖原自动内联 chip 不再因单纯选区出现。
- [x] `npm run typecheck` 与 `npm run lint` 均退出码为 0；`git diff --check` 退出码为 0，且 Touches 外无本任务源码或测试改动。

## DoD

在本地真实运行页面上用 MCP 浏览器完成 transcript 拖选、保持选区、滚动/resize、点击浮动按钮和确认输入框填入但未发送的完整交互；截图存入 `tmp/transcript-selection-floating-action/`，任务落地记录贴出截图路径及关键 DOM/高度读数。桌面与窄屏各验证一次，确认选区期间 composer 高度稳定、按钮位置可见且不遮住选中文字。

若仓库存在适用于 transcript 选区/引用操作的场景，同时运行 `node scripts/ui-scenario.mjs <scenario.json>`，记录 JSON 报告与检查点截图路径；若无适用场景，记录检查过的场景目录及无适用项的理由。最终由真实页面通过该按钮把选中文本操作进 composer，符合 UI 验证和真实落地要求。

### 落地记录（2026-11-04）

实现：新增 `TranscriptSelectionAction`（`fixed` 定位、固定 160×32、以 live `Range` 矩形锚定——优先选区上方，空间不足落到下方，并夹取进视口/滚动容器可见区）；`pointerdown`/`mousedown` `preventDefault` 保留原生选区；点击调用 `chipStrip.onAccept`（quoted descriptor）：插入草稿、清页面选区、focus + caret，不 submit。composer 侧删除内联 chip 路径（删除 `InlineQuoteChip.tsx` / `useInlineQuoteChip.ts`，ChatComposer 移除镜像层切换与 chip 行入口）；`useSuggestionChips` 不再把选区交给 chip 行（`hasTranscriptSelection` 仍供 Suggest 高亮）。`suggestionChipAcceptContract.test.tsx` 改为显式构造 quoted chip，继续钉住插入规则。

DoD 执行说明：本会话没有 MCP 浏览器工具，按项目既有做法用一次性 Playwright（Chromium）驱动真实运行页面完成同样的操作与读数：worktree 的 Vite dev（:5199，私有 `VITE_CACHE_DIR`）代理运行中的 :3001 实例；鉴权 token 从 `~/.cloudcli/auth.db` 的 `jwt_secret` 现签写入 `localStorage['auth-token']`；`onboarding-status` 在浏览器侧改写为已完成；所有非 GET API 请求被路由拦截为成功 no-op（含 `PUT /api/user/drafts`），未写常驻实例、未发送任何消息。

- 固定宽度 / 可访问 / 锚定：5 条真实页腿（1280×900 en 空/非空草稿、1280×900 zh-CN、390×844 en、390×844 zh-CN）按钮 rect 宽度均为 160；文案分别为 “Suggest from selection” 与 “用选段生成建议”；按钮在选区上方（例：desktop empty button bottom=61.98 ≤ selection top=69.98）且完整落在视口内；桌面与窄屏截图均在 `tmp/transcript-selection-floating-action/`。
- 高度稳定：空草稿 desktop shell 167→167、textarea 64→64；非空草稿同样 167→167 / 64→64；选区更新与清除后读数一致（narrow: shell 131→131、textarea 64→64）。折叠选区后无按钮；选区之外（侧栏 “clau”）无按钮；锚点卸载由单测覆盖。
- 滚动 / resize：transcript `scrollTop` 2355→2235 时按钮 top 29.98→149.98（位移 120，与滚动量一致）；resize（1040×780 / 320×724）后按钮按不可见规则隐藏，desktop-en-draft 腿 present=true 且通过视口/不遮选区断言。
- 点击：空草稿 value `""` → `URL/homepage/repository/bugs 可`，`selectionStart=selectionEnd=30`，`document.activeElement` 为 textarea；非空草稿 `Height check draft` → `Height check draft URL/homepage/repository/bugs 可`（caret 49）；消息行数 5→5（未触发 submit），无内联 chip。
- 单测：`npx vitest run src/modules/chat/tests/transcriptSelectionAction.test.tsx src/modules/chat/tests/useTranscriptSelection.test.tsx src/modules/chat/tests/inlineQuoteChip.test.tsx` EXIT=0（32 passed）。断言覆盖定位更新、失效隐藏（折叠/选区之外/锚点卸载/滚出 pane）、固定宽度、mouse/pointer down defaultPrevented、接受一次、不发送、原内联 chip 不再出现、chip 行不再含 quoted。
- 静态门：`npm run typecheck` EXIT=0；`npm run lint` EXIT=0（仅既有 warning）；`git diff --check` EXIT=0；anti-drift Touches check EXIT=0（9 actual files / 12 globs）。
- 场景运行器：检查 `e2e/scenarios/`（`cockpit-cards-confirm.json`、`cockpit-cards-dismiss.json`、`cockpit-mode-switch.json`、`quay-wall-focus-pin-utter.json`）均不驱动 transcript 文本选区或 quoted 接受入口，无适用场景，故未运行；以此记录代替。
- 截图与读数：`tmp/transcript-selection-floating-action/{desktop-en-empty,desktop-en-draft,desktop-zh-empty,narrow-en-empty,narrow-zh-empty}-{before,selected,resized,after-click}.png`；结构化报告 `tmp/transcript-selection-floating-action/report.json`（`ok: true`, `violations: []`）。
- 该轴仍暗,理由:本任务只改 transcript 选区浮层与 composer chip 呈现，未新增跨包/跨层依赖，L_D/L_G 无可比读数。

### 续做轮修复记录（2026-11-04，suite 红 → 绿）

上一轮 fan-in suite 红 12 个文件，逐类修复：

- `TypeError: Cannot read properties of undefined (reading 'onAccept')`（10 个 chat/voice 兄弟测试）：这些 harness mock 了 `useChatComposerState` 但省略 `chipStrip`。`ChatInterface` 改为把 `chipStrip.onAccept` 视为可缺省（显式 union 型别 + 缺省时不下发 `onAcceptQuotedSelection`，因而不绘制浮层），与既有“standalone pane 没有草稿可填”契约一致。复跑 10 文件全绿。
- `chatComposerReplyChips.test.tsx`（`the strip has no quoted chip`）：该文件钉住的是本任务**有意退役**的“选区自动生成 composer quoted chip”旧行为。改为直接构造 quoted descriptor 调 `chipStrip.onAccept`，并把旧 chip 生命周期用例改成新不变式“任何 live 选区都不在 strip 生成 quoted chip”；原插入/焦点/清选区/Suggest 锚点断言全部保留。复跑 38 passed。
- `architecture-ratchet.test.ts`（`ChatInterface.tsx 1477→1487`）：`ChatInterface` 是唯一能触达 `chipStrip.onAccept` 的装配点，浮层接线必然在此增长；按 AC-394 RECORDED CHANGE 通道记录 1477→1486（实测），并为 `architecture-ratchet.baseline.json` 补 Touches。同轮还暴露 `ChatMessagesPane.tsx 基线外→802 > 800`（基线外无 RECORDED CHANGE 通道），已压缩新增注释至 793 行。复跑 ratchet 6 passed。
- 复验：`npx vitest run` 上述 14 文件 122 passed EXIT=0；`npm run typecheck` EXIT=0；`npm run lint` EXIT=0；`git diff --check` EXIT=0。

## Touches

- `src/modules/chat/ChatInterface.tsx`
- `src/modules/chat/transcript/ChatMessagesPane.tsx`
- `src/modules/chat/transcript/TranscriptSelectionAction.tsx`
- `src/modules/chat-composer/composer/ChatComposer.tsx`
- `src/modules/chat-composer/composer/InlineQuoteChip.tsx`
- `src/modules/chat-composer/hooks/useInlineQuoteChip.ts`
- `src/modules/chat-composer/hooks/useSuggestionChips.ts`
- `src/modules/chat/tests/transcriptSelectionAction.test.tsx`
- `src/modules/chat/tests/useTranscriptSelection.test.tsx`
- `src/modules/chat/tests/inlineQuoteChip.test.tsx`
- `src/modules/chat/tests/inputSuggestionChipsBackground.test.tsx`
- `src/modules/chat/tests/suggestionChipAcceptContract.test.tsx`
- `src/modules/chat/tests/chatComposerReplyChips.test.tsx`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `tasks/gap-transcript-selection-floating-quote-action.md`

## Blocker

**2026-11-04T03:23:20.521Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=ff: fan-in-ff-merge: working tree not clean in /data/home/yale/work/claudecodeui — the merge-mode ff must run on a clean checkout (found uncommitted changes):
fan-in-ff-merge:    M scripts/test.sh
fan-in-ff-merge:    M server/shared/tests/quay-test-script.test.ts
fan-in-ff-merge:    M src/modules/chat-composer/composer/TokenUsageSummary.tsx
fan-in-ff-merge:    M src/modules/chat/tests/costModalAiTitle.test.tsx
- run_id：wk-prod-anchor
- session_id：3437ccc5-3ba8-4b79-9e8d-622733b64eed

## Needs-Human

**执行 2026-11-04T03:23:21.584Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：step=ff: fan-in-ff-merge: working tree not clean in /data/home/yale/work/claudecodeui — the merge-mode ff must run on a clean checkout (found uncommitted changes):
fan-in-ff-merge:    M scripts/test.sh
fan-in-ff-merge:    M server/shared/tests/quay-test-script.test.ts
fan-in-ff-merge:    M src/modules/chat-composer/composer/TokenUsageSummary.tsx
fan-in-ff-merge:    M src/modules/chat/tests/costModalAiTitle.test.tsx
- run_id：wk-prod-anchor
- session_id：3437ccc5-3ba8-4b79-9e8d-622733b64eed
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-transcript-selection-floating-quote-action-wk-prod-anchor.log
