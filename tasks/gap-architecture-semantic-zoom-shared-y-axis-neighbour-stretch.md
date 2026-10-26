---
id: gap-architecture-semantic-zoom-shared-y-axis-neighbour-stretch
title: 架构图语义缩放：并排类共享 y 轴时相邻类 minHeight 撑高格子，33% 档 package 底部残留空白
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

现象：Architecture 页类图（`src/modules/architecture/semanticZoomLayout.ts` 的 `solveAxis` y 轴求解）在 33% 缩放档，左右并排的两个类共享同一段 y 轴时，文字被隐藏的那个类（如 `VoiceFrameProcessor`，tier A、成员行不画）带着 `entry.plan.minHeight` 的 `minLength` 约束，把与它同 y 区间的邻居（`FrameBudgetLedger`，带成员行）的格子撑高；邻居的画出框已按行所需高度收短，但 package 框跟的是 cell，于是 package 底部残留约 47px 空白（e2e 夹具 `architecture-canvas-layout-workspace-node-size`，PC 视口，缩放 33%，读数 `maxPkgBottomGap=47`；100%/65%/46% 档为 10/6/5px）。

机制（不是症状）：y 轴是一维共享的——各类的 `yElements` 在同一组断点上累加，`minLength` 约束只拉长断点间距，无法只拉长其中一个类所在的列。已知处理方向（二选一或组合，由执行者实测后定）：(a) 隐藏成员的类不再以 `plan.minHeight` 作 y 约束，改为只约束它自己的 title 带，让邻居的可回收区间（`reclaim` 元素）仍能折叠；(b) package 框的 bottom 取其子项 `drawn` 的最大底边加固定边距，而不是 cell 的底边。不改 x 轴，不改 `MEMBER_FRAME_BOTTOM_PADDING_PX`。

关联：相邻的已落地方向是「成员行可见时类框回收空白」（`reclaim` 区间 + 画出高度取行所需），本任务只处理它在并排邻居场景下残留的 package 底部空白。

## AC

- [ ] 新增单测（`src/modules/architecture/tests/semanticZoomLayout.test.ts`）：两个并排类（一个 tier A 带成员行，一个成员行因高度不足被隐藏，二者 y 区间重叠），scale 0.33、`forceTier: 'A'`，断言 package 框底边与带成员行类的 `drawn` 底边之差不超过 16px；命令 `npx vitest run src/modules/architecture/tests/semanticZoomLayout.test.ts` 退出码 0。
- [ ] 同一单测在回退本任务对 `semanticZoomLayout.ts` 的改动后为红（负臂：`git stash` 该文件后重跑，退出码非 0，红在上条断言上）。
- [ ] `npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出。
- [ ] e2e：`npx playwright test e2e/architecture-canvas-layout.spec.ts -g "orientation|downward layout|two-entity chain|perimeter"` 退出码 0（与本任务前相比无新增红）。

## DoD

在真实运行的页面（e2e 隔离实例或隔离 :31xx 实例，复制库须关 residentRestore）上，用 `architecture-canvas-layout-workspace-node-size` 夹具打开类图，依次缩放到 100%、65%、46%、33% 四档，每档读 package 框底边与其内最低类框底边的差并截图存 `tmp/`：四档均不超过 16px，类框之间无重叠，类框下方空白不比本任务前更大；同时贴出 `node scripts/ui-scenario.mjs` 的 JSON 报告（存在可用的架构场景时）。仅单测通过不算完成。

## Touches

- src/modules/architecture/semanticZoomLayout.ts
- src/modules/architecture/semanticZoomPlan.ts
- src/modules/architecture/tests/semanticZoomLayout.test.ts
- e2e/architecture-canvas-layout.spec.ts
- tasks/gap-architecture-semantic-zoom-shared-y-axis-neighbour-stretch.md
