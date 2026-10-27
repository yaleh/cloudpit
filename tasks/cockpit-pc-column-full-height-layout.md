---
id: cockpit-pc-column-full-height-layout
title: PC 驾驶舱列满高：列与「会话 header + 会话内容」平级、从页面顶到底；会话 header（tab 等）只占左侧；覆盖式抽屉打开时输入大纲把手让位
status: done
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

- [x] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0，新增用例：挤压式展开时列的容器是会话区（含 header）的兄弟节点而不在会话内容内部；列内含标题行与收起按钮，收起按钮与 header 按钮驱动同一状态。
- [x] `npx vitest run src/modules/cockpit/tests/cockpitColumnController.test.ts` 退出 0（既有用例不减）；若覆盖式下输入大纲把手的让位由 controller 读数驱动，新增对应用例。
- [x] 新增或扩展一条 e2e：`npx playwright test e2e/cockpit-column-layout.spec.ts` 退出 0。1440×900 下展开列后断言：列的 `getBoundingClientRect().top` ≤ 1 且 `height` ≥ 视口高度 − 1；会话 header 的 `right` ≤ 列的 `left` + 1；收起后会话 header 的 `right` 等于收起前未展开时的读数（容差 1px）。1100×800 下展开覆盖式抽屉后，输入大纲把手与抽屉矩形不相交（或把手不可见）。失败时打印各矩形读数。
- [x] 现有测试不退：`npx vitest run src/modules/project-workspace/tests src/modules/cockpit/tests` 退出 0，既有用例数不减少。
- [x] `npm run typecheck`、`npm run lint` 与 `npm run build:client` 退出 0；提交前单跑 `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` 退出 0。

## DoD

隔离实例（`scripts/isolated-instance.sh start`，打开 `cockpit.fixtureCards`）上用 MCP 浏览器（不可用时用一次性 Playwright 并写明）在 1440、1280、1100、800 四个宽度实际操作并截图存 `tmp/`：展开与收起各一张；读出列与会话 header 的矩形并贴在完成记录里；1440 截图与效果图 `150-pc-open.png` 并排对照（列从顶到底、tab 只在左侧）。场景运行器：`node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json …` 贴出 JSON 报告。实例用毕 `scripts/isolated-instance.sh stop`。

## Touches

- tasks/cockpit-pc-column-full-height-layout.md
- src/modules/project-workspace/WorkspaceMain.tsx
- src/modules/project-workspace/ProjectWorkspaceShell.tsx
- src/modules/project-workspace/ProjectMainRegion.tsx
- src/modules/project-workspace/WorkspaceHeader.tsx
- src/modules/cockpit/CockpitColumn.tsx
- src/modules/cockpit/index.ts
- src/modules/cockpit/contract/index.ts
- src/modules/cockpit/contract/columnVisibility.ts
- src/modules/cockpit/cockpitColumnController.ts
- src/modules/cockpit/hooks/useCockpitColumn.ts
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/cockpit/tests/cockpitColumnController.test.ts
- src/modules/chat/outline/InputOutlineDrawer.tsx
- src/modules/chat/outline/InputOutlineHandle.tsx
- src/modules/chat/ChatInterface.tsx
- e2e/cockpit-column-layout.spec.ts (new)
- playwright.config.ts
- server/shared/tests/architecture-ratchet.baseline.json

## 完成记录（2026-10-27）

### 实现

- `src/modules/cockpit/CockpitColumn.tsx` 新增导出 `CockpitColumnRegion`：「会话区（header + 各视图 + composer）」作为一行 flex 的第一个子节点，`CockpitColumn` 是它的**兄弟**。列收起时 `CockpitColumn` 渲染 null，因此这一行只剩原来的会话区，DOM 与改动前一致（既有用例「collapsed」逐字节比较 innerHTML 仍然通过）。
- `src/modules/project-workspace/WorkspaceMain.tsx` 把 `WorkspaceHeader`、resident 提示、内容行整体放进 `CockpitColumnRegion`，并删掉原先挂在内容行内部的 `<CockpitColumn />`。于是 ≥1280 时列从页面顶到底、header 收窄到列的左边缘；900–1279 的覆盖式也因此从页面顶起满高。
- `src/modules/cockpit/contract/columnVisibility.ts` + `contract/index.ts`：新增纯函数 `cockpitColumnCoversSession(visibility)`（仅 `layout === 'overlay' && expanded` 为真）。放在 leaf contract 里，chat 模块经 `@/modules/cockpit/contract` 读取，因此不必改 `ChatInterface.tsx`（1477 行 oversize ratchet 基线文件未被触碰）。
- `src/modules/chat/outline/InputOutlineDrawer.tsx`：读该读数，覆盖式展开时不渲染 `InputOutlineHandle`；列收起后把手恢复。挤压式下列在会话区右侧之外，把手保留（实测 1440 展开时把手 right=1025 < 列 left=1040，不重叠）。
- `playwright.config.ts`：把新 spec 同时加入 `DEBUG_AGENT_SPEC_FILES`（播种一个真实会话）与 `COCKPIT_SPEC_FILES`（写入 `cockpit.enabled=true` 的 server settings），这是 e2e 夹具通道所必需。
- 未改卡片组件、卡片 controller、过滤与 Details。

### 验证（develop 合并后重跑）

