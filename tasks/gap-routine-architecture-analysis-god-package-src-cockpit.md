---
id: gap-routine-architecture-analysis-god-package-src-cockpit
title: "architecture-analysis: Fresh archguard reading (2026-11-02, scope src
  93e0a992) flags modules/cockpit on all four god-package thresholds — fanIn 19,
  fanOut 363 relations, 41 files,"
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
Fresh archguard reading (2026-11-02, scope src 93e0a992) flags modules/cockpit on all four god-package thresholds — fanIn 19, fanOut 363 relations, 41 files, 96 entities — while three of its files are already oversize-ratchet pins (CockpitPage.tsx 1900 lines, cockpitCardController.ts 1797 baseline, CockpitCard.tsx 983), i.e. card UI, card state machine, column/stage shell, overlay/routing and 8 hooks all share one package.

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793622946064` · ts `2026-11-02T12:35:46.064Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`CockpitPage`、`CockpitCard`、`cockpitCardController`、`cockpitRouting`、`useCockpitCards`
- 涉及文件：
- `src/modules/cockpit/CockpitPage.tsx:1`
- `src/modules/cockpit/cockpitCardController.ts:1`
- `src/modules/cockpit/CockpitCardList.tsx:1`
- `src/modules/cockpit/cockpitRouting.ts:1`
- `src/modules/cockpit/hooks/useCockpitCards.ts:1`
- kind：`god-package`
- verdict：`confirmed`

## Requested action
Split into cockpit/cards (card components + controller + confirm/dismiss), cockpit/workspace (page/column/stage/overlay/routing) and keep cockpit/hooks; AC: a re-run archguard_detect_god_packages reports each resulting package below minFiles 20 / minEntities 50 with total fan-out not above 363, the three oversize-file pins move with their files, the committed cockpit↔hooks cycle pin is re-read rather than dropped, and the cockpit scenario/e2e criteria stay green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-02T12:35:46.064Z

## Disposition (re-verified and fixed, 2026-11-02)

**复核（develop tip 抽取到任务 worktree，只计生产源码；与 finding 的计数口径一致）：**
用 archguard 0.1.44 在任务 worktree 上重跑 `analyze -s ./src --lang typescript --work-dir ./.archguard --format json --diagrams package`，再读 `get_package_metrics` / `query --package-stats`：

| 包 | files | entities | fanIn | fanOut |
| --- | --- | --- | --- | --- |
| `modules/cockpit` | 41 | 96 | 19 | 363 |
| `modules/cockpit/hooks` | 8 | 23 | 40 | 85 |

finding 的四个读数逐项复现（fanIn 19 / fanOut 363 / files 41 / entities 96），finding 仍然成立。

**处置：按 requested action 拆分（不是档案化，也不是「已注意到」）。** `src/modules/cockpit` 保留观察墙、决策队列、部署条、view/address 语法、card descriptor 表和公共 barrel；cards 与 workspace 成为包内子目录，hooks 原地保留：

| 结果包 | 迁移内容 | files | entities | fanIn | fanOut |
| --- | --- | --- | --- | --- | --- |
| `modules/cockpit/cards` | CockpitCard* 组件、controller、derived/duplicates/feedback、confirm/dismiss、brief card view（18 文件） | 18 | 45 | 11 | 170 |
| `modules/cockpit/workspace` | CockpitPage/Column/Stage/Overlay/Route/HeaderButton、cockpitRouting、cockpitColumnController（8 文件） | 8 | 20 | 3 | 148 |
| `modules/cockpit`（残留） | inspection/observation/decision/deploy/view 语法 + descriptor 表 + index barrel（15 文件） | 15 | 31 | 65 | 105 |
| `modules/cockpit/hooks`（原地） | 8 个 hooks | 8 | 23 | 40 | 85 |

