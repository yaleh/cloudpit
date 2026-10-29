---
id: gap-cockpit-phone-cockpit-overlay
title: 手机驾驶舱改为覆盖在会话上的层：打开不卸载会话、关闭回到原会话、层内切换会话保持卡片上下文
status: done
labels:
  - gap
  - cockpit
  - ui
parent: null
children: []
extra:
  schema: execution
---
## Proposal

来源：2026-10-29 在 1440×900 与 390×844 上用 MCP 浏览器对真实驾驶舱的走查。PC 上驾驶舱是会话页右侧的一个并列列，切换会话时列保持；手机上 `CockpitHeaderButton` 的 page 变体直接 `navigate('/cockpit?view=cards')`，会话页随路由卸载。用户在两种设备间来回切换后明确表示倾向 PC「驾驶舱与会话同时存在」的效果。

本任务把手机（`column.layout === 'hidden'`，即 <900px）上的驾驶舱入口改成盖在会话上的可返回层：会话页保持挂载，驾驶舱层是它上面的一层路由（建议 `/session/:sessionId/cockpit`，或带 history state 的 modal 路由），顶部一行「← 会话标题」，内容复用现有 `CockpitCardList` 的 page 变体。关闭只退一层，不重新加载会话；卡片页的选中/滚动继续由现有 sessionStorage 记忆恢复。直接打开 `/cockpit?view=cards`（深链、没有来时会话）仍是独立页面，不显示返回条。

<!-- dedup-ref -->
既有任务 `cockpit-mobile-header-and-page` 在 2026-10-27 记录的决定是「手机上驾驶舱是相对会话独立的页面」；本任务按用户 2026-10-29 的新决定取代该条，并同步修改它钉住的 `mobileHeaderCockpitEntry.test.tsx`。既有任务 `cockpit-pc-right-column` 的 PC 列行为不变。

约束：
- 只改 `column.layout === 'hidden'` 的宽度；PC 列保持现状。768–899 若从会话进入，同样走覆盖层，因为列在那里也不存在。
- `Escape` 不能被驾驶舱消费（它会中断会话回合）；关闭靠返回条、浏览器后退和显式关闭按钮。
- 新文案进全部 12 个 locale 的 `common.json`。
- 遵守 `$frontend-module-standards`：路由/覆盖层属于外壳，卡片读数与命令仍归 card controller；不新增第二套卡片状态。`CockpitPage.tsx` 在 oversize 基线上（1900 行、hookStateHeavy 32），新状态放进新组件或 hook，不往里净增。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/CockpitOverlay.test.tsx` 退出 0（新文件）：在手机宽度、`/session/<id>` 路由下点击驾驶舱入口后，覆盖层出现且会话区标记仍在 DOM（用测试夹具的挂载计数器断言会话组件没有被卸载/重建）；覆盖层标题包含会话标题；关闭后 URL 回到 `/session/<id>` 且会话标记仍是同一实例。
- [x] `npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 退出 0：手机入口打开覆盖层后仍能看到 cards 内容；桌面 1440 反向对照仍是列变体；原「点击后 location 为 `/cockpit?view=cards`」的钉子改为「覆盖层打开且会话仍在」，并在测试注释与完成记录写明这是对 `cockpit-mobile-header-and-page` 决定的有意取代。
- [x] 同文件新增深链用例：手机宽度直接打开 `/cockpit?view=cards`（没有 `/session/` 来路）时渲染独立页面、没有返回条，退出 0。
- [x] 假形态变红：把覆盖层改回旧的 `navigate('/cockpit?view=cards')` 整页跳转 ⇒ 第一条用例红（会话标记消失/重建）；改完即还原。
- [x] `npm run typecheck`、`npm run lint`、`npm run build:client` 退出 0；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0（新增内容放进新文件；若 `CockpitPage.tsx` 越过基线，按 AC-394 RECORDED CHANGE 格式记录）。

## DoD

真实页面（MCP 浏览器；`:3001` 实例或 worktree dev 代理真实数据）：

1. 手机 390×844 打开一个正在运行的会话，记录 `[data-workspace-session-area]` 上的标记、transcript 滚动位置与输入框草稿；点驾驶舱入口，截图覆盖层；在同一页面读回上述三项，证明会话没有重载；点返回条回到会话，再读一次并截图。
2. 从覆盖层里的卡片点「Open conversation」，左侧会话切换后覆盖层的保留/关闭行为按设计写进完成记录，截图。
3. 手机宽度直接打开 `/cockpit?view=cards`，截图证明是独立页面且无返回条。
4. 截图存 `tmp/`；场景运行器可用时新增 `e2e/scenarios/cockpit-phone-overlay.json` 并跑出 JSON 报告，checkpoint 截图一并贴出。

## 完成记录

**实现**：`CockpitOverlay.tsx`（新）里的 `CockpitOverlayHost` 作为 `<Routes>` 的兄弟挂在 `App` 上；入口用 `navigate(samePath, { state })` 在**同一地址**上加一条 history entry，层因此覆盖在仍然挂载的会话上，关闭 `navigate(-1)` 只弹一层。会话标题由 `WorkspaceHeader` 的 `selectedSession` 带进 history state，层在项目状态之外也能命名返回目标。`CockpitHeaderButton` 的 `hidden` 布局分支（以及手机行的 `page` 变体）打开层；没有 `/session/:id` 来路时仍回落到 `/cockpit?view=cards`。深链不携带 state，因此仍是独立页面、无返回条。没有为 `Escape` 新增任何处理器；浏览器验收里按下后层保持打开。卡片内容就是 `CockpitCardList` 的 `page` 变体，没有第二套卡片状态。

