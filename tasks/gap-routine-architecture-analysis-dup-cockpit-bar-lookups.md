---
id: gap-routine-architecture-analysis-dup-cockpit-bar-lookups
title: "architecture-analysis: archguard_detect_duplicates(scope=src) group
  09b92d29fcda31df: 77 tokens / 8 statements / 13 lines, an identical
  document.querySelectorAll loop that differs "
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
archguard_detect_duplicates(scope=src) group 09b92d29fcda31df: 77 tokens / 8 statements / 13 lines, an identical document.querySelectorAll loop that differs only in the data attribute name (confirm-pending vs dismiss-pending).

载体记录（逐字来源）：`.quay/routine-findings.jsonl` · routine `architecture-analysis` · probe `architecture-analysis` · runId `architecture-analysis-1793882215773` · ts `2026-11-05T12:36:55.773Z`。

该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸
（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。

- 观测符号：`pendingBarFor`、`dismissBarFor`
- 涉及文件：
- `src/modules/ui-scenario/cockpitCardsSurface.ts:325`
- `src/modules/ui-scenario/cockpitCardsSurface.ts:448`
- kind：`duplication`
- verdict：`confirmed`

## Requested action
Parameterize the attribute into one barFor(attribute, cardId) helper and route both waiters through it; AC: group 09b92d29fcda31df is gone from archguard_detect_duplicates(scope=src) and src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts stays green.

## Effect Prediction
- metric: concept_recurs_after_merge
- expected: false
- statement: 修复后 `<none>` 不再以同一 subject 复发（同 concept_key 的后续记录数应为 0）
- recorded_at: 2026-11-05T12:36:55.773Z

## AC
- [x] `.quay/routine-findings.jsonl` 中 finding `dup-cockpit-bar-lookups`（routine `architecture-analysis`，runId `architecture-analysis-1793882215773`）所描述的问题被复核并处置
- [x] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案
- [x] 已修掉：attribute 参数化为单个 `barFor(attribute, cardId)` 与单个 `waitForBar(attribute, cardId)`，`archguard_detect_duplicates(scope=src)` 中 group `09b92d29fcda31df` 消失（groupCount 3→2），且 `src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts` 全绿（6/6 passed）

## DoD
- [x] 上面的判据实跑通过
- [x] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑

## Evidence
- 实现提交 `d1dc7c3a7`：`src/modules/ui-scenario/cockpitCardsSurface.ts`（+19 / −38），两个 `document.querySelectorAll` 循环合并为一个 `barFor(attribute, cardId)`，两个 waiter 合并为经它读取的 `waitForBar(attribute, cardId)`；调用点为 `waitForBar('data-confirm-pending', cardId)` 与 `waitForBar('data-dismiss-pending', cardId)`。
- archguard_detect_duplicates(scope=src)（minStatements=6 / minTokens=50，默认阈值）实测：改前 groupCount=3，含 `09b92d29fcda31df tokens=77 stmts=6 lines=13 :: cockpitCardsSurface.ts:325-337 pendingBarFor | cockpitCardsSurface.ts:448-460 dismissBarFor`；改后 groupCount=2，该组消失，剩余两组（`src/shared/userSettings.ts` detectBrowserName/detectOsName、`src/modules/sidebar/hooks/useSidebarConversationSearch.ts` 两个匿名函数）与本任务无关。
- `bash scripts/with-memory-cap.sh npx vitest run src/modules/ui-scenario/tests/cockpitCardsSurface.test.ts` → 1 file / 6 tests passed。
- `npx tsc --noEmit -p tsconfig.json` → exit 0。
- collateral（2026-11-05 续做轮）：develop 的 `39966e6c7` 给 `server/modules/cockpit/cockpit-card-actions.ts` 增加 4 行注释（797→801），越过 800 行 ratchet 且该文件不在 committed baseline ⇒ develop 自身 suite 红（`fan-in-suite-…~baseline-1793883405777-56a2a5.log` 第 4 行逐字同一条 `oversizeFiles … 基线外→801`）。本轮把该 4 行 source 词表注释压成 2 行（纯注释，`source: option?.source ?? 'provider'` 未动）→ 799 行；`tsx --test server/shared/tests/architecture-ratchet.test.ts` → 6/6 pass。故 fan-in 的 `changed-assertion` 只是 [[fan-in-changed-assertion-is-a-log-layout-artifact]] 的 marker 取词版式差异，底层红已在本分支消除。
- `tsx --test server/modules/cockpit/tests/cockpit-card-feedback.test.ts` → 21/21 pass（collateral 文件仅注释改动）。
- L_D: docLines=0 codeLines=57 ratio=0.000 verdict=PASS（`phase-declare.js --ld-reading --numstat-file`，numstat 取 `1de97af99..d1dc7c3a7`）
- L_G: 该轴仍暗,理由:worktree 内没有 `.archguard/query/manifest.json`（该产物被 gitignore、只存在于主检出），`archguard-runner.js --root .` 对各 scope 判 not-evaluated 而非 0 cycles；本任务的结构结论由上面的 duplicates 读数承担

## Touches
- `src/modules/ui-scenario/cockpitCardsSurface.ts`
- `tasks/gap-routine-architecture-analysis-dup-cockpit-bar-lookups.md`
- `server/modules/cockpit/cockpit-card-actions.ts` (collateral: condense the 4-line source-vocabulary comment from develop 39966e6c7 to 2 lines, restoring the 800-line ratchet; comment-only, no behaviour change)
