---
id: gap-routine-architecture-analysis-god-package-src-sidebar
title: "architecture-analysis: archguard flags modules/sidebar at 25 files (>=
  minFiles 20) / 24 entities with fanOut 133; the 1343-line useSidebarController
  hook is the concrete reducible"
status: done
labels:
  - gap
  - routine-filed
  - architecture-analysis
parent: null
children: []
extra: {}
---
## Finding
archguard flags modules/sidebar at 25 files (>= minFiles 20) / 24 entities with fanOut 133; the 1343-line useSidebarController hook is the concrete reducible arm, while fanOut is a relation count a split cannot lower.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793795809080` · ts `2026-11-04T12:36:49.080Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`useSidebarController`、`SidebarContent`、`SidebarProjectItem`
- 涉及文件：
- `src/modules/sidebar/hooks/useSidebarController.ts:97`
- `src/modules/sidebar/SidebarContent.tsx:1`
- `src/modules/sidebar/SidebarProjectItem.tsx:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Decompose useSidebarController into session/project/dialog concern hooks behind a composed facade; AC: useSidebarController.ts<=600 lines, fileCount unchanged-or-lower with fanOut recorded as residual, sidebar and chat-composer tests green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-04T12:36:49.080Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-src-sidebar`（routine `architecture-analysis`，runId `architecture-analysis-1793795809080`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Disposition
finding `god-package-src-sidebar` 复核成立：`modules/sidebar` 的包体量来自根目录 25 个文件 /
24 个实体，其中可具体缩减的是 `useSidebarController.ts` 的 1343 行；`fanOut` 是实体关系计数，
拆 hook 不会降低它，按 residual 诚实记录。

处置（已修）：把 `useSidebarController` 按关注点拆为四个 hook，经同一 60 键 facade 组合，
消费面（`Sidebar.tsx` 与模块测试）不变：
- `src/modules/sidebar/hooks/useSidebarProjectsConcern.ts`（new，507 行）：展开/排序/星标/分页/项目改名删除
- `src/modules/sidebar/hooks/useSidebarSessionsConcern.ts`（new，693 行）：Conversations feed 与 live upsert、归档、会话改名删除 fork 恢复
- `src/modules/sidebar/hooks/useSidebarDialogs.ts`（new，105 行）：rename/delete/modal 与搜索输入状态
- `src/modules/sidebar/hooks/useSidebarConversationSearch.ts`（new，174 行）：会话搜索 SSE
- `src/modules/sidebar/hooks/useSidebarController.ts`：1343 行 → 185 行（≤600 验收线）

- L_G archguard: fileCount=25, entityCount=24, fanOut=133 (relation count, residual); useSidebarController lines=1343→185

## Evidence
- `npx tsc --noEmit -p tsconfig.json` → exit 0
- `vitest run src/modules/sidebar/tests` → 19 files / 123 tests passed
- `tsx --test server/shared/tests/architecture-ratchet.test.ts` → 6/6 pass；读数 `oversizeFiles useSidebarController.ts 1343→0`、`moduleMutableState 1→0`、`hookStateHeavy 35→0`（均可下调基线，未上调）
- `tsx --test server/shared/tests/frontend-import-cycle-budget.test.ts` → 6/6 pass（五个目录环与两个模块环均未变化）
- 新旧 facade 返回键对拍：`return {` 键集合 60 个完全一致

## Touches
- `src/modules/sidebar/hooks/useSidebarController.ts`
- `src/modules/sidebar/hooks/useSidebarProjectsConcern.ts` (new)
- `src/modules/sidebar/hooks/useSidebarSessionsConcern.ts` (new)
- `src/modules/sidebar/hooks/useSidebarDialogs.ts` (new)
- `src/modules/sidebar/hooks/useSidebarConversationSearch.ts` (new)
- `src/modules/sidebar/SidebarContent.tsx`
- `src/modules/sidebar/SidebarProjectItem.tsx`
- `tasks/gap-routine-architecture-analysis-god-package-src-sidebar.md`