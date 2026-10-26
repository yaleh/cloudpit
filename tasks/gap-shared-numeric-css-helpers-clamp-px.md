---
id: gap-shared-numeric-css-helpers-clamp-px
title: 数值小工具归位：clamp 与 CSS px 解析的重复副本收进 src/shared/utils
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-shared-utils-small-helpers-dedup
---
## Proposal

<!-- dedup-ref --> 与 `gap-shared-utils-small-helpers-dedup`（`isRecord`/`errorMessage`/`expandHome` 的归位）同一机制、不同函数族：本任务只处理数值 `clamp` 与 CSS 像素解析，两者都要往 `src/shared/utils.ts` 加导出，所以对它声明依赖以串行同一文件。

现状（2026-10-26 实测）：前端 `clamp(value, min, max)` 有 4 份逐行等价的本地定义——`src/modules/chat/utils/transcript/contentHeightModel.ts:66`、`src/modules/shell/utils/mobileTerminalSelection.ts:79`、`src/modules/architecture/ArchitectureMinimap.tsx:147`（多一行非有限值返回 min 的守卫）、`src/modules/architecture/semanticZoomLayout.ts:1188`（名为 `clampBetween`）；CSS 像素解析（`Number.parseFloat` 后非有限取 0）有 2 份——`src/modules/architecture/graphDom.ts:1189` 的导出函数 `stylePx` 与 `src/modules/architecture/svgViewport.ts:455` 的局部闭包 `px`。前端标准（`.agents/skills/frontend-module-standards/SKILL.md`「Place utilities by usage」）要求用于两处及以上的工具函数放进 `src/shared/utils.ts`，且 ArchGuard 的精确克隆检测看不到这类 3 行函数，所以靠人读才发现。

做法：在 `src/shared/utils.ts` 新增带完整文档注释的 `clamp(value, min, max)`（非有限值返回 `min`，涵盖 Minimap 的守卫语义）与 `parseCssPx(value)`（非有限取 0）；上述 6 处改为引用，删除本地定义；`stylePx` 的现有导入方改引 shared 版本。不改任何调用点的数值行为。

## AC

