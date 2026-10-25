---
id: gap-transcript-selection-chip-waits-for-pointer-release
title: Transcript 拖选：指针按住期间不记录选区，松手后再出 quoted chip（避免 chip 撑高输入框把文字顶走）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> 接续 `gap-composer-quote-chip-inline-at-caret`（内联 chip，done）：本任务不改 chip 的形态，只改它「何时出现」。kept separate：无 Touches 重叠的 open 任务（`task-granularity-advice` peers 为空）。

现状（用户 2026-10-26 复现）：在 transcript 里拖选文字，停顿约 200ms 后 `useTranscriptSelection` 记录选区，quoted chip 出现；草稿非空时内联模式（`useInlineQuoteChip`）把 textarea 撑高一行，transcript 容器变矮、贴底的内容整体上移。此时鼠标按键仍按住、位置没动，指针下的文字变了，浏览器按指针重算选区端点，选中的文本就跟着变——选区「被改掉」。根因是「选区存活期间发生了布局变化」，而其中最常见的一条路径是「手势还没结束 chip 就出现」。

做法（只动 `useTranscriptSelection`）：
- 在 `document` 上以 capture 阶段监听 `pointerdown`：目标落在 `rootSelector` 内即进入「手势中」；在 `window` 上监听 `pointerup` / `pointercancel`（以及 `blur`，防丢失 pointerup 后永久卡住）退出「手势中」。
- 「手势中」时，非空 transcript 选区**不进入** debounce、不 commit（chip 不出现）；空/折叠/越界选区仍立即清（沿用现有行为）。
- 退出「手势中」时立即读一次当前选区并 commit（不再额外等 `SELECTION_SETTLE_MS`——手势结束本身就是 settle）。
- 键盘选区（shift+方向键、全选）和没有 pointerdown 的路径保持现有 200ms debounce 不变；触屏拖选手柄不产生页面 pointer 事件，不在本任务范围（见 DoD）。
- **明确不做**：不暂停 transcript 贴底、不补偿 `scrollTop`、不改 composer 高度计算（那会改变正常阅读/选择行为，用户已否决）。松手后 chip 仍可能让输入框长高一行，那是松手后的一次性布局变化，不属于本任务。

## AC

- [x] `npx vitest run src/modules/chat/tests/useTranscriptSelection.test.tsx` exit 0，且新增一例：在 transcript 内派发 `pointerdown`，随后设置非空 transcript 选区并派发 `selectionchange`，快进超过 `SELECTION_SETTLE_MS` 的若干倍，`selectionText` 仍为 `null`；再派发 `pointerup`，`selectionText` 立即变为该选区文本（不需再快进）。取假：删掉「手势中」判断，该例必须红。
- [x] 同一文件新增一例：`pointerdown` 之后选区被清空（折叠）时 `selectionText` 立即回到 `null`，不等松手；以及 `pointercancel` 与 `window` 的 `blur` 都能结束「手势中」并 flush 当前选区。
- [x] 同一文件新增一例：不先派发 `pointerdown`（键盘路径）时，行为与现有一致——`SELECTION_SETTLE_MS` 之后才记录；`pointerdown` 落在 transcript 之外（textarea、侧栏）不进入「手势中」。
- [x] 该文件里已有的 `expect` 没有被删减或放宽（`git diff -- src/modules/chat/tests/useTranscriptSelection.test.tsx` 只允许新增）。
- [x] `git diff --stat` 显示本任务没有改动 `useInlineQuoteChip.ts`、`ChatComposer.tsx`、`ChatInterface.tsx` 与任何滚动/贴底逻辑；`npx tsc --noEmit -p tsconfig.json` exit 0。

## DoD

