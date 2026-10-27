---
id: cockpit-mobile-header-and-page
title: 手机 header 与驾驶舱页：单行 45px，标题后「R ▾」（绿 / 灰）、项目名后 Quay in-flight 图、右侧 tab ▾ ·
  ⋯ · 驾驶舱按钮（gauge + 红底角标），驾驶舱卡片页返回保持原位
status: done
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

- [x] `npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 退出 0（AC-430 判据）：手机宽度下 R 按钮在标题后且绿 / 灰两态各有用例、无圆点、点开出现 Resident 详情；Quay 图在项目名后；右侧顺序为 tab 下拉、⋯、驾驶舱按钮；角标 0 / 7 / 120 三种读数（淡化无角标 / 7 / 99+）；点按导航到 `/cockpit?view=cards`；桌面宽度不出现 R 按钮替换。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0，新增用例：离开卡片页再回来，选中卡片与记录的滚动位置恢复。
- [x] 假形态变红：把 R 按钮的颜色改为不随运行态变化 ⇒ 判据红；改完即还原。
- [x] 现有测试不退：`npx vitest run src/modules/project-workspace/tests src/modules/quay` 退出 0，既有用例数不减少（`workspaceTabsResponsive.test.tsx`、`WorkspaceTitle.test.tsx` 等对 header 的既有断言若因位置调整需要更新，逐条在完成记录写明改了什么、为什么）。
- [x] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`）上用 MCP 浏览器（不可用时按项目备忘用一次性 Playwright，并如实写明）在 390 与 360 宽度实际操作并截图存 `tmp/`：

1. 一个 Resident 在跑的会话与一个不在跑的会话各截一张 header，读出 header 高度（应为 45px）、标题可见宽度、右侧控件总宽、`document.documentElement.scrollWidth <= innerWidth`。
2. 点 R 打开 Resident 详情；点 Quay 图打开 Quay 面板；点驾驶舱按钮进入卡片页，角标数等于卡片页可见卡片数。
3. 卡片页滚到下方并选中一张卡片，点它的会话链接进入会话，再返回：选中与滚动位置不变，截图对照。

场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json …` 与 `e2e/scenarios/quay-wall-focus-pin-utter.json`（header 里的 Quay 入口不退）各跑一次并贴出 JSON 报告。实例用毕 `scripts/isolated-instance.sh stop`。

## 完成记录

实现提交：`3d05ccf2c cockpit: phone header layout and the cards page's route memory (AC-430)`（12 文件，+953/−67）。