- [x] 共享定义存在：`grep -nE "export function (clamp|parseCssPx)\(" src/shared/utils.ts` 输出 2 行，且每个上方有 `/**` 文档注释。
- [x] 副本清零：`grep -nE "^(export )?function (clamp|clampBetween|stylePx)\(|const px = \(value: string\)" src/modules/chat/utils/transcript/contentHeightModel.ts src/modules/shell/utils/mobileTerminalSelection.ts src/modules/architecture/ArchitectureMinimap.tsx src/modules/architecture/semanticZoomLayout.ts src/modules/architecture/graphDom.ts src/modules/architecture/svgViewport.ts` 无输出。
- [x] 行为不变：`npx vitest run src/modules/architecture src/modules/chat/utils src/modules/shell` 全绿（退出码 0），新增 `src/shared/tests/numericCssHelpers.test.ts` 覆盖 `clamp` 的区间内/上下越界/NaN/±Infinity 与 `parseCssPx` 的 `'12px'`/`'0'`/`''`/`'auto'`，`npx vitest run src/shared/tests/numericCssHelpers.test.ts` 退出码 0。
- [x] 类型与规范：`npx tsc --noEmit -p .` 无输出，`npm run lint` 退出码 0。
- [x] 行数基线只降不升：`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。

## DoD

用真实对象走一遍机制：在隔离实例的真实页面上打开 architecture tab，拖动小地图视口框到边缘（`ArchitectureMinimap` 的 clamp 生效，框停在边缘）、缩放到 100%/46%/17% 读取画布 padding 参与的 Fit（`svgViewport` 的 `parseCssPx` 生效，图居中且无偏移），打开一个长会话的聊天页滚动（`contentHeightModel` 的 clamp），截图存 `tmp/`；贴出 `git diff --stat` 证明净删除行数大于新增。仅单测通过不算完成。

## Touches

- src/shared/utils.ts
- src/shared/tests/numericCssHelpers.test.ts
- src/modules/chat/utils/transcript/contentHeightModel.ts
- src/modules/shell/utils/mobileTerminalSelection.ts
- src/modules/architecture/ArchitectureMinimap.tsx
- src/modules/architecture/semanticZoomLayout.ts
- src/modules/architecture/graphDom.ts
- src/modules/architecture/svgViewport.ts
- tasks/gap-shared-numeric-css-helpers-clamp-px.md

## Evidence

- AC 逐条复跑（2026-10-26，本 worktree）：AC1 grep 命中 `src/shared/utils.ts:399` 与 `:411` 两行且各自上方有 `/**` 文档注释；AC2 副本 grep 零输出；AC3 `npx vitest run src/modules/architecture src/modules/chat/utils src/modules/shell --maxWorkers=4`（with-memory-cap）**48 files / 760 passed, 1 skipped, exit 0**，新判据 `numericCssHelpers.test.ts` 5 passed、exit 0；AC4 `npx tsc --noEmit -p .` 无输出 exit 0、`npm run lint` exit 0；AC5 `npx tsx --test server/shared/tests/architecture-ratchet.test.ts` **6 passed / 0 failed**，读数只降不升（`smallHelperCopies 31→6`，`src/shared/utils.ts 1903→1900` 等均打印「可下调基线」）。
- DoD 真实页面（隔离实例 `http://127.0.0.1:3187`，生产构建 `dist/`，`scripts/isolated-instance.sh`，residentRestore/sweep 均关）：architecture tab 用会话 `ab1a0122-1efd-4715-bdf4-b460ce918195`（131 entity/57 file）与 `d0c57b92-0532-43a6-a9ba-ac93120bef48`（小图）。
  - Fit 读数：大图 **150%**、小图 **100%**，图在 host 内居中且无偏移（`measureViewportSize` 用 `parseCssPx` 从 computed padding 扣边后求解 Fit）——`tmp/dod/architecture-fit.png`、`tmp/dod-zoom/architecture-fit.png`。
  - 缩放梯队：小图 **100%→80→64→51→41→33→26→21→17→13%**（命中 DoD 要求的 100%/17%，46% 落在 51–41 之间）；大图最接近 100% 的读数为 **96%**，其后 77/61/49/39/31/25/20/16/13%。截图 `tmp/dod-zoom/architecture-zoom-100.png`、`tmp/dod/architecture-zoom-low.png`。
  - 小地图拖到边缘：canvas 160×100，框 131.21×67.86，拖动前 `data-architecture-minimap-range` 的 left=0；把指针拖出画布右下两次后 left=**28.79 = 160−131.21**，即框恰好停在右边缘（clamp 生效，未越界）——`tmp/dod/architecture-minimap-edge.png`。
  - 长会话聊天页滚动：`.chat-messages-pane` clientHeight=668，scrollHeight=1814，scrollTop 0↔1146（底）并逐段滚轮下滑，无异常；`tmp/dod-zoom/chat-scroll-top.png`、`tmp/dod-zoom/chat-scroll-bottom.png`。
  - 控制台：`pageErrors=[]`；仅 2 条 **403 api.github.com/repos/siteboon/claudecodeui**（应用更新检查的外部限流），与本改动无关。结构化报告：`tmp/dod/report.json`、`tmp/dod-zoom/report.json`。
- `git diff --stat develop...HEAD`：**8 files changed, 95 insertions(+), 39 deletions(-)**。逐文件 `--numstat`：六个副本文件 **15 插入 / 39 删除（净 −24）**——`ArchitectureMinimap.tsx 1/6`、`graphDom.ts 5/10`、`semanticZoomLayout.ts 3/7`、`svgViewport.ts 3/6`、`contentHeightModel.ts 2/5`、`mobileTerminalSelection.ts 1/5`；新增 `numericCssHelpers.test.ts 52/0`（AC 要求的新判据）与 `src/shared/utils.ts 28/0`（两个带文档注释的共享导出）。**DoD 的字面「净删除行数大于新增」在本任务下不成立**：AC 同时要求新增测试文件与带文档的共享定义，这两项必然增行。实际机制证据是「六个副本文件全部净减 + AC2 副本 grep 零命中 + 行为等价（48 文件 760 测试与真实页面读数不变）」，没有把新增行算成净删除。

## ADR-007 dark axis

- L_D 该轴仍暗，理由：本任务只把数值 `clamp` 与 CSS px 解析的等价副本收进 `src/shared/utils`，不新增或改变任何领域数据通路/数据结构，没有可读的领域数据轴读数。
- L_G 该轴仍暗，理由：替换行为等价，未改变任何生成产物或生成质量读数；真实页面读数（Fit 150%/100%、缩放至 16%、最小地图框停在右边缘）只证明行为不变。
