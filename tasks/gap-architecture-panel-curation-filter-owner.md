---
id: gap-architecture-panel-curation-filter-owner
title: ArchitecturePanel 切片 1：人工策展与过滤设置状态收进 React-free 属主
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

<!-- dedup-ref --> `ArchitecturePanel.tsx` 的第一个切片；与 PlantUmlGraph 四个切片（`gap-architecture-graph-*-owner`）改的是不同文件，不互相串行。`curationStore.ts`（纯核心，已用 `createExternalStore`）保持为存储核心，本任务补的是它上面的编排属主。

现状（2026-10-26 实测）：`src/modules/architecture/ArchitecturePanel.tsx` 5023 行，单组件持有 43 个 `useState`、30 个 `useRef`、25 个 effect、60 个 `useMemo`/`useCallback`、9 处定时器/监听。其中「会被持久化、有规则」的两簇最先应有属主：人工策展 `curationStorageRevision`、`curationState`、`curationManagerOpen`、`soloNodeId`、`curationToast`（pin/移除/隐藏关系、撤销栈、与会话作用域的重新对齐 reconcile、toast 的出现与消失）；过滤与展示设置 `filterSettings`、`displaySettings`、`filterMenuOpen`、`filterPosition`、`filterDebounceRef`、`requestGranularity`、`granularity`、`includeToolResults`（按项目记忆的过滤器、去抖后重新请求图、粒度切换）。规则只能整页挂载才能测。

做法：新增 `src/modules/architecture/architectureCurationController.ts` 与 `architectureFilterController.ts`（或合为一个属主，由执行者按耦合度定），导出 `create…Controller(deps)`：命令 + `subscribe`/`getSnapshot` + `dispose`；存储（localStorage）、时钟、API 客户端经注入 seam 传入；过滤变更的去抖与「请求粒度」只有一条写路径。面板只订阅快照并渲染。遵循 `.agents/skills/frontend-module-standards/SKILL.md` 的「Encapsulate state behind an owner」。

## AC

- [x] 属主文件存在且不依赖 React：`grep -lE "export function create(Architecture)?(Curation|Filter)[A-Za-z]*Controller" src/modules/architecture/*.ts` 至少列出 1 个文件，且对每个列出的文件 `grep -n "from 'react'" <file>` 无输出。
- [x] 下列声明已从面板中清零：`grep -cE "const \[?(curationStorageRevision|curationState|curationManagerOpen|soloNodeId|curationToast|filterSettings|displaySettings|filterMenuOpen|filterPosition|filterDebounceRef|requestGranularity|granularity|includeToolResults)\b" src/modules/architecture/ArchitecturePanel.tsx` 输出 0。
- [x] 属主可脱离 React 测试：新增对应 `tests/*Controller.test.ts`，用假存储与假时钟覆盖：pin/移除/隐藏关系与撤销、reconcile 后 stale 标记、toast 超时消失、过滤变更去抖后只请求一次、按项目记忆并恢复过滤器、粒度切换触发重新请求、dispose 清定时器；相应 `npx vitest run <新测试文件>` 退出码 0。
- [x] 行数只降不升：`wc -l src/modules/architecture/ArchitecturePanel.tsx` 小于 5023，且 `server/shared/tests/architecture-ratchet.baseline.json` 中该文件的值同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [x] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：Pin 一个实体、移除一个、隐藏一条关系，Ctrl/Cmd+Z 撤销，刷新页面后策展仍在；打开 Filter 菜单改变 kind 与 relation 预设并观察图的更新只请求一次（Network 面板读请求数）、切 Class diagram / File graph 粒度；「Hiding N」徽标与图一致。同时跑 `npx vitest run src/modules/architecture/tests/curationStore.test.ts src/modules/architecture/tests/elementRelationFilter.test.ts src/modules/architecture/tests/architectureTab.test.tsx` 退出码 0。仅单测通过不算完成。

### DoD 证据（隔离实例真页 · Playwright 临时驱动）

截图存于 `tmp/architecture-curation-filter-dod/`：`00-initial.png`、`01-pinned.png`、`02-removed.png`、`03-relation-hidden.png`、`04-undo.png`、`05-reload-persisted.png`、`06-filter-applied.png`、`07-hidden-reading.png`、`08-file-graph.png`、`09-entity-graph-again.png`；结构化读数见同目录 `report.json`。

- Pin/移除/隐藏关系/撤销：Adjusted 计数 0 → 1（`Pinned Alpha`）→ 2（`Removed Gamma from the graph`）→ 3（`Hid the relation — display only; the code is unchanged.`）；画布聚焦后 Ctrl+Z 回到 2；刷新后仍为 2，被移除的 Gamma 仍不在图中。
- 过滤去抖：打开 Filter 后连续点 relation `call` 与 kind `function`，`POST /api/architecture/graph` 计数为 1。
- 徽标与图一致：默认态徽标 `Hiding 4`、展开读数 `kinds={function:1}` 且 `function` 节点未绘制；改完预设后徽标 `Hiding 1`、已无被隐藏节点（本夹具无 `other` 实体）、`echo` 函数节点已绘制。
- 粒度：File graph 徽标立即切换（`aria-checked=true`），随后 1 次请求、3 个文件节点；切回 Class diagram 亦 1 次请求。
- DoD 指定的三文件 vitest：`Test Files 3 passed (3) · Tests 169 passed (169)`，退出码 0。
- 控制台 400 仅来自 debug provider 的 `active-model`/`skills` 端点（夹具会话固有），本改动无新增页面错误、无失败请求。

## ADR-007

该轴仍暗,理由:本切片只把前端面板的策展与过滤状态搬进 React-free 属主，未改变架构图的分析/编码输出，无 L_D/L_G 读数可报。

## Touches

- src/modules/architecture/ArchitecturePanel.tsx
- src/modules/architecture/CurationToast.tsx
- src/modules/architecture/curationStore.ts
- src/modules/architecture/elementRelationFilter.ts
- src/modules/architecture/panelFilters.ts
- src/modules/architecture/panelPersistence.ts
- src/modules/architecture/architectureCurationController.ts
- src/modules/architecture/architectureFilterController.ts
- src/modules/architecture/tests/architectureCurationController.test.ts
- src/modules/architecture/tests/architectureFilterController.test.ts
- src/modules/architecture/tests/architectureTab.test.tsx
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-panel-curation-filter-owner.md