真实页面验证（AGENTS.md「UI 验证」）：隔离实例（`scripts/isolated-instance.sh`，用本任务分支构建）里挑一个小 transcript 的真实会话，草稿预先输入一行文字（使内联 chip 会撑高输入框），用 Playwright / MCP 浏览器的真实鼠标做拖选并贴出读数与截图（存 `tmp/`）：
(a) `mouse.down` 在一段助手文字上，`mouse.move` 拖过几行后**保持按住**等待 ≥1s：期间 `window.getSelection().toString()` 逐次采样不变，composer 高度不变，transcript 的 `scrollTop` 不变，页面上没有 quoted chip；
(b) `mouse.up` 后 quoted chip 出现，贴出此刻的选区文本，与 (a) 中按住期间的采样文本一致（修复前：按住期间 chip 出现、composer 长高、选区文本漂移）；
(c) 修复前后各做一次同样的操作做 A/B 对照，贴出两组 `selection.toString()` 采样序列；
(d) 键盘 shift+方向键扩选仍在约 200ms 后出 chip；双击选词、三击选段松手后即出 chip；
(e) 存在可用场景时同时跑 `node scripts/ui-scenario.mjs <scenario.json>` 并贴 JSON 报告。
手机触屏长按拖手柄的路径不产生页面 pointer 事件，本任务不处理，作为已知限制写进提交说明；不在 AC 里要求。

## Touches

- src/modules/chat/hooks/useTranscriptSelection.ts
- src/modules/chat/tests/useTranscriptSelection.test.tsx
- tasks/gap-transcript-selection-chip-waits-for-pointer-release.md

## Verification

AC1–AC5：
- `npx vitest run src/modules/chat/tests/useTranscriptSelection.test.tsx` → exit 0，12 passed（7 旧 + 5 新）。取假：把手势判断临时置为 `false`，新增的「按住期间不 commit」例红（3 failed / 9 passed），恢复后绿。
- `npx tsc --noEmit -p tsconfig.json` → exit 0。
- `git diff --stat develop` → 仅 `useTranscriptSelection.ts` 与 its test；测试文件 0 行删除（只新增）；`useInlineQuoteChip.ts` / `ChatComposer.tsx` / `ChatInterface.tsx` 未改。
- anti-drift（develop merge 后）：`ANTI-DRIFT OK … 2 actual file(s), all within declared Touches`，exit 0。

DoD（真实页面，Playwright 一次性 spec：真实后端 + Vite + Chromium，`e2e-transcript-follow` 种子会话；修复前/后各跑一次同一脚本）：
- 草稿用 CJK 标定填满 textarea 两行默认高度（177 字），使内联 chip 必须换到第三行；真实鼠标 `mouse.down` → `mouse.move(24 steps)` → 按住 1.2s 采样 12 次 → `mouse.up`。
- 修复后（after）held：chip 0/12；composerH `[191]`；textareaH `[88]`；scrollTop `[4000]`；`selection.toString()` 采样序列唯一（734 字符，12 次全同）。release 后：chip 出现，selection 734 字符（与按住期间一致），composer 长高一行（215/112）——松手后的一次性变化。
- 修复前（before）held：chip 10/12（第 3 个采样≈200ms 起出现）；composerH `[191, 215]`、textareaH `[88, 112]`（长高一行）；scrollTop `[3933, 3957]`（贴底内容上移）；`selection.toString()` 有 2 种（734 → 745 字符）——选区文本漂移，缺陷复现。
- (d) 键盘路径两臂均：立即无 chip，~400ms 后有 chip（headless Chromium 无法用真实 shift+方向键扩展静态文本选区，探针在本机确认；改用浏览器自身的 `Selection.modify('extend', …)`，同样是「无 pointerdown 的 selectionchange」路径）。双击选词、三击选段：两臂 released 后均有 chip。
- 截图：`tmp/transcript-selection-chip-dod/{after,before}-{held,released}.png`；读数：`tmp/transcript-selection-chip-dod/{after,before}.json`（工作树 tmp/，gitignored）。
- (e) 场景运行器：仓内 `e2e/scenarios/` 只有 cockpit 两个场景，与本任务无关，故无可用场景可跑。
- 已知限制：触屏长按拖选手柄不产生页面 pointer 事件，本任务不处理（见提交说明）。
