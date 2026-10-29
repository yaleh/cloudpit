---
id: gap-cockpit-card-derived-calculations
title: 从 cockpit card controller 提取纯派生计算与 selector
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

将 `src/modules/cockpit/cockpitCardController.ts` 中纯派生、可独立计算的 selector/projection 计算提取到模块私有 helper（可命名 `cockpitCardDerived.ts`），由既有 controller 调用。范围仅限输入到输出的纯计算；不重做、不迁移、不新增状态 owner，不改变 controller 的公开 contract、命令顺序、状态转移或 UI 行为。现有组件、controller 与 state 的生命周期和所有权保持不变；按 frontend-module-standards 使用 `@/` 应用内导入、type-only imports 和聚焦测试。

## AC

- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0；所有现有状态转换、公开 snapshot、命令及派生结果用例保留且通过，未删除或放宽既有断言。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitCardDerived.test.ts` 退出 0；新测试覆盖提取后每项纯派生计算的正常输入、边界输入及不变式，且不依赖 React、DOM、定时器或外部 store。
- [x] 同一输入通过 controller 公开 API 与提取后的 selector 得到相同派生值；controller 的公开导出和类型集合没有因提取变化，`npm run typecheck` 与 `npm run lint` 均退出 0。

## DoD

在开发构建的隔离 Cockpit 页面实际打开 cards 视图，检查过滤、密度切换、选中卡片与选项派生显示仍符合当前交互；在 390px 与桌面视口各截图保存到 `tmp/`。运行可用的 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json` 并记录 JSON 报告与检查点截图，证明提取纯计算未改变页面行为。

## Touches

- tasks/gap-cockpit-card-derived-calculations.md
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/cockpitCardDerived.ts (new)
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/cockpitCardDerived.test.ts (new)

## Notes

**实现.** 新增模块私有纯模块 `src/modules/cockpit/cockpitCardDerived.ts`（只依赖 `@/shared/types`、`@/modules/cockpit/contract` 与 `cockpitCardFeedback` 的常量，无 React、DOM、时钟、store）。搬出的纯计算：`shownOptionOf`、`cockpitCardStateKey`、`defaultShownOption`、`isIrreversibleOption`、`confirmTargetOf`、`dismissTargetOf`、`startedSessionIdOf`、`matchesProjectFilters`、`visibleCardsOf`、`typeCountsOf`、`projectCountsOf`、`normalizeProjectFilters`、`projectsOf`、`targetsOf`、`dismissTargetsOf`；连同 `CockpitCardShown` / `CockpitCardConfirmTarget` / `CockpitCardDismissTarget` 三个结果类型。controller 保留 snapshot、命令与生命周期，`normalize` 改为调用新 helper，并以原名字 re-export 7 个公开函数与 3 个类型，公开面不变。

**AC 读数.**
- AC1：`npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` → 63 passed（原 61 + 新增 2）；该文件相对 `develop` 的 diff `removed_lines=0`、新增 58 行，既有断言未删除、未放宽。
- AC2：`npx vitest run src/modules/cockpit/tests/cockpitCardDerived.test.ts` → 50 passed；文件只 import `vitest`、`@/shared/types`（type）、`FEEDBACK_LOCKED_REASON` 与被测模块，不触碰 React/DOM/定时器/store。
- AC3：cross-path 用例附加在 controller 测试的 `the controller publishes exactly the extracted selectors’ readings`（把 `snapshot.cards` 回灌同一批 selector，含过滤前后两组输入）；controller 导出名集合前后各 31 个，`missing=[]`、`added=[]`；`npm run typecheck` exit 0；`npm run lint` exit 0。

**DoD 读数.** 在任务 worktree 起开发构建（`VITE_PORT=5199 VITE_CACHE_DIR=tmp/vite-cache npx vite --port 5199`，`/api` 代理线上 :3001），Playwright 一次性脚本只读驱动（`**/api/cockpit/**` 非 GET 一律 abort），截图与报告在 `tmp/ui-dod/`：
- 桌面 1440x900：cards 视图 34 张可见卡；type 过滤 `ask` 后 33 张、chip 计数保留；`compact` 密度与 `cards` 密度可见集相同（34）；项目抽屉选中 `claudecodeui` 后 20 张、`projectFilter=claudecodeui`；选中卡片 `att_8b6867850452` 发布 `shownOptionId=1`，卡面 option trigger 显示对应选项；`pageerror=0`。
- 390x844：cards 34 张；`ask` 过滤生效；`compact` 切换生效；选中 `att_94edac259017` 发布 `shownOptionId=reevaluate`；`pageerror=0`。
- 截图：`tmp/ui-dod/desktop-01-cards.png`、`desktop-02-filter-ask.png`、`desktop-03-compact.png`、`desktop-04-project-filter.png`、`desktop-05-selected.png`；`tmp/ui-dod/mobile-01-cards.png`、`mobile-02-filter-ask.png`、`mobile-03-compact.png`、`mobile-04-selected.png`；读数 `tmp/ui-dod/report.json`。
- 场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json --base-url http://127.0.0.1:5199 --project claudecodeui --session "session-ask 失败无法归因" --out tmp/ui-scenario` → `passed (3 steps, 5668ms, 3 checkpoint(s))`，`ok=true`、`failedStep=null`，路由序列 `/session/…` → `/cockpit?view=board&project=claudecodeui` → 同一 `/session/…`；报告 `tmp/ui-scenario/report.json`，检查点截图 `tmp/ui-scenario/step-1-open-session.png`、`step-2-open-cockpit.png`、`step-3-open-session.png`。

- 该轴仍暗,理由:本任务只把模块内的纯派生计算搬到同名 helper 并原样 re-export，不新增跨模块依赖边、不改数据生成，L_D/L_G 两轴没有可测读数；行为由三条 AC、桌面与 390px 截图及场景运行器覆盖。