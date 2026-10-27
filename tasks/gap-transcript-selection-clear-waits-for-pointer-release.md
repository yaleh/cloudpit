---
id: gap-transcript-selection-clear-waits-for-pointer-release
title: Transcript 选区：指针按下期间也不清除旧的 quoted chip，松手后再一次性读取（避免 mousedown 折叠旧选区导致
  chip 消失、高度抖动）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 接续 `gap-transcript-selection-chip-waits-for-pointer-release`（done，提交 `4e0ddda9f`）：那一版让「手势中」不 commit **非空**选区，本任务补上它漏掉的另一半——「手势中」也不 commit **清除**。kept separate：那个任务已 done，且本任务要**反转**它的一条行为断言（见下），不能当作它的续做 AC 合并。无 Touches 重叠的 open 任务（`task-granularity-advice` peers 为空）。

现状（用户 2026-10-27 报告，同日隔离实例实测复现，空输入框 + 真实鼠标）：已有一段选区且 quoted chip 在 chip 条里时，在 transcript 别处按下鼠标，浏览器的 `mousedown` 会先把旧选区折叠，`selectionchange` 触发；`useTranscriptSelection.ts` 的 `onSelectionChange` 把「折叠/过短/越界」一律当作立即清除（`cancelTimer(); readSelection()` → `commit(null)`）。实测读数：松手后 composer 高 195px（chip 条含两行 quoted chip），mousedown 后 30ms 内选区长度 446→0、chip 消失、composer 降到 145px（−50px），transcript 文字下移 18px——新选区还没开始，鼠标还按着，指针下的文字就被挪了。

做法（只动 `useTranscriptSelection`）：
- 「手势中」（`pointerGestureRef` 为真）时，`selectionchange` 一律不 commit：非空选区沿用现有「不 settle」；**折叠、短于 `MIN_SELECTION_CHARS`、越界的选区也不再立即 `commit(null)`**，只 `cancelTimer()` 后返回。
- 退出「手势中」（`pointerup` / `pointercancel` / `window blur`）时已有的 `endPointerGesture` 立即 `readSelection()`：读到新的非空 transcript 选区 → chip 文字原位换成新内容；读到折叠/过短/越界 → 此时才 `commit(null)`（点一下取消选择的情形，chip 在松手后消失）。
- 不在手势中（键盘、`Ctrl+A`、程序化改选区）的路径保持现有行为：折叠/越界选区立即清，非空选区 200ms 防抖。
- 取舍（已与用户确认可接受）：拖选过程中 chip 显示的是旧选区的文字，直到松手才更新；松手后若新选区使 chip 条高度变化，仍有一次松手后的布局变化，那属于另一个设计问题（quoted chip 占两行），**本任务不做**。
- **明确不做**：不改 quoted chip 的形态/高度、不改 composer 布局、不暂停贴底或补偿 `scrollTop`（用户已否决）、不动 `ChatInterface` / `ChatComposer` / `useInlineQuoteChip` / `InputSuggestionChips`。

反转旧断言：`src/modules/chat/tests/useTranscriptSelection.test.tsx` 现有一例 `clears a collapsed selection at once mid-gesture, and never flushes it on release` 断言的正是被本任务推翻的行为，必须改写为新行为，并在提交说明里逐条列出这一处改写；其余既有 `expect` 不得删减或放宽。

## AC

- [ ] `npx vitest run src/modules/chat/tests/useTranscriptSelection.test.tsx` exit 0，且新增一例：先建立并 settle 一段非空 transcript 选区（`selectionText` 非空），再在 transcript 内 `pointerdown`，随后选区折叠并派发 `selectionchange`、快进超过 `SELECTION_SETTLE_MS` 的若干倍，`selectionText` **仍为旧文本**（不变为 `null`）；再让选区变成另一段非空 transcript 文本并 `pointerup`，`selectionText` 立即变为新文本。取假：删掉「手势中不清除」的判断，该例必须红。
- [ ] 同一文件新增一例：同上先有旧选区，`pointerdown` 后选区折叠，`pointerup` 时选区仍折叠 → `selectionText` 在 `pointerup` 当下变为 `null`（点一下取消选择）；越界选区（落在 transcript 外）与短于四个字符的选区在 `pointerup` 时同样清除。`pointercancel` 与 `window` 的 `blur` 也能在折叠选区下结束手势并清除。
- [ ] 同一文件里原 `clears a collapsed selection at once mid-gesture, and never flushes it on release` 一例已按新行为改写（不再断言「手势中立即清除」），`git diff -- src/modules/chat/tests/useTranscriptSelection.test.tsx` 中除该例外没有删减或放宽任何 `expect`，且提交说明逐条列出该例的改写。
- [ ] 非手势路径行为不变：不先派发 `pointerdown` 时，折叠选区立即清除、非空选区仍在 `SELECTION_SETTLE_MS` 后才记录（既有 `keeps the ordinary settle window on the keyboard path` 与 `coalesces a burst…` 两例保持绿且未被改动）。
- [ ] `git diff --stat` 显示本任务只改动 `useTranscriptSelection.ts`、它的测试文件与本任务文件，没有改动 `ChatInterface.tsx`、`ChatComposer.tsx`、`useInlineQuoteChip.ts`、`InputSuggestionChips.tsx` 与任何滚动/贴底逻辑；`npx tsc --noEmit -p tsconfig.json` exit 0。

## DoD

真实页面验证（AGENTS.md「UI 验证」）：隔离实例（`scripts/isolated-instance.sh`，用本任务分支构建）里挑一个小 transcript 的真实会话，**输入框保持为空**，用 Playwright / MCP 浏览器的真实鼠标操作并贴出读数与截图（存 `tmp/`）：
(a) 在一段多行助手/用户文字上拖选并松手，chip 出现；记录此刻 `.chat-composer-shell` 高度与某段目标文字的 `getBoundingClientRect().top`；
(b) 在 transcript 别处 `mouse.down`（**不松手、不移动**），30ms / 100ms / 300ms 各采样一次：旧 chip 仍在，`.chat-composer-shell` 高度与目标文字 top 与 (a) 完全一致（修复前：选区长度 446→0、chip 消失、高度 −50px、文字 +18px）；
(c) 保持按住并拖过一段新文字后 `mouse.up`：chip 文字换成新选区、选区文本与 `getSelection().toString()` 一致；
(d) 再在 transcript 空白处单击一次（取消选择）：松手后 chip 消失；
(e) 修复前后各做一次同样的序列做 A/B 对照，贴出两组采样（composer 高度、目标 top、`selection.toString().length`、chip 是否存在）；
(f) 键盘 shift+方向键、`Ctrl+A` 路径行为不变（折叠立即清，非空 200ms 后出 chip）；
(g) 存在可用场景时同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴 JSON 报告。
已知遗留（不在本任务内，写进提交说明）：松手后 quoted chip 出现/消失仍会使 chip 条高度变化约 50px（chip 占两行），另议；触屏拖手柄不产生页面 pointer 事件，不在范围内。

## Touches

- src/modules/chat/hooks/useTranscriptSelection.ts
- src/modules/chat/tests/useTranscriptSelection.test.tsx
- tasks/gap-transcript-selection-clear-waits-for-pointer-release.md
