---
id: gap-cockpit-card-presentational-semantics
title: 按展示语义拆分 CockpitCard 的纯呈现组件
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

将 `src/modules/cockpit/CockpitCard.tsx` 内可独立命名的展示区块抽成职责清楚的纯呈现组件，使卡片 JSX 按展示语义组织。展示组件只接收已计算好的 props 并绘制 UI；规则、派生决策、交互状态与命令继续留在现有 controller，不在组件中复制业务规则或新增状态 owner。遵守 `frontend-module-standards`：应用源码使用 `@/` 导入，类型仅导入用 `import type`，不增加 interfaces，不把同 feature 组件挪到 shared。现有 `CockpitCardSituation.tsx` 仅在确实需要修改时纳入改动。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitCard.test.tsx` 退出 0；卡片头部、问题/情境、事实、选项和确认显示的现有断言均保留且通过，未删除或放宽行为断言。
- [ ] 新增的 presentational component tests（如组件文件需要独立测试）以 props 输入断言展示内容与可访问语义，退出 0；展示组件不创建 controller、不持有业务状态、不执行派生决策或 API 命令。
- [ ] `npm run typecheck` 与 `npm run lint` 退出 0；本次新增的应用源码导入均使用 `@/`，无新增 frontend `interface`、冗余状态或不必要的 feature barrel export。

## DoD

在隔离 Cockpit 页面用真实浏览器操作 cards 页面，实际走访卡片展示涉及的展开/选项显示交互，分别在 390px 与桌面视口截图并保存到 `tmp/`；检查提取后的展示区块在两种尺寸下可见且交互仍由既有 controller 承接。另运行可用的 `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json`，记录 JSON 报告与检查点截图；不得在真实线上卡片上执行确认。

## Touches

- tasks/gap-cockpit-card-presentational-semantics.md
- src/modules/cockpit/CockpitCard.tsx
- src/modules/cockpit/CockpitCardHeader.tsx (new)
- src/modules/cockpit/CockpitCardFacts.tsx (new)
- src/modules/cockpit/CockpitCardOptions.tsx (new)
- src/modules/cockpit/tests/CockpitCard.test.tsx