---
id: gap-cockpit-column-workspace-width
title: PC 驾驶舱列按工作区可用宽度布局：侧栏展开时 1280 不再把会话挤到 591px，列宽自适应并保留最小可读会话宽度
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

来源：2026-10-29 实测。`createCockpitColumnController` 用 `window.innerWidth` 决定布局（`viewportWidth >= 1280` 挤压、`>= 900` 覆盖），但列与会话共享侧栏之外的工作区：侧栏展开 289px、列 400px 时，1440 的会话区只剩 751px，1280 只剩 591px；1280 正好是挤压的下界，于是会话被挤到 591 且 tab 条退化成图标。更窄的 1024 则进入覆盖式，列整块盖住会话。

本任务把布局输入从「视口宽度」改成「工作区可用宽度」：`useCockpitColumn` 用 ResizeObserver 观察 `[data-workspace-session-layout]`（或等价的会话区容器），把「工作区宽度 = 容器宽度 − 列自身宽度」喂给 controller；controller 先算列宽 `clamp(320, 工作区*0.34, 400)`（用户拖过的宽度优先），再只在 `工作区 − 列宽 >= 640` 时挤压，否则在 `工作区 >= 600` 时覆盖，再小则不挂载。这样 1440 仍是 400+751，1280 变成 320+671（而不是 400+591），1024 进入覆盖式。`cockpit-pc-right-column` 钉住的「视口 899/900/1279/1280」边界随之改为工作区轴，测试与完成记录写明这是有意取代；用户手动拖宽使会话低于 640 时，按覆盖式处理或把宽度夹到上限，二者选一并在完成记录说明。

约束：不改卡片、键盘归属与会话链接的既有规则；不改列的展开记忆（`cockpit.column.v1`）；`WorkspaceMain.tsx` 只负责提供容器或尺寸，不复制布局判断；布局判断仍只在 controller 里。

## AC

- [ ] `npx vitest run src/modules/cockpit/tests/cockpitColumnController.test.ts` 退出 0：新增以工作区宽度为输入的三组读数（1151/991/735）与列宽 400/320，断言挤压时 `工作区 − 列宽 >= 640`、991 下得到 320+671、735 下为覆盖式；原有视口边界用例改成工作区语义，并在用例名或注释写明取代。
- [ ] 同文件新增：controller 不再直接读 `window.innerWidth`（注入的 `readWorkspaceWidth` 是唯一来源；用一个会抛错的 `window.innerWidth` getter 或 spy 断言未被读取）。
- [ ] `npx vitest run src/modules/cockpit/tests/CockpitColumn.test.tsx` 退出 0：用桩 ResizeObserver 把容器宽度从 1440 改到 1280，列宽从 400 夹到 320、会话区保持 ≥640；假形态改回视口输入 ⇒ 该用例红。
- [ ] 同文件新增拖宽用例退出 0：用户拖到 720 且工作区 991 时会话只剩 271，断言不退化成挤压（覆盖式或宽度被夹住），且 `cockpit.column.v1` 的宽度记忆不被静默改写。
- [ ] `npm run typecheck`、`npm run lint` 退出 0；若 `WorkspaceMain.tsx` 或 controller 越过基线，按 AC-394 RECORDED CHANGE 格式记录。

## DoD

真实页面（MCP 浏览器，真实数据；侧栏展开）：

1. 1440×900：读 `[data-workspace-session-area]`、`[data-testid="cockpit-column"]` 的宽度与 `data-cockpit-column-layout`，截图；会话区 ≥640。
2. 1280×900：同一组读数，断言会话区 ≥640（建议 671），tab 条仍可读或干净退到 overflow，截图。
3. 1024×900：断言进入覆盖式，截图；说明覆盖式下打开会话链接自动收起仍成立。
4. 拖动列宽到 720（1280 下）：读布局与会话区，确认不会把会话挤到 640 以下；截图。
5. 场景运行器 `cockpit-mode-switch.json` 与 `cockpit-cards-confirm.json` 各跑一次并贴 JSON；截图存 `tmp/`。

## Touches

- tasks/gap-cockpit-column-workspace-width.md
- src/modules/cockpit/cockpitColumnController.ts
- src/modules/cockpit/hooks/useCockpitColumn.ts
- src/modules/cockpit/CockpitColumn.tsx
- src/modules/project-workspace/WorkspaceMain.tsx
- src/modules/cockpit/tests/cockpitColumnController.test.ts
- src/modules/cockpit/tests/CockpitColumn.test.tsx
- src/modules/project-workspace/tests/workspaceTabsResponsive.test.tsx
- server/shared/tests/architecture-ratchet.baseline.json