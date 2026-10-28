---
id: gap-cockpit-option-trigger-and-explanation-one-frame
title: 驾驶舱卡片：选项下拉触发器与「选项说明」合成一个带边框的整体（触发器在上、说明在下、中间只一条分隔线），不再是两个并列的灰框
status: todo
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

来源：2026-10-28 用户反馈（附 ASK 卡片截图）：卡片里「下拉触发器（选项名 + from assistant 2 of 2）」与紧随其下的「选项详细描述（does / why / tags）」是两个独立的灰色圆角框，中间还有一道缝，看上去像两个并列的选项，而不是「当前选中选项」的一个整体。用户 2026-10-28 在效果图（`tmp/cockpit-option-mockups.png`，现状 / 方案 A / 方案 B）里选定方案 A。

根因（`src/modules/cockpit/CockpitCard.tsx`）：触发器按钮自带 `rounded-md border border-border bg-background`；其下 `ShownOptionExplanation`（约第 123 行）自带 `mt-1.5 rounded-md bg-muted/50`。两个元素各有圆角和底色，之间 `mt-1.5` 留缝，所以读成两个框。

做什么（方案 A，只改 Cards 密度下的下拉关闭态；DOM 结构与现有 `data-testid` 不变，只新增一个框元素）：

- 在 `cockpit-card-options` 内用一个外框元素包住触发器和（存在时的）`ShownOptionExplanation`：`data-testid="cockpit-card-option-frame"`，类为 `overflow-hidden rounded-md border border-border`。外框是这一块唯一带边框与圆角的元素。
- 触发器去掉自己的 `rounded-md border border-border`，保留 `bg-background`、`hover:bg-accent`、`aria-expanded` 与全部 `data-*`。
- `ShownOptionExplanation` 去掉 `mt-1.5` 与 `rounded-md`，改为 `border-t border-border bg-muted/50`，内部 `does / why / warn / tags / undo / when` 的行内样式与顺序不变。
- 没有可显示的说明（没有选中选项、或自己的回复）时，外框只包触发器，视觉与现状的单个触发器一致；下拉展开态（`cockpit-card-option-list`）的样式不动。
- Compact 密度不画说明，保持不变。
- 不新增文案，不动语言包。净增行数要小：`CockpitCard.tsx` 现为 766 行，低于 800 行的 oversize 地板，不得越过。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0，新增用例（Cards 密度、下拉关闭、选中一个带说明的选项）：存在 `cockpit-card-option-frame`，且 `cockpit-card-option-trigger` 与 `cockpit-card-shown-option` 都是它的后代；外框的 class 含 `border` 与 `rounded-md`；触发器与说明块的 class 都不含 `rounded-md`，触发器的 class 不含 `border-border`，说明块的 class 不含 `mt-1.5` 且含 `border-t`；既有用例（含 `cockpit-card-shown-option-why` 读数）数量不减少。
- [ ] 同一文件新增用例：下拉展开时 `cockpit-card-option-list` 仍渲染、`cockpit-card-shown-option` 不渲染（与现状一致）；Compact 密度下不渲染 `cockpit-card-shown-option`；选「自己的回复」时外框只含触发器。
- [ ] `npx vitest run src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts src/modules/cockpit/tests/cockpitCardsMobileDetails.test.tsx` 退出 0（场景运行器语义面按 `cockpit-card-option-trigger` 读数，不受影响）。
- [ ] 假形态变红：把说明块改回 `mt-1.5 rounded-md`（两个独立框），第一条里的新用例红；把外框拿掉，同一用例红。改完即还原。
- [ ] `npm run typecheck`、`npm run lint`、`npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0（`CockpitCard.tsx` 不得越过 oversize 地板）。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`；入口 `/cockpit?view=cards`）上用 MCP 浏览器（不可用时用一次性 Playwright 并写明），**只看、不点任何 Confirm**：

1. 手机宽度 390 与 PC 宽度 1440，各截一张夹具卡（带 `suggested` 选项且有 does / why / tags 的那种），存 `tmp/`，与用户反馈截图对照说明「两个灰框」已合成一个整体。
2. `browser_evaluate` 读几何并贴出：`cockpit-card-option-frame` 的矩形、触发器与说明块的矩形，要求触发器下沿与说明块上沿间距为 0、两者都在外框矩形内、外框是该区域唯一带边框的元素。
3. 下拉展开态截一张（选项列表样式没变），暗色模式（`document.documentElement.classList.toggle('dark')`）截一张。
4. 场景运行器 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json …` 贴出 JSON 报告与检查点截图。

⛔ 不在线上实例点击任何确认。实例用毕 `scripts/isolated-instance.sh stop`。

## ADR-007

该轴仍暗,理由:本任务只调整一个卡片区域的边框与间距，判据是 DOM 结构与几何读数，没有本轮可记的 L_D/L_G 量化读数。

## Touches

- tasks/gap-cockpit-option-trigger-and-explanation-one-frame.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/tests/CockpitCard.test.tsx
