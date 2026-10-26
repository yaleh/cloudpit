---
id: gap-architecture-graph-viewport-owner
title: PlantUmlGraph 切片 3：缩放、视口与自动 Fit 状态收进 React-free 属主
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-architecture-graph-gesture-owner
---
## Proposal

<!-- dedup-ref --> 同一组件 `PlantUmlGraph.tsx` 的第三个切片，只收缩放/视口/自动 Fit；与已有纯函数 `svgViewport.ts`（几何读数）、`solveFitArea`/`solveFitScale`（`semanticZoomLayout.ts`）是调用关系，不改它们的算法。

现状（2026-10-26 实测）：`PlantUmlGraph.tsx`（4453 行）里缩放与视口这一簇分散在多处：`zoom`/`zoomRef`、`viewportRef`、`packageFocus`、`fullscreenInsets`、`fitViewportReading`、`lastFlowViewportRef`（第 1215–1288 行）、`autoFitTimerRef`（第 2893 行）、`onZoomModeChangeRef`、`fitDiagramRef`、`answeredFitTokenRef`（第 3102–3116 行）。规则散落在不同 effect 里：什么时候自动 Fit、被用户缩放后何时不再自动 Fit、全屏 insets 变化如何重新 Fit、Fit 请求令牌如何应答、缩放模式变化如何上报。`zoom` 与 `zoomRef` 互为镜像，定时器在一个 effect 里启动、在另一个里清除。

做法：新增 `src/modules/architecture/graphViewportController.ts`，导出 `createGraphViewportController(deps)`：命令（setZoom/zoomBy、requestFit(token)、setFullscreenInsets、focusPackage、reportViewport）+ `subscribe`/`getSnapshot` + `dispose`（清自己的定时器）；时钟与 DOM 读数（`svgViewport.ts` 的读数函数）经注入 seam 传入；Fit 令牌应答与「用户已手动缩放则停止自动 Fit」的规则都在属主内，单一写路径。组件只订阅快照并把 host 尺寸喂给属主。遵循 `.agents/skills/frontend-module-standards/SKILL.md` 的「Encapsulate state behind an owner」。

## AC

