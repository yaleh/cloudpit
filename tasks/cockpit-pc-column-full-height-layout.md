---
id: cockpit-pc-column-full-height-layout
title: PC 驾驶舱列满高：列与「会话 header + 会话内容」平级、从页面顶到底；会话 header（tab 等）只占左侧；覆盖式抽屉打开时输入大纲把手让位
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

来源：2026-10-27 用户审阅线上 PC 驾驶舱列（截图 `/data/home/yale/work/claudecodeui/tmp/cockpit-review-pc-open-1440.png`，对照效果图 `/data/home/yale/work/claudecodeui/tmp/cockpit-redesign/150-pc-open.png`、`150-pc-details.png`；目录 gitignored，按绝对路径读）。用户原话：「Cockpit 的高度应为整个页面高度。Tab 等原来会话页面就显示的 header 都属于会话的 header，不应显示在 Cockpit 上。」

MCP 浏览器实测（1440×900）：会话 header（Chat / Quay / Architecture / Files / Source Control / Shell 这排 tab 与标题）横跨 x 289–1440，驾驶舱列外框从 y=57 开始、高 843，排在会话 header 之下。原因是 `src/modules/project-workspace/WorkspaceMain.tsx` 把 `CockpitColumn` 挂在会话内容内部，与会话内容平级，而不是与「会话 header + 会话内容」整体平级。效果图里列从 y=0 到页面底部，会话 header 只延伸到列的左边缘。

另在 1100 宽度（覆盖式抽屉）实测：抽屉本身满高正确，但聊天「输入大纲」的把手（‹，`src/modules/chat/outline/` 下）浮在驾驶舱卡片之上，挡住卡片内容。

做什么：

- 布局：PC 挤压式（宽度 ≥ 1280）下，驾驶舱列成为会话区（会话 header + 会话内容 + 会话输入框）的右侧兄弟，高度等于页面可用高度（从页面顶部起），会话 header 的宽度随之收窄到列的左边缘。侧栏（项目与会话列表）不变。列收起时页面与改动前完全一致。
- header 按钮：仪表盘按钮仍留在会话 header 右侧（展开时为按下态）；列自己的标题行（「Cockpit」与计数）放在列顶部，含收起按钮（与 header 按钮同一动作）。
- 覆盖式（900–1280）：保持满高覆盖；抽屉打开时输入大纲的把手隐藏，或移到抽屉左侧不与卡片重叠；抽屉关闭后恢复。
- 手机（< 900）不受影响。
- 不改卡片组件、卡片 controller、过滤与 Details 的内容（这些由其它任务处理）。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0，新增用例：挤压式展开时列的容器是会话区（含 header）的兄弟节点而不在会话内容内部；列内含标题行与收起按钮，收起按钮与 header 按钮驱动同一状态。
- [ ] `npx vitest run src/modules/cockpit/tests/cockpitColumnController.test.ts` 退出 0（既有用例不减）；若覆盖式下输入大纲把手的让位由 controller 读数驱动，新增对应用例。
- [ ] 新增或扩展一条 e2e：`npx playwright test e2e/cockpit-column-layout.spec.ts` 退出 0。1440×900 下展开列后断言：列的 `getBoundingClientRect().top` ≤ 1 且 `height` ≥ 视口高度 − 1；会话 header 的 `right` ≤ 列的 `left` + 1；收起后会话 header 的 `right` 等于收起前未展开时的读数（容差 1px）。1100×800 下展开覆盖式抽屉后，输入大纲把手与抽屉矩形不相交（或把手不可见）。失败时打印各矩形读数。
- [ ] 现有测试不退：`npx vitest run src/modules/project-workspace/tests src/modules/cockpit/tests` 退出 0，既有用例数不减少。
- [ ] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`）上用 MCP 浏览器（不可用时用一次性 Playwright 并写明）在 1440、1280、1100、800 四个宽度实际操作并截图存 `tmp/`：展开与收起各一张；读出列与会话 header 的矩形并贴在完成记录里；1440 截图与效果图 `150-pc-open.png` 并排对照（列从顶到底、tab 只在左侧）。场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json …` 贴出 JSON 报告。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-pc-column-full-height-layout.md
- src/modules/project-workspace/WorkspaceMain.tsx
- src/modules/project-workspace/ProjectWorkspaceShell.tsx
- src/modules/project-workspace/ProjectMainRegion.tsx
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/cockpit/CockpitColumn.tsx
- src/modules/cockpit/cockpitColumnController.ts
- src/modules/cockpit/hooks/useCockpitColumn.ts
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/cockpit/tests/cockpitColumnController.test.ts
- src/modules/chat/outline/InputOutlineDrawer.tsx
- src/modules/chat/outline/InputOutlineHandle.tsx
- src/modules/chat/ChatInterface.tsx
- e2e/cockpit-column-layout.spec.ts (new)
- server/shared/tests/architecture-ratchet.baseline.json