AC-1 判据：`mobileHeaderCockpitEntry.test.tsx` 7/7 通过。R 的绿/灰各一条用例；绿态断言 `border-emerald-500/50` + `text-emerald-600` + `bg-emerald-500/10`，灰态断言 `text-muted-foreground` + `border-border/60` 且 class 里没有 `emerald`；两态都断言无 `[data-resident-badge-dot]`、R 在标题之后、点开出现 `[data-resident-badge-panel]`。Quay 图断言 `variant="compact"`、64px×14px、位于项目名之后且同属标题块。右侧顺序用 `compareDocumentPosition` 断言 picker → menu → cockpit，且三者与 `⋯` 共享 `h-8 w-8 rounded-lg border border-border/50`。角标三读数：0 时无 `cockpit-header-badge` 且按钮带 `opacity-60`，7 时文本 `7`，120 时文本 `99+`。点击后 `location` 为 `/cockpit?view=cards`。桌面（1440）一条反向对照：无 letter 变体、pill 保留圆点、pulse 非 compact、cockpit 按钮仍是 column 变体。
AC-2 判据：`cockpitCardController.test.ts` 24/24 通过。新增 describe「the card page returns to where it was」三条：两个控制器共用一个普通对象作 route memory，第一次访问选 `c`、滚到 420，dispose 后新建控制器读到 `scrollPosition=420` 且加载后恢复 `selectedCardId='c'`；记忆里被过滤掉的卡片不会被复活；memory 读取抛错时从顶部开始。
AC-3 假形态：临时把 letter 变体的 running 分支改成与 stopped 相同的 `border-border/60 text-muted-foreground`（颜色不再随运行态变化），`npx vitest run src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx` 红在 running 用例的 `running border` 断言（`border-emerald-500/50` 缺失）；已逐字还原，提交里的文件就是还原后的形态。
AC-4 既有测试：`npx vitest run src/modules/project-workspace/tests src/modules/quay` 211/211 通过；`npx vitest run src/modules/cockpit` 238/238 通过。唯一改动的既有断言在 `workspaceTabsResponsive.test.tsx` 的 mobile child-order 用例：它原来断言手机右侧行（`children[1]`）里有 `quay-pulse-trigger`；AC-430 把 pulse 移到标题块（`children[0]`，项目名之后），所以改为断言 `children[0]` 含该 trigger、`children[1]` 不含，并在注释里写明是 AC-430 的位移。`WorkspaceTitle.test.tsx` 与 `WorkspaceTabs.tsx` 经核对无需改动（前者只读桌面标题/项目名，后者不渲染该 trigger）。
AC-5 质量门：`npm run typecheck` 0、`npm run lint` 0、`npm run build:client` 0、`npm run build:server` 0；`npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 6/6 通过。`cockpitCardController.ts` 由 develop 的 766 行长到 871 行、越过 800 行未基线阈值，按 AC-394 的 RECORDED CHANGE 格式在 `architecture-ratchet.baseline.json` 记一条说明（新增 route memory 缝与其诚实形态）。

DoD-1（390/360，一次性 Playwright：本会话无可用 MCP 浏览器；脚本 `tmp/dod/probe.cjs`，报告 `tmp/dod/probe-report.json`）：
- running 390：`headerHeight=45`，`titleVisibleWidth=129`（改前约 155，设计允许降到约 116），`rightControlsWidth=124`（改前 135），`documentScrollWidth=390=innerWidth`（无横向溢出）。R：文本 `R`、`data-resident-badge=running`、`color=rgb(5, 150, 105)`、`borderColor=rgba(16, 185, 129, 0.5)`、`backgroundColor=rgba(16, 185, 129, 0.1)`、`hasDot=false`、`afterTitle=true`。Quay 图：`variant=compact`、`64×14`、`afterProjectName=true`。截图 `tmp/dod/header-running-390.png`。
- stopped 390：R 为 `data-resident-badge=stopped`、`color=rgb(118, 114, 107)`、`borderColor=rgba(226, 224, 217, 0.6)`、`backgroundColor=transparent`、`hasDot=false`。截图 `tmp/dod/header-stopped-390.png`。
- running 360：`headerHeight=45`、`titleVisibleWidth=99`、`rightControlsWidth=124`、无横向溢出。截图 `tmp/dod/header-running-360.png`。
DoD-2：点 R 出现 `role=dialog` 的 Resident 面板（`tmp/dod/resident-panel-390.png`）；点 Quay 图出现标题 `Quay` 且 `quay-panel-task-ledger` 在内的完整面板（`tmp/dod/quay-panel-390.png`）；点驾驶舱按钮 URL 变为 `/cockpit?view=cards`，按钮 32×32、边框 1px `rgba(226, 224, 217, 0.5)`，角标 `6` 且当年可见卡片正好 6 张（`tmp/dod/cockpit-cards-390.png`）。
DoD-3（`tmp/dod/probe-return.cjs`，报告 `tmp/dod/probe-return-report.json`）：卡片页滚到 `scrollTop=640` 并选中 `fixture:ask`，sessionStorage 记为 `{"selectedCardId":"fixture:ask","scrollPosition":640}`；打开 Details（`detailsOpenCardId=fixture:ask`）点会话链接进入 `/session/fixture-session`；`goBack()` 回到卡片页后 `selectedCardId=fixture:ask`、`scrollTop=640`，`restored={selectedCardId:true, scrollTop:true}`。对照截图 `cards-before-390.png` / `card-details-390.png` / `session-from-card-390.png` / `cards-after-return-390.png`。
场景运行器（实例同一次启动；`--base-url` 指向 Vite dev）：
- `cockpit-cards-confirm`：`{"scenario":"cockpit-cards-confirm","ok":true,"failedStep":null,"stepCount":6,"checkpoints":5}`（完整报告 `tmp/ui-scenarios/cards-report.json`，checkpoint 在 `tmp/ui-scenarios/cards/`）。6 步全 ok，含 confirm 后卡片仍在列表且 confirm target 仍是 `later`。
- `quay-wall-focus-pin-utter`：`{"scenario":"quay-wall-focus-pin-utter","ok":true,"failedStep":null,"stepCount":6,"checkpoints":2}`（完整报告 `tmp/ui-scenarios/quay-report.json`，checkpoint 在 `tmp/ui-scenarios/quay/`）。首步读数 `activeView=quay://ui-scenario-workspace/board`、`focusables=["①","②"]`；末步 input pack 的 `focusLabel="②"`、`tray` 含 ②、`seamBuilds=1`。这个场景要求 fixture 项目在 quay-fleet registry 里（未登记时 QuayPanel 不发布 view contract，仓库自己的 e2e 也据此 skip）；本次用一次性 fixture 项目 `/tmp/isoscenario/ui-scenario-workspace` + 临时 `QUAY_FLEET_HOME=/tmp/isoscenario/fleet` 提供登记，未改用户真实的 `~/.quay-fleet/registry.json`。
实例收尾：因脚本每次 start 都会重写 settings（只留 `residentRestore`），本次按 `cockpit-pc-right-column` 已验证的做法——写回 `cockpit.{enabled,fixtureCards}` 后以同一 `DATABASE_PATH`/`SERVER_SETTINGS_PATH` 手工重启同一个 node；用毕 `scripts/isolated-instance.sh stop` 停实例（`port_still_serving:false`），另停本次最早手工起的 15003 node 与 Vite，并把 `~/.cloudcli/local-server.json` 恢复为指向 3001 的线上服务（`pid 1914912`，健康检查 200）。

## ADR-007

L_D 该轴仍暗，理由：本任务是手机 header 布局与卡片页路由记忆，未新增领域数据能力；卡片页读数来自 fixture provider 的演示数据，不是真实领域读数。
L_G 该轴仍暗，理由：本任务未改架构图生成或依赖图，L_G 没有新的可信读数来源。

## Touches

- tasks/cockpit-mobile-header-and-page.md
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/project-workspace/WorkspaceTitle.tsx
- src/modules/project-workspace/tests/mobileHeaderCockpitEntry.test.tsx (new)
- src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx
- src/modules/quay/SessionPulse.tsx
- src/modules/chat/transcript/ResidentSessionBadge.tsx
- src/modules/cockpit/CockpitHeaderButton.tsx
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/CockpitCardList.tsx
- src/modules/cockpit/hooks/useCockpitCards.ts
- src/modules/cockpit/tests/cockpitCardController.test.ts
- server/shared/tests/architecture-ratchet.baseline.json