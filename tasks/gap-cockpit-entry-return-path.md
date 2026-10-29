---
id: gap-cockpit-entry-return-path
title: 驾驶舱入口动作统一与回程：所有入口记录 returnPath，独立驾驶舱页的「会话」段回到进入前的会话
status: todo
labels:
  - gap
  - cockpit
  - ui
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cockpit-phone-cockpit-overlay
---
## Proposal

来源：2026-10-29 用 MCP 浏览器实测。进入独立驾驶舱页只有一条路径会记录回程：侧栏模式切换的 `handleSelect` 调用了 `rememberCockpitReturnPath`；手机会话头部的 gauge 直接 `navigate('/cockpit?view=cards')`，没有记录。实测干净标签页从 `/session/ad8fea71…` 点 gauge 进驾驶舱后 `cockpit.returnPath` 不存在、驾驶舱「会话」段 href 为 `/`；经侧栏切换进入时 href 为 `/session/ad8fea71…`。

本任务把「进入驾驶舱」收敛成一个可测试的动作（建议 `src/modules/cockpit/cockpitEntry.ts` 的 `enterCockpit({navigate, target})`）：当前路由不是 `/cockpit*` 时先写 `rememberCockpitReturnPath(location.pathname + location.search)`，再导航。所有仍会导航到独立驾驶舱页的入口都改用它：gauge 的 page 变体（覆盖层不可用时的回退路径）、侧栏模式切换、收起态图标列与手机抽屉共用的 switch。驾驶舱页的「会话」段在 returnPath 指向 `/session/*` 时用会话 id 或标题说明去向（label 不变，tooltip/aria 带标题），无记录时仍回 `/`。

手机 gauge 的主路径在 `gap-cockpit-phone-cockpit-overlay` 里已改成覆盖层；本任务只覆盖覆盖层不可用或用户直接落到独立页的那些入口，依赖关系写在 `depends_on`，不改 gauge 的目的地契约（`/cockpit?view=cards` 仍由 AC-430 钉住）。

约束：不改模式切换的目的地算法（`cockpitPathForSelection`）；不改 `Escape` 行为；不新增第二套 returnPath 存储。若新增文案，进全部 12 个 locale 的 `common.json`。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitEntry.test.ts` 退出 0（新文件）：`enterCockpit` 在 `/session/<id>` 下写入 `/session/<id>`；已在 `/cockpit*` 时不覆盖；`navigate` 收到目标路径只调用一次；存储不可用时不抛错。
- [ ] `npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 退出 0：800px（列不存在、桌面 header）下从 `/session/<id>` 点可见的驾驶舱入口后，`sessionStorage['cockpit.returnPath']` 为 `/session/<id>`，且驾驶舱页「会话」段 href 是该路径。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitStage.test.tsx` 退出 0：returnPath 为 session 时「会话」段的 tooltip/aria 含会话标题或 id；没有记录时为 `/`；既有回程用例不弱化。
- [ ] `npx vitest run src/modules/sidebar/tests/SidebarModeSwitch.test.tsx` 退出 0：switch 与 gauge page 变体走同一个 `enterCockpit`（同一测试桩被调用一次），不再各自实现 remember。
- [ ] 假形态变红：从 `enterCockpit` 删掉 remember 调用 ⇒ 第一、二条用例红；改完即还原。
- [ ] `npm run typecheck`、`npm run lint` 退出 0；若 `CockpitPage.tsx` 越过 oversize 基线，按 AC-394 RECORDED CHANGE 格式记录。

## DoD

真实页面（MCP 浏览器，真实数据）：

1. 800×900（列隐藏、侧栏切换可见）与 390×844（gauge 回退路径）各一次：清空 sessionStorage，从 `/session/<id>` 进入驾驶舱，读 `cockpit.returnPath` 与「会话」段 href，点「会话」段确认落回同一会话；截图与读数。
2. 1440×900 先收起 PC 列（让侧栏 switch 可见），同样做一次往返，截图。
3. 直接打开 `/cockpit?view=cards`（无来路）时「会话」段回 `/`，截图。
4. 场景运行器 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` 报告贴出；截图存 `tmp/`。

## Touches

- tasks/gap-cockpit-entry-return-path.md
- src/modules/cockpit/cockpitEntry.ts (new)
- src/modules/cockpit/CockpitHeaderButton.tsx
- src/modules/sidebar/SidebarModeSwitch.tsx
- src/modules/cockpit/contract/viewAddress.ts
- src/modules/cockpit/contract/index.ts
- src/modules/cockpit/index.ts
- src/modules/cockpit/CockpitPage.tsx
- src/modules/cockpit/tests/cockpitEntry.test.ts (new)
- src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx
- src/modules/cockpit/tests/CockpitStage.test.tsx
- src/modules/sidebar/tests/SidebarModeSwitch.test.tsx
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