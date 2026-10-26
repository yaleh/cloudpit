---
id: gap-architecture-panel-curation-filter-owner
title: ArchitecturePanel 切片 1：人工策展与过滤设置状态收进 React-free 属主
status: ready
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

- [ ] 属主文件存在且不依赖 React：`grep -lE "export function create(Architecture)?(Curation|Filter)[A-Za-z]*Controller" src/modules/architecture/*.ts` 至少列出 1 个文件，且对每个列出的文件 `grep -n "from 'react'" <file>` 无输出。
- [ ] 下列声明已从面板中清零：`grep -cE "const \[?(curationStorageRevision|curationState|curationManagerOpen|soloNodeId|curationToast|filterSettings|displaySettings|filterMenuOpen|filterPosition|filterDebounceRef|requestGranularity|granularity|includeToolResults)\b" src/modules/architecture/ArchitecturePanel.tsx` 输出 0。
- [ ] 属主可脱离 React 测试：新增对应 `tests/*Controller.test.ts`，用假存储与假时钟覆盖：pin/移除/隐藏关系与撤销、reconcile 后 stale 标记、toast 超时消失、过滤变更去抖后只请求一次、按项目记忆并恢复过滤器、粒度切换触发重新请求、dispose 清定时器；相应 `npx vitest run <新测试文件>` 退出码 0。
- [ ] 行数只降不升：`wc -l src/modules/architecture/ArchitecturePanel.tsx` 小于 5023，且 `server/shared/tests/architecture-ratchet.baseline.json` 中该文件的值同一提交里同步下调；`npx tsx --test server/shared/tests/architecture-ratchet.test.ts` 退出码 0。
- [ ] 回归：`npx vitest run src/modules/architecture` 全绿（退出码 0），`npx tsc --noEmit -p .` 无输出。

## DoD

在隔离实例的真实页面上亲手走一遍并截图存 `tmp/`：Pin 一个实体、移除一个、隐藏一条关系，Ctrl/Cmd+Z 撤销，刷新页面后策展仍在；打开 Filter 菜单改变 kind 与 relation 预设并观察图的更新只请求一次（Network 面板读请求数）、切 Class diagram / File graph 粒度；「Hiding N」徽标与图一致。同时跑 `npx vitest run src/modules/architecture/tests/curationStore.test.ts src/modules/architecture/tests/elementRelationFilter.test.ts src/modules/architecture/tests/architectureTab.test.tsx` 退出码 0。仅单测通过不算完成。

## Touches

- src/modules/architecture/ArchitecturePanel.tsx
- src/modules/architecture/curationStore.ts
- src/modules/architecture/elementRelationFilter.ts
- src/modules/architecture/architectureCurationController.ts
- src/modules/architecture/architectureFilterController.ts
- src/modules/architecture/tests/architectureCurationController.test.ts
- src/modules/architecture/tests/architectureFilterController.test.ts
- server/shared/tests/architecture-ratchet.baseline.json
- tasks/gap-architecture-panel-curation-filter-owner.md