- `npm run typecheck` → 0；`npm run lint` → 0（仅既有 warning）；`npm run build:client` → 0（32.75s）。
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 pass / 0 fail（无基线上调，未新增 RECORDED CHANGE）。
- `npx vitest run src/modules/project-workspace/tests src/modules/cockpit/tests` → 31 files / 334 tests passed，0 failed。新增 3 条（`CockpitColumn.test.tsx` 2 条：兄弟节点关系；标题行收起按钮与 header 按钮同态。`cockpitColumnController.test.ts` 1 条：`cockpitColumnCoversSession` 只在 overlay+expanded 为真），既有用例一条未删。
- `npx playwright test e2e/cockpit-column-layout.spec.ts` → 2 passed (19.1s)。用例内打印的读数：
  - 1440×900 squeeze-open：`column={"top":0,"left":1040,"right":1440,"bottom":900,"width":400,"height":900}`，`header={"right":1040,"height":57}`；squeeze-closed：`header={"right":1440}`。
  - 1100×800 overlay-open：`column={"top":0,"left":700,"right":1100,"bottom":800,"width":400,"height":800}`，`outlineHandle=null`；overlay-closed：`outlineHandle={"left":1047,"right":1085}`。
- `node scripts/ui-scenario.mjs e2e/scenarios/cockpit-cards-confirm.json …` → 退出 0，6/6 步通过，23.8s：

```json
{"ok":true,"failedStep":null,"durationMs":23792,"steps":[{"index":1,"action":"open:cockpit-cards","ok":true,"failures":[]},{"index":2,"action":"drive:cockpitCard.select","ok":true,"failures":[]},{"index":3,"action":"drive:cockpitCard.showOption","ok":true,"failures":[]},{"index":4,"action":"drive:cockpitCard.confirm","ok":true,"failures":[]},{"index":5,"action":"drive:cockpitCard.select","ok":true,"failures":[]},{"index":6,"action":"expect","ok":true,"failures":[]}]}
```

完整报告：`tmp/ui-scenario-report.json`，检查点截图 `tmp/ui-scenario/step-1..5-*.png`。

### DoD：隔离实例四宽度实测

**MCP 浏览器在本会话不可用**，因此按任务允许的方式改用一次性 Playwright 脚本 `tmp/dod-column-drive.mjs`（真实生产构建，直连隔离实例 `127.0.0.1:15555`），在 1440、1280、1100、800 四个宽度实际点击展开/收起并截图。原始读数：`tmp/dod-column-readings.json`。

| 宽度 | 展开后列（top / height / left–right） | 会话 header right | 收起后 header right | 输入大纲把手 |
| --- | --- | --- | --- | --- |
| 1440×900（squeeze） | 0 / 900 / 1040–1440 | 1040（展开前 1440） | 1440 | 有，right=1025（列左 1040，不重叠） |
| 1280×800（squeeze） | 0 / 800 / 880–1280 | 880（展开前 1280） | 1280 | 有，right=865（列左 880） |
| 1100×800（overlay） | 0 / 800 / 700–1100 | 1100（覆盖，不变） | 1100 | 展开时 count=0（让位）；收起恢复 right=1085 |
| 800×700（phone） | 不存在（header 按钮 count=0） | 800 | — | 有，right=785 |

每次操作后的 `aria-pressed`：展开 `true`、收起 `false`；列内标题行（`cockpit-column-count`）与收起按钮（`cockpit-column-collapse`）在三个 ≥900 宽度展开时均存在。

截图（`tmp/`）：

- `dod-column-1440-open.png`、`dod-column-1440-closed.png`、`dod-column-1440-collapsed.png`
- `dod-column-1280-open.png`、`dod-column-1280-closed.png`、`dod-column-1280-collapsed.png`
- `dod-column-1100-open.png`、`dod-column-1100-closed.png`、`dod-column-1100-collapsed.png`
- `dod-column-800-closed.png`

**与效果图 `tmp/cockpit-redesign/150-pc-open.png` 并排对照**：列从页面 y=0 一直到页面底部（效果图为 0–900，实测 0–900）；会话 header（标题 + Chat/Quay/… tab）止于列的左边缘，不再横跨列；列顶部是「Cockpit + 计数 + 收起按钮」标题行，下面是卡片列表与输入区；侧栏宽度与位置不变。差异仅限任务范围外：效果图多一排过滤 chip、卡片视觉更密（卡片组件/过滤由其它任务负责，本任务按约束未改）。

### 环境备注

- 隔离实例启动脚本的 boot settings 只写死 `residentRestore`，而设置只在启动时读一次；为打开 `cockpit.fixtureCards`，用了一份 gitignored 的一次性副本 `tmp/isolated-instance-cockpit.sh`（settings 增加 `"cockpit": {"enabled": true, "fixtureCards": true}`）。
- `ui-scenario` 需要 Vite 开发构建的语义面，因此让它经 `127.0.0.1:5199` 的 Vite dev server 代理到隔离实例（`SERVER_PORT=15555`，注意 env 要跟在 `env` 后作用于 vite 进程而不是管道左侧的 `tail`）。
- 实例已用 `scripts/isolated-instance.sh stop` 停止；Vite 后台进程一并停止。

### ADR-007 暗轴记录

该轴仍暗,理由:本任务只改前端布局与 cockpit leaf contract 导出,未在本任务 AC 内运行 L_D/L_G 探针,无读数可记
