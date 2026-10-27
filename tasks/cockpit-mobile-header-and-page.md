---
id: cockpit-mobile-header-and-page
title: 手机 header 与驾驶舱页：单行 45px，标题后「R ▾」（绿 / 灰）、项目名后 Quay in-flight 图、右侧 tab ▾ ·
  ⋯ · 驾驶舱按钮（gauge + 红底角标），驾驶舱卡片页返回保持原位
status: ready
labels:
  - feature
  - cockpit
parent: null
children: []
extra:
  schema: execution
depends_on:
  - cockpit-pc-right-column
goal_ac: AC-430
---
## Proposal

来源：本会话 2026-10-27 用户确认的手机 header，见 `docs/architecture/cockpit-attention/INTERACTION-PRINCIPLES.md` G 节（效果图 `140-header-*`、`141-header-new-compared`，本地 `tmp/cockpit-redesign/`）。用户确认三处取舍：标题变窄可接受、Quay 图 14px 高够用、保留 ▾。手机上驾驶舱是相对会话独立的页面。

驾驶舱按钮组件 `CockpitHeaderButton` 与计数由 `cockpit-pc-right-column` 交付并从驾驶舱 barrel 导出，本任务复用，不另写一份。

做什么（只改手机分支，即 `WorkspaceHeader.tsx` 的 `isMobile` 渲染；桌面 header 除 PC 任务已加的按钮外不动）：

- 保持单行、总高 45px，`☰` 与模型图标不动。
- 会话标题后：一个「R ▾」下拉按钮，取代原来的「● Resident ▾」标签。Resident 进程在跑时字母与边框为绿色（淡绿底），不在跑时为灰色；没有圆点；点开仍是现有的 Resident 详情（复用现有下拉内容，不改其行为）。
- 项目名后：Quay in-flight 图（约 64×14），即现有 `SessionPulse` / `PulseStrip` 的紧凑形态，放在原 Resident 标签的位置；点按打开完整 Quay 面板（沿用现有行为）。
- 右侧依次：tab 下拉、`⋯`、驾驶舱按钮。驾驶舱按钮与 `⋯` 同尺寸（32×32）、同边框；待处理数以红底白字角标标在右上角（> 99 显示 99+）；为 0 时按钮变淡、无角标；点按进入 `/cockpit?view=cards`。
- 驾驶舱卡片页（手机）：从卡片的会话链接进入会话再返回时，卡片页的选中卡片与滚动位置保持不变（状态存在 card controller 或路由状态里，不靠重新加载后碰巧一致）。
- 实测约束（390px）：标题可见宽度允许从约 155px 降到约 116px；右侧控件总宽不超过改动前；不得出现横向溢出。

## AC

- [ ] `npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 退出 0（AC-430 判据）：手机宽度下 R 按钮在标题后且绿 / 灰两态各有用例、无圆点、点开出现 Resident 详情；Quay 图在项目名后；右侧顺序为 tab 下拉、⋯、驾驶舱按钮；角标 0 / 7 / 120 三种读数（淡化无角标 / 7 / 99+）；点按导航到 `/cockpit?view=cards`；桌面宽度不出现 R 按钮替换。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：离开卡片页再回来，选中卡片与记录的滚动位置恢复。
- [ ] 假形态变红：把 R 按钮的颜色改为不随运行态变化 ⇒ 判据红；改完即还原。
- [ ] 现有测试不退：`npx vitest run src/modules/project-workspace/tests src/modules/quay` 退出 0，既有用例数不减少（`workspaceTabsResponsive.test.tsx`、`WorkspaceTitle.test.tsx` 等对 header 的既有断言若因位置调整需要更新，逐条在完成记录写明改了什么、为什么）。
- [ ] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`）上用 MCP 浏览器（不可用时按项目备忘用一次性 Playwright，并如实写明）在 390 与 360 宽度实际操作并截图存 `tmp/`：

1. 一个 Resident 在跑的会话与一个不在跑的会话各截一张 header，读出 header 高度（应为 45px）、标题可见宽度、右侧控件总宽、`document.documentElement.scrollWidth <= innerWidth`。
2. 点 R 打开 Resident 详情；点 Quay 图打开 Quay 面板；点驾驶舱按钮进入卡片页，角标数等于卡片页可见卡片数。
3. 卡片页滚到下方并选中一张卡片，点它的会话链接进入会话，再返回：选中与滚动位置不变，截图对照。

场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json …` 与 `e2e/scenarios/quay-wall-focus-pin-utter.json`（header 里的 Quay 入口不退）各跑一次并贴出 JSON 报告。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-mobile-header-and-page.md
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/project-workspace/WorkspaceTitle.tsx
- src/modules/project-workspace/WorkspaceTabs.tsx
- src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx (new)
- src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx
- src/modules/project-workspace/tests/WorkspaceTitle.test.tsx
- src/modules/quay/SessionPulse.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/tests/cockpitCardController.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