**对 `cockpit-mobile-header-and-page` 的有意取代**：该任务 2026-10-27 的决定是「手机上驾驶舱相对会话是独立页面」。它钉住的 `mobileHeaderCockpitEntry.test.tsx`「点击后 location 为 `/cockpit?view=cards`」已改成「覆盖层打开且会话仍在」，测试注释写明了取代关系。同一条旧决定还钉住了 `CockpitColumn.test.tsx` 的「900px 以下头部按钮缺席」；`hidden` 布局现在就是层的入口，该用例改为同一控件成为入口（计数照旧、永不 pressed），PC 的 squeeze/overlay 列行为不变。

**AC 4 假形态读数**：把 `openCockpit` 改回 `navigate('/cockpit?view=cards')` 后，`CockpitOverlay.test.tsx` 第一条用例红（`pressing the cockpit entry opens the layer`，overlay=null）。同一探针读到的点击后 DOM 是 `{"sessionArea":false,"overlay":false,"location":"/cockpit?view=cards","mounts":1}`——会话区随路由卸载。`git checkout --` 还原后重跑绿（1 passed）。

**DoD 读数**（worktree 的 vite 5199 代理真实 `:3001`；390×844；会话 `867d113d…`；读数文件 `tmp/dod-390-report.json`）：

- 打开前 `{"markerMatches":true,"scrollTop":8632,"draft":"DoD 草稿：手机驾驶舱覆盖层 390x844"}` → 点入口后 `{"overlay":true,"overlayTitle":"plantuml-js-meta-driver","cardCount":13,"markerMatches":true,"scrollTop":8632,"draft":"DoD 草稿：手机驾驶舱覆盖层 390x844"}` → 按 `Escape` 层仍开（overlay=true）→ 返回条关闭后 `{"overlay":false,"url":"/session/867d113d…","markerMatches":true,"scrollTop":8632,"draft":"DoD 草稿：手机驾驶舱覆盖层 390x844"}`。三项（标记 / 滚动 / 草稿）逐字相同，会话没有重载。
- 卡片「Open conversation」：地址切到卡片自己的会话 `c0aa3f51…`，层关闭（它 `replace` 掉自己那条 history entry，后退回来时会话而不是重新打开层），会话区仍是同一个 DOM 节点（标记还在），草稿变成目标会话自己的（空）。
- 深链 `/cockpit?view=cards`：`{"overlay":false,"backBar":false,"cardList":true,"cardListVariant":"page"}`。
- 截图：`tmp/dod-390-session-before.png`、`tmp/dod-390-overlay-open.png`、`tmp/dod-390-session-after-close.png`、`tmp/dod-390-overlay-card-details.png`、`tmp/dod-390-after-open-conversation.png`、`tmp/dod-390-deep-link-standalone.png`。

**DoD 顺手发现的真实缺陷（已修）**：生产路径里层把 `binding={undefined}` 显式传给 `CockpitCardList`，而 `CockpitCardListWithOwnController` 的 `{...props}` 展开在 `binding={binding}` 之后，把这个键覆盖回 `undefined`，列表在 `binding.snapshot` 崩溃。单测传的是真 binding，碰不到这条；真实页面第一次点击就复现。现在展开在前、绑定在后，`CockpitCardList.tsx` 因此进了 Touches。

**场景运行器**：现有运行器固定 1280×800，opener 词表里没有「从会话点头部入口」这一路，也没有覆盖层读数键；要覆盖本任务的手机覆盖层需要先扩展运行器，而运行器不在本任务 Touches。按 DoD 的条件句（「场景运行器可用时」）没有新增 `e2e/scenarios/cockpit-phone-overlay.json`。作为回归，对 5199 跑了既有 `e2e/scenarios/cockpit-mode-switch.json`：`passed (3 steps, 5415ms, 3 checkpoint(s))`，JSON 报告 `tmp/scenario-mode-switch.json`，checkpoint 截图在 `tmp/scenario-mode-switch/`。

**架构轴**：该轴仍暗,理由:本任务只改前端路由与覆盖层，工作树里没有 .archguard 报告，未产生依赖或图轴读数。

## Touches

- tasks/gap-cockpit-phone-cockpit-overlay.md
- src/modules/cockpit/CockpitOverlay.tsx (new)
- src/modules/cockpit/CockpitHeaderButton.tsx
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitPage.tsx
- src/modules/cockpit/CockpitRoute.tsx
- src/modules/cockpit/index.ts
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/App.tsx
- src/modules/cockpit/tests/CockpitOverlay.test.tsx (new)
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx
- e2e/scenarios/cockpit-phone-overlay.json (new)
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/zh-TW/common.json
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- src/modules/i18n/locales/tr/common.json
- server/shared/tests/architecture-ratchet.baseline.json
