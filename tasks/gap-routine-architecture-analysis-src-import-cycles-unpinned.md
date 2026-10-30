---
id: gap-routine-architecture-analysis-src-import-cycles-unpinned
title: "architecture-analysis: 5 non-trivial directory SCCs in src (108 dir
  nodes, 2147 static file edges):
  chat/tools<->chat/tools/ContentRenderers<->chat/transcript;
  cockpit<->cockpit/ho"
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
5 non-trivial directory SCCs in src (108 dir nodes, 2147 static file edges): chat/tools<->chat/tools/ContentRenderers<->chat/transcript; cockpit<->cockpit/hooks<->project-workspace; git-panel<->git-panel/changes<->git-panel/history; architecture<->architecture/hooks; settings/hooks<->settings/tabs. server/ has the AC-394 ratchet but src has no cycle criterion and .oxlintrc.json enables no import/no-cycle rule, so these may widen unmeasured.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793381097836` · ts `2026-10-30T17:24:57.836Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`MarkdownContent`、`ToolRenderer`、`MessageComponent`、`CockpitCardList`、`WorkspaceMain`、`FileChangeItem`、`useCockpitSessionStartSettings`、`useProjectSearch`
- 涉及文件：
- `src/modules/chat/tools/ContentRenderers/MarkdownContent.tsx:3`
- `src/modules/chat/transcript/MessageComponent.tsx:8`
- `src/modules/cockpit/CockpitCardList.tsx:23`
- `src/modules/project-workspace/WorkspaceMain.tsx:12`
- `src/modules/git-panel/changes/FileChangeItem.tsx:6`
- `src/modules/settings/hooks/useCockpitSessionStartSettings.ts:12`
- `src/modules/architecture/hooks/useProjectSearch.ts:3`
- kind：`dependency-cycle`
- verdict：`confirmed`

## Requested action
Add a frontend directory-cycle ratchet test (same Tarjan scanner as server/shared/import-graph.ts, @/->src alias) with a committed src baseline that may only shrink; AC: today's 5 groups are pinned and a planted 2-dir cycle reds the test.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-10-30T17:24:57.836Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `src-import-cycles-unpinned`（routine `architecture-analysis`，runId `architecture-analysis-1793381097836`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## 处置（2026-10-31，派发链执行）

复核（读数，不是转抄）：用 `server/shared/import-graph.ts` 的同一个 Tarjan 扫描器、以 `src/` 为扫描根（`@/` 解析到 `src/`），在合并树上读到 files=688、目录节点=108、静态文件边=2144、非平凡目录 SCC=5，五组成员与 finding 逐组一致（finding 的 2147 是 ArchGuard 的计数口径，与本扫描器 2144 的差来自 specifier 解析/去重规则，不是新增边）。「无机制在管」成立：src 侧此前没有 cycle 判据，`.oxlintrc.json` 也没有 `import/no-cycle`。

处置：按 requested action **不拆这 5 组**，而是把它们钉成棘轮：
- 新增 `server/shared/tests/frontend-import-cycle-budget.test.ts` 与 `frontend-import-cycle-budget.baseline.json`；扫描核心复用 AC-394 的收集器（`collectServerSources` 的通用名 `collectTypeScriptSources`，server 侧保留同名包装），没有第二份实现、没有第二种 Tarjan。
- 基线在测试常量与已提交 JSON 两处同时钉死；两处必须命名同一组。只许缩减——真把一组环关掉时，同一 commit 在两处一起下调；⛔ 不许为迁就红读数加成员或加组。
- 判据自证可分辨：planted 两目录环（一条相对边 + 一条 `@/` 边）必须让同一个断言红；单向 import 必须不红；真实树必须与五组完全相等。另有 files/directories/edges 的下限，防止空扫描的「零环」被读成绿。
- 失败在哪一步（可核）：任何把新目录拉进这五组、或形成新非平凡 SCC 的 import，会在 `frontend-import-cycle-budget.test.ts` 的 `assertCycleBudget` deepEqual 处红，消息指明「缩减时才下调基线，绝不加成员」。

实跑读数（本 worktree）：
- `npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/frontend-import-cycle-budget.test.ts` → tests 3 / pass 3 / fail 0。
- 同命令跑 `server-import-cycle-budget.test.ts` → tests 12 / pass 12 / fail 0（收集器改名未改 server 任何读数）。
- 同命令跑 `quay-test-script.test.ts` → tests 14 / pass 14 / fail 0（两处 `unknown=` 计数 pin 与 90% 时长基线覆盖随新增判据文件重测：479 collected、432 有基线行）。
- `npx tsc --noEmit -p server/tsconfig.json` → exit 0；`npx oxlint <touched files>` → exit 0。

- L_G archguard: cycles=5 dir_nodes=108 static_file_edges=2144

该读数是本任务改动前后的同一张图：本任务只加钉、未改依赖边，L_G 与 finding 立案时一致。

## Touches
- `server/shared/import-graph.ts`
- `server/shared/tests/frontend-import-cycle-budget.test.ts`
- `server/shared/tests/frontend-import-cycle-budget.baseline.json`
- `server/shared/tests/quay-test-script.test.ts`
- `scripts/suite-duration-baseline.tsv`
- `tasks/gap-routine-architecture-analysis-src-import-cycles-unpinned.md`