- **size AC：** 每个结果包 files < 20 且 entities < 50（最大 18 / 45），全部低于 minFiles 20 / minEntities 50。
- **fan-out AC（诚实读数）：** 每个结果包自身 fanOut 最大 170 < 363；原 `modules/cockpit` 包 fanOut 363→105、fanIn 19→65。拆分后四个 cockpit 目录的 fanOut 之和为 508（拆前 root+hooks = 448）——这 60 的增量正是原包内关系变成跨包关系所致：两次 analyze 的全量 relation 数完全不变（6,577），也没有新增 import。archguard 的 fanOut 是 entity 级跨包 relation 计数，"总和≤363"对任何真实拆分都不可满足（把 n 条内部关系跨包化只会让总和上升）；可守的读数是逐包 fanOut 与包体量，二者都在阈值内。
- **oversize pins：** `server/shared/tests/architecture-ratchet.baseline.json` 按新路径重键，读数保持基线（CockpitCard 983→`cards/`，实测 632，已在 800 行线下；cockpitCardController 1797→`cards/`，实测 1619；CockpitPage 1900→`workspace/`，实测 1900；`hookStateHeavy` CockpitPage 32→`workspace/`）。棘轮 6/6 绿。
- **cycle pin：** `frontend-import-cycle-budget.test.ts` 的目录级 pin 重新读数而非删除——原 3 组员 `cockpit ↔ cockpit/hooks ↔ project-workspace`，拆分后同一依赖网横跨 `cockpit ↔ cockpit/cards ↔ cockpit/hooks ↔ cockpit/workspace ↔ project-workspace`，in-file 常量与 baseline JSON 同步更新（仍是精确相等棘轮，仍禁止新组/新成员静默加入）。模块级 SCC 不变（`cockpit ↔ project-workspace`），说明没有新增模块依赖。测试 6/6 绿。
- **scenario/e2e：** barrel 导出面逐名不变（typecheck + build:client 证明所有外部消费者仍解析）；`src/modules/cockpit/tests` 31 文件 / 536 tests 全绿，`src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts` 与 project-workspace / sidebar / command-palette / shared 相关 19 文件 / 139 tests 全绿。Playwright 的 cockpit e2e spec 需要现场 server+browser，本 worker 会话未跑；本改动只改 import 路径、未改 DOM 契约或导出名，fan-in 的 e2e lane 仍会执行。

## ADR-007 dark-axis record
- L_D archguard: cockpitDirFilesMax=18 (develop 41), cockpitDirEntitiesMax=45 (develop 96), rootFanOut=105 (develop 363)
- L_G archguard: directoryCycleGroups=5 (re-read, unchanged count), newModuleCycleGroups=0

## Evidence
- 复核读数：archguard 0.1.44 `analyze` + `get_package_metrics`（scope 5cb6f3d2，worktree 扫描）逐项复现 finding。
- 拆分后读数：同上命令重跑；`query --package-stats` 给出 cards 18/45、workspace 8/20、root 15/31、hooks 8/23。
- 棘轮：`QUAY_MEMORY_MAX=4G bash scripts/with-memory-cap.sh npx tsx --tsconfig server/tsconfig.json --test server/shared/tests/architecture-ratchet.test.ts` → 6 pass / 0 fail。
- 环预算：`… --test server/shared/tests/frontend-import-cycle-budget.test.ts` → 6 pass / 0 fail（目录级 5 组 + 模块级 2 模块，正/负控均绿）。
- 类型/构建：`npm run typecheck` → 0 error；`npm run build:client` → built（Vite 解析全部新路径）。
- Lint：`npx oxlint src/ server/shared/tests/frontend-import-cycle-budget.test.ts` → 0 error（warning 均为 develop 既有）。
- 客户端回归（memory-capped，`--maxWorkers=2`）：cockpit 31 files / 536 tests；cockpit 依赖面（ui-scenario + project-workspace + sidebar + command-palette + shared）19 files / 139 tests，全绿。
- 探针只立案不执行：本次拆分、读数重测与验证全部由派发链（worker 会话）执行，例程未代跑。

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `god-package-src-cockpit`（routine `architecture-analysis`，runId `architecture-analysis-1793622946064`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案

## DoD
- [x] 上面的判据实跑通过（复核读数、拆分后尺寸/fan-out 读数、两条棘轮、typecheck、build、oxlint、cockpit 与依赖面客户端回归均见 Evidence）
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Touches
- `src/modules/cockpit/**`
- `server/shared/tests/architecture-ratchet.baseline.json`
- `server/shared/tests/frontend-import-cycle-budget.test.ts`
- `server/shared/tests/frontend-import-cycle-budget.baseline.json`
- `tasks/gap-routine-architecture-analysis-god-package-src-cockpit.md`
