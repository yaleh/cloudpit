---
id: gap-cockpit-card-derived-calculations
title: 从 cockpit card controller 提取纯派生计算与 selector
status: todo
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

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardController.test.ts` 退出 0；所有现有状态转换、公开 snapshot、命令及派生结果用例保留且通过，未删除或放宽既有断言。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitCardDerived.test.ts` 退出 0；新测试覆盖提取后每项纯派生计算的正常输入、边界输入及不变式，且不依赖 React、DOM、定时器或外部 store。
- [ ] 同一输入通过 controller 公开 API 与提取后的 selector 得到相同派生值；controller 的公开导出和类型集合没有因提取变化，`npm run typecheck` 与 `npm run lint` 均退出 0。

## DoD

在开发构建的隔离 Cockpit 页面实际打开 cards 视图，检查过滤、密度切换、选中卡片与选项派生显示仍符合当前交互；在 390px 与桌面视口各截图保存到 `tmp/`。运行可用的 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-mode-switch.json` 并记录 JSON 报告与检查点截图，证明提取纯计算未改变页面行为。

## Touches

- tasks/gap-cockpit-card-derived-calculations.md
- src/modules/cockpit/cockpitCardController.ts
- src/modules/cockpit/cockpitCardDerived.ts (new)
- src/modules/cockpit/tests/cockpitCardController.test.ts
- src/modules/cockpit/tests/cockpitCardDerived.test.ts (new)