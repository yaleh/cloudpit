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

- [ ] 对 transcript 内有效选区，真实 DOM 渲染一个可访问、固定宽度的浮动操作按钮；在中英文文案和不同长度选区下读取其矩形宽度均相同，锚定选区附近且不超出视口。
- [ ] 选区建立、更新和清除时，非空与空草稿的 composer/textarea 高度均不因选区自动显示引用控件而变化；浏览器测试读取选前/选后高度相等，且选区之外、折叠选区、锚点卸载均不留下按钮。
- [ ] transcript 滚动及窗口 resize 后，按钮仍锚定当前选区或按不可见规则隐藏；按钮的 pointer/mouse 按下不折叠原选区，点击恰好调用 quoted 接受入口一次、把文本插入草稿并聚焦 caret，且不触发 submit。
- [ ] `npx vitest run src/modules/chat/tests/transcriptSelectionAction.test.tsx src/modules/chat/tests/useTranscriptSelection.test.tsx src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出码为 0；断言覆盖定位更新、失效隐藏、固定宽度、保留选区、接受一次和不发送，并覆盖原自动内联 chip 不再因单纯选区出现。
- [ ] `npm run typecheck` 与 `npm run lint` 均退出码为 0；`git diff --check` 退出码为 0，且 Touches 外无本任务源码或测试改动。

## DoD

在本地真实运行页面上用 MCP 浏览器完成 transcript 拖选、保持选区、滚动/resize、点击浮动按钮和确认输入框填入但未发送的完整交互；截图存入 `tmp/transcript-selection-floating-action/`，任务落地记录贴出截图路径及关键 DOM/高度读数。桌面与窄屏各验证一次，确认选区期间 composer 高度稳定、按钮位置可见且不遮住选中文字。

若仓库存在适用于 transcript 选区/引用操作的场景，同时运行 `node scripts/ui-scenario.mjs <scenario.json>`，记录 JSON 报告与检查点截图路径；若无适用场景，记录检查过的场景目录及无适用项的理由。最终由真实页面通过该按钮把选中文本操作进 composer，符合 UI 验证和真实落地要求。

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
- `tasks/gap-transcript-selection-floating-quote-action.md`