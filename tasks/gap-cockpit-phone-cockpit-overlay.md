---
id: gap-cockpit-phone-cockpit-overlay
title: 手机驾驶舱改为覆盖在会话上的层：打开不卸载会话、关闭回到原会话、层内切换会话保持卡片上下文
status: ready
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

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitOverlay.test.tsx` 退出 0（新文件）：在手机宽度、`/session/<id>` 路由下点击驾驶舱入口后，覆盖层出现且会话区标记仍在 DOM（用测试夹具的挂载计数器断言会话组件没有被卸载/重建）；覆盖层标题包含会话标题；关闭后 URL 回到 `/session/<id>` 且会话标记仍是同一实例。
- [ ] `npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 退出 0：手机入口打开覆盖层后仍能看到 cards 内容；桌面 1440 反向对照仍是列变体；原「点击后 location 为 `/cockpit?view=cards`」的钉子改为「覆盖层打开且会话仍在」，并在测试注释与完成记录写明这是对 `cockpit-mobile-header-and-page` 决定的有意取代。
- [ ] 同文件新增深链用例：手机宽度直接打开 `/cockpit?view=cards`（没有 `/session/` 来路）时渲染独立页面、没有返回条，退出 0。
- [ ] 假形态变红：把覆盖层改回旧的 `navigate('/cockpit?view=cards')` 整页跳转 ⇒ 第一条用例红（会话标记消失/重建）；改完即还原。
- [ ] `npm run typecheck`、`npm run lint`、`npm run build:client` 退出 0；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0（新增内容放进新文件；若 `CockpitPage.tsx` 越过基线，按 AC-394 RECORDED CHANGE 格式记录）。

## DoD

真实页面（MCP 浏览器；`:3001` 实例或 worktree dev 代理真实数据）：

1. 手机 390×844 打开一个正在运行的会话，记录 `[data-workspace-session-area]` 上的标记、transcript 滚动位置与输入框草稿；点驾驶舱入口，截图覆盖层；在同一页面读回上述三项，证明会话没有重载；点返回条回到会话，再读一次并截图。
2. 从覆盖层里的卡片点「Open conversation」，左侧会话切换后覆盖层的保留/关闭行为按设计写进完成记录，截图。
3. 手机宽度直接打开 `/cockpit?view=cards`，截图证明是独立页面且无返回条。
4. 截图存 `tmp/`；场景运行器可用时新增 `e2e/scenarios/cockpit-phone-overlay.json` 并跑出 JSON 报告，checkpoint 截图一并贴出。

## Touches

- tasks/gap-cockpit-phone-cockpit-overlay.md
- src/modules/cockpit/CockpitOverlay.tsx (new)
- src/modules/cockpit/CockpitHeaderButton.tsx
- src/modules/cockpit/CockpitPage.tsx
- src/modules/cockpit/CockpitRoute.tsx
- src/modules/cockpit/index.ts
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/App.tsx
- src/modules/cockpit/tests/CockpitOverlay.test.tsx (new)
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