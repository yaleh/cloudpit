---
id: gap-composer-suggest-highlight-on-selection
title: 输入框 Suggest 按钮在选中 transcript 文字后高亮：宽屏文案+ring、紧凑 ring+圆点
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

选中 transcript 文字后，输入框底栏的「建议」按钮目前仍是灰色虚线（muted），用户看不出这一批重抽会以选中的那段作为 `focus`。本次只加一个**可点击的 affordance**，不改点击/重抽/填入/发送语义。

已确认的效果（mockup 只在作者主 checkout 的 `tmp/suggest-highlight/07-recommended-wide-composer.png` 与 `10-compact-ring-dot.png`，gitignored；类名与行为以本正文为准）：

- 宽屏（非 `isCompactTier`）：按钮文案改为「用选段生成建议」（英文 `Suggest from selection`），class 追加 `ring-2 ring-primary/60 border-primary text-foreground`。
- 紧凑档（`isCompactTier`）：图标按钮保持 32px 方形；同一套 ring；右上角加一个装饰圆点 `absolute -right-0.5 -top-0.5 block h-2 w-2 rounded-full bg-primary`（按钮需要 `relative`，圆点 `aria-hidden`）。不改变按钮宽度、不换行。
- 触发条件：存在 transcript 选区（与「引用」chip 同源的 `trimmedQuotedSelection`）且输入框为空、`suggestionsEnabled` 为真、且不在 loading/failed。选区消失、开始打字、进入 loading/failed 时移除高亮；loading 的 spinner 与 failed 的红色语义优先。
- 高亮状态用 `data-reply-suggest-highlighted="true"` 发布；紧凑档圆点用 `data-slot="reply-suggest-dot"` 发布，供测试/场景读取。
- 无障碍：高亮时按钮的 `aria-label` 与 tooltip 使用新文案；圆点 `aria-hidden="true"`。
- 点击行为不变：仍走 `chipStrip.onRequestSuggestions`，服务端仍收到 `focus`；不改 `useReplySuggestions`、不改服务端。

数据流：`useSuggestionChips` 已有 `trimmedQuotedSelection`；在 `ComposerChipStrip`（`src/shared/types.ts`）上加 `hasTranscriptSelection: boolean`，由 `useSuggestionChips` 写入；`ChatComposer` 读它 + `input === ''` + `suggestionsEnabled` 计算高亮。无服务端改动。

同一区域已有任务（已 done）：`gap-reply-suggestions-composer-chips-button-selection`（模型 chip、建议按钮重抽、引用 chip）。本任务只加高亮 affordance，不改它的行为。

范围外：选中后自动生成建议（另行讨论）、服务端、快捷键、移动端手势。

## AC

- [x] AC1: `npx vitest run src/modules/chat/tests/chatComposerSuggestHighlight.test.tsx` exit 0；用例 (a) 宽屏 + 有选区 + 空输入 + enabled + idle：`[data-slot="reply-suggest-button"]` 带 `data-reply-suggest-highlighted="true"`，文案等于 `input.suggestions.suggestForSelection`（zh「用选段生成建议」/en「Suggest from selection」），class 含 `ring-2` 与 `border-primary`，点击调用 `onRequestSuggestions` 恰好一次；(b) 无选区：无该属性、文案回到 `Suggest`、无 ring；(c) 有选区但输入框非空：无高亮（引用 chip 仍可按现有规则存在，但按钮不高亮）；(d) loading：`data-reply-suggest-state="loading"`、无高亮、有 spinner；failed：state=failed、红色语义、无高亮；(e) 紧凑档（沿用 `composerCompactTier.test.tsx` 的 `window.matchMedia` 模式）：高亮属性存在、`[data-slot="reply-suggest-dot"]` 存在、`aria-label` 等于新文案；无选区时三者都不在。
- [x] AC2: 同一测试文件的 locale 用例：读取 `src/modules/i18n/locales/*/chat.json`，`input.suggestions.suggestForSelection` 在 12 种语言中均为非空字符串（缺一语言即红），`npx vitest run src/modules/chat/tests/chatComposerSuggestHighlight.test.tsx` exit 0；zh-CN 为「用选段生成建议」，en 为 `Suggest from selection`。
- [x] AC3: 回归：`npx vitest run src/modules/chat/tests/useReplySuggestions.test.tsx src/modules/chat/tests/chatComposerReplyChips.test.tsx` exit 0——焦点/重抽/点选/填入/发送路径不变；`git diff --stat` 只出现 ## Touches 里声明的文件。
- [x] AC4: 静态门：`npm run typecheck` exit 0；`npx oxlint src/modules/chat/composer/ChatComposer.tsx src/modules/chat/hooks/useSuggestionChips.ts src/shared/types.ts src/modules/chat/tests/chatComposerSuggestHighlight.test.tsx` exit 0。

## DoD

