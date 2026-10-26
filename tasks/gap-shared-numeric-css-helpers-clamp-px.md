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

- [ ] 共享定义存在：`grep -nE "export function (clamp|parseCssPx)\(" src/shared/utils.ts` 输出 2 行，且每个上方有 `/**` 文档注释。
- [ ] 副本清零：`grep -nE "^(export )?function (clamp|clampBetween|stylePx)\(|const px = \(value: string\)" src/modules/chat/utils/transcript/contentHeightModel.ts src/modules/shell/utils/mobileTerminalSelection.ts src/modules/architecture/ArchitectureMinimap.tsx src/modules/architecture/semanticZoomLayout.ts src/modules/architecture/graphDom.ts src/modules/architecture/svgViewport.ts` 无输出。
- [ ] 行为不变：`npx vitest run src/modules/architecture src/modules/chat/utils src/modules/shell` 全绿（退出码 0），新增 `src/shared/tests/numericCssHelpers.test.ts` 覆盖 `clamp` 的区间内/上下越界/NaN/±Infinity 与 `parseCssPx` 的 `'12px'`/`'0'`/`''`/`'auto'`，`npx vitest run src/shared/tests/numericCssHelpers.test.ts` 退出码 0。
- [ ] 类型与规范：`npx tsc --noEmit -p .` 无输出，`npm run lint` 退出码 0。
- [ ] 行数基线只降不升：`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。

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
