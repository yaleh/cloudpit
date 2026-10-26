---
id: cockpit-pc-right-column
title: PC 右侧驾驶舱列：会话页右侧常驻可收起（≥1280 挤压、900–1280 覆盖、<900 不挂），header
  计数按钮，卡片会话链接在左侧打开，键盘按焦点归属，输入大纲改贴会话区右缘
status: todo
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-429
---
## Proposal

来源：本会话 2026-10-26 至 10-27 用户确认的 PC 模型，见 `docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md` H 节与 I 节决定表（效果图 `150-pc-*`，本地 `tmp/cockpit-redesign/`）。用户的原话要点：注意力应在项目和会话上，「等我处理的」应从一条边上持续冒出来；驾驶舱在右侧常驻、可收起，收起时与现在的会话页完全一致；收起后不要窄竖条，而是 header 右侧一个带计数的按钮。

卡片本身（`CockpitCardList`、`CockpitCard`、`CockpitCardDetails`、`createCockpitCardController`）已由 `cockpit-card-ui-core` 交付，本任务只做 PC 外壳，不改卡片的交互规则。

做什么：

- `src/modules/cockpit/cockpitColumnController.ts`：`createCockpitColumnController(deps)`，React 之外，依赖经注入（视口宽度、存储、时钟）。管理：布局模式（宽度 ≥ 1280 挤压式常驻；900 ≤ 宽度 < 1280 覆盖式抽屉；< 900 不挂载，用手机模型）；展开状态与列宽（默认约 400px，可拖宽，按设备记住，存 localStorage）；计数（open 卡片数；0 时按钮淡化无角标；> 99 显示 99+）；会话链接行为（覆盖式下打开左侧会话后自动收起；挤压式不收起）；键盘归属（两个输入框都没有焦点时 `↑` `↓` `←` `→` `1`–`9` `E` `Enter` `Backspace` 归驾驶舱列；会话输入框或其它可编辑元素有焦点时一个也不处理；Escape 永不处理）。
- `src/modules/cockpit/CockpitColumn.tsx`：列的组件。顶部标题与收起按钮；中部是现有 `CockpitCardList`（同一个 card controller，状态与 `/cockpit?view=cards` 共享）；Details 在列内推入、带返回，不占左侧；底部常驻现有驾驶舱输入框 `CockpitInput.tsx`（本任务只挂载，不新增「指令开会话」的行为）。
- `src/modules/cockpit/CockpitHeaderButton.tsx`：仪表盘（gauge）图标，与 header 的 `⋯` 同尺寸同边框，红底白字角标；展开时为按下态。从 `src/modules/cockpit/index.ts` 导出，供手机 header 任务复用。
- 挂载：`src/modules/project-workspace/ProjectWorkspaceShell.tsx`（或 `WorkspaceMain.tsx`，以实际布局为准并在完成记录写明）在右侧挂 `CockpitColumn`；`WorkspaceHeader.tsx` 的桌面分支右侧加 `CockpitHeaderButton`。只经驾驶舱 barrel 导入，不深引内部文件。
- 会话链接：点卡片里的会话链接在左侧打开 `/session/<id>`；卡片保持选中并标「已在左侧打开」。若会话页已有按消息 id 定位的能力，则滚到该提问并高亮；没有则只打开会话，并在完成记录写明。
- 侧栏「会话 / 驾驶舱」模式切换：PC 上由驾驶舱列的展开 / 收起取代（宽度 ≥ 900 时隐藏该切换），手机保留。
- 聊天的输入大纲抽屉（`src/modules/chat/outline/InputOutlineDrawer.tsx`）改为贴会话区的右边缘，不再贴窗口边缘（用户 10-27 确定），以免与驾驶舱列重叠。
- 新文案进所有语言的 `common.json`。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitColumnController.test.ts` 退出 0（AC-429 判据）：覆盖三档布局的边界值（899、900、1279、1280）、展开状态与列宽重建后恢复、计数 0 / 1 / 100、覆盖式点会话链接自动收起而挤压式不收起、无焦点时按键归列、会话输入框有焦点时按键一个也不处理、Escape 不处理。
- [ ] 假形态各自变红：覆盖式点会话链接后列仍展开 ⇒ 用例红；会话输入框有焦点时数字键被驾驶舱处理 ⇒ 用例红。每个假形态改完即还原。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0：收起时列不在 DOM、页面结构与未挂载时一致；展开时列内有卡片列表与驾驶舱输入框；Details 在列内推入并可返回；header 按钮的角标与计数一致。
- [ ] 现有测试不退：`npx vitest run src/modules/cockpit/tests src/modules/project-workspace/tests src/modules/chat/tests/inlineQuoteChip.test.tsx` 退出 0，既有用例数不减少；若输入大纲有既有测试，一并跑并在完成记录写明文件名。
- [ ] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0（新增内容优先放进新文件，不往基线内的超长文件净增行）。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`）上用 MCP 浏览器（不可用时按项目备忘用一次性 Playwright，并如实写明）在 1440、1100、800 三个宽度实际操作并截图存 `tmp/`：

1. 1440：收起时与未改动的会话页对照截图一致；点 header 按钮展开，列挤压会话区；点卡片会话链接，左侧切到该会话、列不收起；在列内打开 Details 再返回；输入大纲抽屉贴在会话区右缘而不是被列挡住。
2. 1100：展开为覆盖式抽屉；点会话链接后左侧打开会话、列自动收起。
3. 800：不出现驾驶舱列与 header 按钮的 PC 形态。
4. 键盘：点击页面空白处后按 `↓` 与 `2`，读到选中卡片与显示的选项变化；聚焦会话输入框后按 `2`，输入框里出现字符「2」，驾驶舱读数不变。

场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json …` 与 `e2e/scenarios/cockpit-mode-switch.json` 各跑一次并贴出 JSON 报告（证明卡片视图与旧模式切换不退）。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-pc-right-column.md
- src/modules/cockpit/cockpitColumnController.ts (new)
- src/modules/cockpit/CockpitColumn.tsx (new)
- src/modules/cockpit/CockpitHeaderButton.tsx (new)
- src/modules/cockpit/hooks/useCockpitColumn.ts (new)
- src/modules/cockpit/tests/cockpitColumnController.test.ts (new)
- src/modules/cockpit/tests/CockpitColumn.test.tsx (new)
- src/modules/cockpit/index.ts
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/CockpitCardDetails.tsx
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/project-workspace/ProjectWorkspaceShell.tsx
- src/modules/project-workspace/WorkspaceMain.tsx
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/chat/outline/InputOutlineDrawer.tsx
- src/modules/chat/ChatInterface.tsx
- src/modules/sidebar/SidebarModeSwitch.tsx
- src/modules/cockpit/tests/i18nCockpitCompleteness.test.ts
- src/modules/chat/tests/inlineQuoteChip.test.tsx
- src/modules/i18n/locales/de/common.json
- src/modules/i18n/locales/en/common.json
- src/modules/i18n/locales/es/common.json
- src/modules/i18n/locales/fr/common.json
- src/modules/i18n/locales/id/common.json
- src/modules/i18n/locales/it/common.json
- src/modules/i18n/locales/ja/common.json
- src/modules/i18n/locales/ko/common.json
- src/modules/i18n/locales/ru/common.json
- src/modules/i18n/locales/tr/common.json
- src/modules/i18n/locales/zh-CN/common.json
- src/modules/i18n/locales/zh-TW/common.json
- server/shared/tests/architecture-ratchet.baseline.json