- [x] 真实页面（隔离实例：复制库 + `residentRestore` 关闭，不碰常驻 :3001）：在 transcript 里选中一段 → 宽屏截图显示 ring + 「用选段生成建议」；390px 截图显示 ring + 圆点；用 `browser_evaluate` 读回 `data-reply-suggest-highlighted="true"`、按钮文案/aria-label、圆点存在。截图存 `tmp/` 并在任务里贴出。
  - 证据：`scripts/isolated-instance.sh start`（port 8243，复制库，`residentRestore.enabled=false`，scope sweep off，日志 `resident-restore started=0`）。会话 `04a20554`（claudecodeui 项目），本机无 MCP 浏览器，用一次性 Playwright 脚本在最后一条 `[data-message-style="assistant"]` 行内建 Range 选中 `gap-composer-suggest`。
  - 宽屏 1280：`data-reply-suggest-highlighted="true"`，文案与 aria-label 均为 `Suggest from selection`，class token 含 `ring-2` 与 `border-primary`（按空白切分比对，`hover:border-primary/60` 不算），引用 chip 存在。截图 `tmp/suggest-highlight/wide-light.png`。
  - 390px：`data-reply-suggest-highlighted="true"`，aria-label `Suggest from selection`，`[data-slot="reply-suggest-dot"]` 存在且 `aria-hidden="true"`，按钮 class token 含 `relative`/`ring-2`。截图 `tmp/suggest-highlight/compact-light.png`。
- [x] 取消选区 → 属性/ring/圆点/文案全部消失；输入一个字符 → 同样消失（引用 chip 是否仍在按现有规则，不属本任务）；点击按钮 → 进入 loading，随后整批 chip 按现有路径替换；各贴读数/截图。
  - 证据：`removeAllRanges()` 后 highlighted=null、aria-label=`Suggest`、class token 无 `ring-2`/`border-primary`、dot=false、引用 chip 消失（`tmp/suggest-highlight/wide-after-deselect.png`）。聚焦 textarea 键入 `x` 后 input=`x`、highlighted=null、ring=false、dot=false（`wide-after-typing.png`）。点击高亮按钮：观测到 `data-reply-suggest-state="loading"`，随后 state=idle 且 model chip 批次替换为新的 3 条（`wide-after-click.png`）；`pageerror` 0 条。
- [x] 亮/暗两套主题各一张宽屏截图（拷贝库 `user_preferences.theme` 切换）。
  - 证据：`tmp/suggest-highlight/wide-light.png` 与 `tmp/suggest-highlight/wide-dark.png`（DB 切 `theme` 后 reload；两张都读回 highlighted=true、ring token 存在、文案 `Suggest from selection`）。
- [x] 场景运行器：`scripts/ui-scenario.mjs` 若无覆盖“选中 transcript → 输入框按钮态”的场景，注明查过的目录与原因，并用一次性 Playwright spec 完成上面两条；有则贴 JSON 报告与检查点截图。
  - 证据：查过 `e2e/scenarios/`（只有 `cockpit-mode-switch.json`、`quay-wall-focus-pin-utter.json`）与 `src/modules/ui-scenario/scenarioSurface.ts` 的 drive 词表（focus/move/pin/utter 等 Quay 面板动作）——没有 transcript 选区或 composer 按钮态的 opener/drive/reading，故按本条 fallback 用一次性 Playwright 脚本 `tmp/suggest-highlight/verify.mjs` 完成上面三条；结构化读数与截图清单见 `tmp/suggest-highlight/report.json`。
- [x] `npm run typecheck`、被改文件的 `npx oxlint`、AC1/AC3 的测试；不跑全套。
  - 证据：`npm run typecheck` exit 0；`npx oxlint`（ChatComposer.tsx / useSuggestionChips.ts / shared/types.ts / 新测试）exit 0（仅输出既有 warning）；`chatComposerSuggestHighlight.test.tsx` 7 passed；`useReplySuggestions.test.tsx` + `chatComposerReplyChips.test.tsx` 59 passed。

## Touches

- src/modules/chat/composer/ChatComposer.tsx
- src/modules/chat/hooks/useSuggestionChips.ts
- src/shared/types.ts
- src/modules/chat/tests/chatComposerSuggestHighlight.test.tsx
- src/modules/chat/tests/inlineQuoteChip.test.tsx
- src/modules/i18n/locales/*/chat.json
- tasks/gap-composer-suggest-highlight-on-selection.md

## Needs-Human

**执行 2026-10-25T20:45:04.362Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 0
- run_id：wk-prod-anchor
- session_id：2d7397b8-d72e-40d0-be0b-2f62dce8562b
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-composer-suggest-highlight-on-selection~wk-prod-anchor~1792960093954-18ebd5.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-composer-suggest-highlight-on-selection-wk-prod-anchor.log

## Blocker

**2026-10-25T22:48:16.276Z — worker 未落地（exited-not-landed）**

- 未落地原因：step=suite: # fail 1
- run_id：wk-prod-anchor
- session_id：526d0c43-ee74-4da6-afc7-738a81222dea

## Needs-Human

**执行 2026-10-25T22:48:16.898Z — 停派终止（失败无法归因，⛔ 不再重派）**

- 阻碍原因：exited-not-landed 失败无法归因（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 3 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (parser extracted 0 of 0 failing lines and attributed none to a file); stopping instead of spending another worker session
- 失败步/判词：step=suite: # fail 1
- run_id：wk-prod-anchor
- session_id：526d0c43-ee74-4da6-afc7-738a81222dea
- suite 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-suite-gap-composer-suggest-highlight-on-selection~wk-prod-anchor~1792967680662-117d55.log
- fan-in 日志：/data/home/yale/work/claudecodeui/.quay/fan-in-gap-composer-suggest-highlight-on-selection-wk-prod-anchor.log
