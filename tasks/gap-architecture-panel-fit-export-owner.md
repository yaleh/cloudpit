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

- [x] 属主文件存在且不依赖 React：`grep -lE "export function create(Architecture)?(FitExport|Fit|Export)[A-Za-z]*Controller" src/modules/architecture/*.ts` 至少列出 1 个文件，且对每个列出的文件 `grep -n "from 'react'" <file>` 无输出。
- [x] 下列声明已从面板中清零：`grep -cE "const \[?(fitRequest|fitTokenRef|zoomModeRef|filledViewportMeasuredRef|lastFillsViewportRef|pendingRefreshFitRef|wasFullscreenRef|exportStatus|copyFallbackText|copyFallbackRef|drawnPlantUml|drawnPlantUmlRef|diagramView|refreshDialogOpen|refreshReturnFocusRef|scopeHiddenDelta|scopeReadingRef|scopeResultRef)\\b" src/modules/architecture/ArchitecturePanel.tsx` 输出 0。
- [x] 属主可脱离 React 测试：新增对应 `tests/*Controller.test.ts`，用假剪贴板/下载/时钟覆盖：Fit 令牌发出与应答、刷新完成后补一次 Fit 且只一次、全屏退出恢复、导出成功/失败/降级为复制文本的状态转换、刷新对话关闭后焦点返回、dispose 后忽略应答；相应 `npx vitest run <新测试文件>` 退出码 0。
- [x] 行数只降不升：`wc -l src/modules/architecture/ArchitecturePanel.tsx` 小于本任务开始时的行数（以 `server/shared/tests/architecture-ratchet.baseline.json` 当前值为准），且该基线同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [x] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出。

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

## Evidence

实现提交：`837037888`（`refactor(architecture): move fit, export and refresh-dialog state into an owner`），5 files changed，+1101/−235（其中新属主 569 行、新测试 375 行）。

- AC1：`grep -lE "export function create(Architecture)?(FitExport|Fit|Export)[A-Za-z]*Controller" src/modules/architecture/*.ts` → `src/modules/architecture/architectureFitExportController.ts`；对该文件 `grep -n "from 'react'"` 无输出。
- AC2：同命令 `grep -cE …` → `0`（18 个声明名全部清零；面板仅剩 `useRef` 一处 `portraitPhoneRef`，另有新命名的 `readoutRowRef` / `copyFallbackTextareaRef` / `refreshDialogReturnFocusRef`，均不匹配该正则）。
- AC3：`npx vitest run src/modules/architecture/tests/architectureFitExportController.test.ts` → 10 tests / 10 passed，退出码 0。覆盖 Fit 令牌与手动缩放应答、刷新后强制 Fit 恰好一次、全屏焦点往返、导出 copied/notReady/pngScaled/pngFailed、剪贴板拒绝降级、刷新对话成功自动关闭与 return-focus、dispose 忽略迟到应答并可被重新订阅唤醒。
- AC4：`wc -l src/modules/architecture/ArchitecturePanel.tsx` → `4685`（任务开始时基线 4780）；同一提交把 `server/shared/tests/architecture-ratchet.baseline.json` 的该文件读数下调为 4685，并删除已低于阈值（20 次）的 `hookStateHeavy` 条目；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` → 6/6，退出码 0。
- AC5：`npx vitest run src/modules/architecture` → 44 files / 687 tests 全绿，退出码 0；`npx tsc --noEmit -p .` 无输出，退出码 0。
- DoD 单测三条：`fullscreen.test.tsx` 7/7、`exportMenu.test.tsx` 14/14、`architectureRefreshDialog.test.tsx` 8/8，退出码 0。`exportMenu.test.tsx` 的「下载机制只有一份」断言已随属主迁移改写：面板与文本页仍共用 `architectureExportFilename`，文本页仍导入 `downloadTextFile`，新属主导入 `downloadTextFile`/`downloadBlob`/`rasterizeSvgToPng`，面板不再导入下载实现。
- DoD 真实页面：用一次性 Playwright spec（复用 `e2e/support/architectureFixture.ts` 同款 fixture 与 debug-agent 会话；临时登记 `DEBUG_AGENT_SPEC_FILES`，跑完已 `git checkout -- playwright.config.ts` 并删除 spec，二者都不在提交里）驱动真实 server + Vite client + Chromium。读数：Fit 前先 zoom-in 使 `data-architecture-fit=manual`，点 Fit 后 `fit=auto`、`fit-viewport=1127x572`、`zoom-mode=fit`、`scale=1.5`；导出 PlantUML 下载 380 字符且含 `@startuml`/`Alpha`，SVG 下载 8210 字符，复制后 live region 报 copied 且剪贴板含 `@startuml`；把 `navigator.clipboard.writeText` 改成 reject 后复制 → 降级对话框出现且文本框内容含 `@startuml`，关闭后移除；作用域读数 `summary=3 / total=3 / visibleNodes=3`；刷新对话打开→Cancel→关闭，`document.activeElement` 回到触发按钮。截图 8 张在 `tmp/architecture-fit-export-dod/`（01-loaded、02-fit-to-view、03-export-menu、04-copy-succeeded、05-copy-fallback、06-scope-readout、07-refresh-dialog、08-focus-returned）。
- DoD e2e：`npx playwright test e2e/architecture-fullscreen.spec.ts` → 4 passed（32.0s），截图在 `tmp/architecture-fullscreen/`；`npx playwright test e2e/architecture-refresh.spec.ts` → 2 passed（41.5s），截图在 `tmp/architecture-refresh/`（含 05-succeeded、06-failed-retry 与控制臂 07/08）。两条 spec 分开跑：本仓 e2e 是单用户 auth，同一 invocation 内第二个 spec 的 `register` 必然 403 `AUTH_USER_ALREADY_CONFIGURED`（已知基线，见 `architecture-keyboard-e2e-baseline-red-and-single-user`）；合并成一条命令的失败是这条基线，不是本任务回归，各自的退出码均为 0。
- 全屏的「进入再退出视图恢复」由 `architecture-fullscreen.spec.ts` 三视口腿覆盖（overlay 与 host 覆盖视口、退出后 canvas 矩形逐边 ±1px 还原、焦点入场、Escape 退出）；刷新后的「补一次 Fit」由 `architecture-refresh.spec.ts` 主臂（成功后 refetch 并 fit）与本任务新属主单测（强制且只一次）共同覆盖。

## ADR-007 dark-axis record

L_D 该轴仍暗，理由：本任务只是把面板层请求/应答状态收进属主，行为等价，不新增领域数据能力，没有可读的领域数据量。
L_G 该轴仍暗，理由：纯重构不产出生成质量读数；本任务的读数是行数、grep 计数与退出码。
