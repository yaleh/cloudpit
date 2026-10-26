---
id: gap-architecture-panel-fit-export-owner
title: ArchitecturePanel 切片 4：Fit/全屏请求、导出与刷新对话状态收进属主
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-architecture-panel-search-reveal-owner
---
## Proposal

<!-- dedup-ref --> `ArchitecturePanel.tsx` 的第四个切片，收面板层的 Fit 请求、全屏、导出与刷新对话状态；与 `gap-architecture-graph-viewport-owner`（画布内的缩放/视口属主）分工明确：本任务只管面板向画布「发出」的 Fit 请求与面板级全屏、导出、刷新，不重复画布内状态。

现状（2026-10-26 实测）：`ArchitecturePanel.tsx`（5023 行）里这一簇是请求/应答与一次性标志：Fit `fitRequest`、`fitTokenRef`、`zoomModeRef`、`filledViewportMeasuredRef`、`lastFillsViewportRef`、`pendingRefreshFitRef`（刷新后需要补一次 Fit）、`wasFullscreenRef`（全屏退出后的恢复）；导出 `exportStatus`、`copyFallbackText`、`copyFallbackRef`、`drawnPlantUml`/`drawnPlantUmlRef`（镜像对）、`diagramView`；刷新对话 `refreshDialogOpen`、`refreshReturnFocusRef`；作用域读数 `scopeHiddenDelta`、`scopeReadingRef`、`scopeResultRef`。它们表达「Fit 令牌何时发、何时算已应答」「刷新完成后是否补 Fit」「导出成功/失败/降级复制的状态转换」等规则。

做法：新增 `src/modules/architecture/architectureFitExportController.ts`（或按耦合度拆成 fit 与 export 两个属主），导出 `create…Controller(deps)`：命令 + `subscribe`/`getSnapshot` + `dispose`；导出能力（剪贴板、下载）与时钟经注入 seam 传入；`drawnPlantUml` 只有属主一份，镜像 ref 删除。面板只订阅快照并渲染。遵循 `.agents/skills/frontend-module-standards/SKILL.md` 的「Encapsulate state behind an owner」。

## AC

- [ ] 属主文件存在且不依赖 React：`grep -lE "export function create(Architecture)?(FitExport|Fit|Export)[A-Za-z]*Controller" src/modules/architecture/*.ts` 至少列出 1 个文件，且对每个列出的文件 `grep -n "from 'react'" <file>` 无输出。
- [ ] 下列声明已从面板中清零：`grep -cE "const \[?(fitRequest|fitTokenRef|zoomModeRef|filledViewportMeasuredRef|lastFillsViewportRef|pendingRefreshFitRef|wasFullscreenRef|exportStatus|copyFallbackText|copyFallbackRef|drawnPlantUml|drawnPlantUmlRef|diagramView|refreshDialogOpen|refreshReturnFocusRef|scopeHiddenDelta|scopeReadingRef|scopeResultRef)\b" src/modules/architecture/ArchitecturePanel.tsx` 输出 0。
- [ ] 属主可脱离 React 测试：新增对应 `tests/*Controller.test.ts`，用假剪贴板/下载/时钟覆盖：Fit 令牌发出与应答、刷新完成后补一次 Fit 且只一次、全屏退出恢复、导出成功/失败/降级为复制文本的状态转换、刷新对话关闭后焦点返回、dispose 后忽略应答；相应 `npx vitest run <新测试文件>` 退出码 0。
- [ ] 行数只降不升：`wc -l src/modules/architecture/ArchitecturePanel.tsx` 小于本任务开始时的行数（以 `server/shared/tests/architecture-ratchet.baseline.json` 当前值为准），且该基线同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [ ] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：点「Fit to view」图居中；进入全屏再退出后视图恢复；打开导出菜单分别导出 PlantUML、SVG 与复制（剪贴板被拒时出现降级文本框）；点刷新分析并确认对话关闭后焦点回到触发按钮、图补一次 Fit；作用域读数与图一致。同时跑 `npx vitest run src/modules/architecture/tests/fullscreen.test.tsx src/modules/architecture/tests/exportMenu.test.tsx src/modules/architecture/tests/architectureRefreshDialog.test.tsx` 与 `npx playwright test e2e/architecture-fullscreen.spec.ts e2e/architecture-refresh.spec.ts` 退出码均为 0。仅单测通过不算完成。

## Touches

- src/modules/architecture/ArchitecturePanel.tsx
- src/modules/architecture/architectureFitExportController.ts
- src/modules/architecture/exportArtifacts.ts
- src/modules/architecture/tests/architectureFitExportController.test.ts
- src/modules/architecture/tests/fullscreen.test.tsx
- src/modules/architecture/tests/exportMenu.test.tsx
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-panel-fit-export-owner.md
