---
id: gap-cockpit-entry-return-path
title: 驾驶舱入口动作统一与回程：所有入口记录 returnPath，独立驾驶舱页的「会话」段回到进入前的会话
status: ready
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

- [x] `npx vitest run src/modules/cockpit/tests/cockpitEntry.test.ts` 退出 0（新文件）：`enterCockpit` 在 `/session/<id>` 下写入 `/session/<id>`；已在 `/cockpit*` 时不覆盖；`navigate` 收到目标路径只调用一次；存储不可用时不抛错。
- [x] `npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 退出 0：800px（列不存在、桌面 header）下从 `/session/<id>` 点可见的驾驶舱入口后，`sessionStorage['cockpit.returnPath']` 为 `/session/<id>`，且驾驶舱页「会话」段 href 是该路径。
- [x] `npx vitest run src/modules/cockpit/tests/CockpitStage.test.tsx` 退出 0：returnPath 为 session 时「会话」段的 tooltip/aria 含会话标题或 id；没有记录时为 `/`；既有回程用例不弱化。
- [x] `npx vitest run src/modules/sidebar/tests/SidebarModeSwitch.test.tsx` 退出 0：switch 与 gauge page 变体走同一个 `enterCockpit`（同一测试桩被调用一次），不再各自实现 remember。
- [x] 假形态变红：从 `enterCockpit` 删掉 remember 调用 ⇒ 第一、二条用例红；改完即还原。
- [x] `npm run typecheck`、`npm run lint` 退出 0；若 `CockpitPage.tsx` 越过 oversize 基线，按 AC-394 RECORDED CHANGE 格式记录。

## DoD

真实页面（MCP 浏览器，真实数据）：

1. 800×900（列隐藏、侧栏切换可见）与 390×844（gauge 回退路径）各一次：清空 sessionStorage，从 `/session/<id>` 进入驾驶舱，读 `cockpit.returnPath` 与「会话」段 href，点「会话」段确认落回同一会话；截图与读数。
2. 1440×900 先收起 PC 列（让侧栏 switch 可见），同样做一次往返，截图。
3. 直接打开 `/cockpit?view=cards`（无来路）时「会话」段回 `/`，截图。
4. 场景运行器 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json …` 报告贴出；截图存 `tmp/`。

## DoD 读数

本会话无 MCP 浏览器可用，改用一次性 Playwright 脚本驱动真实页面（worktree vite :5199 代理 live :3001，token 从 `~/.cloudcli/auth.db` 铸造，真实会话 `ad8fea71-9e02-4635-aa1f-8f5bb64b043b`）；读数全部来自产品自身的 `sessionStorage` 与 DOM。脚本与截图在 `tmp/`（gitignored）。

| 腿 | `cockpit.returnPath` | 「会话」段 href | 点段后落点 | 截图 |
| --- | --- | --- | --- | --- |
| 800×900 侧栏切换 | `/session/ad8fea71-9e02-4635-aa1f-8f5bb64b043b` | 同左 | 同左 | `tmp/dod-800-cockpit.png` |
| 390×844 gauge → 覆盖层，再开独立页 | `/session/ad8fea71-9e02-4635-aa1f-8f5bb64b043b` | 同左 | 同左 | `tmp/dod-390-overlay.png`, `tmp/dod-390-cockpit-page.png` |
| 1440×900 先收起 PC 列 | `/session/ad8fea71-9e02-4635-aa1f-8f5bb64b043b` | 同左 | 同左 | `tmp/dod-1440-cockpit.png` |
| 直接开 `/cockpit?view=cards`（无来路） | null | `/` | — | `tmp/dod-direct-cockpit.png` |

三个有来路的腿 title/aria-label 均为 `Sessions · return to session ad8fea71-9e02-4635-aa1f-8f5bb64b043b`；无来路时退回 `Sessions`。读数 JSON：`tmp/dod-entry-return-path.json`。

场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json … --project claudecodeui --session pwd` → 3/3 步通过（10.5s），报告 `tmp/scenario-report.json`，检查点截图 `tmp/scenario-cockpit-mode-switch/step-{1,2,3}-*.png`。

测试读数：cockpitEntry 5/5、mobileHeaderCockpitEntry 10/10、CockpitStage 39/39、SidebarModeSwitch 10/10 全部退出 0；`npm run typecheck` 与 `npm run lint` 退出 0；architecture-ratchet 6/6 通过（无基线改动）。

## ADR-007 暗轴

该轴仍暗,理由:本任务只改前端入口动作与回程记忆，不产生 L_D/L_G 分层度量读数。

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