- [x] 属主文件存在且不依赖 React：`grep -nE "export function createGraphViewportController" src/modules/architecture/graphViewportController.ts` 有命中（第 157 行），且 `grep -n "from 'react'" src/modules/architecture/graphViewportController.ts` 无输出。
- [x] 下列声明已从组件中清零：`grep -cE "const \[?(zoom|zoomRef|viewportRef|packageFocus|fullscreenInsets|fitViewportReading|lastFlowViewportRef|autoFitTimerRef|onZoomModeChangeRef|fitDiagramRef|answeredFitTokenRef)\b" src/modules/architecture/PlantUmlGraph.tsx` 输出 0。
- [x] 属主可脱离 React 测试：新增 `src/modules/architecture/tests/graphViewportController.test.ts`（假时钟 + 注入 fit/autoFit 动作），覆盖：自动 Fit 的触发与去抖（100+50ms 合并为一次）、用户手动缩放后停止自动 Fit、全屏 insets 变化触发重新 Fit（<0.5px 视为未变）、同一 Fit 令牌只应答一次（manual 下拒绝，force 只对新令牌生效）、缩放步进被钳在 `clampZoomScale` 范围（MIN 0.05 / MAX 4）、dispose 清掉定时器；`npx vitest run src/modules/architecture/tests/graphViewportController.test.ts` → 9 passed，退出码 0。
- [x] 行数只降不升：`wc -l src/modules/architecture/PlantUmlGraph.tsx` = 4291，小于任务开始时的基线 4343；`server/shared/tests/architecture-ratchet.baseline.json` 在同一提交里下调 `oversizeFiles` 4343→4291、`hookStateHeavy` 46→35；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` → 6 passed，退出码 0。
- [x] 回归：`npx vitest run src/modules/architecture` → 38 files / 636 tests passed；`npx tsc --noEmit -p .` 无输出；两条 e2e 各 5 passed / exit 0。注：同一调用里跑两个 spec 时第二个 spec 建号被拒（`AUTH_USER_ALREADY_CONFIGURED`，本仓单用户认证），故按文件分两次调用：`npx playwright test e2e/architecture-fit-contract.spec.ts`（5 passed, 3.1m）与 `npx playwright test e2e/architecture-fullscreen-fit.spec.ts`（5 passed, 1.3m）。合并 develop 后重跑同样各 5 passed。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：打开类图后自动 Fit 到画布；点 +/− 与滚轮缩放后窗口缩放不再自动 Fit；点「Fit to view」恢复；进入与退出全屏时图随 insets 重新居中；390×844 手机视口下顶部 chrome 色带下居中。读 `data-architecture-zoom-scale` 与画布尺寸并贴出。仅单测通过不算完成。

## 完成记录

### 实现

- `graphViewportController.ts`（300 行）：`createGraphViewportController({clock?, debounceMs?, autoFitDisabled?, initialZoom?})` 持有 `zoom`（scale + auto/manual）、`packageFocus`、`fullscreenInsets`、`fitViewport` 的单一快照，150ms 去抖定时器、Fit 令牌只应答一次、insets 变化自触发重新 Fit、缩放钳制；`setActions` 注入 DOM 绑定的 `fit`/`autoFit`/`onZoomModeChange`。`dispose` 只清定时器且可重新武装（StrictMode 的 cleanup→setup 不会废掉实例）。
- `PlantUmlGraph.tsx`：删掉 9 个状态/镜像 ref 与两个 ref 通道，改为 `useMemo` 创建属主 + `useSyncExternalStore` 订阅；语义路径与 CSS 路径的 Fit 留在组件内由属主决定「何时」调用。行数 4343→4291，hookStateHeavy 46→35。

### 两条既有 e2e 基线红（先证与本改动无关，再修判据）

两条都在 `HEAD~1`（未改的 4343 行组件）上复现出逐字相同的读数：

- `architecture-fit-contract.spec.ts` phone-390x844：`s@phone-390x844.load ... readout=""`，期望 `150%`。原因：9ba46e811 把竖屏缩放簇收成一个 44px 按钮，spec 的读取器只找展开态的 `[data-architecture-zoom-cluster-level]`，且第 454 行直接点 `[data-architecture-zoom-fit]:visible`（收起态不可见）。修复：收起态按钮同时带 `data-architecture-zoom-cluster-level`（它本来就是该形态下的百分比读数）；spec 在第一次按控件前展开缩放簇，并让两个 touch 档都经 Adjust sheet 进全屏（原先只对 `height<=400` 开 sheet）。
- `architecture-fullscreen-fit.spec.ts` 控制臂：`control host=1440x765 ... drawing=923x573 fill=87.8%`，固定 85% 地板判不出红（保留边距后绘图仍占可用区 87.8%）。修复：改为与同一读取器的 repaired 臂比较（defect 87.8% < repaired 99.9% − 5%），levers 被忽略时两臂读数相等、判据转红。
- 两处判据修复与基线下调在 `fc00949d4`，Touches 已补两个 e2e 文件。

### DoD 读数（隔离实例真实页面；截图 `tmp/architecture-graph-viewport/`）

| 状态 | data-architecture-zoom-scale | mode | 画布 (host) | 绘图 |
| --- | --- | --- | --- | --- |
| 01 打开类图（自动 Fit） | 0.2401 | fit | 1151×596 | 1128×294 |
| 02 点 + 两次 | 0.3752 | custom | 1151×596 | 1178×360 |
| 03 点 − | 0.3001 | custom | 1151×596 | 1148×323 |
| 04 滚轮 | 1.4333 | custom | 1151×596 | 4107×1019 |
| 05 窗口缩到 1200×700 | 1.4333（未重 Fit） | custom | 911×501 | 4107×1019 |
| 06 窗口放回 1440×765 | 1.4333（仍未重 Fit） | custom | 1151×596 | 4107×1019 |
| 07 点「Fit to view」 | 0.2401（恢复） | fit | 1151×596 | 1128×294 |
| 08 进入全屏 | 0.4652 | fit | 1440×765（fit-viewport 1349×652） | 1350×405 |
| 09 退出全屏 | 0.2401 | fit | 1151×596 | 1128×294 |
| 10 手机 390×844 | 0.1233 | fit | 390×637（fit-viewport 382×549） | 383×156，限幅比 1.00 |

手机档：绘图水平居中于画布（中心差 0.5px），横向不超出出版的 Fit 框（382×549），说明居中是在 chrome 收窄后的可用区上解出来的，不是整块 host。

### 合并与门

`git merge --no-edit develop` → `4066eac8a`，无冲突。合并后重跑：`tsc` exit 0、`vitest run src/modules/architecture` 38/636 绿、ratchet 6/6 绿、两条 e2e 各 5 passed、DoD 走查 1 passed（读数与上表一致）。

## Touches

- src/modules/architecture/PlantUmlGraph.tsx
- src/modules/architecture/graphViewportController.ts
- src/modules/architecture/svgViewport.ts
- src/modules/architecture/tests/graphViewportController.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- e2e/architecture-fit-contract.spec.ts
- e2e/architecture-fullscreen-fit.spec.ts
- tasks/gap-architecture-graph-viewport-owner.md

## ADR-007

- 该轴仍暗,理由:本任务收拢的是画布的缩放/视口/自动 Fit 规则，验收读数是行数与 hook 状态调用数、React-free 单测和真实页面的 fit/zoom 读数；不产出 L_D（描述长度）或 L_G（生成对齐）读数，本仓的 archguard 暗轴探针也未接入该判据。
